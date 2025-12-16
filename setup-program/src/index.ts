import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as os from 'os';
import * as httpm from '@actions/http-client';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';
import gccDefaultTags from '../gcc-tags.json';
import clangDefaultTags from '../clang-tags.json';
import cmakeDefaultTags from '../cmake-tags.json';
import ubuntuVersionNames from '../ubuntu-versions.json';

/**
 * Result of a program search or installation operation.
 */
interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
    /** The APT package name that was installed (only set when installed via APT) */
    installed_package?: string | null;
}

/**
 * Output from executing a command via exec.getExecOutput.
 */
interface ExecOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Configuration inputs for the setup-program action.
 */
interface SetupProgramInputs {
    name: string[];
    version: string;
    paths: string[];
    check_latest: boolean;
    update_environment: boolean;
    url: string | null;
    install_prefix: string | null;
    fail_on_error: boolean;
    trace_commands: boolean;
}

/**
 * Package preference tier for APT package selection.
 *
 * Lower tier number means higher preference:
 * - Tier 1: Unversioned packages (e.g., "clang", "gcc") - best system integration
 * - Tier 2: Raw versioned packages (e.g., "clang-14", "gcc-12") - what users expect
 * - Tier 3: Other versioned packages (e.g., "clang-14-tools") - fallback only
 */
export enum PackagePreferenceTier {
    UNVERSIONED = 1,
    RAW_VERSIONED = 2,
    OTHER_VERSIONED = 3
}

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
 * Checks if a file at the given path is executable.
 *
 * On Windows, checks for .exe, .cmd, or .bat extensions.
 * On other platforms, checks the file's executable permission bit.
 *
 * @param filePath - Path to the file to check
 * @returns True if the file exists and is executable, false otherwise
 */
function isExecutable(filePath: string): boolean {
    if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isDirectory()) {
        return false;
    }
    try {
        if (process.platform === 'win32') {
            // On Windows, check if the file has a .exe extension
            const extensions = ['.exe', '.cmd', '.bat'];
            for (const extension of extensions) {
                if (filePath.toLowerCase().endsWith(extension)) {
                    return true;
                }
            }
            return false;
        } else {
            // On Linux and other platforms, check the file permissions
            const stats = fs.statSync(filePath);
            const mode = stats.mode;
            return (mode & fs.constants.S_IXUSR) !== 0;
        }
    } catch (error) {
        // Handle file not found or other errors
        console.error(error);
        return false;
    }
}

/**
 * Checks if a program's version satisfies the specified semver requirements.
 *
 * Executes the program with --version flag and parses the output to extract
 * the version. Returns null if the version doesn't satisfy requirements, or
 * "0.0.0" if the version cannot be determined.
 *
 * @param execPath - Path to the executable to check
 * @param semverRequirements - Semver range requirement (e.g., ">=10", "*")
 * @returns The version string if satisfied, "0.0.0" if unparseable, null if not satisfied
 */
async function program_satisfies(execPath: string, semverRequirements: string): Promise<string | null> {
    function fnlog(msg: string): void {
        trace_commands.log('program_satisfies: ' + msg);
    }

    // Try to run the program and get the version string
    fnlog(`Checking if program ${execPath} version satisfies ${semverRequirements}`);
    let version_output: string | null = null;
    try {
        fnlog(`Running ${execPath} --version`);
        const { exitCode, stdout }: ExecOutput = await exec.getExecOutput(`"${execPath}"`, ['--version']);
        fnlog(`Exit code: ${exitCode}`);
        fnlog(`Output: ${stdout.slice(0, 300)}`);
        version_output = stdout.trim();
        if (exitCode !== 0) {
            fnlog(`Path program ${execPath} --version exited with code ${exitCode}`);
            return '0.0.0';
        }
    } catch (error) {
        fnlog(`Path program ${execPath} does not have a version string`);
        return '0.0.0';
    }

    const version_regexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
    let version: semver.SemVer | null = null;
    for (const version_regex of version_regexes) {
        const version_matches = version_output.match(version_regex);
        if (version_matches !== null) {
            fnlog(`Path program ${execPath} matches version string ${version_matches[1]}`);
            const version_str = version_matches[1];
            version = semver.coerce(version_str, { includePrerelease: false, loose: true });
            if (version === null) {
                continue;
            }
            if (semverRequirements === '*' || semverRequirements === '' || semver.satisfies(version, semverRequirements)) {
                return version.toString();
            }
            break;
        }
    }

    // If no version could be parsed, then return 0.0.0
    if (version === null) {
        return '0.0.0';
    }

    // If parsed version does not satisfy the requirements, then return null
    return null;
}

