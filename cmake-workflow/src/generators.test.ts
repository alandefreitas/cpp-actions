import * as exec from '@actions/exec';
import * as core from '@actions/core';

import { deriveGeneratorArchitectureFromArch, setupDefaultGenerator } from './generators';
import { type Inputs } from './schema';

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

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

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

const mockedExec = exec as jest.Mocked<typeof exec>;
const mockedCore = core as jest.Mocked<typeof core>;

/**
 * Creates a minimal Inputs object for generator tests.
 *
 * @param overrides - Partial overrides for default inputs
 * @returns Inputs object with sensible defaults
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        cmakePath: 'cmake',
        cmakeVersion: '*',
        sourceDir: '/home/user/project',
        url: '',
        gitRepository: '',
        gitTag: '',
        downloadDir: '',
        patches: [],
        buildDir: 'build',
        preset: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        ldflags: '',
        cxxstd: [],
        shared: undefined,
        toolchain: '',
        generator: '',
        generatorToolset: '',
        generatorArchitecture: '',
        arch: '',
        buildType: 'Release',
        buildTarget: [],
        extraArgs: [],
        exportCompileCommands: undefined,
        jobs: 4,
        runTests: undefined,
        configureTestsFlag: 'BUILD_TESTING',
        ctestTimeout: undefined,
        install: undefined,
        installPrefix: '',
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
        packageAllCxxstd: false,
        testAllCxxstd: false,
        installAllCxxstd: false,
        ...overrides
    } as Inputs;
}

describe('deriveGeneratorArchitectureFromArch', () => {
    it('maps x86 to Win32 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x86', 'Visual Studio 17 2022')).toBe('Win32');
    });

    it('maps arm64 to ARM64 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('arm64', 'Visual Studio 17 2022')).toBe('ARM64');
    });

    it('returns empty string for non-Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x64', 'Ninja')).toBe('');
    });

    it('maps x64 to x64 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x64', 'Visual Studio 17 2022')).toBe('x64');
    });

    it('maps arm to ARM for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('arm', 'Visual Studio 17 2022')).toBe('ARM');
    });

    it('returns empty string for empty arch', () => {
        expect(deriveGeneratorArchitectureFromArch('', 'Visual Studio 17 2022')).toBe('');
    });

    it('returns empty string for empty generator', () => {
        expect(deriveGeneratorArchitectureFromArch('x86', '')).toBe('');
    });
});

describe('setupDefaultGenerator', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        jest.clearAllMocks();
    });

    it('sets generator from cmake --system-information output', async () => {
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Ninja"\n  CMAKE_BUILD_TYPE ""\n',
            stderr: ''
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Ninja');
    });

    it('falls back to Unix Makefiles on non-windows when cmake fails', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Unix Makefiles');
    });

    it('falls back to Visual Studio on windows when cmake fails', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        // On Windows, first falls back to 'Visual Studio', then overrides to VS 17
        expect(inputs.generator).toBe('Visual Studio 17 2022');
    });

    it('overrides old Visual Studio generators on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Visual Studio 16 2019"\n',
            stderr: ''
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Visual Studio 17 2022');
    });

    it('does not override Visual Studio 17 on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Visual Studio 17 2022"\n',
            stderr: ''
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Visual Studio 17 2022');
    });

    it('derives generator architecture from arch when not explicitly set', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Visual Studio 17 2022"\n',
            stderr: ''
        });
        const inputs = makeInputs({ arch: 'x64', generatorArchitecture: '' });
        await setupDefaultGenerator(inputs);
        expect(inputs.generatorArchitecture).toBe('x64');
        expect(mockedCore.info).toHaveBeenCalledWith(
            expect.stringContaining('Derived CMake generator architecture')
        );
    });

    it('does not override explicit generator architecture', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Visual Studio 17 2022"\n',
            stderr: ''
        });
        const inputs = makeInputs({ arch: 'x64', generatorArchitecture: 'ARM64' });
        await setupDefaultGenerator(inputs);
        expect(inputs.generatorArchitecture).toBe('ARM64');
    });

    it('does not derive architecture for non-VS generators', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Ninja"\n',
            stderr: ''
        });
        const inputs = makeInputs({ arch: 'x64', generatorArchitecture: '' });
        await setupDefaultGenerator(inputs);
        expect(inputs.generatorArchitecture).toBe('');
    });

    it('falls back to Unix Makefiles when stdout has no generator match', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'Some other info\nNo generator here\n',
            stderr: ''
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Unix Makefiles');
    });

    it('overrides bare "Visual Studio" on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockedExec.getExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '  CMAKE_GENERATOR "Visual Studio"\n',
            stderr: ''
        });
        const inputs = makeInputs();
        await setupDefaultGenerator(inputs);
        expect(inputs.generator).toBe('Visual Studio 17 2022');
    });
});
