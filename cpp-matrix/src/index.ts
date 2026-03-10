import * as core from '@actions/core';
import * as semver from 'semver';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { execSync as _execSync } from 'child_process';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import { runAction } from 'action-schema';

import {
    RawInputs,
    CompilerFactors,
    CompilerSuggestion,
    KeyValue,
    SubrangePolicyMap,
    Inputs,
    MatrixEntry
} from './types';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

import {
    parseCompilerRequirements,
    parseCompilerFactors,
    parseCompilerSuggestions,
    normalizeCppVersionRequirement,
    normalizeCompilerName
} from './parsing';

import {
    findCompilerVersions,
    getSubrangePolicy,
    splitRanges
} from './versions';

import {
    humanizeCompilerName,
    compilerEmoji,
    warnEmptyCompilerEntries,
    getCompilerCxxStds
} from './compiler-support';

import {
    setEntrySemverComponents,
    setCompilerExecutableNames,
    setCompilerExecutableNamesNoVersion,
    setCompilerContainerNoVersion,
    isArrayOfObjects,
    setSuggestion,
    applyForcedFactors,
    setCompilerContainer,
    setCompilerB2Toolset,
    setCompilerCMakeGenerator,
    setEntryVersionFlags,
    setEntryName
} from './entry-builder';

import {
    applyLatestFactors,
    applyVariantFactors,
    applyCombinatorialFactors,
    setRecommendedFlags
} from './factors';

import {
    fetchFailureRates,
    sortByFailureRate
} from './failure-rates';

import { sortMatrix } from './sorting';

import { registerHelpers } from './handlebars-helpers';

// Re-export handlebars helpers
export { registerHelpers } from './handlebars-helpers';

// Re-export types for external consumers
export {
    CompilerVersions,
    CompilerFactors,
    CompilerSuggestion,
    KeyValue,
    SubrangePolicyMap,
    Inputs,
    MatrixEntry,
    ContainerConfig,
    SubrangePolicy,
    FailureRates,
    WorkflowJob,
    WorkflowRun
} from './types';

// Re-export SubrangePolicies constant
export { SubrangePolicies } from './types';

// Re-export parsing functions
export {
    parseCompilerRequirements,
    parseCompilerFactors,
    parseCompilerSuggestions,
    normalizeCppVersionRequirement,
    normalizeCompilerName
} from './parsing';

// Re-export version functions
export {
    findMSVCVersions,
    findCompilerVersions,
    getVisualCppYear,
    getSubrangePolicy,
    splitRanges
} from './versions';

/**
 * Injects extra key-value pairs into all matrix entries.
 *
 * @param matrix - Matrix array to update
 * @param extraValues - Extra values to inject
 */
function injectExtraValues(matrix: MatrixEntry[], extraValues?: KeyValue[]): void {
    if (!extraValues) {
        return;
    }

    registerHelpers();

    // Use Object.entries to iterate over the key-value pairs of extraValues
    const compiledTemplates = extraValues.map(({ key, value }) => ({
        key,
        template: Handlebars.compile(value)
    }));

    let warnedKeys: string[] = [];
    for (const entry of matrix) {
        for (const { key, template } of compiledTemplates) {
            const fail = key in entry;
            if (fail) {
                if (!warnedKeys.includes(key)) {
                    core.warning(`Extra entry key "${key}" already exists in the matrix`);
                }
                // Add to the list of keys we already warned about
                warnedKeys.push(key);
                continue;
            }
            entry[key] = template(entry);
        }
    }
}

/**
 * Sets the OS field for each matrix entry based on runs-on.
 *
 * @param matrix - Matrix array to update
 */
function setOS(matrix: MatrixEntry[]): void {
    for (const entry of matrix) {
        if (entry.container) {
            entry.os = 'Linux';
        } else if (entry['runs-on']) {
            const runsOn = typeof entry['runs-on'] === 'string' ? entry['runs-on'].toLowerCase() : '';
            if (runsOn.startsWith('windows')) {
                entry.os = 'Windows';
            } else if (runsOn.startsWith('macos')) {
                entry.os = 'macOS';
            } else {
                entry.os = 'Linux';
            }
        } else {
            entry.os = 'Linux';
        }
    }
}

