/**
 * Type definitions for setup-cmake action.
 *
 * @module types
 */

/**
 * Configuration inputs for the setup-cmake action.
 */
export interface Inputs {
    version: string;
    architecture: string;
    cmake_file: string;
    path: string;
    cmake_path: string;
    cache: boolean;
    check_latest: boolean;
    update_environment: boolean;
    trace_commands: boolean;
}

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
