import * as path from 'node:path';

import {
    formatPercent,
    buildMetricsOutputs,
    writeLcovFile
} from './metrics-output';
import type {CoverageMetrics, LcovFile} from './lcov-parser';

jest.mock('node:fs/promises', () => ({
    writeFile: jest.fn().mockResolvedValue(undefined)
}));

import {writeFile} from 'node:fs/promises';

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe('formatPercent', () => {
    it('formats a typical percentage to one decimal', () => {
        expect(formatPercent(6, 7)).toBe('85.7');
    });

    it('returns 100.0 when all items are covered', () => {
        expect(formatPercent(10, 10)).toBe('100.0');
    });

    it('returns 0.0 when no items are covered', () => {
        expect(formatPercent(0, 5)).toBe('0.0');
    });

    it('returns 0.0 when total is zero (division by zero)', () => {
        expect(formatPercent(0, 0)).toBe('0.0');
    });

    it('rounds correctly to one decimal place', () => {
        // 1/3 = 33.333... → 33.3
        expect(formatPercent(1, 3)).toBe('33.3');
        // 2/3 = 66.666... → 66.7
        expect(formatPercent(2, 3)).toBe('66.7');
    });
});

describe('buildMetricsOutputs', () => {
    const sampleMetrics: CoverageMetrics = {
        linesCovered: 85,
        linesTotal: 100,
        functionsCovered: 12,
        functionsTotal: 15,
        branchesCovered: 30,
        branchesTotal: 40
    };

    it('sets lcovFile to the provided path', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.lcovFile).toBe('/tmp/lcov.info');
    });

    it('sets htmlReportDir to empty string by default', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.htmlReportDir).toBe('');
    });

    it('formats line coverage metrics correctly', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.linesCovered).toBe('85');
        expect(outputs.linesTotal).toBe('100');
        expect(outputs.linesPercent).toBe('85.0');
    });

    it('formats function coverage metrics correctly', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.functionsCovered).toBe('12');
        expect(outputs.functionsTotal).toBe('15');
        expect(outputs.functionsPercent).toBe('80.0');
    });

    it('formats branch coverage metrics correctly', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.branchesCovered).toBe('30');
        expect(outputs.branchesTotal).toBe('40');
        expect(outputs.branchesPercent).toBe('75.0');
    });

    it('sets new-code metrics to zero defaults when not provided', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        expect(outputs.newLinesCovered).toBe('0');
        expect(outputs.newLinesTotal).toBe('0');
        expect(outputs.newLinesPercent).toBe('0.0');
    });

    it('sets new-code metrics from NewCodeMetrics when provided', () => {
        const outputs = buildMetricsOutputs(
            sampleMetrics,
            '/tmp/lcov.info',
            {
                coveredLines: 8,
                totalLines: 10,
                coveredFunctions: 2,
                totalFunctions: 3,
                coveredBranches: 4,
                totalBranches: 6,
                percent: 80,
                uncoveredFiles: []
            }
        );
        expect(outputs.newLinesCovered).toBe('8');
        expect(outputs.newLinesTotal).toBe('10');
        expect(outputs.newLinesPercent).toBe('80.0');
        expect(outputs.newFunctionsCovered).toBe('2');
        expect(outputs.newFunctionsTotal).toBe('3');
        expect(outputs.newFunctionsPercent).toBe('66.7');
        expect(outputs.newBranchesCovered).toBe('4');
        expect(outputs.newBranchesTotal).toBe('6');
        expect(outputs.newBranchesPercent).toBe('66.7');
    });

    it('handles zero new-code totals without division by zero', () => {
        const outputs = buildMetricsOutputs(
            sampleMetrics,
            '/tmp/lcov.info',
            {
                coveredLines: 0,
                totalLines: 0,
                coveredFunctions: 0,
                totalFunctions: 0,
                coveredBranches: 0,
                totalBranches: 0,
                percent: 0,
                uncoveredFiles: []
            }
        );
        expect(outputs.newLinesPercent).toBe('0.0');
    });

    it('handles zero totals without division by zero', () => {
        const emptyMetrics: CoverageMetrics = {
            linesCovered: 0,
            linesTotal: 0,
            functionsCovered: 0,
            functionsTotal: 0,
            branchesCovered: 0,
            branchesTotal: 0
        };
        const outputs = buildMetricsOutputs(emptyMetrics, '/tmp/lcov.info');
        expect(outputs.linesPercent).toBe('0.0');
        expect(outputs.functionsPercent).toBe('0.0');
        expect(outputs.branchesPercent).toBe('0.0');
    });

    it('converts all numeric values to strings', () => {
        const outputs = buildMetricsOutputs(sampleMetrics, '/tmp/lcov.info');
        for (const [_key, value] of Object.entries(outputs)) {
            expect(typeof value).toBe('string');
        }
    });
});

describe('writeLcovFile', () => {
    const sampleLcov: LcovFile = [
        {
            testName: '',
            sourceFile: '/src/foo.cpp',
            functions: [{line: 1, name: 'main'}],
            functionData: [{count: 1, name: 'main'}],
            functionsFound: 1,
            functionsHit: 1,
            lines: [
                {line: 1, count: 1},
                {line: 2, count: 0}
            ],
            linesFound: 2,
            linesHit: 1,
            branches: [],
            branchesFound: 0,
            branchesHit: 0
        }
    ];

    beforeEach(() => {
        mockWriteFile.mockClear();
    });

    it('writes serialized LCOV to the specified directory', async () => {
        await writeLcovFile(sampleLcov, '/tmp/coverage');
        expect(mockWriteFile).toHaveBeenCalledTimes(1);
        const [filePath, content, options] = mockWriteFile.mock.calls[0];
        expect(filePath).toBe(path.resolve('/tmp/coverage', 'lcov.info'));
        expect(content).toContain('SF:/src/foo.cpp');
        expect(content).toContain('DA:1,1');
        expect(content).toContain('end_of_record');
        expect(options).toEqual({encoding: 'utf-8'});
    });

    it('returns the absolute path to the written file', async () => {
        const result = await writeLcovFile(sampleLcov, '/tmp/coverage');
        expect(result).toBe(path.resolve('/tmp/coverage', 'lcov.info'));
    });

    it('uses a custom filename when provided', async () => {
        const result = await writeLcovFile(
            sampleLcov,
            '/tmp/coverage',
            'filtered.info'
        );
        expect(result).toBe(
            path.resolve('/tmp/coverage', 'filtered.info')
        );
        expect(mockWriteFile).toHaveBeenCalledWith(
            path.resolve('/tmp/coverage', 'filtered.info'),
            expect.any(String),
            {encoding: 'utf-8'}
        );
    });

    it('uses default filename lcov.info', async () => {
        await writeLcovFile(sampleLcov, '/tmp/out');
        const [filePath] = mockWriteFile.mock.calls[0];
        expect(filePath).toBe(path.resolve('/tmp/out', 'lcov.info'));
    });
});