/**
 * Generates the complete CI/CD test matrix based on input configuration.
 *
 * This function creates an array of matrix entries representing all combinations
 * of compilers, versions, C++ standards, and build factors to test. It handles
 * version resolution, container configuration, and applies filtering rules.
 *
 * @param inputs - Configuration inputs controlling matrix generation including
 *                 compiler versions, standards, factors, and container suggestions
 * @returns Array of matrix entries ready for use in GitHub Actions workflows
 */
export async function generateMatrix(inputs: Inputs): Promise<MatrixEntry[]> {
    const fnlog = trace_commands.scoped('generateMatrix');

    let matrix: MatrixEntry[] = [];
    const allcxxstds = ['1998.0.0', '2003.0.0', '2011.0.0', '2014.0.0', '2017.0.0', '2020.0.0', '2023.0.0', '2026.0.0'];
    const cxxstds = allcxxstds.filter(v => semver.satisfies(v, inputs.standards)).map(v => {
        const parsed = semver.parse(v);
        return parsed ? parsed.major : 0;
    }).filter(v => v !== 0);

    core.startGroup('🔄 Generating matrix entries');
    const compilers = Object.entries(inputs.compiler_versions);

    for (const [compilerName0, range] of compilers) {
        fnlog(`Generating entries for ${compilerName0} version ${range}`);
        const earliestIdx = matrix.length;
        const compilerName = normalizeCompilerName(compilerName0);
        fnlog(`Find versions for ${compilerName}`);
        const allCompilerVersions = await findCompilerVersions(compilerName);
        const subrangePolicyStr = inputs.subrange_policy[compilerName] || inputs.subrange_policy[''] || 'one-per-major';
        fnlog(`Subrange policy for ${compilerName}: ${subrangePolicyStr}`);
        const subranges = splitRanges(range, allCompilerVersions, getSubrangePolicy(subrangePolicyStr));
        fnlog(`${compilerName} sub-ranges: ${JSON.stringify(subranges)}`);

        // Iterate over subranges and generate an entry for each
        for (let i = 0; i < subranges.length; i++) {
            fnlog(`Generating entry for ${compilerName} subrange ${subranges[i]}`);
            const subrange = subranges[i];
            let entry: MatrixEntry = {
                'name': `${humanizeCompilerName(compilerName)}`,
                'compiler': compilerName,
                'version': subrange,
                'env': {},
                'is-latest': false,
                'is-main': false,
                'is-earliest': false,
                'is-intermediary': false,
                'has-major': false,
                'has-minor': false,
                'has-patch': false,
                'subrange-policy': ''
            };

            // The standards we should test with this compiler
            const minSubrangeVersion = semver.parse(semver.minSatisfying(allCompilerVersions, subrange) || '');
            const maxSubrangeVersion = semver.parse(semver.maxSatisfying(allCompilerVersions, subrange) || '');

            // Handle the case when no versions are known for this compiler.
            // We still generate an entry with version "*" so downstream jobs
            // can test with whatever version is available on the runner.
            const noKnownVersions = allCompilerVersions.length === 0;

            if (!noKnownVersions && (!minSubrangeVersion || !maxSubrangeVersion)) {
                // We have known versions but none match the subrange - skip
                continue;
            }

            let compiler_cxxstds: string[] = [];
            if (noKnownVersions) {
                // No known versions - we can't filter by C++ standard support,
                // so we don't set cxxstd fields. The entry will test whatever
                // standards the runner's compiler supports.
            } else {
                const result = getCompilerCxxStds(
                    entry, inputs, allCompilerVersions, cxxstds, compilerName, minSubrangeVersion!);
                if (result === undefined) {
                    // This compiler version does not support any of the standards
                    // we want to test. Skip it.
                    continue;
                }
                compiler_cxxstds = result;
            }

            setEntrySemverComponents(entry, minSubrangeVersion, maxSubrangeVersion);
            if (minSubrangeVersion) {
                setCompilerExecutableNames(entry, compilerName, minSubrangeVersion);
                setCompilerContainer(entry, inputs, compilerName, minSubrangeVersion, subrange);
                setCompilerCMakeGenerator(entry, inputs, compilerName, minSubrangeVersion, maxSubrangeVersion!, subrange);
            } else {
                // No known versions - set defaults based on compiler name
                setCompilerExecutableNamesNoVersion(entry, compilerName);
                setCompilerContainerNoVersion(entry, compilerName);
            }
            setCompilerB2Toolset(entry, inputs, compilerName, subrange);
            setEntryVersionFlags(entry, i, subranges, minSubrangeVersion, maxSubrangeVersion);
            setEntryName(entry, compilerName, subrange, compiler_cxxstds);
            matrix.push(entry);
            fnlog(`Entry: ${JSON.stringify(entry)}`);
        }
        if (earliestIdx === matrix.length) {
            fnlog(`${compilerName}: 0 basic entries`);
            if (inputs.warn_no_matches) {
                warnEmptyCompilerEntries(compilerName, range, allCompilerVersions, cxxstds, inputs.standards);
            }
            continue;
        }

        fnlog(`Apply factors for ${compilerName}`);
        const latestIdx = matrix.length - 1;
        fnlog(`${compilerName}: ${latestIdx - earliestIdx} basic entries`);
        applyLatestFactors(matrix, inputs, latestIdx, earliestIdx, compilerName);
        applyVariantFactors(matrix, inputs, latestIdx, earliestIdx, compilerName);
        applyCombinatorialFactors(matrix, inputs, latestIdx, earliestIdx, compilerName);
        for (let i = earliestIdx; i < matrix.length; i++) {
            if (!('has-factors' in matrix[i])) {
                matrix[i]['has-factors'] = false;
            }
            matrix[i]['is-no-factor-intermediary'] = matrix[i]['is-intermediary'] && !matrix[i]['has-factors'];
            matrix[i]['is-container'] = 'container' in matrix[i];
        }
        fnlog(`${compilerName}: ${matrix.length - earliestIdx} total entries`);
    }

    function printMatrix(): void {
        trace_commands.log(`Matrix (${matrix.length} entries):`);
        matrix.forEach(obj => {
            trace_commands.log(`- ${JSON.stringify(obj)}`);
        });
    }

    printMatrix();
    core.endGroup();

    core.startGroup('⚙️ Set recommended flags');
    // Patch each entry with recommended flags for special factors
    for (let entry of matrix) {
        await setRecommendedFlags(entry, inputs);
    }
    printMatrix();
    core.endGroup();

    core.startGroup('👤 Set custom values');
    for (let entry of matrix) {
        if (setSuggestion(entry, 'container', inputs.containers, entry.version)) {
            entry['runs-on'] = 'ubuntu-22.04';
        }
        setSuggestion(entry, 'b2-toolset', inputs.generators, entry.version);
        setSuggestion(entry, 'generator', inputs.generators, entry.version);
        setSuggestion(entry, 'generator-toolset', inputs.generator_toolsets, entry.version);
        setSuggestion(entry, 'runs-on', inputs.runs_on, entry.version);
        setSuggestion(entry, 'ccflags', inputs.ccflags, entry.version);
        setSuggestion(entry, 'cxxflags', inputs.cxxflags, entry.version);
        setSuggestion(entry, 'install', inputs.install, entry.version);
        setSuggestion(entry, 'triplet', inputs.triplets, entry.version);
        setSuggestion(entry, 'build-type', inputs.build_types, entry.version);
        applyForcedFactors(entry, inputs.force_factors, entry.version);
    }
    printMatrix();
    core.endGroup();

    // Set entry OS
    core.startGroup('🖥️ Set OS');
    setOS(matrix);
    core.endGroup();

    if (inputs.extra_values) {
        core.startGroup('🔧 Add extra values');
        injectExtraValues(matrix, inputs.extra_values);
        core.endGroup();
    }

    core.startGroup('🔀 Sort matrix');
    sortMatrix(matrix, inputs);
    printMatrix();
    core.endGroup();

    // Apply failure rate sorting if enabled
    if (inputs.sort_by_failure_rate) {
        core.startGroup('📊 Sort by failure rate');
        core.info(`Fetching failure rates from last ${inputs.failure_rate_runs} workflow runs...`);
        const failureRates = await fetchFailureRates(inputs.failure_rate_runs, inputs.github_token);
        if (failureRates) {
            sortByFailureRate(matrix, failureRates);
            core.info('Matrix sorted by failure rate (high to low)');
            printMatrix();
        } else {
            core.info('Could not fetch failure rates, keeping existing order');
        }
        core.endGroup();
    }

    core.startGroup('🏁 Final matrix');
    if (inputs.log_matrix) {
        core.info(`Matrix (${matrix.length} entries):`);
        matrix.forEach((obj) => {
            core.info(`- ${JSON.stringify(obj)}`);
        });
    } else {
        printMatrix();
    }
    core.endGroup();

    if (inputs.generate_summary) {
        core.startGroup('📋 C++ Matrix Summary');
        const table = generateTable(matrix, inputs);
        core.summary.addHeading('C++ Test Matrix').addTable(table).write().then(result => {
            trace_commands.log('Table generated' + JSON.stringify(result));
        }).catch(error => {
            trace_commands.log('An error occurred generating the table:' + JSON.stringify(error));
        });
        core.info('Summary table generated');
        core.endGroup();
    }

    if (inputs.output_file) {
        core.startGroup('📄 Write matrix to file');
        const filename = path.resolve(inputs.output_file);
        const content = JSON.stringify(matrix, null, 2);
        fs.writeFileSync(filename, content);
        core.info(`Matrix written to ${filename}`);
        core.endGroup();
    }

    return matrix;
}

