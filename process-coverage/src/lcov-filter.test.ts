import type {LcovFile, LcovSection} from './lcov-parser';
import {filterByPaths, stripExclMarkers} from './lcov-filter';

jest.mock('node:fs/promises', () => ({
    readFile: jest.fn()
}));
jest.mock('@actions/core', () => ({
    warning: jest.fn()
}));

import {readFile} from 'node:fs/promises';
import * as core from '@actions/core';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

function makeSection(sourceFile: string): LcovSection {
    return {
        testName: '',
        sourceFile,
        functions: [],
        functionData: [],
        functionsFound: 0,
        functionsHit: 0,
        lines: [{line: 1, count: 1}],
        linesFound: 1,
        linesHit: 1,
        branches: [],
        branchesFound: 0,
        branchesHit: 0
    };
}

const cwd = process.cwd().replace(/\\/g, '/');
const testFile: LcovFile = [
    makeSection(`${cwd}/src/foo.cpp`),
    makeSection(`${cwd}/src/bar.cpp`),
    makeSection(`${cwd}/tests/test_foo.cpp`),
    makeSection(`${cwd}/third_party/lib.cpp`),
    makeSection(`${cwd}/src/utils/helper.cpp`)
];

describe('filterByPaths', () => {
    describe('include only', () => {
        it('keeps sections matching a single include pattern', () => {
            const result = filterByPaths(testFile, ['**/src/**'], []);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });

        it('keeps sections matching multiple include patterns', () => {
            const result = filterByPaths(
                testFile,
                ['**/src/*.cpp', '**/tests/**'],
                []
            );
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/tests/test_foo.cpp`
            ]);
        });

        it('returns empty when no sections match include', () => {
            const result = filterByPaths(testFile, ['**/nonexistent/**'], []);
            expect(result).toEqual([]);
        });
    });

    describe('exclude only', () => {
        it('removes sections matching an exclude pattern', () => {
            const result = filterByPaths(testFile, [], ['**/third_party/**']);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/tests/test_foo.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });

        it('removes sections matching multiple exclude patterns', () => {
            const result = filterByPaths(
                testFile,
                [],
                ['**/tests/**', '**/third_party/**']
            );
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });
    });

    describe('include and exclude combined', () => {
        it('applies include first then exclude', () => {
            const result = filterByPaths(
                testFile,
                ['**/src/**'],
                ['**/utils/**']
            );
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`
            ]);
        });
    });

    describe('empty patterns', () => {
        it('returns all sections when both include and exclude are empty', () => {
            const result = filterByPaths(testFile, [], []);
            expect(result).toHaveLength(5);
            expect(result).toEqual(testFile);
        });
    });

    describe('glob matching', () => {
        it('* matches a single path segment only', () => {
            // **/src/*.cpp uses ** to cross leading dirs, then * for one filename segment
            // This matches files directly in src/ but NOT in src/utils/
            const result = filterByPaths(testFile, ['**/src/*.cpp'], []);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`
            ]);
        });

        it('** matches across directory boundaries', () => {
            // **/src/** matches everything under src/, including subdirectories
            const result = filterByPaths(testFile, ['**/src/**'], []);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });

        it('* in directory position does not cross into subdirectories', () => {
            // **/src/*.cpp should NOT match src/utils/helper.cpp
            // because * cannot cross the utils/ boundary
            const result = filterByPaths(testFile, ['**/src/*.cpp'], []);
            expect(result.map(s => s.sourceFile)).not.toContain(
                `${cwd}/src/utils/helper.cpp`
            );
        });

        it('matches absolute patterns resolved from relative by schema transform', () => {
            // Schema transform resolves 'src/**' to '${cwd}/src/**'
            const result = filterByPaths(testFile, [`${cwd}/src/**`], []);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });

        it('does not double-prefix patterns already starting with **', () => {
            const result = filterByPaths(testFile, ['**/tests/**'], []);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/tests/test_foo.cpp`
            ]);
        });

        it('does not prefix absolute patterns starting with /', () => {
            const result = filterByPaths(
                testFile,
                [`${cwd}/src/foo.cpp`],
                []
            );
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`
            ]);
        });

        it('matches absolute exclude patterns resolved from relative by schema transform', () => {
            const result = filterByPaths(testFile, [], [`${cwd}/third_party/**`]);
            expect(result.map(s => s.sourceFile)).toEqual([
                `${cwd}/src/foo.cpp`,
                `${cwd}/src/bar.cpp`,
                `${cwd}/tests/test_foo.cpp`,
                `${cwd}/src/utils/helper.cpp`
            ]);
        });
    });
});

describe('stripExclMarkers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function makeSectionWithLines(
        sourceFile: string,
        lines: Array<{line: number; count: number}>,
        branches: Array<{line: number; block: number; branch: number; count: number}> = []
    ): LcovSection {
        return {
            testName: '',
            sourceFile,
            functions: [],
            functionData: [],
            functionsFound: 0,
            functionsHit: 0,
            lines,
            linesFound: lines.length,
            linesHit: lines.filter(l => l.count > 0).length,
            branches,
            branchesFound: branches.length,
            branchesHit: branches.filter(b => b.count > 0).length
        };
    }

    it('removes DA records on LCOV_EXCL_LINE lines', async () => {
        const section = makeSectionWithLines('/src/a.cpp', [
            {line: 1, count: 5},
            {line: 2, count: 3},
            {line: 3, count: 1}
        ]);
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            'int b = 2; // LCOV_EXCL_LINE\n' +
            'int c = 3;\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result).toHaveLength(1);
        expect(result[0].lines).toEqual([
            {line: 1, count: 5},
            {line: 3, count: 1}
        ]);
        expect(result[0].linesFound).toBe(2);
        expect(result[0].linesHit).toBe(2);
    });

    it('removes DA and BRDA records in LCOV_EXCL_START/STOP regions', async () => {
        // Lines 2-3 are in the excluded region (START + body).
        // Line 4 is the STOP marker itself — it is NOT excluded (matches genhtml behavior).
        const section = makeSectionWithLines(
            '/src/b.cpp',
            [
                {line: 1, count: 5},
                {line: 2, count: 0},
                {line: 3, count: 0},
                {line: 4, count: 0},
                {line: 5, count: 2}
            ],
            [
                {line: 2, block: 0, branch: 0, count: 0},
                {line: 5, block: 0, branch: 0, count: 1}
            ]
        );
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            '// LCOV_EXCL_START\n' +
            'int b = 2;\n' +
            '// LCOV_EXCL_STOP\n' +
            'int c = 3;\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result[0].lines).toEqual([
            {line: 1, count: 5},
            {line: 4, count: 0},
            {line: 5, count: 2}
        ]);
        expect(result[0].linesFound).toBe(3);
        expect(result[0].linesHit).toBe(2);
        expect(result[0].branches).toEqual([
            {line: 5, block: 0, branch: 0, count: 1}
        ]);
        expect(result[0].branchesFound).toBe(1);
        expect(result[0].branchesHit).toBe(1);
    });

    it('recognizes GCOV_EXCL markers', async () => {
        const section = makeSectionWithLines('/src/c.cpp', [
            {line: 1, count: 5},
            {line: 2, count: 3},
            {line: 3, count: 1}
        ]);
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            'int b = 2; // GCOV_EXCL_LINE\n' +
            'int c = 3;\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result[0].lines).toEqual([
            {line: 1, count: 5},
            {line: 3, count: 1}
        ]);
    });

    it('handles GCOV_EXCL_START/STOP regions', async () => {
        // Lines 2-3 excluded (START + body), line 4 is STOP marker (not excluded)
        const section = makeSectionWithLines('/src/d.cpp', [
            {line: 1, count: 5},
            {line: 2, count: 0},
            {line: 3, count: 0},
            {line: 4, count: 2}
        ]);
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            '// GCOV_EXCL_START\n' +
            'int b = 2;\n' +
            '// GCOV_EXCL_STOP\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result[0].lines).toEqual([
            {line: 1, count: 5},
            {line: 4, count: 2}
        ]);
        expect(result[0].linesFound).toBe(2);
    });

    it('handles mixed LCOV and GCOV markers', async () => {
        const section = makeSectionWithLines('/src/e.cpp', [
            {line: 1, count: 5},
            {line: 2, count: 3},
            {line: 3, count: 1},
            {line: 4, count: 0},
            {line: 5, count: 2}
        ]);
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            'int b = 2; // LCOV_EXCL_LINE\n' +
            'int c = 3;\n' +
            'int d = 4; // GCOV_EXCL_LINE\n' +
            'int e = 5;\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result[0].lines).toEqual([
            {line: 1, count: 5},
            {line: 3, count: 1},
            {line: 5, count: 2}
        ]);
    });

    it('skips sections with missing source files and logs warning', async () => {
        const section = makeSectionWithLines('/src/missing.cpp', [
            {line: 1, count: 5}
        ]);
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        const result = await stripExclMarkers([section]);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(section);
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('/src/missing.cpp')
        );
    });

    it('passes through sections with no markers unchanged', async () => {
        const section = makeSectionWithLines('/src/clean.cpp', [
            {line: 1, count: 5},
            {line: 2, count: 3}
        ]);
        mockReadFile.mockResolvedValue('int a = 1;\nint b = 2;\n');

        const result = await stripExclMarkers([section]);
        expect(result[0]).toBe(section);
    });

    it('recalculates summary counts correctly', async () => {
        const section = makeSectionWithLines(
            '/src/f.cpp',
            [
                {line: 1, count: 5},
                {line: 2, count: 0},
                {line: 3, count: 3},
                {line: 4, count: 0}
            ],
            [
                {line: 2, block: 0, branch: 0, count: 0},
                {line: 2, block: 0, branch: 1, count: 1},
                {line: 3, block: 0, branch: 0, count: 3}
            ]
        );
        mockReadFile.mockResolvedValue(
            'int a = 1;\n' +
            'if (x) {} // LCOV_EXCL_LINE\n' +
            'if (y) {}\n' +
            'int d = 4;\n'
        );

        const result = await stripExclMarkers([section]);
        expect(result[0].linesFound).toBe(3);
        expect(result[0].linesHit).toBe(2);
        expect(result[0].branchesFound).toBe(1);
        expect(result[0].branchesHit).toBe(1);
    });
});
