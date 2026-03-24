/**
 * End-to-end integration tests for the process-coverage pipeline.
 *
 * Tests the LCOV parsing, filtering, marker stripping, metric extraction,
 * new-code analysis, and summary generation using sample fixture data.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import * as core from '@actions/core';

import { parseLcov, extractMetrics, serializeLcov } from './lcov-parser';
import { filterByPaths, stripExclMarkers } from './lcov-filter';
import { buildMetricsOutputs, writeLcovFile } from './metrics-output';
import { analyzeNewCodeCoverage } from './new-code';
import { writeSummary } from './summary';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    summary: {
        addHeading: jest.fn().mockReturnThis(),
        addTable: jest.fn().mockReturnThis(),
        addRaw: jest.fn().mockReturnThis(),
        write: jest.fn().mockResolvedValue(undefined)
    }
}));

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

describe('Integration: GCC pipeline (parse → filter → strip → metrics)', () => {
    const sampleLcov = fs.readFileSync(
        path.join(FIXTURES_DIR, 'sample.info'),
        'utf-8'
    );

    it('parses sample LCOV fixture into structured data', () => {
        const lcov = parseLcov(sampleLcov);

        expect(lcov).toHaveLength(3);
        expect(lcov[0].sourceFile).toBe('/project/src/main.cpp');
        expect(lcov[1].sourceFile).toBe('/project/src/utils.cpp');
        expect(lcov[2].sourceFile).toBe('/project/tests/test_main.cpp');
    });

    it('extracts correct metrics from sample data', () => {
        const lcov = parseLcov(sampleLcov);
        const metrics = extractMetrics(lcov);

        // main.cpp: 3/8 lines, utils.cpp: 6/6 lines, test_main.cpp: 3/3 lines
        expect(metrics.linesCovered).toBe(12);
        expect(metrics.linesTotal).toBe(17);
        // main.cpp: 1/2 funcs, utils.cpp: 2/2 funcs, test_main.cpp: 1/1 funcs
        expect(metrics.functionsCovered).toBe(4);
        expect(metrics.functionsTotal).toBe(5);
        // main.cpp: 1/4 branches, others: 0 branches
        expect(metrics.branchesCovered).toBe(1);
        expect(metrics.branchesTotal).toBe(4);
    });

    it('filters by include patterns', () => {
        const lcov = parseLcov(sampleLcov);
        const filtered = filterByPaths(lcov, ['**/src/**'], []);

        expect(filtered).toHaveLength(2);
        expect(filtered[0].sourceFile).toBe('/project/src/main.cpp');
        expect(filtered[1].sourceFile).toBe('/project/src/utils.cpp');
    });

    it('filters by exclude patterns', () => {
        const lcov = parseLcov(sampleLcov);
        const filtered = filterByPaths(lcov, [], ['**/tests/**']);

        expect(filtered).toHaveLength(2);
        expect(filtered[0].sourceFile).toBe('/project/src/main.cpp');
        expect(filtered[1].sourceFile).toBe('/project/src/utils.cpp');
    });

    it('applies include then exclude', () => {
        const lcov = parseLcov(sampleLcov);
        const filtered = filterByPaths(lcov, ['**/*.cpp'], ['**/utils.*']);

        expect(filtered).toHaveLength(2);
        expect(filtered[0].sourceFile).toBe('/project/src/main.cpp');
        expect(filtered[1].sourceFile).toBe('/project/tests/test_main.cpp');
    });

    it('roundtrips through serialize and parse', () => {
        const lcov = parseLcov(sampleLcov);
        const serialized = serializeLcov(lcov);
        const reparsed = parseLcov(serialized);

        expect(reparsed).toHaveLength(lcov.length);
        for (let i = 0; i < lcov.length; i++) {
            expect(reparsed[i].sourceFile).toBe(lcov[i].sourceFile);
            expect(reparsed[i].lines).toEqual(lcov[i].lines);
            expect(reparsed[i].functionData).toEqual(lcov[i].functionData);
        }
    });

    it('extracts metrics after filtering to src only', () => {
        const lcov = parseLcov(sampleLcov);
        const filtered = filterByPaths(lcov, ['**/src/**'], []);
        const metrics = extractMetrics(filtered);

        // main.cpp: 3/8 lines + utils.cpp: 6/6 lines = 9/14
        expect(metrics.linesCovered).toBe(9);
        expect(metrics.linesTotal).toBe(14);
        expect(metrics.functionsCovered).toBe(3);
        expect(metrics.functionsTotal).toBe(4);
    });
});

