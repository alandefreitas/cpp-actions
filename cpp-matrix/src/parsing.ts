/**
 * Input parsing functions for cpp-matrix action.
 *
 * @module parsing
 */

import * as core from '@actions/core';
import * as semver from 'semver';

import {
    type CompilerVersions,
    type CompilerFactors,
    type CompilerSuggestion
} from './types';

/**
 * Parses a string of compiler requirements into a structured object.
 *
 * Parses input in format "compiler1 version-range compiler2 version-range"
 * where version ranges follow semver format (e.g., ">=10", "^14.0").
 *
 * @param inputString - Space or newline separated compiler name and version requirements
 * @returns Object mapping compiler names to their semver version range strings
 */
export function parseCompilerRequirements(inputString: string): CompilerVersions {
    const tokens = inputString.split(/[\n\s]+/);
    const compilers: CompilerVersions = {};

    let currentCompiler: string | null = null;
    let currentRequirements = '';

    for (const token of tokens) {
        if (/^[a-zA-Z\-]+$/.test(token)) {
            if (currentCompiler) {
                compilers[currentCompiler] = semver.validRange(currentRequirements.trim(), { loose: true }) || '';
                currentRequirements = '';
            }
            currentCompiler = token;
        } else {
            currentRequirements += ' ' + token.trim();
        }
    }

    if (currentCompiler) {
        compilers[currentCompiler] = currentRequirements.trim();
    }

    return compilers;
}

/**
 * Parses compiler-specific build factors from an input string.
 *
 * Factors are additional build configurations (like optimization levels, sanitizers)
 * that apply to specific compilers in the test matrix.
 *
 * @param inputString - Space or newline separated compiler names and factors
 * @param compilers - List of valid compiler names to recognize
 * @returns Object mapping compiler names to their factor arrays
 */
export function parseCompilerFactors(inputString: string, compilers: string[]): CompilerFactors {
    const tokens = inputString.split(/[\n\s]+/);

    const compilerFactors: CompilerFactors = {};
    let currentCompiler: string | null = null;
    let currentFactors: string[] = [];

    for (const token of tokens) {
        if (compilers.includes(token)) {
            if (currentCompiler) {
                compilerFactors[currentCompiler] = currentFactors;
                currentFactors = [];
            }
            currentCompiler = token.trim();
        } else {
            currentFactors.push(token.trim());
        }
    }

    if (currentCompiler) {
        compilerFactors[currentCompiler] = currentFactors;
    }

    return compilerFactors;
}

/**
 * Parses compiler suggestion lines into structured configuration objects.
 *
 * Suggestions define container images and other configurations for specific
 * compiler versions or factors. Format: "compiler [range|factor]: value".
 *
 * @param inputLines - Array of suggestion lines to parse
 * @param compilers - List of valid compiler names to recognize
 * @returns Array of parsed compiler suggestions with compiler, descriptor, and value
 */
export function parseCompilerSuggestions(inputLines: string[], compilers: string[]): CompilerSuggestion[] {
    const containerOptions: CompilerSuggestion[] = [];
    for (let line of inputLines) {
        line = line.trim();
        if (line === '') {
            continue;
        }

        // <compiler-name>[ <compiler-range|compiler-factor>]: <value>
        // Split line at first colon. If there are more than one colon, the
        // second part includes all other colons
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) {
            core.warning(`Ignoring invalid container option "${line}". Missing ":".`);
            continue;
        }
        const compilerPart = line.substring(0, colonIndex).trim();
        const containerPart = line.substring(colonIndex + 1).trim();
        // Split compiler part at first space
        const spaceIndex = compilerPart.indexOf(' ');
        // If there's no space, version is "*" is the rest is compiler
        // name. Otherwise, the first part is the compiler name and the
        // second part is the version range
        let compilerName: string;
        let compilerDescriptor: string;
        if (spaceIndex === -1) {
            compilerName = compilerPart;
            compilerDescriptor = '*';
        } else {
            compilerName = compilerPart.substring(0, spaceIndex).trim();
            compilerDescriptor = compilerPart.substring(spaceIndex + 1).trim();
        }
        // Check if compilerDescriptor is a semver version
        const descriptorIsSemver = semver.validRange(compilerDescriptor, { loose: true });

        // Check if the compiler name matches one of the compilers we know about
        if (!compilers.includes(compilerName)) {
            core.warning(`Unknown compiler name "${compilerName}" in container options. Ignoring.`);
        }
        // Create entry
        const entry: CompilerSuggestion = {
            compiler: compilerName,
            range: descriptorIsSemver ? compilerDescriptor : undefined,
            factor: descriptorIsSemver ? undefined : compilerDescriptor,
            value: containerPart
        };
        containerOptions.push(entry);
    }
    return containerOptions;
}

/**
 * Normalizes C++ standard version requirements to four-digit year format.
 *
 * Converts two-digit C++ standard versions (like "17", "20") to their
 * full four-digit year representation (2017, 2020) based on proximity
 * to the current year.
 *
 * @param range - Version requirement string possibly containing two-digit versions
 * @returns Normalized version string with four-digit years
 */
export function normalizeCppVersionRequirement(range: string): string {
    // Regular expression to match two-digit C++ versions
    const regex = /\b(\d{2})\b/g;

    const currentYear = new Date().getFullYear();
    const currentCenturyFirstYear = Math.floor(currentYear / 100) * 100;
    const previousCenturyFirstYear = currentCenturyFirstYear - 100;

    // Replace the two-digit versions with their corresponding four-digit versions
    const replacedRange = range.replace(regex, (match, version) => {
        const year = parseInt(version);
        if (year >= 0 && year <= 99) {
            const a = currentCenturyFirstYear + year;
            const b = previousCenturyFirstYear + year;
            const aDiff = Math.abs(currentYear - a);
            const bDiff = Math.abs(currentYear - b);
            if (aDiff < bDiff) {
                return a.toString();
            } else {
                return b.toString();
            }
        }
        return match; // Return the match as is if it's not a two-digit version
    });

    return replacedRange.trim();
}

/**
 * Normalizes a compiler name to a canonical form.
 *
 * Maps various spellings and aliases of compiler names to their standard
 * names used internally (gcc, clang, clang-cl, msvc, mingw).
 *
 * @param name - The compiler name to normalize
 * @returns The canonical compiler name, or the original if no rule matches
 */
export function normalizeCompilerName(name: string): string {
    const lowerCaseName = name.toLowerCase();

    if (['gcc', 'g++', 'gcc-'].some(s => lowerCaseName.startsWith(s))) {
        return 'gcc';
    } else if (['clang-cl', 'clang-win'].some(s => lowerCaseName.startsWith(s))) {
        return 'clang-cl';
    } else if (['clang', 'clang++', 'llvm'].some(s => lowerCaseName.startsWith(s))) {
        return 'clang';
    } else if (['msvc', 'cl', 'visual studio', 'vc'].some(s => lowerCaseName.startsWith(s))) {
        return 'msvc';
    } else if (['min-gw', 'mingw'].some(s => lowerCaseName.startsWith(s))) {
        return 'mingw';
    }

    // Return the original name if no normalization rule matches
    return name;
}
