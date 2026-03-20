import { chocoMain, isRateLimitError, addJitter } from './choco-install';
import { type Inputs } from './schema';
import * as exec from '@actions/exec';
import * as core from '@actions/core';

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

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>;
const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockStartGroup = core.startGroup as jest.MockedFunction<typeof core.startGroup>;
const mockEndGroup = core.endGroup as jest.MockedFunction<typeof core.endGroup>;

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

describe('isRateLimitError', () => {
    it('detects HTTP 429 status code', () => {
        expect(isRateLimitError('ERROR: HTTP 429 response')).toBe(true);
    });

    it('detects "rate limit" text', () => {
        expect(isRateLimitError('Rate Limit exceeded for this IP')).toBe(true);
    });

    it('detects "too many requests" text', () => {
        expect(isRateLimitError('Too Many Requests - please slow down')).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isRateLimitError('RATE LIMIT')).toBe(true);
        expect(isRateLimitError('too many requests')).toBe(true);
    });

    it('returns false for normal errors', () => {
        expect(isRateLimitError('package not found')).toBe(false);
        expect(isRateLimitError('network timeout')).toBe(false);
    });
});

describe('addJitter', () => {
    it('returns a value between baseDelay and 1.5x baseDelay', () => {
        // Run multiple times to test randomness range
        for (let i = 0; i < 100; i++) {
            const result = addJitter(2000);
            expect(result).toBeGreaterThanOrEqual(2000);
            expect(result).toBeLessThanOrEqual(3000);
        }
    });

    it('returns 0 for zero baseDelay', () => {
        expect(addJitter(0)).toBe(0);
    });
});

