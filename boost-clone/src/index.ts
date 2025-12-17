import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as os from 'os';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';
import {
    parseExceptions,
    parseGitmodules
} from './scanning';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

// Import precomputed dependency data
import boostDepsData from '../boost-deps.json';

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git';

/**
 * Strategy for obtaining Boost source files.
 */
type CloneStrategy = 'auto' | 'git' | 'archive';

/**
 * Module dependency information from precomputed data.
 */
interface ModuleDeps {
    direct_deps: string[];
    transitive_deps: string[];
    total_count: number;
}

/**
 * Precomputed dependency data structure.
 */
interface BoostDepsData {
    generated: string;
    releases: Record<string, { modules: Record<string, ModuleDeps> }>;
}

/**
 * Configuration inputs for the boost-clone action.
 */
interface Inputs {
    boost_dir: string;
    branch: string;
    modules: Set<string>;
    patches: Set<string>;
    scan_modules_ignore: Set<string>;
    scan_modules_dir: Set<string>;
    modules_scan_paths: Set<string>;
    modules_exclude_paths: Set<string>;
    cache: boolean;
    optimistic_caching: boolean;
    trace_commands: boolean;
    clone_strategy: CloneStrategy;
    archive_threshold: number;
}

/**
 * Output values from the boost-clone action.
 */
interface Outputs {
    boost_dir: string;
}

/**
 * Git executable capabilities detected at runtime.
 */
interface GitFeatures {
    gitPath: string;
    version: semver.SemVer;
    supportsJobs: boolean;
    supportsScanScripts: boolean;
    supportsDepth: boolean;
}

/**
 * Individual hash components used to build the cache key.
 */
interface CacheKeyFragments {
    boostHash: string;
    modulesAndPatchesHash: string;
    configHash: string;
}

/**
 * Result from cache key generation including the key and its fragments.
 */
interface CacheKeyResult {
    cacheKey: string;
    fragments: CacheKeyFragments;
}

/**
 * Options for cache key generation behavior.
 */
interface GenerateCacheKeyOptions {
    logInfo?: boolean;
    withFragments?: boolean;
}

/**
 * Converts an iterable to a sorted array of strings.
 *
 * @param iterable - The iterable to convert, or null/undefined
 * @returns Sorted array of strings, or empty array if input is null/undefined
 */
function toSortedArray(iterable: Iterable<string> | null | undefined): string[] {
    if (!iterable) {
        return [];
    }
    return Array.from(iterable).map((value) => value).sort();
}

/**
 * Creates a SHA-1 hash of a JSON-serialized value.
 *
 * @param value - The value to hash
 * @returns Hexadecimal hash string
 */
