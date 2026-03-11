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
    cmakePath: string;
    /** CMake version to use */
    cmakeVersion: string;
    /** Path to the source directory */
    sourceDir: string;
    url: string;
    gitRepository: string;
    gitTag: string;
    downloadDir: string;
    patches: string[];
    /** Base build directory (suffixes added for non-main factor combinations) */
    buildDir: string;
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
    generatorToolset: string;
    generatorArchitecture: string;
    arch: string;
    buildType: string;
    buildTarget: (string | null)[];
    /** Extra CMake arguments - array for single config, map for combinatorial factor */
    extraArgs: string[] | Record<string, string[]>;
    exportCompileCommands: boolean | undefined;
    jobs: number;
    runTests: boolean | undefined;
    configureTestsFlag: string;
    testAllCxxstd: boolean;
    ctestTimeout: number | undefined;
    install: boolean | undefined;
    installAllCxxstd: boolean | undefined;
    /** Base install prefix (suffixes added for non-main factor combinations) */
    installPrefix: string;
    package: boolean | undefined;
    packageAllCxxstd: boolean;
    packageName: string;
    /** Base package directory (suffixes added for non-main factor combinations) */
    packageDir: string;
    packageVendor: string;
    packageGenerators: string[];
    packageArtifact: boolean | undefined;
    packageRetentionDays: number;
    createAnnotations: boolean | undefined;
    refSourceDir: string;
    traceCommands: boolean;
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
    cmakePath: string;
    /** CMake version to use */
    cmakeVersion: string;
    /** Path to the source directory */
    sourceDir: string;
    url: string;
    gitRepository: string;
    gitTag: string;
    downloadDir: string;
    patches: string[];
    /** Resolved build directory for this entry (includes factor suffix if needed) */
    buildDir: string;
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
    generatorToolset: string;
    generatorArchitecture: string;
    arch: string;
    buildType: string;
    /** Build targets to compile (internal loop, not a combinatorial factor) */
    buildTarget: (string | null)[];
    /** Resolved extra CMake arguments (always an array) */
    extraArgs: string[];
    exportCompileCommands: boolean | undefined;
    jobs: number;
    runTests: boolean | undefined;
    configureTestsFlag: string;
    ctestTimeout: number | undefined;
    install: boolean | undefined;
    /** Resolved install prefix for this entry (includes factor suffix if needed) */
    installPrefix: string;
    package: boolean | undefined;
    packageName: string;
    /** Resolved package directory for this entry (includes factor suffix if needed) */
    packageDir: string;
    packageVendor: string;
    /** Package generators to use (internal loop, not a combinatorial factor) */
    packageGenerators: string[];
    packageArtifact: boolean | undefined;
    packageRetentionDays: number;
    createAnnotations: boolean | undefined;
    refSourceDir: string;
    traceCommands: boolean;
    /** Key identifying the extraArgs configuration (undefined if extraArgs was an array) */
    extra_args_key?: string;
    /** Whether this is the main/default entry (gets exact user paths without suffixes) */
    is_main_entry: boolean;
    /** Run tests for all cxxstd values (true) or only main entry (false) */
    testAllCxxstd: boolean;
    /** Install for all cxxstd values (true) or only main entry (false) */
    installAllCxxstd: boolean | undefined;
    /** Package for all cxxstd values (true) or only main entry (false) */
    packageAllCxxstd: boolean;
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
    supportedPresetsVersion: number;
    /** Whether CMake supports --build <path-to-build> */
    supportsPathToBuild?: boolean;
    /** Whether CMake supports multiple --target arguments */
    supportsBuildMultipleTargets?: boolean;
    /** Whether CMake supports parallel builds */
    supportsParallelBuild?: boolean;
    /** Whether CMake supports cmake --install */
    supportsCmakeInstall?: boolean;
}

/**
 * Parameters resolved during workflow execution.
 */
export interface ResolvedParameters {
    /** Primary C++ standard version being used */
    mainCxxstd: string | null;
    /** Whether the generator supports multiple configurations */
    generatorIsMultiConfig: boolean;
    /** Path to the CTest executable */
    ctestPath: string;
    /** Path to the CPack executable */
    cpackPath: string;
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
