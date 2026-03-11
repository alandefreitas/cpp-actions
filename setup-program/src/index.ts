import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as httpm from '@actions/http-client';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import gccDefaultTags from '../gcc-tags.json';
import clangDefaultTags from '../clang-tags.json';
import cmakeDefaultTags from '../cmake-tags.json';
import ubuntuVersionNames from '../ubuntu-versions.json';

import {
    type ProgramResult,
    type ExecOutput,
    type SetupProgramInputs,
    PackagePreferenceTier,
    type FetchGitTagsOptions,
    type CloneGitRepoOptions,
    type AptPackageMatch
} from './types';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

import {
    escapeRegExp,
    removeSemverLeadingZeros,
    renderTemplate,
    getRunnerOs,
    sleep,
    normalizeArchitectureInput
} from './utils';

// Re-export for consumers (b2-workflow, cmake-workflow)
export { normalizeArchitectureInput };

import {
    readVersionsFromFile,
    saveVersionsToFile
} from './version-cache';

import {
    getAllSubdirectories,
    isSymlink,
    copySymlink
} from './file-utils';

import {
    downloadAndExtract,
    stripSingleDirectoryFromPath
} from './download-utils';

import {
    findProgramInPath,
    findProgramInPaths,
    findProgramInSystemPaths
} from './program-search';

// Re-export types for external consumers
export { PackagePreferenceTier } from './types';

// Re-export version cache functions for external consumers
export { setVersionsCacheDir, resolveVersionsCachePath, readVersionsFromFile, saveVersionsToFile } from './version-cache';

// Re-export download utilities for external consumers
export { downloadAndExtract, stripSingleDirectoryFromPath } from './download-utils';

// Re-export program search functions for external consumers
export { findProgramInPath, findProgramInSystemPaths } from './program-search';

/**
 * Determines the preference tier for an APT package based on its name.
 *
 * Packages are categorized into tiers to prefer system-integrated packages
 * over standalone versioned packages when both satisfy version requirements.
 *
 * @param packageName - The APT package name (e.g., "clang", "clang-14", "clang-14-tools")
 * @param baseNames - The base program names being searched for (e.g., ["clang", "clang++"])
 * @returns The preference tier for the package
 */
export function getPackagePreferenceTier(packageName: string, baseNames: string[]): PackagePreferenceTier {
    // Check if package name exactly matches any base name (unversioned)
    for (const baseName of baseNames) {
        if (packageName === baseName) {
            return PackagePreferenceTier.UNVERSIONED;
        }
    }

    // Check if package name is base name followed by version only (raw versioned)
    // e.g., "clang-14", "gcc-12", "cmake-3.24"
    for (const baseName of baseNames) {
        const rawVersionedRegex = new RegExp(`^${escapeRegExp(baseName)}-[0-9.]+$`);
        if (rawVersionedRegex.test(packageName)) {
            return PackagePreferenceTier.RAW_VERSIONED;
        }
    }

    // Everything else is other versioned (e.g., "clang-14-tools", "clang-format-14")
    return PackagePreferenceTier.OTHER_VERSIONED;
}

/**
 * Determines whether sudo is required for privileged operations.
 *
 * Returns true on Linux when the current process is not running as root.
 *
 * @returns True if sudo is needed, false otherwise
 */
export function isSudoRequired(): boolean {
    if (process.platform !== 'linux') {
        return false;
    }
    return process.getuid?.() !== 0;
}

/**
 * Executes a command, prepending sudo if required on Linux.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Execution options passed to exec.exec
 * @returns The exit code from the command
 */
export async function execWithSudo(
    command: string,
    args: string[] = [],
    options: exec.ExecOptions = {}
): Promise<number> {
    if (isSudoRequired()) {
        return await exec.exec('sudo', ['-n', command, ...args], options);
    }
    return await exec.exec(command, args, options);
}

/**
 * Executes a command with output capture, prepending sudo if required on Linux.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Execution options passed to exec.getExecOutput
 * @returns The execution output including exit code, stdout, and stderr
 */
export async function getExecOutputWithSudo(
    command: string,
    args: string[] = [],
    options: exec.ExecOptions = {}
): Promise<ExecOutput> {
    if (isSudoRequired()) {
        return await exec.getExecOutput('sudo', ['-n', command, ...args], options);
    }
    return await exec.getExecOutput(command, args, options);
}

/**
 * Checks if a URL exists by sending a HEAD request.
 *
 * @param url - The URL to check
 * @returns True if the URL returns HTTP 200, false otherwise
 */
export async function urlExists(url: string): Promise<boolean> {
    const httpClient = new httpm.HttpClient('setup-clang', [], {
        allowRetries: true, maxRetries: 3
    });
    try {
        const res = await httpClient.head(url);
        return res.message.statusCode === 200;
    } catch {
        return false;
    }
}

// Re-export AptPackageMatch for external consumers
export { AptPackageMatch } from './types';