function hashObject(value: unknown): string {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

/**
 * Detects the git executable and its feature capabilities.
 *
 * @param _inputs - Action inputs (currently unused)
 * @returns Git path, version, and supported features
 */
async function findGitFeatures(_inputs: Inputs): Promise<GitFeatures> {
    const gitPath = await setup_program.findGit();
    const { stdout } = await exec.getExecOutput(`"${gitPath}"`, ['--version']);
    const versionOutput = stdout.trim();
    const versionRegex = /(\d+\.\d+\.\d+)/;
    const versionMatches = versionOutput.match(versionRegex);
    const versionStr = versionMatches![1];
    const version = semver.coerce(versionStr, { includePrerelease: false, loose: true })!;
    const supportsJobs = semver.gte(version, '2.27.0');
    const supportsScanScripts = semver.gte(version, '3.5.0');
    const supportsDepth = semver.gte(version, '2.17.0');
    return { gitPath, version, supportsJobs, supportsScanScripts, supportsDepth };
}

/**
 * Reads and parses the boostdep exceptions.txt file.
 *
 * @param exceptionsPath - Path to the exceptions.txt file
 * @returns Map of header path to module name
 * @throws Error if the file does not exist
 */
function readExceptions(exceptionsPath: string): Record<string, string> {
    trace_commands.log(`readExceptions: Reading exceptions from ${exceptionsPath}`);
    if (!fs.existsSync(exceptionsPath)) {
        throw new Error(`Exceptions file not found: ${exceptionsPath}`);
    }
    const content = fs.readFileSync(exceptionsPath, 'utf-8');
    return parseExceptions(content);
}

/**
 * Reads and parses the .gitmodules file.
 *
 * @param gitmodulesPath - Path to the .gitmodules file
 * @returns Set of submodule paths (e.g., "libs/algorithm")
 * @throws Error if the file does not exist
 */
function readGitmodules(gitmodulesPath: string): Set<string> {
    if (!fs.existsSync(gitmodulesPath)) {
        throw new Error(`.gitmodules file not found: ${gitmodulesPath}`);
    }
    const content = fs.readFileSync(gitmodulesPath, 'utf-8');
    return parseGitmodules(content);
}

/**
 * Checks if a module name corresponds to a valid Boost submodule.
 *
 * @param moduleName - The module name to check
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 * @returns True if the module exists in the submodule paths
 */
function isModule(moduleName: string, submodulePaths: Set<string>): boolean {
    return submodulePaths.has(`libs/${moduleName}`);
}

const loggedHeaders = new Set<string>();

/**
 * Maps a Boost header path to its corresponding module name.
 *
 * @param header - The header path (e.g., "boost/algorithm/string.hpp")
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns The module name or null if not found
 */
function moduleForHeader(header: string, exceptions: Record<string, string>, submodulePaths: Set<string>): string | null {
    function fnlog(msg: string): void {
        trace_commands.log(`moduleForHeader: ${msg}`);
    }

    if (header in exceptions) {
        return exceptions[header];
    }

    const headerRegexes = [
        // Something like "boost/function.hpp" -> "function"
        'boost/([^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion/header.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^/]*)/',
        // Something like "boost/function/header.hpp" -> "function"
        'boost/([^/]*)/'
    ];

    for (const regex of headerRegexes) {
        const match = header.match(regex);
        if (match && isModule(match[1], submodulePaths)) {
            return match[1];
        }
    }

    if (!loggedHeaders.has(header)) {
        fnlog(`Cannot determine module for header: ${header}`);
        loggedHeaders.add(header);
    }
    return null;
}

/**
 * Scans file contents for Boost include statements and extracts module dependencies.
 *
 * @param fileContents - The source file contents to scan
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found in the file
 */
async function scanHeaderDependencies(fileContents: string, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    const modules = new Set<string>();
    const lines = fileContents.split('\n');
    for (const line of lines) {
        const match = line.match('[ \t]*#[ \t]*include[ \t]*["<](boost/[^">]*)[">]');
        if (match) {
            const header = match[1];
            const module = moduleForHeader(header, exceptions, submodulePaths);
            if (module) {
                modules.add(module);
            }
        }
    }
    return modules;
}

/**
 * Recursively scans a directory for Boost module dependencies.
 *
 * @param dir - Directory path to scan
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found in the directory
 */
async function scanSubdirectoryDependencies(dir: string, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    function fnlog(msg: string): void {
        trace_commands.log(`scanSubdirectoryDependencies: ${msg}`);
    }

    fnlog(`Scanning directory: ${dir}`);
    const modules = new Set<string>();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.resolve(path.join(dir, file));
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fnlog(`Scanning subdir: ${filePath}`);
            const subdirModules = await scanSubdirectoryDependencies(filePath, exceptions, submodulePaths);
            subdirModules.forEach(module => modules.add(module));
        } else {
            const fileContents = fs.readFileSync(filePath, 'utf-8');
            const fileModules = await scanHeaderDependencies(fileContents, exceptions, submodulePaths);
            fileModules.forEach(module => modules.add(module));
        }
    }
    return modules;
}

/**
 * Lists Boost dependencies by scanning specified subdirectories.
 *
 * @param dir - Base directory to scan
 * @param subdirs - List of subdirectory names to scan within the base directory
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found
 */
async function listBoostDependencies(dir: string, subdirs: string[], exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    trace_commands.log(`listBoostDependencies: Scanning subdirs of ${dir}`);
    const modules = new Set<string>();
    for (const subdir of subdirs) {
        const subdirPath = path.resolve(path.join(dir, subdir));
        if (!fs.existsSync(subdirPath)) {
            continue;
        }
        trace_commands.log(`listBoostDependencies: Scanning subdir: ${subdirPath} for Boost dependencies`);
        const subdirModules = await scanSubdirectoryDependencies(subdirPath, exceptions, submodulePaths);
        for (const module of subdirModules) {
            modules.add(module);
        }
    }
    return modules;
}

/**
 * Scans a project directory for Boost module dependencies.
 *
 * Combines user-specified include/exclude paths with default directories
 * and filters out ignored modules.
 *
 * @param scanDir - Directory to scan for Boost dependencies
 * @param inputs - Action inputs containing scan configuration
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names required by the project
 */
async function scanBoostDependencies(scanDir: string, inputs: Inputs, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    const dir = scanDir;
    const ignore = inputs.scan_modules_ignore;
    const include = inputs.modules_scan_paths;
    const exclude = inputs.modules_exclude_paths;

    let subdirs = ['include', 'src', 'source', 'test', 'tests', 'example', 'examples'];
    for (const subdir of exclude) {
        if (subdirs.includes(subdir)) {
            subdirs = subdirs.filter((dir) => dir !== subdir);
        }
    }
    for (const subdir of include) {
        if (!subdirs.includes(subdir)) {
            subdirs.push(subdir);
        }
    }
    core.info(`Directories to scan: ${subdirs.join(', ')}`);

    const modules = await listBoostDependencies(dir, subdirs, exceptions, submodulePaths);
    core.info(`Scanned modules: ${gh_inputs.makeValueString(modules)}`);

    for (const ignored of ignore) {
        if (modules.has(ignored)) {
            modules.delete(ignored);
        }
    }
    modules.delete(null as unknown as string);

    return modules;
}

