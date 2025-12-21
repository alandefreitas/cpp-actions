/**
 * Module dependency utilities for boost-clone action.
 *
 * @module module-deps
 */

import * as core from '@actions/core';
import { BoostDepsData, Inputs, ModuleEstimation } from './types';

// Import precomputed dependency data
import boostDepsData from '../boost-deps.json';

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
 * Estimates the total number of modules (including transitive dependencies)
 * for a set of requested modules using precomputed data.
 *
 * @param requestedModules - Set of directly requested modules
 * @param releaseTag - Optional specific release tag to use (defaults to latest)
 * @returns Object with estimated total count and the full set of modules
 */
export function estimateTotalModules(requestedModules: Set<string>, releaseTag?: string): ModuleEstimation {
    const depsData = boostDepsData as BoostDepsData;
    const release = releaseTag || getLatestRelease();

    if (!release || !depsData.releases[release]) {
        // No precomputed data available, return just the requested modules
        return {
            totalCount: requestedModules.size,
            allModules: new Set(requestedModules),
            fromPrecomputed: false
        };
    }

    const releaseData = depsData.releases[release];
    const allModules = new Set<string>();

    for (const mod of requestedModules) {
        allModules.add(mod);
        const modData = releaseData.modules[mod];
        if (modData) {
            for (const dep of modData.transitive_deps) {
                allModules.add(dep);
            }
        }
    }

    return {
        totalCount: allModules.size,
        allModules,
        fromPrecomputed: true
    };
}

/**
 * Decides which clone strategy to use based on inputs and context.
 *
 * @param inputs - User inputs including strategy preference
 * @param estimatedModules - Estimated total module count
 * @returns The strategy to use ('git' or 'archive')
 */
export function decideStrategy(inputs: Inputs, estimatedModules: number): 'git' | 'archive' {
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
