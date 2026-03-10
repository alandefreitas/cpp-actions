import * as path from 'path';
import * as main from './index';
import * as gh_inputs from 'gh-inputs';
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

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn()
}));

import * as fs from 'fs';
import { describePrettyErrors } from 'pretty-errors/test-helper';

test('parseExtraArgsEntry', async () => {
    // const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    // expect(semver.valid(pkg.version)).toBeTruthy()
    expect(gh_inputs.parseBashArguments(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master']);
});

test('resolveInputParameters normalizes Windows package_dir to avoid escape sequences', async () => {
    // Skip this test on non-Windows platforms since we can't reliably mock path.resolve
    // The test verifies that Windows paths with backslashes are normalized to forward slashes
    if (process.platform !== 'win32') {
        // On non-Windows, we just verify the normalization function exists
        // The actual Windows path normalization is tested on Windows CI
        expect(main._normalizePathForCMake).toBeDefined();
        return;
    }

    const inputs = {
        preset: '',
        build_type: '',
        build_dir: 'build',
        cmake_path: 'cmake',
        generator: 'Ninja',
        generator_toolset: '',
        generator_architecture: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        cxxstd: [] as (string | null)[],
        export_compile_commands: undefined as boolean | undefined,
        run_tests: undefined as boolean | undefined,
        configure_tests_flag: '',
        ctest_timeout: undefined as number | undefined,
        shared: false as boolean | undefined,
        toolchain: '',
        source_dir: 'D:/a/mrdocs/mrdocs',
        install_prefix: 'install',
        package_dir: 'packages',
        package_name: '',
        package_vendor: '',
        package_generators: [] as string[],
        extra_args: [] as string[],
        extra_args_key: undefined as string | undefined,
        cmake_version: '',
        url: '',
        git_repository: '',
        git_tag: '',
        download_dir: '',
        patches: [] as string[],
        arch: '',
        build_target: [] as (string | null)[],
        jobs: 1,
        test_all_cxxstd: false,
        install: undefined as boolean | undefined,
        install_all_cxxstd: false,
        package: undefined as boolean | undefined,
        package_all_cxxstd: false,
        package_artifact: undefined as boolean | undefined,
        package_retention_days: 10,
        create_annotations: undefined as boolean | undefined,
        ref_source_dir: '',
        trace_commands: false
    };

    const setupCMakeOutputs = {
        path: 'cmake',
        dir: 'C:/Program Files/CMake/bin',
        supported_presets_version: 7
    };

    await main._resolveInputParameters(inputs, setupCMakeOutputs);
    expect(inputs.install_prefix.includes('\\')).toBe(false);
    expect(inputs.package_dir).toBe('D:/a/mrdocs/mrdocs/build/packages');
});

test('deriveGeneratorArchitectureFromArch maps Visual Studio targets', () => {
    expect(main._deriveGeneratorArchitectureFromArch('x86', 'Visual Studio 17 2022')).toBe('Win32');
    expect(main._deriveGeneratorArchitectureFromArch('arm64', 'Visual Studio 17 2022')).toBe('ARM64');
    expect(main._deriveGeneratorArchitectureFromArch('x64', 'Ninja')).toBe('');
});

describePrettyErrors('workflow boom', 'CMake workflow failed');

describe('applyPatches', () => {
    const mockIoCp = io.cp as jest.MockedFunction<typeof io.cp>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * Creates a minimal Inputs object with only the fields needed for applyPatches.
     *
     * @param overrides - Fields to override in the default inputs
     * @returns Inputs object for testing
     */
    function createInputs(overrides: { patches?: string[]; source_dir?: string }): Parameters<typeof main._applyPatches>[0] {
        return {
            preset: '',
            build_type: '',
            build_dir: 'build',
            cmake_path: 'cmake',
            generator: '',
            generator_toolset: '',
            generator_architecture: '',
            cc: '',
            ccflags: '',
            cxx: '',
            cxxflags: '',
            cxxstd: [],
            export_compile_commands: undefined,
            run_tests: undefined,
            configure_tests_flag: '',
            ctest_timeout: undefined,
            shared: undefined,
            toolchain: '',
            source_dir: overrides.source_dir ?? '/test/source',
            install_prefix: '',
            package_dir: '',
            package_name: '',
            package_vendor: '',
            package_generators: [],
            extra_args: [],
            cmake_version: '',
            url: '',
            git_repository: '',
            git_tag: '',
            download_dir: '',
            patches: overrides.patches ?? [],
            arch: '',
            build_target: [],
            jobs: 1,
            test_all_cxxstd: false,
            install: undefined,
            install_all_cxxstd: false,
            package: undefined,
            package_all_cxxstd: false,
            package_artifact: undefined,
            package_retention_days: 10,
            create_annotations: undefined,
            ref_source_dir: '',
            trace_commands: false
        };
    }

    it('does nothing when patches array is empty', async () => {
        const inputs = createInputs({ patches: [] });
        await main._applyPatches(inputs);
        expect(mockIoCp).not.toHaveBeenCalled();
    });

    it('copies a single file patch to source directory root', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

        const inputs = createInputs({
            patches: ['/patches/CMakePresets.json'],
            source_dir: '/project/src'
        });

        await main._applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(1);
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches/CMakePresets.json'),
            path.resolve('/project/src', 'CMakePresets.json'),
            { force: true }
        );
    });

    it('copies directory contents preserving structure with force option', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
        (fs.readdirSync as jest.Mock).mockReturnValue(['file.txt', 'subdir']);

        const inputs = createInputs({
            patches: ['/patches'],
            source_dir: '/project/src'
        });

        await main._applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(2);
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches', 'file.txt'),
            path.resolve('/project/src', 'file.txt'),
            { recursive: true, force: true }
        );
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches', 'subdir'),
            path.resolve('/project/src', 'subdir'),
            { recursive: true, force: true }
        );
    });

    it('skips non-existent patch files', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const inputs = createInputs({
            patches: ['/patches/missing.txt'],
            source_dir: '/project/src'
        });

        await main._applyPatches(inputs);

        expect(mockIoCp).not.toHaveBeenCalled();
    });

    it('processes multiple patches in order', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

        const inputs = createInputs({
            patches: ['/patches/first.txt', '/patches/second.txt'],
            source_dir: '/project/src'
        });

        await main._applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(2);
        // Verify order
        expect(mockIoCp.mock.calls[0][0]).toBe(path.resolve('/patches/first.txt'));
        expect(mockIoCp.mock.calls[1][0]).toBe(path.resolve('/patches/second.txt'));
    });
});