/**
 * Attempt to resolve an executable by inspecting a list of user-supplied paths.
 *
 * Behaviour depends on each entry:
 * - Basename entries (e.g. "cmake") are treated as hints and forwarded to
 *   {@link find_program_in_system_paths}, so PATH and cached locations are
 *   still searched with the current version requirement.
 * - Absolute or relative paths are treated as candidate files. On Windows, we
 *   also probe typical executable extensions (".exe", ".cmd", ".bat") when the
 *   entry has no extension. Each candidate must exist, be executable, and
 *   satisfy the supplied semver range; otherwise it is skipped.
 *
 * The function keeps track of the "best" candidate according to the
 * check_latest flag: the earliest satisfying version when false, the latest
 * when true. Returning {output_version: null, output_path: null} means no valid
 * executable met the constraint (use version="*" to opt out of filtering).
 *
 * @param paths - Array of paths to search for the executable
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function find_program_in_path(paths: string[], version: string, check_latest: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_in_path: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;
    if (paths.length > 1) {
        fnlog(`Searching for program version ${version} in paths [${paths.join(', ')}]`);
    }
    for (const exec_path of paths) {
        if (exec_path === '') {
            continue;
        }
        fnlog(`Searching for program version ${version} in "${exec_path}"`);

        // Find as a program in path if only basename is provided
        const isBasenameOnly = path.basename(exec_path) === exec_path;
        if (isBasenameOnly) {
            const result = await find_program_in_system_paths([], [exec_path], version, check_latest);
            if (result.output_path && result.output_version) {
                fnlog(`Found program ${exec_path} in system paths (${result.output_path} - version ${result.output_version}).`);
                return { output_version: result.output_version, output_path: result.output_path };
            }
        }

        // Find as a file in path
        const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
        for (const extension of extensions) {
            const filePath = exec_path + extension;
            if (!fs.existsSync(filePath)) {
                continue;
            }

            if (fs.lstatSync(filePath).isDirectory()) {
                fnlog(`Path ${filePath} is a directory. Skipping it.`);
                continue;
            }

            if (!isExecutable(filePath)) {
                core.debug(`Path ${filePath} is not an executable. Skipping it.`);
                continue;
            }

            // Execute program in path and extract a version string
            const this_output_version = await program_satisfies(filePath, version);
            const has_no_output_version_yet = output_version === null;
            const real_version_parsed = this_output_version !== '0.0.0';
            const satisfied_requirements = this_output_version !== null;
            if (has_no_output_version_yet ||
                (real_version_parsed && satisfied_requirements) ||
                (check_latest && this_output_version !== null && output_version !== null && semver.gt(this_output_version, output_version)) ||
                (!check_latest && this_output_version !== null && output_version !== null && semver.lt(this_output_version, output_version))) {
                output_version = this_output_version;
                output_path = filePath;
            }
        }
    }
    return { output_version, output_path };
}

/**
 * Searches for executables in specified directory paths.
 *
 * Iterates through directories looking for executables matching the given names,
 * checking each candidate against the version requirement.
 *
 * @param paths - Array of directory paths to search
 * @param names - Array of executable names to search for
 * @param version - Semver version constraint (e.g., ">=10", "*")
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @param stop_at_first - If true, stop searching after finding the first match
 * @returns Object containing the found executable path and version, or nulls if not found
 */
async function find_program_in_paths(paths: string[], names: string[], version: string, check_latest: boolean, stop_at_first: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_in_paths: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;
    let path_log_view: (string | string)[] = paths;
    if (paths.length > 10) {
        path_log_view = paths.slice(0, 10).concat(['...']);
    }
    fnlog(`Searching for ${names.join(', ')} ${version} in [${path_log_view.join(', ')}]`);

    // Check if version requirement can be coerced into version
    const exec_name_candidates: string[] = [];
    const version_obj = semver.coerce(version);

    for (const name of names) {
        const filename_prefixes: string[] = [];
        if (version_obj !== null) {
            filename_prefixes.push(`${name}-${version_obj.major}.${version_obj.minor}.${version_obj.patch}`);
            filename_prefixes.push(`${name}-${version_obj.major}.${version_obj.minor}`);
            filename_prefixes.push(`${name}-${version_obj.major}`);
        }
        filename_prefixes.push(`${name}`);
        const filename_suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
        // exec_name_candidates is the cross-product of filename prefixes and suffixes
        for (const filename_prefix of filename_prefixes) {
            for (const filename_suffix of filename_suffixes) {
                exec_name_candidates.push(filename_prefix + filename_suffix);
            }
        }
    }
    fnlog(`Searching for ${names.join(', ')} ${version} with filenames [${exec_name_candidates.join(', ')}]`);

    // Setup System program
    for (const dir of paths) {
        // Skip path if not a directory
        if (!fs.existsSync(dir)) {
            fnlog(`Path ${dir} does not exist.`);
            continue;
        }
        if (!fs.lstatSync(dir).isDirectory()) {
            fnlog(`Path ${dir} is not a directory.`);
            continue;
        }
        fnlog(`Searching for ${names.join(', ')} ${version} in ${dir}`);
        // add each exec_name_candidate to dir
        for (const exec_name_candidate of exec_name_candidates) {
            const exec_path = path.join(dir, exec_name_candidate);
            if (!fs.existsSync(exec_path)) {
                continue;
            }
            if (fs.lstatSync(exec_path).isDirectory()) {
                fnlog(`Path ${exec_path} is a directory. Skipping it.`);
                continue;
            }
            if (!isExecutable(exec_path)) {
                fnlog(`Path program ${exec_path} is not an executable.`);
                continue;
            }
            // Execute program in exec_path and extract a version string
            core.info(`Found ${exec_path}`);
            const this_output_version = await program_satisfies(exec_path, version);
            if (this_output_version === null) {
                core.info(`${exec_path} does not satisfy requirement ${version}`);
            } else {
                core.info(`Executable version: ${this_output_version} satisfies requirement ${version}`);
            }
            if (output_version === null ||
                (check_latest && typeof (this_output_version) === 'string' && semver.gt(this_output_version, output_version)) ||
                (!check_latest && typeof (this_output_version) === 'string' && semver.lt(this_output_version, output_version))) {
                fnlog(`Found ${exec_path} with version ${this_output_version}.`);
                if (output_version && output_version !== this_output_version) {
                    fnlog(`Previous best version was ${output_version}.`);
                }
                output_version = this_output_version;
                output_path = exec_path;
            }
        }
        if (stop_at_first && output_version !== null && output_version !== '0.0.0') {
            break;
        }
    }
    return { output_version, output_path };
}

