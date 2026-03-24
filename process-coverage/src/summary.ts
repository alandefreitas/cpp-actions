/**
 * Coverage summary generation for GitHub Actions step summary.
 *
 * Writes a coverage table with line, function, and branch coverage
 * metrics to the GitHub Actions step summary panel, with optional
 * per-file breakdown and Codecov integration.
 *
 * @module summary
 */

import * as path from 'node:path';
import * as core from '@actions/core';

import type {CoverageMetrics, LcovFile} from './lcov-parser';
import {formatPercent} from './metrics-output';
import type {NewCodeMetrics} from './new-code';

/** Options for summary generation. */
export interface SummaryOptions {
    /** Whether to include Codecov badges and charts. */
    codecov?: boolean;
    /** Parsed LCOV data for per-file breakdown. */
    lcovData?: LcovFile;
    /** Changed lines from git diff, for per-file new-code coverage. */
    changedLines?: Map<string, Set<number>>;
}

/**
 * Formats a coverage cell as "83.3% (10/12)".
 *
 * @param covered - Number of covered items
 * @param total - Total number of items
 * @returns Formatted cell string
 */
function cell(covered: number, total: number): string {
    return `${formatPercent(covered, total)}% (${covered}/${total})`;
}

/**
 * Writes a coverage summary table to the GitHub Actions step summary.
 *
 * Produces a table with rows for Lines, Functions, and optionally
 * Branches. When new-code metrics are available, adds an "Overall"
 * and "New Code" column layout. Includes optional per-file breakdown
 * in a collapsible section and Codecov badges.
 *
 * Also logs a text summary to the console for immediate visibility
 * in the CI log.
 *
 * @param metrics - Aggregated coverage metrics from LCOV data
 * @param newCodeMetrics - Optional new-code coverage metrics from diff analysis
 * @param options - Optional settings (codecov badges, per-file data)
 */
