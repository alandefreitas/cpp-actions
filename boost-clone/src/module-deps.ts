/**
 * Module dependency utilities for boost-clone action.
 *
 * ## Precomputed Transitive Dependency Resolution
 *
 * This module implements the precomputed resolution strategy. It uses
 * hardcoded data in `boost-deps.json` to expand
 * a set of direct modules into their full transitive closure. This is a pure
 * in-memory lookup with no I/O, available for known Boost release tags.
 *
 * For non-release branches (develop, master), the caller passes the latest
 * known release as an approximation. This is acceptable for strategy
 * selection (git vs archive) but is NOT exact — the actual transitive closure
 * may differ. The journal and runtime discovery handle the non-release case
 * exactly.
 *
 * Patch modules (external repos) are not in `boost-deps.json`, but their
 * direct deps are discovered by pre-scanning and fed into the estimation
 * as additional roots. Those deps (standard Boost modules) are then expanded
 * transitively via `boost-deps.json` as usual.
 *
 * @module module-deps
 */

import * as core from '@actions/core';
import type { Inputs, CloneStrategy } from './schema';

// Import precomputed dependency data
import boostDepsData from '../boost-deps.json';

/**
 * Module dependency information from precomputed boost-deps.json.
 * Contains only direct dependencies — transitive closure is computed
 * at resolution time by walking the graph.
 */
export interface ModuleDeps {
    /** List of direct dependency module names */
    direct_deps: string[];
}

/**
 * Precomputed dependency data structure for known Boost releases.
 */
export interface BoostDepsData {
    /** ISO timestamp when the data was generated */
    generated: string;
    /** Per-release module dependency maps */
    releases: Record<string, { modules: Record<string, ModuleDeps> }>;
}

/**
 * Result from module estimation with precomputed data.
 * Used for git-vs-archive strategy selection, NOT for cache key computation.
 */
export interface ModuleEstimation {
    /** Estimated total module count including transitive deps */
    totalCount: number;
    /** All estimated modules */
    allModules: Set<string>;
    /** Whether the estimate came from precomputed data */
    fromPrecomputed: boolean;
}

/**
 * Checks if a branch name is a Boost release tag (e.g., boost-1.87.0).
 *
 * @param branch - The branch name to check
 * @returns True if the branch is a release tag
 */
export function isReleaseTag(branch: string): boolean {
    return /^boost-\d+\.\d+\.\d+$/.test(branch);
}

/**
 * Gets the latest release tag from precomputed data.
 *
 * @returns The latest release tag or null if no data available
 */
export function getLatestRelease(): string | null {
    const depsData = boostDepsData as BoostDepsData;
    const releases = Object.keys(depsData.releases);
    if (releases.length === 0) {
        return null;
    }
    // Releases should already be sorted newest first
    return releases[0];
}

/**
 * Computes the transitive closure of a set of modules by walking
 * direct_deps recursively (BFS) using precomputed data.
 *
 * @param requestedModules - Initial set of modules
 * @param releaseData - Module dependency data for the release
 * @returns The full transitive closure
 */
function computeTransitiveClosure(
    requestedModules: Iterable<string>,
    releaseData: { modules: Record<string, { direct_deps: string[] }> }
): Set<string> {
    const allModules = new Set<string>();
    const queue = [...requestedModules];

    while (queue.length > 0) {
        const mod = queue.pop()!;
        if (allModules.has(mod)) {
            continue;
        }
        allModules.add(mod);
        const modData = releaseData.modules[mod];
        if (modData) {
            for (const dep of modData.direct_deps) {
                if (!allModules.has(dep)) {
                    queue.push(dep);
                }
            }
        }
    }

    return allModules;
}

/**
 * Estimates the total number of modules (including transitive dependencies)
 * for a set of requested modules using precomputed data.
 *
 * This only resolves transitive deps for modules present in `boost-deps.json`.
 * Patch modules (external repos like cppalliance/buffers) are not in this data,
 * but their direct deps should be included in `requestedModules` by the caller
 * (via journal pre-scan) so they are expanded transitively.
 *
 * @param requestedModules - Set of directly requested modules
 * @param releaseTag - Release tag to use for precomputed data lookup, or null if unavailable
 * @returns Object with estimated total count and the full set of modules
 */
export function estimateTotalModules(requestedModules: Set<string>, releaseTag: string | null): ModuleEstimation {
    const depsData = boostDepsData as BoostDepsData;

    if (!releaseTag || !depsData.releases[releaseTag]) {
        // No precomputed data available, return just the requested modules
        return {
            totalCount: requestedModules.size,
            allModules: new Set(requestedModules),
            fromPrecomputed: false
        };
    }

    const releaseData = depsData.releases[releaseTag];
    const allModules = computeTransitiveClosure(requestedModules, releaseData);

    return {
        totalCount: allModules.size,
        allModules,
        fromPrecomputed: true
    };
}

/**
 * Gets the full transitive closure for a set of direct modules using
 * precomputed data for a specific release tag.
 *
 * Returns null if the release tag is not in the precomputed data.
 * This is the fast path for exact release tags without patches.
 *
 * @param directModules - Set of directly requested modules
 * @param releaseTag - Boost release tag (e.g., "boost-1.87.0")
 * @returns The full transitive closure, or null if data unavailable
 */
export function getTransitiveClosure(
    directModules: Set<string>,
    releaseTag: string
): Set<string> | null {
    const depsData = boostDepsData as BoostDepsData;
    if (!depsData.releases[releaseTag]) {
        return null;
    }

    const releaseData = depsData.releases[releaseTag];
    return computeTransitiveClosure(directModules, releaseData);
}

/**
 * Decides which clone strategy to use based on inputs and context.
 *
 * @param inputs - User inputs including strategy preference
 * @param estimatedModules - Estimated total module count
 * @returns The strategy to use ('git' or 'archive')
 */
export function decideStrategy(inputs: Inputs, estimatedModules: number): CloneStrategy {
    // If user explicitly requested a strategy, use it
    if (inputs.clone_strategy === 'git') {
        return 'git';
    }
    if (inputs.clone_strategy === 'archive') {
        if (!isReleaseTag(inputs.branch)) {
            core.warning(`Archive strategy requested but branch '${inputs.branch}' is not a release tag. Falling back to git.`);
            return 'git';
        }
        return 'archive';
    }

    // Auto mode: decide based on branch type and module count
    if (!isReleaseTag(inputs.branch)) {
        // develop/master: always use git (no archive available)
        return 'git';
    }

    // Release tag: use archive if module count exceeds threshold
    if (estimatedModules > inputs.archive_threshold) {
        core.info(`Estimated ${estimatedModules} modules exceeds threshold (${inputs.archive_threshold}), using archive strategy`);
        return 'archive';
    }

    return 'git';
}

/**
 * Gets the precomputed boost deps data.
 *
 * @returns The boost deps data
 */
export function getBoostDepsData(): BoostDepsData {
    return boostDepsData as BoostDepsData;
}