/**
 * Searches APT repositories for packages matching the specified names and version.
 *
 * Queries apt-cache to find available packages and their versions, then filters
 * and ranks results based on version requirements and package naming preferences.
 *
 * @param names - Array of package/executable names to search for (e.g., ["clang", "clang++"])
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns The best matching package info, or null if no match found
 * @throws Error if apt-cache search or showpkg commands fail
 */
export async function searchAptPackages(
    names: string[],
    version: string,
    checkLatest: boolean
): Promise<AptPackageMatch | null> {
    const fnlog = traceCommands.scoped('searchAptPackages');

    // Search for matching package names
    const packageNames: string[] = [];
    for (const name of names) {
        const searchExpression = `${escapeRegExp(name)}(-[0-9\\.]+)?`;
        fnlog(`Searching for packages matching ${searchExpression}`);
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['search', `^${searchExpression}$`]);
        if (output.exitCode !== 0) {
            throw new Error(`Failed to run apt-cache search. Exit code ${output.exitCode}`);
        }
        fnlog(`apt-cache search. Exit code ${output.exitCode}`);
        const aptOutput = output.stdout.trim();
        const aptLines = aptOutput.split('\n');
        for (const aptLine of aptLines) {
            const aptLineRegex = new RegExp(`^(${searchExpression}) `);
            const aptLineMatches = aptLine.match(aptLineRegex);
            if (aptLineMatches !== null) {
                packageNames.push(aptLineMatches[1]);
            }
        }
    }
    fnlog(`Found packages [${packageNames.join(', ')}]`);

    // Find the best matching package and version
    fnlog(`Listing all versions of packages [${packageNames.join(', ')}]`);
    let bestMatch: AptPackageMatch | null = null;
    const installMatches: string[] = [];

    for (const packageName of packageNames) {
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['showpkg', packageName], { silent: true });
        if (output.exitCode !== 0) {
            throw new Error(`Failed to run "apt-cache showpkg '${packageName}'"`);
        }
        if (output.stdout.trim() === '') {
            fnlog('No output from apt-cache showpkg ' + packageName);
            continue;
        }

        const showpkgLines = output.stdout.trim().split('\n');
        const dependenciesIndex = showpkgLines.findIndex((line) => line.startsWith('Dependencies:'));
        if (dependenciesIndex === -1) {
            continue;
        }
        let providesIndex = showpkgLines.findIndex((line) => line.startsWith('Provides:'));
        if (providesIndex === -1) {
            providesIndex = showpkgLines.length;
        }
        const dependenciesLines = showpkgLines.slice(dependenciesIndex + 1, providesIndex);
        const packageVersions = dependenciesLines.map((line) => line.split(' ')[0]);
        fnlog(`Package ${packageName} has APT versions [${packageVersions.join(', ')}]`);

        const pkgTier = getPackagePreferenceTier(packageName, names);
        fnlog(`Package ${packageName} has preference tier ${pkgTier}`);

        // Check each version against requirements
        for (const packageVersion of packageVersions) {
            const versionRegexes = [/\d+:(\d+.\d+)-\d+/, /\d+:(\d+)-\d+/, /(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
            for (const versionRegex of versionRegexes) {
                const versionMatches = packageVersion.match(versionRegex);
                if (versionMatches !== null) {
                    const pkgVersionStr = removeSemverLeadingZeros(versionMatches[1]);
                    const pkgVersion = semver.coerce(pkgVersionStr);
                    const satisfies = pkgVersion !== null ? semver.satisfies(pkgVersion, version) : true;

                    if (!satisfies) {
                        fnlog(`Package ${packageName}=${packageVersion} version ${pkgVersion} does NOT satisfy ${names.join(', ')} version ${version}`);
                    } else if (pkgVersion !== null) {
                        installMatches.push(`${packageName}=${packageVersion}`);

                        const isBetterTier = bestMatch === null || pkgTier < bestMatch.tier;
                        const isSameTier = bestMatch !== null && pkgTier === bestMatch.tier;
                        const isBetterVersion = bestMatch !== null &&
                            ((checkLatest && semver.gt(pkgVersion, bestMatch.semverVersion)) ||
                             (!checkLatest && semver.lt(pkgVersion, bestMatch.semverVersion)));
                        const isFirstMatch = bestMatch === null;

                        if (isFirstMatch || isBetterTier || (isSameTier && isBetterVersion)) {
                            fnlog(`Package ${packageName}=${packageVersion} version ${pkgVersion} (tier ${pkgTier}) selected as best match for ${names.join(', ')} version ${version}`);
                            bestMatch = {
                                packageName: packageName,
                                packageVersion: packageVersion,
                                semverVersion: pkgVersion.toString(),
                                tier: pkgTier,
                                alternatives: installMatches
                            };
                        }
                    }
                    break;
                }
            }
        }
    }

    // Update alternatives in the final result
    if (bestMatch !== null) {
        bestMatch.alternatives = installMatches;
    }

    return bestMatch;
}

