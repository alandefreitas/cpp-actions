/**
 * Type definitions for setup-program action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Input configuration for the setup-program action.
 * Inferred from the schema definition in schema.ts.
 */
export type SetupProgramInputs = InferInputs<typeof inputsSchema>;

/**
 * Result of a program search or installation operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
    /** The APT package name that was installed (only set when installed via APT) */
    installedPackage?: string | null;
}

/**
 * Output from executing a command via exec.getExecOutput.
 */
export interface ExecOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Package preference tier for APT package selection.
 *
 * Lower tier number means higher preference:
 * - Tier 1: Unversioned packages (e.g., "clang", "gcc") - best system integration
 * - Tier 2: Raw versioned packages (e.g., "clang-14", "gcc-12") - what users expect
 * - Tier 3: Other versioned packages (e.g., "clang-14-tools") - fallback only
 */
export enum PackagePreferenceTier {
    UNVERSIONED = 1,
    RAW_VERSIONED = 2,
    OTHER_VERSIONED = 3
}

/**
 * Options for fetching Git tags from a repository.
 */
export interface FetchGitTagsOptions {
    maxRetries?: number;
    defaultTags?: string[];
}

/**
 * Options for cloning a Git repository.
 */
export interface CloneGitRepoOptions {
    shallow?: boolean;
}

/**
 * Result of searching APT repositories for a package.
 */
export interface AptPackageMatch {
    /** The best matching package name (e.g., "clang-14") */
    packageName: string;
    /** The specific APT version string for installation (e.g., "1:14.0.0-1ubuntu1") */
    packageVersion: string | null;
    /** The parsed semver version (e.g., "14.0.0") */
    semverVersion: string;
    /** The preference tier of this package */
    tier: PackagePreferenceTier;
    /** Alternative packages that also satisfy requirements, in "package=version" format */
    alternatives: string[];
}
