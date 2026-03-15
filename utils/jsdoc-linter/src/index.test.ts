/**
 * Tests for the JSDoc linter CLI argument parsing and main entry point.
 *
 * Since parseArgs and main are not exported, we test by importing the module
 * with mocked dependencies and process.argv/process.exit.
 */

import { type LintResult } from './types';

let mockLint: jest.Mock;
let mockReport: jest.Mock;
let mockExit: jest.SpyInstance;
let originalArgv: string[];

beforeEach(() => {
    jest.clearAllMocks();

    mockLint = jest.fn();
    mockReport = jest.fn();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    originalArgv = process.argv;
});

afterEach(() => {
    process.argv = originalArgv;
    mockExit.mockRestore();
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
    jest.resetModules();
});

/**
 * Imports the index module with mocked linter and reporter, triggering main().
 *
 * @param argv - The command-line arguments to simulate (without node/script)
 * @param lintResult - The result the mocked lint function should return
 * @returns Promise that resolves after main() completes
 */
async function runCLI(argv: string[], lintResult?: LintResult): Promise<void> {
    const defaultResult: LintResult = {
        files: [],
        totalErrors: 0,
        totalWarnings: 0,
        totalFiles: 0,
        filesWithIssues: 0,
    };
    mockLint.mockResolvedValue(lintResult ?? defaultResult);

    process.argv = ['node', 'jsdoc-linter', ...argv];

    jest.doMock('./linter', () => ({ lint: mockLint }));
    jest.doMock('./reporter', () => ({
        report: mockReport,
        reportText: jest.fn(),
        reportJSON: jest.fn(),
        reportGitHub: jest.fn(),
    }));

    await jest.isolateModulesAsync(async () => {
        await import('./index');
    });

    // Allow any pending microtasks to complete
    await new Promise(resolve => setImmediate(resolve));
}

describe('jsdoc-linter CLI', () => {
    describe('argument parsing', () => {
        it('should parse workspace arguments with -w flag', async () => {
            await runCLI(['-w', 'setup-gcc']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ workspaces: ['setup-gcc'] })
            );
        });

        it('should parse workspace arguments with --workspace flag', async () => {
            await runCLI(['--workspace', 'common/gh-inputs']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ workspaces: ['common/gh-inputs'] })
            );
        });

        it('should parse multiple workspace arguments', async () => {
            await runCLI(['-w', 'setup-gcc', '-w', 'setup-clang']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ workspaces: ['setup-gcc', 'setup-clang'] })
            );
        });

        it('should parse exclude arguments with -e flag', async () => {
            await runCLI(['-e', '**/vendor/**']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ exclude: ['**/vendor/**'] })
            );
        });

        it('should parse exclude arguments with --exclude flag', async () => {
            await runCLI(['--exclude', '**/dist/**']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ exclude: ['**/dist/**'] })
            );
        });

        it('should parse format argument with -f flag', async () => {
            await runCLI(['-f', 'json']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ format: 'json' })
            );
        });

        it('should parse format argument with --format flag', async () => {
            await runCLI(['--format', 'github']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ format: 'github' })
            );
        });

        it('should handle unknown format gracefully and default to text', async () => {
            await runCLI(['-f', 'xml']);
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown format'));
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ format: 'text' })
            );
        });

        it('should parse --fail-on-warnings flag', async () => {
            await runCLI(['--fail-on-warnings']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ failOnWarnings: true })
            );
        });

        it('should parse root directory with -r flag', async () => {
            await runCLI(['-r', '/custom/root']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ rootDir: expect.stringContaining('custom') })
            );
        });

        it('should parse root directory with --root flag', async () => {
            await runCLI(['--root', '/my/project']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ rootDir: expect.stringContaining('my') })
            );
        });

        it('should treat positional arguments as workspaces', async () => {
            await runCLI(['setup-gcc', 'setup-clang']);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({ workspaces: ['setup-gcc', 'setup-clang'] })
            );
        });

        it('should warn about unknown options', async () => {
            await runCLI(['--unknown-flag']);
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown option'));
        });

        it('should show help and exit with -h flag', async () => {
            await runCLI(['-h']);
            expect(mockExit).toHaveBeenCalledWith(0);
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('JSDoc Linter'));
        });

        it('should show help and exit with --help flag', async () => {
            await runCLI(['--help']);
            expect(mockExit).toHaveBeenCalledWith(0);
        });
    });

    describe('main execution', () => {
        it('should call lint and report with defaults when no args given', async () => {
            await runCLI([]);
            expect(mockLint).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaces: [],
                    exclude: [],
                    format: 'text',
                    failOnWarnings: false,
                })
            );
            expect(mockReport).toHaveBeenCalledWith(expect.any(Object), 'text');
        });

        it('should exit with code 1 when there are errors', async () => {
            const result: LintResult = {
                files: [],
                totalErrors: 3,
                totalWarnings: 0,
                totalFiles: 1,
                filesWithIssues: 1,
            };
            await runCLI([], result);
            expect(mockExit).toHaveBeenCalledWith(1);
        });

        it('should not exit with error code when there are only warnings without --fail-on-warnings', async () => {
            const result: LintResult = {
                files: [],
                totalErrors: 0,
                totalWarnings: 5,
                totalFiles: 1,
                filesWithIssues: 1,
            };
            await runCLI([], result);
            expect(mockExit).not.toHaveBeenCalledWith(1);
        });

        it('should exit with code 1 when there are warnings with --fail-on-warnings', async () => {
            const result: LintResult = {
                files: [],
                totalErrors: 0,
                totalWarnings: 2,
                totalFiles: 1,
                filesWithIssues: 1,
            };
            await runCLI(['--fail-on-warnings'], result);
            expect(mockExit).toHaveBeenCalledWith(1);
        });

        it('should not exit with error code when lint passes cleanly', async () => {
            await runCLI([]);
            expect(mockExit).not.toHaveBeenCalledWith(1);
            expect(mockExit).not.toHaveBeenCalledWith(2);
        });

        it('should exit with code 2 when lint throws an error', async () => {
            mockLint.mockRejectedValue(new Error('Parse error'));

            process.argv = ['node', 'jsdoc-linter'];

            jest.doMock('./linter', () => ({ lint: mockLint }));
            jest.doMock('./reporter', () => ({
                report: mockReport,
                reportText: jest.fn(),
                reportJSON: jest.fn(),
                reportGitHub: jest.fn(),
            }));

            await jest.isolateModulesAsync(async () => {
                await import('./index');
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(mockExit).toHaveBeenCalledWith(2);
            expect(console.error).toHaveBeenCalledWith(
                'Error running JSDoc linter:',
                expect.any(Error)
            );
        });

        it('should pass format option to report', async () => {
            await runCLI(['-f', 'json']);
            expect(mockReport).toHaveBeenCalledWith(expect.any(Object), 'json');
        });
    });
});