/**
 * Retrieves the git commit hash for a repository at a given branch.
 *
 * @param repoUrl - URL of the git repository
 * @param branch - Branch or tag name
 * @param gitFeatures - Git executable information
 * @returns The commit hash string
 * @throws Error if the remote lookup fails
 */
async function getGitHash(repoUrl: string, branch: string, gitFeatures: GitFeatures): Promise<string> {
    const { exitCode, stdout } = await exec.getExecOutput(`"${gitFeatures.gitPath}"`, [
        'ls-remote', repoUrl, branch]);
    if (exitCode !== 0) {
        throw new Error(`Failed to get hash for ${repoUrl} at branch ${branch}`);
    }
    return stdout.trim().split('\t')[0];
}

/**
 * Constructs the GitHub repository URL for a Boost module.
 *
 * @param module - Module name (e.g., "algorithm" or "numeric/conversion")
 * @returns The GitHub repository URL
 */
function getModuleRepoUrl(module: string): string {
    return `https://github.com/boostorg/${module.replace('/', '_')}.git`;
}

/**
 * Generates a unique cache key for the Boost installation based on configuration.
 *
 * Computes hashes from module versions, patches, and configuration settings to
 * create a deterministic cache key for GitHub Actions caching.
 *
 * @param inputs - Boost clone inputs including branch, modules, and patches
 * @param allModules - Complete set of modules to include (direct and transitive dependencies)
 * @param gitFeatures - Git capabilities detected on the system
 * @param options - Cache key generation options (logging, fragments)
 * @returns Cache key string or object with key and fragments
 */
async function generateCacheKey(inputs: Inputs, allModules: Set<string>, gitFeatures: GitFeatures, options: GenerateCacheKeyOptions = {}): Promise<string | CacheKeyResult> {
    function fnlog(msg: string): void {
        trace_commands.log(`generateCacheKey: ${msg}`);
    }

    const allModulesSorted = toSortedArray(allModules);
    const patchesSorted = toSortedArray(inputs.patches);

    const boostHash = await getGitHash(boostSuperProjectRepo, inputs.branch, gitFeatures);
    fnlog(`Boost hash at ${inputs.branch}: ${boostHash}`);

    const moduleHashes: Record<string, string> = {};
    if (inputs.optimistic_caching) {
        // Optimistic caching: only modules and patches define the key
        // Pessimistic caching: we'll clone all modules, so we only need the
        // hash of the super-project
        for (const module of allModulesSorted) {
            const moduleRepoUrl = getModuleRepoUrl(module);
            const moduleRepoExists = await setup_program.urlExists(moduleRepoUrl);
            if (moduleRepoExists) {
                const moduleHash = await getGitHash(moduleRepoUrl, inputs.branch, gitFeatures);
                fnlog(`Hash for module ${module}: ${moduleHash}`);
                moduleHashes[module] = moduleHash;
            } else {
                moduleHashes[module] = boostHash;
            }
        }
    }

    const patchHashes: Record<string, string> = {};
    for (const patch of patchesSorted) {
        const patchHash = await getGitHash(patch, inputs.branch, gitFeatures);
        fnlog(`Hash for patch ${patch}: ${patchHash}`);
        patchHashes[patch] = patchHash;
    }

    const concatenatedHashes = Object.values(moduleHashes).join('') + Object.values(patchHashes).join('');
    const modulesAndPatchesHash = crypto.createHash('sha1').update(concatenatedHashes).digest('hex');
    fnlog(`Modules hash (direct dependencies and patches): ${modulesAndPatchesHash}`);

    const configHash = hashObject({
        branch: inputs.branch,
        modules: allModulesSorted,
        modules_scan_paths: toSortedArray(inputs.modules_scan_paths),
        modules_exclude_paths: toSortedArray(inputs.modules_exclude_paths),
        scan_modules_dir: toSortedArray(inputs.scan_modules_dir),
        scan_modules_ignore: toSortedArray(inputs.scan_modules_ignore),
        optimistic_caching: inputs.optimistic_caching
    });
    fnlog(`Configuration hash: ${configHash}`);

    // The cache key is composed of distinct SHA-1 fragments:
    // - boostHash: captures changes in the Boost super-project.
    // - modulesAndPatchesHash: captures hashes of explicitly requested modules and patches.
    // - configHash: captures every configuration knob that influences scanning behavior.
    // Each fragment encodes disjoint information so that changes in any dimension invalidate the key.
    const cacheKey =
        // No modules or patches specified, we'll clone all modules
        allModulesSorted.length === 0 && patchesSorted.length === 0 ?
            `boost-source-${boostHash}-${configHash}` :
            inputs.optimistic_caching ?
                // Optimistic caching: only modules and patches define the key
                `boost-source-${modulesAndPatchesHash}-${configHash}` :
                // Pessimistic caching with no patches: we'll clone all modules
                patchesSorted.length === 0 ?
                    `boost-source-${boostHash}-${configHash}` :
                    // Pessimistic caching with patches: invalidate cache
                    // when any module or patch changes
                    `boost-source-${boostHash}-${modulesAndPatchesHash}-${configHash}`;
    fnlog(`Cache key: ${cacheKey}`);

    if (options.logInfo) {
        core.info(`Caching mode: ${inputs.optimistic_caching ? 'optimistic' : 'pessimistic'}`);
        core.info(`Cache key fragments -> boost: ${boostHash}, modules+patches: ${modulesAndPatchesHash}, config: ${configHash}`);
        core.info(`Cache key: ${cacheKey}`);
    }

    const result: CacheKeyResult = { cacheKey, fragments: { boostHash, modulesAndPatchesHash, configHash } };
    return options.withFragments ? result : cacheKey;
}

