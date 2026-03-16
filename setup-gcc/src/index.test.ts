import * as path from 'path';
import { describePrettyErrors } from 'pretty-errors/test-helper';
import { ExpectedError } from 'pretty-errors';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    addPath: jest.fn(),
    exportVariable: jest.fn(),
    getInput: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    setTraceCommands: jest.fn(),
    traceCommands: false
}));

jest.mock('setup-program', () => ({
    findGCCVersions: jest.fn(),
    findProgramInPath: jest.fn(),
    findProgramInSystemPaths: jest.fn(),
    findProgramWithApt: jest.fn(),
    installProgramFromUrl: jest.fn(),
    isSudoRequired: jest.fn(),
    getCurrentUbuntuVersion: jest.fn()
}));

jest.mock('./gcc-download', () => ({
    downloadGccFromUrl: jest.fn()
}));

jest.mock('fs', () => ({
    existsSync: jest.fn()
}));

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as setup_program from 'setup-program';
import { downloadGccFromUrl } from './gcc-download';
import { main } from './index';
import type { Inputs } from './schema';

const mockFindGCCVersions = setup_program.findGCCVersions as jest.MockedFunction<typeof setup_program.findGCCVersions>;
const mockFindProgramInPath = setup_program.findProgramInPath as jest.MockedFunction<typeof setup_program.findProgramInPath>;
const mockFindProgramInSystemPaths = setup_program.findProgramInSystemPaths as jest.MockedFunction<typeof setup_program.findProgramInSystemPaths>;
const mockFindProgramWithApt = setup_program.findProgramWithApt as jest.MockedFunction<typeof setup_program.findProgramWithApt>;
const mockIsSudoRequired = setup_program.isSudoRequired as jest.MockedFunction<typeof setup_program.isSudoRequired>;
const mockDownloadGccFromUrl = downloadGccFromUrl as jest.MockedFunction<typeof downloadGccFromUrl>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

