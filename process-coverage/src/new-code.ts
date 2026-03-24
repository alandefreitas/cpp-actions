/**
 * New-code coverage analysis via git diff.
 *
 * Parses git diff output to identify changed lines, then cross-references
 * with LCOV data to compute coverage metrics for new or modified code.
 *
 * @module new-code
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';

import type {LcovFile} from './lcov-parser';

const fnlog = traceCommands.scoped('new-code');

/** Coverage metrics for new or modified code. */
export interface NewCodeMetrics {
    /** Number of new/modified lines with execution count > 0. */
    coveredLines: number;
    /** Total number of new/modified instrumented lines. */
    totalLines: number;
    /** Number of new/modified functions with execution count > 0. */
    coveredFunctions: number;
    /** Total number of new/modified functions. */
    totalFunctions: number;
    /** Number of new/modified branches with execution count > 0. */
    coveredBranches: number;
    /** Total number of new/modified branches. */
    totalBranches: number;
    /** Coverage percentage for new code lines. */
    percent: number;
    /** Files with uncovered new lines, sorted by path. */
    uncoveredFiles: Array<{file: string; lines: number[]}>;
}

/**
 * Identifies changed lines in files by parsing git diff output.
 *
 * Runs `git diff --unified=0 --diff-filter=AM <base>` to find added
 * and modified files, then parses `@@` hunk headers to extract the
 * exact line numbers that were changed.
 *
 * @param diffBase - Git ref to diff against (e.g. `'origin/main'`, `'HEAD~1'`)
 * @returns Map of file path to set of changed line numbers, or empty map if diff fails
 */
export async function getChangedLines(
    diffBase: string
): Promise<Map<string, Set<number>>> {
    const base = diffBase || autoDetectBase();
    await ensureRefAvailable(base);

    const stdout = await tryDiff(base);
    if (stdout === null) {
        core.info('Could not compute git diff — skipping new-code analysis.');
        return new Map();
    }

    return parseDiffOutput(stdout);
}

/**
 * Attempts to run git diff against a base ref and returns stdout, or null on failure.
 *
 * @param base - The git ref to diff against
 * @returns The diff stdout, or null if the diff failed
 */
async function tryDiff(base: string): Promise<string | null> {
    try {
        const result = await exec.getExecOutput(
            'git',
            ['diff', '--unified=0', '--diff-filter=AM', base],
            {silent: true, ignoreReturnCode: true}
        );
        if (result.exitCode === 0) {
            return result.stdout;
        }
        fnlog(
            `git diff against "${base}" failed (exit ${result.exitCode})` +
            (result.stderr ? `: ${result.stderr.trim()}` : '')
        );
    } catch (e) {
        fnlog(`git diff against "${base}" failed: ${e instanceof Error ? e.message : e}`);
    }
    return null;
}

/**
 * Ensures a git ref is available in the local repo, fetching it if needed.
 *
 * Handles shallow clones by fetching the specific ref from origin
 * when it's not locally available. This makes new-code analysis work
 * with the default `actions/checkout` (fetch-depth: 1).
 *
 * @param ref - The git ref to ensure is available
 */
async function ensureRefAvailable(ref: string): Promise<void> {
    // Check if the ref is already resolvable
    if (await isRefResolvable(ref)) {
        return;
    }

    // For HEAD~N refs, deepen the clone by the required amount
    const headMatch = /^HEAD~(\d+)$/.exec(ref);
    if (headMatch) {
        const depth = parseInt(headMatch[1], 10) + 1;
        fnlog(`Deepening clone by ${depth} commits to resolve ${ref}`);
        try {
            await exec.getExecOutput(
                'git', ['fetch', '--deepen', String(depth)],
                {silent: true}
            );
        } catch (e) {
            core.debug(`git fetch --deepen ${depth} failed: ${e instanceof Error ? e.message : e}`);
        }
        return;
    }

    // For branch/tag refs (e.g., origin/develop), fetch from remote
    const remoteName = ref.startsWith('origin/')
        ? ref.slice('origin/'.length)
        : ref;
    fnlog(`Fetching ref "${remoteName}" from origin`);
    try {
        await exec.getExecOutput(
            'git', ['fetch', '--depth=1', 'origin', remoteName],
            {silent: true}
        );
    } catch {
        core.debug(`git fetch origin ${remoteName} failed`);
    }
}

