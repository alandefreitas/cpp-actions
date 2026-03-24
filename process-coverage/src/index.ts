/**
 * Main entry point for the process-coverage action.
 *
 * Provides a unified post-test C++ coverage processing pipeline
 * for GCC (gcov/lcov) and Clang (llvm-cov) toolchains.
 *
 * @module index
 */

import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as core from '@actions/core';
import { runAction } from 'action-schema';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Type imports and re-exports
import { type Inputs } from './schema';
export type { Inputs };

// Pipeline imports
import { resolveCompilerInfo, discoverExecutables } from './detect-compiler';
import { findGcov, findLcov, findGenhtml } from './gcc-tools';
import { findLlvmProfdata, findLlvmCov } from './clang-tools';
import { captureGccCoverage } from './gcc-pipeline';
import { mergeProfrawFiles, exportClangCoverage } from './clang-pipeline';
import { parseLcov, extractMetrics } from './lcov-parser';
import { filterByPaths, stripExclMarkers } from './lcov-filter';
import { buildMetricsOutputs, writeLcovFile } from './metrics-output';
import { getChangedLines, analyzeNewCodeCoverage } from './new-code';
import { writeSummary } from './summary';
import { generateHtmlReport, uploadHtmlArtifact } from './html-report';
import { runUploads } from './upload';

import type { MetricsOutputs } from './metrics-output';
import type { NewCodeMetrics } from './new-code';
import type { LcovFile } from './lcov-parser';

/**
 * Orchestrates the coverage processing pipeline.
 *
 * Each public method corresponds to one pipeline step and is wrapped
 * in a `core.startGroup` / `core.endGroup` block for CI log folding.
 */
class ProcessCoverageRunner {
    private readonly inputs: Inputs;
    private readonly outputDir: string;

    /** Resolved compiler family (`'gcc'` or `'clang'`). Set by {@link detectCompiler}. */
    compiler = '';

    /** Resolved compiler major version. Set by {@link detectCompiler}. */
    majorVersion = '';

    /** Absolute path to the raw LCOV .info file. Set by the capture step. */
    rawInfoFile = '';

    /** Parsed and filtered LCOV data. Set by {@link filterCoverage}. */
    lcovData: LcovFile = [];

    /** Absolute path to the final LCOV file. Set by {@link extractMetrics}. */
    lcovFilePath = '';

    /** New-code coverage metrics from git diff analysis. */
    newCodeMetrics: NewCodeMetrics | undefined;

    /** Changed lines map for per-file new-code breakdown. */
    changedLines: Map<string, Set<number>> | undefined;

    /** Action outputs. Built by {@link extractMetrics}. */
    outputs: MetricsOutputs | undefined;

    /**
     * @param inputs - Parsed action inputs
     */
    constructor(inputs: Inputs) {
        this.inputs = inputs;
        this.outputDir = path.join(os.tmpdir(), 'process-coverage');
        mkdirSync(this.outputDir, { recursive: true });
    }

    /**
     * Runs the full coverage processing pipeline.
     *
     * @returns Action outputs for downstream steps
     */
    async run(): Promise<MetricsOutputs> {
        await this.detectCompiler();
        await this.captureRawCoverage();
        await this.filterCoverage();
        await this.extractMetricsAndAnalyze();
        await this.generateHtmlReport();
        await this.writeStepSummary();
        await this.uploadToServices();
        return this.outputs!;
    }

    /**
     * Step 1: Detect compiler family and version.
     */
    async detectCompiler(): Promise<void> {
        core.startGroup('🔍 Detect compiler');
        try {
            const info = await resolveCompilerInfo({
                compiler: this.inputs.compiler,
                compilerVersion: this.inputs.compilerVersion,
                cxx: this.inputs.cxx,
                buildDir: this.inputs.buildDir,
                profrawPattern: this.inputs.profrawPattern
            });
            this.compiler = info.compiler;
            this.majorVersion = info.majorVersion;
            core.info(`Compiler: ${this.compiler}${this.majorVersion ? ` ${this.majorVersion}` : ''}`);
        } finally {
            core.endGroup();
        }
    }

    /**
     * Step 2: Capture raw coverage data (GCC or Clang pipeline).
     */
    async captureRawCoverage(): Promise<void> {
        if (this.compiler === 'gcc') {
            await this.captureGcc();
        } else {
            await this.captureClang();
        }
    }

