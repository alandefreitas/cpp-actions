/**
 * LCOV filtering utilities.
 *
 * Filters LCOV sections by source file path patterns using glob-style
 * matching, and strips exclusion markers (LCOV_EXCL / GCOV_EXCL) from
 * coverage data by reading the referenced source files.
 *
 * @module lcov-filter
 */

import {readFile} from 'node:fs/promises';

import * as core from '@actions/core';
import picomatch from 'picomatch';

import type {LcovFile, LcovSection} from './lcov-parser';

/**
 * Filters LCOV sections by source file path patterns.
 *
 * Include patterns are applied first: only sections whose `SF:` path matches
 * at least one include pattern are kept. Exclude patterns are then applied:
 * sections matching any exclude pattern are removed.
 *
 * Relative patterns (e.g., `src/**`, `tests/*.cpp`) are automatically
 * prefixed with `** /` so they match against the absolute `SF:` paths in
 * LCOV data without requiring the user to know the workspace prefix.
 *
 * An empty include list means "include all". An empty exclude list means
 * "exclude nothing".
 *
 * @param file - Parsed LCOV file sections
 * @param includes - Glob patterns to include (empty = include all)
 * @param excludes - Glob patterns to exclude (empty = exclude nothing)
 * @returns Filtered LCOV file with only matching sections
 */
export function filterByPaths(
    file: LcovFile,
    includes: string[],
    excludes: string[]
): LcovFile {
    let result = file;

    if (includes.length > 0) {
        const isIncluded = picomatch(includes);
        result = result.filter(section => isIncluded(section.sourceFile));
    }

    if (excludes.length > 0) {
        const isExcluded = picomatch(excludes);
        result = result.filter(section => !isExcluded(section.sourceFile));
    }

    return result;
}

/** Regex matching LCOV_EXCL_LINE or GCOV_EXCL_LINE markers in source. */
const EXCL_LINE_RE = /\b(?:LCOV|GCOV)_EXCL_LINE\b/;

/** Regex matching LCOV_EXCL_START or GCOV_EXCL_START markers in source. */
const EXCL_START_RE = /\b(?:LCOV|GCOV)_EXCL_START\b/;

/** Regex matching LCOV_EXCL_STOP or GCOV_EXCL_STOP markers in source. */
const EXCL_STOP_RE = /\b(?:LCOV|GCOV)_EXCL_STOP\b/;

/**
 * Builds a set of 1-based line numbers that are excluded by
 * LCOV_EXCL / GCOV_EXCL markers in the given source text.
 *
 * @param source - Source file content
 * @returns Set of excluded line numbers (1-based)
 */
function findExcludedLines(source: string): Set<number> {
    const excluded = new Set<number>();
    const lines = source.split('\n');
    let inExclRegion = false;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];

        if (EXCL_START_RE.test(line)) {
            inExclRegion = true;
            excluded.add(lineNum);
            continue;
        }

        if (EXCL_STOP_RE.test(line)) {
            inExclRegion = false;
            continue;
        }

        if (inExclRegion || EXCL_LINE_RE.test(line)) {
            excluded.add(lineNum);
        }
    }

    return excluded;
}

/**
 * Strips coverage data for lines marked with exclusion markers in source files.
 *
 * Reads each source file referenced by `SF:` records, scans for
 * `LCOV_EXCL_LINE`, `LCOV_EXCL_START`/`LCOV_EXCL_STOP`,
 * `GCOV_EXCL_LINE`, and `GCOV_EXCL_START`/`GCOV_EXCL_STOP` markers,
 * then removes `DA:` and `BRDA:` records on excluded lines and
 * recalculates summary counts.
 *
 * Source files that cannot be read are skipped with a warning.
 *
 * @param file - Parsed LCOV file sections
 * @returns Filtered LCOV file with excluded lines removed
 */
export async function stripExclMarkers(file: LcovFile): Promise<LcovFile> {
    const result: LcovFile = [];

    for (const section of file) {
        let source: string;
        try {
            source = await readFile(section.sourceFile, {encoding: 'utf-8'});
        } catch {
            core.warning(
                `Cannot read source file ${section.sourceFile} — skipping exclusion marker stripping`
            );
            result.push(section);
            continue;
        }

        const excluded = findExcludedLines(source);
        if (excluded.size === 0) {
            result.push(section);
            continue;
        }

        const filteredLines = section.lines.filter(
            da => !excluded.has(da.line)
        );
        const filteredBranches = section.branches.filter(
            brda => !excluded.has(brda.line)
        );
        const filteredFunctions = section.functions.filter(
            fn => !excluded.has(fn.line)
        );
        const filteredFnNames = new Set(filteredFunctions.map(fn => fn.name));
        const filteredFunctionData = section.functionData.filter(
            fnda => filteredFnNames.has(fnda.name)
        );

        const linesFound = filteredLines.length;
        const linesHit = filteredLines.filter(da => da.count > 0).length;
        const branchesFound = filteredBranches.length;
        const branchesHit = filteredBranches.filter(
            brda => brda.count > 0
        ).length;
        const functionsFound = filteredFunctions.length;
        const functionsHit = filteredFunctionData.filter(
            fnda => fnda.count > 0
        ).length;

        const filtered: LcovSection = {
            ...section,
            functions: filteredFunctions,
            functionData: filteredFunctionData,
            functionsFound,
            functionsHit,
            lines: filteredLines,
            linesFound,
            linesHit,
            branches: filteredBranches,
            branchesFound,
            branchesHit
        };

        result.push(filtered);
    }

    return result;
}
