import {
    getChangedLines,
    parseDiffOutput,
    analyzeNewCodeCoverage
} from './new-code';
import type {LcovFile} from './lcov-parser';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
>;

describe('getChangedLines', () => {
    const sampleDiff = [
        'diff --git a/src/foo.cpp b/src/foo.cpp',
        '--- a/src/foo.cpp',
        '+++ b/src/foo.cpp',
        '@@ -10,0 +10,5 @@',
        '+line1',
        '+line2',
        '+line3',
        '+line4',
        '+line5'
    ].join('\n');

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: sampleDiff,
            stderr: ''
        });
    });

    it('runs git diff with correct arguments', async () => {
        await getChangedLines('origin/main');

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            'git',
            ['diff', '--unified=0', '--diff-filter=AM', 'origin/main'],
            {silent: true, ignoreReturnCode: true}
        );
    });

    it('returns parsed changed lines', async () => {
        const result = await getChangedLines('origin/main');

        expect(result.has('src/foo.cpp')).toBe(true);
        const lines = result.get('src/foo.cpp')!;
        expect(lines).toEqual(new Set([10, 11, 12, 13, 14]));
    });

    it('returns empty map when diff fails (shallow clone)', async () => {
        // rev-parse fails (ref not available), fetch fails, diff fails
        mockGetExecOutput.mockRejectedValue(new Error('fatal: bad object'));

        const result = await getChangedLines('origin/main');

        expect(result.size).toBe(0);
        expect(core.info).toHaveBeenCalledWith(
            expect.stringContaining('skipping new-code analysis')
        );
    });

    it('returns empty map when git diff exits non-zero and HEAD~1 also fails', async () => {
        // tryDiff('origin/main'): log -1 ok, diff fails
        // tryDiff('HEAD~1') fallback: log -1 ok, diff also fails
        mockGetExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // log -1 origin/main ok
            .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: bad revision' }) // diff origin/main fails
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // log -1 HEAD~1 ok
            .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'fatal: bad object' }); // diff HEAD~1 also fails

        const result = await getChangedLines('origin/main');

        expect(result.size).toBe(0);
        expect(core.info).toHaveBeenCalledWith(
            expect.stringContaining('skipping new-code analysis')
        );
    });

    it('deepens clone for HEAD~N when log -1 fails', async () => {
        mockGetExecOutput.mockReset();
        mockGetExecOutput
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })  // isRefResolvable log -1 → not available
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // ensureRefAvailable fetch --deepen
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // tryDiff git diff

        const originalBaseRef = process.env.GITHUB_BASE_REF;
        const originalEventPath = process.env.GITHUB_EVENT_PATH;
        delete process.env.GITHUB_BASE_REF;
        delete process.env.GITHUB_EVENT_PATH;

        try {
            await getChangedLines('');

            expect(mockGetExecOutput).toHaveBeenCalledWith(
                'git', ['fetch', '--deepen', '2'],
                {silent: true}
            );
        } finally {
            if (originalBaseRef !== undefined) process.env.GITHUB_BASE_REF = originalBaseRef;
            if (originalEventPath !== undefined) process.env.GITHUB_EVENT_PATH = originalEventPath;
        }
    });

    it('auto-detects GITHUB_BASE_REF for PRs', async () => {
        const originalEnv = process.env.GITHUB_BASE_REF;
        process.env.GITHUB_BASE_REF = 'develop';

        try {
            await getChangedLines('');

            expect(mockGetExecOutput).toHaveBeenCalledWith(
                'git',
                [
                    'diff',
                    '--unified=0',
                    '--diff-filter=AM',
                    'origin/develop'
                ],
                {silent: true, ignoreReturnCode: true}
            );
        } finally {
            if (originalEnv === undefined) {
                delete process.env.GITHUB_BASE_REF;
            } else {
                process.env.GITHUB_BASE_REF = originalEnv;
            }
        }
    });

    it('falls back to HEAD~1 when no GITHUB_BASE_REF and no event payload', async () => {
        const originalBaseRef = process.env.GITHUB_BASE_REF;
        const originalEventPath = process.env.GITHUB_EVENT_PATH;
        delete process.env.GITHUB_BASE_REF;
        delete process.env.GITHUB_EVENT_PATH;

        try {
            await getChangedLines('');

            expect(mockGetExecOutput).toHaveBeenCalledWith(
                'git',
                ['diff', '--unified=0', '--diff-filter=AM', 'HEAD~1'],
                {silent: true, ignoreReturnCode: true}
            );
        } finally {
            if (originalBaseRef !== undefined) {
                process.env.GITHUB_BASE_REF = originalBaseRef;
            }
            if (originalEventPath !== undefined) {
                process.env.GITHUB_EVENT_PATH = originalEventPath;
            }
        }
    });

    it('deepens clone for HEAD~N refs when rev-parse fails', async () => {
        // rev-parse fails, deepen succeeds, rev-parse again succeeds, diff succeeds
        mockGetExecOutput
            .mockRejectedValueOnce(new Error('unknown revision'))  // rev-parse (not resolvable)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // fetch --deepen
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // rev-parse (now resolvable)
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // git diff

        const originalBaseRef = process.env.GITHUB_BASE_REF;
        const originalEventPath = process.env.GITHUB_EVENT_PATH;
        delete process.env.GITHUB_BASE_REF;
        delete process.env.GITHUB_EVENT_PATH;

        try {
            await getChangedLines('');
            expect(mockGetExecOutput).toHaveBeenCalledWith(
                'git',
                ['fetch', '--deepen', '2'],
                {silent: true}
            );
        } finally {
            if (originalBaseRef !== undefined) {
                process.env.GITHUB_BASE_REF = originalBaseRef;
            }
            if (originalEventPath !== undefined) {
                process.env.GITHUB_EVENT_PATH = originalEventPath;
            }
        }
    });

    it('fetches branch refs when log -1 fails', async () => {
        // Override default mock to control each call
        mockGetExecOutput.mockReset();
        mockGetExecOutput
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })  // isRefResolvable log -1 → not available
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // ensureRefAvailable fetch origin
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // tryDiff git diff

        await getChangedLines('origin/main');

        expect(mockGetExecOutput).toHaveBeenCalledTimes(3);
        expect(mockGetExecOutput).toHaveBeenNthCalledWith(2,
            'git',
            ['fetch', '--depth=1', 'origin', 'main'],
            {silent: true}
        );
    });

    it('uses HEAD~N from push event commit count', async () => {
        const fs = require('node:fs');
        const pathMod = require('node:path');
        const os = require('node:os');
        const tmpFile = pathMod.join(os.tmpdir(), `test-event-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, JSON.stringify({
            commits: [{}, {}, {}]  // 3 commits pushed
        }));

        const origEventPath = process.env.GITHUB_EVENT_PATH;
        const origBaseRef = process.env.GITHUB_BASE_REF;
        process.env.GITHUB_EVENT_PATH = tmpFile;
        delete process.env.GITHUB_BASE_REF;

        try {
            await getChangedLines('');

            // Should diff against HEAD~3 (not a SHA)
            expect(mockGetExecOutput).toHaveBeenCalledWith(
                'git',
                ['diff', '--unified=0', '--diff-filter=AM', 'HEAD~3'],
                {silent: true, ignoreReturnCode: true}
            );
        } finally {
            if (origEventPath !== undefined) {
                process.env.GITHUB_EVENT_PATH = origEventPath;
            } else {
                delete process.env.GITHUB_EVENT_PATH;
            }
            if (origBaseRef !== undefined) {
                process.env.GITHUB_BASE_REF = origBaseRef;
            }
            fs.unlinkSync(tmpFile);
        }
    });
});

describe('parseDiffOutput', () => {
    it('parses a single file with one hunk', () => {
        const diff = [
            '+++ b/src/foo.cpp',
            '@@ -0,0 +10,5 @@'
        ].join('\n');

        const result = parseDiffOutput(diff);
        expect(result.get('src/foo.cpp')).toEqual(
            new Set([10, 11, 12, 13, 14])
        );
    });

    it('parses a single line change (no count)', () => {
        const diff = [
            '+++ b/src/bar.cpp',
            '@@ -5 +5 @@'
        ].join('\n');

        const result = parseDiffOutput(diff);
        expect(result.get('src/bar.cpp')).toEqual(new Set([5]));
    });

    it('parses multiple files', () => {
        const diff = [
            '+++ b/src/a.cpp',
            '@@ -0,0 +1,2 @@',
            '+++ b/src/b.cpp',
            '@@ -0,0 +5,3 @@'
        ].join('\n');

        const result = parseDiffOutput(diff);
        expect(result.get('src/a.cpp')).toEqual(new Set([1, 2]));
        expect(result.get('src/b.cpp')).toEqual(new Set([5, 6, 7]));
    });

    it('parses multiple hunks in one file', () => {
        const diff = [
            '+++ b/src/foo.cpp',
            '@@ -0,0 +1,2 @@',
            '@@ -0,0 +10,3 @@'
        ].join('\n');

        const result = parseDiffOutput(diff);
        expect(result.get('src/foo.cpp')).toEqual(
            new Set([1, 2, 10, 11, 12])
        );
    });

    it('handles zero-count hunks (deleted sections)', () => {
        const diff = [
            '+++ b/src/foo.cpp',
            '@@ -5,3 +5,0 @@'
        ].join('\n');

        const result = parseDiffOutput(diff);
        // count=0 means no new lines
        expect(result.get('src/foo.cpp')).toEqual(new Set());
    });

    it('returns empty map for empty diff', () => {
        const result = parseDiffOutput('');
        expect(result.size).toBe(0);
    });
});

describe('analyzeNewCodeCoverage', () => {
    const makeLcov = (
        sourceFile: string,
        lines: Array<{line: number; count: number}>
    ): LcovFile => [
        {
            testName: '',
            sourceFile,
            functions: [],
            functionData: [],
            functionsFound: 0,
            functionsHit: 0,
            lines: lines.map((l) => ({line: l.line, count: l.count})),
            linesFound: lines.length,
            linesHit: lines.filter((l) => l.count > 0).length,
            branches: [],
            branchesFound: 0,
            branchesHit: 0
        }
    ];

    it('counts covered new lines', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 10, count: 5},
            {line: 11, count: 3},
            {line: 12, count: 1}
        ]);
        const changed = new Map([['src/foo.cpp', new Set([10, 11, 12])]]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.coveredLines).toBe(3);
        expect(result.totalLines).toBe(3);
        expect(result.percent).toBeCloseTo(100);
        expect(result.uncoveredFiles).toHaveLength(0);
    });

    it('counts uncovered new lines', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 10, count: 5},
            {line: 11, count: 0},
            {line: 12, count: 0}
        ]);
        const changed = new Map([['src/foo.cpp', new Set([10, 11, 12])]]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.coveredLines).toBe(1);
        expect(result.totalLines).toBe(3);
        expect(result.uncoveredFiles).toEqual([
            {file: 'src/foo.cpp', lines: [11, 12]}
        ]);
    });

    it('skips non-executable lines (in diff but not in LCOV DA)', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 10, count: 5}
        ]);
        // Lines 11, 12 are not in LCOV — they're comments/blank/non-executable
        const changed = new Map([['src/foo.cpp', new Set([10, 11, 12])]]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.totalLines).toBe(1);
        expect(result.coveredLines).toBe(1);
    });

    it('matches relative diff paths to absolute LCOV SF paths', () => {
        const lcov = makeLcov('/home/user/project/src/foo.cpp', [
            {line: 1, count: 1}
        ]);
        const changed = new Map([['src/foo.cpp', new Set([1])]]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.totalLines).toBe(1);
        expect(result.coveredLines).toBe(1);
    });

    it('skips files not in LCOV data', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 1, count: 1}
        ]);
        const changed = new Map([
            ['src/foo.cpp', new Set([1])],
            ['src/unknown.cpp', new Set([5, 6])]
        ]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.totalLines).toBe(1);
    });

    it('sorts uncoveredFiles by file path', () => {
        const lcov: LcovFile = [
            ...makeLcov('/project/src/z.cpp', [{line: 1, count: 0}]),
            ...makeLcov('/project/src/a.cpp', [{line: 1, count: 0}])
        ];
        const changed = new Map([
            ['src/z.cpp', new Set([1])],
            ['src/a.cpp', new Set([1])]
        ]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.uncoveredFiles[0].file).toBe('src/a.cpp');
        expect(result.uncoveredFiles[1].file).toBe('src/z.cpp');
    });

    it('sorts uncovered lines ascending within a file', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 20, count: 0},
            {line: 5, count: 0},
            {line: 10, count: 0}
        ]);
        const changed = new Map([['src/foo.cpp', new Set([20, 5, 10])]]);

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.uncoveredFiles[0].lines).toEqual([5, 10, 20]);
    });

    it('returns zero metrics for empty changed lines', () => {
        const lcov = makeLcov('/project/src/foo.cpp', [
            {line: 1, count: 1}
        ]);
        const changed = new Map<string, Set<number>>();

        const result = analyzeNewCodeCoverage(lcov, changed);

        expect(result.coveredLines).toBe(0);
        expect(result.totalLines).toBe(0);
        expect(result.percent).toBe(0);
        expect(result.uncoveredFiles).toHaveLength(0);
    });
});
