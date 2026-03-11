/**
 * Schema definitions for the package-install action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema
} from 'action-schema';

/**
 * Input schema for the package-install action.
 */
export const inputsSchema = {
    ...baseInputs,

    // Packages
    vcpkg: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of packages we should install with vcpkg.

If any package is included in this list, vcpkg will be installed and the vcpkg toolchain file will be returned.

Individual packages can define a custom triplet by appending \`:<triplet>\` to the package name.`
    },

    apt_get: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of packages we should install with apt-get.

Additional options are provided to customize the behavior of apt-get.`
    },

    // VcPkg options
    cxx: {
        type: 'path' as const,
        default: '',
        fallbackEnv: 'CXX',
        description: `C++ compiler to be used by vcpkg. If the compiler is not specified, the value will be retrieved from
the environment variable \`CXX\`.

Setting the compiler is particularly important when the compiler being tested is different from the default
compiler used by vcpkg.`
    },

    cxxflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXXFLAGS',
        description: `C++ flags used by vcpkg. If the flags are not specified, the value will be retrieved from the environment
variable \`CXXFLAGS\`.`
    },

    cc: {
        type: 'path' as const,
        default: '',
        fallbackEnv: 'CC',
        description: `C compiler used by vcpkg. If the compiler is not specified, the value will be retrieved from the environment
variable \`CC\`.`
    },

    ccflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CFLAGS',
        description: `C flags used by vcpkg. If the flags are not specified, the value will be retrieved from the environment
variable \`CFLAGS\`.`
    },

    vcpkgTriplet: {
        type: 'string' as const,
        default: '',
        description: `The triplet used by vcpkg to install packages.

If no triplet is specified, a default triplet will be inferred from the platform.

Individual packages can override this value by specifying a triplet in the package name.`
    },

    vcpkgDir: {
        type: 'path' as const,
        default: '',
        description: `The directory where vcpkg should be cloned and installed.

If the directory is unspecified, the runner tool cache is used.`
    },

    vcpkgBranch: {
        type: 'string' as const,
        default: 'master',
        description: 'vcpkg branch we should use. This is usually the master branch.'
    },

    vcpkgCache: {
        type: 'boolean' as const,
        default: true,
        description: `Whether we should cache vcpkg and its built dependencies.

This is useful when you want to speed up your workflow by caching vcpkg and its built dependencies
for next workflows.

You can disable this option when you want to always build vcpkg and its dependencies from scratch
or want to save cache storage.`
    },

    vcpkgForceInstall: {
        type: 'boolean' as const,
        default: false,
        description: `Whether we should force install vcpkg and even when no vcpkg packages are listed.

This is useful when you want to use vcpkg in manifest mode.`
    },

    // APT options
    aptGetRetries: {
        type: 'number' as const,
        default: 5,
        fallbackEnv: 'APT_GET_RETRIES',
        description: `Number of times we should retry when apt-get fails.

This option is useful when apt-get fails due to a temporary network issue.

When calling apt-get to install packages, this passes the \`-o Acquire::Retries\` option
to apt-get.

For other commands, the command will be called multiple times until it succeeds or
the number of retries is exhausted. Each retry will be separated by a delay with an
exponential backoff.`
    },

    aptGetSources: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of sources for apt-get.

Sources are installed with \`apt-add-repository\`.`
    },

    aptGetSourceKeys: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of source keys for apt-get.

Source keys are installed with \`apt-key\`.`
    },

    aptGetIgnoreMissing: {
        type: 'boolean' as const,
        default: false,
        description: `Whether apt-get should ignore missing packages.

This attempts to install packages one by one and passes the \`--ignore-missing\` option to apt-get.`
    },

    aptGetAddArchitecture: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `Argument to pass to \`dpkg\` to add an architecture.

This is useful when installing packages that require a different architecture than the default one.

If this string is not empty, it will be passed to \`dpkg\` with the \`--add-architecture\` flag.

Common values for this parameter are: \`amd64\` (64-bit x86), \`i386\` (32-bit x86),
\`armhf\` (ARM Hard Float), \`arm64\` (ARM 64-bit), and \`ppc64el\` (PowerPC 64-bit Little Endian).

This parameter can also be a list of architectures.`
    },

    aptGetBulkInstall: {
        type: 'boolean' as const,
        default: false,
        description: `This option determines if we should call apt-get once for each package (false) or if we should call apt-get once
for all packages (true).

This option is useful when installing a large number of packages, since it can speed up the installation process.

However, installing libraries individually provides more better information in the logs, which can be useful
for debugging.`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the package-install action.
 */
export const outputsSchema = {
    vcpkgToolchain: {
        description: `vcpkg toolchain file

This output value can be used to configure CMake to use vcpkg.`
    },
    vcpkgExecutable: {
        description: 'vcpkg executable file'
    }
} satisfies ActionOutputsSchema;
