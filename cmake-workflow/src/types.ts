/**
 * Shared type definitions for cmake-workflow action.
 *
 * Contains types used across 3+ modules. Types used by fewer modules
 * are co-located with their owning module.
 *
 * @module types
 */

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
    ldflags: string;
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
