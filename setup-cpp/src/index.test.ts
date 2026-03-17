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
    getExecOutput: jest.fn(),
    exec: jest.fn()
}));

jest.mock('./apple-clang-utils', () => ({
    scanInstalledXcodes: jest.fn()
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

jest.mock('setup-program', () => ({
    findLlvmSymbolizer: jest.fn().mockResolvedValue(null),
    exportSymbolizerEnvVars: jest.fn()
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
import * as setup_program from 'setup-program';
import { scanInstalledXcodes } from './apple-clang-utils';
import { normalizeCompiler, resolveMSVCArch, main } from './index';
import type { Inputs } from './schema';
import { ExpectedError } from 'pretty-errors';
import { describePrettyErrors } from 'pretty-errors/test-helper';
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockExportVariable = core.exportVariable as jest.MockedFunction<typeof core.exportVariable>;
const mockScanInstalledXcodes = scanInstalledXcodes as jest.MockedFunction<typeof scanInstalledXcodes>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockGccMain = setup_gcc.main as jest.MockedFunction<typeof setup_gcc.main>;
const mockClangMain = setup_clang.main as jest.MockedFunction<typeof setup_clang.main>;
const mockMsvcMain = setup_msvc.main as jest.MockedFunction<typeof setup_msvc.main>;
const mockFindLlvmSymbolizer = setup_program.findLlvmSymbolizer as jest.MockedFunction<typeof setup_program.findLlvmSymbolizer>;
const mockExportSymbolizerEnvVars = setup_program.exportSymbolizerEnvVars as jest.MockedFunction<typeof setup_program.exportSymbolizerEnvVars>;
const mockCoreInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockCoreWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockCoreStartGroup = core.startGroup as jest.MockedFunction<typeof core.startGroup>;

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

    it('normalizes apple-clang with embedded version', () => {
        const result = normalizeCompiler('apple-clang-14', '*');
        expect(result.compiler).toEqual('apple-clang');
        expect(result.version).toEqual('14');
    });

    it('preserves apple-clang as distinct compiler', () => {
        const result = normalizeCompiler('apple-clang', '17');
        expect(result.compiler).toEqual('apple-clang');
        expect(result.version).toEqual('17');
    });

    it('normalizes appleclang to apple-clang', () => {
        const result = normalizeCompiler('appleclang', '15');
        expect(result.compiler).toEqual('apple-clang');
        expect(result.version).toEqual('15');
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

        it('throws ExpectedError when setup returns null result', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            mockGccMain.mockResolvedValue(null as any);

            await expect(main(makeInputs({ compiler: 'gcc', version: '99' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'gcc', version: '99' }))).rejects.toThrow('Cannot setup gcc');
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

        it('throws ExpectedError on MSVC setup failure', async () => {
            mockMsvcMain.mockRejectedValue(new Error('MSVC not found'));

            await expect(main(makeInputs({ compiler: 'msvc', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'msvc', version: '*' }))).rejects.toThrow('MSVC not found');
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

        it('throws ExpectedError when compiler not found in PATH', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('');

            await expect(main(makeInputs({ compiler: 'clang', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'clang', version: '*' }))).rejects.toThrow('Cannot find clang');
        });

        it('throws ExpectedError when io.which throws', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockRejectedValue(new Error('not found'));

            await expect(main(makeInputs({ compiler: 'clang', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'clang', version: '*' }))).rejects.toThrow('Cannot find clang');
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

    describe('Apple Clang on non-macOS platforms', () => {
        it('throws ExpectedError on Linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '17' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '17' }))).rejects.toThrow('Apple Clang is only available on macOS');
        });

        it('throws ExpectedError on Windows', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow('Apple Clang is only available on macOS');
        });

        it('throws before any Xcode scanning', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '16' }))).rejects.toThrow(ExpectedError);
            expect(mockScanInstalledXcodes).not.toHaveBeenCalled();
            expect(mockGetExecOutput).not.toHaveBeenCalled();
        });
    });

    describe('Apple Clang setup (specific version)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
        });

        it('selects Xcode matching requested major Apple Clang version', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' },
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.0' },
                { xcodePath: '/Applications/Xcode_15.0.app', xcodeVersion: '15.0', appleClangVersion: '15.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 16.0.0\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '16' }));

            expect(mockScanInstalledXcodes).toHaveBeenCalled();
            expect(mockExportVariable).toHaveBeenCalledWith(
                'DEVELOPER_DIR',
                '/Applications/Xcode_15.4.app/Contents/Developer'
            );
            expect(result).toEqual(expect.objectContaining({
                cc: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang',
                cxx: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++',
                version: '16.0.0',
                versionMajor: 16,
                versionMinor: 0,
                versionPatch: 0
            }));
        });

        it('picks newest Xcode when multiple match same major', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.6' },
                { xcodePath: '/Applications/Xcode_15.2.app', xcodeVersion: '15.2', appleClangVersion: '16.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '16' }));

            // First match is 16.0.6 (sorted descending), which is Xcode 15.4
            expect(mockExportVariable).toHaveBeenCalledWith(
                'DEVELOPER_DIR',
                '/Applications/Xcode_15.4.app/Contents/Developer'
            );
            expect(result).toEqual(expect.objectContaining({
                version: '16.0.6',
                versionMajor: 16
            }));
        });

        it('matches exact semver version', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' },
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '17.0.0' }));

            expect(mockExportVariable).toHaveBeenCalledWith(
                'DEVELOPER_DIR',
                '/Applications/Xcode_16.0.app/Contents/Developer'
            );
            expect(result).toEqual(expect.objectContaining({
                version: '17.0.0',
                versionMajor: 17
            }));
        });

        it('throws when no Xcode matches requested version', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.0' }
            ]);

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '99' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '99' }))).rejects.toThrow('No installed Xcode has Apple Clang version matching');
        });

        it('throws when no Xcodes are installed', async () => {
            mockScanInstalledXcodes.mockResolvedValue([]);

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '17' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '17' }))).rejects.toThrow('No Xcode installations found');
        });

        it('falls back to xcode-select when DEVELOPER_DIR verification fails', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 1, stdout: '', stderr: 'error' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });
            mockExec.mockResolvedValue(0);

            await main(makeInputs({ compiler: 'apple-clang', version: '17' }));

            expect(mockExec).toHaveBeenCalledWith(
                'sudo',
                ['-n', 'xcode-select', '-s', '/Applications/Xcode_16.0.app'],
                { ignoreReturnCode: true }
            );
        });

        it('matches exact coerced version (non-range, non-major)', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' },
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            // "16.0" is not a valid semver range (semver.validRange returns null for it)
            // but semver.coerce("16.0") produces 16.0.0 which matches
            const result = await main(makeInputs({ compiler: 'apple-clang', version: '16.0' }));

            expect(result).toEqual(expect.objectContaining({
                version: '16.0.0',
                versionMajor: 16
            }));
        });

        it('supports semver range version', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' },
                { xcodePath: '/Applications/Xcode_15.4.app', xcodeVersion: '15.4', appleClangVersion: '16.0.0' },
                { xcodePath: '/Applications/Xcode_15.0.app', xcodeVersion: '15.0', appleClangVersion: '15.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '>=16.0.0' }));

            // Should match 17.0.0 (first in descending order that satisfies >=16)
            expect(result).toEqual(expect.objectContaining({
                version: '17.0.0',
                versionMajor: 17
            }));
        });
    });

    describe('Apple Clang default (wildcard version)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
        });

        it('detects default Apple Clang version and resolves paths via xcrun', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 17.0.0 (clang-1700.0.13.3)\nTarget: arm64-apple-darwin24.0.0\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '*' }));

            expect(mockScanInstalledXcodes).not.toHaveBeenCalled();
            expect(mockExportVariable).not.toHaveBeenCalledWith('DEVELOPER_DIR', expect.anything());
            expect(result).toEqual(expect.objectContaining({
                cc: '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang',
                cxx: '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++',
                version: '17.0.0',
                versionMajor: 17,
                versionMinor: 0,
                versionPatch: 0
            }));
        });

        it('works with empty version string', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 16.0.0 (clang-1600.0.26.6)\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '' }));

            expect(result).toEqual(expect.objectContaining({
                cc: '/usr/bin/clang',
                cxx: '/usr/bin/clang++',
                version: '16.0.0',
                versionMajor: 16,
                versionMinor: 0,
                versionPatch: 0
            }));
        });

        it('sets bindir and dir from cc path', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 15.0.0 (clang-1500.3.9.4)\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '*' }));

            expect(result).toEqual(expect.objectContaining({
                bindir: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
                dir: '/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr'
            }));
        });

        it('throws when xcrun clang --version fails', async () => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 1,
                stdout: '',
                stderr: 'xcrun: error: unable to find utility "clang"'
            });

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow('Failed to run xcrun clang --version');
        });

        it('throws when version cannot be parsed from output', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'some unknown clang version output\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow(ExpectedError);
            await expect(main(makeInputs({ compiler: 'apple-clang', version: '*' }))).rejects.toThrow('Could not parse Apple Clang version');
        });
    });

    describe('Compiler target info logging (apple-clang)', () => {
        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
        });

        it('logs target triple and supported targets for specific version', async () => {
            mockScanInstalledXcodes.mockResolvedValue([
                { xcodePath: '/Applications/Xcode_16.0.app', xcodeVersion: '16.0', appleClangVersion: '17.0.0' }
            ]);
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 17.0.0\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-target-triple') {
                    return { exitCode: 0, stdout: 'arm64-apple-darwin24.0.0\n', stderr: '' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-targets') {
                    return { exitCode: 0, stdout: '  Registered Targets:\n    aarch64 - AArch64\n    x86_64  - 64-bit X86\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            await main(makeInputs({ compiler: 'apple-clang', version: '17' }));

            expect(mockCoreStartGroup).toHaveBeenCalledWith('\uD83C\uDFAF Compiler target info');
            expect(mockCoreInfo).toHaveBeenCalledWith('Target triple: arm64-apple-darwin24.0.0');
            expect(mockCoreInfo).toHaveBeenCalledWith(expect.stringContaining('Supported targets:'));
        });

        it('logs target info for wildcard version', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 17.0.0 (clang-1700.0.13.3)\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-target-triple') {
                    return { exitCode: 0, stdout: 'arm64-apple-darwin24.0.0\n', stderr: '' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-targets') {
                    return { exitCode: 0, stdout: '  Registered Targets:\n    aarch64 - AArch64\n', stderr: '' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            await main(makeInputs({ compiler: 'apple-clang', version: '*' }));

            expect(mockCoreStartGroup).toHaveBeenCalledWith('\uD83C\uDFAF Compiler target info');
            expect(mockCoreInfo).toHaveBeenCalledWith('Target triple: arm64-apple-darwin24.0.0');
        });

        it('warns but does not fail when target triple command fails', async () => {
            mockGetExecOutput.mockImplementation(async (_cmd: string, args?: string[]) => {
                if (args?.[0] === 'clang' && args?.[1] === '--version') {
                    return { exitCode: 0, stdout: 'Apple clang version 17.0.0\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang') {
                    return { exitCode: 0, stdout: '/usr/bin/clang\n', stderr: '' };
                }
                if (args?.[0] === '--find' && args?.[1] === 'clang++') {
                    return { exitCode: 0, stdout: '/usr/bin/clang++\n', stderr: '' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-target-triple') {
                    return { exitCode: 1, stdout: '', stderr: 'error' };
                }
                if (args?.[0] === 'clang' && args?.[1] === '--print-targets') {
                    return { exitCode: 1, stdout: '', stderr: 'error' };
                }
                return { exitCode: 0, stdout: '', stderr: '' };
            });

            const result = await main(makeInputs({ compiler: 'apple-clang', version: '*' }));

            expect(mockCoreWarning).toHaveBeenCalledWith('Failed to get target triple from xcrun clang --print-target-triple');
            expect(mockCoreWarning).toHaveBeenCalledWith('Failed to get supported targets from xcrun clang --print-targets');
            // Should still succeed
            expect(result).toEqual(expect.objectContaining({ version: '17.0.0' }));
        });

        it('does not log target info for non-apple-clang compilers', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc (Homebrew GCC 13.2.0) 13.2.0\n',
                stderr: ''
            });

            await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(mockCoreStartGroup).not.toHaveBeenCalledWith('\uD83C\uDFAF Compiler target info');
        });
    });

    describe('ensureSymbolizerEnvVars', () => {
        it('finds and exports symbolizer when searching PATH on non-Linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc (Homebrew GCC 13.2.0) 13.2.0\n',
                stderr: ''
            });
            mockFindLlvmSymbolizer.mockResolvedValue('/opt/homebrew/opt/llvm/bin/llvm-symbolizer');

            await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(mockFindLlvmSymbolizer).toHaveBeenCalledWith(13);
            expect(mockExportSymbolizerEnvVars).toHaveBeenCalledWith('/opt/homebrew/opt/llvm/bin/llvm-symbolizer');
        });

        it('skips symbolizer when LLVM_SYMBOLIZER_PATH already set', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            process.env['LLVM_SYMBOLIZER_PATH'] = '/some/path';
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc 13.2.0\n',
                stderr: ''
            });

            await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(mockFindLlvmSymbolizer).not.toHaveBeenCalled();
            delete process.env['LLVM_SYMBOLIZER_PATH'];
        });

        it('skips symbolizer when updateEnvironment is false', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc 13.2.0\n',
                stderr: ''
            });

            await main(makeInputs({ compiler: 'gcc', version: '*', updateEnvironment: false }));

            expect(mockFindLlvmSymbolizer).not.toHaveBeenCalled();
        });

        it('does not export when symbolizer not found', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            mockWhich.mockResolvedValue('/usr/local/bin/gcc');
            mockExistsSync.mockReturnValue(true);
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: 'gcc 13.2.0\n',
                stderr: ''
            });
            mockFindLlvmSymbolizer.mockResolvedValue(null);

            await main(makeInputs({ compiler: 'gcc', version: '*' }));

            expect(mockExportSymbolizerEnvVars).not.toHaveBeenCalled();
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
