/**
 * Schema definitions for the cmake-workflow action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import * as os from 'os';
import * as path from 'path';
import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema,
    type InferInputs
} from 'action-schema';

import { normalizeArchitectureInput } from 'setup-program';
import { parseExtraArgs } from './input-expansion';

/**
 * Returns the number of available CPU cores.
 *
 * @returns Number of available CPUs, minimum 1
 */
function numberOfCpus(): number {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    if (!result || result === 0) {
        return 1;
    }
    return result;
}

/**
 * Input schema for the cmake-workflow action.
 */
export const inputsSchema = {
    ...baseInputs,

    // ======================================
    // CMake options
    // ======================================
    cmakePath: {
        type: 'string' as const,
        default: 'cmake',
        description: `Ordered list of candidate paths to the cmake executable.

Entries follow the same rules as the underlying \`setup-cmake\` action:

- Provide absolute/relative file paths when you want to pin a specific binary; on Windows we will also probe \`.exe\`, \`.cmd\`, and \`.bat\` if no extension is given.
- Provide a bare name such as \`cmake\` to reuse whatever version is already available on PATH.

Separate multiple entries with the platform path delimiter (\`:\` on Unix-like systems, \`;\` on Windows) or new lines. They are evaluated in order, and each must still satisfy the \`cmake-version\` range. Set \`cmake-version: '*'\` if you intentionally want to skip version filtering.`
    },

    cmakeVersion: {
        type: 'string' as const,
        default: '*',
        description: `A semver range string with the cmake versions supported by this workflow.

If the existing version in the environment does not satisfy this requirement, the action install
the min CMake version that satisfies it.

This should usually match the \`cmake_minimum_required\` defined in your CMakeLists.txt file.`
    },

    // ======================================
    // Configure options
    // ======================================
    sourceDir: {
        type: 'path' as const,
        default: '.',
        transform: (v) => path.resolve(v as string),
        description: 'Directory for the source files.'
    },

    url: {
        type: 'string' as const,
        default: '',
        description: `URL to the source code.

If this input is defined, the action will download the source code from the URL and use it as the
source directory.`
    },

    gitRepository: {
        type: 'string' as const,
        default: '',
        description: `Git repository to clone.

If this input is defined, the action will shallow clone the repository and use it as the source directory.`
    },

    gitTag: {
        type: 'string' as const,
        default: '',
        description: `Git branch name, tag or commit hash to checkout from the git repository.

If this input is defined, the action will checkout this tag from the repository.`
    },

    downloadDir: {
        type: 'string' as const,
        default: '',
        description: `Directory where the source code will be downloaded.

If the input is not specified, the action will download the source code to the source directory.`
    },

    patches: {
        type: 'multiline' as const,
        default: [] as string[],
        description: `List of patch files or directories to be copied to the source directory.

The action copies the files to the source directory before running the configure step.
This is useful when the source directory comes from a URL or git repository
to patch the source files with CMake presets or include build scripts that are not part of the
repository.

If a file is specified, the action copies it to the source directory root with the
same filename.

If a directory is specified, the action copies all contents to the source directory,
preserving the internal directory structure. For example, if your patch directory contains
\`cmake/toolchain.cmake\`, it will be copied to \`<source-dir>/cmake/toolchain.cmake\`.

Patches are applied in the order they are defined. If a file already exists in the
source directory, it will be overwritten. This allows later patches to override earlier ones.`
    },

    buildDir: {
        type: 'string' as const,
        default: '',
        description: `Directory for the binaries relative to the source directory.

The build directory might come from a preset file or be defined by the user.

If no preset file is specified and the user does not define the build directory,
the action will use the default \`build\` directory.`
    },

    preset: {
        type: 'string' as const,
        default: '',
        description: `Name of the CMake preset to use.

If a preset is defined, other options will be used by CMake to override
the values defined in the preset.

If the CMake version doesn't support presets, the action will attempt
to parse the preset file and use the values defined in it.`
    },

    cc: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CC',
        description: `Path to C compiler.

If the input is not specified, the action will use the compiler defined by the environment variable \`CC\`.

The value can be an absolute path or the name of an application to be found it PATH.
If the value is a relative path starting with '.', the path is resolved relative to
the current working directory.

If the environment variable is not specified, the action will use the default compiler as identified by CMake.`
    },

    ccflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CFLAGS',
        description: `Flags to be used with the C compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CFLAGS\`.

If the environment variable is not specified, the action will use the default flags as identified by CMake.`
    },

    cxx: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXX',
        description: `Path to C++ compiler.

If the input is not specified, the action will use the compiler defined by the environment variable \`CXX\`.

The value can be an absolute path or the name of an application to be found it PATH.
If the value is a relative path starting with '.', the path is resolved relative to
the current working directory.

If the environment variable is not specified, the action will use the default compiler as identified by CMake.`
    },

    cxxflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXXFLAGS',
        description: `Flags to be used with the C++ compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CXXFLAGS\`.

If the environment variable is not specified, the action will use the default flags as identified by CMake.`
    },

    cxxstd: {
        type: 'string[]' as const,
        default: [] as string[],
        fallbackEnv: 'CXXSTD',
        transform: (v) => v as (string | null)[],
        description: `Comma-separated list of standards with which cmake will build and test the program.

If the input is not specified, the action will use the standards defined by the environment variable \`CXXSTD\`.

If the environment variable is not specified, the action will use the default standards as identified by CMake.

Unlike CMake, which can only build with one standard at a time, this action will iteratively build and test
with multiple standards. When multiple standards are used, the build directory will be suffixed with the
standard number with the exception of the latest standard.`
    },

    shared: {
        type: 'tribool' as const,
        default: undefined,
        fallbackEnv: 'BUILD_SHARED_LIBS',
        description: `Determines if add_library should create shared libraries (\`BUILD_SHARED_LIBS\`).

If the input is not specified, the action will use the value defined by the environment variable \`BUILD_SHARED_LIBS\`.

If the environment variable is not specified, the action will use the default value as identified by CMake (OFF).`
    },

    toolchain: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_TOOLCHAIN_FILE',
        description: `Path to toolchain.

If the input is not specified, the action will use the toolchain defined by the environment variable \`CMAKE_TOOLCHAIN_FILE\`.

If the environment variable is not specified, the action will use the default toolchain as identified by CMake.`
    },

    generator: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_GENERATOR',
        description: `Generator name.

If not specified, the action will use the generator defined by the environment variable \`CMAKE_GENERATOR\`.

If the environment variable is not specified, the action will try to use the default generator for the platform.`
    },

    generatorToolset: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_GENERATOR_TOOLSET',
        description: `Toolset specification for the generator, if supported.

The option will be applied in the command line as the \`-T\` option.

If not specified, the action will use the toolset defined by the environment variable \`CMAKE_GENERATOR_TOOLSET\`.

If the environment variable is not specified, the action will use the default toolset for the generator.`
    },

    generatorArchitecture: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_GENERATOR_ARCHITECTURE',
        description: `Architecture specification for the generator, if supported.

The option will be applied in the command line as the \`-A\` option.

If not specified, the action will use the architecture defined by the environment variable \`CMAKE_GENERATOR_ARCHITECTURE\`.

If the environment variable is not specified, the action will use the default toolset for the generator.`
    },

    arch: {
        type: 'string' as const,
        default: '',
        transform: (v) => normalizeArchitectureInput(v as string),
        description: `Target architecture hint (for example \`x86\`, \`x64\`, \`arm64\`). When \`generator-architecture\` is not set and the
chosen generator is Visual Studio, the action derives the appropriate \`-A\` switch from this value. Other
generators ignore this input.`
    },

    buildType: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_BUILD_TYPE',
        description: `Build type.

If not specified, the action will use the build type defined by the environment variable \`CMAKE_BUILD_TYPE\`.

If the environment variable is not specified, the action will use \`Release\` as the build type.

If all values are empty, the action will try to use the default generator for the platform.

If the generator is multi-config, this values will be applies to the \`CMAKE_CONFIGURATION_TYPES\` CMake options
instead of \`CMAKE_BUILD_TYPE\`.`
    },

    buildTarget: {
        type: 'string[]' as const,
        default: [] as string[],
        transform: (v) => v as (string | null)[],
        description: `Targets to build instead of the default target.

This can be a single target or a list of targets separated by a \`,\`, \`;\` or space.`
    },

    extraArgs: {
        type: 'multiline' as const,
        default: [] as string[],
        transform: (v) => parseExtraArgs(v as string[]),
        description: 'Extra arguments to cmake configure command.'
    },

    exportCompileCommands: {
        type: 'tribool' as const,
        default: undefined,
        fallbackEnv: 'CMAKE_EXPORT_COMPILE_COMMANDS',
        description: `Set CMAKE_EXPORT_COMPILE_COMMANDS=ON in the configure step.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_EXPORT_COMPILE_COMMANDS\`.

If the environment variable is not specified, the action will use the default value as identified by CMake (OFF).`
    },

    // ======================================
    // Configure and Install options
    // ======================================
    installPrefix: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CMAKE_INSTALL_PREFIX',
        description: `Path where the library should be installed.

If the input is not specified, the action will use the path defined by the environment variable \`CMAKE_INSTALL_PREFIX\`.

If the environment variable is not specified, the action will use the default path as identified by CMake.`
    },

    // ======================================
    // Build options
    // ======================================
    jobs: {
        type: 'number' as const,
        default: 0,
        fallbackEnv: 'CMAKE_JOBS',
        transform: (v) => (v as number) || numberOfCpus(),
        description: `Number of jobs to use in parallel builds.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_JOBS\`.

If the environment variable is also not specified, the action will use the number of processors available in the
system.`
    },

    // ======================================
    // Test options
    // ======================================
    runTests: {
        type: 'tribool' as const,
        default: undefined,
        fallbackEnv: 'CMAKE_RUN_TESTS',
        description: `Whether we should run tests.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_RUN_TESTS\`.

If the environment variable is also not specified, the action will attempt to run tests but will not fail if
there are no tests.

When the value is \`true\` or \`false\`, the action will also set the \`configure-tests-flag\` to \`ON\` or \`OFF\`.
When the value is undefined, the \`configure-tests-flag\` is ignored.`
    },

    configureTestsFlag: {
        type: 'string' as const,
        default: 'BUILD_TESTING',
        description: `Specify the flag to be passed to cmake to enable/disable tests in the configuration step.

By default this is \`BUILD_TESTING\`, which is an option automatically created by the CTest module.

If the input contains a "=", the action will use the value as is.`
    },

    testAllCxxstd: {
        type: 'boolean' as const,
        default: false,
        description: `Whether we should run tests for all C++ standards defined by \`cxxstd\`.

If the input is not specified, the action will only run the tests with the last value defined in \`cxxstd\`.`
    },

    ctestTimeout: {
        type: 'number' as const,
        default: 0,
        fallbackEnv: 'CTEST_TEST_TIMEOUT',
        transform: (v) => (v as number) || undefined,
        description: `Maximum time in seconds allowed for each test to run.

If a test runs longer than this value, it will be killed and marked as failed.

If the input is not specified, the action will use the value defined by the environment variable \`CTEST_TEST_TIMEOUT\`.

If the environment variable is also not specified, ctest will use its default behavior (no timeout).`
    },

    // ======================================
    // Install options
    // ======================================
    install: {
        type: 'tribool' as const,
        default: undefined,
        fallbackEnv: 'CMAKE_INSTALL',
        description: `Whether we should install the library. The library is only installed once in the \`install-prefix\` using
the latest standard in \`cxxstd\`.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_INSTALL\`.

If the environment variable is also not specified, the action will attempt to install the library but will not
fail if the library cannot installed.`
    },

    installAllCxxstd: {
        type: 'tribool' as const,
        default: false,
        description: `Whether we should install the library for all C++ standards defined by \`cxxstd\`.

If the input is not specified, the action will only install the library with the last value defined in \`cxxstd\`.`
    },

    // ======================================
    // Packaging options
    // ======================================
    package: {
        type: 'tribool' as const,
        default: false,
        fallbackEnv: 'CMAKE_PACKAGE',
        description: `Whether we should run cpack with the specified \`package-generators\` after the install step.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_PACKAGE\`.

If the environment variable is also not specified, the action will attempt to run cpack but will not
fail if cpack cannot be run.`
    },

    packageAllCxxstd: {
        type: 'boolean' as const,
        default: false,
        description: `Whether we should run \`cpack\` for all C++ standards defined by \`cxxstd\`.

If the input is not specified, the action will only run cpack with the last value defined in \`cxxstd\`.`
    },

    packageName: {
        type: 'string' as const,
        default: '',
        description: 'The name of the package (or application). If not specified, CMake will default to the project name.'
    },

    packageDir: {
        type: 'string' as const,
        default: '',
        description: `The directory in which the packages are generated by cpack.

If it is not set then this will default to the build dir determined by \`CPACK_PACKAGE_DIRECTORY\`,
which may be defined in CMakeLists.txt, a CPack config file or from the cpack command
line option \`-B\`. If \`package-dir\` is set, it overrides the value found in the config file.`
    },

    packageVendor: {
        type: 'string' as const,
        default: '',
        description: 'Override or define CPACK_PACKAGE_VENDOR.'
    },

    packageGenerators: {
        type: 'string[]' as const,
        default: [] as string[],
        fallbackEnv: 'CPACK_GENERATOR',
        description: `A semicolon-separated list of generator names used by cpack.

If not specified, the action will use the generators defined by the environment variable \`CPACK_GENERATOR\`.

If this variable is not set, the action will attempt to generate the package with all
CPack generators available to CMake.`
    },

    packageArtifact: {
        type: 'tribool' as const,
        default: true,
        fallbackEnv: 'CMAKE_PACKAGE_ARTIFACT',
        description: `Whether the packages generated with CPack should be stored as action artifacts.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_PACKAGE_ARTIFACT\`.

If the environment variable is also not specified, the action will store the packages as artifacts.`
    },

    packageRetentionDays: {
        type: 'number' as const,
        default: 10,
        description: 'The number of days to keep the packages generated with CPack as action artifacts.'
    },

    // ======================================
    // Annotation options
    // ======================================
    createAnnotations: {
        type: 'tribool' as const,
        default: true,
        fallbackEnv: 'CMAKE_CREATE_ANNOTATIONS',
        description: `Create github annotations for errors and warnings at all steps.

If the input is not specified, the action will use the value defined by the environment variable \`CMAKE_CREATE_ANNOTATIONS\`.

If the environment variable is also not specified, the action will create annotations.`
    },

    refSourceDir: {
        type: 'path' as const,
        default: '',
        fallbackEnv: 'GITHUB_WORKSPACE',
        transform: (v) => path.resolve((v as string) || '.'),
        description: `A reference base directory for annotations.

For instance, if there is an error in the \`/home/user/project/src/main.cpp\` file, the action will create an
annotation referring to the repository path \`src/main.cpp\`.

If the reference source directory is /home/user/project/src, the action will create an annotation referring to
\`main.cpp\` instead because any annotation filename will be relative to this directory.

If no value is provided, the environment variable \`GITHUB_WORKSPACE\` will be used as the reference source
directory. This means all annotations will be relative to the repository root if \`actions/checkout\` has been
called without specifying a custom \`path\` option.

Changing this value is typically useful when the repository being tested is not the workspace directory, in
which we need to make annotations relative to some other directory.

In most cases, the default option should be enough.`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the cmake-workflow action.
 */
export const outputsSchema = {} satisfies ActionOutputsSchema;

/**
 * Input type inferred from the schema, with transforms applied.
 */
export type Inputs = InferInputs<typeof inputsSchema>;
