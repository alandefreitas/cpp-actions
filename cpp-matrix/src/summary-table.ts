/**
 * Summary table generation for cpp-matrix action.
 *
 * Provides functions for generating human-readable table representations
 * of the CI/CD test matrix with emoji formatting.
 *
 * @module summary-table
 */

import * as traceCommands from 'trace-commands';

import {
    type CompilerFactors,
    type MatrixEntry
} from './types';
import { type Inputs } from './schema';

import {
    humanizeCompilerName,
    compilerEmoji
} from './compiler-support';

/**
 * Returns an emoji representing a matrix factor.
 *
 * @param factor - Factor name
 * @returns Emoji for the factor
 */
function factorEmoji(factor: string): string {
    const factorEmojis: Record<string, string> = {
        'x86': '💻',
        'shared': '📚',
        'ubsan': '🔬',
        'msan': '🧹',
        'tsan': '🕵️‍♂️',
        'intsan': '🧮',
        'boundsan': '📏',
        'lsan': '💧',
        'cfi': '🔒',
        'coverage': '📊',
        'asan': '🛡️',
        'time-trace': '⏱️',
        'fuzz': '🔀'
    };
    if (factor in factorEmojis) {
        return factorEmojis[factor];
    }
    // Check if factor contains '+'
    if (factor.includes('+')) {
        for (const compositeFactor of factor.split('+')) {
            if (compositeFactor in factorEmojis) {
                return factorEmojis[compositeFactor];
            }
        }
    }
    return '🔢';
}

/**
 * Returns an emoji representing a build type.
 *
 * @param buildType - Build type name
 * @returns Emoji for the build type
 */
function buildTypeEmoji(buildType: string): string {
    const buildTypeEmojis: Record<string, string> = {
        'debug': '🐞',
        'release': '🚀',
        'relwithdebinfo': '🔍',
        'minsizerel': '💡'
    };
    const lcBuildType = buildType.toLowerCase();
    if (lcBuildType in buildTypeEmojis) {
        return buildTypeEmojis[lcBuildType];
    }
    return '🏗️';
}

/**
 * Returns an emoji representing an operating system.
 *
 * @param os - Operating system name
 * @returns Emoji for the OS
 */
function osEmoji(os: string): string {
    const osEmojis: Record<string, string> = {
        'windows': '🪟',
        'macos': '🍎',
        'linux': '🐧',
        'ubuntu': '🐧',
        'android': '🤖',
        'ios': '📱'
    };
    const lcOs = os.toLowerCase();
    for (const [key, value] of Object.entries(osEmojis)) {
        if (lcOs.startsWith(key)) {
            return value;
        }
    }
    return '🖥️';
}

/**
 * Gets all unique factors from latest and variant factors.
 *
 * @param latestFactors - Latest factors by compiler
 * @param factors - Variant factors by compiler
 * @returns Array of all unique factor names
 */
export function getAllFactors(latestFactors: CompilerFactors, factors: CompilerFactors): string[] {
    const allFactors: string[] = [];
    Object.values(latestFactors).forEach(factors => {
        for (const factor of factors) {
            for (const compositeFactor of factor.split('+')) {
                allFactors.push(compositeFactor);
            }
        }
    });
    Object.values(factors).forEach(factors => {
        for (const factor of factors) {
            for (const compositeFactor of factor.split('+')) {
                allFactors.push(compositeFactor);
            }
        }
    });
    return [...new Set(allFactors)];
}

/**
 * Transforms a comma-separated C++ standard string into a readable format.
 *
 * @param inputString - Comma-separated standards (e.g., "11,14,17")
 * @returns Human-readable string (e.g., "C++11, C++14 and C++17")
 */
