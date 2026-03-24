import {
    parseLcov,
    serializeLcov,
    extractMetrics,
    type LcovFile
} from './lcov-parser';

/** Sample LCOV content with one source file section. */
const singleSectionLcov = [
    'TN:test_suite',
    'SF:/src/foo.cpp',
    'FN:10,_Z3foov',
    'FN:20,_Z3barv',
    'FNDA:5,_Z3foov',
    'FNDA:0,_Z3barv',
    'FNF:2',
    'FNH:1',
    'DA:10,5',
    'DA:11,5',
    'DA:12,0',
    'DA:20,0',
    'LF:4',
    'LH:2',
    'BRDA:10,0,0,5',
    'BRDA:10,0,1,0',
    'BRDA:11,1,0,-',
    'BRF:3',
    'BRH:1',
    'end_of_record'
].join('\n');

/** Sample LCOV content with two source file sections. */
const multiSectionLcov = [
    'TN:',
    'SF:/src/a.cpp',
    'FN:1,main',
    'FNDA:1,main',
    'FNF:1',
    'FNH:1',
    'DA:1,1',
    'DA:2,1',
    'LF:2',
    'LH:2',
    'BRF:0',
    'BRH:0',
    'end_of_record',
    'TN:',
    'SF:/src/b.cpp',
    'FN:5,helper',
    'FNDA:0,helper',
    'FNF:1',
    'FNH:0',
    'DA:5,0',
    'DA:6,0',
    'DA:7,0',
    'LF:3',
    'LH:0',
    'BRF:0',
    'BRH:0',
    'end_of_record'
].join('\n');

describe('parseLcov', () => {
    it('parses a single section with all record types', () => {
        const result = parseLcov(singleSectionLcov);

        expect(result).toHaveLength(1);
        const section = result[0];
        expect(section.testName).toBe('test_suite');
        expect(section.sourceFile).toBe('/src/foo.cpp');

        expect(section.functions).toEqual([
            { line: 10, name: '_Z3foov' },
            { line: 20, name: '_Z3barv' }
        ]);
        expect(section.functionData).toEqual([
            { count: 5, name: '_Z3foov' },
            { count: 0, name: '_Z3barv' }
        ]);
        expect(section.functionsFound).toBe(2);
        expect(section.functionsHit).toBe(1);

        expect(section.lines).toEqual([
            { line: 10, count: 5 },
            { line: 11, count: 5 },
            { line: 12, count: 0 },
            { line: 20, count: 0 }
        ]);
        expect(section.linesFound).toBe(4);
        expect(section.linesHit).toBe(2);

        expect(section.branches).toEqual([
            { line: 10, block: 0, branch: 0, count: 5 },
            { line: 10, block: 0, branch: 1, count: 0 },
            { line: 11, block: 1, branch: 0, count: -1 }
        ]);
        expect(section.branchesFound).toBe(3);
        expect(section.branchesHit).toBe(1);
    });

    it('parses multiple sections', () => {
        const result = parseLcov(multiSectionLcov);

        expect(result).toHaveLength(2);
        expect(result[0].sourceFile).toBe('/src/a.cpp');
        expect(result[1].sourceFile).toBe('/src/b.cpp');
    });

    it('handles empty input', () => {
        expect(parseLcov('')).toEqual([]);
    });

    it('handles input with only whitespace and blank lines', () => {
        expect(parseLcov('  \n\n  \n')).toEqual([]);
    });

    it('handles BRDA with dash count as -1', () => {
        const result = parseLcov(singleSectionLcov);
        const dashBranch = result[0].branches.find(b => b.branch === 0 && b.block === 1);
        expect(dashBranch?.count).toBe(-1);
    });

    it('handles SF without preceding TN', () => {
        const lcov = 'SF:/src/no-tn.cpp\nDA:1,1\nLF:1\nLH:1\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n';
        const result = parseLcov(lcov);
        expect(result).toHaveLength(1);
        expect(result[0].testName).toBe('');
        expect(result[0].sourceFile).toBe('/src/no-tn.cpp');
    });
});

