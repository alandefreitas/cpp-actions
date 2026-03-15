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
    getExecOutput: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    setTraceCommands: jest.fn(),
    traceCommands: false
}));

jest.mock('setup-gcc', () => ({
    main: jest.fn()
}));

jest.mock('setup-clang', () => ({
    main: jest.fn()
}));

jest.mock('setup-msvc', () => ({
    main: jest.fn(),
    buildMSVCOutputs: jest.requireActual('setup-msvc').buildMSVCOutputs
}));

jest.mock('fs', () => ({
    existsSync: jest.fn()
}));

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as setup_gcc from 'setup-gcc';
import * as setup_clang from 'setup-clang';
import * as setup_msvc from 'setup-msvc';
import { normalizeCompiler, resolveMSVCArch, main } from './index';
import type { Inputs } from './schema';
import { describePrettyErrors } from 'pretty-errors/test-helper';

const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockGccMain = setup_gcc.main as jest.MockedFunction<typeof setup_gcc.main>;
const mockClangMain = setup_clang.main as jest.MockedFunction<typeof setup_clang.main>;
const mockMsvcMain = setup_msvc.main as jest.MockedFunction<typeof setup_msvc.main>;

/**
 * Creates a default Inputs object for testing with optional overrides.
 *
 * @param overrides - Partial input values to override defaults
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        compiler: 'gcc',
        version: '*',
        path: [],
        checkLatest: false,
        updateEnvironment: true,
        arch: '',
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('normalizeCompiler', () => {
    it('splits compiler name from embedded version', () => {
        const result = normalizeCompiler('gcc-4.9.2', '*');
        expect(result.compiler).toEqual('gcc');
        expect(result.version).toEqual('4.9.2');
    });

    it('normalizes g++ to gcc', () => {
        const result = normalizeCompiler('g++', '11');
        expect(result.compiler).toEqual('gcc');
        expect(result.version).toEqual('11');
    });

    it('uses explicit version when no embedded version', () => {
        const result = normalizeCompiler('gcc', '12.1.0');
        expect(result.compiler).toEqual('gcc');
        expect(result.version).toEqual('12.1.0');
    });

    it('normalizes msvc variants', () => {
        expect(normalizeCompiler('msvc', '*').compiler).toEqual('msvc');
        expect(normalizeCompiler('cl', '*').compiler).toEqual('msvc');
    });

    it('normalizes multi-part compiler name with version', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });
        try {
            const result = normalizeCompiler('apple-clang-14', '*');
            expect(result.compiler).toEqual('clang');
            expect(result.version).toEqual('14');
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });

    it('normalizes clang to clang-cl on win32', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });
        try {
            const result = normalizeCompiler('clang', '*');
            expect(result.compiler).toEqual('clang-cl');
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });

    it('normalizes appleclang to clang', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });
        try {
            const result = normalizeCompiler('appleclang', '15');
            expect(result.compiler).toEqual('clang');
            expect(result.version).toEqual('15');
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });
});

describe('resolveMSVCArch', () => {
    it('normalizes tokens and falls back to env or defaults', () => {
        expect(resolveMSVCArch('x86', 'AMD64')).toEqual('x86');
        expect(resolveMSVCArch('ARM64', 'AMD64')).toEqual('arm64');
        expect(resolveMSVCArch('', 'AMD64')).toEqual('x64');
        expect(resolveMSVCArch('', '')).toEqual('x64');
        expect(resolveMSVCArch('weird-arch', 'AMD64')).toEqual('weird-arch');
    });

    it('normalizes i386/i686 to x86', () => {
        expect(resolveMSVCArch('i386', undefined)).toEqual('x86');
        expect(resolveMSVCArch('i686', undefined)).toEqual('x86');
        expect(resolveMSVCArch('win32', undefined)).toEqual('x86');
    });

    it('normalizes aarch64 to arm64', () => {
        expect(resolveMSVCArch('aarch64', undefined)).toEqual('arm64');
    });

    it('normalizes arm32 to arm', () => {
        expect(resolveMSVCArch('arm32', undefined)).toEqual('arm');
        expect(resolveMSVCArch('arm', undefined)).toEqual('arm');
    });

    it('falls back to env arch when requested is empty', () => {
        expect(resolveMSVCArch('', 'x86')).toEqual('x86');
    });

    it('defaults to x64 when both are empty or undefined', () => {
        expect(resolveMSVCArch('', undefined)).toEqual('x64');
    });
});

describe('main (SetupCppRunner)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    describe('Linux compiler setup', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
        });

        it('delegates gcc to setup-gcc on Linux', async () => {
            mockGccMain.mockResolvedValue({
                cc: '/usr/bin/gcc-12',
                cxx: '/usr/bin/g++-12',
                bindir: '/usr/bin',
                dir: '/usr',
                outputPath: '/usr/bin/gcc-12',
                version: '12.3.0',
                versionMajor: 12,
                versionMinor: 3,
                versionPatch: 0
            });

            const result = await main(makeInputs({ compiler: 'gcc', version: '12' }));

            expect(mockGccMain).toHaveBeenCalledWith({
                version: '12',
                path: [],
                checkLatest: false,
                updateEnvironment: true,
                traceCommands: false
            });
            expect(result).toEqual(expect.objectContaining({
                cc: '/usr/bin/gcc-12',
                cxx: '/usr/bin/g++-12',
                bindir: '/usr/bin',
                dir: '/usr'
            }));
        });

        it('delegates clang to setup-clang on Linux', async () => {
            mockClangMain.mockResolvedValue({
                cc: '/usr/bin/clang-16',
                cxx: '/usr/bin/clang++-16',
                bindir: '/usr/bin',
                dir: '/usr',
                outputPath: '/usr/bin/clang-16',
                version: '16.0.0',
                versionMajor: 16,
                versionMinor: 0,
                versionPatch: 0,
                symbolizerPath: null
            });

            const result = await main(makeInputs({ compiler: 'clang', version: '16' }));

            expect(mockClangMain).toHaveBeenCalledWith({
                version: '16',
                path: [],
                checkLatest: false,
                updateEnvironment: true,
                traceCommands: false
            });
            expect(result).toEqual(expect.objectContaining({
                cc: '/usr/bin/clang-16',
                cxx: '/usr/bin/clang++-16',
                bindir: '/usr/bin',
                dir: '/usr'
            }));
        });

        it('returns empty when setup returns null result', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockGccMain.mockResolvedValue(null as any);

            const result = await main(makeInputs({ compiler: 'gcc', version: '99' }));

            expect(mockSetFailed).toHaveBeenCalledWith('Cannot setup gcc');
            expect(result).toEqual({});
        });
    });

    describe('MSVC setup', () => {
        it('delegates to setup-msvc and returns outputs on success', async () => {
            mockMsvcMain.mockResolvedValue({
                cc: 'C:\\cl.exe',
                cxx: 'C:\\cl.exe',
                bindir: 'C:\\bin',
                dir: 'C:\\VC',
                release: '14.40.0',
                version: '14.40.0',
                versionMajor: 14,
                versionMinor: 40,
                versionPatch: 0,
                msvcToolsetVersion: '14.40.0',
                msvcProductVersion: '17.11',
                msvcReleaseYear: '2022',
                msvcCompilerVersion: '19.44.0'
            });

            const result = await main(makeInputs({ compiler: 'msvc', version: '*', arch: 'x64' }));

            expect(mockMsvcMain).toHaveBeenCalledWith({
                version: '*',
                arch: 'x64',
                sdk: '',
                toolset: '',
                uwp: false,
                spectre: false,
                visualStudioVersion: '',
                traceCommands: false
            });
            expect(result).toEqual(expect.objectContaining({
                cc: 'C:\\cl.exe',
                cxx: 'C:\\cl.exe'
            }));
        });

        it('returns empty on MSVC setup failure', async () => {
            mockMsvcMain.mockRejectedValue(new Error('MSVC not found'));

            const result = await main(makeInputs({ compiler: 'msvc', version: '*' }));

            expect(mockSetFailed).toHaveBeenCalledWith('MSVC not found');
            expect(result).toEqual({});
        });
    });

    describe('PATH compiler search', () => {
        it('finds gcc in PATH on non-Linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc (Homebrew GCC 13.2.0) 13.2.0\n',
                stderr: ''
            });

            const result = await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(mockWhich).toHaveBeenCalledWith('gcc');
            expect(result).toEqual(expect.objectContaining({
                cc: '/usr/local/bin/gcc',
                cxx: '/usr/local/bin/g++',
                version: '13.2.0',
                versionMajor: 13,
                versionMinor: 2,
                versionPatch: 0
            }));
        });

        it('finds mingw as gcc in PATH', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            mockWhich.mockResolvedValue('C:\\mingw\\bin\\gcc.exe');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc.exe (x86_64-posix-seh-rev0) 13.1.0\n',
                stderr: ''
            });

            const result = await main(makeInputs({ compiler: 'mingw', version: '*' }));

            expect(mockWhich).toHaveBeenCalledWith('gcc');
            expect(result).toEqual(expect.objectContaining({
                cc: 'C:\\mingw\\bin\\gcc.exe',
                version: '13.1.0'
            }));
        });

        it('searches for clang-cl on Windows', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            mockWhich.mockResolvedValue('C:\\LLVM\\bin\\clang-cl.exe');
            mockExistsSync.mockReturnValue(false);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'clang version 17.0.1\n',
                stderr: ''
            });

            const result = await main(makeInputs({ compiler: 'clang', version: '*' }));

            expect(mockWhich).toHaveBeenCalledWith('clang-cl');
            expect(result).toEqual(expect.objectContaining({
                cc: 'C:\\LLVM\\bin\\clang-cl.exe',
                cxx: 'C:\\LLVM\\bin\\clang-cl.exe', // cxx falls back to cc when existsSync returns false
                version: '17.0.1'
            }));
        });

        it('sets failed when compiler not found in PATH', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('');

            const result = await main(makeInputs({ compiler: 'clang', version: '*' }));

            expect(mockSetFailed).toHaveBeenCalledWith('Cannot find clang');
            expect(mockSetFailed).toHaveBeenCalledWith('Cannot setup clang');
            expect(result).toEqual({});
        });

        it('handles io.which throwing', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockRejectedValue(new Error('not found'));

            const result = await main(makeInputs({ compiler: 'clang', version: '*' }));

            expect(mockSetFailed).toHaveBeenCalledWith('Cannot find clang');
            expect(result).toEqual({});
        });

        it('handles --version failing with non-zero exit', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 1,
                stdout: '',
                stderr: 'error'
            });

            const result = await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(result).toEqual(expect.objectContaining({
                version: '0.0.0',
                versionMajor: 0,
                versionMinor: 0,
                versionPatch: 0
            }));
        });

        it('handles --version with only major.minor version', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc version 13.2\n',
                stderr: ''
            });

            const result = await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(result).toEqual(expect.objectContaining({
                version: '13.2.0',
                versionMajor: 13,
                versionMinor: 2,
                versionPatch: 0
            }));
        });

        it('handles --version with only major version', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc version 13\n',
                stderr: ''
            });

            const result = await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(result).toEqual(expect.objectContaining({
                version: '13.0.0',
                versionMajor: 13,
                versionMinor: 0,
                versionPatch: 0
            }));
        });

        it('uses mingw32 and mingw64 as gcc alias', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            mockWhich.mockResolvedValue('C:\\bin\\gcc.exe');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc 12.0.0\n',
                stderr: ''
            });

            await main(makeInputs({ compiler: 'mingw32', version: '*' }));
            expect(mockWhich).toHaveBeenCalledWith('gcc');

            jest.clearAllMocks();
            mockWhich.mockResolvedValue('C:\\bin\\gcc.exe');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc 12.0.0\n',
                stderr: ''
            });

            await main(makeInputs({ compiler: 'mingw64', version: '*' }));
            expect(mockWhich).toHaveBeenCalledWith('gcc');
        });
    });
});

describe('buildMSVCOutputs', () => {
    it('uses Visual Studio metadata when available', () => {
        const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe';
        const env = {
            VCINSTALLDIR: 'C\\VS\\VC\\',
            VisualStudioVersion: '17.11.35205.1',
            VCToolsVersion: '14.40.33807'
        };

        const outputs = setup_msvc.buildMSVCOutputs(compilerPath, env, { compilerVersion: '19.44.35219' });

        expect(outputs.cc).toEqual(compilerPath);
        expect(outputs.cxx).toEqual(compilerPath);
        expect(outputs.bindir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64');
        expect(outputs.dir).toEqual('C\\VS\\VC\\');
        expect(outputs.release).toEqual('14.40.33807');
        expect(outputs.versionMajor).toEqual(14);
        expect(outputs.versionMinor).toEqual(40);
        expect(outputs.versionPatch).toEqual(33807);
        expect(outputs.msvcToolsetVersion).toEqual('14.40.33807');
        expect(outputs.msvcProductVersion).toEqual('17.11.35205.1');
        expect(outputs.msvcReleaseYear).toEqual('2022');
        expect(outputs.msvcCompilerVersion).toEqual('19.44.35219');
    });

    it('falls back when metadata is missing', () => {
        const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe';
        const outputs = setup_msvc.buildMSVCOutputs(compilerPath, {});

        expect(outputs.dir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64');
        expect(outputs.release).toEqual('14.40.33807');
        expect(outputs.versionMajor).toEqual(14);
    });
});

describePrettyErrors('cpp boom', 'Setup C++ failed');
