/**
 * Type definitions for setup-gcc action.
 *
 * @module types
 */

/**
 * Configuration inputs for the setup-gcc action.
 */
export interface Inputs {
    version: string;
    path: string[];
    check_latest: boolean;
    update_environment: boolean;
    trace_commands: boolean;
}

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
