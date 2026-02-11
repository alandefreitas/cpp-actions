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
    version_candidates: string[];
    ubuntu_versions: string[];
}

/**
 * LLVM project URLs for downloading Clang releases.
 */
export interface ClangUrls {
    llvm_project_url: string;
    llvm_releases_url: string;
    old_llvm_releases_url: string;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
}

/**
 * Output values produced by Clang setup.
 */
export interface MainOutputs {
    output_path: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    version_major: number;
    version_minor: number;
    version_patch: number;
    symbolizer_path: string | null;
}

/**
 * Result of companion package installation.
 */
export interface CompanionPackageResult {
    /** Path to llvm-symbolizer if found, null otherwise */
    symbolizerPath: string | null;
}
