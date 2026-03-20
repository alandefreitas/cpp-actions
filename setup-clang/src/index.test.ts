import * as path from 'path';
import { main } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';
import { ExpectedError } from 'pretty-errors';
import type { Inputs } from './schema';

// ─── Mocks ──────────────────────────────────────────────────────────

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

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn().mockResolvedValue('/tmp/key.gpg')
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn().mockResolvedValue(0),
    getExecOutput: jest.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('semver', () => {
    const actual = jest.requireActual('semver');
    return {
        ...actual,
        satisfies: actual.satisfies,
        parse: actual.parse,
        maxSatisfying: actual.maxSatisfying,
        minSatisfying: actual.minSatisfying,
        compare: actual.compare
    };
});

jest.mock('package-install', () => ({
    findProgramWithApt: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null, installedPackage: null }),
    findProgramWithBrew: jest.fn().mockResolvedValue(null),
    installProgramWithBrew: jest.fn().mockResolvedValue(null),
    findProgramWithChoco: jest.fn().mockResolvedValue(null),
    installProgramWithChoco: jest.fn().mockResolvedValue(null)
}));

jest.mock('setup-program', () => ({
    findClangVersions: jest.fn().mockResolvedValue(['14.0.0', '15.0.0', '16.0.0']),
    findProgramInPath: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null }),
    findProgramInSystemPaths: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null }),
    loadWindowsMsvcDefaults: jest.fn(),
    findLlvmSymbolizer: jest.fn().mockResolvedValue(null),
    getCurrentUbuntuName: jest.fn().mockReturnValue('jammy'),
    getCurrentUbuntuVersion: jest.fn().mockReturnValue('22.04'),
    isSudoRequired: jest.fn().mockReturnValue(false),
    ensureSudoIsAvailable: jest.fn().mockResolvedValue(undefined),
    urlExists: jest.fn().mockResolvedValue(true),
    installProgramFromUrl: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null }),
    exportSymbolizerEnvVars: jest.fn()
}));

jest.mock('./download', () => ({
    clangDownloadCandidates: jest.fn().mockReturnValue({
        versionCandidates: ['15.0.0'],
        ubuntuVersions: ['22.04']
    }),
    installProgramFromClangUrls: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null })
}));

jest.mock('./companion-packages', () => ({
    installCompanionPackages: jest.fn().mockResolvedValue({ symbolizerPath: null })
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn().mockReturnValue(true)
}));

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as setup_program from 'setup-program';
import * as package_install from 'package-install';
import * as download from './download';
import * as companionPkg from './companion-packages';
import * as fs from 'fs';

const mockCore = core as jest.Mocked<typeof core>;
const mockIo = io as jest.Mocked<typeof io>;
const mockExec = exec as jest.Mocked<typeof exec>;
const mockTc = tc as jest.Mocked<typeof tc>;
const mockSetupProgram = setup_program as jest.Mocked<typeof setup_program>;
const mockPackageInstall = package_install as jest.Mocked<typeof package_install>;
const mockDownload = download as jest.Mocked<typeof download>;
const mockCompanionPkg = companionPkg as jest.Mocked<typeof companionPkg>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockFindProgramWithChoco = package_install.findProgramWithChoco as jest.MockedFunction<typeof package_install.findProgramWithChoco>;
const mockInstallProgramWithChoco = package_install.installProgramWithChoco as jest.MockedFunction<typeof package_install.installProgramWithChoco>;
const mockLoadWindowsMsvcDefaults = setup_program.loadWindowsMsvcDefaults as jest.MockedFunction<typeof setup_program.loadWindowsMsvcDefaults>;

