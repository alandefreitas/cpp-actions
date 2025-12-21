/**
 * Program search utilities for setup-program action.
 *
 * @module program-search
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as trace_commands from 'trace-commands';

import { ProgramResult, ExecOutput } from './types';

/**
 * Checks if a file at the given path is executable.
 *
 * On Windows, checks for .exe, .cmd, or .bat extensions.
 * On other platforms, checks the file's executable permission bit.
 *
 * @param filePath - Path to the file to check
 * @returns True if the file exists and is executable, false otherwise
 */
export function isExecutable(filePath: string): boolean {
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
export async function program_satisfies(execPath: string, semverRequirements: string): Promise<string | null> {
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
export async function find_program_in_paths(paths: string[], names: string[], version: string, check_latest: boolean, stop_at_first: boolean): Promise<ProgramResult> {
    function fnlog(msg: string): void {
        trace_commands.log('find_program_in_paths: ' + msg);
    }

    let output_version: string | null = null;
    let output_path: string | null = null;
    let path_log_view: string[] = paths;
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
