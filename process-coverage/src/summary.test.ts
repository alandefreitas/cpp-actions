import type {CoverageMetrics} from './lcov-parser';
import type {NewCodeMetrics} from './new-code';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    summary: {
        addHeading: jest.fn().mockReturnThis(),
        addTable: jest.fn().mockReturnThis(),
        addRaw: jest.fn().mockReturnThis(),
        write: jest.fn().mockResolvedValue(undefined)
    }
}));

import * as core from '@actions/core';
import {writeSummary, formatLineRanges} from './summary';

const mockSummary = core.summary as unknown as {
    addHeading: jest.Mock;
    addTable: jest.Mock;
    addRaw: jest.Mock;
    write: jest.Mock;
};

describe('writeSummary', () => {
    const sampleMetrics: CoverageMetrics = {
        linesCovered: 85,
        linesTotal: 100,
        functionsCovered: 12,
        functionsTotal: 15,
        branchesCovered: 30,
        branchesTotal: 40
    };

    beforeEach(() => {
        mockSummary.addHeading.mockClear();
        mockSummary.addTable.mockClear();
        mockSummary.addRaw.mockClear();
        mockSummary.write.mockClear();
    });

    it('writes table with Coverage column when no new-code', async () => {
        await writeSummary(sampleMetrics);

        expect(mockSummary.addHeading).toHaveBeenCalledWith('Coverage', 2);
        expect(mockSummary.addTable).toHaveBeenCalledTimes(1);
        const table = mockSummary.addTable.mock.calls[0][0];
        // Header: [empty, Coverage]
        expect(table[0][1].data).toBe('Coverage');
        // Lines row
        expect(table[1][0].data).toContain('Lines');
        expect(table[1][1].data).toContain('85.0%');
        // Functions row
        expect(table[2][0].data).toContain('Functions');
        expect(table[2][1].data).toContain('80.0%');
        // Branches row
        expect(table[3][0].data).toContain('Branches');
        expect(table[3][1].data).toContain('75.0%');
    });

    it('omits Branches row when branchesTotal is 0', async () => {
        const noBranches: CoverageMetrics = {
            ...sampleMetrics,
            branchesCovered: 0,
            branchesTotal: 0
        };
        await writeSummary(noBranches);

        const table = mockSummary.addTable.mock.calls[0][0];
        // Header + Lines + Functions = 3 rows (no Branches)
        expect(table).toHaveLength(3);
    });

    it('calls summary.write()', async () => {
        await writeSummary(sampleMetrics);
        expect(mockSummary.write).toHaveBeenCalledTimes(1);
    });

    it('adds Overall and New Code columns when new-code available', async () => {
        const newCode: NewCodeMetrics = {
            coveredLines: 8,
            totalLines: 10,
            percent: 80,
            coveredFunctions: 0,
            totalFunctions: 0,
            coveredBranches: 0,
            totalBranches: 0,
            uncoveredFiles: []
        };
        await writeSummary(sampleMetrics, newCode);

        expect(mockSummary.addTable).toHaveBeenCalledTimes(1);
        const table = mockSummary.addTable.mock.calls[0][0];
        // Header: [empty, Overall, New Code]
        expect(table[0][1].data).toBe('Overall');
        expect(table[0][2].data).toBe('New Code');
        // Lines row has both columns
        expect(table[1][1].data).toContain('85.0%');
        expect(table[1][2].data).toContain('80.0%');
        expect(table[1][2].data).toContain('8/10');
        // Functions: Overall has data, New Code shows No changes (0 new functions)
        expect(table[2][1].data).toContain('80.0%');
        expect(table[2][2].data).toBe('No changes');
    });

    it('shows two-column layout with No changes when totalLines is 0', async () => {
        const emptyNewCode: NewCodeMetrics = {
            coveredLines: 0,
            totalLines: 0,
            percent: 0,
            coveredFunctions: 0,
            totalFunctions: 0,
            coveredBranches: 0,
            totalBranches: 0,
            uncoveredFiles: []
        };
        await writeSummary(sampleMetrics, emptyNewCode);

        const table = mockSummary.addTable.mock.calls[0][0];
        // Should still show Overall + New Code columns
        expect(table[0][1].data).toBe('Overall');
        expect(table[0][2].data).toBe('New Code');
        // New Code column shows "No changes"
        expect(table[1][2].data).toBe('No changes');
    });

    it('uses single Coverage column when newCodeMetrics is undefined', async () => {
        await writeSummary(sampleMetrics, undefined);

        const table = mockSummary.addTable.mock.calls[0][0];
        expect(table[0][1].data).toBe('Coverage');
        // No third column
        expect(table[0]).toHaveLength(2);
    });

    it('lists uncovered files below the table', async () => {
        const newCode: NewCodeMetrics = {
            coveredLines: 5,
            totalLines: 10,
            percent: 50,
            coveredFunctions: 0,
            totalFunctions: 0,
            coveredBranches: 0,
            totalBranches: 0,
            uncoveredFiles: [
                {file: 'src/foo.cpp', lines: [10, 11, 12, 20]},
                {file: 'src/bar.cpp', lines: [5]}
            ]
        };
        await writeSummary(sampleMetrics, newCode);

        expect(mockSummary.addRaw).toHaveBeenCalledTimes(1);
        const rawContent = mockSummary.addRaw.mock.calls[0][0] as string;
        expect(rawContent).toContain('Uncovered new lines');
        expect(rawContent).toContain('`src/foo.cpp`');
        expect(rawContent).toContain('10-12, 20');
    });

    it('limits uncovered files to 20 entries', async () => {
        const files = Array.from({length: 25}, (_, i) => ({
            file: `src/file${i}.cpp`,
            lines: [1]
        }));
        const newCode: NewCodeMetrics = {
            coveredLines: 0,
            totalLines: 25,
            coveredFunctions: 0,
            totalFunctions: 0,
            coveredBranches: 0,
            totalBranches: 0,
            percent: 0,
            uncoveredFiles: files
        };
        await writeSummary(sampleMetrics, newCode);

        const rawContent = mockSummary.addRaw.mock.calls[0][0] as string;
        expect(rawContent).toContain('`src/file19.cpp`');
        expect(rawContent).not.toContain('`src/file20.cpp`');
    });

    it('handles zero coverage metrics without errors', async () => {
        const zeroMetrics: CoverageMetrics = {
            linesCovered: 0,
            linesTotal: 0,
            functionsCovered: 0,
            functionsTotal: 0,
            branchesCovered: 0,
            branchesTotal: 0
        };
        await writeSummary(zeroMetrics);

        const table = mockSummary.addTable.mock.calls[0][0];
        // Overall row lines cell should show 0.0%
        expect(table[1][1].data).toContain('0.0%');
    });

    it('shows New Code column in per-file breakdown when changedLines provided', async () => {
        const lcovData = [
            {
                testName: '',
                sourceFile: '/work/src/changed.cpp',
                functions: [], functionData: [],
                functionsFound: 0, functionsHit: 0,
                lines: [
                    {line: 1, count: 5},
                    {line: 2, count: 0},
                    {line: 3, count: 3}
                ],
                linesFound: 3, linesHit: 2,
                branches: [], branchesFound: 0, branchesHit: 0
            }
        ];
        const changedLines = new Map([
            ['src/changed.cpp', new Set([2, 3])]
        ]);
        const newCode: NewCodeMetrics = {
            coveredLines: 1, totalLines: 2, percent: 50,
            coveredFunctions: 0, totalFunctions: 0,
            coveredBranches: 0, totalBranches: 0,
            uncoveredFiles: [{file: 'src/changed.cpp', lines: [2]}]
        };

        await writeSummary(sampleMetrics, newCode, { lcovData, changedLines });

        const rawCalls = mockSummary.addRaw.mock.calls.map(
            (c: unknown[]) => c[0]
        ) as string[];
        const allRaw = rawCalls.join('');
        expect(allRaw).toContain('New Code');
        expect(allRaw).toContain('changed.cpp');
        expect(allRaw).toContain('50.0%'); // new code coverage for this file
    });

    it('sorts per-file by new-code coverage first, then overall', async () => {
        const makeLcovSection = (file: string, lines: Array<{line: number; count: number}>) => ({
            testName: '', sourceFile: file,
            functions: [], functionData: [],
            functionsFound: 0, functionsHit: 0,
            lines, linesFound: lines.length,
            linesHit: lines.filter(l => l.count > 0).length,
            branches: [], branchesFound: 0, branchesHit: 0
        });
        const lcovData = [
            // 100% overall, 50% new code
            makeLcovSection('/work/src/a.cpp', [
                {line: 1, count: 5}, {line: 2, count: 5},
                {line: 3, count: 5}, {line: 4, count: 0}
            ]),
            // 50% overall, no new code
            makeLcovSection('/work/src/b.cpp', [
                {line: 1, count: 5}, {line: 2, count: 0}
            ]),
            // 100% overall, 0% new code (worst new-code → should be first)
            makeLcovSection('/work/src/c.cpp', [
                {line: 1, count: 5}, {line: 2, count: 5},
                {line: 10, count: 0}
            ]),
        ];
        const changedLines = new Map([
            ['src/a.cpp', new Set([3, 4])],  // line 3 covered, line 4 not → 50%
            ['src/c.cpp', new Set([10])],      // line 10 not covered → 0%
        ]);
        const newCode: NewCodeMetrics = {
            coveredLines: 1, totalLines: 3, percent: 33.3,
            coveredFunctions: 0, totalFunctions: 0,
            coveredBranches: 0, totalBranches: 0,
            uncoveredFiles: []
        };

        await writeSummary(sampleMetrics, newCode, { lcovData, changedLines });

        const rawCalls = mockSummary.addRaw.mock.calls.map(
            (c: unknown[]) => c[0]
        ) as string[];
        const allRaw = rawCalls.join('');
        // c.cpp (0% new) should come before a.cpp (50% new), both before b.cpp (no new code)
        const posC = allRaw.indexOf('c.cpp');
        const posA = allRaw.indexOf('a.cpp');
        const posB = allRaw.indexOf('b.cpp');
        expect(posC).toBeLessThan(posA);
        expect(posA).toBeLessThan(posB);
    });

    it('adds Codecov sunburst and badges when codecov option is true', async () => {
        const origRepo = process.env.GITHUB_REPOSITORY;
        const origSha = process.env.GITHUB_SHA;
        const origRef = process.env.GITHUB_REF_NAME;
        process.env.GITHUB_REPOSITORY = 'owner/repo';
        process.env.GITHUB_SHA = 'abc123';
        process.env.GITHUB_REF_NAME = 'main';

        try {
            await writeSummary(sampleMetrics, undefined, { codecov: true });

            const rawCalls = mockSummary.addRaw.mock.calls.map(
                (c: unknown[]) => c[0]
            ) as string[];
            const allRaw = rawCalls.join('');
            expect(allRaw).toContain('codecov.io/github/owner/repo/commit/abc123');
            expect(allRaw).toContain('sunburst.svg');
            expect(allRaw).toContain('badge.svg');
            expect(allRaw).toContain('branch/main');
            expect(allRaw).toContain('app.codecov.io');
            expect(allRaw).toContain('View full report on Codecov');
            expect(mockSummary.addHeading).toHaveBeenCalledWith('Codecov', 3);
        } finally {
            if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo;
            else delete process.env.GITHUB_REPOSITORY;
            if (origSha !== undefined) process.env.GITHUB_SHA = origSha;
            else delete process.env.GITHUB_SHA;
            if (origRef !== undefined) process.env.GITHUB_REF_NAME = origRef;
            else delete process.env.GITHUB_REF_NAME;
        }
    });

    it('does not add Codecov badges when codecov option is false', async () => {
        await writeSummary(sampleMetrics, undefined, { codecov: false });

        const rawCalls = mockSummary.addRaw.mock.calls;
        if (rawCalls.length > 0) {
            const allRaw = rawCalls.map((c: unknown[]) => c[0]).join('');
            expect(allRaw).not.toContain('codecov.io');
        }
    });
    it('includes per-file breakdown when lcovData is provided', async () => {
        const lcovData = [
            {
                testName: '',
                sourceFile: '/home/runner/work/proj/proj/src/good.cpp',
                functions: [],
                functionData: [],
                functionsFound: 0,
                functionsHit: 0,
                lines: [{line: 1, count: 5}, {line: 2, count: 3}],
                linesFound: 2,
                linesHit: 2,
                branches: [],
                branchesFound: 0,
                branchesHit: 0
            },
            {
                testName: '',
                sourceFile: '/home/runner/work/proj/proj/src/bad.cpp',
                functions: [],
                functionData: [],
                functionsFound: 0,
                functionsHit: 0,
                lines: [{line: 1, count: 0}, {line: 2, count: 0}, {line: 3, count: 1}],
                linesFound: 3,
                linesHit: 1,
                branches: [],
                branchesFound: 0,
                branchesHit: 0
            }
        ];

        await writeSummary(sampleMetrics, undefined, { lcovData });

        const rawCalls = mockSummary.addRaw.mock.calls.map(
            (c: unknown[]) => c[0]
        ) as string[];
        const allRaw = rawCalls.join('');
        expect(allRaw).toContain('Coverage by file');
        expect(allRaw).toContain('<details>');
        // bad.cpp has worse coverage so should appear first
        expect(allRaw.indexOf('bad.cpp')).toBeLessThan(allRaw.indexOf('good.cpp'));
    });

    it('includes app.codecov.io link in Codecov section', async () => {
        const origRepo = process.env.GITHUB_REPOSITORY;
        const origSha = process.env.GITHUB_SHA;
        process.env.GITHUB_REPOSITORY = 'owner/repo';
        process.env.GITHUB_SHA = 'abc123';

        try {
            await writeSummary(sampleMetrics, undefined, { codecov: true });

            const rawCalls = mockSummary.addRaw.mock.calls.map(
                (c: unknown[]) => c[0]
            ) as string[];
            const allRaw = rawCalls.join('');
            expect(allRaw).toContain('app.codecov.io/github/owner/repo/commit/abc123');
            expect(allRaw).toContain('View full report on Codecov');
        } finally {
            if (origRepo !== undefined) process.env.GITHUB_REPOSITORY = origRepo;
            else delete process.env.GITHUB_REPOSITORY;
            if (origSha !== undefined) process.env.GITHUB_SHA = origSha;
            else delete process.env.GITHUB_SHA;
        }
    });
});

describe('formatLineRanges', () => {
    it('returns empty string for empty array', () => {
        expect(formatLineRanges([])).toBe('');
    });

    it('formats a single line', () => {
        expect(formatLineRanges([5])).toBe('5');
    });

    it('formats consecutive lines as a range', () => {
        expect(formatLineRanges([1, 2, 3])).toBe('1-3');
    });

    it('formats non-consecutive lines separately', () => {
        expect(formatLineRanges([1, 5, 9])).toBe('1, 5, 9');
    });

    it('formats mixed ranges and singles', () => {
        expect(formatLineRanges([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
    });

    it('handles two consecutive lines', () => {
        expect(formatLineRanges([10, 11])).toBe('10-11');
    });
});
