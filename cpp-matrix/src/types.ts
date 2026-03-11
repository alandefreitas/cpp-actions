/**
 * Type definitions for cpp-matrix action.
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
 * Configuration inputs for the cpp-matrix action.
 */
export interface Inputs {
    /** Compiler version requirements */
    compiler_versions: CompilerVersions;
    subrangePolicy: SubrangePolicyMap;
    standards: string;
    maxStandards?: number;
    latestFactors: CompilerFactors;
    factors: CompilerFactors;
    combinatorialFactors: CompilerFactors;
    forceFactors: CompilerSuggestion[];
    extraValues?: KeyValue[];
    runsOn: CompilerSuggestion[];
    containers: CompilerSuggestion[];
    generators: CompilerSuggestion[];
    generatorToolsets: CompilerSuggestion[];
    b2Toolsets: CompilerSuggestion[];
    ccflags: CompilerSuggestion[];
    cxxflags: CompilerSuggestion[];
    install: CompilerSuggestion[];
    appendCcflags: CompilerSuggestion[];
    appendCxxflags: CompilerSuggestion[];
    appendInstall: CompilerSuggestion[];
    triplets: CompilerSuggestion[];
    buildTypes: CompilerSuggestion[];
    defaultBuildType: string;
    sanitizerBuildType: string;
    x86BuildType: string;
    useContainers: boolean;
    warnNoMatches: boolean;
    outputFile?: string;
    logMatrix: boolean;
    generateSummary: boolean;
    traceCommands: boolean;
    /** Enable sorting by historical failure rate */
    sortByFailureRate: boolean;
    /** Number of recent workflow runs to analyze for failure rates */
    failureRateRuns: number;
    /** GitHub token for API access */
    githubToken: string;
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

/**
 * Policies for selecting versions from a semver range when generating matrix entries.
 *
 * These policies control which specific versions are selected when a version range
 * would match multiple available versions (e.g., what to do with ">=10" when 10, 11, 12 exist).
 */
export const SubrangePolicies = {
    ONE_PER_MAJOR: 0,
    ONE_PER_MINOR: 1,
    ONE_PER_MAJOR_OR_MINOR: 2
} as const;

/**
 * A policy for handling version subranges in the matrix.
 */
export type SubrangePolicy = typeof SubrangePolicies[keyof typeof SubrangePolicies];

/**
 * Maps job names to their failure rates.
 */
export interface FailureRates {
    [jobName: string]: number;
}

/**
 * Represents a job from GitHub's workflow run API.
 */
export interface WorkflowJob {
    name: string;
    conclusion: string | null;
}

/**
 * Represents a workflow run from GitHub's API.
 */
export interface WorkflowRun {
    id: number;
    status: string;
    conclusion: string | null;
}