/**
 * Searches for an executable in system PATH and tool cache directories.
 *
 * Combines the system PATH environment variable with any extra paths provided,
 * and also searches the GitHub Actions runner tool cache for matching executables.
 *
 * @param extra_paths - Additional directories to search before PATH
 * @param names - Array of executable names to search for (e.g., ["gcc", "g++"])
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function find_program_in_system_paths(extra_paths: string[], names: string[], version: string, check_latest: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_in_system_paths: ' + msg);
    }

    // Append directories from PATH environment variable to paths
    // Get system PATHs with core
    fnlog(`Looking for ${names.join(', ')} ${version} in system PATH`);
    let path_dirs = process.platform.startsWith('win') ? (process.env.PATH || '').split(/;/) : (process.env.PATH || '').split(/[:;]/);
    fnlog(`Paths in $PATH environment variable: ${path_dirs.slice(0, 10).join(', ')}...`);
    if (process.env['RUNNER_TOOL_CACHE']) {
        fnlog(`RUNNER_TOOL_CACHE environment variable: ${process.env['RUNNER_TOOL_CACHE']}`);
        const cached_tool_versions_paths: string[] = [];
        for (const name of names) {
            cached_tool_versions_paths.push(path.join(process.env['RUNNER_TOOL_CACHE'], name));
        }
        for (const cached_tool_versions_path of cached_tool_versions_paths) {
            fnlog(`Cached tool versions path: ${cached_tool_versions_path}`);
            if (fs.existsSync(cached_tool_versions_path) && fs.lstatSync(cached_tool_versions_path).isDirectory()) {
                // Iterate all directories in cached_tool_versions_path at the first level
                const subdirectories = fs.readdirSync(cached_tool_versions_path)
                    .filter((file) => fs.lstatSync(path.join(cached_tool_versions_path, file)).isDirectory());
                fnlog(`Adding ${cached_tool_versions_path} to PATH`);
                path_dirs.push(cached_tool_versions_path);
                for (const subdirectory of subdirectories) {
                    fnlog(`Adding ${subdirectory} to PATH`);
                    const subdirectory_path = path.join(cached_tool_versions_path, subdirectory);
                    path_dirs.push(subdirectory_path);
                    const subdirectory_bin_path = path.join(subdirectory_path, 'bin');
                    if (fs.existsSync(subdirectory_bin_path) && fs.lstatSync(subdirectory_bin_path).isDirectory()) {
                        fnlog(`Adding ${subdirectory_bin_path} to PATH`);
                        path_dirs.push(subdirectory_bin_path);
                    }
                }
            }
        }
    }

    // Merge PATH paths with paths passed as parameter
    for (const path_dir of path_dirs) {
        if (!extra_paths.includes(path_dir)) {
            extra_paths.push(path_dir);
        }
    }
    const result = await find_program_in_paths(extra_paths, names, version, check_latest, false);
    if (result.output_path) {
        fnlog(`Found ${names.join(', ')} version ${result.output_version} in ${result.output_path}`);
    }
    return result;
}

/**
 * Removes leading zeros from semver version components.
 *
 * Converts "01.02.03" to "1.2.3" for proper semver comparison.
 *
 * @param version - Version string with potentially leading zeros
 * @returns Cleaned version string without leading zeros
 */
