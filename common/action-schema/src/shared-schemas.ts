/**
 * Shared schema fragments for common action patterns.
 *
 * This module provides reusable schema definitions for inputs and outputs
 * that are shared across multiple actions. Using these fragments ensures
 * consistency and reduces duplication.
 *
 * @module shared-schemas
 */

import type { ActionInputsSchema, ActionOutputsSchema } from './types';

/**
 * Base inputs shared by all actions.
 *
 * Every action should include these inputs for consistent behavior.
 *
 * @example
 * ```typescript
 * const inputsSchema = {
 *     ...baseInputs,
 *     my_option: { type: 'string' as const, default: '', description: '...' }
 * } satisfies ActionInputsSchema;
 * ```
 */
export const baseInputs = {
    trace_commands: {
        type: 'boolean' as const,
        default: false,
        description: 'Trace commands executed by the workflow.'
    }
} satisfies ActionInputsSchema;

/**
 * Common inputs for setup actions (compilers, tools, etc.).
 *
 * Includes version specification, path candidates, and environment options.
 * Used by: setup-gcc, setup-clang, setup-cmake, setup-msvc, setup-program
 *
 * @example
 * ```typescript
 * // setup-cmake/src/schema.ts
 * export const inputsSchema = {
 *     ...setupInputs,
 *     cmake_file: { type: 'path' as const, default: '', description: 'Path to CMakeLists.txt.' }
 * } satisfies ActionInputsSchema;
 * ```
 */
export const setupInputs = {
    ...baseInputs,

    version: {
        type: 'string' as const,
        default: '*',
        description: `Version range or exact version to use, using SemVer's version range syntax.

By default, it uses any version available in the environment.`
    },

    path: {
        type: 'string[]' as const,
        splitter: /[:;]/,
        default: [] as string[],
        description: `Path to the executable. We attempt to find the tool at this path first.`
    },

    check_latest: {
        type: 'boolean' as const,
        default: false,
        description: `By default, when the tool is not available, this action will install the minimum version in the version spec.
This ensures the code respects its contract in terms of what minimum version is supported.

Set this option if you want the action to check for the latest available version that satisfies the version spec instead.`
    },

    update_environment: {
        type: 'boolean' as const,
        default: true,
        description: 'Set this option if you want the action to update environment variables.'
    }
} satisfies ActionInputsSchema;

/**
 * Common outputs for compiler setup actions.
 *
 * Used by: setup-gcc, setup-clang, setup-msvc
 *
 * @example
 * ```typescript
 * // setup-gcc/src/schema.ts
 * export const outputsSchema = {
 *     ...compilerOutputs
 * } satisfies ActionOutputsSchema;
 * ```
 */
export const compilerOutputs = {
    cc: {
        description: 'The absolute path to the C compiler executable.'
    },
    cxx: {
        description: 'The absolute path to the C++ compiler executable.'
    },
    dir: {
        description: 'The absolute path to the directory containing the compiler executables.'
    },
    version: {
        description: 'The installed version. Useful when given a version range as input.'
    },
    version_major: {
        description: 'The installed version major component.'
    },
    version_minor: {
        description: 'The installed version minor component.'
    },
    version_patch: {
        description: 'The installed version patch component.'
    }
} satisfies ActionOutputsSchema;

/**
 * Common outputs for tool setup actions with simpler output requirements.
 *
 * Used by: setup-cmake, setup-program
 *
 * @example
 * ```typescript
 * export const outputsSchema = { ...toolOutputs } satisfies ActionOutputsSchema;
 * ```
 */
export const toolOutputs = {
    path: {
        description: 'The absolute path to the tool executable.'
    },
    dir: {
        description: 'The absolute path to the directory containing the tool.'
    },
    version: {
        description: 'The installed version. Useful when given a version range as input.'
    }
} satisfies ActionOutputsSchema;

/**
 * Inputs for actions that support environment variable fallbacks for compiler paths.
 *
 * Used by: package-install, cmake-workflow, b2-workflow
 *
 * @example
 * ```typescript
 * const inputsSchema = {
 *     ...baseInputs,
 *     ...compilerEnvInputs,
 *     build_type: { type: 'string' as const, default: 'Release', description: '...' }
 * } satisfies ActionInputsSchema;
 * ```
 */
