/**
 * Type definitions for setup-msvc action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-msvc action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output values produced by MSVC configuration.
 */
export interface Outputs {
    cc: string
    cxx: string
    bindir: string
    dir: string
    release: string
    versionMajor: number
    versionMinor: number
    versionPatch: number
    msvcToolsetVersion: string
    msvcProductVersion: string
    msvcReleaseYear: string
    msvcCompilerVersion: string
}

/**
 * Extended output values including the version string.
 */
export interface MainOutputs extends Outputs {
    version: string
}

/**
 * Metadata used when building MSVC output values.
 */
export interface BuildOutputsMetadata {
    compilerVersion?: string
}
