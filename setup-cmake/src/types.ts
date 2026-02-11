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
    version_major: number;
    version_minor: number;
    version_patch: number;
    cache_hit: boolean;
    supports_path_to_build: boolean;
    supports_parallel_build: boolean;
    supports_build_multiple_targets: boolean;
    supports_cmake_install: boolean;
    supported_presets_version: number;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
}
