/**
 * Cache I/O utilities for boost-clone action.
 *
 * This module handles source cache restore/save operations and provides
 * the batched `git ls-remote` utility used during dependency resolution.
 *
 * Cache key computation is delegated to `cache-key.ts` — this module
 * does not compute keys independently.
 *
 * @module cache
 */

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as trace_commands from 'trace-commands';
import type { Inputs } from './schema';
import type { GitFeatures } from './git-utils';

const HASH_BATCH_SIZE = 20;

/**
 * Retrieves the git commit hash for a repository at a given branch.
 *
 * @param repoUrl - URL of the git repository
 * @param branch - Branch or tag name
 * @param gitFeatures - Git executable information
 * @returns The commit hash string
 * @throws Error if the remote lookup fails
 */
export async function getGitHash(repoUrl: string, branch: string, gitFeatures: GitFeatures): Promise<string> {
    const exec = await import('@actions/exec');
    const { exitCode, stdout } = await exec.getExecOutput(`"${gitFeatures.gitPath}"`, [
        'ls-remote', repoUrl, branch]);
    if (exitCode !== 0) {
        throw new Error(`Failed to get hash for ${repoUrl} at branch ${branch}`);
    }
    return stdout.trim().split('\t')[0];
}

/**
 * Constructs the GitHub repository URL for a Boost module.
 *
 * @param module - Module name (e.g., "algorithm" or "numeric/conversion")
 * @returns The GitHub repository URL
 */
function getModuleRepoUrl(module: string): string {
    return `https://github.com/boostorg/${module.replace('/', '_')}.git`;
}

/**
 * Fetches commit hashes for multiple modules in parallel batches.
 *
 * Calls `git ls-remote` for each module's repository, batching requests
 * in groups of ~20 to balance speed with GitHub API friendliness.
 * On failure (e.g., alias modules whose repo doesn't exist), warns and
 * falls back to an empty string hash.
 *
 * @param modules - Module names to fetch hashes for
 * @param branch - Branch or tag to query
 * @param gitFeatures - Git executable capabilities
 * @param repoUrlOverrides - Optional map of module name to repo URL for non-boostorg repos (e.g. patches)
 * @returns Map of module name to commit hash
 */
export async function fetchModuleHashes(
    modules: Iterable<string>,
    branch: string,
    gitFeatures: GitFeatures,
    repoUrlOverrides?: Map<string, string>
): Promise<Map<string, string>> {
    const fnlog = trace_commands.scoped('fetchModuleHashes');

    const moduleList = [...modules];
    const result = new Map<string, string>();

    if (moduleList.length === 0) {
        return result;
    }

    fnlog(`Fetching hashes for ${moduleList.length} modules in batches of ${HASH_BATCH_SIZE}`);

    for (let i = 0; i < moduleList.length; i += HASH_BATCH_SIZE) {
        const batch = moduleList.slice(i, i + HASH_BATCH_SIZE);
        fnlog(`Batch ${Math.floor(i / HASH_BATCH_SIZE) + 1}: ${batch.join(', ')}`);

        const promises = batch.map(async (mod): Promise<[string, string]> => {
            const repoUrl = repoUrlOverrides?.get(mod) ?? getModuleRepoUrl(mod);
            try {
                const hash = await getGitHash(repoUrl, branch, gitFeatures);
                return [mod, hash];
            } catch (error) {
                core.warning(`Failed to fetch hash for ${mod}: ${error}`);
                return [mod, ''];
            }
        });

        const batchResults = await Promise.all(promises);
        for (const [mod, hash] of batchResults) {
            result.set(mod, hash);
        }
    }

    fnlog(`Fetched ${result.size} hashes`);
    return result;
}

/**
 * Attempts to restore Boost from the GitHub Actions cache.
 *
 * @param inputs - Action inputs containing the boost directory path
 * @param cacheKey - The cache key to look up
 * @returns True if cache was found and restored
 */
export async function getCachedBoost(inputs: Inputs, cacheKey: string): Promise<boolean> {
    core.info(`Checking cache for key: ${cacheKey}`);
    const hit = await cache.restoreCache([inputs.boost_dir], cacheKey, []) !== undefined;
    if (hit) {
        core.info(`Cache hit!`);
    } else {
        core.info(`Cache miss!`);
    }
    return hit;
}

/**
 * Saves the Boost installation to the GitHub Actions cache.
 *
 * @param inputs - Action inputs containing the boost directory path
 * @param cacheKey - The cache key to use for storage
 */
export async function cacheBoost(inputs: Inputs, cacheKey: string): Promise<void> {
    await cache.saveCache([inputs.boost_dir], cacheKey, {});
}
