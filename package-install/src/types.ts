/**
 * Type definitions for package-install action.
 *
 * @module types
 */

/**
 * Configuration inputs for the package-install action.
 */
export interface Inputs {
    // packages
    vcpkg: string[];
    apt_get: string[];
    // vcpkg options
    cxx: string;
    cxxflags: string;
    cc: string;
    ccflags: string;
    vcpkg_triplet: string;
    vcpkg_dir: string;
    vcpkg_branch: string;
    vcpkg_cache: boolean;
    vcpkg_force_install: boolean;
    // apt-get options
    apt_get_retries: number;
    apt_get_sources: string[];
    apt_get_source_keys: string[];
    apt_get_ignore_missing: boolean;
    apt_get_add_architecture: string[];
    apt_get_bulk_install: boolean;
    // Annotations and tracing
    trace_commands: boolean;
}

/**
 * Output values from vcpkg installation.
 */
export interface VcpkgOutputs {
    vcpkg_executable?: string;
    vcpkg_toolchain?: string;
}
