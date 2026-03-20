import { brewMain, ensureBrewInPath } from './brew-install';
import { type Inputs } from './schema';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as core from '@actions/core';
import * as fs from 'fs';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('fs', () => ({
    existsSync: jest.fn()
}));

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>;
const mockStartGroup = core.startGroup as jest.MockedFunction<typeof core.startGroup>;
const mockEndGroup = core.endGroup as jest.MockedFunction<typeof core.endGroup>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

/**
 * Creates a default Inputs object for testing with optional overrides.
 *
 * @param overrides - Partial input values to override defaults
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        vcpkg: [],
        apt_get: [],
        brew: [],
        brewCask: [],
        choco: [],
        packages: [],
        retries: 5,
        brewRetries: 0,
        chocoRetries: 0,
        cxx: '',
        cxxflags: '',
        cc: '',
        ccflags: '',
        vcpkgTriplet: '',
        vcpkgDir: '',
        vcpkgBranch: 'master',
        vcpkgCache: true,
        vcpkgForceInstall: false,
        aptGetRetries: 3,
        aptGetSources: [],
        aptGetSourceKeys: [],
        aptGetIgnoreMissing: false,
        aptGetAddArchitecture: [],
        aptGetBulkInstall: false,
        ...overrides
    };
}

describe('ensureBrewInPath', () => {
    const origPlatform = process.platform;
    const origEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        process.env = { ...origEnv };
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
        process.env = origEnv;
    });

    it('returns true when brew is already in PATH', async () => {
        mockWhich.mockResolvedValue('/usr/local/bin/brew');
        const fnlog = jest.fn();

        const result = await ensureBrewInPath(fnlog);

        expect(result).toBe(true);
        expect(fnlog).toHaveBeenCalledWith('brew found in PATH');
    });

    it('sets up Linuxbrew environment on Linux when brew is not in PATH', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        mockExistsSync.mockReturnValue(true);
        const fnlog = jest.fn();
        const result = await ensureBrewInPath(fnlog);

        expect(result).toBe(true);
        expect(process.env.HOMEBREW_PREFIX).toBe('/home/linuxbrew/.linuxbrew');
        expect(process.env.HOMEBREW_CELLAR).toBe('/home/linuxbrew/.linuxbrew/Cellar');
        expect(process.env.HOMEBREW_REPOSITORY).toBe('/home/linuxbrew/.linuxbrew/Homebrew');
        expect(process.env.PATH).toContain('/home/linuxbrew/.linuxbrew/bin');
        expect(process.env.PATH).toContain('/home/linuxbrew/.linuxbrew/sbin');
        expect(fnlog).toHaveBeenCalledWith('Linuxbrew PATH and environment configured');
    });

    it('returns false and warns on Linux when Linuxbrew is not installed', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        mockExistsSync.mockReturnValue(false);
        const fnlog = jest.fn();

        const result = await ensureBrewInPath(fnlog);

        expect(result).toBe(false);
        expect(mockWarning).toHaveBeenCalledWith('brew is not installed — skipping brew packages');
    });

    it('returns false and warns on non-Linux when brew is not in PATH', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        mockWhich.mockRejectedValue(new Error('not found'));
        const fnlog = jest.fn();

        const result = await ensureBrewInPath(fnlog);

        expect(result).toBe(false);
        expect(mockWarning).toHaveBeenCalledWith('brew is not available — skipping brew packages');
    });

    it('handles undefined PATH when setting up Linuxbrew', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        mockExistsSync.mockReturnValue(true);
        const savedPath = process.env.PATH;
        delete process.env.PATH;
        const fnlog = jest.fn();

        await ensureBrewInPath(fnlog);

        expect(process.env.PATH).toBe(
            '/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:'
        );
        process.env.PATH = savedPath;
    });

    it('preserves existing PATH when prepending Linuxbrew paths', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        mockExistsSync.mockReturnValue(true);
        process.env.PATH = '/usr/bin:/usr/local/bin';
        const fnlog = jest.fn();

        await ensureBrewInPath(fnlog);

        expect(process.env.PATH).toBe(
            '/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:/usr/bin:/usr/local/bin'
        );
    });
});

describe('brewMain', () => {
    const origPlatform = process.platform;
    const origEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        process.env = { ...origEnv };
        // brew is in PATH by default
        mockWhich.mockResolvedValue('/usr/local/bin/brew');
        mockExec.mockResolvedValue(0);
    });

    afterEach(() => {
        jest.useRealTimers();
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
        process.env = origEnv;
    });

    it('does nothing when both brew and brewCask lists are empty', async () => {
        const inputs = makeInputs({ brew: [], brewCask: [] });
        await brewMain(inputs);

        expect(mockExec).not.toHaveBeenCalled();
        expect(mockStartGroup).not.toHaveBeenCalled();
    });

    it('returns early on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ brew: ['cmake'] });
        await brewMain(inputs);

        expect(mockExec).not.toHaveBeenCalled();
        expect(mockDebug).toHaveBeenCalledWith('Skipping brew installs — Homebrew is not available on Windows');
    });

    it('installs a single formula', async () => {
        const inputs = makeInputs({ brew: ['cmake'] });
        await brewMain(inputs);

        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.any(Object));
    });

    it('installs multiple formulae', async () => {
        const inputs = makeInputs({ brew: ['cmake', 'ninja', 'gcc'] });
        await brewMain(inputs);

        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.any(Object));
        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'ninja'], expect.any(Object));
        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'gcc'], expect.any(Object));
    });

    it('supports formula@version syntax', async () => {
        const inputs = makeInputs({ brew: ['gcc@14', 'llvm@18'] });
        await brewMain(inputs);

        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'gcc@14'], expect.any(Object));
        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'llvm@18'], expect.any(Object));
    });

    it('installs casks with --cask flag on macOS', async () => {
        const inputs = makeInputs({ brewCask: ['visual-studio-code', 'docker'] });
        await brewMain(inputs);

        expect(mockExec).toHaveBeenCalledWith(
            'brew', ['install', '--cask', 'visual-studio-code'], expect.any(Object)
        );
        expect(mockExec).toHaveBeenCalledWith(
            'brew', ['install', '--cask', 'docker'], expect.any(Object)
        );
    });

    it('skips cask installs on Linux with debug message', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        mockExistsSync.mockReturnValue(true);
        const inputs = makeInputs({ brewCask: ['firefox'] });
        await brewMain(inputs);

        expect(mockDebug).toHaveBeenCalledWith(
            'Skipping brew cask installs — casks are macOS-only (.app bundles)'
        );
        // No cask exec calls
        const caskCalls = mockExec.mock.calls.filter(
            c => Array.isArray(c[1]) && c[1].includes('--cask')
        );
        expect(caskCalls).toHaveLength(0);
    });

    it('passes CI-optimized Homebrew env vars to exec calls', async () => {
        const inputs = makeInputs({ brew: ['cmake'] });
        await brewMain(inputs);

        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.objectContaining({
            env: expect.objectContaining({
                HOMEBREW_NO_AUTO_UPDATE: '1',
                HOMEBREW_NO_INSTALL_UPGRADE: '1',
                HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
                HOMEBREW_NO_INSTALL_CLEANUP: '1',
                HOMEBREW_NO_ANALYTICS: '1'
            })
        }));
    });

    it('does not mutate process.env with Homebrew variables', async () => {
        const origValue = process.env.HOMEBREW_NO_AUTO_UPDATE;
        const inputs = makeInputs({ brew: ['cmake'] });
        await brewMain(inputs);

        expect(process.env.HOMEBREW_NO_AUTO_UPDATE).toBe(origValue);
    });

    it('uses startGroup/endGroup for each formula', async () => {
        const inputs = makeInputs({ brew: ['cmake'] });
        await brewMain(inputs);

        expect(mockStartGroup).toHaveBeenCalledWith('🍺 Install brew formula: cmake');
        expect(mockEndGroup).toHaveBeenCalled();
    });

    it('uses startGroup/endGroup for each cask', async () => {
        const inputs = makeInputs({ brewCask: ['docker'] });
        await brewMain(inputs);

        expect(mockStartGroup).toHaveBeenCalledWith('🍺 Install brew cask: docker');
        expect(mockEndGroup).toHaveBeenCalled();
    });

    describe('retry logic', () => {
        it('retries on failure and succeeds on Nth attempt', async () => {
            mockExec
                .mockResolvedValueOnce(1) // first attempt fails
                .mockResolvedValueOnce(1) // second attempt fails
                .mockResolvedValue(0);    // third attempt succeeds

            const inputs = makeInputs({ brew: ['flaky-pkg'], retries: 5 });
            const promise = brewMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            // 3 calls: 2 failures + 1 success
            expect(mockExec).toHaveBeenCalledTimes(3);
        });

        it('throws when all retry attempts are exhausted', async () => {
            let callCount = 0;
            mockExec.mockImplementation(async () => {
                callCount++;
                if (callCount >= 2) {
                    throw new Error('brew install failed');
                }
                return 1;
            });

            const inputs = makeInputs({ brew: ['bad-pkg'], retries: 2 });
            const promise = brewMain(inputs);
            // Attach rejection handler before advancing timers to avoid unhandled rejection
            const expectation = expect(promise).rejects.toThrow('brew install failed');
            await jest.advanceTimersByTimeAsync(30000);
            await expectation;
            expect(callCount).toBe(2);
        });

        it('uses brewRetries when provided instead of shared retries', async () => {
            mockExec.mockResolvedValue(1);

            const inputs = makeInputs({ brew: ['cmake'], brewRetries: 3, retries: 10 });
            const promise = brewMain(inputs);
            await jest.advanceTimersByTimeAsync(60000);
            await promise;

            // Should retry brewRetries (3) times, not retries (10) times
            expect(mockExec).toHaveBeenCalledTimes(3);
        });

        it('falls back to shared retries when brewRetries is 0', async () => {
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({ brew: ['cmake'], brewRetries: 0, retries: 5 });
            await brewMain(inputs);

            // With retries=5, first call should have ignoreReturnCode: true
            expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.objectContaining({
                ignoreReturnCode: true,
                env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' })
            }));
        });

        it('uses ignoreReturnCode on all but last retry for formula', async () => {
            mockExec.mockResolvedValue(1); // Keep failing

            const inputs = makeInputs({ brew: ['cmake'], retries: 2 });
            const promise = brewMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            // Last attempt will not ignore return code and exec returns 1
            // The exec mock returns 1 but doesn't throw, so it completes
            await promise;

            // First call: ignoreReturnCode: true (i=0, retries=2, 0 !== 1)
            expect(mockExec).toHaveBeenNthCalledWith(1, 'brew', ['install', 'cmake'], expect.objectContaining({
                ignoreReturnCode: true,
                env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' })
            }));
            // Last call: ignoreReturnCode: false (i=1, retries=2, 1 !== 1 is false)
            expect(mockExec).toHaveBeenNthCalledWith(2, 'brew', ['install', 'cmake'], expect.objectContaining({
                ignoreReturnCode: false,
                env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' })
            }));
        });

        it('uses ignoreReturnCode on all but last retry for cask', async () => {
            mockExec.mockResolvedValue(1);

            const inputs = makeInputs({ brewCask: ['docker'], retries: 2 });
            const promise = brewMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockExec).toHaveBeenNthCalledWith(1, 'brew', ['install', '--cask', 'docker'], expect.objectContaining({
                ignoreReturnCode: true,
                env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' })
            }));
            expect(mockExec).toHaveBeenNthCalledWith(2, 'brew', ['install', '--cask', 'docker'], expect.objectContaining({
                ignoreReturnCode: false,
                env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' })
            }));
        });

        it('applies exponential backoff between retries', async () => {
            const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
            mockExec
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValue(0);

            const inputs = makeInputs({ brew: ['flaky-pkg'], retries: 4 });
            const promise = brewMain(inputs);
            await jest.advanceTimersByTimeAsync(60000);
            await promise;

            // Check setTimeout calls for backoff — find calls with 2000 and 4000
            const timeoutDelays = setTimeoutSpy.mock.calls.map(c => c[1]).filter(d => d && d >= 2000);
            expect(timeoutDelays).toContain(2000);
            expect(timeoutDelays).toContain(4000);

            setTimeoutSpy.mockRestore();
        });
    });

    describe('platform guards', () => {
        it('skips brew entirely when brew is not available', async () => {
            mockWhich.mockRejectedValue(new Error('not found'));
            Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

            const inputs = makeInputs({ brew: ['cmake'] });
            await brewMain(inputs);

            expect(mockExec).not.toHaveBeenCalled();
            expect(mockWarning).toHaveBeenCalledWith('brew is not available — skipping brew packages');
        });

        it('installs formulae on Linux when Linuxbrew is available', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            mockWhich.mockRejectedValue(new Error('not found'));
            mockExistsSync.mockReturnValue(true);

            const inputs = makeInputs({ brew: ['cmake'] });
            await brewMain(inputs);

            expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.any(Object));
        });

        it('installs both formulae and casks on macOS', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

            const inputs = makeInputs({ brew: ['cmake'], brewCask: ['docker'] });
            await brewMain(inputs);

            expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.any(Object));
            expect(mockExec).toHaveBeenCalledWith(
                'brew', ['install', '--cask', 'docker'], expect.any(Object)
            );
        });

        it('installs formulae but skips casks on Linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            mockWhich.mockRejectedValue(new Error('not found'));
            mockExistsSync.mockReturnValue(true);

            const inputs = makeInputs({ brew: ['cmake'], brewCask: ['docker'] });
            await brewMain(inputs);

            // Formula should be installed
            expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'cmake'], expect.any(Object));
            // Cask should be skipped
            const caskCalls = mockExec.mock.calls.filter(
                c => Array.isArray(c[1]) && c[1].includes('--cask')
            );
            expect(caskCalls).toHaveLength(0);
            expect(mockDebug).toHaveBeenCalledWith(
                'Skipping brew cask installs — casks are macOS-only (.app bundles)'
            );
        });
    });
});
