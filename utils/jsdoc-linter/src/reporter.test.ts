import { report, reportText, reportJSON, reportGitHub } from './reporter';
import { type LintResult, type LintIssue, type FileLintResult } from './types';

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    (console.log as jest.Mock).mockRestore();
});

/**
 * Creates a sample lint issue for testing.
 *
 * @param overrides - Properties to override on the default issue
 * @returns A LintIssue object
 */
function makeIssue(overrides: Partial<LintIssue> = {}): LintIssue {
    return {
        file: 'test.ts',
        line: 10,
        column: 1,
        rule: 'jsdoc/missing',
        severity: 'error',
        message: 'Missing JSDoc',
        symbol: 'myFunc',
        declarationType: 'function',
        ...overrides,
    };
}

/**
 * Creates a sample lint result for testing.
 *
 * @param files - Array of file results
 * @returns A LintResult object
 */
function makeResult(files: FileLintResult[] = []): LintResult {
    const totalErrors = files.reduce((s, f) => s + f.errorCount, 0);
    const totalWarnings = files.reduce((s, f) => s + f.warningCount, 0);
    return {
        files,
        totalErrors,
        totalWarnings,
        totalFiles: files.length,
        filesWithIssues: files.filter(f => f.issues.length > 0).length,
    };
}

describe('reportText', () => {
    it('should report success when no issues', () => {
        const result = makeResult([{ file: 'a.ts', issues: [], errorCount: 0, warningCount: 0 }]);
        reportText(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('All files pass'));
    });

    it('should report files with issues', () => {
        const result = makeResult([
            {
                file: 'src/bad.ts',
                issues: [makeIssue()],
                errorCount: 1,
                warningCount: 0,
            },
        ]);
        reportText(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('src/bad.ts'));
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 error(s)'));
    });

    it('should report warnings', () => {
        const result = makeResult([
            {
                file: 'src/warn.ts',
                issues: [makeIssue({ severity: 'warning', rule: 'jsdoc/missing-throws' })],
                errorCount: 0,
                warningCount: 1,
            },
        ]);
        reportText(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('warning'));
    });

    it('should show failure message when there are errors', () => {
        const result = makeResult([
            {
                file: 'src/bad.ts',
                issues: [makeIssue()],
                errorCount: 1,
                warningCount: 0,
            },
        ]);
        reportText(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });
});

describe('reportJSON', () => {
    it('should output valid JSON', () => {
        const result = makeResult([]);
        reportJSON(result);
        const output = (console.log as jest.Mock).mock.calls[0][0];
        expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should include all result fields', () => {
        const result = makeResult([
            {
                file: 'test.ts',
                issues: [makeIssue()],
                errorCount: 1,
                warningCount: 0,
            },
        ]);
        reportJSON(result);
        const parsed = JSON.parse((console.log as jest.Mock).mock.calls[0][0]);
        expect(parsed.totalErrors).toBe(1);
        expect(parsed.files).toHaveLength(1);
    });
});

describe('reportGitHub', () => {
    it('should output GitHub Actions annotation format', () => {
        const result = makeResult([
            {
                file: 'src/mod.ts',
                issues: [makeIssue({ file: 'src/mod.ts', line: 5, column: 3 })],
                errorCount: 1,
                warningCount: 0,
            },
        ]);
        reportGitHub(result);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringMatching(/^::error file=src\/mod\.ts,line=5,col=3/)
        );
    });

    it('should output warning level for warnings', () => {
        const result = makeResult([
            {
                file: 'src/mod.ts',
                issues: [makeIssue({ severity: 'warning' })],
                errorCount: 0,
                warningCount: 1,
            },
        ]);
        reportGitHub(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^::warning /));
    });

    it('should output summary notice with counts', () => {
        const result = makeResult([
            {
                file: 'src/mod.ts',
                issues: [makeIssue()],
                errorCount: 1,
                warningCount: 0,
            },
        ]);
        reportGitHub(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('::notice::'));
    });

    it('should output passed notice when no issues', () => {
        const result = makeResult([{ file: 'a.ts', issues: [], errorCount: 0, warningCount: 0 }]);
        reportGitHub(result);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('passed'));
    });
});

describe('report', () => {
    it('should dispatch to text reporter', () => {
        const result = makeResult([]);
        report(result, 'text');
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('All files pass'));
    });

    it('should dispatch to json reporter', () => {
        const result = makeResult([]);
        report(result, 'json');
        const output = (console.log as jest.Mock).mock.calls[0][0];
        expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should dispatch to github reporter', () => {
        const result = makeResult([{ file: 'a.ts', issues: [], errorCount: 0, warningCount: 0 }]);
        report(result, 'github');
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('::notice::'));
    });
});
