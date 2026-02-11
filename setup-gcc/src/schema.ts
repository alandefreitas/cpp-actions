/**
 * Schema definitions for the setup-gcc action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import {
    createSetupInputs,
    createCompilerOutputs,
    createCompilerPrefixRemover,
    type ActionInputsSchema,
    type ActionOutputsSchema
} from 'action-schema';

/**
 * Removes "gcc-" or "g++-" prefixes from a version string.
 *
 * @param version - Version string potentially prefixed with gcc- or g++-
 * @returns Cleaned version string without the prefix
 */
export const removeGCCPrefix = createCompilerPrefixRemover('gcc', 'g++');

/**
 * Input schema for the setup-gcc action.
 *
 * Based on setupInputs with GCC-specific customizations.
 */
export const inputsSchema = {
    ...createSetupInputs('GCC'),

    // Override version to add prefix-stripping transform
    version: {
        ...createSetupInputs('GCC').version,
        transform: (v) => removeGCCPrefix(v as string)
    },

    // Override path with gcc/g++ specific description
    path: {
        type: 'string[]' as const,
        splitter: /[:;]/,
        default: [] as string[],
        description: 'Path to the gcc or g++ executable. We attempt to find GCC at this path first.'
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-gcc action.
 *
 * Based on compilerOutputs with GCC-specific descriptions.
 */
export const outputsSchema = {
    ...createCompilerOutputs('GCC', 'gcc', 'g++')
} satisfies ActionOutputsSchema;
