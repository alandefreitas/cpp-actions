/**
 * Schema definitions for the setup-msvc action.
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
 * Input schema for the setup-msvc action.
 *
 * MSVC has different inputs than other compilers since it doesn't need
 * to be downloaded - just configured from the existing Visual Studio installation.
 */
export const inputsSchema = {
    ...baseInputs,

    version: {
        type: 'string' as const,
        default: '*',
        description: 'MSVC toolset version (SemVer range). When provided, it is forwarded to \`vcvarsall.bat\` via \`-vcvars_ver\`.'
    },

    arch: {
        type: 'string' as const,
        default: 'x64',
        description: 'Target architecture passed to vcvarsall (for example x86, x64, arm64).'
    },

    sdk: {
        type: 'string' as const,
        default: '',
        description: 'Optional Windows SDK version to pass to vcvarsall.'
    },

    toolset: {
        type: 'string' as const,
        default: '',
        description: 'Explicit MSVC toolset version override. When empty we fall back to \`version\`.'
    },

    visualStudioVersion: {
        type: 'string' as const,
        default: '',
        description: 'Visual Studio product version or year constraint forwarded to vswhere/vcvarsall.'
    },

    uwp: {
        type: 'boolean' as const,
        default: false,
        description: "Set to true to request the UWP environment (appends 'uwp' when invoking vcvarsall)."
    },

    spectre: {
        type: 'boolean' as const,
        default: false,
        description: 'Set to true to request Spectre-mitigated libraries.'
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-msvc action.
 *
 * Includes standard compiler outputs plus MSVC-specific version identifiers.
 */
export const outputsSchema = {
    cc: {
        description: 'Absolute path to cl.exe.'
    },
    cxx: {
        description: 'Absolute path to the C++ compiler (same as cl.exe).'
    },
    bindir: {
        description: 'Directory that contains cl.exe.'
    },
    dir: {
        description: 'Root Visual C++ installation directory.'
    },
    version: {
        description: 'Resolved MSVC toolset version (matches \`version\`).'
    },
    versionMajor: {
        description: 'MSVC toolset major version.'
    },
    versionMinor: {
        description: 'MSVC toolset minor version.'
    },
    versionPatch: {
        description: 'MSVC toolset patch version.'
    },
    msvcToolsetVersion: {
        description: 'Exact MSVC toolset version reported by the environment.'
    },
    msvcProductVersion: {
        description: 'Visual Studio product version (channel).'
    },
    msvcReleaseYear: {
        description: 'Visual Studio release year derived from the product version.'
    },
    msvcCompilerVersion: {
        description: 'cl.exe front-end version read from \`cl /Bv\`.'
    }
} satisfies ActionOutputsSchema;