    /**
     * Step 3: Parse LCOV, apply path filters, strip exclusion markers.
     */
    async filterCoverage(): Promise<void> {
        core.startGroup('🔍 Filter coverage data');
        try {
            const rawContent = await readFile(this.rawInfoFile, 'utf-8');
            this.lcovData = parseLcov(rawContent);

            if (this.inputs.include.length > 0 || this.inputs.exclude.length > 0) {
                this.lcovData = filterByPaths(
                    this.lcovData,
                    this.inputs.include,
                    this.inputs.exclude
                );
                core.info(`Filtered LCOV: ${this.lcovData.length} section(s) remaining`);
            }

            if (this.inputs.stripExclMarkers) {
                const beforeCount = this.lcovData.reduce((s, sec) => s + sec.lines.length, 0);
                this.lcovData = await stripExclMarkers(this.lcovData);
                const afterCount = this.lcovData.reduce((s, sec) => s + sec.lines.length, 0);
                const removed = beforeCount - afterCount;
                if (removed > 0) {
                    core.info(`Stripped ${removed} line(s) via LCOV_EXCL / GCOV_EXCL markers`);
                } else {
                    core.info('No LCOV_EXCL / GCOV_EXCL markers found');
                }
            }
        } finally {
            core.endGroup();
        }
    }