function transformStdString(inputString: string | undefined): string {
    if (inputString === undefined || inputString === null || inputString === '') {
        return 'System Default';
    }
    const versions = inputString.split(',');
    const transformedString = versions.map((version, index) => {
        if (index === versions.length - 1) {
            return `C++${version}`;
        } else {
            return `C++${version},`;
        }
    }).join(' ');
    const lastIndex = transformedString.lastIndexOf(',');
    if (lastIndex !== -1) {
        return transformedString.substring(0, lastIndex) + ' and' + transformedString.substring(lastIndex + 1);
    }
    return transformedString;
}

/**
 * Generates a human-readable table representation of the test matrix.
 *
 * Creates a formatted table with columns for name, environment, compiler,
 * C++ standard, build type, factors/flags/install, and generator/toolset/triplet.
 * Each row represents one matrix entry with appropriate emojis and HTML formatting
 * for display in markdown or GitHub Actions summaries.
 *
 * @param matrix - Array of matrix entries to display in the table
 * @param inputs - Configuration inputs containing factors and latestFactors settings
 * @returns Two-dimensional array representing the table, where each inner array is a row
 *          and cells can be strings or header objects with data and header properties
 */
export function generateTable(matrix: MatrixEntry[], inputs: Inputs): Array<Array<string | { data: string; header: boolean }>> {
    const fnlog = traceCommands.scoped('generateTable');

    const { latestFactors, factors } = inputs;
    if (matrix.length === 0) {
        return [];
    }

    const allFactors = getAllFactors(latestFactors, factors);
    const allFactorKeys = allFactors.map(v => v.toLowerCase());

    // Check if any entry has failure rate data
    const hasFailureRates = matrix.some(entry => 'failure-rate' in entry);

    const headerValues = [
        '📋 Name',
        '🖥️ Environment',
        '🔧 Compiler',
        '📚 C++ Standard',
        '🏗️ Build Type',
        '🔢 Factors<br/>🚩 Flags<br/>🔧 Install',
        '🔨 Generator<br/>🛠️ Toolset<br/>💻 Triplet'];
    if (hasFailureRates) {
        headerValues.push('📊 Failure<br/>Rate');
    }
    const table: Array<Array<string | { data: string; header: boolean }>> = [headerValues.map(key => ({ data: key, header: true }))];

    for (const entry of matrix) {
        const row: string[] = [];
        const nameEmojis: string[] = [];

        // Name
        row.push(`${entry['name']}`);

        // Environment
        if ('container' in entry) {
            // Check if it's a string
            if (typeof entry['container'] === 'string') {
                row.push(`${osEmoji(entry['container'])} <code>${entry['container']}</code><br/>on <code>${entry['runs-on']}</code>`);
            }
            // Check if it's an object with the "image" key
            else if (typeof entry['container'] === 'object' && entry['container'] !== null && 'image' in entry['container']) {
                row.push(`${osEmoji(entry['container']['image'])} <code>${entry['container']['image']}</code><br/>on <code>${entry['runs-on']}</code>`);
            }
        } else {
            // No container: directly on runner image
            row.push(`${osEmoji(String(entry['runs-on']))} <code>${entry['runs-on']}</code>`);
        }

        // Compiler
        nameEmojis.push(compilerEmoji(entry['compiler']));
        row.push(`${compilerEmoji(entry['compiler'])} ${humanizeCompilerName(entry['compiler'])} <i>${entry['version']}</i>`);
        // Standards
        row.push(`${transformStdString(entry['cxxstd'])}`);

        // Build type
        if ('build-type' in entry && entry['build-type']) {
            row.push(`${buildTypeEmoji(entry['build-type'])} ${entry['build-type']}`);
        } else {
            row.push('');
        }

        // Description/Factors
        const descriptionStrs: string[] = [];

        // - Factors
        const entryFactors: string[] = [];
        for (let i = 0; i < allFactors.length && i < allFactorKeys.length; i++) {
            const fact = allFactors[i];
            const key = allFactorKeys[i];
            if (entry[key] === true) {
                entryFactors.push(`${factorEmoji(key)} ${fact}`);
                nameEmojis.push(factorEmoji(key));
            }
        }
        if (entryFactors.length !== 0) {
            descriptionStrs.push(entryFactors.join(', '));
        }

        // - Latest/Main/Unique/Earliest
        if (entry['is-main'] === true) {
            if (entry['is-earliest'] === true) {
                // This is latest, earliest, and main
                if (entry['version'] === '*') {
                    // Version is *, so any version: the system compiler
                    descriptionStrs.push(`🧰 System ${humanizeCompilerName(entry['compiler'])} version`);
                    nameEmojis.push('🧰');
                } else {
                    // Both main/latest and earliest, so this is a unique version
                    descriptionStrs.push(`🎩 Unique ${humanizeCompilerName(entry['compiler'])} version`);
                    nameEmojis.push('🎩');
                }
            } else {
                // Main but not earliest: latest
                descriptionStrs.push(`🆕 Latest ${humanizeCompilerName(entry['compiler'])} version`);
                nameEmojis.push('🆕');
            }
        } else if (entry['is-earliest'] === true) {
            // Earliest but not main: describe as earliest
            descriptionStrs.push(`🕰️ Earliest ${humanizeCompilerName(entry['compiler'])} version`);
            nameEmojis.push('🕰️');
        } else if (entryFactors.length === 0) {
            // No factors, not main/latest/early: Just an intermediary compiler version
            descriptionStrs.push(`(Intermediary ${humanizeCompilerName(entry['compiler'])} version)`);
        }

        // - C++ Flags
        let cxxflags = '';
        if (entry['cxxflags'] === entry['ccflags']) {
            if (entry['cxxflags'] && entry['cxxflags'].length !== 0) {
                // Split entry['cxxflags'] on whitespaces and join with <code> tags around it
                cxxflags = `<code>${entry['cxxflags'].split(' ').join('</code> <code>')}</code>`;
            } else {
                cxxflags = '';
            }
        } else {
            if ((entry['cxxflags'] && entry['cxxflags'].length !== 0) || (entry['ccflags'] && entry['ccflags'].length !== 0)) {
                cxxflags = `C++: <code>${(entry['cxxflags'] || '').split(' ').join('</code> <code>')}</code>, C: <code>${(entry['ccflags'] || '').split(' ').join('</code> <code>')}</code>`;
            } else {
                cxxflags = '';
            }
        }
        if (cxxflags !== '') {
            descriptionStrs.push(`🚩 ${cxxflags}`);
        }

        // - Install
        if ('install' in entry && entry['install'] !== '') {
            descriptionStrs.push(`🔧 <code>${entry['install']?.split(' ').join('</code> <code>')}</code>`);
        }
        row.push(descriptionStrs.join('<br/>'));

        // Generator/Toolset/Triplet
        let generatorStr = '';
        if ('generator' in entry) {
            generatorStr += `<code>${entry['generator']}</code>`;
            if ('generator-toolset' in entry) {
                generatorStr += ` (<code>${entry['generator-toolset']}</code>)`;
            }
        } else {
            generatorStr += 'System Default';
        }
        if ('b2-toolset' in entry) {
            generatorStr += `<br/><code>${entry['b2-toolset']}</code>`;
        }
        if ('triplet' in entry) {
            generatorStr += `<br/><code>${entry['triplet']}</code>`;
        }
        row.push(generatorStr);

        // Failure rate (if available)
        if (hasFailureRates) {
            if ('failure-rate' in entry && typeof entry['failure-rate'] === 'number') {
                const rate = entry['failure-rate'] as number;
                const pct = (rate * 100).toFixed(1);
                row.push(`${pct}%`);
            } else {
                row.push('N/A');
            }
        }

        // Apply emojis to name
        row[0] = `${nameEmojis.join('')} ${row[0]}`;

        table.push(row);

        fnlog(`- ${JSON.stringify(row)}`);
    }

    return table;
}
