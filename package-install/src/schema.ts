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
    type InferInputs,
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

    brew: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of Homebrew formula packages to install.

Accepts formula names (e.g., \`cmake\`, \`gcc\`) and supports the \`formula@version\` syntax
for versioned formulae (e.g., \`gcc@14\`, \`llvm@18\`).

Packages are installed on macOS and Linux (via Linuxbrew). On Windows, this input is silently ignored.`
    },

    brewCask: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of Homebrew cask packages to install.

Casks are macOS GUI applications (e.g., \`visual-studio-code\`, \`docker\`, \`firefox\`).
The \`--cask\` flag is used internally to avoid the formula/cask name ambiguity problem
where \`brew install\` silently prefers formulae over casks when both share the same name.

On Linux, cask installs are silently skipped since casks are macOS-only (.app bundles).
On Windows, this input is silently ignored.`
    },

    choco: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of Chocolatey packages to install on Windows.

Accepts package names (e.g., \`cmake\`, \`ninja\`) and supports the \`--version=X.Y.Z\` syntax
for version pinning (e.g., \`cmake --version=3.28.0\`).

Packages are installed on Windows only. On macOS and Linux, this input is silently ignored.`
    },

    packages: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `List of packages to install using the OS-native package manager.

Packages are automatically routed to the appropriate package manager based on the runner platform:
\`apt-get\` on Linux, \`brew\` on macOS, and \`choco\` on Windows.

Supports the \`@version\` syntax for version pinning, which is translated to the PM-native format:
- On Linux (apt-get): \`pkg@14\` becomes \`pkg-14\`
- On macOS (brew): \`pkg@14\` is passed through as-is (native brew syntax)
- On Windows (choco): \`pkg@14\` becomes \`pkg --version=14\`

Packages without \`@version\` are passed through unchanged on all platforms.
Routed packages are merged with any PM-specific packages from dedicated inputs (e.g., \`apt-get\`, \`brew\`, \`choco\`).`
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

    // Shared options
    retries: {
        type: 'number' as const,
        default: 5,
        description: `Default number of attempts for all package manager operations.

This shared retry count applies to apt-get, brew, and choco installs unless overridden
by a PM-specific retry input (e.g., \`apt-get-retries\`, \`brew-retries\`, \`choco-retries\`).

Each retry uses exponential backoff to handle transient network failures.`
    },

    brewRetries: {
        type: 'number' as const,
        description: `Number of attempts for Homebrew install operations.

Overrides the shared \`retries\` input for brew installs specifically.

When not provided, brew installs fall back to the shared \`retries\` value (default 5).

Each retry uses exponential backoff to handle transient network failures.`
    },

    chocoRetries: {
        type: 'number' as const,
        description: `Number of attempts for Chocolatey install operations.

Overrides the shared \`retries\` input for choco installs specifically.

When not provided, choco installs fall back to the shared \`retries\` value (default 5).

The Chocolatey community repository enforces rate limits (~20 downloads/min per IP),
and GitHub-hosted runner IPs are shared across many users. This input allows you to
configure more retries for choco specifically to handle rate-limit-induced failures.

Each retry uses exponential backoff to handle transient network and rate-limit failures.`
    },

    // APT options
    aptGetRetries: {
        type: 'number' as const,
        default: 5,
        fallbackEnv: 'APT_GET_RETRIES',
        description: `Number of attempts when apt-get fails.

Overrides the shared \`retries\` input for apt-get operations specifically.

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

Each key URL is downloaded, dearmored with \`gpg --dearmor\`, and stored in \`/etc/apt/keyrings/\`. Keys are paired positionally with \`apt-get-sources\` entries: key at index N is paired with source at index N. For paired sources, \`signed-by=\` is automatically injected into the source line pointing to the imported key.`
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

/**
 * Input configuration for the package-install action.
 * Inferred from the schema definition.
 */
export type Inputs = InferInputs<typeof inputsSchema>;
