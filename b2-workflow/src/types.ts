/**
 * Type definitions for b2-workflow action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Raw input type as parsed from the schema.
 * Uses simple types that are later converted to internal types.
 */
export type RawInputs = InferInputs<typeof inputsSchema>;

/**
 * Configuration for B2 architecture settings.
 */
export interface ArchConfig {
    /** Normalized architecture identifier (x86, x64, arm, arm64) */
    normalizedArch: string;
    /** B2 address model (32 or 64 bit) */
    addressModel?: string;
    /** B2 architecture family (x86 or arm) */
    architecture?: string;
}

/**
 * Configuration for options that accept boolean or string values.
 *
 * Allows users to provide either true/false or custom string values
 * for B2 options.
 */
export interface BoolOrStringOption {
    /** Input key name */
    key: string;
    /** Corresponding B2 command-line key */
    b2_key: string;
    /** Value to use when option is true */
    true_value: string;
    /** Value to use when option is false, or undefined to omit */
    false_value: string | undefined;
}

/**
 * Input configuration for the B2 workflow action.
 *
 * Contains all settings for configuring and running a Boost.Build workflow,
 * including compiler settings, build options, sanitizers, and debug flags.
 */
export interface Inputs {
    // Configure options
    source_dir: string;
    build_dir: string;
    cxx: string;
    ccflags: string;
    cxxflags: string;
    cxxstd: string;
    shared: boolean | undefined;
    toolset: string;
    arch: string;
    build_type: string;
    modules: string[];
    module_target: string[];
    extra_args: string[];
    // B2-specific options
    warnings_as_errors: boolean | string | undefined;
    address_model: string | undefined;
    asan: boolean | string | undefined;
    ubsan: boolean | string | undefined;
    msan: boolean | string | undefined;
    tsan: boolean | string | undefined;
    coverage: string | undefined;
    linkflags: string | undefined;
    threading: string | undefined;
    rtti: boolean | string | undefined;
    clean: boolean | undefined;
    clean_all: boolean | undefined;
    abbreviate_paths: boolean | undefined;
    hash: boolean | undefined;
    rebuild_all: boolean | undefined;
    dry_run: boolean | undefined;
    stop_on_error: boolean | undefined;
    config: string;
    site_config: string;
    user_config: string;
    project_config: string;
    debug_configuration: boolean | undefined;
    debug_building: boolean | undefined;
    debug_generators: boolean | undefined;
    include: string;
    define: string | undefined;
    runtime_link: boolean | string | undefined;
    // Build options
    jobs: number;
    // Annotations and tracing
    trace_commands: boolean;
}
