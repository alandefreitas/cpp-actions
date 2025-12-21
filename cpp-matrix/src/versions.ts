/**
 * Version handling utilities for cpp-matrix action.
 *
 * @module versions
 */

import * as semver from 'semver';
import * as path from 'path';
import * as trace_commands from 'trace-commands';

import { SubrangePolicies, SubrangePolicy } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

const defaultCacheDir = process.env.CPP_MATRIX_CACHE_DIR || path.join(__dirname, '..', 'var', 'cache', 'cpp-matrix');
setup_program.setVersionsCacheDir(defaultCacheDir);

/**
 * Returns the list of available MSVC toolset versions.
 *
 * Since MSVC is not open source, this returns a hardcoded list of versions
 * known to be available on GitHub Actions runners.
 *
 * @returns Array of available MSVC toolset version strings
 */
export function findMSVCVersions(): string[] {
    // MSVC is not open source, so we assume the versions available from github runner images are available
    // See:
    // https://en.wikipedia.org/wiki/Microsoft_Visual_C%2B%2B
    // It would be nice is there were a way to programmatically get the
    // available images and versions during the build process.
    // We currently need to access:
    // https://github.com/actions/runner-images?tab=readme-ov-file#available-images
    // then check the versions available for each image.

    // Windows Server 2022 image
    // https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md#microsoft-visual-c
    const windows2022 = ['14.29.30133', '14.44.35207'];
    // Windows Server 2025 image
    // https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md#microsoft-visual-c
    const windows2025 = ['14.29.30133', '14.44.35207'];

    // Merge the arrays and remove duplicates
    return [...new Set([...windows2022, ...windows2025])];
}

/**
 * Finds available versions for a given compiler.
 *
 * @param compiler - Compiler name
 * @returns Array of available version strings
 */
export async function findCompilerVersions(compiler: string): Promise<string[]> {
    if (compiler === 'gcc') {
        return await setup_program.findGCCVersions();
    } else if (compiler === 'clang') {
        return await setup_program.findClangVersions();
    } else if (compiler === 'msvc') {
        return findMSVCVersions();
    }
    return [];
}

/**
 * Gets the Visual Studio year from an MSVC version.
 *
 * @param msvc_version - MSVC version string or SemVer
 * @returns Visual Studio year or undefined
 */
export function getVisualCppYear(msvc_version: string | semver.SemVer): string | undefined {
    const v = semver.parse(msvc_version);
    if (!v) return undefined;
    if (semver.gte(v, '14.30.0')) {
        return '2022';
    } else if (semver.gte(v, '14.20.0')) {
        return '2019';
    } else if (semver.gte(v, '14.1.0')) {
        return '2017';
    } else if (semver.gte(v, '14.0.0')) {
        return '2015';
    } else if (semver.gte(v, '12.0.0')) {
        return '2013';
    } else if (semver.gte(v, '11.0.0')) {
        return '2012';
    } else if (semver.gte(v, '10.0.0')) {
        return '2010';
    } else if (semver.gte(v, '9.0.0')) {
        return '2008';
    } else if (semver.gte(v, '8.0.0')) {
        return '2005';
    } else if (semver.gte(v, '7.1.0')) {
        return '2003';
    } else if (semver.gte(v, '7.0.0')) {
        return '2002';
    } else if (semver.gte(v, '6.0.0')) {
        return '2001'; // visual studio 6.0
    } else if (semver.gte(v, '5.0.0')) {
        return '1997'; // visual studio 97
    } else if (semver.gte(v, '4.0.0')) {
        return '1995'; // Visual C++ 4
    } else if (semver.gte(v, '2.0.0')) {
        return '1994'; // Visual C++ 2/3
    } else if (semver.gte(v, '1.0.0')) {
        return '1993'; // Visual C++ 1
    } else if (semver.gte(v, '0.0.0')) {
        return '1989'; // Microsoft C 6.0
    }
    return undefined;
}

/**
 * Checks if two arrays have the same elements.
 *
 * @param arr1 - First array
 * @param arr2 - Second array
 * @returns True if arrays have the same elements
 */
export function arraysHaveSameElements(arr1: unknown[], arr2: unknown[]): boolean {
    if (arr1.length !== arr2.length) {
        return false;
    }

    const sortedArr1 = arr1.slice().sort();
    const sortedArr2 = arr2.slice().sort();

    for (let i = 0; i < sortedArr1.length; i++) {
        if (sortedArr1[i] !== sortedArr2[i]) {
            return false;
        }
    }

    return true;
}

