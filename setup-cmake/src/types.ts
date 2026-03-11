/**
 * Type definitions for setup-cmake action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-cmake action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output values produced by CMake setup.
 */
export interface Outputs {
    path: string;
    dir: string;
    version: string;
    versionMajor: number;
    versionMinor: number;
    versionPatch: number;
    cacheHit: boolean;
    supportsPathToBuild: boolean;
    supportsParallelBuild: boolean;
    supportsBuildMultipleTargets: boolean;
    supportsCmakeInstall: boolean;
    supportedPresetsVersion: number;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}