/**
 * Attempts to restore Boost from the GitHub Actions cache.
 *
 * @param inputs - Action inputs containing the boost directory path
 * @param cacheKey - The cache key to look up
 * @returns True if cache was found and restored
 */
async function getCachedBoost(inputs: Inputs, cacheKey: string): Promise<boolean> {
    core.info(`Checking cache for key: ${cacheKey}`);
    const hit = await cache.restoreCache([inputs.boost_dir], cacheKey, []) !== undefined;
    if (hit) {
        core.info(`Cache hit! 🙂`);
    } else {
        core.info(`Cache miss! 😔`);
    }
    return hit;
}

/**
 * Saves the Boost installation to the GitHub Actions cache.
 *
 * @param inputs - Action inputs containing the boost directory path
 * @param cacheKey - The cache key to use for storage
 */
async function cacheBoost(inputs: Inputs, cacheKey: string): Promise<void> {
    await cache.saveCache([inputs.boost_dir], cacheKey, {});
}

/**
 * Clones the Boost super-project repository to the target directory.
 *
 * @param inputs - Action inputs containing branch and directory settings
 */
async function cloneBoostSuperproject(inputs: Inputs): Promise<void> {
    await setup_program.cloneGitRepo(boostSuperProjectRepo, inputs.boost_dir, inputs.branch);
}

/**
 * Extracts the repository name from a git URL.
 *
 * @param url - Git repository URL
 * @returns The repository name without path or extension
 */
function getRepoName(url: string): string {
    // Strip query parameters and fragment identifiers
    const cleanUrl = url.split(/[?#]/)[0];

    // Remove trailing slashes and the `.git` extension if present
    return cleanUrl.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop()!;
}

/**
 * Applies patch repositories by cloning them into the Boost libs directory.
 *
 * @param inputs - Action inputs containing patches and directory settings
 */
async function applyPatches(inputs: Inputs): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`applyPatches: ${msg}`);
    }

    for (const patch of inputs.patches) {
        const patchName = getRepoName(patch);
        const patchDir = path.join(inputs.boost_dir, 'libs', patchName);
        if (fs.existsSync(patchDir)) {
            fnlog(`Removing existing directory: ${patchDir}`);
            fs.rmdirSync(patchDir, { recursive: true });
        }
        await setup_program.cloneGitRepo(patch, patchDir, inputs.branch);
    }
}

/**
 * Returns the number of available CPU cores for parallel operations.
 *
 * @returns Number of CPU cores, minimum 1
 */
function numberOfCpus(): number {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    if (!result || result === 0) {
        return 1;
    }
    return result;
}

/**
 * Checks if a branch name is a Boost release tag (e.g., boost-1.87.0).
 *
 * @param branch - The branch name to check
 * @returns True if the branch is a release tag
 */
function isReleaseTag(branch: string): boolean {
    return /^boost-\d+\.\d+\.\d+$/.test(branch);
}

/**
 * Gets the latest release tag from precomputed data.
 *
 * @returns The latest release tag or null if no data available
 */
function getLatestRelease(): string | null {
    const depsData = boostDepsData as BoostDepsData;
    const releases = Object.keys(depsData.releases);
    if (releases.length === 0) {
        return null;
    }
    // Releases should already be sorted newest first
    return releases[0];
}

/**
 * Estimates the total number of modules (including transitive dependencies)
 * for a set of requested modules using precomputed data.
 *
 * @param requestedModules - Set of directly requested modules
 * @param releaseTag - Optional specific release tag to use (defaults to latest)
 * @returns Object with estimated total count and the full set of modules
 */
