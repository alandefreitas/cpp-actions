/**
 * Compiler support and formatting utilities for cpp-matrix action.
 *
 * @module compiler-support
 */

import * as core from '@actions/core';
import * as semver from 'semver';

import { type MatrixEntry } from './types';
import { type Inputs } from './schema';

/*
    It's very common for compilers to not fully comply with the standards they claim to support, even
    for the old standards. The criteria used by this action for determining if a compiler supports a
    standard is based on the whether the compiler claims to support the standard by providing a corresponding
    `-std=c++XX` flag to enable the standard.
 */
/**
 * Checks if a compiler version supports a given C++ standard.
 *
 * @param compiler - Compiler name (gcc, clang, msvc)
 * @param version - Compiler version
 * @param cxxstd - C++ standard year (2011, 2014, 2017, 2020, 2023)
 * @returns True if the compiler version supports the standard
 */
export function compilerSupportsStd(compiler: string, version: string | semver.SemVer, cxxstd: number): boolean {
    if (compiler === 'gcc') {
        return (cxxstd <= 2023 && semver.satisfies(version, '>=11.1')) ||
            (cxxstd <= 2020 && semver.satisfies(version, '>=10.1')) ||
            (cxxstd <= 2017 && semver.satisfies(version, '>=5.1')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=4.9.0')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=4.7.1')) ||
            cxxstd <= 2003;
    }
    if (compiler === 'clang') {
        return (cxxstd <= 2023 && semver.satisfies(version, '>=17')) ||
            (cxxstd <= 2020 && semver.satisfies(version, '>=10')) ||
            // clang >=5 technically supports c++17, but compliance is terrible
            (cxxstd <= 2017 && semver.satisfies(version, '>=6')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=3.5')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=3')) ||
            cxxstd <= 2003;
    }
    if (compiler === 'msvc') {
        return (cxxstd <= 2023 && semver.satisfies(version, '>=14.40')) ||
            (cxxstd <= 2020 && semver.satisfies(version, '>=14.30')) ||
            (cxxstd <= 2017 && semver.satisfies(version, '>=14.20')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=14.11')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=14')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=14.1')) ||
            cxxstd <= 2003;
    }
    return false;
}

/**
 * Converts a compiler identifier to a human-readable name.
 *
 * @param compiler - Compiler identifier
 * @returns Human-readable compiler name
 */
export function humanizeCompilerName(compiler: string): string {
    const humanCompilerNames: Record<string, string> = {
        'gcc': 'GCC',
        'clang': 'Clang',
        'apple-clang': 'Apple-Clang',
        'msvc': 'MSVC',
        'mingw': 'MinGW',
        'clang-cl': 'Windows-Clang'
    };
    if (compiler in humanCompilerNames) {
        return humanCompilerNames[compiler];
    }
    return compiler;
}

/**
 * Returns an emoji representing a compiler.
 *
 * @param compiler - Compiler identifier
 * @returns Emoji for the compiler
 */
export function compilerEmoji(compiler: string): string {
    const compilerEmojis: Record<string, string> = {
        'gcc': '🐧',
        'clang': '🐉',
        'apple-clang': '🍏',
        'msvc': '🪟',
        'mingw': '🪓',
        'clang-cl': '🛠️'
    };
    if (compiler in compilerEmojis) {
        return compilerEmojis[compiler];
    }
    return '🛠️';
}

/**
 * Converts a semver version to a string.
 *
 * @param version - Version to convert
 * @returns Version string representation
 */
export function versionToString(version: semver.SemVer | string | undefined | null): string {
    if (typeof version === 'string') {
        return version;
    }
    if (!version) {
        return 'unknown';
    }
    if (typeof version.version === 'string' && version.version.length !== 0) {
        return version.version;
    }
    const parts: (string | number)[] = [];
    for (const key of ['major', 'minor', 'patch'] as const) {
        if (version[key] !== undefined && version[key] !== null) {
            parts.push(version[key]);
        }
    }
    if (parts.length === 0) {
        return 'unknown';
    }
    return parts.join('.');
}

/**
 * Formats a list of versions as a comma-separated string.
 *
 * @param versions - Array of version strings
 * @returns Formatted version list
 */
export function formatVersionList(versions: string[]): string {
    if (!versions || versions.length === 0) {
        return 'none';
    }
    return Array.from(new Set(versions)).join(', ');
}

/**
 * Formats a C++ standard number as a label.
 *
 * @param std - C++ standard number or string
 * @returns Formatted label (e.g., "C++20")
 */
export function formatStandardLabel(std: number | string): string {
    if (typeof std === 'number') {
        return `C++${std}`;
    }
    return std;
}

/**
 * Warns when no matrix entries are generated for a compiler.
 *
 * @param compilerName - Compiler name
 * @param range - Version range requested
 * @param availableVersions - Available compiler versions
 * @param requestedStds - Requested C++ standards
 * @param standardsInput - Original standards input string
 */