export async function writeSummary(
    metrics: CoverageMetrics,
    newCodeMetrics?: NewCodeMetrics,
    options?: SummaryOptions
): Promise<void> {
    core.summary.addHeading('Coverage', 2);

    const analysisRan = newCodeMetrics !== undefined;
    const hasNewCode = analysisRan && newCodeMetrics.totalLines > 0;
    const hasBranches = metrics.branchesTotal > 0;

    type Row = Array<{data: string; header?: boolean}>;

    // Header row — show New Code column when analysis ran (even if 0 lines)
    const headerRow: Row = [{data: '', header: true}];
    if (analysisRan) {
        headerRow.push({data: 'Overall', header: true});
        headerRow.push({data: 'New Code', header: true});
    } else {
        headerRow.push({data: 'Coverage', header: true});
    }

    /** Formats a new-code cell, or "No changes" when totalLines is 0. */
    function newCodeCell(covered: number, total: number): string {
        return total > 0 ? cell(covered, total) : 'No changes';
    }

    // Lines row
    const linesRow: Row = [{data: '<b>Lines</b>'}];
    linesRow.push({data: cell(metrics.linesCovered, metrics.linesTotal)});
    if (analysisRan) {
        linesRow.push({data: newCodeCell(newCodeMetrics.coveredLines, newCodeMetrics.totalLines)});
    }

    // Functions row
    const functionsRow: Row = [{data: '<b>Functions</b>'}];
    functionsRow.push({data: cell(metrics.functionsCovered, metrics.functionsTotal)});
    if (analysisRan) {
        functionsRow.push({data: newCodeCell(newCodeMetrics.coveredFunctions, newCodeMetrics.totalFunctions)});
    }

    const rows: Row[] = [headerRow, linesRow, functionsRow];

    // Branches row (optional)
    if (hasBranches) {
        const branchesRow: Row = [{data: '<b>Branches</b>'}];
        branchesRow.push({data: cell(metrics.branchesCovered, metrics.branchesTotal)});
        if (analysisRan) {
            branchesRow.push({data: newCodeCell(newCodeMetrics.coveredBranches, newCodeMetrics.totalBranches)});
        }
        rows.push(branchesRow);
    }

    core.summary.addTable(rows);

    // Log summary to console for immediate visibility in CI log
    core.info(`Lines: ${cell(metrics.linesCovered, metrics.linesTotal)}`);
    core.info(`Functions: ${cell(metrics.functionsCovered, metrics.functionsTotal)}`);
    if (hasBranches) {
        core.info(`Branches: ${cell(metrics.branchesCovered, metrics.branchesTotal)}`);
    }
    if (analysisRan) {
        if (hasNewCode) {
            core.info(`New code lines: ${cell(newCodeMetrics.coveredLines, newCodeMetrics.totalLines)}`);
        } else {
            core.info('New code: no changed source lines detected');
        }
    }

    // Uncovered new lines
    if (hasNewCode && newCodeMetrics.uncoveredFiles.length > 0) {
        const fileLines = newCodeMetrics.uncoveredFiles
            .slice(0, 20)
            .map(
                (f) =>
                    `- \`${f.file}\`: ${formatLineRanges(f.lines)}`
            );
        core.summary.addRaw(
            '\n**Uncovered new lines:**\n' + fileLines.join('\n') + '\n'
        );
    }

    // Per-file coverage breakdown (collapsible)
    if (options?.lcovData && options.lcovData.length > 0) {
        const changed = options.changedLines;
        const showNewCode = analysisRan && changed && changed.size > 0;

        const fileSummaries = options.lcovData
            .map(section => {
                const linesHit = section.lines.filter(da => da.count > 0).length;
                const linesTotal = section.lines.length;

                // Match changed lines to this file
                let newHit = 0;
                let newTotal = 0;
                if (showNewCode) {
                    const normalizedSf = path.normalize(section.sourceFile);
                    const daMap = new Map(section.lines.map(da => [da.line, da.count]));
                    for (const [diffPath, diffLines] of changed) {
                        const normalizedDiff = path.normalize(diffPath);
                        if (normalizedSf === normalizedDiff ||
                            normalizedSf.endsWith(path.sep + normalizedDiff)) {
                            for (const lineNum of diffLines) {
                                const count = daMap.get(lineNum);
                                if (count !== undefined) {
                                    newTotal++;
                                    if (count > 0) {
                                        newHit++;
                                    }
                                }
                            }
                        }
                    }
                }

                return {
                    file: section.sourceFile,
                    linesHit,
                    linesTotal,
                    percent: linesTotal > 0 ? (linesHit / linesTotal) * 100 : 100,
                    newHit,
                    newTotal,
                    newPercent: newTotal > 0 ? (newHit / newTotal) * 100 : -1
                };
            })
            .filter(f => f.linesTotal > 0)
            .sort((a, b) => {
                // Sort by new-code coverage first (worst first), then by overall
                // Files with new code (newTotal > 0) come before files without
                if (a.newTotal > 0 && b.newTotal <= 0) return -1;
                if (a.newTotal <= 0 && b.newTotal > 0) return 1;
                if (a.newTotal > 0 && b.newTotal > 0) {
                    const diff = a.newPercent - b.newPercent;
                    if (diff !== 0) return diff;
                }
                return a.percent - b.percent;
            });

        if (fileSummaries.length > 0) {
            const newCodeHeader = showNewCode ? ' | New Code' : '';
            const newCodeSep = showNewCode ? ' | --------' : '';
            const fileRows = fileSummaries.map(f => {
                const newCol = showNewCode
                    ? (f.newTotal > 0
                        ? ` | ${(f.newPercent).toFixed(1)}% (${f.newHit}/${f.newTotal})`
                        : ' | —')
                    : '';
                return `| \`${shortenPath(f.file)}\` | ${f.percent.toFixed(1)}% (${f.linesHit}/${f.linesTotal})${newCol} |`;
            });
            core.summary.addRaw(
                '\n<details><summary><b>Coverage by file</b> (' +
                `${fileSummaries.length} files)</summary>\n\n` +
                `| File | Overall${newCodeHeader} |\n` +
                `|------|---------${newCodeSep} |\n` +
                fileRows.join('\n') + '\n\n</details>\n'
            );
        }
    }

    // Codecov section
    if (options?.codecov) {
        const repo = process.env.GITHUB_REPOSITORY ?? '';
        const sha = process.env.GITHUB_SHA ?? '';
        const branch = process.env.GITHUB_REF_NAME ?? '';
        if (repo && sha) {
            const commitUrl = `https://codecov.io/github/${repo}/commit/${sha}`;
            const appUrl = `https://app.codecov.io/github/${repo}/commit/${sha}`;

            core.summary.addHeading('Codecov', 3);
            core.summary.addRaw(
                `<a href="${appUrl}" target="_blank">` +
                `<img src="${commitUrl}/graphs/sunburst.svg" alt="Codecov sunburst" width="200">` +
                `</a>\n\n`
            );
            core.summary.addRaw(
                `Commit: <a href="${appUrl}" target="_blank">` +
                `<img src="${commitUrl}/graph/badge.svg" alt="Codecov commit badge">` +
                `</a>\n\n`
            );
            if (branch) {
                const branchBadge = `https://codecov.io/github/${repo}/branch/${branch}/graph/badge.svg`;
                core.summary.addRaw(
                    `Branch: <a href="${appUrl}" target="_blank">` +
                    `<img src="${branchBadge}" alt="Codecov branch badge">` +
                    `</a>\n\n`
                );
            }
            core.summary.addRaw(
                `<a href="${appUrl}" target="_blank">View full report on Codecov</a>\n`
            );
        }
    }

    await core.summary.write();
}

/**
 * Shortens an absolute file path for display.
 *
 * Removes common prefixes like the workspace directory to keep
 * the table readable.
 *
 * @param filePath - Absolute file path
 * @returns Shortened path
 */
function shortenPath(filePath: string): string {
    const workspace = process.env.GITHUB_WORKSPACE;
    if (workspace && filePath.startsWith(workspace)) {
        return filePath.slice(workspace.length + 1); // +1 for trailing /
    }
    // Remove common /home/runner/work/... prefixes
    const match = /\/(?:home|root)\/[^/]+\/work\/[^/]+\/[^/]+\/(.+)/.exec(filePath);
    if (match) {
        return match[1];
    }
    return filePath;
}

/**
 * Formats an array of line numbers into compact ranges.
 *
 * Groups consecutive line numbers into ranges (e.g. `[1,2,3,5,7,8]`
 * becomes `"1-3, 5, 7-8"`).
 *
 * @param lines - Sorted array of line numbers
 * @returns Compact string representation of the line ranges
 */
export function formatLineRanges(lines: number[]): string {
    if (lines.length === 0) {
        return '';
    }

    const ranges: string[] = [];
    let start = lines[0];
    let end = lines[0];

    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === end + 1) {
            end = lines[i];
        } else {
            ranges.push(start === end ? String(start) : `${start}-${end}`);
            start = lines[i];
            end = lines[i];
        }
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);

    return ranges.join(', ');
}