/**
 * Options for APT package installation.
 */
export interface AptInstallOptions {
    /** Try aptitude as fallback if apt-get fails */
    tryAptitude?: boolean;
    /** Try alternative packages if primary install fails */
    tryAlternatives?: boolean;
}

/**
 * Installs a package using the APT package manager.
 *
 * Attempts installation with apt-get, optionally falling back to aptitude
 * for better dependency resolution, and can try alternative package versions.
 *
 * @param packageName - The package name to install
 * @param packageVersion - Optional specific version string (e.g., "1:14.0.0-1ubuntu1")
 * @param alternatives - Alternative "package=version" strings to try if primary fails
 * @param options - Installation options
 * @returns The name of the successfully installed package, or null if installation failed
 */
export async function installProgramWithApt(
    packageName: string,
    packageVersion: string | null = null,
    alternatives: string[] = [],
    options: AptInstallOptions = {}
): Promise<string | null> {
    const fnlog = traceCommands.scoped('installProgramWithApt');

    const { tryAptitude = true, tryAlternatives = true } = options;

    const installPkg = packageVersion !== null
        ? `${packageName}=${packageVersion}`
        : packageName;

    fnlog(`Installing ${installPkg}`);
    const execOpts: exec.ExecOptions = {
        env: {
            DEBIAN_FRONTEND: 'noninteractive',
            TZ: 'Etc/UTC',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        },
        ignoreReturnCode: true
    };

    // Try apt-get install
    let exitCode = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', installPkg], execOpts);
    if (exitCode === 0) {
        return packageName;
    }

    fnlog(`Failed to install ${installPkg}. Exit code: ${exitCode}`);

    // Try aptitude as fallback
    if (tryAptitude) {
        let aptitudePath: string | null;
        try {
            aptitudePath = await io.which('aptitude');
        } catch {
            aptitudePath = null;
        }

        if (aptitudePath) {
            fnlog('Retrying with aptitude for better dependency resolution');
            exitCode = await execWithSudo('aptitude', ['install', '-f', '-y', installPkg], execOpts);
            if (exitCode === 0) {
                return packageName;
            }
            fnlog(`aptitude also failed. Exit code: ${exitCode}`);
        } else {
            fnlog('aptitude unavailable');
        }
    }

    // Try alternative packages
    if (tryAlternatives && alternatives.length > 0) {
        fnlog(`Trying alternative packages [${alternatives.join(', ')}]`);
        for (const altPkg of alternatives) {
            exitCode = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', altPkg], execOpts);
            if (exitCode === 0) {
                // Extract package name from "package=version" format
                return altPkg.split('=')[0];
            }
        }
    }

    return null;
}

/**
 * Checks if APT package manager is available on the system.
 *
 * @returns True if APT is available and working, false otherwise
 */
export async function isAptAvailable(): Promise<boolean> {
    try {
        const exitCode = await exec.exec('apt', ['--version'], { silent: true });
        return exitCode === 0;
    } catch {
        return false;
    }
}

/**
 * Updates APT package lists.
 *
 * Runs apt-get update with appropriate sudo privileges if needed.
 */
export async function updateAptPackageLists(): Promise<void> {
    await execWithSudo('apt-get', ['update'], { ignoreReturnCode: true });
}

/**
 * Searches for and installs a program using APT package manager on Linux.
 *
 * This is the high-level orchestration function that:
 * 1. Checks if APT is available
 * 2. Updates package lists
 * 3. Searches for matching packages via {@link searchAptPackages}
 * 4. Installs the best match via {@link installProgramWithApt}
 * 5. Locates the installed executable
 *
 * For direct package installation without searching, use {@link installProgramWithApt} directly.
 *
 * @param names - Array of package/executable names to search for
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function findProgramWithApt(names: string[], version: string, checkLatest: boolean): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('findProgramWithApt');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;
    let installedPackage: string | null = null;

    // Check APT availability
    fnlog('Checking if APT is available');
    if (!await isAptAvailable()) {
        fnlog('APT is not available');
        return { outputVersion, outputPath, installedPackage };
    }

    try {
        // Update package lists
        fnlog(`Searching for ${names.join(', ')} with APT`);
        await updateAptPackageLists();

        // Search for matching packages
        const match = await searchAptPackages(names, version, checkLatest);
        if (match === null) {
            fnlog(`No matching package found for ${names.join(', ')} version ${version}`);
            return { outputVersion, outputPath, installedPackage };
        }

        fnlog(`Best match: ${match.packageName}=${match.packageVersion} (version ${match.semverVersion}, tier ${match.tier})`);

        // Install the package
        installedPackage = await installProgramWithApt(
            match.packageName,
            match.packageVersion,
            match.alternatives
        );

        if (installedPackage !== null) {
            // Locate the installed executable
            const result = await findProgramInSystemPaths([], names, version, checkLatest);
            outputVersion = result.outputVersion;
            outputPath = result.outputPath;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
    }

    // Log results
    if (outputPath !== null) {
        fnlog(`Program found: ${outputPath}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (outputVersion !== null) {
        fnlog(`Package version found ${outputVersion}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (installedPackage !== null) {
        fnlog(`Installed package: ${installedPackage}`);
    }

    return { outputVersion, outputPath, installedPackage };
}

/**
 * Locates or installs Git on the system.
 *
 * First attempts to find Git in PATH. If not found on Linux, installs it via APT.
 *
 * @returns Path to the Git executable, or null if not found/installed
 */
