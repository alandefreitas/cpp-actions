/**
 * Schema definitions for the setup-clang action.
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
    type ActionOutputsSchema,
    type InferInputs
} from 'action-schema';

/**
 * Removes "clang-" or "clang++-" prefixes from a version string.
 *
 * @param version - Version string potentially prefixed with clang- or clang++-
 * @returns Cleaned version string without the prefix
 */
export const removeClangPrefix = createCompilerPrefixRemover('clang', 'clang++');

/**
 * Input schema for the setup-clang action.
 *
 * Based on setupInputs with Clang-specific customizations.
 */
export const inputsSchema = {
    ...createSetupInputs('Clang'),

    // Override version to add prefix-stripping transform
    version: {
        ...createSetupInputs('Clang').version,
        transform: (v) => removeClangPrefix(v as string)
    },

    // Override path with clang/clang++ specific description and default
    path: {
        type: 'string[]' as const,
        splitter: /[:;]/,
        default: ['clang++'] as string[],
        description: 'The clang or clang++ executable. We attempt to find Clang at this path first.'
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the setup-clang action.
 *
 * Based on compilerOutputs with Clang-specific additions.
 */
export const outputsSchema = {
    ...createCompilerOutputs('Clang', 'clang', 'clang++'),
    symbolizerPath: {
        description: `The absolute path to llvm-symbolizer (Linux only).

This is also exported as ASAN_SYMBOLIZER_PATH, MSAN_SYMBOLIZER_PATH,
TSAN_SYMBOLIZER_PATH, and UBSAN_SYMBOLIZER_PATH environment variables
when update-environment is true.`
    }
} satisfies ActionOutputsSchema;

/**
 * Input configuration for the setup-clang action.
 * Inferred from the schema definition.
 */
export type Inputs = InferInputs<typeof inputsSchema>;
