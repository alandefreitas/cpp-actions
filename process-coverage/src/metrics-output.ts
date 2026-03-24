/**
 * Coverage metrics output formatting.
 *
 * Converts parsed LCOV coverage metrics into the output object
 * expected by the action's output schema, with percentage values
 * formatted to one decimal place.
 *
 * @module metrics-output
 */

import * as path from 'node:path';

import {writeFile} from 'node:fs/promises';

import type {CoverageMetrics, LcovFile} from './lcov-parser';
import {serializeLcov} from './lcov-parser';
import type {NewCodeMetrics} from './new-code';

/**
 * Formats a coverage percentage as a string with one decimal place.
 *
 * Returns `'0.0'` when the total is zero to avoid division by zero.
 *
 * @param covered - Number of covered items
 * @param total - Total number of items
 * @returns Percentage string with one decimal (e.g. `'85.7'`)
 */
export function formatPercent(covered: number, total: number): string {
    if (total === 0) {
        return '0.0';
    }
    return ((covered / total) * 100).toFixed(1);
}

/** Shape of the coverage metrics portion of the action outputs. */
export interface MetricsOutputs {
    /** Absolute path to the final LCOV .info file. */
    lcovFile: string;
    /** Absolute path to HTML report directory, or empty string. */
    htmlReportDir: string;
    /** Number of covered lines as a string. */
    linesCovered: string;
    /** Total number of instrumented lines as a string. */
    linesTotal: string;
    /** Line coverage percentage with one decimal. */
    linesPercent: string;
    /** Number of covered functions as a string. */
    functionsCovered: string;
    /** Total number of instrumented functions as a string. */
    functionsTotal: string;
    /** Function coverage percentage with one decimal. */
    functionsPercent: string;
    /** Number of covered branches as a string. */
    branchesCovered: string;
    /** Total number of instrumented branches as a string. */
    branchesTotal: string;
    /** Branch coverage percentage with one decimal. */
    branchesPercent: string;
    /** Number of covered new lines as a string. */
    newLinesCovered: string;
    /** Total number of new instrumented lines as a string. */
    newLinesTotal: string;
    /** New-code line coverage percentage with one decimal. */
    newLinesPercent: string;
    /** Number of covered new functions as a string. */
    newFunctionsCovered: string;
    /** Total number of new functions as a string. */
    newFunctionsTotal: string;
    /** New-code function coverage percentage with one decimal. */
    newFunctionsPercent: string;
    /** Number of covered new branches as a string. */
    newBranchesCovered: string;
    /** Total number of new branches as a string. */
    newBranchesTotal: string;
    /** New-code branch coverage percentage with one decimal. */
    newBranchesPercent: string;
}

/**
 * Builds the action outputs object from coverage metrics.
 *
 * All numeric values are converted to strings since GitHub Actions
 * outputs are always strings. Percentage values are formatted with
 * one decimal place.
 *
 * @param metrics - Aggregated coverage metrics from LCOV data
 * @param lcovFilePath - Absolute path to the written LCOV .info file
 * @param newCodeMetrics - Optional new-code coverage metrics from diff analysis
 * @returns Output object matching the action's output schema
 */
export function buildMetricsOutputs(
    metrics: CoverageMetrics,
    lcovFilePath: string,
    newCodeMetrics?: NewCodeMetrics
): MetricsOutputs {
    return {
        lcovFile: lcovFilePath,
        htmlReportDir: '',
        linesCovered: String(metrics.linesCovered),
        linesTotal: String(metrics.linesTotal),
        linesPercent: formatPercent(metrics.linesCovered, metrics.linesTotal),
        functionsCovered: String(metrics.functionsCovered),
        functionsTotal: String(metrics.functionsTotal),
        functionsPercent: formatPercent(
            metrics.functionsCovered,
            metrics.functionsTotal
        ),
        branchesCovered: String(metrics.branchesCovered),
        branchesTotal: String(metrics.branchesTotal),
        branchesPercent: formatPercent(
            metrics.branchesCovered,
            metrics.branchesTotal
        ),
        newLinesCovered: newCodeMetrics
            ? String(newCodeMetrics.coveredLines)
            : '0',
        newLinesTotal: newCodeMetrics
            ? String(newCodeMetrics.totalLines)
            : '0',
        newLinesPercent: newCodeMetrics
            ? formatPercent(
                  newCodeMetrics.coveredLines,
                  newCodeMetrics.totalLines
              )
            : '0.0',
        newFunctionsCovered: newCodeMetrics
            ? String(newCodeMetrics.coveredFunctions)
            : '0',
        newFunctionsTotal: newCodeMetrics
            ? String(newCodeMetrics.totalFunctions)
            : '0',
        newFunctionsPercent: newCodeMetrics
            ? formatPercent(
                  newCodeMetrics.coveredFunctions,
                  newCodeMetrics.totalFunctions
              )
            : '0.0',
        newBranchesCovered: newCodeMetrics
            ? String(newCodeMetrics.coveredBranches)
            : '0',
        newBranchesTotal: newCodeMetrics
            ? String(newCodeMetrics.totalBranches)
            : '0',
        newBranchesPercent: newCodeMetrics
            ? formatPercent(
                  newCodeMetrics.coveredBranches,
                  newCodeMetrics.totalBranches
              )
            : '0.0'
    };
}

/**
 * Writes the final LCOV data to disk and returns the absolute file path.
 *
 * Serializes the parsed LCOV data back to `.info` format and writes it
 * to the specified output directory.
 *
 * @param lcovData - Parsed LCOV file sections to serialize
 * @param outputDir - Directory where the .info file will be written
 * @param filename - Name of the output file (default: `'lcov.info'`)
 * @returns Absolute path to the written LCOV file
 * @throws If writing the file fails (e.g., permission denied or directory does not exist)
 */
export async function writeLcovFile(
    lcovData: LcovFile,
    outputDir: string,
    filename: string = 'lcov.info'
): Promise<string> {
    const content = serializeLcov(lcovData);
    const outputPath = path.resolve(outputDir, filename);
    await writeFile(outputPath, content, {encoding: 'utf-8'});
    return outputPath;
}
