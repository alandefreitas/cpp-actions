/**
 * Type definitions for setup-cpp action.
 *
 * @module types
 */

/**
 * Result of normalizing a compiler name and version.
 */
export interface NormalizedCompiler {
    compiler: string;
    version: string;
}

/**
 * Configuration inputs for the setup-cpp action.
 */
export interface Inputs {
    compiler: string;
    version: string;
    path: string[];
    check_latest: boolean;
    update_environment: boolean;
    trace_commands: boolean;
    arch: string;
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