function estimateTotalModules(requestedModules: Set<string>, releaseTag?: string): {
    totalCount: number;
    allModules: Set<string>;
    fromPrecomputed: boolean;
} {
    const depsData = boostDepsData as BoostDepsData;
    const release = releaseTag || getLatestRelease();

    if (!release || !depsData.releases[release]) {
        // No precomputed data available, return just the requested modules
        return {
            totalCount: requestedModules.size,
            allModules: new Set(requestedModules),
            fromPrecomputed: false
        };
    }

    const releaseData = depsData.releases[release];
    const allModules = new Set<string>();

    for (const mod of requestedModules) {
        allModules.add(mod);
        const modData = releaseData.modules[mod];
        if (modData) {
            for (const dep of modData.transitive_deps) {
                allModules.add(dep);
            }
        }
    }

    return {
        totalCount: allModules.size,
        allModules,
        fromPrecomputed: true
    };
}

/**
 * Decides which clone strategy to use based on inputs and context.
 *
 * @param inputs - User inputs including strategy preference
 * @param estimatedModules - Estimated total module count
 * @returns The strategy to use ('git' or 'archive')
 */
function decideStrategy(inputs: Inputs, estimatedModules: number): 'git' | 'archive' {
    // If user explicitly requested a strategy, use it
    if (inputs.clone_strategy === 'git') {
        return 'git';
    }
    if (inputs.clone_strategy === 'archive') {
        if (!isReleaseTag(inputs.branch)) {
            core.warning(`Archive strategy requested but branch '${inputs.branch}' is not a release tag. Falling back to git.`);
            return 'git';
        }
        return 'archive';
    }

    // Auto mode: decide based on branch type and module count
    if (!isReleaseTag(inputs.branch)) {
        // develop/master: always use git (no archive available)
        return 'git';
    }

    // Release tag: use archive if module count exceeds threshold
    if (estimatedModules > inputs.archive_threshold) {
        core.info(`Estimated ${estimatedModules} modules exceeds threshold (${inputs.archive_threshold}), using archive strategy`);
        return 'archive';
    }

    return 'git';
}

/**
 * Gets the CMake release archive URL for a Boost release tag.
 *
 * @param releaseTag - The release tag (e.g., boost-1.87.0)
 * @returns The archive URL
 */
function getArchiveUrl(releaseTag: string): string {
    // CMake release format: boost-1.87.0-cmake.tar.xz
    return `https://github.com/boostorg/boost/releases/download/${releaseTag}/${releaseTag}-cmake.tar.xz`;
}

/**
 * Downloads and extracts a Boost release archive.
 *
 * @param archiveUrl - URL of the archive to download
 * @param targetDir - Directory to extract to
 */
async function downloadAndExtractArchive(archiveUrl: string, targetDir: string): Promise<void> {
    core.info(`Downloading archive from ${archiveUrl}...`);

    // Download the archive
    const archivePath = await tc.downloadTool(archiveUrl);
    core.info(`Downloaded to ${archivePath}`);

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true });

    // Extract the archive (tar.xz format)
    core.info(`Extracting to ${targetDir}...`);

    // Use tar to extract, stripping the first component (the boost-X.Y.Z-cmake directory)
    await exec.exec('tar', [
        '-xf', archivePath,
        '-C', targetDir,
        '--strip-components=1'
    ]);

    core.info('Archive extracted successfully');
}

/**
 * Batch-initializes all specified modules at once using precomputed dependency data.
 * This is more efficient than layer-by-layer discovery.
 *
 * @param inputs - User inputs
 * @param allModules - Complete set of modules to initialize (including transitive deps)
 * @param gitFeatures - Git capabilities
 */
async function batchInitializeSubmodules(
    inputs: Inputs,
    allModules: Set<string>,
    gitFeatures: GitFeatures
): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`batchInitializeSubmodules: ${msg}`);
    }

    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [];
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : [];
    const gitArgs = jobsArgs.concat(depthArgs).concat(['-q']);

    // Add essential modules
    const essentialModules = ['config', 'headers'];
    const essentialTools = ['tools/boost_install', 'tools/build', 'tools/cmake'];

    const allModulesWithEssentials = new Set(allModules);
    for (const mod of essentialModules) {
        allModulesWithEssentials.add(mod);
    }

    // Build list of all submodule paths to initialize
    const submodulePaths: string[] = [];
    for (const mod of allModulesWithEssentials) {
        submodulePaths.push(`libs/${mod}`);
    }
    for (const tool of essentialTools) {
        submodulePaths.push(tool);
    }

    fnlog(`Batch initializing ${submodulePaths.length} submodules`);
    core.info(`Initializing ${submodulePaths.length} submodules in batch mode`);

    // Initialize all submodules in one command with multiple paths
    // This is more efficient than individual commands
    for (const submodulePath of submodulePaths) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', submodulePath]);
        await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
    }

    fnlog('Batch initialization complete');
}

