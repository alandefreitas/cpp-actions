/**
 * Caching utilities for boost-clone action.
 *
 * @module cache
 */

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as crypto from 'crypto';
import * as trace_commands from 'trace-commands';
import { Inputs, GitFeatures, CacheKeyResult, GenerateCacheKeyOptions } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git';

/**
 * Converts an iterable to a sorted array of strings.
 *
 * @param iterable - The iterable to convert, or null/undefined
 * @returns Sorted array of strings, or empty array if input is null/undefined
 */
export function toSortedArray(iterable: Iterable<string> | null | undefined): string[] {
    if (!iterable) {
        return [];
    }
    return Array.from(iterable).map((value) => value).sort();
}

/**
 * Creates a SHA-1 hash of a JSON-serialized value.
 *
 * @param value - The value to hash
 * @returns Hexadecimal hash string
 */
export function hashObject(value: unknown): string {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

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
export function getModuleRepoUrl(module: string): string {
    return `https://github.com/boostorg/${module.replace('/', '_')}.git`;
}

/**
 * Generates a unique cache key for the Boost installation based on configuration.
 *
 * Computes hashes from module versions, patches, and configuration settings to
 * create a deterministic cache key for GitHub Actions caching.
 *
 * @param inputs - Boost clone inputs including branch, modules, and patches
 * @param allModules - Complete set of modules to include (direct and transitive dependencies)
 * @param gitFeatures - Git capabilities detected on the system
 * @param options - Cache key generation options (logging, fragments)
 * @returns Cache key string or object with key and fragments
 */
export async function generateCacheKey(inputs: Inputs, allModules: Set<string>, gitFeatures: GitFeatures, options: GenerateCacheKeyOptions = {}): Promise<string | CacheKeyResult> {
    function fnlog(msg: string): void {
        trace_commands.log(`generateCacheKey: ${msg}`);
    }

    const allModulesSorted = toSortedArray(allModules);
    const patchesSorted = toSortedArray(inputs.patches);

    const boostHash = await getGitHash(boostSuperProjectRepo, inputs.branch, gitFeatures);
    fnlog(`Boost hash at ${inputs.branch}: ${boostHash}`);

    const moduleHashes: Record<string, string> = {};
    if (inputs.optimistic_caching) {
        // Optimistic caching: only modules and patches define the key
        // Pessimistic caching: we'll clone all modules, so we only need the
        // hash of the super-project
        for (const module of allModulesSorted) {
            const moduleRepoUrl = getModuleRepoUrl(module);
            const moduleRepoExists = await setup_program.urlExists(moduleRepoUrl);
            if (moduleRepoExists) {
                const moduleHash = await getGitHash(moduleRepoUrl, inputs.branch, gitFeatures);
                fnlog(`Hash for module ${module}: ${moduleHash}`);
                moduleHashes[module] = moduleHash;
            } else {
                moduleHashes[module] = boostHash;
            }
        }
    }

    const patchHashes: Record<string, string> = {};
    for (const patch of patchesSorted) {
        const patchHash = await getGitHash(patch, inputs.branch, gitFeatures);
        fnlog(`Hash for patch ${patch}: ${patchHash}`);
        patchHashes[patch] = patchHash;
    }

    const concatenatedHashes = Object.values(moduleHashes).join('') + Object.values(patchHashes).join('');
    const modulesAndPatchesHash = crypto.createHash('sha1').update(concatenatedHashes).digest('hex');
    fnlog(`Modules hash (direct dependencies and patches): ${modulesAndPatchesHash}`);

    const configHash = hashObject({
        branch: inputs.branch,
        modules: allModulesSorted,
        modules_scan_paths: toSortedArray(inputs.modules_scan_paths),
        modules_exclude_paths: toSortedArray(inputs.modules_exclude_paths),
        scan_modules_dir: toSortedArray(inputs.scan_modules_dir),
        scan_modules_ignore: toSortedArray(inputs.scan_modules_ignore),
        optimistic_caching: inputs.optimistic_caching
    });
    fnlog(`Configuration hash: ${configHash}`);

    // The cache key is composed of distinct SHA-1 fragments:
    // - boostHash: captures changes in the Boost super-project.
    // - modulesAndPatchesHash: captures hashes of explicitly requested modules and patches.
    // - configHash: captures every configuration knob that influences scanning behavior.
    // Each fragment encodes disjoint information so that changes in any dimension invalidate the key.
    const cacheKey =
        // No modules or patches specified, we'll clone all modules
        allModulesSorted.length === 0 && patchesSorted.length === 0 ?
            `boost-source-${boostHash}-${configHash}` :
            inputs.optimistic_caching ?
                // Optimistic caching: only modules and patches define the key
                `boost-source-${modulesAndPatchesHash}-${configHash}` :
                // Pessimistic caching with no patches: we'll clone all modules
                patchesSorted.length === 0 ?
                    `boost-source-${boostHash}-${configHash}` :
                    // Pessimistic caching with patches: invalidate cache
                    // when any module or patch changes
                    `boost-source-${boostHash}-${modulesAndPatchesHash}-${configHash}`;
    fnlog(`Cache key: ${cacheKey}`);

    if (options.logInfo) {
        core.info(`Caching mode: ${inputs.optimistic_caching ? 'optimistic' : 'pessimistic'}`);
        core.info(`Cache key fragments -> boost: ${boostHash}, modules+patches: ${modulesAndPatchesHash}, config: ${configHash}`);
        core.info(`Cache key: ${cacheKey}`);
    }

    const result: CacheKeyResult = { cacheKey, fragments: { boostHash, modulesAndPatchesHash, configHash } };
    return options.withFragments ? result : cacheKey;
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
        core.info(`Cache hit! 🙂`);
    } else {
        core.info(`Cache miss! 😔`);
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
