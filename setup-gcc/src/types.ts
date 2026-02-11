/**
 * Type definitions for setup-gcc action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-gcc action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output values produced by GCC setup.
 */
export interface MainOutputs {
    output_path: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    version_major: number;
    version_minor: number;
    version_patch: number;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
}