export async function findGit(): Promise<string | null> {
    let gitPath: string;
    try {
        gitPath = await io.which('git');
    } catch {
        gitPath = '';
    }
    if (gitPath === '') {
        // Try to install git via APT
        await updateAptPackageLists();
        await installProgramWithApt('git', null, [], { tryAptitude: false, tryAlternatives: false });
        try {
            gitPath = await io.which('git');
        } catch {
            return null;
        }
    }
    return gitPath || null;
}

/**
 * Fetches all tags from a Git repository.
 *
 * Uses `git ls-remote --tags` to retrieve tags without cloning the entire repository.
 * Implements exponential backoff retry logic for transient network failures.
 *
 * @param repo - Git repository URL (e.g., "https://github.com/llvm/llvm-project")
 * @param options - Configuration options for retries and fallback tags
 * @returns Array of tag reference strings (e.g., ["refs/tags/v1.0.0"])
 * @throws Error if max retries reached and no default tags provided
 */
export async function fetchGitTags(repo: string, options: FetchGitTagsOptions = {}): Promise<string[]> {
    const { maxRetries = 10, defaultTags = [] } = options;
    try {
        // Find git in PATH
        let gitPath: string | null = null;
        try {
            gitPath = await findGit();
        } catch {
            gitPath = null;
        }
        // Install git if we have to
        if (!gitPath) {
            await findProgramWithApt(['git'], '*', true);
            gitPath = await findGit();
        }
        // Still no git? Fail
        if (!gitPath) {
            if (defaultTags.length > 0) {
                return defaultTags;
            }
            throw new Error('Git not found');
        }
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const args = ['ls-remote', '--tags', repo];
                const {
                    exitCode, stdout
                }: ExecOutput = await exec.getExecOutput(`"${gitPath}"`, args, { silent: true });
                if (exitCode !== 0) {
                    throw new Error('Git exited with non-zero exit code: ' + exitCode);
                }
                const stdoutTrimmed = stdout.trim();
                const tags = stdoutTrimmed.split('\n').filter(tag => tag.trim() !== '');
                const gitTags: string[] = [];
                for (const tag of tags) {
                    const parts = tag.split('\t');
                    if (parts.length > 1) {
                        const ref = parts[1];
                        if (!ref.endsWith('^{}')) {
                            gitTags.push(ref);
                        }
                    }
                }
                traceCommands.log('Git tags: ' + gitTags);
                return gitTags;
            } catch (error) {
                if (attempt < maxRetries) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    traceCommands.log('Error fetching Git tags: ' + errorMessage);
                    traceCommands.log(`Attempt ${attempt} of ${maxRetries}`);
                    // Exponential backoff
                    const delay = Math.max(60000, Math.pow(2, attempt - 1) * 1000);
                    traceCommands.log(`Retrying in ${delay} milliseconds...`);
                    await sleep(delay);
                } else {
                    if (defaultTags.length > 0) {
                        traceCommands.log('Using default tags: ' + defaultTags);
                        return defaultTags;
                    } else {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        throw new Error('Max retries reached. Error fetching Git tags: ' + errorMessage);
                    }
                }
            }
        }
        return defaultTags;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error('Error fetching Git tags: ' + errorMessage);
    }
}

/**
 * Extracts version numbers from Git repository tags.
 *
 * First checks for cached versions in a local file. If not found, fetches tags
 * from the repository and extracts versions using the provided regex pattern.
 * Results are cached to the file for future use.
 *
 * @param name - Human-readable name for logging (e.g., "GCC", "Clang")
 * @param repo - Git repository URL to fetch tags from
 * @param file - Cache filename to store/retrieve versions
 * @param regex - Regular expression with capture group for version extraction
 * @param defaultTags - Fallback tags if fetching fails
 * @returns Array of version strings sorted by semver
 */
export async function findVersionsFromTags(name: string, repo: string, file: string, regex: RegExp, defaultTags: string[] = []): Promise<string[]> {
    const versionsFromFile = readVersionsFromFile(file);
    if (versionsFromFile !== null) {
        traceCommands.log(`${name} versions (from file): ` + versionsFromFile);
        return versionsFromFile;
    }
    const tags = await fetchGitTags(repo, {
        maxRetries: 3,
        defaultTags
    });
    let versions: string[] = [];
    for (const tag of tags) {
        if (tag.match(regex)) {
            const match = tag.match(regex);
            if (match && match[1]) {
                const version = match[1];
                versions.push(version);
            }
        }
    }
    versions = versions.sort(semver.compare);
    traceCommands.log(`${name} versions: ` + versions);
    saveVersionsToFile(versions, file);
    return versions;
}