describe('serializeLcov', () => {
    it('serializes a single section to valid LCOV format', () => {
        const file: LcovFile = [{
            testName: 'my_test',
            sourceFile: '/src/main.cpp',
            functions: [{ line: 1, name: 'main' }],
            functionData: [{ count: 1, name: 'main' }],
            functionsFound: 1,
            functionsHit: 1,
            lines: [{ line: 1, count: 1 }, { line: 2, count: 0 }],
            linesFound: 2,
            linesHit: 1,
            branches: [{ line: 1, block: 0, branch: 0, count: 1 }],
            branchesFound: 1,
            branchesHit: 1
        }];

        const output = serializeLcov(file);

        expect(output).toContain('TN:my_test');
        expect(output).toContain('SF:/src/main.cpp');
        expect(output).toContain('FN:1,main');
        expect(output).toContain('FNDA:1,main');
        expect(output).toContain('FNF:1');
        expect(output).toContain('FNH:1');
        expect(output).toContain('DA:1,1');
        expect(output).toContain('DA:2,0');
        expect(output).toContain('LF:2');
        expect(output).toContain('LH:1');
        expect(output).toContain('BRDA:1,0,0,1');
        expect(output).toContain('BRF:1');
        expect(output).toContain('BRH:1');
        expect(output).toContain('end_of_record');
    });

    it('serializes BRDA count -1 as dash', () => {
        const file: LcovFile = [{
            testName: '',
            sourceFile: '/src/x.cpp',
            functions: [],
            functionData: [],
            functionsFound: 0,
            functionsHit: 0,
            lines: [],
            linesFound: 0,
            linesHit: 0,
            branches: [{ line: 5, block: 0, branch: 0, count: -1 }],
            branchesFound: 1,
            branchesHit: 0
        }];

        const output = serializeLcov(file);
        expect(output).toContain('BRDA:5,0,0,-');
    });

    it('serializes empty file to a single newline', () => {
        const output = serializeLcov([]);
        expect(output).toBe('\n');
    });
});

describe('parseLcov + serializeLcov roundtrip', () => {
    it('produces equivalent output for single section', () => {
        const parsed = parseLcov(singleSectionLcov);
        const serialized = serializeLcov(parsed);
        const reparsed = parseLcov(serialized);

        expect(reparsed).toEqual(parsed);
    });

    it('produces equivalent output for multi section', () => {
        const parsed = parseLcov(multiSectionLcov);
        const serialized = serializeLcov(parsed);
        const reparsed = parseLcov(serialized);

        expect(reparsed).toEqual(parsed);
    });
});

describe('extractMetrics', () => {
    it('extracts correct metrics from single section', () => {
        const parsed = parseLcov(singleSectionLcov);
        const metrics = extractMetrics(parsed);

        expect(metrics.linesCovered).toBe(2);
        expect(metrics.linesTotal).toBe(4);
        expect(metrics.functionsCovered).toBe(1);
        expect(metrics.functionsTotal).toBe(2);
        expect(metrics.branchesCovered).toBe(1);
        expect(metrics.branchesTotal).toBe(3);
    });

    it('aggregates metrics across multiple sections', () => {
        const parsed = parseLcov(multiSectionLcov);
        const metrics = extractMetrics(parsed);

        // a.cpp: 2 lines hit, b.cpp: 0 lines hit
        expect(metrics.linesCovered).toBe(2);
        expect(metrics.linesTotal).toBe(5);
        // a.cpp: 1 fn hit, b.cpp: 0 fn hit
        expect(metrics.functionsCovered).toBe(1);
        expect(metrics.functionsTotal).toBe(2);
        // No branches in either section
        expect(metrics.branchesCovered).toBe(0);
        expect(metrics.branchesTotal).toBe(0);
    });

    it('returns zeros for empty file', () => {
        const metrics = extractMetrics([]);

        expect(metrics.linesCovered).toBe(0);
        expect(metrics.linesTotal).toBe(0);
        expect(metrics.functionsCovered).toBe(0);
        expect(metrics.functionsTotal).toBe(0);
        expect(metrics.branchesCovered).toBe(0);
        expect(metrics.branchesTotal).toBe(0);
    });

    it('counts from actual records, not summary fields', () => {
        const file: LcovFile = [{
            testName: '',
            sourceFile: '/src/x.cpp',
            functions: [],
            functionData: [{ count: 1, name: 'fn1' }],
            functionsFound: 99, // deliberately wrong summary
            functionsHit: 99,
            lines: [{ line: 1, count: 1 }, { line: 2, count: 0 }],
            linesFound: 99,
            linesHit: 99,
            branches: [],
            branchesFound: 99,
            branchesHit: 99
        }];

        const metrics = extractMetrics(file);

        // Should count from records, not from summary fields
        expect(metrics.linesCovered).toBe(1);
        expect(metrics.linesTotal).toBe(2);
        expect(metrics.functionsCovered).toBe(1);
        expect(metrics.functionsTotal).toBe(1);
        expect(metrics.branchesCovered).toBe(0);
        expect(metrics.branchesTotal).toBe(0);
    });
});
