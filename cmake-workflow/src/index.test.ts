import * as main from './index';

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

import { describePrettyErrors } from 'pretty-errors/test-helper';

describe('resolveInputParameters', () => {
    it('normalizes Windows packageDir to avoid escape sequences', async () => {
        // Skip this test on non-Windows platforms since we can't reliably mock path.resolve
        if (process.platform !== 'win32') {
            expect(main._normalizePathForCMake).toBeDefined();
            return;
        }

        const inputs = {
            preset: '',
            buildType: '',
            buildDir: 'build',
            cmakePath: 'cmake',
            generator: 'Ninja',
            generatorToolset: '',
            generatorArchitecture: '',
            cc: '',
            ccflags: '',
            cxx: '',
            cxxflags: '',
            cxxstd: [] as (string | null)[],
            exportCompileCommands: undefined as boolean | undefined,
            runTests: undefined as boolean | undefined,
            configureTestsFlag: '',
            ctestTimeout: undefined as number | undefined,
            shared: false as boolean | undefined,
            toolchain: '',
            sourceDir: 'D:/a/mrdocs/mrdocs',
            installPrefix: 'install',
            packageDir: 'packages',
            packageName: '',
            packageVendor: '',
            packageGenerators: [] as string[],
            extraArgs: [] as string[],
            extra_args_key: undefined as string | undefined,
            cmakeVersion: '',
            url: '',
            gitRepository: '',
            gitTag: '',
            downloadDir: '',
            patches: [] as string[],
            arch: '',
            buildTarget: [] as (string | null)[],
            jobs: 1,
            testAllCxxstd: false,
            install: undefined as boolean | undefined,
            installAllCxxstd: false,
            package: undefined as boolean | undefined,
            packageAllCxxstd: false,
            packageArtifact: undefined as boolean | undefined,
            packageRetentionDays: 10,
            createAnnotations: undefined as boolean | undefined,
            refSourceDir: '',
            traceCommands: false
        };

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

describePrettyErrors('workflow boom', 'CMake workflow failed');