/**
 * Returns an emoji representing a matrix factor.
 *
 * @param factor - Factor name
 * @returns Emoji for the factor
 */
function factorEmoji(factor: string): string {
    const factor_emojis: Record<string, string> = {
        'x86': '💻',
        'shared': '📚',
        'ubsan': '🔬',
        'msan': '🧹',
        'tsan': '🕵️‍♂️',
        'coverage': '📊',
        'asan': '🛡️',
        'time-trace': '⏱️',
        'fuzz': '🔀'
    };
    if (factor in factor_emojis) {
        return factor_emojis[factor];
    }
    // Check if factor contains '+'
    if (factor.includes('+')) {
        for (const composite_factor of factor.split('+')) {
            if (composite_factor in factor_emojis) {
                return factor_emojis[composite_factor];
            }
        }
    }
    return '🔢';
}

/**
 * Returns an emoji representing a build type.
 *
 * @param build_type - Build type name
 * @returns Emoji for the build type
 */
function buildTypeEmoji(build_type: string): string {
    const build_type_emojis: Record<string, string> = {
        'debug': '🐞',
        'release': '🚀',
        'relwithdebinfo': '🔍',
        'minsizerel': '💡'
    };
    const lc_build_type = build_type.toLowerCase();
    if (lc_build_type in build_type_emojis) {
        return build_type_emojis[lc_build_type];
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
    const os_emojis: Record<string, string> = {
        'windows': '🪟',
        'macos': '🍎',
        'linux': '🐧',
        'ubuntu': '🐧',
        'android': '🤖',
        'ios': '📱'
    };
    const lc_os = os.toLowerCase();
    for (const [key, value] of Object.entries(os_emojis)) {
        if (lc_os.startsWith(key)) {
            return value;
        }
    }
    return '🖥️';
}

/**
 * Gets all unique factors from latest and variant factors.
 *
 * @param latest_factors - Latest factors by compiler
 * @param factors - Variant factors by compiler
 * @returns Array of all unique factor names
 */
function getAllFactors(latest_factors: CompilerFactors, factors: CompilerFactors): string[] {
    let allFactors: string[] = [];
    Object.values(latest_factors).forEach(factors => {
        for (const factor of factors) {
            for (const composite_factor of factor.split('+')) {
                allFactors.push(composite_factor);
            }
        }
    });
    Object.values(factors).forEach(factors => {
        for (const factor of factors) {
            for (const composite_factor of factor.split('+')) {
                allFactors.push(composite_factor);
            }
        }
    });
    return [...new Set(allFactors)];
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
 * @param inputs - Configuration inputs containing factors and latest_factors settings
 * @returns Two-dimensional array representing the table, where each inner array is a row
 *          and cells can be strings or header objects with data and header properties
 */
export function generateTable(matrix: MatrixEntry[], inputs: Inputs): Array<Array<string | { data: string; header: boolean }>> {
    const fnlog = trace_commands.scoped('generateTable');

    const { latest_factors, factors } = inputs;
    if (matrix.length === 0) {
        return [];
    }

    let allFactors = getAllFactors(latest_factors, factors);
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
    let table: Array<Array<string | { data: string; header: boolean }>> = [headerValues.map(key => ({ data: key, header: true }))];

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

    for (const entry of matrix) {
        let row: string[] = [];
        let nameEmojis: string[] = [];

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
        let descriptionStrs: string[] = [];

        // - Factors
        let entryFactors: string[] = [];
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
        let generator_str = '';
        if ('generator' in entry) {
            generator_str += `<code>${entry['generator']}</code>`;
            if ('generator-toolset' in entry) {
                generator_str += ` (<code>${entry['generator-toolset']}</code>)`;
            }
        } else {
            generator_str += 'System Default';
        }
        if ('b2-toolset' in entry) {
            generator_str += `<br/><code>${entry['b2-toolset']}</code>`;
        }
        if ('triplet' in entry) {
            generator_str += `<br/><code>${entry['triplet']}</code>`;
        }
        row.push(generator_str);

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

/**
 * Normalizes compiler names in object keys.
 *
 * @param obj - Object with compiler name keys to normalize
 */
function normalizeCompilerNameKeys(obj: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(obj)) {
        const newName = normalizeCompilerName(name);
        if (newName !== name) {
            obj[newName] = value;
            delete obj[name];
        }
    }
}

/**
 * Normalizes compiler names in suggestion arrays.
 *
 * @param suggestionMap - Array of suggestions to normalize
 */
function normalizeCompilerNameSuggestions(suggestionMap: CompilerSuggestion[]): void {
    if (isArrayOfObjects(suggestionMap)) {
        suggestionMap.forEach(obj => {
            obj['compiler'] = normalizeCompilerName(obj['compiler']);
        });
    }
}

/**
 * Parses key-value pairs from an array of strings.
 *
 * @param lines - Array of strings in format "key: value"
 * @returns Array of KeyValue objects
 */
function parseKeyValues(lines: string[]): KeyValue[] | undefined {
    const result: KeyValue[] = [];
    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            result.push({
                key: line.slice(0, colonIndex).trim(),
                value: line.slice(colonIndex + 1).trim()
            });
        }
    }
    return result.length > 0 ? result : undefined;
}

/**
 * Converts raw parsed inputs to the internal Inputs type.
 *
 * @param raw - Raw inputs from schema parsing
 * @returns Converted Inputs object
 */
function convertRawInputs(raw: RawInputs): Inputs {
    const compilerVersions = parseCompilerRequirements(raw.compilers.join('\n'));
    const compilerKeys = Object.keys(compilerVersions);

    return {
        // Compilers
        compiler_versions: compilerVersions,
        subrange_policy: raw.subrange_policy as SubrangePolicyMap,
        standards: normalizeCppVersionRequirement(raw.standards),
        max_standards: raw.max_standards || undefined,

        // Factors
        latest_factors: parseCompilerFactors(raw.latest_factors.join('\n'), compilerKeys),
        factors: parseCompilerFactors(raw.factors.join('\n'), compilerKeys),
        combinatorial_factors: parseCompilerFactors(raw.combinatorial_factors.join('\n'), compilerKeys),
        force_factors: parseCompilerSuggestions(raw.force_factors, compilerKeys),
        extra_values: parseKeyValues(raw.extra_values),

        // Customize suggestions
        runs_on: parseCompilerSuggestions(raw.runs_on, compilerKeys),
        containers: parseCompilerSuggestions(raw.containers, compilerKeys),
        generators: parseCompilerSuggestions(raw.generators, compilerKeys),
        generator_toolsets: parseCompilerSuggestions(raw.generator_toolsets, compilerKeys),
        b2_toolsets: parseCompilerSuggestions(raw.b2_toolsets, compilerKeys),
        ccflags: parseCompilerSuggestions(raw.ccflags, compilerKeys),
        cxxflags: parseCompilerSuggestions(raw.cxxflags, compilerKeys),
        install: parseCompilerSuggestions(raw.install, compilerKeys),
        triplets: parseCompilerSuggestions(raw.triplets, compilerKeys),
        build_types: parseCompilerSuggestions(raw.build_types, compilerKeys),

        // Customization flags
        default_build_type: raw.default_build_type.trim() || 'Release',
        sanitizer_build_type: raw.sanitizer_build_type.trim() || 'Release',
        x86_build_type: raw.x86_build_type.trim() || 'Release',
        use_containers: raw.use_containers,
        warn_no_matches: raw.warn_no_matches,

        // Output file
        output_file: raw.output_file,

        // Annotations and tracing
        log_matrix: raw.log_matrix,
        generate_summary: raw.generate_summary,
        trace_commands: raw.trace_commands,

        // Failure rate sorting
        sort_by_failure_rate: raw.sort_by_failure_rate,
        failure_rate_runs: raw.failure_rate_runs,
        github_token: raw.github_token
    };
}

/**
 * Main entry point for the matrix generation.
 *
 * @param inputs - Converted input parameters
 * @returns The generated matrix entries
 */
export async function main(inputs: Inputs): Promise<MatrixEntry[]> {
    // Normalize compiler names in the keys of compiler_versions,
    // latest_factors, factors, combinatorial_factors
    normalizeCompilerNameKeys(inputs.subrange_policy as unknown as Record<string, unknown>);
    normalizeCompilerNameKeys(inputs.compiler_versions as unknown as Record<string, unknown>);
    normalizeCompilerNameKeys(inputs.latest_factors as unknown as Record<string, unknown>);
    normalizeCompilerNameKeys(inputs.factors as unknown as Record<string, unknown>);
    normalizeCompilerNameKeys(inputs.combinatorial_factors as unknown as Record<string, unknown>);

    // Normalize compiler names in the 'compiler' fields of runs_on and
    // containers. They are arrays of objects.
    normalizeCompilerNameSuggestions(inputs.runs_on);
    normalizeCompilerNameSuggestions(inputs.containers);
    normalizeCompilerNameSuggestions(inputs.generators);
    normalizeCompilerNameSuggestions(inputs.generator_toolsets);
    normalizeCompilerNameSuggestions(inputs.b2_toolsets);
    normalizeCompilerNameSuggestions(inputs.ccflags);
    normalizeCompilerNameSuggestions(inputs.cxxflags);
    normalizeCompilerNameSuggestions(inputs.install);
    normalizeCompilerNameSuggestions(inputs.triplets);
    normalizeCompilerNameSuggestions(inputs.build_types);

    return await generateMatrix(inputs);
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'C++ Matrix',
    main: async (rawInputs: RawInputs) => {
        const inputs = convertRawInputs(rawInputs);
        const matrixEntries = await main(inputs);
        const matrixJson = JSON.stringify(matrixEntries);
        core.setOutput('matrix', matrixJson);
        return { matrix: matrixJson };
    },
    callerModule: module
});