/**
 * Initializes Boost submodules using layer-by-layer dependency discovery.
 *
 * Starts with the requested modules, then recursively discovers and initializes
 * their dependencies by scanning header files.
 *
 * @param inputs - Action inputs containing directory and module settings
 * @param allModules - Initial set of modules to initialize
 * @param gitFeatures - Git executable capabilities
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 */
async function initializeSubmodules(inputs: Inputs, allModules: Set<string>, gitFeatures: GitFeatures, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`initializeSubmodules: ${msg}`);
    }

    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [];
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : [];
    const gitArgs = jobsArgs.concat(depthArgs).concat(['-q']);

    const allModulesSubPaths = new Set(Array.from(allModules).map((module) => `libs/${module}`));
    const essentialModuleSubPaths = new Set(['libs/config', 'libs/headers', 'tools/boost_install', 'tools/build', 'tools/cmake']);
    const initialModuleSubpaths = new Set(Array.from(allModulesSubPaths).concat(Array.from(essentialModuleSubPaths)));
    for (const moduleSubPath of initialModuleSubpaths) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath]);
        await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
    }

    const initializedModules = new Set(allModules);
    initializedModules.add('config');
    initializedModules.add('headers');
    const scannedModules = new Set<string>();
    const remainingModules = new Set(initializedModules);
    while (remainingModules.size > 0) {
        fnlog(`==== ${remainingModules.size} modules remaining to scan ====`);
        fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`);
        fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`);
        fnlog(`Scanned modules: ${gh_inputs.makeValueString(scannedModules)}`);

        const module = remainingModules.values().next().value as string;
        const modulePath = path.resolve(path.join(inputs.boost_dir, 'libs', module));
        const moduleInputs: Inputs = {
            ...inputs,
            scan_modules_ignore: new Set<string>([module]),
            modules_scan_paths: new Set<string>(),
            modules_exclude_paths: new Set<string>(['test', 'tests', 'example', 'examples'])
        };
        const submodules = await scanBoostDependencies(modulePath, moduleInputs, exceptions, submodulePaths);
        fnlog(`Submodules of ${module}: ${gh_inputs.makeValueString(submodules)}`);
        scannedModules.add(module);
        remainingModules.delete(module);

        // Initialize submodules
        for (const submodule of submodules) {
            // Add to the list if not scanned yet
            if (!scannedModules.has(submodule)) {
                fnlog(`Submodule: ${submodule} has not been scanned yet`);
                remainingModules.add(submodule);
                fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`);
            } else {
                fnlog(`Submodule: ${submodule} has already been scanned`);
            }
            // Initialize submodule if not initialized yet
            if (!initializedModules.has(submodule)) {
                fnlog(`Initializing submodule: ${submodule}`);
                const moduleSubPath = `libs/${submodule}`;
                const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath]);
                await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
                initializedModules.add(submodule);
                fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`);
            } else {
                fnlog(`Submodule: ${submodule} has already been initialized`);
            }
        }
    }
}


/**
 * Initializes all Boost submodules recursively.
 *
 * Used when no specific modules are requested and the entire Boost library is needed.
 *
 * @param inputs - Action inputs containing the boost directory
 * @param gitFeatures - Git executable capabilities
 */
async function initializeAllSubmodules(inputs: Inputs, gitFeatures: GitFeatures): Promise<void> {
    const args = ['submodule', 'update']
        .concat(gitFeatures.supportsDepth ? ['--depth', '1'] : [])
        .concat(gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [])
        .concat(['--init', '--recursive']);
    await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
}


/**
 * Clones the Boost super-project and initializes required submodules.
 *
 * Manages caching of the Boost installation, resolves module dependencies,
 * applies patches, and initializes git submodules for the specified modules.
 * Supports two strategies: git (clone + submodule init) and archive (download release tarball).
 *
 * @param inputs - Configuration inputs including branch, modules, patches, and cache settings
 * @returns Outputs including the Boost directory path
 */
