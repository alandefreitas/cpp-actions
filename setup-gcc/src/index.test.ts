import * as path from 'path';
import { describePrettyErrors } from 'pretty-errors/test-helper';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
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
    installProgramFromUrl: jest.fn(),
    isSudoRequired: jest.fn(),
    getCurrentUbuntuVersion: jest.fn(),
    findLlvmSymbolizer: jest.fn(),
    exportSymbolizerEnvVars: jest.fn(),
    loadWindowsMsvcDefaults: jest.fn()
}));

jest.mock('package-install', () => ({
    findProgramWithBrew: jest.fn(),
    installProgramWithBrew: jest.fn(),
    findProgramWithChoco: jest.fn(),
    installProgramWithChoco: jest.fn(),
    findProgramWithApt: jest.fn()
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
import * as package_install from 'package-install';
import { downloadGccFromUrl } from './gcc-download';
import { main } from './index';
import type { Inputs } from './schema';

const mockFindGCCVersions = setup_program.findGCCVersions as jest.MockedFunction<typeof setup_program.findGCCVersions>;
const mockFindProgramInPath = setup_program.findProgramInPath as jest.MockedFunction<typeof setup_program.findProgramInPath>;
const mockFindProgramInSystemPaths = setup_program.findProgramInSystemPaths as jest.MockedFunction<typeof setup_program.findProgramInSystemPaths>;
const mockFindProgramWithApt = package_install.findProgramWithApt as jest.MockedFunction<typeof package_install.findProgramWithApt>;
const mockIsSudoRequired = setup_program.isSudoRequired as jest.MockedFunction<typeof setup_program.isSudoRequired>;
const mockDownloadGccFromUrl = downloadGccFromUrl as jest.MockedFunction<typeof downloadGccFromUrl>;
const mockFindLlvmSymbolizer = setup_program.findLlvmSymbolizer as jest.MockedFunction<typeof setup_program.findLlvmSymbolizer>;
const mockExportSymbolizerEnvVars = setup_program.exportSymbolizerEnvVars as jest.MockedFunction<typeof setup_program.exportSymbolizerEnvVars>;
const mockFindProgramWithBrew = package_install.findProgramWithBrew as jest.MockedFunction<typeof package_install.findProgramWithBrew>;
const mockInstallProgramWithBrew = package_install.installProgramWithBrew as jest.MockedFunction<typeof package_install.installProgramWithBrew>;
const mockFindProgramWithChoco = package_install.findProgramWithChoco as jest.MockedFunction<typeof package_install.findProgramWithChoco>;
const mockInstallProgramWithChoco = package_install.installProgramWithChoco as jest.MockedFunction<typeof package_install.installProgramWithChoco>;
const mockLoadWindowsMsvcDefaults = setup_program.loadWindowsMsvcDefaults as jest.MockedFunction<typeof setup_program.loadWindowsMsvcDefaults>;
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
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        mockFindProgramWithBrew.mockResolvedValue(null);
        mockInstallProgramWithBrew.mockResolvedValue(null);
        mockFindProgramWithChoco.mockResolvedValue(null);
        mockInstallProgramWithChoco.mockResolvedValue(null);
        mockLoadWindowsMsvcDefaults.mockReturnValue({
            generated: '2026-03-17T00:00:00.000Z',
            source: 'test',
            runners: {
                'windows-2022': {
                    msvc_versions: [],
                    mingw_version: '14',
                    llvm_version: '20'
                }
            },
            installable_mingw: ['8.1.0', '13.2.0', '14.2.0', '15.2.0'],
            installable_llvm: ['18.1.8', '20.1.8']
        } as ReturnType<typeof setup_program.loadWindowsMsvcDefaults>);
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

    it('does not throw on darwin platform', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const result = await main(makeInputs());
        expect(result.outputPath).toBeNull();
        expect(process.env['AGENT_TOOLSDIRECTORY']).toBe('/Users/runner/hostedtoolcache');
    });

    it('does not throw on win32 platform', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const result = await main(makeInputs());
        expect(result.outputPath).toBeNull();
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

    it('skips APT on non-linux platforms', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        await main(makeInputs());
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
            'sudo',
            ['-n', 'add-apt-repository', '-y', 'ppa:ubuntu-toolchain-r/ppa'],
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
            'add-apt-repository',
            ['-y', 'ppa:ubuntu-toolchain-r/ppa'],
            expect.objectContaining({ ignoreReturnCode: true })
        );
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('warns when add-apt-repository fails with non-zero exit code', async () => {
        mockIsSudoRequired.mockReturnValue(true);
        mockWhich.mockResolvedValue('/usr/bin/add-apt-repository');
        mockExec.mockResolvedValue(1);
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '11.3.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        const result = await main(makeInputs());

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('add-apt-repository failed')
        );
        // Should still continue and find GCC via APT
        expect(result.outputPath).toBe('/usr/bin/g++-11');
    });

    it('does not warn when add-apt-repository succeeds', async () => {
        mockIsSudoRequired.mockReturnValue(false);
        mockWhich.mockResolvedValue('/usr/bin/add-apt-repository');
        mockExec.mockResolvedValue(0);
        mockFindProgramWithApt.mockResolvedValueOnce(nullResult); // software-properties-common
        mockFindProgramWithApt.mockResolvedValueOnce({ outputVersion: '11.3.0', outputPath: '/usr/bin/g++-11' });
        mockExistsSync.mockReturnValue(true);
        await main(makeInputs());

        expect(core.warning).not.toHaveBeenCalled();
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
    describe('installSymbolizer', () => {
        it('exports symbolizer env vars when symbolizer is found', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            mockFindLlvmSymbolizer.mockResolvedValue('/usr/bin/llvm-symbolizer');

            await main(makeInputs());

            expect(mockFindLlvmSymbolizer).toHaveBeenCalledWith(0);
            expect(mockExportSymbolizerEnvVars).toHaveBeenCalledWith('/usr/bin/llvm-symbolizer');
        });

        it('does not export env vars when symbolizer is not found', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            mockFindLlvmSymbolizer.mockResolvedValue(null);

            await main(makeInputs());

            expect(mockExportSymbolizerEnvVars).not.toHaveBeenCalled();
        });

        it('skips symbolizer when updateEnvironment is false', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);

            await main(makeInputs({ updateEnvironment: false }));

            expect(mockFindLlvmSymbolizer).not.toHaveBeenCalled();
        });

        it('skips symbolizer when no compiler found', async () => {
            await main(makeInputs());
            expect(mockFindLlvmSymbolizer).not.toHaveBeenCalled();
        });

        it('attempts APT install when symbolizer not found on Linux', async () => {
            mockFindProgramInPath.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/bin/g++-12' });
            mockExistsSync.mockReturnValue(true);
            mockFindLlvmSymbolizer
                .mockResolvedValueOnce(null)       // initial search
                .mockResolvedValueOnce('/usr/bin/llvm-symbolizer'); // after apt install

            await main(makeInputs());

            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('apt-get install -y llvm'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
            expect(mockExportSymbolizerEnvVars).toHaveBeenCalledWith('/usr/bin/llvm-symbolizer');
        });
    });

    describe('searchBrew (macOS)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        });

        it('finds GCC via Homebrew when already installed', async () => {
            mockFindProgramWithBrew.mockResolvedValue({
                path: '/opt/homebrew/bin/gcc-14',
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14' }));

            expect(mockFindProgramWithBrew).toHaveBeenCalledWith('gcc@14', 'gcc-14');
            expect(result.outputPath).toBe('/opt/homebrew/bin/gcc-14');
            expect(result.version).toBe('14.2.0');
            expect(result.cc).toBe('/opt/homebrew/bin/gcc-14');
            expect(result.cxx).toBe(path.join('/opt/homebrew/bin', 'g++-14'));
        });

        it('installs GCC via Homebrew when not found', async () => {
            mockFindProgramWithBrew
                .mockResolvedValueOnce(null)  // initial search
                .mockResolvedValueOnce({      // after install
                    path: '/opt/homebrew/bin/gcc-14',
                    version: '14.2.0'
                });
            mockInstallProgramWithBrew.mockResolvedValue('/opt/homebrew/opt/gcc@14');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14' }));

            expect(mockInstallProgramWithBrew).toHaveBeenCalledWith('gcc@14');
            expect(result.outputPath).toBe('/opt/homebrew/bin/gcc-14');
            expect(result.version).toBe('14.2.0');
        });

        it('returns null when Homebrew install fails', async () => {
            mockFindProgramWithBrew.mockResolvedValue(null);
            mockInstallProgramWithBrew.mockResolvedValue(null);
            const result = await main(makeInputs({ version: '14' }));

            expect(result.outputPath).toBeNull();
        });

        it('skips Homebrew when version is wildcard', async () => {
            const result = await main(makeInputs({ version: '*' }));

            expect(mockFindProgramWithBrew).not.toHaveBeenCalled();
            expect(result.outputPath).toBeNull();
        });

        it('skips Homebrew when already found in user paths', async () => {
            mockFindProgramInPath.mockResolvedValue({
                outputVersion: '14.2.0',
                outputPath: '/custom/bin/gcc-14'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14', path: ['/custom/bin'] }));

            expect(mockFindProgramWithBrew).not.toHaveBeenCalled();
            expect(result.outputPath).toBe('/custom/bin/gcc-14');
        });

        it('does not call APT or download on macOS', async () => {
            mockFindProgramWithBrew.mockResolvedValue({
                path: '/opt/homebrew/bin/gcc-14',
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '14' }));

            expect(mockFindProgramWithApt).not.toHaveBeenCalled();
            expect(mockDownloadGccFromUrl).not.toHaveBeenCalled();
        });

        it('handles semver version input correctly', async () => {
            mockFindProgramWithBrew.mockResolvedValue({
                path: '/opt/homebrew/bin/gcc-15',
                version: '15.1.0'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '15.1.0' }));

            expect(mockFindProgramWithBrew).toHaveBeenCalledWith('gcc@15', 'gcc-15');
            expect(result.version).toBe('15.1.0');
        });
    });
    describe('searchChoco (Windows)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        });

        it('finds MinGW GCC in known install paths', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\mingw64\\bin', 'gcc.exe'),
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14' }));

            expect(mockFindProgramWithChoco).toHaveBeenCalledWith(
                'mingw', 'gcc.exe',
                ['C:\\mingw64\\bin', 'C:\\ProgramData\\mingw64\\bin']
            );
            expect(result.outputPath).toBe(path.join('C:\\mingw64\\bin', 'gcc.exe'));
            expect(result.version).toBe('14.2.0');
        });

        it('installs MinGW GCC via Chocolatey when not found', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce(null)  // initial search
                .mockResolvedValueOnce({      // after install
                    path: path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe'),
                    version: '14.2.0'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\ProgramData\\mingw64\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'mingw', '14.2.0', 'C:\\ProgramData\\mingw64\\bin'
            );
            expect(result.outputPath).toBe(path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe'));
            expect(result.version).toBe('14.2.0');
        });

        it('installs with version from data file when major matches', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    path: path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe'),
                    version: '15.2.0'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\ProgramData\\mingw64\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '15' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'mingw', '15.2.0', 'C:\\ProgramData\\mingw64\\bin'
            );
            expect(result.version).toBe('15.2.0');
        });

        it('skips wrong version and installs correct one', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce({      // found but wrong major
                    path: path.join('C:\\mingw64\\bin', 'gcc.exe'),
                    version: '13.2.0'
                })
                .mockResolvedValueOnce({      // after install
                    path: path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe'),
                    version: '14.2.0'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\ProgramData\\mingw64\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'mingw', '14.2.0', 'C:\\ProgramData\\mingw64\\bin'
            );
            expect(result.version).toBe('14.2.0');
        });

        it('accepts found version when no specific version requested (wildcard)', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\mingw64\\bin', 'gcc.exe'),
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '*' }));

            expect(result.outputPath).toBe(path.join('C:\\mingw64\\bin', 'gcc.exe'));
            expect(result.version).toBe('14.2.0');
        });

        it('returns null when Chocolatey install fails', async () => {
            mockFindProgramWithChoco.mockResolvedValue(null);
            mockInstallProgramWithChoco.mockResolvedValue(null);
            const result = await main(makeInputs({ version: '14' }));

            expect(result.outputPath).toBeNull();
        });

        it('skips Chocolatey when already found in user paths', async () => {
            mockFindProgramInPath.mockResolvedValue({
                outputVersion: '14.2.0',
                outputPath: path.join('C:\\custom\\bin', 'gcc.exe')
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14', path: ['C:\\custom\\bin'] }));

            expect(mockFindProgramWithChoco).not.toHaveBeenCalled();
            expect(result.outputPath).toBe(path.join('C:\\custom\\bin', 'gcc.exe'));
        });

        it('does not call APT or download on Windows', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\mingw64\\bin', 'gcc.exe'),
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '14' }));

            expect(mockFindProgramWithApt).not.toHaveBeenCalled();
            expect(mockDownloadGccFromUrl).not.toHaveBeenCalled();
        });

        it('does not install when wildcard version and nothing found', async () => {
            mockFindProgramWithChoco.mockResolvedValue(null);
            const result = await main(makeInputs({ version: '*' }));

            expect(mockInstallProgramWithChoco).not.toHaveBeenCalled();
            expect(result.outputPath).toBeNull();
        });

        it('handles semver version input correctly', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\mingw64\\bin', 'gcc.exe'),
                version: '14.2.0'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '14.2.0' }));

            expect(result.version).toBe('14.2.0');
        });
    });
});

describePrettyErrors('gcc boom', 'Setup GCC failed');
