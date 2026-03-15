import * as path from 'path';
import { main } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';
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

jest.mock('setup-program', () => ({
    findClangVersions: jest.fn().mockResolvedValue(['14.0.0', '15.0.0', '16.0.0']),
    findProgramInPath: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null }),
    findProgramInSystemPaths: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null }),
    findProgramWithApt: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null, installedPackage: null }),
    getCurrentUbuntuName: jest.fn().mockReturnValue('jammy'),
    getCurrentUbuntuVersion: jest.fn().mockReturnValue('22.04'),
    isSudoRequired: jest.fn().mockReturnValue(false),
    ensureSudoIsAvailable: jest.fn().mockResolvedValue(undefined),
    ensureAddAptRepositoryIsAvailable: jest.fn().mockResolvedValue(undefined),
    urlExists: jest.fn().mockResolvedValue(true),
    getPackagePreferenceTier: jest.fn().mockReturnValue(1),
    PackagePreferenceTier: { UNVERSIONED: 1, RAW_VERSIONED: 2, OTHER_VERSIONED: 3 },
    installProgramFromUrl: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null })
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
import * as download from './download';
import * as companionPkg from './companion-packages';
import * as fs from 'fs';

const mockCore = core as jest.Mocked<typeof core>;
const mockIo = io as jest.Mocked<typeof io>;
const mockExec = exec as jest.Mocked<typeof exec>;
const mockTc = tc as jest.Mocked<typeof tc>;
const mockSetupProgram = setup_program as jest.Mocked<typeof setup_program>;
const mockDownload = download as jest.Mocked<typeof download>;
const mockCompanionPkg = companionPkg as jest.Mocked<typeof companionPkg>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

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

        it('calls setFailed on non-linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            await main(makeInputs());
            expect(mockCore.setFailed).toHaveBeenCalledWith('This action is only supported on Linux');
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
            expect(mockSetupProgram.findProgramWithApt).not.toHaveBeenCalled();
        });

        it('skips APT on non-linux platforms', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
            await main(makeInputs());
            expect(mockSetupProgram.findProgramWithApt).not.toHaveBeenCalled();
        });

        it('adds APT repositories when ubuntu name available', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            // Should call findProgramWithApt for gnupg and software-properties-common
            expect(mockSetupProgram.findProgramWithApt).toHaveBeenCalledWith(['gnupg'], '*', true);
            expect(mockSetupProgram.findProgramWithApt).toHaveBeenCalledWith(['software-properties-common'], '*', true);
        });

        it('downloads GPG key and adds it without sudo when not required', async () => {
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockTc.downloadTool).toHaveBeenCalledWith('https://apt.llvm.org/llvm-snapshot.gpg.key');
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('apt-key add'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('uses sudo for GPG key when sudo is required', async () => {
            mockSetupProgram.isSudoRequired.mockReturnValue(true);
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringMatching(/^sudo -n sudo apt-key add/),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('adds repository with add-apt-repository', async () => {
            (mockIo.which as jest.Mock).mockResolvedValue('/usr/bin/add-apt-repository');
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringContaining('add-apt-repository -y'),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('uses sudo for add-apt-repository when required', async () => {
            (mockIo.which as jest.Mock).mockResolvedValue('/usr/bin/add-apt-repository');
            mockSetupProgram.isSudoRequired.mockReturnValue(true);
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockExec.exec).toHaveBeenCalledWith(
                expect.stringMatching(/^sudo -n add-apt-repository -y/),
                [],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('skips add-apt-repository when which throws', async () => {
            (mockIo.which as jest.Mock).mockRejectedValue(new Error('not found'));
            await main(makeInputs({ version: '>=15.0.0' }));
            // Should still call findProgramWithApt for clang (the final search)
            expect(mockSetupProgram.findProgramWithApt).toHaveBeenCalledWith(
                ['clang'],
                '>=15.0.0',
                true
            );
        });

        it('skips repository when urlExists returns false', async () => {
            (mockIo.which as jest.Mock).mockResolvedValue('/usr/bin/add-apt-repository');
            mockSetupProgram.urlExists.mockResolvedValue(false);
            await main(makeInputs({ version: '>=15.0.0' }));
            expect(mockSetupProgram.ensureAddAptRepositoryIsAvailable).not.toHaveBeenCalled();
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

    // ─── downloadFromUrl ──────────────────────────────────────────

    describe('downloadFromUrl', () => {
        it('skips download when version already found', async () => {
            mockSetupProgram.findProgramWithApt.mockResolvedValueOnce({
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
            mockSetupProgram.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            await main(makeInputs());
            expect(mockCompanionPkg.installCompanionPackages).toHaveBeenCalledWith('15.0.0', 'clang-15', false);
        });

        it('sets sanitizer env vars when symbolizer found and updateEnvironment is true', async () => {
            mockSetupProgram.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            mockCompanionPkg.installCompanionPackages.mockResolvedValueOnce({
                symbolizerPath: '/usr/bin/llvm-symbolizer-15'
            });
            await main(makeInputs({ updateEnvironment: true }));
            expect(mockCore.exportVariable).toHaveBeenCalledWith('ASAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer-15');
            expect(mockCore.exportVariable).toHaveBeenCalledWith('MSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer-15');
            expect(mockCore.exportVariable).toHaveBeenCalledWith('TSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer-15');
            expect(mockCore.exportVariable).toHaveBeenCalledWith('UBSAN_SYMBOLIZER_PATH', '/usr/bin/llvm-symbolizer-15');
        });

        it('does not set sanitizer env vars when updateEnvironment is false', async () => {
            mockSetupProgram.findProgramWithApt.mockResolvedValueOnce({
                outputVersion: '15.0.0',
                outputPath: '/usr/bin/clang++-15',
                installedPackage: 'clang-15'
            } as never);
            mockCompanionPkg.installCompanionPackages.mockResolvedValueOnce({
                symbolizerPath: '/usr/bin/llvm-symbolizer-15'
            });
            await main(makeInputs({ updateEnvironment: false }));
            expect(mockCore.exportVariable).not.toHaveBeenCalledWith('ASAN_SYMBOLIZER_PATH', expect.anything());
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
