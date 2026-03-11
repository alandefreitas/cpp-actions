/**
 * Shared type definitions for setup-program action.
 *
 * Contains types used across 3+ modules. Types owned by a single module
 * are co-located with that module instead.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-program action.
 * Inferred from the schema definition in schema.ts.
 */
export type SetupProgramInputs = InferInputs<typeof inputsSchema>;

/**
 * Result of a program search or installation operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
    /** The APT package name that was installed (only set when installed via APT) */
    installedPackage?: string | null;
}

/**
 * Output from executing a command via exec.getExecOutput.
 */
export interface ExecOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}