describe('Integration: Clang pipeline (parse → filter → strip → metrics)', () => {
    it('strips LCOV_EXCL markers from source-referenced LCOV data', async () => {
        const fixtureSourcePath = path.join(FIXTURES_DIR, 'sample_main.cpp');
        const rawLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample_with_markers.info'),
            'utf-8'
        );

        // Replace placeholder with actual fixture path
        const lcovContent = rawLcov.replace(
            'FIXTURE_PATH_PLACEHOLDER',
            fixtureSourcePath
        );

        const lcov = parseLcov(lcovContent);
        expect(lcov).toHaveLength(1);

        const stripped = await stripExclMarkers(lcov);
        expect(stripped).toHaveLength(1);

        const section = stripped[0];

        // Lines 13, 14 are in LCOV_EXCL_START/STOP region
        // Line 17 is LCOV_EXCL_LINE
        // Line 21 is GCOV_EXCL_LINE
        // So DA records for lines 13, 14, 17, 21 should be removed
        const remainingLines = section.lines.map((d) => d.line);
        expect(remainingLines).not.toContain(13);
        expect(remainingLines).not.toContain(14);
        expect(remainingLines).not.toContain(17);
        expect(remainingLines).not.toContain(21);

        // Lines 4, 5, 6, 8, 9, 20 should remain
        expect(remainingLines).toContain(4);
        expect(remainingLines).toContain(5);
        expect(remainingLines).toContain(8);
        expect(remainingLines).toContain(9);
        expect(remainingLines).toContain(20);

        // Verify metrics after stripping
        const metrics = extractMetrics(stripped);
        // Remaining DA: 4(5), 5(5), 6(5), 8(5), 9(5), 20(0) = 5 covered / 6 total
        expect(metrics.linesCovered).toBe(5);
        expect(metrics.linesTotal).toBe(6);
    });

    it('recalculates summary counts after stripping', async () => {
        const fixtureSourcePath = path.join(FIXTURES_DIR, 'sample_main.cpp');
        const rawLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample_with_markers.info'),
            'utf-8'
        );
        const lcovContent = rawLcov.replace(
            'FIXTURE_PATH_PLACEHOLDER',
            fixtureSourcePath
        );

        const lcov = parseLcov(lcovContent);
        const stripped = await stripExclMarkers(lcov);
        const section = stripped[0];

        // LF/LH should be recalculated after removal
        expect(section.linesFound).toBe(6); // 10 original - 4 removed
        expect(section.linesHit).toBe(5); // 6 original covered, minus line 17(5 count) removed = 5
    });
});

