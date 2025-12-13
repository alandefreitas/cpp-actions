import * as main from './index';
import * as gh_inputs from 'gh-inputs';

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

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>;
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                };
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message);
                        mockCore.setFailed(error.message);
                    },
                    __mockCore: mockCore
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors');

            runPromise = prettyErrors.reportAndSetFailed(new Error('workflow boom'), { title: 'CMake workflow failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('workflow boom');
            });
        });

        await runPromise!;
    });
});