/**
 * Converts a policy string to a SubrangePolicy enum value.
 *
 * @param policyStr - Policy string to convert
 * @returns Corresponding SubrangePolicy value
 */
export function getSubrangePolicy(policyStr: string): SubrangePolicy {
    if (policyStr === 'one-per-major') {
        return SubrangePolicies.ONE_PER_MAJOR;
    } else if (policyStr === 'one-per-minor') {
        return SubrangePolicies.ONE_PER_MINOR;
    } else if (policyStr === 'one-per-major-or-minor') {
        return SubrangePolicies.ONE_PER_MAJOR_OR_MINOR;
    }
    return SubrangePolicies.ONE_PER_MAJOR;
}

/**
 * Converts a SubrangePolicy enum value to its string representation.
 *
 * @param policy - SubrangePolicy value to convert
 * @returns String representation of the policy
 */
export function getSubrangePolicyStr(policy: SubrangePolicy): string {
    if (policy === SubrangePolicies.ONE_PER_MAJOR) {
        return 'one-per-major';
    } else if (policy === SubrangePolicies.ONE_PER_MINOR) {
        return 'one-per-minor';
    } else if (policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR) {
        return 'one-per-major-or-minor';
    }
    return 'one-per-major';
}

/**
 * Splits a semver range into specific version selections based on available versions and policy.
 *
 * Given a version range like ">=10" and available versions [10.0, 10.1, 11.0, 12.0],
 * this function selects specific versions based on the subrange policy (e.g., one per major).
 *
 * @param range - Semver version range to split (e.g., ">=10", "^14.0")
 * @param versions - Array of available version strings to select from
 * @param policy - Selection policy determining how many versions to include
 * @returns Array of specific version strings selected from the range
 */
