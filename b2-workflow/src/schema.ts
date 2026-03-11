/**
 * Schema definitions for the b2-workflow action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import * as path from 'path';
import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema,
    type InferInputs
} from 'action-schema';
import { normalizeArchitectureInput, numberOfCpus } from './arch-utils';

/**
 * Input schema for the b2-workflow action.
 */
export const inputsSchema = {
    ...baseInputs,

    // ======================================
    // Configure options
    // ======================================
    sourceDir: {
        type: 'path' as const,
        default: '.',
        transform: (v) => path.resolve(v as string),
        description: `The boost source directory.

This path will be used to build and install \`B2\` for the workflow
and test the specified modules.`
    },

    buildDir: {
        type: 'string' as const,
        default: '',
        description: `Changes the build directories for all project roots being built.

When this option is specified, all Jamroot files must declare a project name.

The build directory for the project root will be computed by concatenating the value of the
--build-dir option, the project name specified in Jamroot, and the build dir specified in Jamroot
(or bin, if none is specified).

The option is primarily useful when building from read-only media, when you can't modify Jamroot.`
    },

    cxx: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXX',
        description: `Path to C++ compiler.

If the input is not specified, the action will use the compiler defined by the environment variable \`CXX\`.

If the environment variable is not specified, the action will use the default compiler as identified by B2.`
    },

    cxxflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXXFLAGS',
        description: `Flags to be used with the C++ compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CXXFLAGS\`.

If the environment variable is not specified, the action will use the default flags as identified by B2.`
    },

    ccflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CFLAGS',
        description: `Flags to be used with the C compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CFLAGS\`.

If the environment variable is not specified, the action will use the default flags as identified by B2.`
    },

    cxxstd: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXXSTD',
        description: `Comma-separated list of standards with which B2 will build and test the program.

If the input is not specified, the action will use the standards defined by the environment variable \`CXXSTD\`.

If the environment variable is not specified, the action will use the default standards as identified by B2.

B2 will iteratively build and test the specified modules with multiple standards.`
    },

    shared: {
        type: 'tribool' as const,
        default: undefined,
        fallbackEnv: 'BUILD_SHARED_LIBS',
        description: `Determines if the \`link\` option should be \`shared\` so that it creates shared libraries.
When the input is \`true\`, the \`link\` option is \`shared\`. When it is \`false\`, the \`link\` option is \`static\`.

If the input is not specified, the action will use the value defined by the environment variable \`BUILD_SHARED_LIBS\`.

If the environment variable is not specified, the action will use the default value as identified by B2,
which sets no value for the \`link\` option and defaults to \`shared\`.`
    },

    toolset: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'B2_TOOLSET',
        description: `B2 toolset name. The toolset is somewhat equivalent to a CMake generator.

If not specified, the action will use the toolset defined by the environment variable \`B2_TOOLSET\`.

If the environment variable is not specified, the action will use the default toolset detected by B2.`
    },

    arch: {
        type: 'string' as const,
        default: '',
        transform: (v) => normalizeArchitectureInput(v as string),
        description: `Target architecture hint (for example \`x86\`, \`x64\`, \`arm64\`). When provided, the action derives sensible defaults
for the B2 \`address-model\` and \`architecture\` properties unless they are explicitly set.`
    },

    buildVariant: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'B2_BUILD_VARIANT',
        description: `Custom build variants. If the provided variant is a CMake build-type, the
argument is mapped to the equivalent B2 variant:

- \`Release\` -> \`release\`

- \`Debug\` -> \`debug\`

- \`RelWithDebInfo\` -> \`release\` with \`debug-symbols=on\`

- \`<other>\` -> lowercase <other>

If the input is not specified, the action will use the value defined by the environment variable \`B2_BUILD_VARIANT\`.

If the environment variable is not specified, the action will use the value from \`build-type\`.`
    },

    buildType: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'B2_BUILD_TYPE',
        crossTransform: (v: unknown, inputs: Record<string, unknown>) =>
            ((inputs.buildVariant as string) || (v as string)).toLowerCase(),
        description: `An alternative to \`build-variant\`, for compatibility with CMake workflows. When \`build-variant\` is not provided,
this input is used to set the build variant.

If the input is not specified, the action will use the value defined by the environment variable \`B2_BUILD_TYPE\`.

If the environment variable is not specified, the action will use the default value as identified by B2.`
    },

    modules: {
        type: 'string[]' as const,
        default: [] as string[],
        required: true,
        description: `The list of modules we should test with B2 in the \`libs\` directory of the Boost super-project.

The directory \`libs/<module>/test\` will be provided for each module in the list.`
    },

    moduleTarget: {
        type: 'string[]' as const,
        default: ['test'] as string[],
        description: `Subdirectory or explicit target to append to each module.

When this input is left as the default (\`test\`), every module listed above contributes the argument
\`libs/<module>/test\` to the B2 invocation. Setting the input to \`example\` would instead append
\`libs/<module>/example\`. If a module entry already contains a path or target separators (for example
\`libs/filesystem/example\` or \`libs/filesystem//unit_tests\`), the action forwards it verbatim without prefixing it.

This input accepts a single value or a list separated by spaces, commas, or new lines. When multiple values are
provided, every target is applied to every module.`
    },

    extraArgs: {
        type: 'multiline' as const,
        default: [] as string[],
        description: 'Extra arguments.'
    },

    // ======================================
    // B2-specific options
    // ======================================
    warningsAsErrors: {
        type: 'string' as const,
        default: '',
        description: 'Treat warnings as errors.'
    },

    addressModel: {
        type: 'string' as const,
        default: '',
        description: 'Valid B2 list of address models.'
    },

    asan: {
        type: 'string' as const,
        default: '',
        description: 'Enable address-sanitizer.'
    },

    ubsan: {
        type: 'string' as const,
        default: '',
        description: 'Enable undefined-sanitizer.'
    },

    msan: {
        type: 'string' as const,
        default: '',
        description: 'Enable memory-sanitizer.'
    },

    tsan: {
        type: 'string' as const,
        default: '',
        description: 'Enable thread-sanitizer.'
    },

    coverage: {
        type: 'string' as const,
        default: '',
        description: 'Enable coverage.'
    },

    linkflags: {
        type: 'string' as const,
        default: '',
        description: 'Extra linker flags.'
    },

    threading: {
        type: 'string' as const,
        default: '',
        description: 'B2 threading option.'
    },

    rtti: {
        type: 'string' as const,
        default: '',
        description: 'Enables or disables run-time type information.'
    },

    clean: {
        type: 'boolean' as const,
        default: false,
        description: `Cleans all targets in the current directory and in any sub-projects.

Note that unlike the \`clean\` target in make, you can use --clean together with target names to
clean specific targets.`
    },

    cleanAll: {
        type: 'boolean' as const,
        default: false,
        description: `Cleans all targets, no matter where they are defined.

In particular, it will clean targets in parent Jamfiles, and targets defined under
other project roots.`
    },

    abbreviatePaths: {
        type: 'boolean' as const,
        default: true,
        description: `Compresses target paths by abbreviating each component.

This option is useful to keep paths from becoming longer than the filesystem supports.

See also the B2 documentation section
https://www.boost.org/doc/libs/master/tools/build/doc/html/index.html#bbv2.reference.buildprocess.targetpath["Target Paths"].`
    },

    hash: {
        type: 'boolean' as const,
        default: false,
        description: `Compresses target paths using an MD5 hash.

This option is useful to keep paths from becoming longer than the filesystem supports.

This option produces shorter paths than --abbreviate-paths does, but at the cost of making them less
understandable.

See also the B2 documentation section
https://www.boost.org/doc/libs/master/tools/build/doc/html/index.html#bbv2.reference.buildprocess.targetpath["Target Paths"].`
    },

    rebuildAll: {
        type: 'boolean' as const,
        default: false,
        description: `Equivalent to the \`-a\` option.

Causes all files to be rebuilt.`
    },

    dryRun: {
        type: 'boolean' as const,
        default: false,
        description: `Equivalent to the \`-n\` option.

Do not execute the commands, only print them.`
    },

    stopOnError: {
        type: 'boolean' as const,
        default: false,
        description: `Equivalent to the \`-q\` option.

Stop at the first error, as opposed to continuing to build targets that don't depend on the failed ones.`
    },

    config: {
        type: 'string' as const,
        default: '',
        description: `Equivalent to the \`--config=filename\` option.

Override all configuration files`
    },

    siteConfig: {
        type: 'string' as const,
        default: '',
        description: `Equivalent to the \`--site-config=filename\` option.

Override the default site-config.jam.`
    },

    userConfig: {
        type: 'string' as const,
        default: '',
        description: `Equivalent to the \`--user-config=filename\` option.

Override the default user-config.jam.

When this option is specified, the action will not generate a \`user-config.jam\` file with
the \`cxx\` toolset path.`
    },

    projectConfig: {
        type: 'string' as const,
        default: '',
        description: `Equivalent to the \`--project-config=filename\` option.

Override the default project-config.jam`
    },

    debugConfiguration: {
        type: 'tribool' as const,
        default: undefined,
        description: `Equivalent to the \`--debug-configuration\` option.

Produces debug information about the loading of B2 and toolset files.

If not specified, the value is inherited from \`trace-commands\`.`
    },

    debugBuilding: {
        type: 'tribool' as const,
        default: undefined,
        description: `Equivalent to the \`--debug-building\` option.

Prints what targets are being built and with what properties.

If not specified, the value is inherited from \`trace-commands\`.`
    },

    debugGenerators: {
        type: 'tribool' as const,
        default: undefined,
        description: `Equivalent to the \`--debug-generators\` option.

Produces debug output from the generator search process. Useful for debugging custom generators.

If not specified, the value is inherited from \`trace-commands\`.`
    },

    include: {
        type: 'string' as const,
        default: '',
        description: 'Additional include paths for C and C++ compilers.'
    },

    define: {
        type: 'string' as const,
        default: '',
        description: `Additional macro definitions for C and C++ compilers.

The string should be either SYMBOL or SYMBOL=VALUE.`
    },

    runtimeLink: {
        type: 'string' as const,
        default: '',
        description: `Equivalent to the \`--runtime-link=<shared,static>\` option.

Determines if shared or static version of C and C++ runtimes should be used.`
    },

    // ======================================
    // Build options
    // ======================================
    jobs: {
        type: 'number' as const,
        default: 0,
        fallbackEnv: 'B2_JOBS',
        transform: (v) => (v as number) || numberOfCpus(),
        description: `Number of jobs to use in parallel builds.

If the input is not specified, the action will use the value defined by the environment variable \`B2_JOBS\`.

If the environment variable is also not specified, the action will use the number of processors available in the
system.`
    }
} satisfies ActionInputsSchema;

/**
 * Configuration inputs for the b2-workflow action, inferred from the schema.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output schema for the b2-workflow action.
 */
export const outputsSchema = {} satisfies ActionOutputsSchema;
