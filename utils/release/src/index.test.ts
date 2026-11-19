import * as path from 'path';

/**
 * Sentinel thrown by the process.exit mock so that main() stops where the real
 * process would have exited.
 */
class ExitCalled extends Error {
    /**
     * Creates the sentinel.
     * @param code - Exit code passed to process.exit
     */
    constructor(public readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const rootDir = path.resolve(__dirname, '../../..');

const mockExecuteRelease = jest.fn();
const mockDetermineVersion = jest.fn();
const mockGetCurrentBranch = jest.fn();
const mockIsWorkingTreeClean = jest.fn();
const mockPrintHelp = jest.fn();

let originalArgv: string[];
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let exitSpy: jest.SpyInstance;

/**
 * Loads index.ts with the given CLI arguments and waits until it calls process.exit.
 * @param args - Arguments after the script name
 * @returns The first exit code passed to process.exit
 */
async function runMain(args: string[]): Promise<number | undefined> {
    process.argv = ['node', 'index.js', ...args];
    let exited = false;
    let resolveExit: (code: number | undefined) => void = () => {};
    const exitPromise = new Promise<number | undefined>(resolve => {
        resolveExit = resolve;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        if (!exited) {
            exited = true;
            resolveExit(code);
            // Exiting from main().catch() must not throw again (unhandled rejection)
            const lastError = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
            if (lastError?.[0] !== 'Release failed with error:') {
                throw new ExitCalled(code);
            }
        }
        return undefined as never;
    }) as never);

    await jest.isolateModulesAsync(async () => {
        await import('./index');
    });
    const code = await exitPromise;
    // Let main().catch() handle the sentinel before the spies are restored
    await new Promise(resolve => setTimeout(resolve, 0));
    return code;
}

beforeEach(() => {
    jest.resetAllMocks();
    originalArgv = process.argv;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    mockGetCurrentBranch.mockReturnValue('develop');
    mockIsWorkingTreeClean.mockReturnValue(true);
    mockExecuteRelease.mockResolvedValue(true);
    mockDetermineVersion.mockResolvedValue('v1.3.0');

    jest.doMock('./release', () => ({ executeRelease: mockExecuteRelease }));
    jest.doMock('./git', () => ({
        getCurrentBranch: mockGetCurrentBranch,
        isWorkingTreeClean: mockIsWorkingTreeClean
    }));
    jest.doMock('./version', () => ({
        ...jest.requireActual('./version'),
        determineVersion: mockDetermineVersion
    }));
    jest.doMock('./cli', () => ({
        ...jest.requireActual('./cli'),
        printHelp: mockPrintHelp
    }));
});

afterEach(() => {
    process.argv = originalArgv;
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    jest.dontMock('./release');
    jest.dontMock('./git');
    jest.dontMock('./version');
    jest.dontMock('./cli');
});

describe('release CLI entry point', () => {
    it('prints help and exits 0 without touching git', async () => {
        await expect(runMain(['--help'])).resolves.toBe(0);
        expect(mockPrintHelp).toHaveBeenCalledTimes(1);
        expect(mockGetCurrentBranch).not.toHaveBeenCalled();
        expect(mockExecuteRelease).not.toHaveBeenCalled();
    });

    it('releases the version given on the command line, adding the v prefix', async () => {
        await expect(runMain(['1.2.3', '--yes'])).resolves.toBe(0);
        expect(mockDetermineVersion).not.toHaveBeenCalled();
        expect(mockGetCurrentBranch).toHaveBeenCalledWith({ cwd: rootDir });
        expect(logSpy).toHaveBeenCalledWith('Using specified version: v1.2.3');
        expect(mockExecuteRelease).toHaveBeenCalledWith({
            tag: 'v1.2.3',
            skipPrompts: true,
            dryRun: false,
            rootDir
        });
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when the given version is not semver', async () => {
        await expect(runMain(['--version', '1.2'])).resolves.toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Invalid version format: 1.2');
        expect(mockExecuteRelease).not.toHaveBeenCalled();
    });

    it('asks determineVersion for the next version when none is given', async () => {
        await expect(runMain([])).resolves.toBe(0);
        expect(mockDetermineVersion).toHaveBeenCalledWith(rootDir);
        expect(mockExecuteRelease).toHaveBeenCalledWith({
            tag: 'v1.3.0',
            skipPrompts: false,
            dryRun: false,
            rootDir
        });
    });

    it('exits 1 when determineVersion returns an invalid version', async () => {
        mockDetermineVersion.mockResolvedValue('vnext');
        await expect(runMain([])).resolves.toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Invalid version: vnext');
        expect(mockExecuteRelease).not.toHaveBeenCalled();
    });

    it('warns when not on develop and the working tree is dirty', async () => {
        mockGetCurrentBranch.mockReturnValue('feature/x');
        mockIsWorkingTreeClean.mockReturnValue(false);
        await expect(runMain(['v1.2.3'])).resolves.toBe(0);
        expect(warnSpy).toHaveBeenCalledWith('\nWarning: You are not on the develop branch.');
        expect(warnSpy).toHaveBeenCalledWith('\nWarning: Working tree has uncommitted changes.');
    });

    it('does not warn about branch or working tree in dry-run mode', async () => {
        mockGetCurrentBranch.mockReturnValue('feature/x');
        mockIsWorkingTreeClean.mockReturnValue(false);
        await expect(runMain(['v1.2.3', '--dry-run'])).resolves.toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockExecuteRelease).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it('exits 1 when the release fails', async () => {
        mockExecuteRelease.mockResolvedValue(false);
        await expect(runMain(['v1.2.3'])).resolves.toBe(1);
    });

    it('reports unexpected errors and exits 1', async () => {
        const err = new Error('git not found');
        mockGetCurrentBranch.mockImplementation(() => {
            throw err;
        });
        await expect(runMain(['v1.2.3'])).resolves.toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Release failed with error:', err);
    });
});
