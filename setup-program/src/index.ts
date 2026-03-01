import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as httpm from '@actions/http-client';
import * as trace_commands from 'trace-commands';
import { runAction } from 'action-schema';
import gccDefaultTags from '../gcc-tags.json';
import clangDefaultTags from '../clang-tags.json';
import cmakeDefaultTags from '../cmake-tags.json';
import ubuntuVersionNames from '../ubuntu-versions.json';

import {
    ProgramResult,
    ExecOutput,
    SetupProgramInputs,
    PackagePreferenceTier,
    FetchGitTagsOptions,
    CloneGitRepoOptions,
    AptPackageMatch
} from './types';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

import {
    escapeRegExp,
    removeSemverLeadingZeros,
    renderTemplate,
    get_runner_os,
    sleep
} from './utils';

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
    find_program_in_path,
    find_program_in_paths,
    find_program_in_system_paths
} from './program-search';

// Re-export types for external consumers
export { PackagePreferenceTier } from './types';

// Re-export version cache functions for external consumers
export { setVersionsCacheDir, resolveVersionsCachePath, readVersionsFromFile, saveVersionsToFile } from './version-cache';

// Re-export download utilities for external consumers
export { downloadAndExtract, stripSingleDirectoryFromPath } from './download-utils';

// Re-export program search functions for external consumers
export { find_program_in_path, find_program_in_system_paths } from './program-search';

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
    const http_client = new httpm.HttpClient('setup-clang', [], {
        allowRetries: true, maxRetries: 3
    });
    try {
        const res = await http_client.head(url);
        return res.message.statusCode === 200;
    } catch (error) {
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
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @returns The best matching package info, or null if no match found
 * @throws Error if apt-cache search or showpkg commands fail
 */
export async function search_apt_packages(
    names: string[],
    version: string,
    check_latest: boolean
): Promise<AptPackageMatch | null> {
    function fnlog(msg: string): void {
        trace_commands.log('search_apt_packages: ' + msg);
    }

    // Search for matching package names
    const package_names: string[] = [];
    for (const name of names) {
        const search_expression = `${escapeRegExp(name)}(-[0-9\\.]+)?`;
        fnlog(`Searching for packages matching ${search_expression}`);
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['search', `^${search_expression}$`]);
        if (output.exitCode !== 0) {
            throw new Error(`Failed to run apt-cache search. Exit code ${output.exitCode}`);
        }
        fnlog(`apt-cache search. Exit code ${output.exitCode}`);
        const apt_output = output.stdout.trim();
        const apt_lines = apt_output.split('\n');
        for (const apt_line of apt_lines) {
            const apt_line_regex = new RegExp(`^(${search_expression}) `);
            const apt_line_matches = apt_line.match(apt_line_regex);
            if (apt_line_matches !== null) {
                package_names.push(apt_line_matches[1]);
            }
        }
    }
    fnlog(`Found packages [${package_names.join(', ')}]`);

    // Find the best matching package and version
    fnlog(`Listing all versions of packages [${package_names.join(', ')}]`);
    let best_match: AptPackageMatch | null = null;
    const install_matches: string[] = [];

    for (const package_name of package_names) {
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['showpkg', package_name], { silent: true });
        if (output.exitCode !== 0) {
            throw new Error(`Failed to run "apt-cache showpkg '${package_name}'"`);
        }
        if (output.stdout.trim() === '') {
            fnlog('No output from apt-cache showpkg ' + package_name);
            continue;
        }

        const showpkg_lines = output.stdout.trim().split('\n');
        const dependencies_index = showpkg_lines.findIndex((line) => line.startsWith('Dependencies:'));
        if (dependencies_index === -1) {
            continue;
        }
        let provides_index = showpkg_lines.findIndex((line) => line.startsWith('Provides:'));
        if (provides_index === -1) {
            provides_index = showpkg_lines.length;
        }
        const dependencies_lines = showpkg_lines.slice(dependencies_index + 1, provides_index);
        const package_versions = dependencies_lines.map((line) => line.split(' ')[0]);
        fnlog(`Package ${package_name} has APT versions [${package_versions.join(', ')}]`);

        const pkg_tier = getPackagePreferenceTier(package_name, names);
        fnlog(`Package ${package_name} has preference tier ${pkg_tier}`);

        // Check each version against requirements
        for (const package_version of package_versions) {
            const version_regexes = [/\d+:(\d+.\d+)-\d+/, /\d+:(\d+)-\d+/, /(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
            for (const version_regex of version_regexes) {
                const version_matches = package_version.match(version_regex);
                if (version_matches !== null) {
                    const pkg_version_str = removeSemverLeadingZeros(version_matches[1]);
                    const pkg_version = semver.coerce(pkg_version_str);
                    const satisfies = pkg_version !== null ? semver.satisfies(pkg_version, version) : true;

                    if (!satisfies) {
                        fnlog(`Package ${package_name}=${package_version} version ${pkg_version} does NOT satisfy ${names.join(', ')} version ${version}`);
                    } else if (pkg_version !== null) {
                        install_matches.push(`${package_name}=${package_version}`);

                        const isBetterTier = best_match === null || pkg_tier < best_match.tier;
                        const isSameTier = best_match !== null && pkg_tier === best_match.tier;
                        const isBetterVersion = best_match !== null &&
                            ((check_latest && semver.gt(pkg_version, best_match.semverVersion)) ||
                             (!check_latest && semver.lt(pkg_version, best_match.semverVersion)));
                        const isFirstMatch = best_match === null;

                        if (isFirstMatch || isBetterTier || (isSameTier && isBetterVersion)) {
                            fnlog(`Package ${package_name}=${package_version} version ${pkg_version} (tier ${pkg_tier}) selected as best match for ${names.join(', ')} version ${version}`);
                            best_match = {
                                packageName: package_name,
                                packageVersion: package_version,
                                semverVersion: pkg_version.toString(),
                                tier: pkg_tier,
                                alternatives: install_matches
                            };
                        }
                    }
                    break;
                }
            }
        }
    }

    // Update alternatives in the final result
    if (best_match !== null) {
        best_match.alternatives = install_matches;
    }

    return best_match;
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
export async function install_program_with_apt(
    packageName: string,
    packageVersion: string | null = null,
    alternatives: string[] = [],
    options: AptInstallOptions = {}
): Promise<string | null> {
    function fnlog(msg: string): void {
        trace_commands.log('install_program_with_apt: ' + msg);
    }

    const { tryAptitude = true, tryAlternatives = true } = options;

    const install_pkg = packageVersion !== null
        ? `${packageName}=${packageVersion}`
        : packageName;

    fnlog(`Installing ${install_pkg}`);
    const execOpts: exec.ExecOptions = {
        env: {
            DEBIAN_FRONTEND: 'noninteractive',
            TZ: 'Etc/UTC',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        },
        ignoreReturnCode: true
    };

    // Try apt-get install
    let exit_code = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', install_pkg], execOpts);
    if (exit_code === 0) {
        return packageName;
    }

    fnlog(`Failed to install ${install_pkg}. Exit code: ${exit_code}`);

    // Try aptitude as fallback
    if (tryAptitude) {
        let aptitude_path: string | null;
        try {
            aptitude_path = await io.which('aptitude');
        } catch {
            aptitude_path = null;
        }

        if (aptitude_path) {
            fnlog('Retrying with aptitude for better dependency resolution');
            exit_code = await execWithSudo('aptitude', ['install', '-f', '-y', install_pkg], execOpts);
            if (exit_code === 0) {
                return packageName;
            }
            fnlog(`aptitude also failed. Exit code: ${exit_code}`);
        } else {
            fnlog('aptitude unavailable');
        }
    }

    // Try alternative packages
    if (tryAlternatives && alternatives.length > 0) {
        fnlog(`Trying alternative packages [${alternatives.join(', ')}]`);
        for (const alt_pkg of alternatives) {
            exit_code = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', alt_pkg], execOpts);
            if (exit_code === 0) {
                // Extract package name from "package=version" format
                return alt_pkg.split('=')[0];
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
 * 3. Searches for matching packages via {@link search_apt_packages}
 * 4. Installs the best match via {@link install_program_with_apt}
 * 5. Locates the installed executable
 *
 * For direct package installation without searching, use {@link install_program_with_apt} directly.
 *
 * @param names - Array of package/executable names to search for
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function find_program_with_apt(names: string[], version: string, check_latest: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_with_apt: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;
    let installed_package: string | null = null;

    // Check APT availability
    fnlog('Checking if APT is available');
    if (!await isAptAvailable()) {
        fnlog('APT is not available');
        return { output_version, output_path, installed_package };
    }

    try {
        // Update package lists
        fnlog(`Searching for ${names.join(', ')} with APT`);
        await updateAptPackageLists();

        // Search for matching packages
        const match = await search_apt_packages(names, version, check_latest);
        if (match === null) {
            fnlog(`No matching package found for ${names.join(', ')} version ${version}`);
            return { output_version, output_path, installed_package };
        }

        fnlog(`Best match: ${match.packageName}=${match.packageVersion} (version ${match.semverVersion}, tier ${match.tier})`);

        // Install the package
        installed_package = await install_program_with_apt(
            match.packageName,
            match.packageVersion,
            match.alternatives
        );

        if (installed_package !== null) {
            // Locate the installed executable
            const result = await find_program_in_system_paths([], names, version, check_latest);
            output_version = result.output_version;
            output_path = result.output_path;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
    }

    // Log results
    if (output_path !== null) {
        fnlog(`Program found: ${output_path}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (output_version !== null) {
        fnlog(`Package version found ${output_version}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (installed_package !== null) {
        fnlog(`Installed package: ${installed_package}`);
    }

    return { output_version, output_path, installed_package };
}

/**
 * Locates or installs Git on the system.
 *
 * First attempts to find Git in PATH. If not found on Linux, installs it via APT.
 *
 * @returns Path to the Git executable, or null if not found/installed
 */
export async function findGit(): Promise<string | null> {
    let git_path: string;
    try {
        git_path = await io.which('git');
    } catch {
        git_path = '';
    }
    if (git_path === '') {
        // Try to install git via APT
        await updateAptPackageLists();
        await install_program_with_apt('git', null, [], { tryAptitude: false, tryAlternatives: false });
        try {
            git_path = await io.which('git');
        } catch {
            return null;
        }
    }
    return git_path || null;
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
        let git_path: string | null = null;
        try {
            git_path = await findGit();
        } catch (error) {
            git_path = null;
        }
        // Install git if we have to
        if (!git_path) {
            await find_program_with_apt(['git'], '*', true);
            git_path = await findGit();
        }
        // Still no git? Fail
        if (!git_path) {
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
                }: ExecOutput = await exec.getExecOutput(`"${git_path}"`, args, { silent: true });
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
                trace_commands.log('Git tags: ' + gitTags);
                return gitTags;
            } catch (error) {
                if (attempt < maxRetries) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    trace_commands.log('Error fetching Git tags: ' + errorMessage);
                    trace_commands.log(`Attempt ${attempt} of ${maxRetries}`);
                    // Exponential backoff
                    const delay = Math.max(60000, Math.pow(2, attempt - 1) * 1000);
                    trace_commands.log(`Retrying in ${delay} milliseconds...`);
                    await sleep(delay);
                } else {
                    if (defaultTags.length > 0) {
                        trace_commands.log('Using default tags: ' + defaultTags);
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
        trace_commands.log(`${name} versions (from file): ` + versionsFromFile);
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
    trace_commands.log(`${name} versions: ` + versions);
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
        const git_path = await findGit();
        if (!git_path) {
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
            await exec.exec(`"${git_path}"`, args);
        } else {
            // Reference is a commit hash: init and checkout
            await io.rmRF(destPath);
            await io.mkdirP(destPath);
            await exec.exec(`"${git_path}"`, ['config', '--global', 'init.defaultBranch', 'master'], { cwd: destPath });
            await exec.exec(`"${git_path}"`, ['config', '--global', 'advice.detachedHead', 'false'], { cwd: destPath });
            await exec.exec(`"${git_path}"`, ['init'], { cwd: destPath });
            await exec.exec(`"${git_path}"`, ['remote', 'add', 'origin', repo], { cwd: destPath });
            const args: string[] = ['fetch'];
            if (options.shallow) {
                args.push('--depth');
                args.push('1');
            }
            args.push('origin');
            if (ref) {
                args.push(ref);
            }
            await exec.exec(`"${git_path}"`, args, { cwd: destPath });
            await exec.exec(`"${git_path}"`, ['checkout', 'FETCH_HEAD'], { cwd: destPath });
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
        console.error('Ubuntu version not found');
        return null;
    } catch (error) {
        console.error('Error:', error);
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
    trace_commands.log(`setup-program::getCurrentUbuntuName: Ubuntu name for version ${version} not supported`);
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
    function fnlog(msg: string): void {
        trace_commands.log('moveWithPermissions: ' + msg);
    }

    const levelPrefix = '  '.repeat(level);
    try {
        // Iterate all files in source directory
        const files = fs.readdirSync(source);
        let count = 0;
        for (const file of files) {
            count++;
            const source_path = path.join(source, file);
            const destination_path = path.join(destination, file);
            fnlog(`${levelPrefix}${count}) Handle move from ${source_path} to ${destination_path}`);
            if (isSymlink(source_path)) {
                fnlog(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`);
                copySymlink(source_path, destination_path, level);
            } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
                fnlog(`${levelPrefix}${count}) Merge directory ${source_path} with existing ${destination_path}`);
                const ok = await moveWithPermissions(source_path, destination_path, copyInstead, level + 1);
                if (!ok) {
                    throw new Error(`Failed to move ${source_path} to ${destination_path}`);
                }
            } else /* regular file or directory that doesn't exist at destination */ {
                if (!copyInstead) {
                    fnlog(`${levelPrefix}${count}) Moving ${source_path} to ${destination_path}`);
                    await io.mv(source_path, destination_path);
                } else {
                    fnlog(`${levelPrefix}${count}) Copy ${source_path} to ${destination_path}`);
                    await io.cp(source_path, destination_path, { recursive: true });
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
    function fnlog(msg: string): void {
        trace_commands.log('ensureSudoIsAvailable: ' + msg);
    }

    let sudo_path: string | null = null;
    try {
        sudo_path = await io.which('sudo');
        fnlog(`sudo found at ${sudo_path}`);
    } catch (error) {
        sudo_path = null;
    }
    if (sudo_path === null || sudo_path === '') {
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
    function fnlog(msg: string): void {
        trace_commands.log('ensureAddAptRepositoryIsAvailable: ' + msg);
    }

    let add_apt_repository_path: string | null = null;
    try {
        add_apt_repository_path = await io.which('add-apt-repository');
        fnlog(`add-apt-repository found at ${add_apt_repository_path}`);
    } catch {
        add_apt_repository_path = null;
    }
    if (add_apt_repository_path === null || add_apt_repository_path === '') {
        if (isSudoRequired()) {
            await ensureSudoIsAvailable();
        }
        await updateAptPackageLists();
        await install_program_with_apt('software-properties-common', null, [], { tryAptitude: false, tryAlternatives: false });
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
    function fnlog(msg: string): void {
        trace_commands.log('moveWithSudo: ' + msg);
    }

    await ensureSudoIsAvailable();
    const levelPrefix = '  '.repeat(level);
    const files = fs.readdirSync(source);
    let count = 0;
    for (const file of files) {
        const source_path = path.join(source, file);
        const destination_path = path.join(destination, file);
        count++;
        if (isSymlink(source_path)) {
            fnlog(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`);
            const target_path = fs.readlinkSync(source_path);
            fnlog(`${levelPrefix}${count}) Symlink found from ${source_path} to ${target_path}`);
            const ln_command = `sudo ln -sf "${target_path}" "${destination_path}"`;
            await exec.getExecOutput(ln_command);
            fnlog(`${levelPrefix}${count}) Symlink recreated from ${source_path} to ${destination_path} with target ${target_path}`);
        } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
            const ok = await moveWithSudo(source_path, destination_path, copyInstead, level + 1);
            if (!ok) {
                return false;
            }
        } else {
            const mkdir_command = `sudo mkdir -p "${destination}"`;
            if (!fs.existsSync(destination_path)) {
                await exec.getExecOutput(mkdir_command);
            }
            const mv_command = `sudo mv "${source_path}" "${destination}"`;
            const cp_command = `sudo cp -r "${source_path}" "${destination}"`;
            const command = copyInstead ? cp_command : mv_command;
            const { exitCode, stdout }: ExecOutput = await exec.getExecOutput(command);
            const sudo_output = stdout.trim();
            if (exitCode !== 0) {
                core.warning(`${levelPrefix}${count}) Error occurred while moving with sudo: exit code ${exitCode}`);
                fnlog(sudo_output);
                return false;
            } else {
                fnlog(`${levelPrefix}${count}) Successfully moved ${source_path} to ${destination_path} with sudo.`);
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
 * @param check_latest - If true, prefer latest matching version when searching
 * @param url_template - URL or URL template for the archive download
 * @param update_environment - If true, adds installation directories to PATH
 * @param install_prefix - Optional custom installation directory (uses tool cache if null)
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function install_program_from_url(
    names: string[],
    version: string,
    check_latest: boolean,
    url_template: string,
    update_environment: boolean,
    install_prefix: string | null): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('install_program_from_url: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;

    // Render URL template
    const coercedVersion = semver.coerce(version) || semver.coerce('0.0.0');
    if (!coercedVersion) {
        return { output_version, output_path };
    }
    let url = url_template;
    const may_be_template = url.includes('{{');
    if (may_be_template) {
        const context: Record<string, string | number> = {
            name: names[0],
            platform: process.platform,
            arch: process.arch,
            os: get_runner_os().toLowerCase(),
            version: coercedVersion.toString(),
            major: coercedVersion.major,
            minor: coercedVersion.minor,
            patch: coercedVersion.patch
        };
        // Convert data to JSON string
        url = renderTemplate(url, context);
        if (url_template !== url) {
            fnlog(`Template data: ${JSON.stringify(context)}`);
            fnlog(`Template "${url_template}" rendered as "${url}"`);
        }
    }

    // Download and extract archive to temporary directory
    const extPath = await downloadAndExtract(url);
    fnlog(`Downloaded and extracted ${url} to ${extPath}`);
    if (!extPath) {
        return { output_version, output_path };
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
        const env_var_name = `${name.toUpperCase()}_ROOT`;
        core.exportVariable(env_var_name, extPath);
    }

    // Install to prefix or to cache directory
    let final_install_prefix: string;
    if (install_prefix) {
        fnlog(`Moving ${extPath} to ${install_prefix}`);
        const move_ok = await moveWithPermissions(extPath, install_prefix);
        if (!move_ok) {
            fnlog(`Failed to move ${extPath} to ${install_prefix}. Aborting.`);
            return { output_version, output_path };
        }
        final_install_prefix = install_prefix;
    } else {
        // Cache
        final_install_prefix = await tc.cacheDir(extPath, names[0], coercedVersion.toString());
        fnlog(`Caching ${names[0]} in ${final_install_prefix}`);
    }

    fnlog(`Installed in ${final_install_prefix}`);
    if (update_environment) {
        core.addPath(final_install_prefix);
        const bin_path = path.join(final_install_prefix, 'bin');
        if (fs.existsSync(bin_path)) {
            core.addPath(bin_path);
        }
    }

    // Recursively iterate subdirectories of extPath looking for ${name} executable
    fnlog(`Looking for ${names.join(', ')} binary in ${extPath} subdirectories`);
    const installPrefixSubdirectories = [final_install_prefix, path.join(final_install_prefix, 'bin')].concat(getAllSubdirectories(final_install_prefix));
    fnlog(`Looking for ${names.join(', ')} binary in installed ${final_install_prefix} subdirectories`);
    const result = await find_program_in_paths(installPrefixSubdirectories, names, '*', check_latest, true);
    if (result.output_path) {
        fnlog(`Found ${names.join(', ')} binary in ${result.output_path}`);
    }
    output_version = result.output_version;
    output_path = result.output_path;

    return { output_version, output_path };
}

/**
 * Main function that searches for and optionally installs a program.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing path, version, and found status
 */
async function main(inputs: SetupProgramInputs): Promise<Record<string, unknown>> {
    function fnlog(msg: string): void {
        trace_commands.log('setup-program: ' + msg);
    }

    // Set cache directory
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }
    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }

    // Path program version
    let output_path: string | null = null;
    let output_version: string | null = null;

    // Setup path program
    if (inputs.path && inputs.path.length > 0) {
        core.startGroup('🔍 Searching in user provided paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in paths [${inputs.path.join(',')}]`);
        const result = await find_program_in_path(inputs.path, inputs.version, inputs.check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup system program
    if (output_path === null) {
        core.startGroup('🔍 Searching in system paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in PATH`);
        const result = await find_program_in_system_paths(inputs.path, inputs.name, inputs.version, inputs.check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup APT program
    if (output_version === null && process.platform === 'linux') {
        core.startGroup('📦 Searching with APT');
        core.info(`Searching for ${inputs.name} ${inputs.version} with APT`);
        const result = await find_program_with_apt(inputs.name, inputs.version, inputs.check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    } else {
        if (output_version !== null) {
            fnlog(`Skipping APT step because ${inputs.name} ${output_version} was already found in ${output_path}`);
        } else if (process.platform !== 'linux') {
            fnlog(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // Install program
    const url = inputs.url || null;
    const install_prefix = inputs.install_prefix || null;
    if (output_version === null && url !== null) {
        core.startGroup('🚚 Downloading and Installing');
        core.info(`Fetching ${inputs.name} ${inputs.version} from URL`);
        const result = await install_program_from_url(
            inputs.name,
            inputs.version,
            inputs.check_latest,
            url,
            inputs.update_environment,
            install_prefix);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    } else {
        if (output_version !== null) {
            fnlog(`Skipping download step because ${inputs.name} ${output_version} was already found in ${output_path}`);
        } else if (url === null) {
            fnlog(`Skipping download step because no URL was provided. URL: ${url}`);
        }
    }

    // Parse Final program / Setup version / Outputs
    if (output_path) {
        const semverVersion = output_version !== null ?
            semver.coerce(output_version, { loose: true }) :
            semver.coerce('0.0.0', { loose: true });
        if (semverVersion) {
            return {
                path: output_path,
                dir: path.dirname(output_path),
                version: semverVersion.toString(),
                version_major: semverVersion.major,
                version_minor: semverVersion.minor,
                version_patch: semverVersion.patch,
                found: true
            };
        }
    }

    core.setOutput('found', false);
    if (inputs.fail_on_error) {
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