export function warnEmptyCompilerEntries(compilerName: string, range: string, availableVersions: string[], requestedStds: number[], standardsInput: string): void {
    // Human-readable compiler label for messaging
    const humanName = humanizeCompilerName(compilerName);
    // Parse all known versions into semver objects (filtering invalid ones)
    const parsedVersions = availableVersions
        .map(v => semver.parse(v))
        .filter((v): v is semver.SemVer => v !== null);

    // If we have zero known versions, warn immediately and bail
    if (parsedVersions.length === 0) {
        core.warning(`${humanName}: No matrix entries were generated because no published ${humanName} versions are known to cpp-matrix, so the requirement "${range}" cannot be evaluated.`);
        return;
    }

    // Helper to check if a parsed version satisfies the requested range (with defensive error handling)
    const matchesRange = (version: semver.SemVer): boolean => {
        if (!range || range === '*' || range.trim() === '') {
            return true;
        }
        try {
            return semver.satisfies(version, range);
        } catch (error) {
            core.warning(`${humanName}: Unable to evaluate requirement "${range}" (${(error as Error).message}). No entries were generated.`);
            return false;
        }
    };

    // Precompute which versions satisfy the range requirement alone
    const rangeMatches = parsedVersions.filter(matchesRange).map(versionToString);
    // Bucket to hold per-standard details and union of compatible versions
    const stdDetails: string[] = [];
    const stdMatchSet = new Set<string>();

    // Handle cases where the normalized standards input collapsed to an empty set
    if (requestedStds.length === 0) {
        stdDetails.push(`Standard requirement "${standardsInput || '*'}" resolved to an empty set. Provide at least one C++ version (e.g., '>=11').`);
    } else {
        // For each requested standard, record which versions claim support
        for (const std of requestedStds) {
            const matches = parsedVersions
                .filter(v => compilerSupportsStd(compilerName, v, std))
                .map(versionToString);
            matches.forEach(v => stdMatchSet.add(v));
            stdDetails.push(`Standard ${formatStandardLabel(std)}: ${formatVersionList(matches)}`);
        }
    }

    // Intersection between version range matches and standard matches identifies truly valid combinations
    const combinedMatches = requestedStds.length === 0 ? [] : rangeMatches.filter(v => stdMatchSet.has(v));

    // Core message plus bullet list of supporting details
    const message = `${humanName}: No matrix entries were generated because no known ${humanName} versions satisfy every requested requirement simultaneously.`;
    const detailLines = [`- Version requirement "${range || '*'}": ${formatVersionList(rangeMatches)}`];
    detailLines.push(...stdDetails.map(line => `- ${line}`));
    if (requestedStds.length !== 0) {
        detailLines.push(`- Combined matches: ${formatVersionList(combinedMatches)}`);
    }
    // Emit the final warning as a multiline message
    core.warning(`${message}\n${detailLines.join('\n')}`);
}

/**
 * Gets the C++ standards supported by a compiler version.
 *
 * @param entry - Matrix entry to update
 * @param inputs - Action inputs
 * @param allCompilerVersions - All available compiler versions
 * @param cxxstds - Requested C++ standards
 * @param compilerName - Compiler name
 * @param minSubrangeVersion - Minimum version in the subrange
 * @returns Array of supported standards or undefined if none
 */
export function getCompilerCxxStds(entry: MatrixEntry, inputs: Inputs, allCompilerVersions: string[], cxxstds: number[], compilerName: string, minSubrangeVersion: semver.SemVer): string[] | undefined {
    // The versions of cxxstd we should test with this compiler
    let compilerCxxs: number[] = [];
    if (allCompilerVersions.length !== 0) {
        // Identify versions of cxxstd supported by this compiler + version
        compilerCxxs = cxxstds.filter(cxxstd => compilerSupportsStd(compilerName, minSubrangeVersion, cxxstd));

        // Set entry values if we found any
        if (compilerCxxs.length === 0) {
            // We know about the compiler versions but this compiler does not
            // support any of the standards we want to test. Skip it.
            return undefined;
        }

        if (inputs.maxStandards && compilerCxxs.length > inputs.maxStandards) {
            compilerCxxs = compilerCxxs.splice(-inputs.maxStandards);
        }
        const compilerCxxStrs = compilerCxxs.map(v => v.toString().slice(-2));
        entry['cxxstd'] = compilerCxxStrs.join(',');
        entry['latest-cxxstd'] = compilerCxxStrs[compilerCxxStrs.length - 1];
    }
    // Return list even if it's empty.
    // An empty list means we want to test this compiler, but we don't know
    // what versions of cxxstd it supports because there's no compiler version
    // we know about.
    return compilerCxxs.map(v => v.toString().slice(-2));
}
