import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';

import { makeArgsString, makeFactorDescription, processEntry, detectClangMajorVersion, llvmProfileFilePattern } from './process-entry';
import { type ResolvedInputs, type SetupCMakeOutputs, type ResolvedParameters } from './types';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest.fn(),
    getBooleanInput: jest.fn(),
    getMultilineInput: jest.fn(),
    setOutput: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('@actions/io', () => ({
    mkdirP: jest.fn()
}));

const mockUploadArtifact = jest.fn().mockResolvedValue({ id: 1, size: 100 });
jest.mock('@actions/artifact', () => ({
    DefaultArtifactClient: jest.fn().mockImplementation(() => ({
        uploadArtifact: mockUploadArtifact
    }))
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    enabled: jest.fn(() => false)
}));

jest.mock('./annotations', () => ({
    createCMakeConfigureAnnotations: jest.fn(),
    createCMakeBuildAnnotations: jest.fn(),
    createCMakeTestAnnotations: jest.fn()
}));

const mockedExec = exec as jest.Mocked<typeof exec>;
const mockedCore = core as jest.Mocked<typeof core>;
const mockedIo = io as jest.Mocked<typeof io>;
const mockedTrace = traceCommands as jest.Mocked<typeof traceCommands>;

/**
 * Creates a minimal ResolvedInputs for process-entry tests.
 *
 * @param overrides - Partial overrides for default inputs
 * @returns ResolvedInputs with sensible defaults
 */
function makeInputs(overrides: Partial<ResolvedInputs> = {}): ResolvedInputs {
    return {
        cmakePath: '/usr/bin/cmake',
        cmakeVersion: '3.28.0',
        sourceDir: '/home/user/project',
        url: '',
        gitRepository: '',
        gitTag: '',
        downloadDir: '',
        patches: [],
        buildDir: '/home/user/project/build',
        preset: '',
        cc: '',
        ccflags: '',
        cxx: '/usr/bin/g++',
        cxxflags: '',
        ldflags: '',
        cxxstd: '17',
        shared: undefined,
        toolchain: '',
        generator: 'Ninja',
        generatorToolset: '',
        generatorArchitecture: '',
        arch: '',
        buildType: 'Release',
        buildTarget: [],
        extraArgs: [],
        exportCompileCommands: undefined,
        jobs: 4,
        runTests: true,
        configureTestsFlag: 'BUILD_TESTING',
        ctestTimeout: undefined,
        install: true,
        installPrefix: '/usr/local',
        package: undefined,
        packageName: '',
        packageDir: '',
        packageVendor: '',
        packageGenerators: [],
        packageArtifact: undefined,
        packageRetentionDays: 10,
        createAnnotations: true,
        refSourceDir: '/home/user/project',
        traceCommands: false,
        is_main_entry: true,
        testAllCxxstd: false,
        installAllCxxstd: undefined,
        packageAllCxxstd: false,
        ...overrides
    };
}

/**
 * Creates default SetupCMakeOutputs for tests.
 *
 * @param overrides - Partial overrides
 * @returns SetupCMakeOutputs with modern CMake defaults
 */
function makeSetupOutputs(overrides: Partial<SetupCMakeOutputs> = {}): SetupCMakeOutputs {
    return {
        path: '/usr/bin/cmake',
        dir: '/usr/bin',
        supportedPresetsVersion: 6,
        supportsPathToBuild: true,
        supportsBuildMultipleTargets: true,
        supportsParallelBuild: true,
        supportsCmakeInstall: true,
        ...overrides
    };
}

/**
 * Creates default ResolvedParameters for tests.
 *
 * @param overrides - Partial overrides
 * @returns ResolvedParameters with defaults
 */
function makeParams(overrides: Partial<ResolvedParameters> = {}): ResolvedParameters {
    return {
        mainCxxstd: '17',
        generatorIsMultiConfig: false,
        ctestPath: '/usr/bin/ctest',
        cpackPath: '/usr/bin/cpack',
        ...overrides
    };
}

/**
 * Sets up exec.getExecOutput mock to return success by default.
 */
function mockExecSuccess(): void {
    mockedExec.getExecOutput.mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: ''
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockExecSuccess();
});

// =====================================================
// makeArgsString
// =====================================================
describe('makeArgsString', () => {
    it('joins simple arguments with spaces', () => {
        expect(makeArgsString(['-S', '/src', '-B', '/build'])).toBe('-S /src -B /build');
    });

    it('quotes arguments containing spaces', () => {
        expect(makeArgsString(['-G', 'Visual Studio 17 2022'])).toBe('-G "Visual Studio 17 2022"');
    });

    it('escapes quotes within arguments containing spaces', () => {
        expect(makeArgsString(['-DFOO="bar baz"'])).toBe('"-DFOO=\\"bar baz\\""');
    });

    it('returns empty string for empty array', () => {
        expect(makeArgsString([])).toBe('');
    });
});

