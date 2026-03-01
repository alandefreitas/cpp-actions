/**
 * Type definitions for cmake-workflow action.
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
 * Represents a compiler or CMake message for annotation creation.
 */
export interface Message {
    /** Message title for the annotation */
    title: string;
    /** Source file path */
    file?: string;
    /** Line number in the file */
    line?: number;
    /** Column number in the file */
    column?: number;
    /** Message severity (warning, error) */
    severity: string;
    /** The message content */
    message: string;
}

/**
 * Configuration inputs for the CMake workflow action.
 *
 * This interface represents the raw inputs from the action, where some fields
 * are arrays/maps representing combinatorial factors. These are expanded into
 * individual `ResolvedInputs` entries by the `expandInputs()` function.
 */
export interface Inputs {
    /** Path to the CMake executable */
    cmake_path: string;
    /** CMake version to use */
    cmake_version: string;
    /** Path to the source directory */
    source_dir: string;
    url: string;
    git_repository: string;
    git_tag: string;
    download_dir: string;
    patches: string[];
    /** Base build directory (suffixes added for non-main factor combinations) */
    build_dir: string;
    preset: string;
    cc: string;
    ccflags: string;
    cxx: string;
    cxxflags: string;
    /** C++ standard versions to build (combinatorial factor) */
    cxxstd: (string | null)[];
    shared: boolean | undefined;
    toolchain: string;
    generator: string;
    generator_toolset: string;
    generator_architecture: string;
    arch: string;
    build_type: string;
    build_target: (string | null)[];
    /** Extra CMake arguments - array for single config, map for combinatorial factor */
    extra_args: string[] | Record<string, string[]>;
    export_compile_commands: boolean | undefined;
    jobs: number;
    run_tests: boolean | undefined;
    configure_tests_flag: string;
    test_all_cxxstd: boolean;
    ctest_timeout: number | undefined;
    install: boolean | undefined;
    install_all_cxxstd: boolean | undefined;
    /** Base install prefix (suffixes added for non-main factor combinations) */
    install_prefix: string;
    package: boolean | undefined;
    package_all_cxxstd: boolean;
    package_name: string;
    /** Base package directory (suffixes added for non-main factor combinations) */
    package_dir: string;
    package_vendor: string;
    package_generators: string[];
    package_artifact: boolean | undefined;
    package_retention_days: number;
    create_annotations: boolean | undefined;
    ref_source_dir: string;
    trace_commands: boolean;
}

/**
 * Resolved inputs for a single workflow entry after expanding combinatorial factors.
 *
 * This interface represents a single configuration to execute, where all
 * combinatorial factors have been resolved to single values. The `expandInputs()`
 * function generates a list of these from the raw `Inputs`.
 */
export interface ResolvedInputs {
    /** Path to the CMake executable */
    cmake_path: string;
    /** CMake version to use */
    cmake_version: string;
    /** Path to the source directory */
    source_dir: string;
    url: string;
    git_repository: string;
    git_tag: string;
    download_dir: string;
    patches: string[];
    /** Resolved build directory for this entry (includes factor suffix if needed) */
    build_dir: string;
    preset: string;
    cc: string;
    ccflags: string;
    cxx: string;
    cxxflags: string;
    /** Single C++ standard version for this entry */
    cxxstd: string | null;
    shared: boolean | undefined;
    toolchain: string;
    generator: string;
    generator_toolset: string;
    generator_architecture: string;
    arch: string;
    build_type: string;
    /** Build targets to compile (internal loop, not a combinatorial factor) */
    build_target: (string | null)[];
    /** Resolved extra CMake arguments (always an array) */
    extra_args: string[];
    export_compile_commands: boolean | undefined;
    jobs: number;
    run_tests: boolean | undefined;
    configure_tests_flag: string;
    ctest_timeout: number | undefined;
    install: boolean | undefined;
    /** Resolved install prefix for this entry (includes factor suffix if needed) */
    install_prefix: string;
    package: boolean | undefined;
    package_name: string;
    /** Resolved package directory for this entry (includes factor suffix if needed) */
    package_dir: string;
    package_vendor: string;
    /** Package generators to use (internal loop, not a combinatorial factor) */
    package_generators: string[];
    package_artifact: boolean | undefined;
    package_retention_days: number;
    create_annotations: boolean | undefined;
    ref_source_dir: string;
    trace_commands: boolean;
    /** Key identifying the extra_args configuration (undefined if extra_args was an array) */
    extra_args_key?: string;
    /** Whether this is the main/default entry (gets exact user paths without suffixes) */
    is_main_entry: boolean;
    /** Run tests for all cxxstd values (true) or only main entry (false) */
    test_all_cxxstd: boolean;
    /** Install for all cxxstd values (true) or only main entry (false) */
    install_all_cxxstd: boolean | undefined;
    /** Package for all cxxstd values (true) or only main entry (false) */
    package_all_cxxstd: boolean;
}

/**
 * Outputs from the setup-cmake action.
 */
export interface SetupCMakeOutputs {
    /** Path to the CMake executable */
    path: string;
    /** Directory containing CMake */
    dir: string;
    /** Maximum supported CMake preset version */
    supported_presets_version: number;
    /** Whether CMake supports --build <path-to-build> */
    supports_path_to_build?: boolean;
    /** Whether CMake supports multiple --target arguments */
    supports_build_multiple_targets?: boolean;
    /** Whether CMake supports parallel builds */
    supports_parallel_build?: boolean;
    /** Whether CMake supports cmake --install */
    supports_cmake_install?: boolean;
}

/**
 * Parameters resolved during workflow execution.
 */
export interface ResolvedParameters {
    /** Primary C++ standard version being used */
    main_cxxstd: string | null;
    /** Whether the generator supports multiple configurations */
    generator_is_multi_config: boolean;
    /** Path to the CTest executable */
    ctest_path: string;
    /** Path to the CPack executable */
    cpack_path: string;
}

/**
 * Result of reading and validating a CMake preset file.
 */
export interface PresetFileResult {
    /** Whether the preset file exists */
    exists: boolean;
    /** Whether the preset version is supported */
    supported: boolean;
    /** Parsed preset JSON content */
    presetJson: Record<string, unknown>;
}
