/**
 * CMake version resolution and requirements parsing.
 *
 * @module version-resolve
 */

import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as trace_commands from 'trace-commands';

/**
 * Updates version requirements based on cmake_minimum_required in a CMakeLists.txt file.
 *
 * @param cmake_file - Path to CMakeLists.txt or directory containing it
 * @param version - Current version requirement
 * @param allVersions - List of all available CMake versions
 * @returns Updated version requirement merged with CMake file requirements
 */
export function updateCMakeVersionFromFile(cmake_file: string, version: string, allVersions: string[]): string {
    function fnlog(msg: string): void {
        trace_commands.log('updateCMakeVersionFromFile: ' + msg);
    }

    if (!cmake_file) {
        fnlog('No CMake file specified');
        return version;
    }

    // Check if cmake_file exists
    let cmake_file_path = path.resolve(process.cwd(), cmake_file);
    fnlog(`cmake_file: ${cmake_file} resolved to ${cmake_file_path}`);
    if (!fs.existsSync(cmake_file_path)) {
        fnlog(`CMake file ${cmake_file_path} does not exist`);
        return version;
    }

    if (fs.lstatSync(cmake_file_path).isDirectory()) {
        fnlog(`CMake file ${cmake_file_path} is a directory`);
        cmake_file_path = path.join(cmake_file_path, 'CMakeLists.txt');
        if (!fs.existsSync(cmake_file_path)) {
            fnlog(`CMake file ${cmake_file_path} also does not exist`);
            return version;
        }
        return updateCMakeVersionFromFile(cmake_file_path, version, allVersions);
    }

    // Read cmake_file
    fnlog(`Reading Cmake file ${cmake_file_path}`);
    const cmake_file_content = fs.readFileSync(cmake_file_path, 'utf8');

    // Extract requirement from CMakeLists.txt
    // cmake_minimum_required(VERSION <min>[...<policy_max>] [FATAL_ERROR])
    const regex = /\s*cmake_minimum_required\(VERSION\s+(\d+(\.\d+)?)(?:\s*\.\.\.\s*(\d+(\.\d+)?))?\s*(?:FATAL_ERROR)?\)/;
    let cmake_file_requirement: string | undefined;
    const match = cmake_file_content.match(regex);
    if (match) {
        fnlog(`Matched: ${match[0]}`);
        cmake_file_requirement = match[1];
        fnlog(`CMake file requirement: ${cmake_file_requirement}`);
    }

    if (!cmake_file_requirement) {
        fnlog(`Could not find CMake file requirement in ${cmake_file_path}`);
        fnlog(`File contents: ${cmake_file_content}`);
        return version;
    }

    // Merge version requirements
    try {
        const semverSV = semver.coerce(cmake_file_requirement);
        if (semverSV !== null) {
            cmake_file_requirement = '>=' + semverSV.toString();
            fnlog(`Coerced cMake file requirement: ${cmake_file_requirement}`);
            if (!version || version === '*') {
                version = cmake_file_requirement;
            } else if (semver.intersects(version, cmake_file_requirement)) {
                // If ranges don't intersect, `version` has priority
                // If the intersect, then we need to merge the ranges
                const matchingVersions = allVersions
                    .filter((v) =>
                        semver.satisfies(v, cmake_file_requirement!) && semver.satisfies(v, version));
                fnlog(`Matching versions: ${matchingVersions}`);
                if (!matchingVersions) {
                    fnlog(`No matching versions for ${cmake_file_requirement} and ${version}`);
                    fnlog(`Setting version requirement to ${version}`);
                    return version;
                } else {
                    // Create a range string from the matching versions
                    const mergedRange = matchingVersions.join(' || ');
                    const simplifiedRange = semver.simplifyRange(allVersions, mergedRange);
                    version = typeof simplifiedRange === 'string' ? simplifiedRange : simplifiedRange.toString();
                    fnlog(`Merged version requirement to ${version}`);
                }
            }
        }
    } catch (error) {
        fnlog(`Error parsing CMake file requirement ${cmake_file_requirement} as semver string: ${error}`);
    }

    return version;
}