export async function main(inputs: Inputs): Promise<Outputs> {
    function fnlog(msg: string): void {
        trace_commands.log(`main: ${msg}`);
    }

    const outputs: Outputs = { boost_dir: inputs.boost_dir };

    // Ensure cache path exists before interacting with the cache API
    fs.mkdirSync(inputs.boost_dir, { recursive: true });

    core.info(`Cache path: ${inputs.boost_dir}`);
    core.info(`Cache enabled: ${inputs.cache}`);
    core.info(`Optimistic caching: ${inputs.optimistic_caching}`);
    core.info(`Clone strategy: ${inputs.clone_strategy}`);
    core.info(`Archive threshold: ${inputs.archive_threshold}`);

    core.startGroup('📐 Identify git features');
    const gitFeatures = await findGitFeatures(inputs);
    core.endGroup();

    core.startGroup('🔑 Calculate Boost Cache Key');
    const { cacheKey: initialCacheKey } = await generateCacheKey(inputs, inputs.modules, gitFeatures, { logInfo: true, withFragments: true }) as CacheKeyResult;
    core.endGroup();
    let cacheKey = initialCacheKey;

    const cacheAvailable = inputs.cache && cache.isFeatureAvailable();
    if (inputs.cache && !cacheAvailable) {
        core.info('GitHub cache service unavailable; continuing without cache');
    }

    if (cacheAvailable) {
        core.startGroup('📦 Check Boost Cache');
        const cacheHit = await getCachedBoost(inputs, cacheKey);
        core.endGroup();
        if (cacheHit) {
            core.info('Cache hit: skipping downloads, scans, clone, and submodule init');
            return outputs;
        }
    } else if (!inputs.cache) {
        core.info('Caching disabled via input; proceeding without cache');
    }

    // Get gitmodules and exceptions (needed for scanning local deps)
    core.startGroup('🌍 Download .gitmodules and exceptions.txt');
    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${inputs.branch}/.gitmodules`;
    const gitmodulesPath = path.resolve(await tc.downloadTool(gitmodulesUrl));
    core.info(`Downloaded ${gitmodulesUrl} to ${gitmodulesPath}`);
    const submodulePaths = readGitmodules(gitmodulesPath);
    fnlog(`Submodule Paths: ${gh_inputs.makeValueString(submodulePaths)}`);

    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${inputs.branch}/depinst/exceptions.txt`;
    const exceptionsPath = path.resolve(await tc.downloadTool(exceptionsUrl));
    core.info(`Downloaded ${exceptionsUrl} to ${exceptionsPath}`);
    const exceptions = readExceptions(exceptionsPath);
    fnlog(`Exceptions: ${JSON.stringify(exceptions)}`);
    core.endGroup();

    // Scan local directories for required modules
    const directModules = new Set(inputs.modules);
    for (const scanDir of inputs.scan_modules_dir) {
        core.startGroup(`🔍 Scan Boost Modules Required by ${path.basename(scanDir)}`);
        const scannedModules = await scanBoostDependencies(scanDir, inputs, exceptions, submodulePaths);
        for (const module of scannedModules) {
            directModules.add(module);
        }
        core.endGroup();
    }

    // Estimate total modules using precomputed data
    core.startGroup('📊 Estimate Total Modules');
    const releaseForEstimate = isReleaseTag(inputs.branch) ? inputs.branch : undefined;
    const estimation = estimateTotalModules(directModules, releaseForEstimate);
    core.info(`Direct modules requested: ${directModules.size}`);
    core.info(`Estimated total modules (with transitive deps): ${estimation.totalCount}`);
    core.info(`Estimation from precomputed data: ${estimation.fromPrecomputed}`);
    core.endGroup();

    // Decide on strategy
    core.startGroup('🎯 Select Clone Strategy');
    const strategy = decideStrategy(inputs, estimation.totalCount);
    core.info(`Selected strategy: ${strategy}`);
    core.endGroup();

    // Recalculate cache key with full module set
    core.startGroup('🔑 Calculate Boost Cache Key');
    const allModulesForCache = estimation.fromPrecomputed ? estimation.allModules : directModules;
    cacheKey = await generateCacheKey(inputs, allModulesForCache, gitFeatures) as string;
    core.endGroup();

    // Execute the selected strategy
    if (strategy === 'archive') {
        // Archive strategy: download and extract the CMake release
        core.startGroup('📦 Download Boost Archive');
        const archiveUrl = getArchiveUrl(inputs.branch);
        try {
            await downloadAndExtractArchive(archiveUrl, inputs.boost_dir);
        } catch (error) {
            core.warning(`Archive download failed: ${error}. Falling back to git strategy.`);
            core.endGroup();
            // Fall through to git strategy
            await executeGitStrategy(inputs, directModules, estimation, gitFeatures, exceptions, submodulePaths);
        }
        core.endGroup();

        // Apply patches (git clone into libs/)
        if (inputs.patches.size > 0) {
            core.startGroup('🔨 Apply Boost Patches');
            await applyPatches(inputs);
            core.endGroup();
        }
    } else {
        // Git strategy
        await executeGitStrategy(inputs, directModules, estimation, gitFeatures, exceptions, submodulePaths);
    }

    // Cache boost
    if (cacheAvailable) {
        core.startGroup(`📦 Cache Boost`);
        core.info(`Saving cache for key: ${cacheKey}`);
        await cacheBoost(inputs, cacheKey);
        core.endGroup();
    } else if (inputs.cache) {
        core.info('Cache save skipped because cache service is unavailable');
    }

    return outputs;
}

/**
 * Executes the git clone strategy.
 *
 * @param inputs - User inputs
 * @param directModules - Directly requested modules (from user input + scanning)
 * @param estimation - Module estimation from precomputed data
 * @param gitFeatures - Git capabilities
 * @param exceptions - Header exceptions map
 * @param submodulePaths - Valid submodule paths
 */