/**
 * Creates a default Inputs object for testing with optional overrides.
 *
 * @param overrides - Partial input values to override defaults
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        version: '*',
        path: [],
        checkLatest: false,
        updateEnvironment: true,
        ...overrides
    };
}

const nullResult = { outputVersion: null, outputPath: null };

describe('setup-gcc main', () => {
    const origPlatform = process.platform;
    const origEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        process.env = { ...origEnv };
        delete process.env['AGENT_TOOLSDIRECTORY'];

        mockFindGCCVersions.mockResolvedValue(['11.1.0', '11.2.0', '12.1.0']);
        mockFindProgramInPath.mockResolvedValue(nullResult);
        mockFindProgramInSystemPaths.mockResolvedValue(nullResult);
        mockFindProgramWithApt.mockResolvedValue(nullResult);
        mockDownloadGccFromUrl.mockResolvedValue(nullResult);
        mockExistsSync.mockReturnValue(false);
        mockIsSudoRequired.mockReturnValue(true);
        mockExec.mockResolvedValue(0);
        mockWhich.mockResolvedValue('');
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
        process.env = origEnv;
    });

    it('is exported', () => {
        expect(main).toBeDefined();
        expect(typeof main).toBe('function');
    });

    it('returns null paths when no gcc found anywhere', async () => {
        const result = await main(makeInputs());
        expect(result.outputPath).toBeNull();
        expect(result.cc).toBeNull();
        expect(result.cxx).toBeNull();
        expect(result.version).toBe('0.0.0');
    });

    it('throws ExpectedError on non-linux platforms', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        await expect(main(makeInputs())).rejects.toThrow(ExpectedError);
        await expect(main(makeInputs())).rejects.toThrow('This action is only supported on Linux');
    });

    it('sets AGENT_TOOLSDIRECTORY on darwin but throws ExpectedError', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        await expect(main(makeInputs())).rejects.toThrow(ExpectedError);
        expect(process.env['AGENT_TOOLSDIRECTORY']).toBe('/Users/runner/hostedtoolcache');
    });

    it('copies AGENT_TOOLSDIRECTORY to RUNNER_TOOL_CACHE', async () => {
        process.env['AGENT_TOOLSDIRECTORY'] = '/custom/tools';
        await main(makeInputs());
        expect(process.env['RUNNER_TOOL_CACHE']).toBe('/custom/tools');
    });

    it('returns early from user path search if found', async () => {
        mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs({ path: ['/usr/bin'] }));

        expect(result.outputPath).toBe('/usr/bin/g++-12');
        // Should NOT search system paths
        expect(mockFindProgramInSystemPaths).not.toHaveBeenCalled();
    });

    it('falls back to system paths when user path returns nothing', async () => {
        mockFindProgramInSystemPaths.mockResolvedValue({ outputVersion: '11.2.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        expect(mockFindProgramInSystemPaths).toHaveBeenCalled();
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('skips APT when version already found on linux', async () => {
        mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
        mockExistsSync.mockReturnValue(true);
        await main(makeInputs());

        // findProgramWithApt should NOT be called for actual package install
        // (it's only called for software-properties-common)
        expect(mockFindProgramWithApt).not.toHaveBeenCalledWith(
            expect.arrayContaining(['g++']),
            expect.anything(),
            expect.anything()
        );
    });

    it('throws ExpectedError on non-linux platform before reaching APT', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        await expect(main(makeInputs())).rejects.toThrow(ExpectedError);
        expect(mockFindProgramWithApt).not.toHaveBeenCalled();
    });

    it('searches APT with PPA when add-apt-repository is found (sudo)', async () => {
        mockIsSudoRequired.mockReturnValue(true);
        mockWhich.mockResolvedValue('/usr/bin/add-apt-repository');
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '11.3.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('sudo'),
            [],
            expect.objectContaining({ ignoreReturnCode: true })
        );
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('searches APT with PPA without sudo', async () => {
        mockIsSudoRequired.mockReturnValue(false);
        mockWhich.mockResolvedValue('/usr/bin/add-apt-repository');
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '11.3.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('add-apt-repository'),
            [],
            expect.objectContaining({ ignoreReturnCode: true })
        );
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('handles add-apt-repository not found', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '11.1.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        // Should still find GCC via APT
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('skips download when version found via APT', async () => {
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
        mockExistsSync.mockReturnValue(true);
        await main(makeInputs());

        expect(mockDownloadGccFromUrl).not.toHaveBeenCalled();
    });

    it('downloads from URL when APT fails', async () => {
        mockFindProgramWithApt.mockResolvedValue(nullResult);
        mockDownloadGccFromUrl.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/local/bin/gcc-12' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        expect(mockDownloadGccFromUrl).toHaveBeenCalled();
        expect(result.outputPath).toBe('/usr/local/bin/gcc-12');
    });

    describe('buildOutputs', () => {
        it('derives cxx from gcc path', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/gcc-12' });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());

            expect(result.cc).toBe('/usr/bin/gcc-12');
            expect(result.cxx).toBe(path.join('/usr/bin', 'g++-12'));
        });

        it('derives cc from g++ path', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());

            expect(result.cc).toBe(path.join('/usr/bin', 'gcc-12'));
            expect(result.cxx).toBe('/usr/bin/g++-12');
        });

        it('falls back to outputPath when cc does not exist', async () => {
            const expectedCc = path.join('/usr/bin', 'gcc-12');
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockImplementation((p) => {
                return String(p) !== expectedCc;
            });
            const result = await main(makeInputs());

            expect(result.cc).toBe('/usr/bin/g++-12');
        });

        it('falls back to outputPath when cxx does not exist', async () => {
            const expectedCxx = path.join('/usr/bin', 'g++-12');
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/gcc-12' });
            mockExistsSync.mockImplementation((p) => {
                return String(p) !== expectedCxx;
            });
            const result = await main(makeInputs());

            // cxx doesn't exist, and it looks like gcc, so tryInstallGPlusPlus runs
            // Since the install won't actually find g++, it falls back
            expect(result.cc).toBe('/usr/bin/gcc-12');
        });

        it('adds bindir to PATH when updateEnvironment is true', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ updateEnvironment: true }));

            expect(core.addPath).toHaveBeenCalledWith('/usr/bin');
        });

        it('does not add bindir to PATH when updateEnvironment is false', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ updateEnvironment: false }));

            expect(core.addPath).not.toHaveBeenCalled();
        });

        it('parses semver version components', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.3.1', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());

            expect(result.version).toBe('12.3.1');
            expect(result.versionMajor).toBe(12);
            expect(result.versionMinor).toBe(3);
            expect(result.versionPatch).toBe(1);
        });

        it('sets bindir and dir from output path', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/local/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());

            expect(result.bindir).toBe('/usr/local/bin');
            expect(result.dir).toBe('/usr/local');
        });
    });

    describe('tryInstallGPlusPlus', () => {
        it('installs g++ package with sudo when cxx looks like gcc', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/gcc-12' });
            // gcc-12 exists but g++-12 does not — cxx falls back to gcc-12 (looks like gcc)
            // After apt install, /usr/bin/g++-12 exists
            let installCalled = false;
            mockExec.mockImplementation(async (...args) => {
                const cmd = args[0] as string;
                const cmdArgs = args[1] as string[] | undefined;
                if (cmd === 'sudo' && cmdArgs?.includes('install')) {
                    installCalled = true;
                }
                return 0;
            });
            mockExistsSync.mockImplementation((p) => {
                const s = String(p);
                if (s === '/usr/bin/gcc-12') return true;
                if (s === '/usr/bin/g++-12' && installCalled) return true;
                return false;
            });
            mockIsSudoRequired.mockReturnValue(true);
            const result = await main(makeInputs());

            expect(mockExec).toHaveBeenCalledWith(
                'sudo', ['-n', 'apt-get', 'update'],
                expect.any(Object)
            );
            expect(mockExec).toHaveBeenCalledWith(
                'sudo', ['-n', 'apt-get', 'install', '-y', 'g++-12'],
                expect.any(Object)
            );
            expect(result.cxx).toBe('/usr/bin/g++-12');
        });

        it('installs g++ package without sudo', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/gcc-12' });
            let installCalled = false;
            mockExec.mockImplementation(async (...args) => {
                const cmd = args[0] as string;
                const cmdArgs = args[1] as string[] | undefined;
                if (cmd === 'apt-get' && cmdArgs?.includes('install')) {
                    installCalled = true;
                }
                return 0;
            });
            mockExistsSync.mockImplementation((p) => {
                const s = String(p);
                if (s === '/usr/bin/gcc-12') return true;
                if (s === '/usr/bin/g++-12' && installCalled) return true;
                return false;
            });
            mockIsSudoRequired.mockReturnValue(false);
            const result = await main(makeInputs());

            expect(mockExec).toHaveBeenCalledWith(
                'apt-get', ['update'],
                expect.any(Object)
            );
            expect(mockExec).toHaveBeenCalledWith(
                'apt-get', ['install', '-y', 'g++-12'],
                expect.any(Object)
            );
            expect(result.cxx).toBe('/usr/bin/g++-12');
        });

        it('uses generic g++ package when version parse fails', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: 'unknown', outputPath: '/usr/bin/gcc' });
            mockExistsSync.mockImplementation((p) => {
                const s = String(p);
                if (s === '/usr/bin/gcc') return true;
                return false;
            });
            mockWhich.mockImplementation(async (cmd: string) => {
                if (cmd === 'add-apt-repository') throw new Error('not found');
                if (cmd === 'g++') return '/usr/bin/g++';
                return '';
            });
            await main(makeInputs());

            expect(mockExec).toHaveBeenCalledWith(
                'sudo', expect.arrayContaining(['g++']),
                expect.any(Object)
            );
        });

        it('catches errors during g++ installation', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/gcc-12' });
            mockExistsSync.mockImplementation((p) => {
                if (String(p) === '/usr/bin/gcc-12') return true;
                return false;
            });
            mockExec.mockRejectedValueOnce(new Error('exec failed'));
            // Still should not throw
            const result = await main(makeInputs());
            expect(result.cc).toBe('/usr/bin/gcc-12');
        });
    });
});

describePrettyErrors('gcc boom', 'Setup GCC failed');
