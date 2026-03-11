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
    b2Key: string;
    /** Value to use when option is true */
    trueValue: string;
    /** Value to use when option is false, or undefined to omit */
    falseValue: string | undefined;
}

/**
 * Input configuration for the B2 workflow action.
 *
 * Contains all settings for configuring and running a Boost.Build workflow,
 * including compiler settings, build options, sanitizers, and debug flags.
 */
export interface Inputs {
    // Configure options
    sourceDir: string;
    buildDir: string;
    cxx: string;
    ccflags: string;
    cxxflags: string;
    cxxstd: string;
    shared: boolean | undefined;
    toolset: string;
    arch: string;
    buildType: string;
    modules: string[];
    moduleTarget: string[];
    extraArgs: string[];
    // B2-specific options
    warningsAsErrors: boolean | string | undefined;
    addressModel: string | undefined;
    asan: boolean | string | undefined;
    ubsan: boolean | string | undefined;
    msan: boolean | string | undefined;
    tsan: boolean | string | undefined;
    coverage: string | undefined;
    linkflags: string | undefined;
    threading: string | undefined;
    rtti: boolean | string | undefined;
    clean: boolean | undefined;
    cleanAll: boolean | undefined;
    abbreviatePaths: boolean | undefined;
    hash: boolean | undefined;
    rebuildAll: boolean | undefined;
    dryRun: boolean | undefined;
    stopOnError: boolean | undefined;
    config: string;
    siteConfig: string;
    userConfig: string;
    projectConfig: string;
    debugConfiguration: boolean | undefined;
    debugBuilding: boolean | undefined;
    debugGenerators: boolean | undefined;
    include: string;
    define: string | undefined;
    runtimeLink: boolean | string | undefined;
    // Build options
    jobs: number;
    // Annotations and tracing
    traceCommands: boolean;
}