/**
 * Retrieves available GCC compiler versions from the official GCC Git repository.
 *
 * @returns Array of GCC version strings (e.g., ["10.3.0", "11.2.0", "12.1.0"])
 */
export async function findGCCVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'GCC',
        'git://gcc.gnu.org/git/gcc.git',
        'gcc-versions.txt',
        /^refs\/tags\/releases\/gcc-(\d+\.\d+\.\d+)$/,
        gccDefaultTags);
}

/**
 * Retrieves available Clang compiler versions from the LLVM GitHub repository.
 *
 * @returns Array of Clang version strings (e.g., ["14.0.0", "15.0.0", "16.0.0"])
 */
export async function findClangVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'Clang',
        'https://github.com/llvm/llvm-project',
        'clang-versions.txt',
        /^refs\/tags\/llvmorg-(\d+\.\d+\.\d+)$/,
        clangDefaultTags);
}

/**
 * Retrieves available CMake versions from the Kitware GitHub repository.
 *
 * @returns Array of CMake version strings (e.g., ["3.24.0", "3.25.0", "3.26.0"])
 */
export async function findCMakeVersions(): Promise<string[]> {
    return await findVersionsFromTags(
        'CMake',
        'https://github.com/Kitware/CMake.git',
        'cmake-versions.txt',
        /^refs\/tags\/v(\d+\.\d+\.\d+)$/,
        cmakeDefaultTags);
}

/**
 * Clones a Git repository to a local directory.
 *
 * Supports cloning by branch/tag name or by commit hash. When cloning by hash,
 * uses init/fetch/checkout workflow instead of direct clone.
 *
 * @param repo - Git repository URL to clone
 * @param destPath - Local directory path for the cloned repository
 * @param ref - Optional branch, tag, or commit hash to checkout
 * @param options - Clone options (shallow clone by default)
 * @throws Error if Git is not available or cloning fails
 */
