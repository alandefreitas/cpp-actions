import * as core from '@actions/core';
import * as semver from 'semver';

import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import {
    type KeyValue,
    type MatrixEntry
} from './types';

// Schema imports
import { inputsSchema, outputsSchema, type Inputs } from './schema';
export { inputsSchema, outputsSchema };

import {
    normalizeCompilerName
} from './parsing';

import {
    findCompilerVersions,
    getSubrangePolicy,
    splitRanges
} from './versions';

import {
    humanizeCompilerName,
    warnEmptyCompilerEntries,
    getCompilerCxxStds
} from './compiler-support';

import {
    setEntrySemverComponents,
    setCompilerExecutableNames,
    setCompilerExecutableNamesNoVersion,
    setCompilerContainerNoVersion,
    setSuggestion,
    appendSuggestion,
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

import { generateTable } from './summary-table';

// Re-export handlebars helpers
export { registerHelpers } from './handlebars-helpers';

// Re-export summary table functions
export { generateTable, getAllFactors } from './summary-table';

// Re-export input normalization functions
export { parseKeyValues } from './input-normalization';

// Re-export types for external consumers
export {
    CompilerVersions,
    CompilerFactors,
    CompilerSuggestion,
    KeyValue,
    SubrangePolicyMap,
    MatrixEntry,
    ContainerConfig
} from './types';

// Re-export co-located types
export { SubrangePolicies, type SubrangePolicy } from './versions';
export { type FailureRates, type WorkflowJob, type WorkflowRun } from './failure-rates';
export { type Inputs } from './schema';

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

    const warnedKeys: string[] = [];
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
 * Orchestrates the full matrix generation pipeline.
 *
 * Wraps the matrix generation logic in a class with frozen inputs
 * and pipeline state as class members. Pipeline phases (generate entries,
 * apply factors, set OS, sort) are organized as private methods.
 */
class CppMatrixRunner {
    /** Frozen input configuration */
    private readonly inputs: Inputs;

    /** Accumulated matrix entries */
    private matrix: MatrixEntry[] = [];

    /** Filtered C++ standard versions matching the standards requirement */
    private cxxstds: number[] = [];

    /**
     * Creates a new CppMatrixRunner.
     *
     * @param inputs - Configuration inputs for matrix generation
     */
    constructor(inputs: Inputs) {
        this.inputs = inputs;
    }

    /**
     * Runs the full matrix generation pipeline.
     *
     * @returns Array of matrix entries ready for use in GitHub Actions workflows
     */
    async run(): Promise<MatrixEntry[]> {
        this.resolveCxxStandards();
        await this.generateEntries();
        await this.applyRecommendedFlags();
        this.applyCustomValues();
        this.applyOS();
        this.applyExtraValues();
        this.sortEntries();
        await this.applySortByFailureRate();
        this.logFinalMatrix();
        this.generateSummaryTable();
        this.writeOutputFile();
        return this.matrix;
    }

    /**
     * Resolves C++ standard versions from the standards requirement string.
     */
    private resolveCxxStandards(): void {
        const allcxxstds = ['1998.0.0', '2003.0.0', '2011.0.0', '2014.0.0', '2017.0.0', '2020.0.0', '2023.0.0', '2026.0.0'];
        this.cxxstds = allcxxstds.filter(v => semver.satisfies(v, this.inputs.standards)).map(v => {
            const parsed = semver.parse(v);
            return parsed ? parsed.major : 0;
        }).filter(v => v !== 0);
    }

    /**
     * Generates matrix entries for all compiler/version combinations.
     * Iterates over compilers, resolves version subranges, creates entries,
     * and applies latest/variant/combinatorial factors per compiler.
     */
    private async generateEntries(): Promise<void> {
        const fnlog = traceCommands.scoped('generateMatrix');

        core.startGroup('🔄 Generating matrix entries');
        const compilers = Object.entries(this.inputs.compilers);

        for (const [compilerName0, range] of compilers) {
            fnlog(`Generating entries for ${compilerName0} version ${range}`);
            const earliestIdx = this.matrix.length;
            const compilerName = normalizeCompilerName(compilerName0);
            fnlog(`Find versions for ${compilerName}`);
            const allCompilerVersions = await findCompilerVersions(compilerName);
            let compilerDefault: string;
            if (compilerName === 'gcc' || compilerName === 'clang') {
                compilerDefault = 'ubuntu-defaults-and-latest';
            } else if (compilerName === 'msvc') {
                compilerDefault = 'one-per-vs-year';
            } else if (compilerName === 'apple-clang') {
                compilerDefault = 'macos-defaults-and-latest';
            } else if (compilerName === 'macos-gcc' || compilerName === 'macos-clang') {
                compilerDefault = 'latest';
            } else {
                compilerDefault = 'latest';
            }
            const subrangePolicyStr = this.inputs.subrangePolicy[compilerName] || this.inputs.subrangePolicy[''] || compilerDefault;
            fnlog(`Subrange policy for ${compilerName}: ${subrangePolicyStr}`);
            const subranges = splitRanges(range, allCompilerVersions, getSubrangePolicy(subrangePolicyStr), compilerName);
            fnlog(`${compilerName} sub-ranges: ${JSON.stringify(subranges)}`);

            // Iterate over subranges and generate an entry for each
            for (let i = 0; i < subranges.length; i++) {
                fnlog(`Generating entry for ${compilerName} subrange ${subranges[i]}`);
                const subrange = subranges[i];
                const entry: MatrixEntry = {
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

                let compilerCxxstds: string[] = [];
                if (noKnownVersions) {
                    // No known versions - we can't filter by C++ standard support,
                    // so we don't set cxxstd fields. The entry will test whatever
                    // standards the runner's compiler supports.
                } else {
                    const result = getCompilerCxxStds(
                        entry, this.inputs, allCompilerVersions, this.cxxstds, compilerName, minSubrangeVersion!);
                    if (result === undefined) {
                        // This compiler version does not support any of the standards
                        // we want to test. Skip it.
                        continue;
                    }
                    compilerCxxstds = result;
                }

                setEntrySemverComponents(entry, minSubrangeVersion, maxSubrangeVersion);
                if (minSubrangeVersion) {
                    setCompilerExecutableNames(entry, compilerName, minSubrangeVersion);
                    setCompilerContainer(entry, this.inputs, compilerName, minSubrangeVersion, subrange);
                    setCompilerCMakeGenerator(entry, this.inputs, compilerName, minSubrangeVersion, maxSubrangeVersion!, subrange);
                } else {
                    // No known versions - set defaults based on compiler name
                    setCompilerExecutableNamesNoVersion(entry, compilerName);
                    setCompilerContainerNoVersion(entry, compilerName);
                }
                setCompilerB2Toolset(entry, this.inputs, compilerName, subrange);
                setEntryVersionFlags(entry, i, subranges, minSubrangeVersion, maxSubrangeVersion);
                setEntryName(entry, compilerName, subrange, compilerCxxstds);
                this.matrix.push(entry);
                fnlog(`Entry: ${JSON.stringify(entry)}`);
            }
            if (earliestIdx === this.matrix.length) {
                fnlog(`${compilerName}: 0 basic entries`);
                if (this.inputs.warnNoMatches) {
                    warnEmptyCompilerEntries(compilerName, range, allCompilerVersions, this.cxxstds, this.inputs.standards);
                }
                continue;
            }

            fnlog(`Apply factors for ${compilerName}`);
            const latestIdx = this.matrix.length - 1;
            fnlog(`${compilerName}: ${latestIdx - earliestIdx} basic entries`);
            applyLatestFactors(this.matrix, this.inputs, latestIdx, earliestIdx, compilerName);
            applyVariantFactors(this.matrix, this.inputs, latestIdx, earliestIdx, compilerName);
            applyCombinatorialFactors(this.matrix, this.inputs, latestIdx, earliestIdx, compilerName);
            for (let i = earliestIdx; i < this.matrix.length; i++) {
                if (!('has-factors' in this.matrix[i])) {
                    this.matrix[i]['has-factors'] = false;
                }
                this.matrix[i]['is-no-factor-intermediary'] = this.matrix[i]['is-intermediary'] && !this.matrix[i]['has-factors'];
                this.matrix[i]['is-container'] = 'container' in this.matrix[i];
            }
            fnlog(`${compilerName}: ${this.matrix.length - earliestIdx} total entries`);
        }

        this.printMatrix();
        core.endGroup();
    }

    /**
     * Applies recommended compiler/sanitizer flags to each matrix entry.
     */
    private async applyRecommendedFlags(): Promise<void> {
        core.startGroup('⚙️ Set recommended flags');
        for (const entry of this.matrix) {
            await setRecommendedFlags(entry, this.inputs);
        }
        this.printMatrix();
        core.endGroup();
    }

    /**
     * Applies user-provided custom values (suggestions) to each matrix entry.
     * Handles containers, generators, toolsets, flags, install packages, etc.
     */
    private applyCustomValues(): void {
        core.startGroup('👤 Set custom values');
        for (const entry of this.matrix) {
            if (setSuggestion(entry, 'container', this.inputs.containers, entry.version)) {
                entry['runs-on'] = 'ubuntu-22.04';
            }
            setSuggestion(entry, 'b2-toolset', this.inputs.generators, entry.version);
            setSuggestion(entry, 'generator', this.inputs.generators, entry.version);
            setSuggestion(entry, 'generator-toolset', this.inputs.generatorToolsets, entry.version);
            setSuggestion(entry, 'runs-on', this.inputs.runsOn, entry.version);
            setSuggestion(entry, 'ccflags', this.inputs.ccflags, entry.version);
            setSuggestion(entry, 'cxxflags', this.inputs.cxxflags, entry.version);
            setSuggestion(entry, 'install', this.inputs.install, entry.version);
            setSuggestion(entry, 'triplet', this.inputs.triplets, entry.version);
            setSuggestion(entry, 'build-type', this.inputs.buildTypes, entry.version);
            appendSuggestion(entry, 'ccflags', this.inputs.appendCcflags, entry.version);
            appendSuggestion(entry, 'cxxflags', this.inputs.appendCxxflags, entry.version);
            appendSuggestion(entry, 'install', this.inputs.appendInstall, entry.version);
            applyForcedFactors(entry, this.inputs.forceFactors, entry.version);
        }
        this.printMatrix();
        core.endGroup();
    }

    /**
     * Sets the OS field for each matrix entry based on runs-on configuration.
     */
    private applyOS(): void {
        core.startGroup('🖥️ Set OS');
        setOS(this.matrix);
        core.endGroup();
    }

    /**
     * Injects extra key-value pairs into all matrix entries using Handlebars templates.
     */
    private applyExtraValues(): void {
        if (this.inputs.extraValues) {
            core.startGroup('🔧 Add extra values');
            injectExtraValues(this.matrix, this.inputs.extraValues);
            core.endGroup();
        }
    }

    /**
     * Sorts matrix entries by compiler, version, and factors.
     */
    private sortEntries(): void {
        core.startGroup('🔀 Sort matrix');
        sortMatrix(this.matrix, this.inputs);
        this.printMatrix();
        core.endGroup();
    }

    /**
     * Sorts matrix entries by historical failure rate if enabled.
     */
    private async applySortByFailureRate(): Promise<void> {
        if (!this.inputs.sortByFailureRate) {
            return;
        }
        core.startGroup('📊 Sort by failure rate');
        core.info(`Fetching failure rates from last ${this.inputs.failureRateRuns} workflow runs...`);
        const failureRates = await fetchFailureRates(this.inputs.failureRateRuns, this.inputs.githubToken);
        if (failureRates) {
            sortByFailureRate(this.matrix, failureRates);
            core.info('Matrix sorted by failure rate (high to low)');
            this.printMatrix();
        } else {
            core.info('Could not fetch failure rates, keeping existing order');
        }
        core.endGroup();
    }

    /**
     * Logs the final matrix to the action output.
     */
    private logFinalMatrix(): void {
        core.startGroup('🏁 Final matrix');
        if (this.inputs.logMatrix) {
            core.info(`Matrix (${this.matrix.length} entries):`);
            this.matrix.forEach((obj) => {
                core.info(`- ${JSON.stringify(obj)}`);
            });
        } else {
            this.printMatrix();
        }
        core.endGroup();
    }

    /**
     * Generates a summary table if enabled.
     */
    private generateSummaryTable(): void {
        if (!this.inputs.generateSummary) {
            return;
        }
        core.startGroup('📋 C++ Matrix Summary');
        const table = generateTable(this.matrix, this.inputs);
        core.summary.addHeading('C++ Test Matrix').addTable(table).write().then(result => {
            traceCommands.log('Table generated' + JSON.stringify(result));
        }).catch(error => {
            traceCommands.log('An error occurred generating the table:' + JSON.stringify(error));
        });
        core.info('Summary table generated');
        core.endGroup();
    }

    /**
     * Writes the matrix to a file if an output file is specified.
     */
    private writeOutputFile(): void {
        if (!this.inputs.outputFile) {
            return;
        }
        core.startGroup('📄 Write matrix to file');
        const filename = path.resolve(this.inputs.outputFile);
        const content = JSON.stringify(this.matrix, null, 2);
        fs.writeFileSync(filename, content);
        core.info(`Matrix written to ${filename}`);
        core.endGroup();
    }

    /**
     * Logs the current matrix state to trace output.
     */
    private printMatrix(): void {
        traceCommands.log(`Matrix (${this.matrix.length} entries):`);
        this.matrix.forEach(obj => {
            traceCommands.log(`- ${JSON.stringify(obj)}`);
        });
    }
}

/**
 * Generates the complete CI/CD test matrix based on parsed input configuration.
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
    return new CppMatrixRunner(inputs).run();
}

/**
 * Generates the matrix from schema-inferred inputs.
 *
 * @param inputs - Schema-inferred inputs with transforms applied
 * @returns The generated matrix entries
 */
export async function main(inputs: Inputs): Promise<MatrixEntry[]> {
    return await generateMatrix(inputs);
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'C++ Matrix',
    main: async (inputs: Inputs) => {
        const matrixEntries = await main(inputs);
        const matrixJson = JSON.stringify(matrixEntries);
        core.setOutput('matrix', matrixJson);
        return { matrix: matrixJson };
    },
    callerModule: module
});
