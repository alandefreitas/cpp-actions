/**
 * Shared type definitions for cpp-matrix action.
 *
 * Types used across 3+ modules are kept here; types used by 1-2 modules
 * are co-located with the owning module.
 *
 * @module types
 */

/**
 * Maps compiler names to their version range strings.
 */
export interface CompilerVersions {
    [compiler: string]: string;
}

/**
 * Maps compiler names to arrays of factor strings.
 */
export interface CompilerFactors {
    [compiler: string]: string[];
}

/**
 * A suggestion for compiler-specific configuration values.
 */
export interface CompilerSuggestion {
    /** Compiler name to match */
    compiler: string;
    /** Version range to match */
    range?: string;
    /** Factor to match */
    factor?: string;
    /** Value to apply */
    value: string;
}

/**
 * A key-value pair for extra matrix values.
 */
export interface KeyValue {
    /** The key name */
    key: string;
    /** The value */
    value: string;
}

/**
 * Maps compiler names to subrange policy strings.
 */
export interface SubrangePolicyMap {
    [compiler: string]: string;
}

/**
 * A single entry in the generated CI matrix.
 */
export interface MatrixEntry {
    /** Display name for the matrix entry */
    name: string;
    /** Compiler name */
    compiler: string;
    version: string;
    env: Record<string, string>;
    cxxstd?: string;
    'latest-cxxstd'?: string;
    major?: number | string;
    minor?: number | string;
    patch?: number | string;
    cxx?: string;
    cc?: string;
    'runs-on'?: string | string[];
    container?: string | ContainerConfig;
    'b2-toolset'?: string;
    generator?: string;
    'generator-toolset'?: string;
    'is-latest': boolean;
    'is-main': boolean;
    'is-earliest': boolean;
    'is-intermediary': boolean;
    'has-major': boolean;
    'has-minor': boolean;
    'has-patch': boolean;
    'subrange-policy': string;
    'build-type'?: string;
    cxxflags?: string;
    ccflags?: string;
    install?: string;
    arch?: string;
    x86?: boolean;
    asan?: boolean;
    ubsan?: boolean;
    msan?: boolean;
    tsan?: boolean;
    intsan?: boolean;
    boundsan?: boolean;
    lsan?: boolean;
    cfi?: boolean;
    coverage?: boolean;
    'time-trace'?: boolean;
    'has-factors'?: boolean;
    'is-no-factor-intermediary'?: boolean;
    'is-container'?: boolean;
    triplet?: string;
    os?: string;
    [key: string]: unknown;
}

/**
 * Configuration for a Docker container in a matrix entry.
 */
export interface ContainerConfig {
    /** Docker image name */
    image: string;
    /** Volume mounts for the container */
    volumes?: string[];
}