// ─── Helpers ────────────────────────────────────────────────────────

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        version: '>=15.0.0',
        path: [],
        checkLatest: true,
        updateEnvironment: true,
        ...overrides
    };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('setup-clang', () => {
    const originalPlatform = process.platform;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        process.env = { ...originalEnv };
        mockFindProgramWithChoco.mockResolvedValue(null);
        mockInstallProgramWithChoco.mockResolvedValue(null);
        mockLoadWindowsMsvcDefaults.mockReturnValue({
            generated: '2026-03-17T00:00:00.000Z',
            source: 'test',
            runners: {
                'windows-2022': {
                    default_msvc: { name: '', version: '' },
                    msvc_versions: [],
                    mingw_version: '14',
                    llvm_version: '20'
                },
                'windows-2025': {
                    default_msvc: { name: '', version: '' },
                    msvc_versions: [],
                    mingw_version: '15',
                    llvm_version: '20'
                }
            },
            installable_mingw: ['14.2.0', '15.2.0'],
            installable_llvm: ['18.1.8', '20.1.8']
        } as ReturnType<typeof setup_program.loadWindowsMsvcDefaults>);
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        process.env = originalEnv;
    });

    test('main function is exported', () => {
        expect(main).toBeDefined();
        expect(typeof main).toBe('function');
    });

    // ─── discoverVersions ─────────────────────────────────────────

    describe('discoverVersions', () => {
        it('calls findClangVersions', async () => {
            await main(makeInputs());
            expect(mockSetupProgram.findClangVersions).toHaveBeenCalled();
        });

        it('sets AGENT_TOOLSDIRECTORY on darwin', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
            await main(makeInputs());
            expect(process.env['AGENT_TOOLSDIRECTORY']).toBe('/Users/runner/hostedtoolcache');
        });

        it('copies AGENT_TOOLSDIRECTORY to RUNNER_TOOL_CACHE when set', async () => {
            process.env['AGENT_TOOLSDIRECTORY'] = '/custom/tools';
            await main(makeInputs());
            expect(process.env['RUNNER_TOOL_CACHE']).toBe('/custom/tools');
        });

        it('does not throw on win32 platform', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const result = await main(makeInputs());
            expect(result).toBeDefined();
        });

        it('throws ExpectedError on unsupported platforms', async () => {
            Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
            await expect(main(makeInputs())).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs())).rejects.toThrow('This action is not supported on freebsd');
        });
    });

    // ─── searchUserPaths ──────────────────────────────────────────

    describe('searchUserPaths', () => {
        it('skips search when path is empty', async () => {
            await main(makeInputs({ path: [] }));
            expect(mockSetupProgram.findProgramInPath).not.toHaveBeenCalled();
        });

        it('searches user-provided paths', async () => {
            mockSetupProgram.findProgramInPath.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/custom/bin/clang++'
            });
            await main(makeInputs({ path: ['/custom/bin/clang++'] }));
            expect(mockSetupProgram.findProgramInPath).toHaveBeenCalledWith(
                ['/custom/bin/clang++'],
                '>=15.0.0',
                true
            );
        });
    });

    // ─── searchSystemPaths ────────────────────────────────────────

    describe('searchSystemPaths', () => {
        it('searches system paths when no user path found', async () => {
            await main(makeInputs());
            expect(mockSetupProgram.findProgramInSystemPaths).toHaveBeenCalled();
        });

        it('skips system search when user path found', async () => {
            mockSetupProgram.findProgramInPath.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/custom/bin/clang++'
            });
            await main(makeInputs({ path: ['/custom/bin/clang++'] }));
            expect(mockSetupProgram.findProgramInSystemPaths).not.toHaveBeenCalled();
        });
    });

    // ─── searchApt ────────────────────────────────────────────────

    describe('searchApt', () => {
        it('skips APT when version already found on linux', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15'
            });
            await main(makeInputs());
            // findProgramWithApt should NOT have been called
            expect(mockPackageInstall.findProgramWithApt).not.toHaveBeenCalled();
        });

        it('skips APT on non-linux platforms', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
            await main(makeInputs());
            expect(mockPackageInstall.findProgramWithApt).not.toHaveBeenCalled();
        });

        it('adds APT repositories when ubuntu name available', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            // Should call findProgramWithApt for gnupg
            expect(mockPackageInstall.findProgramWithApt).toHaveBeenCalledWith(['gnupg'], '*', true);
        });

        it('downloads GPG key and installs with gpg --dearmor', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockTc.downloadTool).toHaveBeenCalledWith('https://apt.llvm.org/llvm-snapshot.gpg.key');
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('gpg --dearmor'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('uses sudo for gpg --dearmor when sudo is required', async () => {
            mockSetupProgram.isSudoRequired.mockReturnValue(true);
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringMatching(/^sudo -n gpg --dearmor/),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('adds repository via sources.list.d file', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('tee /etc/apt/sources.list.d/llvm-'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('uses sudo for repository file when required', async () => {
            mockSetupProgram.isSudoRequired.mockReturnValue(true);
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('sudo -n tee /etc/apt/sources.list.d/llvm-'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('runs apt-get update after adding repositories', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('apt-get update'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('skips repository when Release file does not exist', async () => {
            mockSetupProgram.urlExists.mockResolvedValue(false);
            await main(makeInputs({ version: '>=15.0.0' }));
            // Should still call findProgramWithApt for clang (the final search)
            expect(mockPackageInstall.findProgramWithApt).toHaveBeenCalledWith(
                ['clang'],
                '>=15.0.0',
                true
            );
        });

        it('skips repository when urlExists returns false', async () => {
            (mockIo.which as jest.Mock).mockResolvedValue('/usr/bin/add-apt-repository');
            mockSetupProgram.urlExists.mockResolvedValue(false);
            await main(makeInputs({ version: '>=15.0.0' }));
            const addRepoCalls = mockExec.exec.mock.calls.filter(
                (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('add-apt-repository')
            );
            expect(addRepoCalls.length).toBe(0);
        });

        it('skips repositories when ubuntuName is null', async () => {
            mockSetupProgram.getCurrentUbuntuName.mockReturnValue(null);
            await main(makeInputs());
            // Should NOT call downloadTool for GPG key
            expect(mockTc.downloadTool).not.toHaveBeenCalled();
        });

        it('skips repositories when no version majors match', async () => {
            mockSetupProgram.findClangVersions.mockResolvedValue([]);
            await main(makeInputs({ version: '>=99.0.0' }));
            expect(mockTc.downloadTool).not.toHaveBeenCalled();
        });
    });

    // ─── searchBrew (macOS) ────────────────────────────────────────

    describe('searchBrew', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        });

        it('finds already-installed Homebrew LLVM', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '>=18.0.0' }));
            expect(mockPackageInstall.findProgramWithBrew).toHaveBeenCalledWith('llvm@18', 'clang');
            expect(mockPackageInstall.installProgramWithBrew).not.toHaveBeenCalled();
            expect(result.outputPath).toBe('/opt/homebrew/opt/llvm@18/bin/clang');
            expect(result.version).toBe('18.1.8');
        });

        it('installs via Homebrew when not found then finds', async () => {
            mockPackageInstall.findProgramWithBrew
                .mockResolvedValueOnce(null) // First search: not found
                .mockResolvedValueOnce({     // After install: found
                    path: '/opt/homebrew/opt/llvm@18/bin/clang',
                    version: '18.1.8'
                });
            mockPackageInstall.installProgramWithBrew.mockResolvedValueOnce('/opt/homebrew/opt/llvm@18');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '>=18.0.0' }));
            expect(mockPackageInstall.installProgramWithBrew).toHaveBeenCalledWith('llvm@18');
            expect(result.outputPath).toBe('/opt/homebrew/opt/llvm@18/bin/clang');
        });

        it('handles Homebrew install failure gracefully', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValue(null);
            mockPackageInstall.installProgramWithBrew.mockResolvedValueOnce(null);
            const result = await main(makeInputs({ version: '>=18.0.0' }));
            expect(result.outputPath).toBeNull();
        });

        it('skips Homebrew search for wildcard version', async () => {
            const result = await main(makeInputs({ version: '*' }));
            expect(mockPackageInstall.findProgramWithBrew).not.toHaveBeenCalled();
            expect(result.outputPath).toBeNull();
        });

        it('prioritizes user-provided path over Homebrew', async () => {
            mockSetupProgram.findProgramInPath.mockResolvedValueOnce({
                outputVersion: '18.1.8',
                outputPath: '/custom/bin/clang'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '>=18.0.0', path: ['/custom/bin'] }));
            expect(mockPackageInstall.findProgramWithBrew).not.toHaveBeenCalled();
            expect(result.outputPath).toBe('/custom/bin/clang');
        });

        it('skips APT and download on macOS', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '>=18.0.0' }));
            expect(mockPackageInstall.findProgramWithApt).not.toHaveBeenCalled();
            expect(mockDownload.installProgramFromClangUrls).not.toHaveBeenCalled();
        });

        it('handles semver input (e.g., "18")', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '18' }));
            expect(mockPackageInstall.findProgramWithBrew).toHaveBeenCalledWith('llvm@18', 'clang');
            expect(result.version).toBe('18.1.8');
        });

        it('derives cc and cxx correctly from clang path', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '>=18.0.0' }));
            expect(result.cc).toBe('/opt/homebrew/opt/llvm@18/bin/clang');
            expect(result.cxx).toBe(path.join('/opt/homebrew/opt/llvm@18/bin', 'clang++'));
        });
    });

    // ─── installSymbolizer (macOS) ───────────────────────────────

    describe('installSymbolizer (macOS)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        });

        it('finds and exports symbolizer on macOS', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockSetupProgram.findLlvmSymbolizer.mockResolvedValueOnce('/opt/homebrew/opt/llvm@18/bin/llvm-symbolizer');
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '>=18.0.0', updateEnvironment: true }));
            expect(mockSetupProgram.findLlvmSymbolizer).toHaveBeenCalledWith(18);
            expect(mockSetupProgram.exportSymbolizerEnvVars).toHaveBeenCalledWith(
                '/opt/homebrew/opt/llvm@18/bin/llvm-symbolizer'
            );
        });

        it('skips symbolizer when updateEnvironment is false', async () => {
            mockPackageInstall.findProgramWithBrew.mockResolvedValueOnce({
                path: '/opt/homebrew/opt/llvm@18/bin/clang',
                version: '18.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '>=18.0.0', updateEnvironment: false }));
            expect(mockSetupProgram.findLlvmSymbolizer).not.toHaveBeenCalled();
        });
    });

    // ─── searchChoco (Windows) ─────────────────────────────────────

    describe('searchChoco (Windows)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        });

        it('finds LLVM clang-cl in known install paths', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                version: '20.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '20' }));

            expect(mockFindProgramWithChoco).toHaveBeenCalledWith(
                'llvm', 'clang-cl.exe',
                ['C:\\Program Files\\LLVM\\bin']
            );
            expect(result.outputPath).toBe(path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'));
            expect(result.version).toBe('20.1.8');
        });

        it('installs LLVM via Chocolatey when not found', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce(null)  // initial search
                .mockResolvedValueOnce({      // after install
                    path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                    version: '20.1.8'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\Program Files\\LLVM\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '20' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'llvm', '20.1.8', 'C:\\Program Files\\LLVM\\bin'
            );
            expect(result.outputPath).toBe(path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'));
            expect(result.version).toBe('20.1.8');
        });

        it('installs with version from data file when major matches', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                    version: '18.1.8'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\Program Files\\LLVM\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '18' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'llvm', '18.1.8', 'C:\\Program Files\\LLVM\\bin'
            );
            expect(result.version).toBe('18.1.8');
        });

        it('skips wrong version and installs correct one', async () => {
            mockFindProgramWithChoco
                .mockResolvedValueOnce({      // found but wrong major
                    path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                    version: '18.1.8'
                })
                .mockResolvedValueOnce({      // after install
                    path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                    version: '20.1.8'
                });
            mockInstallProgramWithChoco.mockResolvedValue('C:\\Program Files\\LLVM\\bin');
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '20' }));

            expect(mockInstallProgramWithChoco).toHaveBeenCalledWith(
                'llvm', '20.1.8', 'C:\\Program Files\\LLVM\\bin'
            );
            expect(result.version).toBe('20.1.8');
        });

        it('accepts found version when no specific version requested (wildcard)', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                version: '20.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '*' }));

            expect(result.outputPath).toBe(path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'));
            expect(result.version).toBe('20.1.8');
        });

        it('returns null when Chocolatey install fails', async () => {
            mockFindProgramWithChoco.mockResolvedValue(null);
            mockInstallProgramWithChoco.mockResolvedValue(null);
            const result = await main(makeInputs({ version: '20' }));

            expect(result.outputPath).toBeNull();
        });

        it('skips Chocolatey when already found in user paths', async () => {
            mockSetupProgram.findProgramInPath.mockResolvedValueOnce({
                outputVersion: '20.1.8',
                outputPath: path.join('C:\\custom\\bin', 'clang-cl.exe')
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '20', path: ['C:\\custom\\bin'] }));

            expect(mockFindProgramWithChoco).not.toHaveBeenCalled();
            expect(result.outputPath).toBe(path.join('C:\\custom\\bin', 'clang-cl.exe'));
        });

        it('does not call APT or download on Windows', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                version: '20.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ version: '20' }));

            expect(mockPackageInstall.findProgramWithApt).not.toHaveBeenCalled();
            expect(mockDownload.installProgramFromClangUrls).not.toHaveBeenCalled();
        });

        it('does not install when wildcard version and nothing found', async () => {
            mockFindProgramWithChoco.mockResolvedValue(null);
            const result = await main(makeInputs({ version: '*' }));

            expect(mockInstallProgramWithChoco).not.toHaveBeenCalled();
            expect(result.outputPath).toBeNull();
        });

        it('handles semver version input correctly', async () => {
            mockFindProgramWithChoco.mockResolvedValue({
                path: path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe'),
                version: '20.1.8'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs({ version: '20.1.8' }));

            expect(result.version).toBe('20.1.8');
        });
    });

    // ─── downloadFromUrl ──────────────────────────────────────────

    describe('downloadFromUrl', () => {
        it('skips download when version already found', async () => {
            mockPackageInstall.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            await main(makeInputs());
            expect(mockDownload.installProgramFromClangUrls).not.toHaveBeenCalled();
        });

        it('attempts download when no version found', async () => {
            await main(makeInputs());
            expect(mockDownload.clangDownloadCandidates).toHaveBeenCalled();
            expect(mockDownload.installProgramFromClangUrls).toHaveBeenCalled();
        });
    });

    // ─── installCompanions ────────────────────────────────────────

    describe('installCompanions', () => {
        it('skips companions when no version found', async () => {
            await main(makeInputs());
            expect(mockCompanionPkg.installCompanionPackages).not.toHaveBeenCalled();
        });

        it('installs companions when version is found', async () => {
            mockPackageInstall.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            await main(makeInputs());
            expect(mockCompanionPkg.installCompanionPackages).toHaveBeenCalledWith('15.0.0', 'clang-15', false);
        });

        it('sets sanitizer env vars when symbolizer found and updateEnvironment is true', async () => {
            mockPackageInstall.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            mockCompanionPkg.installCompanionPackages.mockResolvedValueOnce({
                symbolizerPath: '/usr/bin/llvm-symbolizer-15'
            });
            await main(makeInputs({ updateEnvironment: true }));
            expect(mockSetupProgram.exportSymbolizerEnvVars).toHaveBeenCalledWith('/usr/bin/llvm-symbolizer-15');
        });

        it('does not set sanitizer env vars when updateEnvironment is false', async () => {
            mockPackageInstall.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            mockCompanionPkg.installCompanionPackages.mockResolvedValueOnce({
                symbolizerPath: '/usr/bin/llvm-symbolizer-15'
            });
            await main(makeInputs({ updateEnvironment: false }));
            expect(mockSetupProgram.exportSymbolizerEnvVars).not.toHaveBeenCalled();
        });
    });

    // ─── buildOutputs ─────────────────────────────────────────────

    describe('buildOutputs', () => {
        it('returns null outputs when no clang found', async () => {
            const result = await main(makeInputs());
            expect(result.outputPath).toBeNull();
            expect(result.cc).toBeNull();
            expect(result.cxx).toBeNull();
            expect(result.version).toBe('0.0.0');
        });

        it('derives cc from clang++ path', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());
            expect(result.cc).toBe(path.join('/usr/bin', 'clang-15'));
            expect(result.cxx).toBe('/usr/bin/clang++-15');

        });

        it('derives cxx from clang path', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang-15'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());
            expect(result.cc).toBe('/usr/bin/clang-15');
            expect(result.cxx).toBe(path.join('/usr/bin', 'clang++-15'));

        });

        it('falls back to outputPath when cc does not exist', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(false);
            const result = await main(makeInputs());
            // cc derived as clang-15, but doesn't exist, falls back
            expect(result.cc).toBe('/usr/bin/clang++-15');
            expect(result.cxx).toBe('/usr/bin/clang++-15');

        });

        it('parses version components correctly', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.2.3',
                outputPath: '/usr/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());
            expect(result.version).toBe('15.2.3');
            expect(result.versionMajor).toBe(15);
            expect(result.versionMinor).toBe(2);
            expect(result.versionPatch).toBe(3);

        });

        it('adds bindir to PATH when updateEnvironment is true', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ updateEnvironment: true }));
            expect(mockCore.addPath).toHaveBeenCalledWith('/usr/bin');

        });

        it('does not add bindir to PATH when updateEnvironment is false', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(true);
            await main(makeInputs({ updateEnvironment: false }));
            expect(mockCore.addPath).not.toHaveBeenCalled();

        });

        it('adds lib dir to LD_LIBRARY_PATH when installed from URL', async () => {
            // Simulate download path (no APT version found, download succeeds)
            mockDownload.installProgramFromClangUrls.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/local/bin/clang++-15'
            });
            const existsSyncSpy = mockExistsSync.mockReturnValue(true);
            await main(makeInputs());
            const expectedLib = path.join('/usr/local', 'lib');
            expect(mockCore.exportVariable).toHaveBeenCalledWith(
                'LD_LIBRARY_PATH',
                expect.stringContaining(expectedLib)
            );
            existsSyncSpy.mockRestore();
        });

        it('skips lib dir already in LD_LIBRARY_PATH', async () => {
            const expectedLib = path.join('/usr/local', 'lib');
            process.env['LD_LIBRARY_PATH'] = expectedLib;
            mockDownload.installProgramFromClangUrls.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/local/bin/clang++-15'
            });
            const existsSyncSpy = mockExistsSync.mockReturnValue(true);
            await main(makeInputs());
            // LD_LIBRARY_PATH should NOT be updated since it already contains the lib dir
            const ldCalls = mockCore.exportVariable.mock.calls.filter(c => c[0] === 'LD_LIBRARY_PATH');
            expect(ldCalls).toHaveLength(0);
            existsSyncSpy.mockRestore();
        });

        it('does not add lib dir to LD_LIBRARY_PATH when dir does not exist', async () => {
            delete process.env['LD_LIBRARY_PATH'];
            mockDownload.installProgramFromClangUrls.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/opt/clang/bin/clang++-15'
            });
            const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p: fs.PathLike) => {
                const s = p.toString();
                if (s.endsWith('/lib')) return false;
                return true;
            });
            await main(makeInputs());
            const ldCalls = mockCore.exportVariable.mock.calls.filter(c => c[0] === 'LD_LIBRARY_PATH');
            // LD_LIBRARY_PATH is exported as empty string (different from undefined)
            if (ldCalls.length > 0) {
                expect(ldCalls[0][1]).not.toContain('/opt/clang/lib');
            }
            existsSyncSpy.mockRestore();
        });

        it('sets bindir and dir correctly', async () => {
            mockSetupProgram.findProgramInSystemPaths.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/lib/llvm-15/bin/clang++-15'
            });
            mockExistsSync.mockReturnValue(true);
            const result = await main(makeInputs());
            expect(result.bindir).toBe('/usr/lib/llvm-15/bin');
            expect(result.dir).toBe('/usr/lib/llvm-15');

        });
    });
});

describePrettyErrors('clang boom', 'Setup Clang failed');