export const compilerEnvInputs = {
    cc: {
        type: 'path' as const,
        default: '',
        fallbackEnv: 'CC',
        description: `Path to C compiler.

If the input is not specified, the action will use the compiler defined by the environment variable \`CC\`.`
    },

    cxx: {
        type: 'path' as const,
        default: '',
        fallbackEnv: 'CXX',
        description: `Path to C++ compiler.

If the input is not specified, the action will use the compiler defined by the environment variable \`CXX\`.`
    },

    ccflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CFLAGS',
        description: `Flags to be used with the C compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CFLAGS\`.`
    },

    cxxflags: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXXFLAGS',
        description: `Flags to be used with the C++ compiler.

If the input is not specified, the action will use the flags defined by the environment variable \`CXXFLAGS\`.`
    }
} satisfies ActionInputsSchema;

/**
 * Helper to create a setup action schema with custom version description.
 *
 * @param toolName - Name of the tool for description customization
 * @returns A setup inputs schema with customized descriptions
 *
 * @example
 * ```typescript
 * export const inputsSchema = {
 *     ...createSetupInputs('GCC'),
 *     version: { ...createSetupInputs('GCC').version, transform: removeGCCPrefix }
 * } satisfies ActionInputsSchema;
 * ```
 */
export function createSetupInputs(toolName: string): typeof setupInputs {
    return {
        ...setupInputs,
        version: {
            ...setupInputs.version,
            description: `Version range or exact version of ${toolName} to use, using SemVer's version range syntax.

By default, it uses any version available in the environment.`
        },
        path: {
            ...setupInputs.path,
            description: `Path to the ${toolName} executable. We attempt to find ${toolName} at this path first.`
        },
        check_latest: {
            ...setupInputs.check_latest,
            description: `By default, when ${toolName} is not available, this action will install the minimum version in the version spec.
This ensures the code respects its contract in terms of what minimum ${toolName} version is supported.

Set this option if you want the action to check for the latest available version that satisfies the version spec instead.`
        }
    };
}

/**
 * Creates a function that removes compiler name prefixes from version strings.
 *
 * Compiler versions are sometimes prefixed with the compiler name (e.g., "gcc-12",
 * "clang++ 15"). This factory creates a remover for a specific compiler pair.
 *
 * @param ccName - C compiler name (e.g., 'gcc', 'clang')
 * @param cxxName - C++ compiler name (e.g., 'g++', 'clang++')
 * @returns A function that strips compiler prefixes from version strings
 *
 * @example
 * ```typescript
 * const removeGCCPrefix = createCompilerPrefixRemover('gcc', 'g++');
 * removeGCCPrefix('gcc-12');  // '12'
 * removeGCCPrefix('g++ 13');  // '13'
 * removeGCCPrefix('14');      // '14'
 * ```
 */
export function createCompilerPrefixRemover(
    ccName: string,
    cxxName: string
): (version: string) => string {
    return (version: string): string => {
        // Check each prefix independently using slice to avoid
        // double-replace issues when one name contains the other
        if (version.startsWith(`${ccName}-`)) {
            return version.slice(ccName.length + 1);
        }
        if (version.startsWith(`${cxxName}-`)) {
            return version.slice(cxxName.length + 1);
        }
        if (version.startsWith(`${ccName} `)) {
            return version.slice(ccName.length + 1);
        }
        if (version.startsWith(`${cxxName} `)) {
            return version.slice(cxxName.length + 1);
        }
        return version;
    };
}

/**
 * Helper to create compiler outputs with custom tool name.
 *
 * @param toolName - Name of the compiler for description customization
 * @param ccName - Name of the C compiler executable (e.g., 'gcc', 'clang')
 * @param cxxName - Name of the C++ compiler executable (e.g., 'g++', 'clang++')
 * @returns A compiler outputs schema with customized descriptions
 *
 * @example
 * ```typescript
 * export const outputsSchema = {
 *     ...createCompilerOutputs('GCC', 'gcc', 'g++')
 * } satisfies ActionOutputsSchema;
 * ```
 */
export function createCompilerOutputs(
    toolName: string,
    ccName: string,
    cxxName: string
): typeof compilerOutputs {
    return {
        cc: {
            description: `The absolute path to the ${ccName} executable.`
        },
        cxx: {
            description: `The absolute path to the ${cxxName} executable.`
        },
        dir: {
            description: `The absolute path to the ${toolName} directory containing the executable.`
        },
        version: {
            description: `The installed ${toolName} version. Useful when given a version range as input.`
        },
        version_major: {
            description: `The installed ${toolName} version major. Useful when given a version range as input.`
        },
        version_minor: {
            description: `The installed ${toolName} version minor. Useful when given a version range as input.`
        },
        version_patch: {
            description: `The installed ${toolName} version patch. Useful when given a version range as input.`
        }
    };
}
