/**
 * Type definitions for setup-clang action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-clang action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Candidate versions and Ubuntu releases for Clang download attempts.
 */
export interface ClangDownloadCandidates {
    versionCandidates: string[];
    ubuntuVersions: string[];
}

/**
 * LLVM project URLs for downloading Clang releases.
 */
export interface ClangUrls {
    llvmProjectUrl: string;
    llvmReleasesUrl: string;
    oldLlvmReleasesUrl: string;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}

/**
 * Output values produced by Clang setup.
 */
export interface MainOutputs {
    outputPath: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    versionMajor: number;
    versionMinor: number;
    versionPatch: number;
    symbolizerPath: string | null;
}

/**
 * Result of companion package installation.
 */
export interface CompanionPackageResult {
    /** Path to llvm-symbolizer if found, null otherwise */
    symbolizerPath: string | null;
}
