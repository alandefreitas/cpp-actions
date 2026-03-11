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
import * as traceCommands from 'trace-commands';

import { type ProgramResult, type ExecOutput } from './types';

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
export async function programSatisfies(execPath: string, semverRequirements: string): Promise<string | null> {
    const fnlog = traceCommands.scoped('programSatisfies');

    // Try to run the program and get the version string
    fnlog(`Checking if program ${execPath} version satisfies ${semverRequirements}`);
    let versionOutput: string | null = null;
    try {
        fnlog(`Running ${execPath} --version`);
        const { exitCode, stdout }: ExecOutput = await exec.getExecOutput(`"${execPath}"`, ['--version']);
        fnlog(`Exit code: ${exitCode}`);
        fnlog(`Output: ${stdout.slice(0, 300)}`);
        versionOutput = stdout.trim();
        if (exitCode !== 0) {
            fnlog(`Path program ${execPath} --version exited with code ${exitCode}`);
            return '0.0.0';
        }
    } catch {
        fnlog(`Path program ${execPath} does not have a version string`);
        return '0.0.0';
    }

    const versionRegexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
    let version: semver.SemVer | null = null;
    for (const versionRegex of versionRegexes) {
        const versionMatches = versionOutput.match(versionRegex);
        if (versionMatches !== null) {
            fnlog(`Path program ${execPath} matches version string ${versionMatches[1]}`);
            const versionStr = versionMatches[1];
            version = semver.coerce(versionStr, { includePrerelease: false, loose: true });
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
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @param stopAtFirst - If true, stop searching after finding the first match
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function findProgramInPaths(paths: string[], names: string[], version: string, checkLatest: boolean, stopAtFirst: boolean): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('findProgramInPaths');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;
    let pathLogView: string[] = paths;
    if (paths.length > 10) {
        pathLogView = paths.slice(0, 10).concat(['...']);
    }
    fnlog(`Searching for ${names.join(', ')} ${version} in [${pathLogView.join(', ')}]`);

    // Check if version requirement can be coerced into version
    const execNameCandidates: string[] = [];
    const versionObj = semver.coerce(version);

    for (const name of names) {
        const filenamePrefixes: string[] = [];
        if (versionObj !== null) {
            filenamePrefixes.push(`${name}-${versionObj.major}.${versionObj.minor}.${versionObj.patch}`);
            filenamePrefixes.push(`${name}-${versionObj.major}.${versionObj.minor}`);
            filenamePrefixes.push(`${name}-${versionObj.major}`);
        }
        filenamePrefixes.push(`${name}`);
        const filenameSuffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
        // execNameCandidates is the cross-product of filename prefixes and suffixes
        for (const filenamePrefix of filenamePrefixes) {
            for (const filenameSuffix of filenameSuffixes) {
                execNameCandidates.push(filenamePrefix + filenameSuffix);
            }
        }
    }
    fnlog(`Searching for ${names.join(', ')} ${version} with filenames [${execNameCandidates.join(', ')}]`);

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
        // add each execNameCandidate to dir
        for (const execNameCandidate of execNameCandidates) {
            const execPath = path.join(dir, execNameCandidate);
            if (!fs.existsSync(execPath)) {
                continue;
            }
            if (fs.lstatSync(execPath).isDirectory()) {
                fnlog(`Path ${execPath} is a directory. Skipping it.`);
                continue;
            }
            if (!isExecutable(execPath)) {
                fnlog(`Path program ${execPath} is not an executable.`);
                continue;
            }
            // Execute program in execPath and extract a version string
            core.info(`Found ${execPath}`);
            const thisOutputVersion = await programSatisfies(execPath, version);
            if (thisOutputVersion === null) {
                core.info(`${execPath} does not satisfy requirement ${version}`);
            } else {
                core.info(`Executable version: ${thisOutputVersion} satisfies requirement ${version}`);
            }
            if (outputVersion === null ||
                (checkLatest && typeof (thisOutputVersion) === 'string' && semver.gt(thisOutputVersion, outputVersion)) ||
                (!checkLatest && typeof (thisOutputVersion) === 'string' && semver.lt(thisOutputVersion, outputVersion))) {
                fnlog(`Found ${execPath} with version ${thisOutputVersion}.`);
                if (outputVersion && outputVersion !== thisOutputVersion) {
                    fnlog(`Previous best version was ${outputVersion}.`);
                }
                outputVersion = thisOutputVersion;
                outputPath = execPath;
            }
        }
        if (stopAtFirst && outputVersion !== null && outputVersion !== '0.0.0') {
            break;
        }
    }
    return { outputVersion, outputPath };
}

/**
 * Searches for an executable in system PATH and tool cache directories.
 *
 * Combines the system PATH environment variable with any extra paths provided,
 * and also searches the GitHub Actions runner tool cache for matching executables.
 *
 * @param extraPaths - Additional directories to search before PATH
 * @param names - Array of executable names to search for (e.g., ["gcc", "g++"])
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function findProgramInSystemPaths(extraPaths: string[], names: string[], version: string, checkLatest: boolean): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('findProgramInSystemPaths');

    // Append directories from PATH environment variable to paths
    // Get system PATHs with core
    fnlog(`Looking for ${names.join(', ')} ${version} in system PATH`);
    const pathDirs = process.platform.startsWith('win') ? (process.env.PATH || '').split(/;/) : (process.env.PATH || '').split(/[:;]/);
    fnlog(`Paths in $PATH environment variable: ${pathDirs.slice(0, 10).join(', ')}...`);
    if (process.env['RUNNER_TOOL_CACHE']) {
        fnlog(`RUNNER_TOOL_CACHE environment variable: ${process.env['RUNNER_TOOL_CACHE']}`);
        const cachedToolVersionsPaths: string[] = [];
        for (const name of names) {
            cachedToolVersionsPaths.push(path.join(process.env['RUNNER_TOOL_CACHE'], name));
        }
        for (const cachedToolVersionsPath of cachedToolVersionsPaths) {
            fnlog(`Cached tool versions path: ${cachedToolVersionsPath}`);
            if (fs.existsSync(cachedToolVersionsPath) && fs.lstatSync(cachedToolVersionsPath).isDirectory()) {
                // Iterate all directories in cachedToolVersionsPath at the first level
                const subdirectories = fs.readdirSync(cachedToolVersionsPath)
                    .filter((file) => fs.lstatSync(path.join(cachedToolVersionsPath, file)).isDirectory());
                fnlog(`Adding ${cachedToolVersionsPath} to PATH`);
                pathDirs.push(cachedToolVersionsPath);
                for (const subdirectory of subdirectories) {
                    fnlog(`Adding ${subdirectory} to PATH`);
                    const subdirectoryPath = path.join(cachedToolVersionsPath, subdirectory);
                    pathDirs.push(subdirectoryPath);
                    const subdirectoryBinPath = path.join(subdirectoryPath, 'bin');
                    if (fs.existsSync(subdirectoryBinPath) && fs.lstatSync(subdirectoryBinPath).isDirectory()) {
                        fnlog(`Adding ${subdirectoryBinPath} to PATH`);
                        pathDirs.push(subdirectoryBinPath);
                    }
                }
            }
        }
    }

    // Merge PATH paths with paths passed as parameter
    for (const pathDir of pathDirs) {
        if (!extraPaths.includes(pathDir)) {
            extraPaths.push(pathDir);
        }
    }
    const result = await findProgramInPaths(extraPaths, names, version, checkLatest, false);
    if (result.outputPath) {
        fnlog(`Found ${names.join(', ')} version ${result.outputVersion} in ${result.outputPath}`);
    }
    return result;
}

/**
 * Attempt to resolve an executable by inspecting a list of user-supplied paths.
 *
 * Behaviour depends on each entry:
 * - Basename entries (e.g. "cmake") are treated as hints and forwarded to
 *   {@link findProgramInSystemPaths}, so PATH and cached locations are
 *   still searched with the current version requirement.
 * - Absolute or relative paths are treated as candidate files. On Windows, we
 *   also probe typical executable extensions (".exe", ".cmd", ".bat") when the
 *   entry has no extension. Each candidate must exist, be executable, and
 *   satisfy the supplied semver range; otherwise it is skipped.
 *
 * The function keeps track of the "best" candidate according to the
 * checkLatest flag: the earliest satisfying version when false, the latest
 * when true. Returning {outputVersion: null, outputPath: null} means no valid
 * executable met the constraint (use version="*" to opt out of filtering).
 *
 * @param paths - Array of paths to search for the executable
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function findProgramInPath(paths: string[], version: string, checkLatest: boolean): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('findProgramInPath');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;
    if (paths.length > 1) {
        fnlog(`Searching for program version ${version} in paths [${paths.join(', ')}]`);
    }
    for (const execPath of paths) {
        if (execPath === '') {
            continue;
        }
        fnlog(`Searching for program version ${version} in "${execPath}"`);

        // Find as a program in path if only basename is provided
        const isBasenameOnly = path.basename(execPath) === execPath;
        if (isBasenameOnly) {
            const result = await findProgramInSystemPaths([], [execPath], version, checkLatest);
            if (result.outputPath && result.outputVersion) {
                fnlog(`Found program ${execPath} in system paths (${result.outputPath} - version ${result.outputVersion}).`);
                return { outputVersion: result.outputVersion, outputPath: result.outputPath };
            }
        }

        // Find as a file in path
        const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
        for (const extension of extensions) {
            const filePath = execPath + extension;
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
            const thisOutputVersion = await programSatisfies(filePath, version);
            const hasNoOutputVersionYet = outputVersion === null;
            const realVersionParsed = thisOutputVersion !== '0.0.0';
            const satisfiedRequirements = thisOutputVersion !== null;
            if (hasNoOutputVersionYet ||
                (realVersionParsed && satisfiedRequirements) ||
                (checkLatest && thisOutputVersion !== null && outputVersion !== null && semver.gt(thisOutputVersion, outputVersion)) ||
                (!checkLatest && thisOutputVersion !== null && outputVersion !== null && semver.lt(thisOutputVersion, outputVersion))) {
                outputVersion = thisOutputVersion;
                outputPath = filePath;
            }
        }
    }
    return { outputVersion, outputPath };
}