    /**
     * Step 4: Extract metrics, run new-code analysis, write LCOV file.
     */
    async extractMetricsAndAnalyze(): Promise<void> {
        core.startGroup('📊 Extract coverage metrics');
        try {
            const metrics = extractMetrics(this.lcovData);
            this.lcovFilePath = await writeLcovFile(this.lcovData, this.outputDir);
            core.info(
                `Coverage: ${metrics.linesCovered}/${metrics.linesTotal} lines, ` +
                `${metrics.functionsCovered}/${metrics.functionsTotal} functions` +
                (metrics.branchesTotal > 0
                    ? `, ${metrics.branchesCovered}/${metrics.branchesTotal} branches`
                    : '')
            );

            // New-code analysis
            try {
                this.changedLines = await getChangedLines(this.inputs.diffBase);
                if (this.changedLines.size > 0) {
                    this.newCodeMetrics = analyzeNewCodeCoverage(
                        this.lcovData,
                        this.changedLines
                    );
                    core.info(
                        `New code: ${this.newCodeMetrics.coveredLines}/${this.newCodeMetrics.totalLines} lines covered`
                    );
                } else {
                    this.newCodeMetrics = {
                        coveredLines: 0, totalLines: 0,
                        coveredFunctions: 0, totalFunctions: 0,
                        coveredBranches: 0, totalBranches: 0,
                        percent: 0, uncoveredFiles: []
                    };
                }
            } catch (error) {
                core.warning(
                    `New-code analysis failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }

            this.outputs = buildMetricsOutputs(metrics, this.lcovFilePath, this.newCodeMetrics);
        } finally {
            core.endGroup();
        }
    }

    /**
     * Step 5: Generate HTML report and upload artifact (optional).
     */
    async generateHtmlReport(): Promise<void> {
        if (!this.inputs.htmlReport) {
            return;
        }

        core.startGroup('📄 Generate HTML report');
        try {
            const reportDir = path.join(this.outputDir, 'html-report');
            let genhtmlPath: string | undefined;

            try {
                genhtmlPath = await findGenhtml();
            } catch (error) {
                core.warning(
                    `Failed to find or install genhtml — skipping HTML report. ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }

            const reportResult = await generateHtmlReport(
                this.lcovFilePath, reportDir, genhtmlPath
            );

            if (reportResult) {
                this.outputs!.htmlReportDir = reportResult;

                if (this.inputs.htmlReportArtifact) {
                    const artifactName = this.inputs.htmlReportArtifact === '<auto>'
                        ? `coverage-report-${this.compiler}-${process.platform}`
                        : this.inputs.htmlReportArtifact;
                    await uploadHtmlArtifact(
                        reportResult, artifactName, this.inputs.htmlReportRetentionDays
                    );
                }
            }
        } finally {
            core.endGroup();
        }
    }

    /**
     * Step 6: Write step summary (optional).
     */
    async writeStepSummary(): Promise<void> {
        if (!this.inputs.summary) {
            return;
        }

        core.startGroup('📝 Write step summary');
        try {
            await writeSummary(
                extractMetrics(this.lcovData),
                this.newCodeMetrics,
                {
                    codecov: !!this.inputs.codecovToken,
                    lcovData: this.lcovData,
                    changedLines: this.changedLines
                }
            );
        } catch (error) {
            core.warning(
                `Step summary failed: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            core.endGroup();
        }
    }

    /**
     * Step 7: Upload to Codecov and/or Coveralls (optional).
     */
    async uploadToServices(): Promise<void> {
        await runUploads({
            lcovFile: this.lcovFilePath,
            failOnUploadError: this.inputs.failOnUploadError,
            codecovToken: this.inputs.codecovToken,
            codecovFlags: this.inputs.codecovFlags,
            codecovArgs: this.inputs.codecovArgs,
            coverallsToken: this.inputs.coverallsToken,
            coverallsArgs: this.inputs.coverallsArgs
        });
    }

    // ---- Private helpers ----

    /** Finds GCC tools and captures coverage via lcov. */
    private async captureGcc(): Promise<void> {
        core.startGroup('🔧 Find GCC coverage tools');
        let gcovPath: string;
        let lcovPath: string;
        try {
            [gcovPath, lcovPath] = await Promise.all([
                findGcov(this.majorVersion),
                findLcov()
            ]);
            core.info(`gcov: ${gcovPath}`);
            core.info(`lcov: ${lcovPath}`);
        } finally {
            core.endGroup();
        }

        core.startGroup('📋 Capture GCC coverage data');
        try {
            this.rawInfoFile = await captureGccCoverage({
                lcovPath, gcovPath,
                buildDirs: this.inputs.buildDir,
                outputDir: this.outputDir
            });
            core.info(`Captured coverage from ${this.inputs.buildDir.length} build dir(s) → ${this.rawInfoFile}`);
        } finally {
            core.endGroup();
        }
    }

    /** Finds Clang tools, merges profraw, and exports to LCOV. */
    private async captureClang(): Promise<void> {
        core.startGroup('🔧 Find Clang coverage tools');
        let llvmProfdataPath: string;
        let llvmCovPath: string;
        try {
            [llvmProfdataPath, llvmCovPath] = await Promise.all([
                findLlvmProfdata(this.majorVersion),
                findLlvmCov(this.majorVersion)
            ]);
            core.info(`llvm-profdata: ${llvmProfdataPath}`);
            core.info(`llvm-cov: ${llvmCovPath}`);
        } finally {
            core.endGroup();
        }

        core.startGroup('📋 Merge profraw files');
        let profdataPath: string;
        try {
            profdataPath = await mergeProfrawFiles({
                llvmProfdataPath,
                buildDirs: this.inputs.buildDir,
                profrawPattern: this.inputs.profrawPattern,
                outputDir: this.outputDir
            });
            core.info(`Merged profdata: ${profdataPath}`);
        } finally {
            core.endGroup();
        }

        core.startGroup('🔄 Convert Clang coverage to LCOV');
        try {
            let binaries = this.inputs.binaries;
            if (binaries.length === 0) {
                core.info('No binaries specified — auto-discovering executables in build directories');
                binaries = await discoverExecutables(this.inputs.buildDir);
                if (binaries.length > 0) {
                    core.info(`Discovered ${binaries.length} executable(s): ${binaries.join(', ')}`);
                }
            }

            this.rawInfoFile = await exportClangCoverage({
                llvmCovPath, profdataPath, binaries,
                outputDir: this.outputDir
            });
            core.info(`LCOV output: ${this.rawInfoFile}`);
        } finally {
            core.endGroup();
        }
    }
}

/**
 * Runs the full coverage processing pipeline.
 *
 * @param inputs - Parsed action inputs
 * @returns Action outputs for downstream steps
 */
export async function main(inputs: Inputs): Promise<MetricsOutputs> {
    return new ProcessCoverageRunner(inputs).run();
}

runAction({
    inputsSchema,
    outputsSchema,
    title: 'Process Coverage',
    main: async (inputs: Inputs) => main(inputs),
    callerModule: module
});
