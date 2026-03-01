/**
 * Type definitions for setup-cpp action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-cpp action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Result of normalizing a compiler name and version.
 */
export interface NormalizedCompiler {
    compiler: string;
    version: string;
}

/**
 * Result of setting up a C++ compiler.
 */
export interface SetupResult {
    output_path: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string | null;
    dir: string | null;
    release: string | null;
    version_major: number | null;
    version_minor: number | null;
    version_patch: number | null;
}