// =====================================================
// makeFactorDescription
// =====================================================
describe('makeFactorDescription', () => {
    it('includes cxxstd when set', () => {
        const entry = makeInputs({ cxxstd: '20' });
        expect(makeFactorDescription(entry)).toBe('C++20');
    });

    it('shows default when cxxstd is null', () => {
        const entry = makeInputs({ cxxstd: null });
        expect(makeFactorDescription(entry)).toBe('Default C++ standard');
    });

    it('includes extra_args_key prefix', () => {
        const entry = makeInputs({ extra_args_key: 'debug', cxxstd: '17' });
        expect(makeFactorDescription(entry)).toBe('debug: C++17');
    });

    it('includes extra_args_key with default standard', () => {
        const entry = makeInputs({ extra_args_key: 'asan', cxxstd: null });
        expect(makeFactorDescription(entry)).toBe('asan: Default C++ standard');
    });
});

// =====================================================
// detectClangMajorVersion
// =====================================================
describe('detectClangMajorVersion', () => {
    it('detects clang 16 from --version output', async () => {
        mockedExec.getExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'Ubuntu clang version 16.0.6 (++20231003085011+7cbf1a259152-1~exp1~20231003085123.106)\nTarget: x86_64-pc-linux-gnu\n',
            stderr: ''
        });
        expect(await detectClangMajorVersion('/usr/bin/clang++')).toBe(16);
    });

    it('detects clang 21 from --version output', async () => {
        mockedExec.getExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'clang version 21.1.0\nTarget: x86_64-unknown-linux-gnu\n',
            stderr: ''
        });
        expect(await detectClangMajorVersion('/usr/bin/c++')).toBe(21);
    });

    it('returns undefined for non-clang compiler output', async () => {
        mockedExec.getExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'g++ (Ubuntu 13.2.0-23ubuntu4) 13.2.0\n',
            stderr: ''
        });
        expect(await detectClangMajorVersion('/usr/bin/g++')).toBeUndefined();
    });

    it('returns undefined when command fails', async () => {
        mockedExec.getExecOutput.mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });
        expect(await detectClangMajorVersion('/nonexistent')).toBeUndefined();
    });

    it('returns undefined for undefined path', async () => {
        expect(await detectClangMajorVersion(undefined)).toBeUndefined();
    });

    it('returns undefined for empty string', async () => {
        expect(await detectClangMajorVersion('')).toBeUndefined();
    });
});

// =====================================================
// llvmProfileFilePattern
// =====================================================
describe('llvmProfileFilePattern', () => {
    it('returns %p-%m pattern for clang 16', () => {
        const pattern = llvmProfileFilePattern(16);
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).not.toContain('%b');
        expect(pattern).toMatch(/\.profraw$/);
    });

    it('returns %b-%p-%m pattern for clang 21', () => {
        const pattern = llvmProfileFilePattern(21);
        expect(pattern).toContain('%b');
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).toMatch(/\.profraw$/);
    });

    it('returns %p-%m pattern for undefined version', () => {
        const pattern = llvmProfileFilePattern(undefined);
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).not.toContain('%b');
    });
});