function removeSemverLeadingZeros(version: string): string {
    const components = version.split('.');
    const cleanedComponents = components.map(component => parseInt(component, 10));
    return cleanedComponents.join('.');
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

/**
 * Escapes special regex characters in a string.
 *
 * @param string - String to escape for use in a regular expression
 * @returns Escaped string safe for regex pattern construction
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Searches for and installs a program using APT package manager on Linux.
 *
 * Searches APT repositories for packages matching the specified names and version,
 * then installs the best matching package. Falls back to alternative packages or
 * aptitude if the initial installation fails.
 *
 * @param names - Array of package/executable names to search for
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param check_latest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 * @throws Error if apt-cache commands fail unexpectedly
 */
export async function find_program_with_apt(names: string[], version: string, check_latest: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_with_apt: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;
    let installed_package: string | null = null;

    fnlog('Checking if APT is available');
    try {
        const exitCode = await exec.exec('apt', ['--version']);
        if (exitCode !== 0) {
            fnlog(`apt --version returned ${exitCode}`);
            return { output_version, output_path, installed_package };
        }
    } catch (error) {
        fnlog('APT is not available');
        return { output_version, output_path, installed_package };
    }

    // Find program "name" with APT
    try {
        fnlog(`Searching for ${names.join(', ')} with APT`);
        if (isSudoRequired()) {
            await exec.exec(`sudo -n apt-get update`, [], { ignoreReturnCode: true });
        } else {
            await exec.exec(`apt-get update`, [], { ignoreReturnCode: true });
        }
        const package_names: string[] = [];
        for (const name of names) {
            const search_expression = `${escapeRegExp(name)}(-[0-9\\.]+)?`;
            fnlog(`Searching for packages matching ${search_expression}`);
            const output: ExecOutput = await exec.getExecOutput('apt-cache', ['search', `^${search_expression}$`]);
            const apt_output = output.stdout.trim();
            if (output.exitCode === 0) {
                fnlog(`apt-cache search. Exit code ${output.exitCode}`);
            } else {
                throw new Error(`Failed to run apt-cache search. Exit code ${output.exitCode}`);
            }
            const apt_lines = apt_output.split('\n');
            for (const apt_line of apt_lines) {
                const apt_line_regex = new RegExp(`^(${search_expression}) `);
                const apt_line_matches = apt_line.match(apt_line_regex);
                if (apt_line_matches !== null) {
                    const apt_version = apt_line_matches[1];
                    package_names.push(apt_version);
                }
            }
        }
        fnlog(`Found packages [${package_names.join(', ')}]`);

        fnlog(`Listing all versions of packages [${package_names.join(', ')}]`);
        let package_match: string | null = null;
        let package_version_match: string | null = null;
        let package_match_tier: PackagePreferenceTier = PackagePreferenceTier.OTHER_VERSIONED;
        const install_matches: string[] = [];
        for (const package_name of package_names) {
            const output: ExecOutput = await exec.getExecOutput('apt-cache', ['showpkg', package_name], { silent: true });
            const showpkg_output = output.stdout.trim();
            if (output.exitCode !== 0) {
                throw new Error(`Failed to run "apt-cache showpkg '${package_name}'"`);
            } else if (output.stdout.trim() === '') {
                fnlog('No output from apt-cache showpkg ' + package_name);
            }
            const showpkg_lines = showpkg_output.split('\n');
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

            // Get preference tier for this package
            const pkg_tier = getPackagePreferenceTier(package_name, names);
            fnlog(`Package ${package_name} has preference tier ${pkg_tier}`);

            // Filter the versions that install the required program version
            for (const package_version of package_versions) {
                // a limited list of common formats to express versions in apt package names
                const version_regexes = [/\d+:(\d+.\d+)-\d+/, /\d+:(\d+)-\d+/, /(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
                let pkg_version_str: string | null = null;
                for (const version_regex of version_regexes) {
                    const version_matches = package_version.match(version_regex);
                    if (version_matches !== null) {
                        pkg_version_str = removeSemverLeadingZeros(version_matches[1]);
                        const pkg_version = semver.coerce(pkg_version_str);
                        const satisfies = pkg_version !== null ? semver.satisfies(pkg_version, version) : true;
                        if (!satisfies) {
                            fnlog(`Package ${package_name}=${package_version} version ${pkg_version} does NOT satisfy ${names.join(', ')} version ${version}`);
                        } else {
                            install_matches.push(`${package_name}=${package_version}`);
                            // Selection priority:
                            // 1. Better tier (lower number) always wins
                            // 2. Same tier: use check_latest to pick best version
                            const isBetterTier = pkg_tier < package_match_tier;
                            const isSameTier = pkg_tier === package_match_tier;
                            const isBetterVersion = pkg_version !== null && output_version !== null &&
                                ((check_latest && semver.gt(pkg_version, output_version)) ||
                                 (!check_latest && semver.lt(pkg_version, output_version)));
                            const isFirstMatch = output_version === null;

                            if (pkg_version !== null && (isFirstMatch || isBetterTier || (isSameTier && isBetterVersion))) {
                                fnlog(`Package ${package_name}=${package_version} version ${pkg_version} (tier ${pkg_tier}) selected as best match for ${names.join(', ')} version ${version}`);
                                package_match = package_name;
                                package_version_match = package_version;
                                package_match_tier = pkg_tier;
                                output_version = pkg_version.toString();
                            }
                        }
                        break;
                    }
                }
            }
        }

        // Install the package name and version that match the requirements
        if (package_match !== null) {
            let install_pkg = package_match;
            if (package_version_match !== null) {
                install_pkg = `${package_match}=${package_version_match}`;
            }

            fnlog(`Installing ${install_pkg}`);
            const opts = {
                env: {
                    DEBIAN_FRONTEND: 'noninteractive',
                    TZ: 'Etc/UTC',
                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                },
                ignoreReturnCode: true
            };

            // Install the package with the best match for the requirements
            let apt_get_exit_code: number;
            if (isSudoRequired()) {
                apt_get_exit_code = await exec.exec(`sudo -n apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts);
            } else {
                apt_get_exit_code = await exec.exec(`apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts);
            }

            if (apt_get_exit_code === 0) {
                installed_package = package_match;
            } else {
                fnlog(`Failed to install ${install_pkg}. Trying aptitude and alternatives packages [${install_matches.join(', ')}]`);
                // Check if aptitude is available
                let aptitude_path: string | null;
                try {
                    aptitude_path = await io.which('aptitude');
                } catch (error) {
                    aptitude_path = null;
                }
                if (aptitude_path !== null && aptitude_path !== '') {
                    // retry with aptitude, which can solve unmet dependencies
                    if (isSudoRequired()) {
                        apt_get_exit_code = await exec.exec(`sudo -n aptitude install -f -y ${install_pkg}`, [], opts);
                    } else {
                        apt_get_exit_code = await exec.exec(`aptitude install -f -y ${install_pkg}`, [], opts);
                    }
                    if (apt_get_exit_code === 0) {
                        installed_package = package_match;
                    }
                } else {
                    fnlog(`aptitude unavailable.`);
                }
            }

            // If the installation failed, try other versions that also satisfy the requirements
            if (apt_get_exit_code !== 0) {
                fnlog(`Trying alternatives packages [${install_matches.join(', ')}]`);
                for (const install_match of install_matches) {
                    if (isSudoRequired()) {
                        apt_get_exit_code = await exec.exec(`sudo -n apt-get install -f -y --allow-downgrades ${install_match}`, [], opts);
                    } else {
                        apt_get_exit_code = await exec.exec(`apt-get install -f -y --allow-downgrades ${install_match}`, [], opts);
                    }
                    if (apt_get_exit_code === 0) {
                        // Extract package name from "package=version" format
                        installed_package = install_match.split('=')[0];
                        break;
                    }
                }
            }

            const result = await find_program_in_system_paths([], names, version, check_latest);
            output_version = result.output_version;
            output_path = result.output_path;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
    }
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
 * Recursively finds all subdirectories within a directory.
 *
 * @param directory - Root directory to search
 * @returns Array of absolute paths to all nested subdirectories
 */
function getAllSubdirectories(directory: string): string[] {
    const subdirectories: string[] = [];

    function traverse(currentDir: string): void {
        const files = fs.readdirSync(currentDir);

        files.forEach(file => {
            const filePath = path.join(currentDir, file);
            const fileStat = fs.statSync(filePath);

            if (fileStat.isDirectory()) {
                subdirectories.push(filePath);
                traverse(filePath);
            }
        });
    }

    traverse(directory);
    return subdirectories;
}

/**
 * Renders a template string by replacing placeholders with data values.
 *
 * Placeholders use mustache-style syntax: {{key}}.
 *
 * @param template - Template string with {{key}} placeholders
 * @param data - Object mapping placeholder keys to replacement values
 * @returns Rendered string with placeholders replaced
 */
function renderTemplate(template: string, data: Record<string, string | number>): string {
    const tokenRegex = /{{\s*([^\s{}]+)\s*}}/g;
    return template.replaceAll(tokenRegex, (match, key) => {
        const value = data[key];
        return value !== undefined ? String(value) : match;
    });
}

/**
 * Returns the GitHub Actions runner OS name based on current platform.
 *
 * @returns "Windows", "macOS", or "Linux" depending on process.platform
 */
function get_runner_os(): string {
    const platform = process.platform;
    if (platform === 'win32') {
        return 'Windows';
    } else if (platform === 'darwin') {
        return 'macOS';
    } else {
        return 'Linux';
    }
}

/**
 * Checks if a file path is a symbolic link.
 *
 * @param filePath - Path to check
 * @returns True if the path is a symlink, false otherwise
 */
function isSymlink(filePath: string): boolean {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isSymbolicLink();
    } catch (error) {
        trace_commands.log('An error occurred while checking if the path is a symlink:' + String(error));
        return false;
    }
}

/**
 * Copies a symbolic link to a new location.
 *
 * Recreates the symlink at the destination pointing to the same target.
 *
 * @param sourcePath - Path to the source symlink
 * @param destinationPath - Path where the symlink should be created
 * @param level - Recursion depth for logging indentation
 */
function copySymlink(sourcePath: string, destinationPath: string, level = 0): void {
    const targetPath = fs.readlinkSync(sourcePath);
    const levelPrefix = ' '.repeat(level * 2);
    trace_commands.log(`${levelPrefix}Symlink found from ${sourcePath} to ${targetPath}`);
    fs.symlinkSync(targetPath, destinationPath);
    trace_commands.log(`${levelPrefix}Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`);
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
    } catch (error) {
        git_path = '';
    }
    if (git_path === '') {
        if (isSudoRequired()) {
            await exec.exec(`sudo -n apt-get update`, [], { ignoreReturnCode: true });
            await exec.exec(`sudo -n apt-get install -y git`, [], { ignoreReturnCode: true });
        } else {
            await exec.exec(`apt-get update`, [], { ignoreReturnCode: true });
            await exec.exec(`apt-get install -y git`, [], { ignoreReturnCode: true });
        }
        try {
            git_path = await io.which('git');
        } catch (error) {
            return null;
        }
    }
    return git_path || null;
}

/**
 * Pauses execution for a specified duration using busy waiting.
 *
 * @param ms - Duration to wait in milliseconds
 */
async function sleep(ms: number): Promise<void> {
    const start = new Date().getTime();
    while (new Date().getTime() < start + ms) {
        // busy wait
    }
}

/**
 * Options for fetching Git tags from a repository.
 */
interface FetchGitTagsOptions {
    maxRetries?: number;
    defaultTags?: string[];
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

let versionsCacheDir: string | null = null;

/**
 * Returns the default directory path for caching version information.
 *
 * @returns Absolute path to the default cache directory
 */
function defaultVersionsCacheDir(): string {
    // Keep caches near the action code, not the caller's CWD
    return path.join(__dirname, '..', 'var', 'cache', 'setup-program');
}

/**
 * Sets the directory used for caching version information files.
 *
 * @param dir - Absolute path to the cache directory
 */
export function setVersionsCacheDir(dir: string): void {
    versionsCacheDir = dir;
}

/**
 * Resolves a filename to a full path within the versions cache directory.
 *
 * If the filename is already absolute, returns it unchanged. Otherwise,
 * prepends the cache directory path.
 *
 * @param filename - Filename or path to resolve
 * @returns Absolute path to the file within the cache directory
 */
export function resolveVersionsCachePath(filename: string): string {
    if (path.isAbsolute(filename)) {
        return filename;
    }
    const baseDir = versionsCacheDir || process.env.SETUP_PROGRAM_CACHE_DIR || defaultVersionsCacheDir();
    return path.join(baseDir, filename);
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
 * Options for cloning a Git repository.
 */
interface CloneGitRepoOptions {
    shallow?: boolean;
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
 * Reads cached version information from a JSON file.
 *
 * @param filename - Filename or path to the cache file
 * @returns Array of version strings if file exists and is valid, null otherwise
 */
export function readVersionsFromFile(filename: string): string[] | null {
    const resolvedFilename = resolveVersionsCachePath(filename);
    try {
        const fileContents = fs.readFileSync(resolvedFilename, 'utf8');
        const versions = JSON.parse(fileContents);
        if (Array.isArray(versions)) {
            return versions;
        }
    } catch (error) {
        // File reading failed or versions couldn't be parsed
    }
    return null;
}

/**
 * Saves version information to a JSON cache file.
 *
 * Creates the parent directory if it doesn't exist.
 *
 * @param versions - Array of version strings to cache
 * @param filename - Filename or path to the cache file
 */
export function saveVersionsToFile(versions: string[], filename: string): void {
    const resolvedFilename = resolveVersionsCachePath(filename);
    try {
        const fileContents = JSON.stringify(versions);
        fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true });
        fs.writeFileSync(resolvedFilename, fileContents, 'utf8');
        trace_commands.log('Versions saved to file.');
    } catch (error) {
        trace_commands.log('Error saving versions to file: ' + String(error));
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
    } catch (error) {
        add_apt_repository_path = null;
    }
    if (add_apt_repository_path === null || add_apt_repository_path === '') {
        if (isSudoRequired()) {
            await ensureSudoIsAvailable();
            await exec.exec(`sudo -n apt-get update`, [], { ignoreReturnCode: true });
            await exec.exec(`sudo -n apt-get install -y software-properties-common`, [], { ignoreReturnCode: true });
        } else {
            await exec.exec(`apt-get update`, [], { ignoreReturnCode: true });
            await exec.exec(`apt-get install -y software-properties-common`, [], { ignoreReturnCode: true });
        }
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
 * Extracts a tar archive to a destination directory.
 *
 * On Windows, uses 7z for extraction. On other platforms, uses the native
 * tar command via tc.extractTar.
 *
 * @param tarPath - Path to the tar archive file
 * @param destPath - Destination directory for extraction
 * @param flags - Optional tar flags (e.g., "-xz" for gzip)
 * @returns Path to the extracted contents
 * @throws Error if extraction fails
 */
async function extractTar(tarPath: string, destPath: string | undefined, flags: string | undefined = undefined): Promise<string> {
    function fnlog(msg: string): void {
        trace_commands.log('extractTar: ' + msg);
    }

    const IS_WINDOWS = process.platform === 'win32';
    if (!IS_WINDOWS) {
        return await tc.extractTar(tarPath, destPath, flags);
    } else {
        // Define the destPath
        flags = flags || '';
        const tarFilename = path.basename(tarPath);
        const tarBasename = path.basename(tarFilename, path.extname(tarFilename));
        if (destPath === undefined) {
            destPath = path.join(os.tmpdir(), tarBasename);
            await io.mkdirP(destPath);
        }
        // Define the intermediary paths
        const isTwoStep = !tarPath.endsWith('.tar');
        const firstDestPath = path.join(os.tmpdir(), tarBasename + '_1st');
        await io.mkdirP(firstDestPath);
        const secondDestPath = path.join(os.tmpdir(), tarBasename + '_2nd');
        if (isTwoStep) {
            await io.mkdirP(secondDestPath);
        }
        const finalDestPath = destPath;
        await io.mkdirP(finalDestPath);

        fnlog(`First destination path: ${firstDestPath}`);
        fnlog(`Second destination path: ${secondDestPath}`);
        fnlog(`Final destination path: ${finalDestPath}`);

        // First step
        const path7z = await io.which('7z', true);
        const args = ['x', tarPath, `-o${firstDestPath}`].concat(flags.includes('v') ? ['-bb1'] : []);
        const { exitCode, stderr }: ExecOutput = await exec.getExecOutput(path7z, args);
        if (exitCode !== 0) {
            throw new Error(`Failed to extract ${tarPath} to ${firstDestPath} with 7z: ${stderr}`);
        }

        async function copyFilesAndRemoveDir(sourcePath: string, destPath: string): Promise<string> {
            fnlog(`Moving ${sourcePath} to ${destPath}`);
            const files = fs.readdirSync(sourcePath);
            for (const file of files) {
                const sourceFilePath = path.join(sourcePath, file);
                const destFilePath = path.join(destPath, file);
                fnlog(`Copying ${sourceFilePath} to ${destFilePath}`);
                await io.cp(sourceFilePath, destFilePath, { recursive: true });
            }
            fnlog(`Removing ${sourcePath}`);
            await io.rmRF(sourcePath);
            return destPath;
        }

        if (!isTwoStep) {
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }

        // Find tar file for the second step
        // The tar archive is compressed so 7z produces a .tar file and leaves
        // it in the destination directory. So now we extract the tar
        // file with 7z.
        const files = fs.readdirSync(firstDestPath);
        if (files.length > 1) {
            // It extracted more than one file, so we assume it's the deflated
            // tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }
        const tarFiles = files.filter(file => file.endsWith('.tar'));
        if (tarFiles.length === 0) {
            // No tar file, so we assume it's the deflated tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath);
        }

        // Second step
        const tarFile = path.join(firstDestPath, tarFiles[0]);
        fnlog(`Extracting ${tarFile} to ${secondDestPath} with 7z`);
        const args2 = ['x', tarFile, `-o${secondDestPath}`].concat(flags.includes('v') ? ['-bb1'] : []);
        const { exitCode: exitCode2, stderr: stderr2 }: ExecOutput = await exec.getExecOutput(path7z, args2);
        if (exitCode2 !== 0) {
            throw new Error(`Failed to extract ${tarFile} to ${secondDestPath} with 7z: ${stderr2}`);
        }
        if (secondDestPath !== finalDestPath) {
            await copyFilesAndRemoveDir(secondDestPath, finalDestPath);
        }
        if (firstDestPath !== finalDestPath) {
            fnlog(`Removing ${firstDestPath}`);
            await io.rmRF(firstDestPath);
        }
        return finalDestPath;
    }
}

/**
 * Downloads and extracts an archive from a URL.
 *
 * Supports .zip, .tar, .tar.gz, .tar.xz, .tar.bz2, .7z, and .pkg (macOS) formats.
 * Uses 7z for extraction on Windows.
 *
 * @param url - URL of the archive to download
 * @param destPath - Optional destination directory for extraction
 * @returns Path to the extracted contents, or undefined if extraction failed
 */
export async function downloadAndExtract(url: string, destPath: string | undefined = undefined): Promise<string | undefined> {
    function fnlog(msg: string): void {
        trace_commands.log('downloadAndExtract: ' + msg);
    }

    let extPath: string | undefined = undefined;
    try {
        let toolPath = await tc.downloadTool(url);
        fnlog(`Downloaded ${url} to ${toolPath}`);
        // Resolve the destination path if not undefined
        if (destPath !== undefined) {
            // Resolve the destination path if relative
            if (!path.isAbsolute(destPath)) {
                destPath = path.resolve(destPath);
                fnlog(`Destination path is relative. Resolved to ${destPath}`);
            }
            // Create destination directory
            if (!fs.existsSync(destPath)) {
                fnlog(`Creating directory ${destPath}`);
                await io.mkdirP(destPath);
            }
        }
        // Rename the toolPath filename to match the URL filename
        const urlFilename = path.basename(url);
        const isValidFilenameChars = /^[a-z0-9._-]+$/i.test(urlFilename);
        if (isValidFilenameChars) {
            // Rename only if the filename is valid
            // Renaming makes the archive file name consistent with the URL
            // and easier for tools to recognize the archive type
            const newToolPath = path.join(path.dirname(toolPath), urlFilename);
            await io.mv(toolPath, newToolPath);
            fnlog(`Renamed ${toolPath} to ${newToolPath}`);
            toolPath = newToolPath;
        }
        // Patches for Windows
        if (process.platform === 'win32' && destPath !== undefined) {
            // https://github.com/actions/toolkit/pull/180
            destPath = destPath.replace(/\\/g, '/');
            toolPath = toolPath.replace(/\\/g, '/');
        }
        // Extract
        if (url.endsWith('.zip')) {
            extPath = await tc.extractZip(toolPath, destPath);
        } else if (url.endsWith('.tar')) {
            const flags = trace_commands.enabled() ? '-vx' : '-x';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.gz')) {
            const flags = trace_commands.enabled() ? '-vxz' : '-xz';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.xz')) {
            const flags = trace_commands.enabled() ? '-vxJ' : '-xJ';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.tar.bz2')) {
            const flags = trace_commands.enabled() ? '-vxj' : '-xj';
            extPath = await extractTar(toolPath, destPath, flags);
        } else if (url.endsWith('.7z')) {
            extPath = await tc.extract7z(toolPath, destPath);
        } else if (process.platform === 'darwin' && url.endsWith('.pkg')) {
            extPath = await tc.extractXar(toolPath, destPath);
        } else {
            fnlog(`Unsupported archive format: ${path.basename(url)}`);
            return extPath;
        }
        fnlog(`Extracted ${toolPath} to ${extPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
        extPath = undefined;
    }
    return extPath;
}

/**
 * Strips a single nested directory from an extracted archive path.
 *
 * When archives contain a single top-level directory (common pattern),
 * moves its contents up one level to simplify the path structure.
 *
 * @param dirPath - Directory path to check and potentially flatten
 * @returns True if a directory was stripped, false otherwise
 */
export async function stripSingleDirectoryFromPath(dirPath: string): Promise<boolean> {
    function fnlog(msg: string): void {
        trace_commands.log('stripSingleDirectoryFromPath: ' + msg);
    }

    fnlog(`Checking if ${dirPath} contains a single directory`);
    const files = fs.readdirSync(dirPath);
    if (files.length === 1) {
        const subPath = path.join(dirPath, files[0]);
        fnlog(`Single file found in ${dirPath}: ${subPath}`);
        const fileStat = fs.statSync(subPath);
        if (fileStat.isDirectory()) {
            // List all files in subpath
            const subFiles = fs.readdirSync(subPath);
            fnlog(`Strip files from ${subPath}: [${subFiles.join(', ')}]`);

            // Move everything to the parent directory
            for (const file of subFiles) {
                const sourcePath = path.join(subPath, file);
                const destPath = path.join(dirPath, file);
                await io.mv(sourcePath, destPath);
            }
            return true;
        } else {
            fnlog(`Single file is not a directory: ${subPath}`);
        }
    }
    return false;
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

let lastInputsForErrors: SetupProgramInputs | undefined = undefined;

/**
 * Main entry point for the setup-program GitHub Action.
 *
 * Parses inputs, searches for the program in various locations,
 * and optionally installs it from a URL if not found.
 */
async function run(): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log('setup-program: ' + msg);
    }

    const inputs: SetupProgramInputs = {
        name: gh_inputs.getArray('name', / /, undefined, { required: true } as unknown as Record<string, unknown>),
        version: gh_inputs.getInput('version', { defaultValue: '*' } as unknown as Record<string, unknown>),
        paths: gh_inputs.getArray('path', /[:;]/),
        check_latest: gh_inputs.getBoolean('check-latest'),
        update_environment: gh_inputs.getBoolean('update-environment'),
        url: gh_inputs.getInput('url') || null,
        install_prefix: gh_inputs.getInput('install-prefix') || null,
        fail_on_error: gh_inputs.getBoolean('fail-on-error'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    lastInputsForErrors = inputs;

    // Get trace_commands input first
    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

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
    if (inputs.paths && inputs.paths.length > 0) {
        core.startGroup('🔍 Searching in user provided paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in paths [${inputs.paths.join(',')}]`);
        const result = await find_program_in_path(inputs.paths, inputs.version, inputs.check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup system program
    if (output_path === null) {
        core.startGroup('🔍 Searching in system paths');
        core.info(`Searching for ${inputs.name} ${inputs.version} in PATH`);
        const result = await find_program_in_system_paths(inputs.paths, inputs.name, inputs.version, inputs.check_latest);
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
    if (output_version === null && inputs.url !== null) {
        core.startGroup('🚚 Downloading and Installing');
        core.info(`Fetching ${inputs.name} ${inputs.version} from URL`);
        const result = await install_program_from_url(
            inputs.name,
            inputs.version,
            inputs.check_latest,
            inputs.url,
            inputs.update_environment,
            inputs.install_prefix);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    } else {
        if (output_version !== null) {
            fnlog(`Skipping download step because ${inputs.name} ${output_version} was already found in ${output_path}`);
        } else if (inputs.url === null) {
            fnlog(`Skipping download step because no URL was provided. URL: ${inputs.url}`);
        }
    }

    // Parse Final program / Setup version / Outputs
    core.startGroup('📤 Return outputs');
    if (output_path) {
        const semverVersion = output_version !== null ?
            semver.coerce(output_version, { loose: true }) :
            semver.coerce('0.0.0', { loose: true });
        if (semverVersion) {
            const outputs = {
                path: output_path,
                dir: path.dirname(output_path),
                version: semverVersion.toString(),
                version_major: semverVersion.major,
                version_minor: semverVersion.minor,
                version_patch: semverVersion.patch,
                found: true
            };
            core.startGroup('📤 Action Outputs');
            gh_inputs.setOutputObject(outputs);
            core.endGroup();
        }
    } else {
        core.setOutput('found', false);
        if (inputs.fail_on_error) {
            core.setFailed('Cannot find program');
        } else {
            core.info('Cannot find program');
        }
    }
    core.endGroup();
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            let hint = 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            if (lastInputsForErrors) {
                const inputs = lastInputsForErrors as SetupProgramInputs;
                if (inputs.trace_commands) {
                    hint = 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.';
                }
            }
            await reportAndSetFailed(error as Error, {
                title: 'Setup program failed',
                hint,
                locals: () => ({ inputs: lastInputsForErrors }),
                includeStackInSetFailed: true
            });
        }
    })();
}
