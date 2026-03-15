import * as io from '@actions/io';

jest.mock('@actions/io');
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

jest.mock('setup-cmake', () => ({
    main: jest.fn()
}));

jest.mock('./presets', () => ({
    resolvePreset: jest.fn()
}));

jest.mock('./generators', () => ({
    normalizeArchitectureInput: jest.fn((v: string) => v),
    deriveGeneratorArchitectureFromArch: jest.fn(),
    setupDefaultGenerator: jest.fn()
}));

jest.mock('./source-download', () => ({
    downloadSourceCode: jest.fn(),
    applyPatches: jest.fn()
}));

jest.mock('./process-entry', () => ({
    processEntry: jest.fn(),
    makeFactorDescription: jest.fn(() => 'cxx17')
}));

import * as main from './index';
import * as setup_cmake from 'setup-cmake';
import { processEntry } from './process-entry';
import { downloadSourceCode, applyPatches } from './source-download';
import { setupDefaultGenerator } from './generators';
import { type Inputs } from './schema';
import { describePrettyErrors } from 'pretty-errors/test-helper';

/**
 * Creates a minimal Inputs object for testing.
 *
 * @param overrides - Fields to override
 * @returns Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        preset: '',
        buildType: '',
        buildDir: 'build',
        cmakePath: 'cmake',
        generator: '',
        generatorToolset: '',
        generatorArchitecture: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        cxxstd: [],
        exportCompileCommands: undefined,
        runTests: undefined,
        configureTestsFlag: '',
        ctestTimeout: undefined,
        shared: undefined,
        toolchain: '',
        sourceDir: '/src',
        installPrefix: '',
        packageDir: '',
        packageName: '',
        packageVendor: '',
        packageGenerators: [],
        extraArgs: [],
        cmakeVersion: '',
        url: '',
        gitRepository: '',
        gitTag: '',
        downloadDir: '',
        patches: [],
        arch: '',
        buildTarget: [],
        jobs: 1,
        testAllCxxstd: false,
        install: undefined,
        installAllCxxstd: false,
        package: undefined,
        packageAllCxxstd: false,
        packageArtifact: undefined,
        packageRetentionDays: 10,
        createAnnotations: undefined,
        refSourceDir: '',
        traceCommands: false,
        ...overrides
    };
}

const defaultSetupOutputs = {
    path: '/usr/bin/cmake',
    dir: '/usr/bin',
    supportedPresetsVersion: 7
};

describe('resolveInputParameters', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sets default buildType and buildDir when no preset', async () => {
        const inputs = makeInputs({ preset: '', buildType: '', buildDir: '' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.buildType).toBe('Release');
        // buildDir gets resolved to absolute path via path.resolve(sourceDir, buildDir)
        expect(inputs.buildDir).toContain('build');
    });

    it('does not override buildType/buildDir when preset is set', async () => {
        const inputs = makeInputs({ preset: 'dev', buildType: '', buildDir: '' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.buildType).toBe('');
        expect(inputs.buildDir).toBe('');
    });

    it('sets cmakePath from setupCMakeOutputs', async () => {
        const inputs = makeInputs();
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.cmakePath).toBe('/usr/bin/cmake');
    });

    it('calls setupDefaultGenerator when no generator and no preset', async () => {
        const inputs = makeInputs({ generator: '', preset: '' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(setupDefaultGenerator).toHaveBeenCalledWith(inputs);
    });

    it('does not call setupDefaultGenerator when generator is set', async () => {
        const inputs = makeInputs({ generator: 'Ninja' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(setupDefaultGenerator).not.toHaveBeenCalled();
    });

    it('detects multi-config generators', async () => {
        const inputs = makeInputs({ generator: 'Visual Studio 17 2022' });
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.generatorIsMultiConfig).toBe(true);
    });

    it('detects single-config generators', async () => {
        const inputs = makeInputs({ generator: 'Ninja' });
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.generatorIsMultiConfig).toBe(false);
    });

    it('detects Ninja Multi-Config as multi-config', async () => {
        const inputs = makeInputs({ generator: 'Ninja Multi-Config' });
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.generatorIsMultiConfig).toBe(true);
    });

    it('detects Xcode as multi-config', async () => {
        const inputs = makeInputs({ generator: 'Xcode' });
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.generatorIsMultiConfig).toBe(true);
    });

    it('defaults empty cxxstd to [null]', async () => {
        const inputs = makeInputs({ cxxstd: [] });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.cxxstd).toEqual([null]);
    });

    it('preserves non-empty cxxstd', async () => {
        const inputs = makeInputs({ cxxstd: ['17', '20'] });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.cxxstd).toEqual(['17', '20']);
    });

    it('returns ctestPath and cpackPath from setupCMakeOutputs dir', async () => {
        const inputs = makeInputs();
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.ctestPath).toContain('ctest');
        expect(result.cpackPath).toContain('cpack');
    });

    it('resolves installPrefix and packageDir paths', async () => {
        const inputs = makeInputs({
            installPrefix: 'my-install',
            packageDir: 'my-packages',
            buildDir: 'build',
            sourceDir: '/src'
        });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        // installPrefix should be resolved to an absolute path
        expect(inputs.installPrefix).toContain('my-install');
        // packageDir should be resolved relative to buildDir
        expect(inputs.packageDir).toContain('my-packages');
    });

    it('resolves mainCxxstd to last element of cxxstd array', async () => {
        const inputs = makeInputs({ cxxstd: ['17', '20', '23'] });
        const result = await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(result.mainCxxstd).toBe('23');
    });

    it('normalizes Windows packageDir to avoid escape sequences', async () => {
        // Skip this test on non-Windows platforms since we can't reliably mock path.resolve
        if (process.platform !== 'win32') {
            expect(main._normalizePathForCMake).toBeDefined();
            return;
        }

        const inputs = makeInputs({
            sourceDir: 'D:/a/mrdocs/mrdocs',
            installPrefix: 'install',
            packageDir: 'packages',
            generator: 'Ninja'
        });

        const setupCMakeOutputs = {
            path: 'cmake',
            dir: 'C:/Program Files/CMake/bin',
            supportedPresetsVersion: 7
        };

        await main._resolveInputParameters(inputs, setupCMakeOutputs);
        expect(inputs.installPrefix.includes('\\')).toBe(false);
        expect(inputs.packageDir).toBe('D:/a/mrdocs/mrdocs/build/packages');
    });
});

describe('resolveCompilerPath (via resolveInputParameters)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('resolves compiler name via io.which when name-only', async () => {
        (io.which as jest.Mock).mockResolvedValue('/usr/bin/gcc');
        const inputs = makeInputs({ cc: 'gcc', cxx: 'g++' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(io.which).toHaveBeenCalledWith('gcc');
        expect(inputs.cc).toBe('/usr/bin/gcc');
    });

    it('returns original name when io.which fails', async () => {
        (io.which as jest.Mock).mockRejectedValue(new Error('not found'));
        const inputs = makeInputs({ cc: 'nonexistent-compiler' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.cc).toBe('nonexistent-compiler');
    });

    it('returns empty string for empty compiler', async () => {
        const inputs = makeInputs({ cc: '', cxx: '' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        expect(inputs.cc).toBe('');
        expect(inputs.cxx).toBe('');
    });

    it('resolves relative compiler paths', async () => {
        const inputs = makeInputs({ cc: './my-compiler' });
        await main._resolveInputParameters(inputs, defaultSetupOutputs);

        // Should be resolved to absolute path
        expect(inputs.cc).toContain('my-compiler');
        expect(inputs.cc).not.toBe('./my-compiler');
    });
});

describe('CmakeWorkflowRunner (main)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (setup_cmake.main as jest.Mock).mockResolvedValue(defaultSetupOutputs);
        (processEntry as jest.Mock).mockResolvedValue(undefined);
        (downloadSourceCode as jest.Mock).mockResolvedValue(undefined);
        (applyPatches as jest.Mock).mockResolvedValue(undefined);
    });

    it('runs full pipeline without download or patches', async () => {
        const inputs = makeInputs({
            url: '',
            gitRepository: '',
            patches: [],
            cxxstd: ['17']
        });

        await main.main(inputs);

        expect(downloadSourceCode).not.toHaveBeenCalled();
        expect(applyPatches).not.toHaveBeenCalled();
        expect(setup_cmake.main).toHaveBeenCalled();
        expect(processEntry).toHaveBeenCalled();
    });

    it('downloads source code when url is set', async () => {
        const inputs = makeInputs({
            url: 'https://example.com/src.tar.gz',
            patches: []
        });

        await main.main(inputs);

        expect(downloadSourceCode).toHaveBeenCalled();
    });

    it('downloads source code when gitRepository is set', async () => {
        const inputs = makeInputs({
            gitRepository: 'https://github.com/org/repo',
            patches: []
        });

        await main.main(inputs);

        expect(downloadSourceCode).toHaveBeenCalled();
    });

    it('applies patches when patches array is non-empty', async () => {
        const inputs = makeInputs({
            patches: ['/patch/file.txt']
        });

        await main.main(inputs);

        expect(applyPatches).toHaveBeenCalled();
    });

    it('throws when CMake path is not found', async () => {
        (setup_cmake.main as jest.Mock).mockResolvedValue({ path: '', dir: '/usr/bin', supportedPresetsVersion: 7 });

        const inputs = makeInputs();

        await expect(main.main(inputs)).rejects.toThrow('CMake not found');
    });

    it('processes multiple entries from factor expansion', async () => {
        const inputs = makeInputs({
            cxxstd: ['17', '20']
        });

        await main.main(inputs);

        // Should call processEntry once per expanded entry
        expect(processEntry).toHaveBeenCalledTimes(2);
    });

    it('freezes inputs so mutations do not affect the original', async () => {
        const inputs = makeInputs({
            cxxstd: ['17'],
            patches: ['a.patch'],
            extraArgs: ['-DFOO=1']
        });
        const originalCxxstd = [...inputs.cxxstd];
        const originalPatches = [...inputs.patches];

        await main.main(inputs);

        // Original arrays should not have been mutated
        expect(inputs.cxxstd).toEqual(originalCxxstd);
        expect(inputs.patches).toEqual(originalPatches);
    });

    it('creates working copy with extraArgs as record', async () => {
        const inputs = makeInputs({
            cxxstd: ['17'],
            extraArgs: { debug: ['-DFOO=1'], release: ['-DBAR=1'] } as unknown as string[]
        });

        await main.main(inputs);

        expect(processEntry).toHaveBeenCalled();
    });
});

describePrettyErrors('workflow boom', 'CMake workflow failed');
