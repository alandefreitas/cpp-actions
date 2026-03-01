/**
 * Type definitions for package-install action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the package-install action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output values from vcpkg installation.
 */
export interface VcpkgOutputs {
    vcpkg_executable?: string;
    vcpkg_toolchain?: string;
}
