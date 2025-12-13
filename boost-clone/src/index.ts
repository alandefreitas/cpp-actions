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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git';

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
}

interface Outputs {
    boost_dir: string;
}

interface GitFeatures {
    gitPath: string;
    version: semver.SemVer;
    supportsJobs: boolean;
    supportsScanScripts: boolean;
    supportsDepth: boolean;
}

interface CacheKeyFragments {
    boostHash: string;
    modulesAndPatchesHash: string;
    configHash: string;
}

interface CacheKeyResult {
    cacheKey: string;
    fragments: CacheKeyFragments;
}

interface GenerateCacheKeyOptions {
    logInfo?: boolean;
    withFragments?: boolean;
}

function toSortedArray(iterable: Iterable<string> | null | undefined): string[] {
    if (!iterable) {
        return [];
    }
    return Array.from(iterable).map((value) => value).sort();
}

function hashObject(value: unknown): string {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

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

function readExceptions(exceptionsPath: string): Record<string, string> {
    function fnlog(msg: string): void {
        trace_commands.log(`readExceptions: ${msg}`);
    }

    // exceptions.txt is the output of "boostdep --list-exceptions"
    // It includes headers that cannot be associated to a module
    // following the usual `boost/<module>/path` rules.
    fnlog(`Reading exceptions from ${exceptionsPath}`);
    const exceptions: Record<string, string> = {};
    let module: string | null = null;
    if (!fs.existsSync(exceptionsPath)) {
        throw new Error(`Exceptions file not found: ${exceptionsPath}`);
    }
    const lines = fs.readFileSync(exceptionsPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        const match = trimmedLine.match(/(.*):$/);
        if (match) {
            // Line contains a module name
            module = match[1].replace('~', '/');
        } else {
            // Line contains an exception for the current module
            if (module !== null) {
                exceptions[trimmedLine] = module;
            }
        }
    }
    return exceptions;
}

function readGitmodules(gitmodulesPath: string): Set<string> {
    const submodulePaths = new Set<string>();
    if (!fs.existsSync(gitmodulesPath)) {
        throw new Error(`.gitmodules file not found: ${gitmodulesPath}`);
    }
    const lines = fs.readFileSync(gitmodulesPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        // Look for lines such as "path = libs/algorithm"
        const match = trimmedLine.match(/path\s*=\s*(.*)$/);
        if (match) {
            submodulePaths.add(match[1]);
        }
    }
    return submodulePaths;
}

function isModule(moduleName: string, submodulePaths: Set<string>): boolean {
    return submodulePaths.has(`libs/${moduleName}`);
}

const loggedHeaders = new Set<string>();

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

async function getGitHash(repoUrl: string, branch: string, gitFeatures: GitFeatures): Promise<string> {
    const { exitCode, stdout } = await exec.getExecOutput(`"${gitFeatures.gitPath}"`, [
        'ls-remote', repoUrl, branch]);
    if (exitCode !== 0) {
        throw new Error(`Failed to get hash for ${repoUrl} at branch ${branch}`);
    }
    return stdout.trim().split('\t')[0];
}

function getModuleRepoUrl(module: string): string {
    return `https://github.com/boostorg/${module.replace('/', '_')}.git`;
}

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

async function cacheBoost(inputs: Inputs, cacheKey: string): Promise<void> {
    await cache.saveCache([inputs.boost_dir], cacheKey, {});
}

async function cloneBoostSuperproject(inputs: Inputs): Promise<void> {
    await setup_program.cloneGitRepo(boostSuperProjectRepo, inputs.boost_dir, inputs.branch);
}

function getRepoName(url: string): string {
    // Strip query parameters and fragment identifiers
    const cleanUrl = url.split(/[?#]/)[0];

    // Remove trailing slashes and the `.git` extension if present
    return cleanUrl.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop()!;
}

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

function numberOfCpus(): number {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    if (!result || result === 0) {
        return 1;
    }
    return result;
}

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


async function initializeAllSubmodules(inputs: Inputs, gitFeatures: GitFeatures): Promise<void> {
    const args = ['submodule', 'update']
        .concat(gitFeatures.supportsDepth ? ['--depth', '1'] : [])
        .concat(gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [])
        .concat(['--init', '--recursive']);
    await exec.exec(`"${gitFeatures.gitPath}"`, args, { cwd: inputs.boost_dir });
}


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

    // Get gitmodules and exceptions
    core.startGroup('🌍 Download .gitmodules and exceptions.txt');
    // .gitmodules
    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${inputs.branch}/.gitmodules`;
    const gitmodulesPath = path.resolve(await tc.downloadTool(gitmodulesUrl));
    core.info(`Downloaded ${gitmodulesUrl} to ${gitmodulesPath}`);
    const submodulePaths = readGitmodules(gitmodulesPath);
    fnlog(`Submodule Paths: ${gh_inputs.makeValueString(submodulePaths)}`);

    // exceptions.txt
    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${inputs.branch}/depinst/exceptions.txt`;
    const exceptionsPath = path.resolve(await tc.downloadTool(exceptionsUrl));
    core.info(`Downloaded ${exceptionsUrl} to ${exceptionsPath}`);
    const exceptions = readExceptions(exceptionsPath);
    fnlog(`Exceptions: ${JSON.stringify(exceptions)}`);
    core.endGroup();

    const allModules = new Set(inputs.modules);
    for (const scanDir of inputs.scan_modules_dir) {
        core.startGroup(`🔍 Scan Boost Modules Required by ${path.basename(scanDir)}`);
        const scannedModules = await scanBoostDependencies(scanDir, inputs, exceptions, submodulePaths);
        for (const module of scannedModules) {
            allModules.add(module);
        }
        core.endGroup();
    }

    core.startGroup('🔑 Calculate Boost Cache Key');
    cacheKey = await generateCacheKey(inputs, allModules, gitFeatures) as string;
    core.endGroup();

    // Clone boost
    core.startGroup('🚀 Clone Boost Super-project');
    await cloneBoostSuperproject(inputs);
    core.endGroup();

    // Apply patches
    if (inputs.patches.size > 0) {
        core.startGroup('🔨 Apply Boost Patches');
        await applyPatches(inputs);
        core.endGroup();
    }

    if (allModules.size === 0) {
        core.startGroup('🔧 Initialize All Boost Submodules');
        await initializeAllSubmodules(inputs, gitFeatures);
        core.endGroup();
    } else {
        core.startGroup('🔧 Initialize Boost Submodules');
        await initializeSubmodules(inputs, allModules, gitFeatures, exceptions, submodulePaths);
        core.endGroup();
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

let lastInputsForErrors: Inputs | undefined = undefined;

async function run(): Promise<void> {
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
        trace_commands: gh_inputs.getBoolean('trace-commands', { defaultValue: false })
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

    lastInputsForErrors = inputs;

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
            const capturedInputs = lastInputsForErrors as Inputs | undefined;
            const hint = capturedInputs?.trace_commands
                ? 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
                : 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            await reportAndSetFailed(error as Error, {
                title: 'Boost clone failed',
                hint,
                locals: () => ({ inputs: capturedInputs }),
                includeStackInSetFailed: true
            });
        }
    })();
}

export { generateCacheKey };