export async function cloneGitRepo(repo: string, destPath: string, ref: string | undefined = undefined, options: CloneGitRepoOptions = { shallow: true }): Promise<void> {
    try {
        const gitPath = await findGit();
        if (!gitPath) {
            throw new Error('Git not found');
        }
        // Clean the destPath
        if (fs.existsSync(destPath)) {
            await io.rmRF(destPath);
        }

        const refIsHash = ref ? /^[0-9a-f]{40}$/.test(ref) : false;
        if (!refIsHash) {
            // Clone the repository with the specified reference
            const args: string[] = [];
            args.push('clone');
            args.push(repo);
            args.push(destPath);
            if (options.shallow) {
                args.push('--depth');
                args.push('1');
            }
            if (ref) {
                args.push('--branch');
                args.push(ref);
            }
            await exec.exec(`"${gitPath}"`, args);
        } else {
            // Reference is a commit hash: init and checkout
            await io.rmRF(destPath);
            await io.mkdirP(destPath);
            await exec.exec(`"${gitPath}"`, ['config', '--global', 'init.defaultBranch', 'master'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['config', '--global', 'advice.detachedHead', 'false'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['init'], { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['remote', 'add', 'origin', repo], { cwd: destPath });
            const args: string[] = ['fetch'];
            if (options.shallow) {
                args.push('--depth');
                args.push('1');
            }
            args.push('origin');
            if (ref) {
                args.push(ref);
            }
            await exec.exec(`"${gitPath}"`, args, { cwd: destPath });
            await exec.exec(`"${gitPath}"`, ['checkout', 'FETCH_HEAD'], { cwd: destPath });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error('Error cloning Git repository: ' + errorMessage);
    }
}

/**
 * Retrieves the current Ubuntu version from /etc/os-release.
 *
 * @returns Ubuntu version string (e.g., "22.04") or null if not Ubuntu/not found
 */
export function getCurrentUbuntuVersion(): string | null {
    try {
        const osReleaseData = fs.readFileSync('/etc/os-release', 'utf8');
        const lines = osReleaseData.split('\n');
        const versionLine = lines.find(line => line.startsWith('VERSION_ID='));
        if (versionLine) {
            return versionLine.split('=')[1].replace(/"/g, '');
        }
        core.debug('Ubuntu version not found');
        return null;
    } catch {
        core.debug('Error reading /etc/os-release');
        return null;
    }
}

/**
 * Retrieves the Ubuntu release codename for the current version.
 *
 * Maps version numbers (e.g., "22.04") to codenames (e.g., "jammy").
 *
 * @returns Ubuntu codename or null if version not recognized
 */
export function getCurrentUbuntuName(): string | null {
    const version = getCurrentUbuntuVersion();
    if (version) {
        // look for "version" key in "ubuntuVersionNames"
        for (const [key, value] of Object.entries(ubuntuVersionNames)) {
            if (version.startsWith(key) || key.startsWith(version)) {
                return value;
            }
        }
    }
    traceCommands.log(`setup-program::getCurrentUbuntuName: Ubuntu name for version ${version} not supported`);
    return null;
}

/**
 * Moves files considering permissions and ownership that make the operation
 * fail on various environments.
 *
 * Handles cross-device moves by falling back to copy, permission errors by
 * using sudo, and directory merging for existing destinations.
 *
 * @param source - Source directory path to move from
 * @param destination - Destination directory path to move to
 * @param copyInstead - If true, copy instead of move (used for cross-device fallback)
 * @param level - Recursion depth level for logging indentation
 * @returns True if successful, false if move/copy failed
 * @throws Error if a nested move operation fails
 */
export async function moveWithPermissions(source: string, destination: string, copyInstead = false, level = 0): Promise<boolean> {
    const fnlog = traceCommands.scoped('moveWithPermissions');

    const levelPrefix = '  '.repeat(level);
    try {
        // Iterate all files in source directory
        const files = fs.readdirSync(source);
        let count = 0;
        for (const file of files) {
            count++;
            const sourcePath = path.join(source, file);
            const destinationPath = path.join(destination, file);
            fnlog(`${levelPrefix}${count}) Handle move from ${sourcePath} to ${destinationPath}`);
            if (isSymlink(sourcePath)) {
                fnlog(`${levelPrefix}${count}) Recreate symlink ${sourcePath} in ${destinationPath}`);
                copySymlink(sourcePath, destinationPath, level);
            } else if (fs.statSync(sourcePath).isDirectory() && fs.existsSync(destinationPath)) {
                fnlog(`${levelPrefix}${count}) Merge directory ${sourcePath} with existing ${destinationPath}`);
                const ok = await moveWithPermissions(sourcePath, destinationPath, copyInstead, level + 1);
                if (!ok) {
                    throw new Error(`Failed to move ${sourcePath} to ${destinationPath}`);
                }
            } else /* regular file or directory that doesn't exist at destination */ {
                if (!copyInstead) {
                    fnlog(`${levelPrefix}${count}) Moving ${sourcePath} to ${destinationPath}`);
                    await io.mv(sourcePath, destinationPath);
                } else {
                    fnlog(`${levelPrefix}${count}) Copy ${sourcePath} to ${destinationPath}`);
                    await io.cp(sourcePath, destinationPath, { recursive: true });
                }
            }
        }
        fnlog(`${levelPrefix}Successfully moved ${source} to ${destination}.`);
        return true;
    } catch (error: unknown) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        core.info(`${levelPrefix}Error occurred while moving ${source} to ${destination}: ${error} (code : ${errorCode})`);
        // If failed because destination is on a different device, retry as copy
        if (errorCode === 'EXDEV' && !copyInstead) {
            return await moveWithPermissions(source, destination, true, level);
        }
        // If permission denied error, retry the move with sudo
        // Also move with sudo when the file is a symlink and can't be moved because of that
        if (((errorCode || 'EACCES') === 'EACCES' || errorCode === 'ENOENT') && process.platform === 'linux') {
            return await moveWithSudo(source, destination, copyInstead, level);
        }
        return false;
    }
}

/**
 * Ensures the sudo command is available on the system.
 *
 * Installs sudo via apt-get if not already present (requires running as root).
 *
 * @throws Error if sudo cannot be found or installed
 */
export async function ensureSudoIsAvailable(): Promise<void> {
    const fnlog = traceCommands.scoped('ensureSudoIsAvailable');

    let sudoPath: string | null = null;
    try {
        sudoPath = await io.which('sudo');
        fnlog(`sudo found at ${sudoPath}`);
    } catch {
        sudoPath = null;
    }
    if (sudoPath === null || sudoPath === '') {
        await exec.exec(`apt-get update`, [], { ignoreReturnCode: true });
        await exec.exec(`apt-get install -y sudo`, [], { ignoreReturnCode: true });
        await io.which('sudo');
    }
}

/**
 * Ensures the add-apt-repository command is available on the system.
 *
 * Installs software-properties-common package if add-apt-repository is not present.
 *
 * @throws Error if add-apt-repository cannot be found or installed
 */
export async function ensureAddAptRepositoryIsAvailable(): Promise<void> {
    const fnlog = traceCommands.scoped('ensureAddAptRepositoryIsAvailable');

    let addAptRepositoryPath: string | null = null;
    try {
        addAptRepositoryPath = await io.which('add-apt-repository');
        fnlog(`add-apt-repository found at ${addAptRepositoryPath}`);
    } catch {
        addAptRepositoryPath = null;
    }
    if (addAptRepositoryPath === null || addAptRepositoryPath === '') {
        if (isSudoRequired()) {
            await ensureSudoIsAvailable();
        }
        await updateAptPackageLists();
        await installProgramWithApt('software-properties-common', null, [], { tryAptitude: false, tryAlternatives: false });
        await io.which('add-apt-repository');
    }
}

/**
 * Moves files using sudo for elevated privileges.
 *
 * Used as a fallback when regular move operations fail due to permission issues.
 *
 * @param source - Source directory path to move from
 * @param destination - Destination directory path to move to
 * @param copyInstead - If true, copy instead of move
 * @param level - Recursion depth for logging indentation
 * @returns True if successful, false if operation failed
 */
async function moveWithSudo(source: string, destination: string, copyInstead = false, level: number): Promise<boolean> {
    const fnlog = traceCommands.scoped('moveWithSudo');

    await ensureSudoIsAvailable();
    const levelPrefix = '  '.repeat(level);
    const files = fs.readdirSync(source);
    let count = 0;
    for (const file of files) {
        const sourcePath = path.join(source, file);
        const destinationPath = path.join(destination, file);
        count++;
        if (isSymlink(sourcePath)) {
            fnlog(`${levelPrefix}${count}) Recreate symlink ${sourcePath} in ${destinationPath}`);
            const targetPath = fs.readlinkSync(sourcePath);
            fnlog(`${levelPrefix}${count}) Symlink found from ${sourcePath} to ${targetPath}`);
            const lnCommand = `sudo ln -sf "${targetPath}" "${destinationPath}"`;
            await exec.getExecOutput(lnCommand);
            fnlog(`${levelPrefix}${count}) Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`);
        } else if (fs.statSync(sourcePath).isDirectory() && fs.existsSync(destinationPath)) {
            const ok = await moveWithSudo(sourcePath, destinationPath, copyInstead, level + 1);
            if (!ok) {
                return false;
            }
        } else {
            const mkdirCommand = `sudo mkdir -p "${destination}"`;
            if (!fs.existsSync(destinationPath)) {
                await exec.getExecOutput(mkdirCommand);
            }
            const mvCommand = `sudo mv "${sourcePath}" "${destination}"`;
            const cpCommand = `sudo cp -r "${sourcePath}" "${destination}"`;
            const command = copyInstead ? cpCommand : mvCommand;
            const { exitCode, stdout }: ExecOutput = await exec.getExecOutput(command);
            const sudoOutput = stdout.trim();
            if (exitCode !== 0) {
                core.warning(`${levelPrefix}${count}) Error occurred while moving with sudo: exit code ${exitCode}`);
                fnlog(sudoOutput);
                return false;
            } else {
                fnlog(`${levelPrefix}${count}) Successfully moved ${sourcePath} to ${destinationPath} with sudo.`);
            }
        }
    }
    return true;
}

/**
 * Downloads, extracts, and installs a program from a URL.
 *
 * Supports URL templates with placeholders like {{name}}, {{version}}, {{os}}, etc.
 * After extraction, searches for the executable and optionally updates PATH.
 *
 * @param names - Array of executable names to search for after installation
 * @param version - Version string used for template rendering and caching
 * @param checkLatest - If true, prefer latest matching version when searching
 * @param urlTemplate - URL or URL template for the archive download
 * @param updateEnvironment - If true, adds installation directories to PATH
 * @param installPrefix - Optional custom installation directory (uses tool cache if null)
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function installProgramFromUrl(
    names: string[],
    version: string,
    checkLatest: boolean,
    urlTemplate: string,
    updateEnvironment: boolean,
    installPrefix: string | null): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('installProgramFromUrl');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;

    // Render URL template
    const coercedVersion = semver.coerce(version) || semver.coerce('0.0.0');
    if (!coercedVersion) {
        return { outputVersion, outputPath };
    }
    let url = urlTemplate;
    const mayBeTemplate = url.includes('{{');
    if (mayBeTemplate) {
        const context: Record<string, string | number> = {
            name: names[0],
            platform: process.platform,
            arch: process.arch,
            os: getRunnerOs().toLowerCase(),
            version: coercedVersion.toString(),
            major: coercedVersion.major,
            minor: coercedVersion.minor,
            patch: coercedVersion.patch
        };
        // Convert data to JSON string
        url = renderTemplate(url, context);
        if (urlTemplate !== url) {
            fnlog(`Template data: ${JSON.stringify(context)}`);
            fnlog(`Template "${urlTemplate}" rendered as "${url}"`);
        }
    }

    // Download and extract archive to temporary directory
    const extPath = await downloadAndExtract(url);
    fnlog(`Downloaded and extracted ${url} to ${extPath}`);
    if (!extPath) {
        return { outputVersion, outputPath };
    }

    // Strip single directory from the path if that's the case
    fnlog(`Stripping single directory from ${extPath}`);
    const stripped = await stripSingleDirectoryFromPath(extPath);
    if (stripped) {
        fnlog(`Stripped single directory from ${extPath}`);
    } else {
        fnlog(`No single directory to strip from ${extPath}`);
    }

    // Create environment variable <tool name>_ROOT with the installation path
    for (const name of names) {
        const envVarName = `${name.toUpperCase()}_ROOT`;
        core.exportVariable(envVarName, extPath);
    }

    // Install to prefix or to cache directory
    let finalInstallPrefix: string;
    if (installPrefix) {
        fnlog(`Moving ${extPath} to ${installPrefix}`);
        const moveOk = await moveWithPermissions(extPath, installPrefix);
        if (!moveOk) {
            fnlog(`Failed to move ${extPath} to ${installPrefix}. Aborting.`);
            return { outputVersion, outputPath };
        }
        finalInstallPrefix = installPrefix;
    } else {
        // Cache
        finalInstallPrefix = await tc.cacheDir(extPath, names[0], coercedVersion.toString());
        fnlog(`Caching ${names[0]} in ${finalInstallPrefix}`);
    }

    fnlog(`Installed in ${finalInstallPrefix}`);
    if (updateEnvironment) {
        core.addPath(finalInstallPrefix);
        const binPath = path.join(finalInstallPrefix, 'bin');
        if (fs.existsSync(binPath)) {
            core.addPath(binPath);
        }
    }

    // Recursively iterate subdirectories of extPath looking for ${name} executable
    fnlog(`Looking for ${names.join(', ')} binary in ${extPath} subdirectories`);
    const installPrefixSubdirectories = [finalInstallPrefix, path.join(finalInstallPrefix, 'bin')].concat(getAllSubdirectories(finalInstallPrefix));
    fnlog(`Looking for ${names.join(', ')} binary in installed ${finalInstallPrefix} subdirectories`);
    const result = await findProgramInPaths(installPrefixSubdirectories, names, '*', checkLatest, true);
    if (result.outputPath) {
        fnlog(`Found ${names.join(', ')} binary in ${result.outputPath}`);
    }
    outputVersion = result.outputVersion;
    outputPath = result.outputPath;

    return { outputVersion, outputPath };
}

/**
 * Main function that searches for and optionally installs a program.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing path, version, and found status
 */
async function main(inputs: SetupProgramInputs): Promise<Record<string, unknown>> {
    const fnlog = traceCommands.scoped('setup-program');

    // Set cache directory
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }
    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }

    // Path program version
    let outputPath: string | null = null;
    let outputVersion: string | null = null;

    // Setup path program
    if (inputs.path && inputs.path.length > 0) {
        core.startGroup('🔍 Searching in user provided paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in paths [${inputs.path.join(',')}]`);
        const result = await findProgramInPath(inputs.path, inputs.version, inputs.checkLatest);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    }

    // Setup system program
    if (outputPath === null) {
        core.startGroup('🔍 Searching in system paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in PATH`);
        const result = await findProgramInSystemPaths(inputs.path, inputs.name, inputs.version, inputs.checkLatest);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    }

    // Setup APT program
    if (outputVersion === null && process.platform === 'linux') {
        core.startGroup('📦 Searching with APT');
        core.info(`Searching for ${inputs.name} ${inputs.version} with APT`);
        const result = await findProgramWithApt(inputs.name, inputs.version, inputs.checkLatest);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    } else {
        if (outputVersion !== null) {
            fnlog(`Skipping APT step because ${inputs.name} ${outputVersion} was already found in ${outputPath}`);
        } else if (process.platform !== 'linux') {
            fnlog(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // Install program
    const url = inputs.url || null;
    const installPrefix = inputs.installPrefix || null;
    if (outputVersion === null && url !== null) {
        core.startGroup('🚚 Downloading and Installing');
        core.info(`Fetching ${inputs.name} ${inputs.version} from URL`);
        const result = await installProgramFromUrl(
            inputs.name,
            inputs.version,
            inputs.checkLatest,
            url,
            inputs.updateEnvironment,
            installPrefix);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    } else {
        if (outputVersion !== null) {
            fnlog(`Skipping download step because ${inputs.name} ${outputVersion} was already found in ${outputPath}`);
        } else if (url === null) {
            fnlog(`Skipping download step because no URL was provided. URL: ${url}`);
        }
    }

    // Parse Final program / Setup version / Outputs
    if (outputPath) {
        const semverVersion = outputVersion !== null ?
            semver.coerce(outputVersion, { loose: true }) :
            semver.coerce('0.0.0', { loose: true });
        if (semverVersion) {
            return {
                path: outputPath,
                dir: path.dirname(outputPath),
                version: semverVersion.toString(),
                versionMajor: semverVersion.major,
                versionMinor: semverVersion.minor,
                versionPatch: semverVersion.patch,
                found: true
            };
        }
    }

    core.setOutput('found', false);
    if (inputs.failOnError) {
        core.setFailed('Cannot find program');
    } else {
        core.info('Cannot find program');
    }
    return { found: false };
}

/**
 * Action entry point using schema-driven runner.
 *
 * This replaces the previous manual input extraction and error handling
 * with the standardized runAction wrapper.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'Setup Program',
    main: async (inputs: SetupProgramInputs) => {
        return await main(inputs);
    },
    callerModule: module
});