// =====================================================
// processEntry — configure step
// =====================================================
describe('processEntry — configure step', () => {
    it('passes -S and -B when supportsPathToBuild is true', async () => {
        const entry = makeInputs();
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const configureCall = mockedExec.getExecOutput.mock.calls[0];
        expect(configureCall[1]).toEqual(expect.arrayContaining(['-S', '/home/user/project', '-B', '/home/user/project/build']));
    });

    it('omits -S/-B and appends sourceDir when supportsPathToBuild is false', async () => {
        const entry = makeInputs();
        const outputs = makeSetupOutputs({ supportsPathToBuild: false });
        await processEntry(entry, outputs, makeParams());

        const configureCall = mockedExec.getExecOutput.mock.calls[0];
        const args = configureCall[1] as string[];
        expect(args).not.toContain('-S');
        expect(args).not.toContain('-B');
        // sourceDir should be last argument
        expect(args[args.length - 1]).toBe('/home/user/project');
        // Should create buildDir
        expect(mockedIo.mkdirP).toHaveBeenCalledWith('/home/user/project/build');
    });

    it('adds preset argument when set', async () => {
        const entry = makeInputs({ preset: 'my-preset' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('--preset=my-preset');
    });

    it('adds generator arguments', async () => {
        const entry = makeInputs({ generator: 'Unix Makefiles', generatorToolset: 'v142', generatorArchitecture: 'x64' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('-G');
        expect(args).toContain('Unix Makefiles');
        expect(args).toContain('-T');
        expect(args).toContain('v142');
        expect(args).toContain('-A');
        expect(args).toContain('x64');
    });

    it('handles Visual Studio /m32 flag removal', async () => {
        const entry = makeInputs({
            generator: 'Visual Studio 17 2022',
            cxxflags: '-Wall /m32 -O2',
            ccflags: '/m32 -O2'
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('Win32');
        // /m32 should be removed from cxxflags and ccflags
        const cxxflagsIdx = args.indexOf('CMAKE_CXX_FLAGS=-Wall -O2');
        const ccflagsIdx = args.indexOf('CMAKE_C_FLAGS=-O2');
        expect(cxxflagsIdx).toBeGreaterThan(-1);
        expect(ccflagsIdx).toBeGreaterThan(-1);
    });

    it('sets CMAKE_EXE_LINKER_FLAGS from ldflags', async () => {
        const entry = makeInputs({ ldflags: '-fsanitize=address' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_EXE_LINKER_FLAGS=-fsanitize=address');
    });

    it('does not set CMAKE_EXE_LINKER_FLAGS when ldflags is empty', async () => {
        const entry = makeInputs({ ldflags: '' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        const hasLinkerFlags = args.some(a => a.includes('CMAKE_EXE_LINKER_FLAGS'));
        expect(hasLinkerFlags).toBe(false);
    });

    it('sets CMAKE_BUILD_TYPE for single-config generators', async () => {
        const entry = makeInputs({ buildType: 'Debug' });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: false }));

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_BUILD_TYPE=Debug');
    });

    it('does not set CMAKE_BUILD_TYPE for multi-config generators', async () => {
        const entry = makeInputs({ buildType: 'Debug' });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: true }));

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args.join(' ')).not.toContain('CMAKE_BUILD_TYPE');
    });

    it('sets toolchain file', async () => {
        const entry = makeInputs({ toolchain: '/path/to/toolchain.cmake' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_TOOLCHAIN_FILE=/path/to/toolchain.cmake');
    });

    it('sets configure tests flag with = syntax', async () => {
        const entry = makeInputs({ runTests: true, configureTestsFlag: 'BUILD_TESTING=ON' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('BUILD_TESTING=ON');
    });

    it('sets configure tests flag without = syntax', async () => {
        const entry = makeInputs({ runTests: true, configureTestsFlag: 'BUILD_TESTING' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('BUILD_TESTING=ON');
    });

    it('sets BUILD_SHARED_LIBS when shared is true', async () => {
        const entry = makeInputs({ shared: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('BUILD_SHARED_LIBS=ON');
    });

    it('sets compiler paths', async () => {
        const entry = makeInputs({ cc: '/usr/bin/gcc', cxx: '/usr/bin/g++' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_C_COMPILER=/usr/bin/gcc');
        expect(args).toContain('CMAKE_CXX_COMPILER=/usr/bin/g++');
    });

    it('sets cxxstd', async () => {
        const entry = makeInputs({ cxxstd: '20' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_CXX_STANDARD=20');
    });

    it('sets export compile commands ON', async () => {
        const entry = makeInputs({ exportCompileCommands: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_EXPORT_COMPILE_COMMANDS=ON');
    });

    it('sets export compile commands OFF', async () => {
        const entry = makeInputs({ exportCompileCommands: false });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_EXPORT_COMPILE_COMMANDS=OFF');
    });

    it('sets install prefix', async () => {
        const entry = makeInputs({ installPrefix: '/opt/install' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CMAKE_INSTALL_PREFIX=/opt/install');
    });

    it('sets package parameters', async () => {
        const entry = makeInputs({
            packageName: 'mylib',
            packageGenerators: ['TGZ', 'DEB'],
            packageDir: '/tmp/packages',
            packageVendor: 'ACME'
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('CPACK_GENERATOR=TGZ;DEB');
        expect(args).toContain('CPACK_PACKAGE_NAME=mylib');
        expect(args).toContain('CPACK_PACKAGE_DIRECTORY=/tmp/packages');
        expect(args).toContain('CPACK_PACKAGE_VENDOR=ACME');
    });

    it('appends extra args', async () => {
        const entry = makeInputs({ extraArgs: ['-DFOO=bar', '-DBAZ=1'] });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('-DFOO=bar');
        expect(args).toContain('-DBAZ=1');
    });

    it('includes --no-warn-unused-cli', async () => {
        await processEntry(makeInputs(), makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('--no-warn-unused-cli');
    });

    it('throws on configure failure', async () => {
        mockedExec.getExecOutput.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
        await expect(processEntry(makeInputs(), makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CMake configure failed with exit code 1');
    });

    it('calls createCMakeConfigureAnnotations when enabled', async () => {
        const { createCMakeConfigureAnnotations } = require('./annotations');
        const entry = makeInputs({ createAnnotations: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(createCMakeConfigureAnnotations).toHaveBeenCalled();
    });
});

// =====================================================
// processEntry — build step
// =====================================================
describe('processEntry — build step', () => {
    it('passes --build and --parallel args', async () => {
        await processEntry(makeInputs(), makeSetupOutputs(), makeParams());

        // Build is the second exec call
        const buildCall = mockedExec.getExecOutput.mock.calls[1];
        const args = buildCall[1] as string[];
        expect(args).toContain('--build');
        expect(args).toContain('--parallel');
        expect(args).toContain('4');
    });

    it('adds --config for multi-config generators', async () => {
        const entry = makeInputs({ buildType: 'Debug' });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: true }));

        const buildCall = mockedExec.getExecOutput.mock.calls[1];
        const args = buildCall[1] as string[];
        expect(args).toContain('--config');
        expect(args).toContain('Debug');
    });

    it('omits --parallel when not supported', async () => {
        const outputs = makeSetupOutputs({ supportsParallelBuild: false });
        await processEntry(makeInputs(), outputs, makeParams());

        const buildCall = mockedExec.getExecOutput.mock.calls[1];
        const args = buildCall[1] as string[];
        expect(args).not.toContain('--parallel');
    });

    it('builds specific targets', async () => {
        const entry = makeInputs({ buildTarget: ['all', 'tests'] });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // With supportsBuildMultipleTargets, targets are joined into one call
        const buildCall = mockedExec.getExecOutput.mock.calls[1];
        const args = buildCall[1] as string[];
        expect(args).toContain('--target');
        expect(args).toContain('all');
        expect(args).toContain('tests');
    });

    it('builds targets one at a time when multi-target not supported', async () => {
        const entry = makeInputs({ buildTarget: ['target1', 'target2'] });
        const outputs = makeSetupOutputs({ supportsBuildMultipleTargets: false });
        await processEntry(entry, outputs, makeParams());

        // Two separate build calls (calls[1] and calls[2])
        expect(mockedExec.getExecOutput.mock.calls[1][1]).toContain('target1');
        expect(mockedExec.getExecOutput.mock.calls[2][1]).toContain('target2');
    });

    it('throws on build failure', async () => {
        // First call succeeds (configure), second fails (build)
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });

        await expect(processEntry(makeInputs(), makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CMake build failed with exit code 1');
    });

    it('calls createCMakeBuildAnnotations when enabled', async () => {
        const { createCMakeBuildAnnotations } = require('./annotations');
        await processEntry(makeInputs({ createAnnotations: true }), makeSetupOutputs(), makeParams());
        expect(createCMakeBuildAnnotations).toHaveBeenCalled();
    });
});

// =====================================================
// processEntry — test step
// =====================================================
describe('processEntry — test step', () => {
    it('runs tests for main entry with runTests=true', async () => {
        const entry = makeInputs({ runTests: true, is_main_entry: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Configure, Build, Test, Install = 4 calls (install defaults to true)
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(4);
        const testCall = mockedExec.getExecOutput.mock.calls[2];
        expect(testCall[0]).toBe('"/usr/bin/ctest"');
        const args = testCall[1] as string[];
        expect(args).toContain('--test-dir');
        expect(args).toContain('--no-tests=error');
        expect(args).toContain('--progress');
        expect(args).toContain('--output-on-failure');
    });

    it('skips tests when runTests is false', async () => {
        const entry = makeInputs({ runTests: false, is_main_entry: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Only configure + build = 2 calls (install also runs because install=true)
        // But test is skipped because runTests === false
        const callArgs = mockedExec.getExecOutput.mock.calls.map(c => c[0]);
        expect(callArgs).not.toContain('"/usr/bin/ctest"');
    });

    it('skips tests for non-main entry when testAllCxxstd is false', async () => {
        const entry = makeInputs({ runTests: true, is_main_entry: false, testAllCxxstd: false });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const callArgs = mockedExec.getExecOutput.mock.calls.map(c => c[0]);
        expect(callArgs).not.toContain('"/usr/bin/ctest"');
    });

    it('runs tests for non-main entry when testAllCxxstd is true', async () => {
        const entry = makeInputs({ runTests: true, is_main_entry: false, testAllCxxstd: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const callArgs = mockedExec.getExecOutput.mock.calls.map(c => c[0]);
        expect(callArgs).toContain('"/usr/bin/ctest"');
    });

    it('uses --no-tests=ignore when runTests is undefined', async () => {
        const entry = makeInputs({ runTests: undefined, is_main_entry: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const testCall = mockedExec.getExecOutput.mock.calls[2];
        const args = testCall[1] as string[];
        expect(args).toContain('--no-tests=ignore');
    });

    it('adds --build-config for multi-config generators', async () => {
        const entry = makeInputs({ runTests: true, buildType: 'Debug' });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: true }));

        const testCall = mockedExec.getExecOutput.mock.calls[2];
        const args = testCall[1] as string[];
        expect(args).toContain('--build-config');
        expect(args).toContain('Debug');
    });

    it('adds --timeout when ctestTimeout is set', async () => {
        const entry = makeInputs({ runTests: true, ctestTimeout: 120 });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const testCall = mockedExec.getExecOutput.mock.calls[2];
        const args = testCall[1] as string[];
        expect(args).toContain('--timeout');
        expect(args).toContain('120');
    });

    it('throws on test failure when runTests is true', async () => {
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }); // test

        const entry = makeInputs({ runTests: true });
        await expect(processEntry(entry, makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CMake tests failed with exit code 1');
    });

    it('throws on test failure when runTests is undefined', async () => {
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }); // test

        const entry = makeInputs({ runTests: undefined, is_main_entry: true });
        await expect(processEntry(entry, makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CMake tests failed with exit code 1');
    });

    it('calls createCMakeTestAnnotations', async () => {
        const { createCMakeTestAnnotations } = require('./annotations');
        const entry = makeInputs({ runTests: true, createAnnotations: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(createCMakeTestAnnotations).toHaveBeenCalled();
    });
});

// =====================================================
// processEntry — LLVM_PROFILE_FILE
// =====================================================
describe('processEntry — LLVM_PROFILE_FILE', () => {
    let savedProfileFile: string | undefined;

    beforeEach(() => {
        savedProfileFile = process.env['LLVM_PROFILE_FILE'];
        delete process.env['LLVM_PROFILE_FILE'];
    });

    afterEach(() => {
        if (savedProfileFile !== undefined) {
            process.env['LLVM_PROFILE_FILE'] = savedProfileFile;
        } else {
            delete process.env['LLVM_PROFILE_FILE'];
        }
    });

    it('sets LLVM_PROFILE_FILE with %p and %m for pre-21 clang', async () => {
        // configure, build, --version, test
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'clang version 16.0.6\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
        const entry = makeInputs({
            cxxflags: '-fprofile-instr-generate -fcoverage-mapping',
            cxx: '/usr/bin/c++',
            runTests: true,
            install: false
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(process.env['LLVM_PROFILE_FILE']).toBeDefined();
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%p');
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%m');
        expect(process.env['LLVM_PROFILE_FILE']).not.toContain('%b');
    });

    it('sets LLVM_PROFILE_FILE with %b for clang 21+', async () => {
        // configure, build, --version, test
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'clang version 21.1.0\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
        const entry = makeInputs({
            cxxflags: '-fprofile-instr-generate -fcoverage-mapping',
            cxx: '/usr/bin/c++',
            runTests: true,
            install: false
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(process.env['LLVM_PROFILE_FILE']).toBeDefined();
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%b');
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%p');
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%m');
    });

    it('falls back to %p-%m when --version output is not clang', async () => {
        // configure, build, --version (gcc output), test
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'g++ (Ubuntu 13.2.0) 13.2.0\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
        const entry = makeInputs({
            cxxflags: '-fprofile-instr-generate -fcoverage-mapping',
            cxx: '/usr/bin/c++',
            runTests: true,
            install: false
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(process.env['LLVM_PROFILE_FILE']).toBeDefined();
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%p');
        expect(process.env['LLVM_PROFILE_FILE']).toContain('%m');
        expect(process.env['LLVM_PROFILE_FILE']).not.toContain('%b');
    });

    it('does not override existing LLVM_PROFILE_FILE', async () => {
        process.env['LLVM_PROFILE_FILE'] = 'custom-%p.profraw';
        const entry = makeInputs({
            cxxflags: '-fprofile-instr-generate -fcoverage-mapping',
            cxx: '/usr/bin/c++',
            runTests: true,
            install: false
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(process.env['LLVM_PROFILE_FILE']).toBe('custom-%p.profraw');
    });

    it('does not set LLVM_PROFILE_FILE without coverage flags', async () => {
        const entry = makeInputs({
            cxxflags: '-Wall -O2',
            runTests: true,
            install: false
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(process.env['LLVM_PROFILE_FILE']).toBeUndefined();
    });
});

// =====================================================
// processEntry — install step
// =====================================================
describe('processEntry — install step', () => {
    it('runs install for main entry with install=true', async () => {
        const entry = makeInputs({ install: true, runTests: false, is_main_entry: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // configure, build, install = 3 calls
        const installCall = mockedExec.getExecOutput.mock.calls[2];
        const args = installCall[1] as string[];
        expect(args).toContain('--install');
    });

    it('uses cmake --install with prefix when supported', async () => {
        const entry = makeInputs({ install: true, runTests: false, installPrefix: '/opt/prefix' });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const installCall = mockedExec.getExecOutput.mock.calls[2];
        const args = installCall[1] as string[];
        expect(args).toContain('--install');
        expect(args).toContain('--prefix');
        expect(args).toContain('/opt/prefix');
    });

    it('falls back to --build --target install when cmake install not supported', async () => {
        const outputs = makeSetupOutputs({ supportsCmakeInstall: false });
        const entry = makeInputs({ install: true, runTests: false });
        await processEntry(entry, outputs, makeParams());

        const installCall = mockedExec.getExecOutput.mock.calls[2];
        const args = installCall[1] as string[];
        expect(args).toContain('--build');
        expect(args).toContain('--target');
        expect(args).toContain('install');
        expect(args).not.toContain('--install');
    });

    it('skips install for non-main entry when installAllCxxstd is falsy', async () => {
        const entry = makeInputs({ install: true, runTests: false, is_main_entry: false, installAllCxxstd: undefined });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Only configure + build = 2 calls
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(2);
    });

    it('runs install for non-main entry when installAllCxxstd is true', async () => {
        const entry = makeInputs({ install: true, runTests: false, is_main_entry: false, installAllCxxstd: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(3);
    });

    it('adds --config for multi-config generators', async () => {
        const entry = makeInputs({ install: true, runTests: false, buildType: 'Release' });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: true }));

        const installCall = mockedExec.getExecOutput.mock.calls[2];
        const args = installCall[1] as string[];
        expect(args).toContain('--config');
        expect(args).toContain('Release');
    });

    it('throws on install failure when install is true', async () => {
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }); // install

        const entry = makeInputs({ install: true, runTests: false });
        await expect(processEntry(entry, makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CMake install failed with exit code 1');
    });

    it('does not throw on install failure when install is undefined', async () => {
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }); // install

        const entry = makeInputs({ install: undefined, runTests: false, is_main_entry: true });
        await expect(processEntry(entry, makeSetupOutputs(), makeParams())).resolves.not.toThrow();
    });

    it('creates install directory', async () => {
        const entry = makeInputs({ install: true, runTests: false, installPrefix: '/opt/install' });
        await processEntry(entry, makeSetupOutputs(), makeParams());
        expect(mockedIo.mkdirP).toHaveBeenCalledWith('/opt/install');
    });
});

// =====================================================
// processEntry — package step
// =====================================================
describe('processEntry — package step', () => {
    it('runs package when package=true for main entry', async () => {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: ['TGZ'],
            packageName: 'mylib'
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // configure, build, package = 3 calls
        const packageCall = mockedExec.getExecOutput.mock.calls[2];
        expect(packageCall[0]).toBe('"/usr/bin/cpack"');
        const args = packageCall[1] as string[];
        expect(args).toContain('-G');
        expect(args).toContain('TGZ');
    });

    it('skips package when package is undefined', async () => {
        const entry = makeInputs({ package: undefined, runTests: false, install: false });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Only configure + build
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(2);
    });

    it('adds --verbose when trace commands is enabled', async () => {
        mockedTrace.enabled.mockReturnValue(true);
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: ['TGZ']
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const packageCall = mockedExec.getExecOutput.mock.calls[2];
        const args = packageCall[1] as string[];
        expect(args).toContain('--verbose');
    });

    it('adds package name, dir, and vendor', async () => {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: ['DEB'],
            packageName: 'mylib',
            packageDir: '/tmp/pkg',
            packageVendor: 'ACME'
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        const args = mockedExec.getExecOutput.mock.calls[2][1] as string[];
        expect(args).toContain('-P');
        expect(args).toContain('mylib');
        expect(args).toContain('-B');
        expect(args).toContain('/tmp/pkg');
        expect(args).toContain('--vendor');
        expect(args).toContain('ACME');
    });

    it('adds -C config for multi-config generators', async () => {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            buildType: 'Release',
            packageGenerators: ['TGZ']
        });
        await processEntry(entry, makeSetupOutputs(), makeParams({ generatorIsMultiConfig: true }));

        const args = mockedExec.getExecOutput.mock.calls[2][1] as string[];
        expect(args).toContain('-C');
        expect(args).toContain('Release');
    });

    it('throws on package failure with explicit generators', async () => {
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }); // package

        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: ['TGZ']
        });
        await expect(processEntry(entry, makeSetupOutputs(), makeParams()))
            .rejects.toThrow('CPack (generator: TGZ) failed with exit code 1');
    });

    it('discovers generators from cpack --help when none specified', async () => {
        const cpackHelpOutput = [
            'CPack 3.28.0',
            '',
            'Generators',
            '  TGZ                            = TAR GZip',
            '  ZIP                            = ZIP file format',
            ''
        ].join('\n');

        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: cpackHelpOutput, stderr: '' })  // cpack --help
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'CPack: - package: /tmp/pkg/mylib.tar.gz generated.\n', stderr: '' })  // TGZ
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'CPack: - package: /tmp/pkg/mylib.zip generated.\n', stderr: '' });    // ZIP

        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: [],
            packageName: 'mylib'
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // cpack --help + 2 generator runs = 3 cpack calls
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(5);
    });

    it('stops parsing generators on malformed line in cpack --help', async () => {
        const cpackHelpOutput = [
            'CPack 3.28.0',
            '',
            'Generators',
            '  TGZ                            = TAR GZip',
            '  This line has no equals sign',
            '  ZIP                            = ZIP file format',
            ''
        ].join('\n');

        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: cpackHelpOutput, stderr: '' })  // cpack --help
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'CPack: - package: /tmp/pkg/mylib.tar.gz generated.\n', stderr: '' });

        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: []
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Only TGZ should be discovered (parsing stops at malformed line before ZIP)
        // configure + build + cpack --help + TGZ = 4 calls
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(4);
    });

    it('continues on failure with default generators', async () => {
        const cpackHelpOutput = 'Generators\n  TGZ                            = TAR GZip\n  NSIS                           = NSIS\n\n';

        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })   // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: cpackHelpOutput, stderr: '' })  // cpack --help
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' })   // TGZ fails
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });  // NSIS succeeds

        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageGenerators: []
        });
        // Should not throw — default generators allow failure
        await expect(processEntry(entry, makeSetupOutputs(), makeParams())).resolves.not.toThrow();
    });

    it('skips package for non-main entry when packageAllCxxstd is false', async () => {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            is_main_entry: false,
            packageAllCxxstd: false,
            packageGenerators: ['TGZ']
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Only configure + build
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(2);
    });

    it('runs package for non-main entry when packageAllCxxstd is true', async () => {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            is_main_entry: false,
            packageAllCxxstd: true,
            packageGenerators: ['TGZ']
        });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(3);
    });
});

// =====================================================
// processEntry — full workflow
// =====================================================
describe('processEntry — full workflow', () => {
    it('runs all steps: configure, build, test, install', async () => {
        const entry = makeInputs({ runTests: true, install: true });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // configure + build + test + install = 4
        expect(mockedExec.getExecOutput).toHaveBeenCalledTimes(4);
        expect(mockedCore.startGroup).toHaveBeenCalledWith(expect.stringContaining('Configure'));
        expect(mockedCore.startGroup).toHaveBeenCalledWith(expect.stringContaining('Build'));
        expect(mockedCore.startGroup).toHaveBeenCalledWith(expect.stringContaining('Test'));
        expect(mockedCore.startGroup).toHaveBeenCalledWith(expect.stringContaining('Install'));
        expect(mockedCore.endGroup).toHaveBeenCalledTimes(4);
    });

    it('skips annotations when createAnnotations is false', async () => {
        const { createCMakeConfigureAnnotations, createCMakeBuildAnnotations } = require('./annotations');
        const entry = makeInputs({ createAnnotations: false, runTests: false, install: false });
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(createCMakeConfigureAnnotations).not.toHaveBeenCalled();
        expect(createCMakeBuildAnnotations).not.toHaveBeenCalled();
    });
});

// =====================================================
// processEntry — uploadPackageArtifacts (via package step)
// =====================================================
describe('processEntry — artifact upload', () => {
    /**
     * Helper to set up a package step that produces output files.
     *
     * @param entryOverrides - Additional entry overrides
     * @param packageOutput - The cpack stdout that contains generated file paths
     */
    function setupPackageWithOutput(
        entryOverrides: Partial<ResolvedInputs>,
        packageOutput: string
    ): ResolvedInputs {
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageArtifact: true,
            packageGenerators: ['TGZ'],
            ...entryOverrides
        });
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: packageOutput, stderr: '' }); // cpack
        return entry;
    }

    it('uploads artifact when packageArtifact is true and packages are generated', async () => {
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.0-Linux.tar.gz generated.\n';
        const entry = setupPackageWithOutput({}, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('packages'),
            ['/tmp/packages/mylib-1.0.0-Linux.tar.gz'],
            '/tmp/packages',
            { retentionDays: 10 }
        );
    });

    it('determines common prefix from multiple package files', async () => {
        const cpackHelpOutput = 'Generators\n  TGZ                            = TAR GZip\n  ZIP                            = ZIP\n\n';
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageArtifact: true,
            packageGenerators: []
        });
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: cpackHelpOutput, stderr: '' }) // cpack --help
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'CPack: - package: /tmp/pkg/mylib-1.0.tar.gz generated.\n', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'CPack: - package: /tmp/pkg/mylib-1.0.zip generated.\n', stderr: '' });

        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('packages'),
            ['/tmp/pkg/mylib-1.0.tar.gz', '/tmp/pkg/mylib-1.0.zip'],
            '/tmp/pkg',
            expect.any(Object)
        );
    });

    it('adds gcc compiler suffix to artifact name', async () => {
        const origRunnerOs = process.env['RUNNER_OS'];
        process.env['RUNNER_OS'] = 'Linux';
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '/usr/bin/g++-12' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-gcc-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
        process.env['RUNNER_OS'] = origRunnerOs;
    });

    it('adds clang compiler suffix to artifact name', async () => {
        const origRunnerOs = process.env['RUNNER_OS'];
        process.env['RUNNER_OS'] = 'Linux';
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '/usr/bin/clang++-15' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-clang-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
        process.env['RUNNER_OS'] = origRunnerOs;
    });

    it('adds msvc suffix for cl compiler', async () => {
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: 'cl.exe' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-msvc-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
    });

    it('uses RUNNER_OS env variable for artifact name', async () => {
        const originalRunnerOs = process.env['RUNNER_OS'];
        process.env['RUNNER_OS'] = 'macOS';
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('macos'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
        if (originalRunnerOs === undefined) {
            delete process.env['RUNNER_OS'];
        } else {
            process.env['RUNNER_OS'] = originalRunnerOs;
        }
    });

    it('does not upload when packageArtifact is falsy', async () => {
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageArtifact: undefined,
            packageGenerators: ['TGZ']
        });
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: output, stderr: '' });

        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).not.toHaveBeenCalled();
    });

    it('does not upload when no packages are generated', async () => {
        mockExecSuccess();
        const entry = makeInputs({
            package: true,
            runTests: false,
            install: false,
            packageArtifact: true,
            packageGenerators: ['TGZ']
        });
        // cpack succeeds but stdout has no matching package line
        mockedExec.getExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // configure
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // build
            .mockResolvedValueOnce({ exitCode: 0, stdout: 'Some output without package line\n', stderr: '' }); // cpack

        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).not.toHaveBeenCalled();
    });

    it('adds no compiler suffix when cxx does not match known compilers', async () => {
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '/usr/bin/icc' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        // Should still upload but without a compiler-specific suffix
        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
    });

    it('uses CPP_ACTIONS_COMPILER env var for artifact name when set', async () => {
        const origCompiler = process.env['CPP_ACTIONS_COMPILER'];
        process.env['CPP_ACTIONS_COMPILER'] = 'clang-cl';
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '/usr/bin/clang++' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-clang-cl-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
        process.env['CPP_ACTIONS_COMPILER'] = origCompiler;
    });

    it('distinguishes apple-clang from macos-clang via env var', async () => {
        const origCompiler = process.env['CPP_ACTIONS_COMPILER'];
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';

        process.env['CPP_ACTIONS_COMPILER'] = 'apple-clang';
        const entry1 = setupPackageWithOutput({ cxx: '/usr/bin/clang++' }, output);
        await processEntry(entry1, makeSetupOutputs(), makeParams());
        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-apple-clang-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );

        mockUploadArtifact.mockClear();
        process.env['CPP_ACTIONS_COMPILER'] = 'macos-clang';
        const entry2 = setupPackageWithOutput({ cxx: '/usr/bin/clang++' }, output);
        await processEntry(entry2, makeSetupOutputs(), makeParams());
        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-macos-clang-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );

        process.env['CPP_ACTIONS_COMPILER'] = origCompiler;
    });

    it('distinguishes gcc from macos-gcc via env var', async () => {
        const origCompiler = process.env['CPP_ACTIONS_COMPILER'];
        const origRunnerOs = process.env['RUNNER_OS'];
        process.env['RUNNER_OS'] = 'macOS';
        process.env['CPP_ACTIONS_COMPILER'] = 'macos-gcc';
        const output = 'CPack: - package: /tmp/packages/mylib-1.0.tar.gz generated.\n';
        const entry = setupPackageWithOutput({ cxx: '/opt/homebrew/bin/g++-15' }, output);
        await processEntry(entry, makeSetupOutputs(), makeParams());

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            expect.stringContaining('-macos-gcc-packages'),
            expect.any(Array),
            expect.any(String),
            expect.any(Object)
        );
        process.env['RUNNER_OS'] = origRunnerOs;
        process.env['CPP_ACTIONS_COMPILER'] = origCompiler;
    });
});