/**
 * Checks if a git ref can be resolved locally.
 *
 * @param ref - The git ref to check
 * @returns true if the ref exists locally
 */
async function isRefResolvable(ref: string): Promise<boolean> {
    try {
        // Use 'git log -1' to verify the ref is fully available (not just
        // a shallow boundary graft). rev-parse succeeds for grafted SHAs
        // but git diff/log fail on them because the tree is missing.
        const result = await exec.getExecOutput(
            'git', ['log', '-1', '--format=%H', ref],
            {silent: true, ignoreReturnCode: true}
        );
        return result.exitCode === 0;
    } catch {
        return false;
    }
}

/**
 * Auto-detects the diff base ref from the GitHub Actions environment.
 *
 * For pull requests, uses `GITHUB_BASE_REF` (the PR target branch).
 * For push events, reads the `before` SHA from the GitHub event payload
 * (the commit before the push), falling back to `HEAD~1`.
 *
 * @returns The detected base ref, or empty string if detection fails
 */
/**
 * Reads the GitHub push event payload from GITHUB_EVENT_PATH.
 *
 * @returns The parsed event object, or null if unavailable
 */
function readPushEvent(): { before?: string; commits?: unknown[] } | null {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(eventPath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Auto-detects the diff base ref from the GitHub Actions environment.
 *
 * For pull requests, uses `origin/$GITHUB_BASE_REF` (the PR target branch).
 * For push events, reads the `before` SHA from the push event payload,
 * which correctly handles multi-commit pushes. Falls back to `HEAD~1`.
 *
 * @returns The detected base ref
 */
function autoDetectBase(): string {
    // Pull requests: GITHUB_BASE_REF is the target branch
    const baseRef = process.env.GITHUB_BASE_REF;
    if (baseRef) {
        fnlog(`Auto-detected diff base: origin/${baseRef} (pull request)`);
        return `origin/${baseRef}`;
    }

    // Push events: use HEAD~N where N = number of commits pushed.
    // We avoid the 'before' SHA because force-pushes (e.g., amend+push)
    // make it unreachable — the old tip no longer exists on the server.
    // HEAD~N is always reachable after a small --deepen fetch.
    const event = readPushEvent();
    const commitCount = event?.commits?.length ?? 1;
    fnlog(`Auto-detected diff base: HEAD~${commitCount} (push event, ${commitCount} commit(s))`);
    return `HEAD~${commitCount}`;
}

/**
 * Parses unified diff output into a map of file paths to changed line numbers.
 *
 * Extracts file paths from `+++ b/...` lines and line ranges from
 * `@@ ... +start[,count] @@` hunk headers.
 *
 * @param diffOutput - Raw output from `git diff --unified=0`
 * @returns Map of file path to set of changed line numbers
 */
export function parseDiffOutput(
    diffOutput: string
): Map<string, Set<number>> {
    const result = new Map<string, Set<number>>();
    let currentFile: string | null = null;

    for (const line of diffOutput.split('\n')) {
        if (line.startsWith('+++ b/')) {
            currentFile = line.substring(6);
            if (!result.has(currentFile)) {
                result.set(currentFile, new Set());
            }
            continue;
        }

        if (line.startsWith('@@') && currentFile) {
            const match = line.match(/@@ [^ ]+ \+(\d+)(?:,(\d+))? @@/);
            if (match) {
                const start = parseInt(match[1], 10);
                const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
                const lines = result.get(currentFile)!;
                for (let i = 0; i < count; i++) {
                    lines.add(start + i);
                }
            }
        }
    }

    return result;
}

/**
 * Cross-references changed lines with LCOV coverage data to compute
 * new-code coverage metrics.
 *
 * A line is counted as "new and covered" if it appears in both the diff
 * and an LCOV DA record with count > 0. A line is "new and uncovered"
 * if it appears in both but has count == 0. Lines in the diff but not
 * in any DA record are non-executable and are not counted.
 *
 * File path matching handles relative (diff) vs absolute (LCOV SF:) paths
 * by checking if the LCOV path ends with the diff path.
 *
 * @param lcov - Parsed LCOV file data
 * @param changedLines - Map of file path to changed line numbers from git diff
 * @returns Coverage metrics for the new/modified code
 */
export function analyzeNewCodeCoverage(
    lcov: LcovFile,
    changedLines: Map<string, Set<number>>
): NewCodeMetrics {
    let coveredLines = 0;
    let totalLines = 0;
    let coveredFunctions = 0;
    let totalFunctions = 0;
    let coveredBranches = 0;
    let totalBranches = 0;
    const uncoveredFiles: Array<{file: string; lines: number[]}> = [];

    for (const [diffPath, diffLines] of changedLines) {
        const normalizedDiff = path.normalize(diffPath);

        // Find matching LCOV section(s)
        const matchingSections = lcov.filter((section) => {
            const normalizedSf = path.normalize(section.sourceFile);
            return (
                normalizedSf === normalizedDiff ||
                normalizedSf.endsWith(path.sep + normalizedDiff)
            );
        });

        if (matchingSections.length === 0) {
            continue;
        }

        // Collect DA, FN/FNDA, and BRDA records from matching sections
        const daMap = new Map<number, number>();
        const fnLines = new Map<string, number>(); // function name → start line
        const fndaMap = new Map<string, number>(); // function name → count
        const brdaLines: Array<{line: number; count: number}> = [];

        for (const section of matchingSections) {
            for (const da of section.lines) {
                const existing = daMap.get(da.line) ?? 0;
                daMap.set(da.line, existing + da.count);
            }
            for (const fn of section.functions) {
                fnLines.set(fn.name, fn.line);
            }
            for (const fnda of section.functionData) {
                const existing = fndaMap.get(fnda.name) ?? 0;
                fndaMap.set(fnda.name, existing + fnda.count);
            }
            for (const brda of section.branches) {
                brdaLines.push({line: brda.line, count: brda.count});
            }
        }

        // Lines
        const uncoveredLineNums: number[] = [];
        for (const lineNum of diffLines) {
            const count = daMap.get(lineNum);
            if (count === undefined) {
                continue; // Non-executable line
            }
            totalLines++;
            if (count > 0) {
                coveredLines++;
            } else {
                uncoveredLineNums.push(lineNum);
            }
        }

        // Functions: a function is "new" if its start line is in the diff
        for (const [fnName, fnLine] of fnLines) {
            if (diffLines.has(fnLine)) {
                totalFunctions++;
                const count = fndaMap.get(fnName) ?? 0;
                if (count > 0) {
                    coveredFunctions++;
                }
            }
        }

        // Branches: a branch is "new" if its line is in the diff
        for (const brda of brdaLines) {
            if (diffLines.has(brda.line)) {
                totalBranches++;
                if (brda.count > 0) {
                    coveredBranches++;
                }
            }
        }

        if (uncoveredLineNums.length > 0) {
            uncoveredLineNums.sort((a, b) => a - b);
            uncoveredFiles.push({file: diffPath, lines: uncoveredLineNums});
        }
    }

    uncoveredFiles.sort((a, b) => a.file.localeCompare(b.file));

    const percent =
        totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;

    return {
        coveredLines,
        totalLines,
        coveredFunctions,
        totalFunctions,
        coveredBranches,
        totalBranches,
        percent,
        uncoveredFiles
    };
}