describe('Integration: new-code analysis', () => {
    it('cross-references diff lines with LCOV data', () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);

        // Simulate git diff output: main.cpp lines 10-14 were changed
        const changedLines = new Map<string, Set<number>>([
            ['src/main.cpp', new Set([10, 11, 12, 13, 14])]
        ]);

        const result = analyzeNewCodeCoverage(lcov, changedLines);

        // Lines 10(5), 11(5), 12(5) are covered; 13(0), 14(0) are uncovered
        // All 5 lines are in LCOV DA records, so all are "executable"
        expect(result.totalLines).toBe(5);
        expect(result.coveredLines).toBe(3);
        expect(result.percent).toBeCloseTo(60.0, 1);
        expect(result.uncoveredFiles).toHaveLength(1);
        expect(result.uncoveredFiles[0].lines).toEqual([13, 14]);
    });

    it('handles non-executable changed lines', () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);

        // Lines 100-105 don't exist in LCOV DA → non-executable
        const changedLines = new Map<string, Set<number>>([
            ['src/main.cpp', new Set([100, 101, 102])]
        ]);

        const result = analyzeNewCodeCoverage(lcov, changedLines);

        expect(result.totalLines).toBe(0);
        expect(result.coveredLines).toBe(0);
    });

    it('handles files not in LCOV data', () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);

        const changedLines = new Map<string, Set<number>>([
            ['src/nonexistent.cpp', new Set([1, 2, 3])]
        ]);

        const result = analyzeNewCodeCoverage(lcov, changedLines);

        expect(result.totalLines).toBe(0);
        expect(result.coveredLines).toBe(0);
    });

    it('produces correct metrics outputs with new-code data', () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);
        const metrics = extractMetrics(lcov);

        const changedLines = new Map<string, Set<number>>([
            ['src/main.cpp', new Set([10, 11, 12, 13, 14])]
        ]);
        const newCodeMetrics = analyzeNewCodeCoverage(lcov, changedLines);

        const outputs = buildMetricsOutputs(
            metrics,
            '/tmp/lcov.info',
            newCodeMetrics
        );

        expect(outputs.newLinesCovered).toBe('3');
        expect(outputs.newLinesTotal).toBe('5');
        expect(outputs.newLinesPercent).toBe('60.0');
        expect(outputs.linesCovered).toBe('12');
        expect(outputs.linesTotal).toBe('17');
    });
});

describe('Integration: step summary', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('generates markdown summary for coverage metrics', async () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);
        const metrics = extractMetrics(lcov);

        await writeSummary(metrics);

        expect(core.summary.addHeading).toHaveBeenCalledWith(
            'Coverage',
            2
        );
        expect(core.summary.addTable).toHaveBeenCalledTimes(1);
        expect(core.summary.write).toHaveBeenCalledTimes(1);

        // Verify the table has correct structure
        const tableCall = (core.summary.addTable as jest.Mock).mock.calls[0][0];
        // Header row + Lines + Functions + Branches (branches > 0)
        expect(tableCall.length).toBe(4);
    });

    it('includes new-code section with uncovered files', async () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);
        const metrics = extractMetrics(lcov);

        const changedLines = new Map<string, Set<number>>([
            ['src/main.cpp', new Set([10, 11, 12, 13, 14])]
        ]);
        const newCodeMetrics = analyzeNewCodeCoverage(lcov, changedLines);

        await writeSummary(metrics, newCodeMetrics);

        // Main table + new-code section
        expect(core.summary.addTable).toHaveBeenCalled();
        expect(core.summary.addRaw).toHaveBeenCalled();
        expect(core.summary.write).toHaveBeenCalledTimes(1);
    });
});

describe('Integration: writeLcovFile', () => {
    it('writes filtered LCOV to disk and returns absolute path', async () => {
        const sampleLcov = fs.readFileSync(
            path.join(FIXTURES_DIR, 'sample.info'),
            'utf-8'
        );
        const lcov = parseLcov(sampleLcov);
        const filtered = filterByPaths(lcov, ['**/src/**'], []);

        const tmpDir = fs.mkdtempSync(
            path.join(require('os').tmpdir(), 'pcov-test-')
        );

        try {
            const outputPath = await writeLcovFile(filtered, tmpDir);

            expect(path.isAbsolute(outputPath)).toBe(true);
            expect(fs.existsSync(outputPath)).toBe(true);

            // Re-read and verify contents
            const written = fs.readFileSync(outputPath, 'utf-8');
            const reparsed = parseLcov(written);
            expect(reparsed).toHaveLength(2);
            expect(reparsed[0].sourceFile).toBe('/project/src/main.cpp');
            expect(reparsed[1].sourceFile).toBe('/project/src/utils.cpp');
        } finally {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });
});
