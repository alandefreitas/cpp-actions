/**
 * Type definitions for boost-clone action.
 *
 * @module types
 */

import * as semver from 'semver';
import type { InferInputs } from 'action-schema';
import type { inputsSchema, CloneStrategy } from './schema';

/**
 * Raw input type as parsed from the schema.
 * Uses string[] instead of Set<string>.
 */
export type RawInputs = InferInputs<typeof inputsSchema>;

// Re-export CloneStrategy from schema
export type { CloneStrategy };

/**
 * Module dependency information from precomputed data.
 */
export interface ModuleDeps {
    direct_deps: string[];
    transitive_deps: string[];
    total_count: number;
}

/**
 * Precomputed dependency data structure.
 */
export interface BoostDepsData {
    generated: string;
    releases: Record<string, { modules: Record<string, ModuleDeps> }>;
}

/**
 * Configuration inputs for the boost-clone action.
 */
export interface Inputs {
    boost_dir: string;
    branch: string;
    modules: Set<string>;
    patches: Set<string>;
    scan_modules_ignore: Set<string>;
    scan_modules_dir: Set<string>;
    modules_scan_paths: Set<string>;
    modules_exclude_paths: Set<string>;
    cache: boolean;
    optimistic_caching: boolean;
    trace_commands: boolean;
    clone_strategy: CloneStrategy;
    archive_threshold: number;
}

/**
 * Output values from the boost-clone action.
 */
export interface Outputs {
    boost_dir: string;
}

/**
 * Git executable capabilities detected at runtime.
 */
export interface GitFeatures {
    gitPath: string;
    version: semver.SemVer;
    supportsJobs: boolean;
    supportsScanScripts: boolean;
    supportsDepth: boolean;
}

/**
 * Individual hash components used to build the cache key.
 */
export interface CacheKeyFragments {
    boostHash: string;
    modulesAndPatchesHash: string;
    configHash: string;
}

/**
 * Result from cache key generation including the key and its fragments.
 */
export interface CacheKeyResult {
    cacheKey: string;
    fragments: CacheKeyFragments;
}

/**
 * Options for cache key generation behavior.
 */
export interface GenerateCacheKeyOptions {
    logInfo?: boolean;
    withFragments?: boolean;
}

/**
 * Result from module estimation with precomputed data.
 */
export interface ModuleEstimation {
    totalCount: number;
    allModules: Set<string>;
    fromPrecomputed: boolean;
}
