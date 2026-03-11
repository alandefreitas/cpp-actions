/**
 * Schema definitions for the cpp-matrix action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema,
    type InferInputs
} from 'action-schema';

import {
    type CompilerVersions,
    type CompilerFactors,
    type CompilerSuggestion
} from './types';

import {
    normalizeCppVersionRequirement,
    parseCompilerRequirements,
    parseCompilerFactors,
    parseCompilerSuggestions
} from './parsing';

import {
    normalizeCompilerNameKeys,
    normalizeCompilerNameSuggestions,
    parseKeyValues
} from './input-normalization';

/**
 * Cross-transform helper that parses multiline compiler factors.
 *
 * Joins multiline input, parses into CompilerFactors using compiler keys
 * from the already-parsed compilers field, and normalizes compiler names.
 *
 * @param v - Raw multiline string array value
 * @param inputs - All inputs after per-field transforms
 * @returns Parsed and normalized compiler factors
 */
function parseFactorsCross(v: unknown, inputs: Record<string, unknown>): CompilerFactors {
    const compilerKeys = Object.keys(inputs.compilers as CompilerVersions);
    const factors = parseCompilerFactors((v as string[]).join('\n'), compilerKeys);
    normalizeCompilerNameKeys(factors as unknown as Record<string, unknown>);
    return factors;
}

/**
 * Cross-transform helper that parses multiline compiler suggestions.
 *
 * Parses suggestion lines using compiler keys from the already-parsed
 * compilers field, and normalizes compiler names in the results.
 *
 * @param v - Raw multiline string array value
 * @param inputs - All inputs after per-field transforms
 * @returns Parsed and normalized compiler suggestions
 */
function parseSuggestionsCross(v: unknown, inputs: Record<string, unknown>): CompilerSuggestion[] {
    const compilerKeys = Object.keys(inputs.compilers as CompilerVersions);
    const suggestions = parseCompilerSuggestions(v as string[], compilerKeys);
    normalizeCompilerNameSuggestions(suggestions);
    return suggestions;
}

/**
 * Input schema for the cpp-matrix action.
 */