export function splitRanges(range: string, versions: string[], policy: SubrangePolicy = SubrangePolicies.ONE_PER_MAJOR): string[] {
    function fnlog(msg: string): void {
        trace_commands.log('splitRanges: ' + msg);
    }

    if (versions.length === 0) {
        // We know nothing about the available versions for that compiler, so we just return "*"
        return ['*'];
    }
    fnlog(`range: ${range}`);
    fnlog(`versions: ${versions}`);
    fnlog(`policy: ${getSubrangePolicyStr(policy)}`);

    const parsedVersions = versions.map(s => semver.parse(s)).filter((v): v is semver.SemVer => v !== null);
    const minVersion = semver.minSatisfying(parsedVersions, range);
    const maxVersion = semver.maxSatisfying(parsedVersions, range);
    if (minVersion === null || maxVersion === null) {
        return ['*'];
    }
    fnlog(`minVersion: ${minVersion}`);
    fnlog(`maxVersion: ${maxVersion}`);

    const minSemVer = semver.parse(minVersion);
    const maxSemVer = semver.parse(maxVersion);
    if (!minSemVer || !maxSemVer) {
        return ['*'];
    }

    const major_or_minor_policy = minSemVer.major === maxSemVer.major ? SubrangePolicies.ONE_PER_MINOR : SubrangePolicies.ONE_PER_MAJOR;
    const effective_policy = policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR ? major_or_minor_policy : policy;
    const range_versions = parsedVersions.filter(v => semver.satisfies(v, range));

    let subranges: string[] = [];
    if (effective_policy === SubrangePolicies.ONE_PER_MAJOR) {
        fnlog('Effective policy: ONE_PER_MAJOR');

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minSemVer.major; i <= maxSemVer.major; i++) {
            // Create an initial requirement with just the major version (eg: "9")
            let major_range = i.toString();
            if (semver.subset(major_range, range)) {
                subranges.push(major_range);
                continue;
            }

            // Versions that would satisfy the major requirement regardless of real requirement
            // (eg: 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0)
            let major_versions = parsedVersions.filter(v => semver.satisfies(v, major_range));
            if (major_versions.length === 0) {
                continue;
            }

            // Versions that would satisfy both the major requirement and the input range
            // (eg: 9.3.0, 9.4.0, 9.5.0 when the range is >=9.3)
            let range_major_versions = range_versions.filter(v => semver.satisfies(v, major_range));
            if (range_major_versions.length === 0) {
                continue;
            }

            // If both represent the same versions, this means the major requirement is effectively the same
            if (arraysHaveSameElements(major_versions, range_major_versions)) {
                subranges.push(major_range);
                continue;
            }

            // If the main range satisfies all the highest minors in the major version, then this is
            // a "^" requirement, meaning we should define the minor, and we can update it as we want
            const latest_major_versions = major_versions.slice(-range_major_versions.length);
            if (arraysHaveSameElements(latest_major_versions, range_major_versions)) {
                let major_range = `^${i}.${latest_major_versions[0].minor}`;
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (major_versions.some(v => v.minor === latest_major_versions[0].minor && !semver.satisfies(v, range))) {
                    major_range = `^${latest_major_versions[0].toString()}`;
                }
                subranges.push(major_range);
                continue;
            }

            // If the main range satisfies all the lowest minors in the major version, then this is
            // a <= requirement
            const earliest_major_versions = major_versions.slice(0, range_major_versions.length);
            if (arraysHaveSameElements(earliest_major_versions, range_major_versions)) {
                major_range = `${i} - ${i}.${earliest_major_versions[earliest_major_versions.length - 1].minor}`;
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (major_versions.some(v => v.minor === earliest_major_versions[earliest_major_versions.length - 1].minor && !semver.satisfies(v, range))) {
                    major_range = `${i} - ${earliest_major_versions[earliest_major_versions.length - 1].toString()}`;
                }
                subranges.push(major_range);
                continue;
            }

            // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
            const fromIdx = major_versions.indexOf(range_major_versions[0]);
            const toIdx = major_versions.indexOf(range_major_versions[range_major_versions.length - 1]);
            let fromStr = major_versions[fromIdx].toString();
            if (fromIdx === 0 || major_versions[fromIdx - 1].minor !== major_versions[fromIdx].minor) {
                fromStr = `${major_versions[fromIdx].major}.${major_versions[fromIdx].minor}`;
            }
            let toStr = major_versions[toIdx].toString();
            if (toIdx === major_versions.length - 1 || major_versions[toIdx + 1].minor !== major_versions[toIdx].minor) {
                toStr = `${major_versions[toIdx].major}.${major_versions[toIdx].minor}`;
            }
            subranges.push(`${fromStr} - ${toStr}`);
        }
    }

    if (effective_policy === SubrangePolicies.ONE_PER_MINOR) {
        fnlog('Effective policy: ONE_PER_MINOR');

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minSemVer.major; i <= maxSemVer.major; i++) {
            const unique_minors = parsedVersions
                .filter(v => v.major === i)
                .map(v => v.minor)
                .sort()
                .filter((value, index, self) => self.indexOf(value) === index);
            for (const j of unique_minors) {
                // Create an initial requirement with just the major version (eg: "9")
                let minor_range = `${i}.${j}`;
                if (semver.subset(minor_range, range)) {
                    subranges.push(minor_range);
                    continue;
                }

                // Versions that would satisfy the minor requirement regardless of real requirement
                let minor_versions = parsedVersions.filter(v => semver.satisfies(v, minor_range));
                if (minor_versions.length === 0) {
                    continue;
                }

                // Versions that would satisfy both the minor requirement and the input range
                let range_minor_versions = range_versions.filter(v => semver.satisfies(v, minor_range));
                if (range_minor_versions.length === 0) {
                    continue;
                }

                // If both represent the same versions, this means the major requirement is effectively the same
                if (arraysHaveSameElements(minor_versions, range_minor_versions)) {
                    subranges.push(minor_range);
                    continue;
                }

                // If the main range satisfies all the highest minors in the major version, then this is
                // a "^" requirement, meaning we should define the minor, and we can update it as we want
                const latest_minor_versions = minor_versions.slice(-range_minor_versions.length);
                if (arraysHaveSameElements(latest_minor_versions, range_minor_versions)) {
                    subranges.push(`~${latest_minor_versions[0].toString()}`);
                    continue;
                }

                // If the main range satisfies all the lowest minors in the major version, then this is
                // a <= requirement
                const earliest_minor_versions = minor_versions.slice(0, range_minor_versions.length);
                if (arraysHaveSameElements(earliest_minor_versions, range_minor_versions)) {
                    subranges.push(`${i}.${j} - ${latest_minor_versions[0].toString()}`);
                    continue;
                }

                // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
                const fromIdx = minor_versions.indexOf(range_minor_versions[0]);
                const toIdx = minor_versions.indexOf(range_minor_versions[range_minor_versions.length - 1]);
                let fromStr = minor_versions[fromIdx].toString();
                let toStr = minor_versions[toIdx].toString();
                subranges.push(`${fromStr} - ${toStr}`);
            }
        }
    }

    return subranges;
}
