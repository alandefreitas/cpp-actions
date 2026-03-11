/**
 * Version handling utilities for cpp-matrix action.
 *
 * @module versions
 */

import * as semver from 'semver';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

/**
 * Policies for selecting versions from a semver range when generating matrix entries.
 *
 * These policies control which specific versions are selected when a version range
 * would match multiple available versions (e.g., what to do with ">=10" when 10, 11, 12 exist).
 */
export const SubrangePolicies = {
    ONE_PER_MAJOR: 0,
    ONE_PER_MINOR: 1,
    ONE_PER_MAJOR_OR_MINOR: 2
} as const;

/**
 * A policy for handling version subranges in the matrix.
 */
export type SubrangePolicy = typeof SubrangePolicies[keyof typeof SubrangePolicies];

import * as setup_program from 'setup-program';

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
 * @param msvcVersion - MSVC version string or SemVer
 * @returns Visual Studio year or undefined
 */
export function getVisualCppYear(msvcVersion: string | semver.SemVer): string | undefined {
    const v = semver.parse(msvcVersion);
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
    const fnlog = traceCommands.scoped('splitRanges');

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

    const majorOrMinorPolicy = minSemVer.major === maxSemVer.major ? SubrangePolicies.ONE_PER_MINOR : SubrangePolicies.ONE_PER_MAJOR;
    const effectivePolicy = policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR ? majorOrMinorPolicy : policy;
    const rangeVersions = parsedVersions.filter(v => semver.satisfies(v, range));

    const subranges: string[] = [];
    if (effectivePolicy === SubrangePolicies.ONE_PER_MAJOR) {
        fnlog('Effective policy: ONE_PER_MAJOR');

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minSemVer.major; i <= maxSemVer.major; i++) {
            // Create an initial requirement with just the major version (eg: "9")
            let majorRange = i.toString();
            if (semver.subset(majorRange, range)) {
                subranges.push(majorRange);
                continue;
            }

            // Versions that would satisfy the major requirement regardless of real requirement
            // (eg: 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0)
            const majorVersions = parsedVersions.filter(v => semver.satisfies(v, majorRange));
            if (majorVersions.length === 0) {
                continue;
            }

            // Versions that would satisfy both the major requirement and the input range
            // (eg: 9.3.0, 9.4.0, 9.5.0 when the range is >=9.3)
            const rangeMajorVersions = rangeVersions.filter(v => semver.satisfies(v, majorRange));
            if (rangeMajorVersions.length === 0) {
                continue;
            }

            // If both represent the same versions, this means the major requirement is effectively the same
            if (arraysHaveSameElements(majorVersions, rangeMajorVersions)) {
                subranges.push(majorRange);
                continue;
            }

            // If the main range satisfies all the highest minors in the major version, then this is
            // a "^" requirement, meaning we should define the minor, and we can update it as we want
            const latestMajorVersions = majorVersions.slice(-rangeMajorVersions.length);
            if (arraysHaveSameElements(latestMajorVersions, rangeMajorVersions)) {
                let majorRange = `^${i}.${latestMajorVersions[0].minor}`;
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (majorVersions.some(v => v.minor === latestMajorVersions[0].minor && !semver.satisfies(v, range))) {
                    majorRange = `^${latestMajorVersions[0].toString()}`;
                }
                subranges.push(majorRange);
                continue;
            }

            // If the main range satisfies all the lowest minors in the major version, then this is
            // a <= requirement
            const earliestMajorVersions = majorVersions.slice(0, rangeMajorVersions.length);
            if (arraysHaveSameElements(earliestMajorVersions, rangeMajorVersions)) {
                majorRange = `${i} - ${i}.${earliestMajorVersions[earliestMajorVersions.length - 1].minor}`;
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (majorVersions.some(v => v.minor === earliestMajorVersions[earliestMajorVersions.length - 1].minor && !semver.satisfies(v, range))) {
                    majorRange = `${i} - ${earliestMajorVersions[earliestMajorVersions.length - 1].toString()}`;
                }
                subranges.push(majorRange);
                continue;
            }

            // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
            const fromIdx = majorVersions.indexOf(rangeMajorVersions[0]);
            const toIdx = majorVersions.indexOf(rangeMajorVersions[rangeMajorVersions.length - 1]);
            let fromStr = majorVersions[fromIdx].toString();
            if (fromIdx === 0 || majorVersions[fromIdx - 1].minor !== majorVersions[fromIdx].minor) {
                fromStr = `${majorVersions[fromIdx].major}.${majorVersions[fromIdx].minor}`;
            }
            let toStr = majorVersions[toIdx].toString();
            if (toIdx === majorVersions.length - 1 || majorVersions[toIdx + 1].minor !== majorVersions[toIdx].minor) {
                toStr = `${majorVersions[toIdx].major}.${majorVersions[toIdx].minor}`;
            }
            subranges.push(`${fromStr} - ${toStr}`);
        }
    }

    if (effectivePolicy === SubrangePolicies.ONE_PER_MINOR) {
        fnlog('Effective policy: ONE_PER_MINOR');

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minSemVer.major; i <= maxSemVer.major; i++) {
            const uniqueMinors = parsedVersions
                .filter(v => v.major === i)
                .map(v => v.minor)
                .sort()
                .filter((value, index, self) => self.indexOf(value) === index);
            for (const j of uniqueMinors) {
                // Create an initial requirement with just the major version (eg: "9")
                const minorRange = `${i}.${j}`;
                if (semver.subset(minorRange, range)) {
                    subranges.push(minorRange);
                    continue;
                }

                // Versions that would satisfy the minor requirement regardless of real requirement
                const minorVersions = parsedVersions.filter(v => semver.satisfies(v, minorRange));
                if (minorVersions.length === 0) {
                    continue;
                }

                // Versions that would satisfy both the minor requirement and the input range
                const rangeMinorVersions = rangeVersions.filter(v => semver.satisfies(v, minorRange));
                if (rangeMinorVersions.length === 0) {
                    continue;
                }

                // If both represent the same versions, this means the major requirement is effectively the same
                if (arraysHaveSameElements(minorVersions, rangeMinorVersions)) {
                    subranges.push(minorRange);
                    continue;
                }

                // If the main range satisfies all the highest minors in the major version, then this is
                // a "^" requirement, meaning we should define the minor, and we can update it as we want
                const latestMinorVersions = minorVersions.slice(-rangeMinorVersions.length);
                if (arraysHaveSameElements(latestMinorVersions, rangeMinorVersions)) {
                    subranges.push(`~${latestMinorVersions[0].toString()}`);
                    continue;
                }

                // If the main range satisfies all the lowest minors in the major version, then this is
                // a <= requirement
                const earliestMinorVersions = minorVersions.slice(0, rangeMinorVersions.length);
                if (arraysHaveSameElements(earliestMinorVersions, rangeMinorVersions)) {
                    subranges.push(`${i}.${j} - ${latestMinorVersions[0].toString()}`);
                    continue;
                }

                // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
                const fromIdx = minorVersions.indexOf(rangeMinorVersions[0]);
                const toIdx = minorVersions.indexOf(rangeMinorVersions[rangeMinorVersions.length - 1]);
                const fromStr = minorVersions[fromIdx].toString();
                const toStr = minorVersions[toIdx].toString();
                subranges.push(`${fromStr} - ${toStr}`);
            }
        }
    }

    return subranges;
}