export const inputsSchema = {
    ...baseInputs,

    // -----------------------------------------------------------------
    // Compilers
    // -----------------------------------------------------------------
    compilers: {
        type: 'multiline' as const,
        default: [
            'gcc >=4.8',
            'clang >=3.8',
            'msvc >=14',
            'apple-clang *',
            'mingw *',
            'clang-cl *'
        ] as string[],
        transform: (v) => {
            const versions = parseCompilerRequirements((v as string[]).join('\n'));
            normalizeCompilerNameKeys(versions as unknown as Record<string, unknown>);
            return versions;
        },
        description: `A list of compilers to be tested. Each compiler can be complemented with its semver version requirements to be tested.

When the compiler version requirements are provided, the action will break the requirements into subsets of major versions to be tested. When no version is provided, the '*' semver requirement is assumed. The action can identifies subsets of compiler versions for GCC, Clang, and MSVC. For any other compilers, the version requirements will passthrough to the output.`
    },

    subrangePolicy: {
        type: 'map' as const,
        default: { '': 'one-per-major' } as Record<string, string>,
        transform: (v) => {
            normalizeCompilerNameKeys(v as Record<string, unknown>);
            return v as Record<string, string>;
        },
        description: `The policy to be used to break the compiler version requirements into sub-ranges of versions.

For instance, if the compiler requirements are \`gcc >=4.8\`, the action will typically generate entries that satisfy \`gcc >=4.8 <5\`, \`gcc >=5 <6\`, \`gcc >=6 <7\`, and so on, because the default policy is \`one-per-major\`.

The policy can be \`one-per-major\` or \`one-per-minor\`.

This input can be a single value for all compilers or a multi-line list of compiler-specific policies.

Another policy is to break into major versions when the range contains multiple major versions and into minor versions when the range contains multiple minor versions. The name of this policy is \`one-per-major-minor\`.`
    },

    standards: {
        type: 'string' as const,
        default: '>=11',
        transform: (v) => normalizeCppVersionRequirement(v as string),
        description: `A semver range describing what C++ standards should be tested. For instance, \`>=11\` indicates that the library should be tested with C++11 and later standards.

These requirements can include C++ standards as 2 or 4 digits versions, such as 11, 2011, 98, or 1998. 2 digit versions are normalized into the 4 digits form so that 11 > 98 (2011 > 1998).

The action will generate entries for each compiler version that satisfies the requirements. The compiler ranges defined in \`compilers\` are adjusted to only include compilers that support any subrange of these requirements. Compilers that don't support any of the standards in the range will be excluded from the matrix.

Each entry in the matrix will include the \`cxxstd\` key with a list of standards to be tested with that compiler version. This list will include the \`max-standards\` latest standards supported by the compiler specified in that entry. For instance, if \`max-standards\` is \`3\` and the compiler supports '11,14,17,20,23' given the the \`standards\` requirement \`>=11\`, the \`cxxstd\` field of the entry will include the standards \`20,23\` will be tested by this compiler. This allows the matrix to be more focused on the latest standards supported by each compiler (the ones that are more likely to be contain compatibility issues) while still testing all standards required by the library in the matrix.

It's very common for compilers to not fully comply with the standards they claim to support, even for the old standards. The criteria used by this action for determining if a compiler supports a standard is based on the whether the compiler claims to support the standard by providing a corresponding \`-std=c++XX\` flag to enable the standard. This criteria is easy to follow, minimizes surprises, covers the most common bugs, and ensures users the library is compliant with all standard flags supported by the compilers.`
    },

    maxStandards: {
        type: 'number' as const,
        default: 2,
        transform: (v) => (v as number) || undefined,
        description: `The maximum number of standards to be tested with each compiler.

For instance, if 'max-standards' is 2 and the compiler supports '11,14,17,20,23' given the in the standard requirements, the standards 20,23 will be tested by this compiler.`
    },

    // -----------------------------------------------------------------
    // Factors
    // -----------------------------------------------------------------
    latestFactors: {
        type: 'multiline' as const,
        default: ['gcc Coverage TSan UBSan'] as string[],
        crossTransform: parseFactorsCross,
        description: `The factors to be tested with the latest versions of each compiler. For each factor in this list, the entry with the latest version of a compiler will be duplicated with an entry that sets this factor to true.

Other entries will also include this factor as false.

The following factors are considered special: 'asan', 'ubsan', 'msan', 'tsan', 'intsan', 'boundsan', 'lsan', 'cfi', and 'coverage'. When these factors are defined in an entry, its 'ccflags', 'cxxflags', and 'linkflags' value are also modified to include the suggested flags for factor.`
    },

    factors: {
        type: 'multiline' as const,
        default: [
            'gcc Asan Shared',
            'msvc Shared x86',
            'clang Time-Trace',
            'mingw Shared'
        ] as string[],
        crossTransform: parseFactorsCross,
        description: `The factors to be tested with other versions of each compiler. Each factor in this list will be injected into a version of the compiler that is not the latest version. An entry with the latest version of the compiler will be duplicated with this factor if there are no entries left to inject the factor.

Other entries will also include this factor as false.`
    },

    combinatorialFactors: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseFactorsCross,
        description: `The factors to be tested with all combinations of other factors. When combinatorial factors are defined, for each entry in the matrix, a new entry will be created with the factors in this list set to \`true\`.

For instance, if the library can be built both in "Standalone" mode and with dependencies, the factor 'Standalone' can be added to this list to duplicate all entries. Each copy would include a "Standalone" factor set to \`true\` or \`false\`.

Typically, it is advisable to steer clear of combinatorial factors to prevent a combinatorial explosion. It's usually better to only test the combinations that are expected to be used in practice and include an extra steps in the workflow to test any combinatorial factors.

For instance, if the library can be built both in "Standalone" mode and with dependencies, its workflow can simply include an extra step to also test the library in "Standalone" mode and keep the step to test the library with dependencies. This is usually safer and cheaper than duplicating the entire matrix to test all combinations of these factors and also allows steps to be skipped when the library is not expected to be built in a given mode. For instance, testing a library on Standalone mode might not be necessary when the library is being tested with intermediary compilers.`
    },

    forceFactors: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of factor flags to be injected with each range of compiler version even if the entry doesn't have the usual requirements to have that factor.

Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <build-type>\`

For instance, \`gcc >=13 <14: Asan\` indicates that the flag \`asan\` will be included with any version of \`gcc\` in that range, even if the entry doesn't have the usual requirements to have the \`Asan\` factor.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the build type to all versions of the compiler.

When the build type is unspecified, the action will infer the build type from the compiler name and its version.`
    },

    extraValues: {
        type: 'multiline' as const,
        default: [] as string[],
        transform: (v) => parseKeyValues(v as string[]),
        description: `A multi-line list of key-value pairs to be injected in each entry of the matrix.

Each line has the format:

\`<key>: <value>\`

For instance, \`hash-key: value\` includes the hash-key with the value \`value\` in each entry of the matrix. This means it can later be accessed more easily via the \`matrix\` output of the action.

The values also support Handlebars expressions, which can be used to generate values based on other values in the entry. For instance,

\`hash-key: {{ compiler }}-{{ version }}\`

would generate a hash-key with the value \`gcc-11.1\` for an entry with the compiler \`gcc\` and version \`11.1\`. Previous extra values in the entry can also be accessed via the \`matrix\` output of the action. For instance:

\`cache-key: cache-{{ hash-key }}\``
    },

    // -----------------------------------------------------------------
    // Customize suggestions
    // -----------------------------------------------------------------
    runsOn: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of github runner images to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <github-runner-image>\`

For instance, \`gcc >=13.1: ubuntu-latest\` indicates that the runner image \`ubuntu-latest\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the runner image to all versions of the compiler.

When the runner image is specified, a container is only be suggested for the entries if the \`container\` option for that compiler version is also specified.

When the runner image is unspecified, the action will infer the runner image and potentially a container from the compiler name and its version.`
    },

    containers: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of docker containers to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <docker-container>\`

For instance, \`gcc >=13.1: ubuntu:22.04\` indicates that the docker container \`ubuntu:22.04\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the container to all versions of the compiler.

When the container is specified for that compiler version and the \`runs-on\` option is not, an ubuntu image is suggested for the entry to run the container.

When the container is unspecified, the action can still infer a container for the compiler version according to the rules defined in the \`use-containers\` option.`
    },

    generators: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of cmake generators to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <cmake-generator>\`

For instance, \`gcc >=13.1: Ninja\` indicates that the cmake generator \`Ninja\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the generator to all versions of the compiler.

When the generator is unspecified, the action will infer the generator from the compiler name and its version.`
    },

    generatorToolsets: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of cmake generator toolsets to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <cmake-generator-toolset>\`

For instance, \`clang-cl \\*: ClangCL\` indicates that the cmake generator toolset \`ClangCL\` should be used to test \`clang-cl\` with any version.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the generator to all versions of the compiler.

When the generator toolset is unspecified, the action will infer the generator toolset from the compiler name and its version.`
    },

    b2Toolsets: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of b2 toolsets to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <b2-toolset>\`

For instance, \`gcc >=13.1: gcc\` indicates that the b2 toolset \`gcc-13\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the toolset to all versions of the compiler.

When the toolset is unspecified, the action will infer the toolset from the compiler name and its version.`
    },

    ccflags: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of C compiler flags to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <ccflags>\`

For instance, \`gcc >=13.1: -O3\` indicates that the C compiler flag \`-O3\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the flag to all versions of the compiler.

When the flag is unspecified, the action will infer the flag from the compiler name and its version.`
    },

    cxxflags: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of C++ compiler flags to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <cxxflags>\`

For instance, \`gcc >=13.1: -O3\` indicates that the C++ compiler flag \`-O3\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the flag to all versions of the compiler.

When the flag is unspecified, the action will infer the flag from the compiler name and its version.`
    },

    install: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of packages to be installed with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <packages>\`

For instance, \`gcc >=13.1: build-essential\` indicates that the package \`build-essential\` should be installed to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the package to all versions of the compiler.

When the package is unspecified, the action will infer the package from the compiler name and its version.`
    },

    appendInstall: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of packages to append to the install list for each range of compiler version. Unlike \`install\`, which replaces the entire install list, this option appends to the values already generated by the action (e.g. \`build-essential\` for containers, \`lcov\` for coverage).

Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <packages>\`

For instance, \`gcc ASan: libasan-dev\` appends \`libasan-dev\` to the install list for any \`gcc\` entry with the \`ASan\` factor.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will append the packages to all versions of the compiler.`
    },

    appendCcflags: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of C compiler flags to append for each range of compiler version. Unlike \`ccflags\`, which replaces the entire flag string, this option appends to the flags already generated by the action (e.g. sanitizer flags, coverage flags).

Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <ccflags>\`

For instance, \`clang >=15: -stdlib=libc++\` appends \`-stdlib=libc++\` to the C flags for any \`clang\` entry with version \`>=15\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will append the flags to all versions of the compiler.`
    },

    appendCxxflags: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of C++ compiler flags to append for each range of compiler version. Unlike \`cxxflags\`, which replaces the entire flag string, this option appends to the flags already generated by the action (e.g. sanitizer flags, coverage flags).

Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <cxxflags>\`

For instance, \`gcc >=13: -Wextra\` appends \`-Wextra\` to the C++ flags for any \`gcc\` entry with version \`>=13\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will append the flags to all versions of the compiler.`
    },

    triplets: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of triplets to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <triplet>\`

For instance, \`gcc >=13.1: x86_64-linux-gnu\` indicates that the triplet \`x86_64-linux-gnu\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the triplet to all versions of the compiler.

When the triplet is unspecified, the action will infer the triplet from the compiler name and its version.`
    },

    buildTypes: {
        type: 'multiline' as const,
        default: [] as string[],
        crossTransform: parseSuggestionsCross,
        description: `A multi-line list of build types to be used with each range of compiler version. Each line has the format:

\`<compiler-name>[ <compiler-range|compiler-factor>]: <build-type>\`

For instance, \`gcc >=13.1: Release\` indicates that the build type \`Release\` should be used to test \`gcc\` with any version in the semver range \`>=13.1\`.

Omitting \`<compiler-range|compiler-factor>\` is equivalent to it being set to \`*\` and will apply the build type to all versions of the compiler.

When the build type is unspecified, the action will infer the build type from the compiler name and its version.`
    },

    // -----------------------------------------------------------------
    // Customization flags
    // -----------------------------------------------------------------
    defaultBuildType: {
        type: 'string' as const,
        default: 'Release',
        transform: (v) => (v as string).trim() || 'Release',
        description: 'The default build type to suggest for entries without a specific build type.'
    },

    sanitizerBuildType: {
        type: 'string' as const,
        default: 'RelWithDebInfo',
        transform: (v) => (v as string).trim() || 'Release',
        description: 'Determine the default build type to suggest when testing with sanitizers.'
    },

    x86BuildType: {
        type: 'string' as const,
        default: 'Release',
        transform: (v) => (v as string).trim() || 'Release',
        description: 'Determine the default build type to suggest when testing with x86.'
    },

    useContainers: {
        type: 'boolean' as const,
        default: true,
        description: `Determine whether to use containers whenever possible to run the tests.

By using containers for all jobs, the workflow can be more stable and reproducible. For instance, without containers an existing workflow cannot start to fail because of a change in the GitHub runner environments.

However, this comes at a cost of initial setup time. Some existing workflows can also break when moving to containers because existing assumptions about tools available in the runner environment are no longer valid.

When the value is false, the action will still use containers when needed. This may happen because the compiler is not available in the runner image or when there's a reported conflict between compilers in the runner image.`
    },

    // -----------------------------------------------------------------
    // Output
    // -----------------------------------------------------------------
    outputFile: {
        type: 'string' as const,
        default: 'matrix.json',
        description: `The file to output the matrix as a JSON string.

This is useful when the matrix is too large to be printed in the logs or when the matrix needs to be saved for later use.

The file will be saved in the current working directory of the action.`
    },

    // -----------------------------------------------------------------
    // Debugging
    // -----------------------------------------------------------------
    logMatrix: {
        type: 'boolean' as const,
        default: true,
        description: `Log the generated matrix as a JSON string.

The is useful for debugging purposes and when transitioning to a workflow that uses a hard-coded matrix.`
    },

    generateSummary: {
        type: 'boolean' as const,
        default: true,
        description: 'Generate summary with the complete matrix.'
    },

    warnNoMatches: {
        type: 'boolean' as const,
        default: true,
        description: `Emit a GitHub warning whenever a compiler configuration results in zero matrix entries because no known versions can satisfy the requested version range and C++ standard requirements simultaneously. Leave this enabled to catch unintended gaps; set it to \`false\` if you deliberately provide unsatisfiable requirements and do not want the additional annotation.`
    },

    // -----------------------------------------------------------------
    // Failure rate sorting
    // -----------------------------------------------------------------
    sortByFailureRate: {
        type: 'boolean' as const,
        default: true,
        description: `Sort matrix entries by historical failure rate.

The action fetches recent workflow run history and calculates the failure rate for each matrix entry based on job name matching. Entries with higher failure rates are sorted first (stable sort preserving existing order for equal rates).

This is useful when combined with \`max-parallel\` or limited runners, as it ensures jobs most likely to fail run first, providing faster feedback.

When enabled, the summary table includes a "Failure Rate" column.

Requires \`github-token\` to be set for API access. If failure rates cannot be calculated (no token, no history, API errors), the action continues gracefully without error.`
    },

    failureRateRuns: {
        type: 'number' as const,
        default: 100,
        description: `Number of recent workflow runs to analyze when calculating failure rates.

Jobs for each run are fetched in parallel, so increasing this value has minimal impact on execution time.

Only used when \`sort-by-failure-rate\` is enabled.`
    },

    githubToken: {
        type: 'string' as const,
        default: '',
        description: `GitHub token for API access when fetching workflow run history for failure rate calculation.

Required when \`sort-by-failure-rate\` is enabled. Pass \`secrets.GITHUB_TOKEN\` or \`github.token\`. Alternatively, set the \`GITHUB_TOKEN\` environment variable in your workflow step.`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the cpp-matrix action.
 */
export const outputsSchema = {
    matrix: {
        description: `The test matrix is an array of dictionaries, where each entry represents a combination of compiler version and factors to be tested.

Each entry in the test matrix dictionary contains key-value pairs in the following categories:

*Basic fields*:

- \`name\`: A suggested name for the job testing this entry

- \`compiler\`: Specifies the name of the compiler to be used for the test configuration. This can be used as input to the setup-cpp action.

- \`version\`: Specifies the version requirements of the compiler to be used for the test configuration. This can be used as input to the setup-cpp action.

- \`cxxstd\`: A list of standards that should be tested with this compiler version. This option considers the \`max-standards\` latest standards supported by each compiler in its subrange of \`standards\`.

- \`latest-cxxstd\`: The last standard listed in \`cxxstd\` as a convenience variable

*Auxiliary*:

- \`major\`, \`minor\`, \`patch\`: Specifies the version components of the compiler whenever the whole range includes a single major, minor, or patch.

- \`has_major\`, \`has_minor\`, \`has_patch\`: Determines if the corresponding version component of the compiler is available representing all versions in the range.

- \`is-latest\`: Specifies whether the entry version requirement is the latest version among the test configurations.

- \`is-main\`: Specifies whether the entry version requirement is the latest version among the test configurations without any factors applied.

- \`is-earliest\`: Specifies whether the entry version requirement is the earliest version among the test configurations.

- \`is-intermediary\`: Specifies whether the entry version requirement is neither the earliest nor the latest version among the test configurations.

- \`has-factors\`: Specifies whether the entry has any factors applied.

- \`is-no-factor-intermediary\`: Specifies whether the entry is an intermediary version without any factors applied.

- \`is-container\`: Specifies whether the entry has a container suggested.

*Factors*:

- \`<factors>...\`: Provides additional factors or attributes associated with the test configuration as defined by the \`factors\` inputs. These usually include variant build configurations spread among the entries, such as asan, coverage, and shared libraries. For instance, if the \`Asan\` factor is applied to an entry, the entry will define the \`asan\` key with the value \`true\` and all other entries will define the \`asan\` key with the value \`false\`.

*Suggestions*:

- \`runs-on\`: A suggested github runner image name for the job testing this entry

- \`container\`: A suggested docker container for the job testing this entry

- \`cxx\`: The usual name of the C++ compiler executable. If using the \`setup-cpp\` action, its output should be used instead.

- \`cc\`: The usual name of the C compiler executable. If using the \`setup-cpp\` action, its output should be used instead.

- \`b2-toolset\`: The usual name of the toolset to be used in a b2 workflow.

- \`generator\`: A CMake generator recommended to run the CMake workflow.

- \`build-type\`: A build type recommended to test this entry. This is usually \`Release\`, unless some special factor that requires \`Debug\` is defined.

- \`ccflags\`: The recommended C flags to be used by this entry. It reflects the values of special factors, such as sanitizers, coverage, and time-trace.

- \`cxxflags\`: The recommended C++ flags to be used by this entry. It reflects the values of special factors, such as sanitizers, coverage, and time-trace.

- \`env\`: A dictionary of environment variables to be set for this entry.

- \`install\`: The recommended packages to be installed before running the workflow. This includes packages such as build-essential for ubuntu containers and lcov for coverage entries.`
    }
} satisfies ActionOutputsSchema;

/**
 * Input type inferred from the schema, with transforms applied.
 */
export type Inputs = InferInputs<typeof inputsSchema>;