describe('chocoMain', () => {
    const origPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        mockExec.mockResolvedValue(0);
    });

    afterEach(() => {
        jest.useRealTimers();
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
    });

    it('does nothing when choco list is empty', async () => {
        const inputs = makeInputs({ choco: [] });
        await chocoMain(inputs);

        expect(mockExec).not.toHaveBeenCalled();
        expect(mockStartGroup).not.toHaveBeenCalled();
    });

    it('skips on non-Windows platform with debug message', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        const inputs = makeInputs({ choco: ['cmake'] });
        await chocoMain(inputs);

        expect(mockDebug).toHaveBeenCalledWith('Skipping choco installs — Chocolatey is Windows-only');
        expect(mockExec).not.toHaveBeenCalled();
    });

    it('skips on macOS with debug message', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ choco: ['cmake'] });
        await chocoMain(inputs);

        expect(mockDebug).toHaveBeenCalledWith('Skipping choco installs — Chocolatey is Windows-only');
        expect(mockExec).not.toHaveBeenCalled();
    });

    it('installs a single package with -y and --no-progress flags', async () => {
        const inputs = makeInputs({ choco: ['cmake'] });
        await chocoMain(inputs);

        expect(mockExec).toHaveBeenCalledWith(
            'choco',
            ['install', 'cmake', '-y', '--no-progress'],
            expect.any(Object)
        );
    });

    it('installs multiple packages', async () => {
        const inputs = makeInputs({ choco: ['cmake', 'ninja', 'mingw'] });
        await chocoMain(inputs);

        expect(mockExec).toHaveBeenCalledWith(
            'choco', ['install', 'cmake', '-y', '--no-progress'], expect.any(Object)
        );
        expect(mockExec).toHaveBeenCalledWith(
            'choco', ['install', 'ninja', '-y', '--no-progress'], expect.any(Object)
        );
        expect(mockExec).toHaveBeenCalledWith(
            'choco', ['install', 'mingw', '-y', '--no-progress'], expect.any(Object)
        );
    });

    it('supports --version=X.Y.Z syntax', async () => {
        const inputs = makeInputs({ choco: ['cmake --version=3.28.0'] });
        await chocoMain(inputs);

        expect(mockExec).toHaveBeenCalledWith(
            'choco',
            ['install', 'cmake', '--version=3.28.0', '-y', '--no-progress'],
            expect.any(Object)
        );
    });

    it('uses startGroup/endGroup for each package', async () => {
        const inputs = makeInputs({ choco: ['cmake'] });
        await chocoMain(inputs);

        expect(mockStartGroup).toHaveBeenCalledWith('🍫 Install choco package: cmake');
        expect(mockEndGroup).toHaveBeenCalled();
    });

    describe('retry logic', () => {
        it('retries on failure and succeeds on Nth attempt', async () => {
            mockExec
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValue(0);

            const inputs = makeInputs({ choco: ['flaky-pkg'], retries: 5 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(60000);
            await promise;

            expect(mockExec).toHaveBeenCalledTimes(3);
        });

        it('throws when all retry attempts are exhausted', async () => {
            let callCount = 0;
            mockExec.mockImplementation(async () => {
                callCount++;
                if (callCount >= 5) {
                    throw new Error('choco install failed');
                }
                return 1;
            });

            const inputs = makeInputs({ choco: ['bad-pkg'], retries: 5 });
            const promise = chocoMain(inputs);
            const expectation = expect(promise).rejects.toThrow('choco install failed');
            await jest.advanceTimersByTimeAsync(120000);
            await expectation;
            expect(callCount).toBe(5);
        });

        it('uses chocoRetries when provided instead of shared retries', async () => {
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({ choco: ['cmake'], chocoRetries: 3, retries: 10 });
            await chocoMain(inputs);

            // ignoreReturnCode should be based on chocoRetries (3), not retries (10)
            expect(mockExec).toHaveBeenCalledWith(
                'choco',
                ['install', 'cmake', '-y', '--no-progress'],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('falls back to shared retries when chocoRetries is 0', async () => {
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({ choco: ['cmake'], chocoRetries: 0, retries: 5 });
            await chocoMain(inputs);

            // With retries=5, first call should have ignoreReturnCode: true
            expect(mockExec).toHaveBeenCalledWith(
                'choco',
                ['install', 'cmake', '-y', '--no-progress'],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('uses ignoreReturnCode on all but last retry', async () => {
            mockExec.mockResolvedValue(1);

            const inputs = makeInputs({ choco: ['cmake'], retries: 2 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            // First call: ignoreReturnCode: true (i=0, not last)
            expect(mockExec).toHaveBeenNthCalledWith(
                1, 'choco', ['install', 'cmake', '-y', '--no-progress'],
                expect.objectContaining({ ignoreReturnCode: true })
            );
            // Last call: ignoreReturnCode: false (i=1, last attempt)
            expect(mockExec).toHaveBeenNthCalledWith(
                2, 'choco', ['install', 'cmake', '-y', '--no-progress'],
                expect.objectContaining({ ignoreReturnCode: false })
            );
        });

        it('logs rate limit warning when detected in stderr', async () => {
            mockExec.mockImplementation(async (_cmd, _args, options) => {
                if (options?.listeners?.stderr) {
                    options.listeners.stderr(Buffer.from('HTTP 429 Too Many Requests'));
                }
                return 1;
            });

            const inputs = makeInputs({ choco: ['cmake'], retries: 2 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockExec).toHaveBeenCalledTimes(2);
            expect(mockWarning).toHaveBeenCalledWith(
                expect.stringContaining('Chocolatey rate limit detected')
            );
            expect(mockWarning).toHaveBeenCalledWith(
                expect.stringContaining('~20 downloads/min per IP')
            );
        });

        it('does not log rate limit warning for non-rate-limit errors', async () => {
            mockExec.mockImplementation(async (_cmd, _args, options) => {
                if (options?.listeners?.stderr) {
                    options.listeners.stderr(Buffer.from('package not found'));
                }
                return 1;
            });

            const inputs = makeInputs({ choco: ['cmake'], retries: 2 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockWarning).not.toHaveBeenCalled();
        });

        it('applies exponential backoff with jitter between retries', async () => {
            const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
            mockExec
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValue(0);

            const inputs = makeInputs({ choco: ['flaky-pkg'], retries: 4 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(60000);
            await promise;

            // Check setTimeout calls for backoff — should be >= 2000 (base) with jitter
            const timeoutDelays = setTimeoutSpy.mock.calls
                .map(c => c[1])
                .filter((d): d is number => d !== undefined && d >= 2000);
            // First retry: base 2000 + jitter (2000-3000)
            expect(timeoutDelays[0]).toBeGreaterThanOrEqual(2000);
            expect(timeoutDelays[0]).toBeLessThanOrEqual(3000);
            // Second retry: base 4000 + jitter (4000-6000)
            expect(timeoutDelays[1]).toBeGreaterThanOrEqual(4000);
            expect(timeoutDelays[1]).toBeLessThanOrEqual(6000);

            setTimeoutSpy.mockRestore();
        });

        it('logs retry info message with formatted time', async () => {
            mockExec.mockResolvedValueOnce(1).mockResolvedValue(0);

            const inputs = makeInputs({ choco: ['cmake'], retries: 3 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockInfo).toHaveBeenCalledWith(
                expect.stringMatching(/Failed to install choco package cmake, retrying in/)
            );
        });

        it('captures stderr across retry attempts', async () => {
            let callIndex = 0;
            mockExec.mockImplementation(async (_cmd, _args, options) => {
                callIndex++;
                if (callIndex === 1 && options?.listeners?.stderr) {
                    options.listeners.stderr(Buffer.from('429 rate limit'));
                }
                if (callIndex === 2) {
                    return 0;
                }
                return 1;
            });

            const inputs = makeInputs({ choco: ['cmake'], retries: 3 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockWarning).toHaveBeenCalledWith(
                expect.stringContaining('Chocolatey rate limit detected')
            );
        });

        it('detects rate limit from stdout', async () => {
            let callIndex = 0;
            mockExec.mockImplementation(async (_cmd, _args, options) => {
                callIndex++;
                if (callIndex === 1 && options?.listeners?.stdout) {
                    options.listeners.stdout(Buffer.from('Too Many Requests'));
                }
                if (callIndex === 2) {
                    return 0;
                }
                return 1;
            });

            const inputs = makeInputs({ choco: ['cmake'], retries: 3 });
            const promise = chocoMain(inputs);
            await jest.advanceTimersByTimeAsync(30000);
            await promise;

            expect(mockWarning).toHaveBeenCalledWith(
                expect.stringContaining('Chocolatey rate limit detected')
            );
        });
    });
});