async function executeGitStrategy(
    inputs: Inputs,
    directModules: Set<string>,
    estimation: { totalCount: number; allModules: Set<string>; fromPrecomputed: boolean },
    gitFeatures: GitFeatures,
    exceptions: Record<string, string>,
    submodulePaths: Set<string>
): Promise<void> {
    // Clone boost super-project
    core.startGroup('🚀 Clone Boost Super-project');
    await cloneBoostSuperproject(inputs);
    core.endGroup();

    // Apply patches
    if (inputs.patches.size > 0) {
        core.startGroup('🔨 Apply Boost Patches');
        await applyPatches(inputs);
        core.endGroup();
    }

    // Initialize submodules
    // Check if we have precomputed dependencies for this exact release tag
    const depsData = boostDepsData as BoostDepsData;
    const hasPrecomputedDepsForBranch = isReleaseTag(inputs.branch) && inputs.branch in depsData.releases;

    if (directModules.size === 0) {
        // No specific modules requested, initialize all
        core.startGroup('🔧 Initialize All Boost Submodules');
        await initializeAllSubmodules(inputs, gitFeatures);
        core.endGroup();
    } else if (hasPrecomputedDepsForBranch && estimation.totalCount > 0) {
        // We have precomputed transitive deps for this exact release tag, use batch initialization.
        // Only use batch init for exact release tags (e.g., boost-1.87.0) where we have
        // precomputed dependencies in boost-deps.json. For branches like 'develop' or 'master',
        // or release tags not in our precomputed data, we must use layer-by-layer discovery.
        core.startGroup('🔧 Batch Initialize Boost Submodules');
        core.info(`Using precomputed dependencies for batch initialization`);
        await batchInitializeSubmodules(inputs, estimation.allModules, gitFeatures);
        core.endGroup();
    } else {
        // No precomputed data for this branch, use layer-by-layer discovery
        core.startGroup('🔧 Initialize Boost Submodules');
        core.info(`Using layer-by-layer dependency discovery`);
        await initializeSubmodules(inputs, directModules, gitFeatures, exceptions, submodulePaths);
        core.endGroup();
    }
}

/**
 * Entry point for the GitHub Action.
 *
 * Parses action inputs, validates configuration, and orchestrates the
 * boost-clone workflow including caching, cloning, and submodule initialization.
 */
async function run(): Promise<void> {
    const cloneStrategyInput = gh_inputs.getInput('clone-strategy', { defaultValue: 'auto' }) || 'auto';
    const validStrategies: CloneStrategy[] = ['auto', 'git', 'archive'];
    const cloneStrategy: CloneStrategy = validStrategies.includes(cloneStrategyInput as CloneStrategy)
        ? (cloneStrategyInput as CloneStrategy)
        : 'auto';

    const inputs: Inputs = {
        boost_dir: gh_inputs.getInput('boost-dir') || '',
        branch: gh_inputs.getInput('branch', { defaultValue: 'master' }) || 'master',
        // Modules to clone
        modules: new Set([...gh_inputs.getSet('modules')].filter((m): m is string => m !== undefined)),
        patches: new Set([...gh_inputs.getSet('patches')].filter((p): p is string => p !== undefined)),
        scan_modules_ignore: new Set([...gh_inputs.getSet('scan-modules-ignore')].filter((s): s is string => s !== undefined)),
        // Paths to scan
        scan_modules_dir: new Set(gh_inputs.getMultilineInput('scan-modules-dir').filter((d): d is string => d !== undefined)),
        modules_scan_paths: new Set([...gh_inputs.getSet('modules-scan-paths')].filter((m): m is string => m !== undefined)),
        modules_exclude_paths: new Set([...gh_inputs.getSet('modules-exclude-paths')].filter((m): m is string => m !== undefined)),
        // Caching
        cache: gh_inputs.getBoolean('cache', { defaultValue: true }),
        optimistic_caching: gh_inputs.getBoolean('optimistic-caching', { defaultValue: false }),
        trace_commands: gh_inputs.getBoolean('trace-commands', { defaultValue: false }),
        // Strategy
        clone_strategy: cloneStrategy,
        archive_threshold: parseInt(gh_inputs.getInput('archive-threshold', { defaultValue: '25' }) || '25', 10)
    };

    // Remove any empty entry from scan_modules_dir
    inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].filter((dir) => dir.trim() !== ''));
    // Resolve scan modules dir
    inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].map((dir) => path.resolve(dir)));

    // If Boost dir is not provided, we will use a temporary directory
    // for it. This directory will be returned as an output.
    if (!inputs.boost_dir) {
        const pathSuffix = `boost-${inputs.branch}`;
        inputs.boost_dir = path.join(os.tmpdir(), pathSuffix);
    }
    inputs.boost_dir = path.resolve(inputs.boost_dir);

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs);

    // Parse Final program / Setup version / Outputs
    if (outputs.boost_dir) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot clone Boost');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: 'Boost clone failed'
            });
        }
    })();
}

export { generateCacheKey };
