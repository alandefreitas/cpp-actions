import * as path from 'path';

// Mock esbuild
jest.mock('esbuild', () => ({
    build: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    statSync: jest.fn(),
    writeFileSync: jest.fn()
}));

import * as fs from 'fs';
import * as esbuild from 'esbuild';

const mockBuild = esbuild.build as jest.MockedFunction<typeof esbuild.build>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockStatSync = fs.statSync as jest.MockedFunction<typeof fs.statSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

// Store original values
const originalArgv = process.argv;
const originalCwd = process.cwd;
const originalExit = process.exit;

beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    // Mock process.exit as a no-op (don't throw — async callers would create unhandled rejections)
    process.exit = jest.fn() as never;
});

afterEach(() => {
    process.argv = originalArgv;
    process.cwd = originalCwd;
    process.exit = originalExit;
    jest.restoreAllMocks();
});

/**
 * Helper to run the index module in isolation with controlled argv.
 *
 * @param argv - The process.argv to use
 * @param cwd - The current working directory to simulate
 * @returns A promise that resolves after the module has executed
 */
function runModule(argv: string[], cwd = path.resolve('/fake/root')): Promise<void> {
    process.argv = ['node', 'index.js', ...argv];
    process.cwd = jest.fn(() => cwd);

    return new Promise<void>((resolve, reject) => {
        jest.isolateModules(() => {
            try {
                require('./index');
            } catch (e) {
                reject(e);
                return;
            }
        });
        // Allow the async build() to settle
        setTimeout(() => resolve(), 50);
    });
}

describe('esbuild CLI', () => {
    describe('workspace path resolution', () => {
        it('should exit if package.json not found', async () => {
            mockExistsSync.mockReturnValue(false);
            // Code continues after mocked process.exit, so provide fallback mocks
            mockReadFileSync.mockReturnValue(JSON.stringify({}));
            mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule(['/some/workspace']);

            expect(process.exit).toHaveBeenCalledWith(1);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('package.json not found')
            );
        });

        it('should use process.cwd() when workspace path is "."', async () => {
            const fakeCwd = path.resolve('/fake/cwd/workspace');
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/index.js' }));
            mockStatSync.mockReturnValue({ size: 1024 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule(['.'], fakeCwd);

            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    entryPoints: [path.join(fakeCwd, 'lib/index.js')]
                })
            );
        });

        it('should use process.cwd() when no argument provided', async () => {
            const fakeCwd = path.resolve('/fake/cwd/workspace');
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/index.js' }));
            mockStatSync.mockReturnValue({ size: 1024 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule([], fakeCwd);

            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    entryPoints: [path.join(fakeCwd, 'lib/index.js')]
                })
            );
        });

        it('should resolve workspace path for non-"." argument', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/index.js' }));
            mockStatSync.mockReturnValue({ size: 2048 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule(['/workspace/cmake-workflow']);

            const resolved = path.resolve('/workspace/cmake-workflow');
            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    entryPoints: [path.join(resolved, 'lib/index.js')],
                    outfile: path.join(resolved, 'dist', 'index.js')
                })
            );
        });
    });

    describe('build configuration', () => {
        it('should use default entry point when package.json has no main', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({}));
            mockStatSync.mockReturnValue({ size: 512 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule(['/workspace/my-action']);

            const resolved = path.resolve('/workspace/my-action');
            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    entryPoints: [path.join(resolved, 'lib/index.js')]
                })
            );
        });

        it('should pass correct esbuild options', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/main.js' }));
            mockStatSync.mockReturnValue({ size: 4096 } as fs.Stats);
            mockBuild.mockResolvedValue({ metafile: {} } as esbuild.BuildResult);

            await runModule(['/workspace/test-action']);

            expect(esbuild.build).toHaveBeenCalledWith(
                expect.objectContaining({
                    bundle: true,
                    platform: 'node',
                    target: 'node16',
                    sourcemap: true,
                    minify: true,
                    keepNames: true,
                    sourcesContent: true,
                    conditions: ['import'],
                    metafile: true,
                    logLevel: 'info'
                })
            );
        });
    });

    describe('build success', () => {
        it('should log output sizes and write metafile', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/index.js' }));
            mockStatSync
                .mockReturnValueOnce({ size: 102400 } as fs.Stats)   // outfile
                .mockReturnValueOnce({ size: 204800 } as fs.Stats);  // map file
            const metafile = { inputs: {}, outputs: {} };
            mockBuild.mockResolvedValue({ metafile } as unknown as esbuild.BuildResult);

            await runModule(['/workspace/my-action']);

            // Should log sizes
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('100kB'));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('200kB'));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Done in'));

            // Should write metafile
            const resolved = path.resolve('/workspace/my-action');
            expect(mockWriteFileSync).toHaveBeenCalledWith(
                path.join(resolved, 'dist', 'meta.json'),
                JSON.stringify(metafile, null, 2)
            );
        });
    });

    describe('build failure', () => {
        it('should exit with code 1 on build error', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue(JSON.stringify({ main: 'lib/index.js' }));
            mockBuild.mockRejectedValue(new Error('Build failed: missing entry'));

            // Override the throwing process.exit with a non-throwing mock for this test
            // since the error path calls process.exit asynchronously in the catch block
            process.exit = jest.fn() as never;

            await runModule(['/workspace/bad-action']);

            expect(process.exit).toHaveBeenCalledWith(1);
            expect(console.error).toHaveBeenCalledWith('Build failed:', expect.any(Error));
        });
    });
});
