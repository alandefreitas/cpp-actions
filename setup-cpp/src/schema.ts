/**
 * Schema definitions for the setup-cpp action.
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
 * Input schema for the setup-cpp action.
 */
export const inputsSchema = {
    ...baseInputs,

    compiler: {
        type: 'string' as const,
        default: '*',
        description: `Compiler name. If the compiler contains a version, it overrides 'version'.`
    },

    version: {
        type: 'string' as const,
        default: '*',
        description: `Version range or exact version of GCC to use, using SemVer's version range syntax.

By default, it uses any version available in the environment.`
    },

    path: {
        type: 'string[]' as const,
        splitter: /[:;]/,
        default: [] as string[],
        description: 'The compiler executable. We attempt to find the compiler at this path first.'
    },

    checkLatest: {
        type: 'boolean' as const,
        default: false,
        description: `By default, when the compiler is not available, this action will install the minimum version in the version spec.
This ensures the code respects its contract in terms of what minimum GCC version is supported.

Set this option if you want the action to check for the latest available version that satisfies the version spec instead.`
    },

    updateEnvironment: {
        type: 'boolean' as const,
        default: true,
        description: 'Set this option if you want the action to update environment variables.'
    },

    arch: {
        type: 'string' as const,
        default: '',
        description: `Target architecture name forwarded to MSVC (for example \`x86\`, \`x64\`, \`arm64\`).
When empty, the runner architecture is used. Non-MSVC compilers ignore this input.`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-cpp action.
 */
export const outputsSchema = {
    cc: {
        description: 'The absolute path to the C compiler executable.'
    },
    cxx: {
        description: 'The absolute path to the C++ compiler executable.'
    },
    bindir: {
        description: 'The absolute path to the directory containing the executable.'
    },
    dir: {
        description: 'The absolute path to the directory containing the installation.'
    },
    version: {
        description: 'The installed compiler version. For MSVC this is the MSVC toolset version; for other compilers it is their native version string.'
    },
    versionMajor: {
        description: 'The installed compiler version major. Useful when given a version range as input.'
    },
    versionMinor: {
        description: 'The installed compiler version minor. Useful when given a version range as input.'
    },
    versionPatch: {
        description: 'The installed compiler version patch. Useful when given a version range as input.'
    },
    msvcToolsetVersion: {
        description: 'When using MSVC, the toolset version resolved for cl.exe (for example 14.44.35207).'
    },
    msvcProductVersion: {
        description: 'When using MSVC, the Visual Studio product version (for example 17.11).'
    },
    msvcReleaseYear: {
        description: 'When using MSVC, the mapped Visual Studio release year (for example 2022).'
    },
    msvcCompilerVersion: {
        description: 'When using MSVC, the cl.exe front-end version reported by \`cl /Bv\` (for example 19.44.35219).'
    }
} satisfies ActionOutputsSchema;
