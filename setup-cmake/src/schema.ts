/**
 * Schema definitions for the setup-cmake action.
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

/**
 * Input schema for the setup-cmake action.
 */
export const inputsSchema = {
    ...baseInputs,

    version: {
        type: 'string' as const,
        default: '>=3.0.2',
        description: `Version range or exact version of CMake to use, using SemVer's version range syntax.

Reads from \`cmake-file\` input if unset.

By default, it uses any version available in the environment.`
    },

    architecture: {
        type: 'string' as const,
        default: '',
        description: 'The target architecture (x86, x64). By default, this value is inferred.'
    },

    cmakeFile: {
        type: 'string' as const,
        default: 'CMakeLists.txt',
        description: `File containing the CMake version to use in a cmake_minimum_required command.

Example: A CMakeLists.txt file containing a call to cmake_minimum_required.`
    },

    path: {
        type: 'string' as const,
        default: 'cmake',
        description: `Ordered list of candidate paths to the cmake executable.

Each entry can be an absolute/relative file path or a basename:

- If the entry is a file path, we try it as-is (and on Windows we also check \`.exe\`, \`.cmd\`, \`.bat\` if no extension was provided).
- If the entry is just a basename (for example \`cmake\`), it is forwarded to the system PATH search so any existing installation is reused.

Multiple entries can be provided by separating them with the platform path delimiter (\`:\` on Unix-like systems, \`;\` on Windows) or new lines. They are evaluated in order until an executable that satisfies the requested \`version\` range is located. To accept any version without filtering, set \`version: '*'\`.`
    },

    cmakePath: {
        type: 'string' as const,
        default: '',
        description: `Alias for \`path\` preserved for backwards compatibility.

When provided, these entries are evaluated before \`path\` using the same semantics, including the version check.`
    },

    cache: {
        type: 'boolean' as const,
        default: true,
        description: `Used to specify whether the CMake installation should be cached in the case CMake needs to be downloaded.

As binaries are provided for all versions of CMake, this option is deprecated and will be removed in a future release.`
    },

    checkLatest: {
        type: 'boolean' as const,
        default: false,
        description: `By default, when CMake is not available, this action will install the minimum version in the version spec.
This ensures the code respects its contract in terms of what minimum CMake version is supported.

Set this option if you want the action to check for the latest available version that satisfies the version spec instead.`
    },

    updateEnvironment: {
        type: 'boolean' as const,
        default: true,
        description: 'Set this option if you want the action to update environment variables.'
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-cmake action.
 */
export const outputsSchema = {
    path: {
        description: 'The absolute path to the CMake executable.'
    },
    dir: {
        description: 'The absolute path to the CMake directory.'
    },
    version: {
        description: 'The installed CMake version. Useful when given a version range as input.'
    },
    versionMajor: {
        description: 'The installed CMake version major. Useful when given a version range as input.'
    },
    versionMinor: {
        description: 'The installed CMake version minor. Useful when given a version range as input.'
    },
    versionPatch: {
        description: 'The installed CMake version patch. Useful when given a version range as input.'
    },
    cacheHit: {
        description: 'A boolean value to indicate a cache entry was found'
    },
    supportsPathToBuild: {
        description: 'Whether CMake supports the -B <path-to-build> syntax'
    },
    supportsParallelBuild: {
        description: 'Whether CMake supports the -j <threads> syntax'
    },
    supportsBuildMultipleTargets: {
        description: 'Whether CMake supports the --target with multiple targets'
    },
    supportsCmakeInstall: {
        description: 'Whether CMake supports the cmake --install'
    }
} satisfies ActionOutputsSchema;

/**
 * Input configuration for the setup-cmake action.
 * Inferred from the schema definition.
 */
export type Inputs = InferInputs<typeof inputsSchema>;
