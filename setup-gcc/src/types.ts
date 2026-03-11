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
    outputPath: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    versionMajor: number;
    versionMinor: number;
    versionPatch: number;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}
