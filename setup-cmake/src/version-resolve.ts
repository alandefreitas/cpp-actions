/**
 * CMake version resolution and requirements parsing.
 *
 * @module version-resolve
 */

import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';

/**
 * Updates version requirements based on cmake_minimum_required in a CMakeLists.txt file.
 *
 * @param cmakeFile - Path to CMakeLists.txt or directory containing it
 * @param version - Current version requirement
 * @param allVersions - List of all available CMake versions
 * @returns Updated version requirement merged with CMake file requirements
 */
export function updateCMakeVersionFromFile(cmakeFile: string, version: string, allVersions: string[]): string {
    const fnlog = traceCommands.scoped('updateCMakeVersionFromFile');

    if (!cmakeFile) {
        fnlog('No CMake file specified');
        return version;
    }

    // Check if cmakeFile exists
    let cmakeFilePath = path.resolve(process.cwd(), cmakeFile);
    fnlog(`cmakeFile: ${cmakeFile} resolved to ${cmakeFilePath}`);
    if (!fs.existsSync(cmakeFilePath)) {
        fnlog(`CMake file ${cmakeFilePath} does not exist`);
        return version;
    }

    if (fs.lstatSync(cmakeFilePath).isDirectory()) {
        fnlog(`CMake file ${cmakeFilePath} is a directory`);
        cmakeFilePath = path.join(cmakeFilePath, 'CMakeLists.txt');
        if (!fs.existsSync(cmakeFilePath)) {
            fnlog(`CMake file ${cmakeFilePath} also does not exist`);
            return version;
        }
        return updateCMakeVersionFromFile(cmakeFilePath, version, allVersions);
    }

    // Read cmakeFile
    fnlog(`Reading Cmake file ${cmakeFilePath}`);
    const cmakeFileContent = fs.readFileSync(cmakeFilePath, 'utf8');

    // Extract requirement from CMakeLists.txt
    // cmake_minimum_required(VERSION <min>[...<policy_max>] [FATAL_ERROR])
    const regex = /\s*cmake_minimum_required\(VERSION\s+(\d+(\.\d+)?)(?:\s*\.\.\.\s*(\d+(\.\d+)?))?\s*(?:FATAL_ERROR)?\)/;
    let cmakeFileRequirement: string | undefined;
    const match = cmakeFileContent.match(regex);
    if (match) {
        fnlog(`Matched: ${match[0]}`);
        cmakeFileRequirement = match[1];
        fnlog(`CMake file requirement: ${cmakeFileRequirement}`);
    }

    if (!cmakeFileRequirement) {
        fnlog(`Could not find CMake file requirement in ${cmakeFilePath}`);
        fnlog(`File contents: ${cmakeFileContent}`);
        return version;
    }

    // Merge version requirements
    try {
        const semverSV = semver.coerce(cmakeFileRequirement);
        if (semverSV !== null) {
            cmakeFileRequirement = '>=' + semverSV.toString();
            fnlog(`Coerced cMake file requirement: ${cmakeFileRequirement}`);
            if (!version || version === '*') {
                version = cmakeFileRequirement;
            } else if (semver.intersects(version, cmakeFileRequirement)) {
                // If ranges don't intersect, `version` has priority
                // If the intersect, then we need to merge the ranges
                const matchingVersions = allVersions
                    .filter((v) =>
                        semver.satisfies(v, cmakeFileRequirement!) && semver.satisfies(v, version));
                fnlog(`Matching versions: ${matchingVersions}`);
                if (!matchingVersions) {
                    fnlog(`No matching versions for ${cmakeFileRequirement} and ${version}`);
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
        fnlog(`Error parsing CMake file requirement ${cmakeFileRequirement} as semver string: ${error}`);
    }

    return version;
}
