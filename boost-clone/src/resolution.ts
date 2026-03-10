/**
 * Dependency resolution for boost-clone action.
 *
 * This module owns the resolution fallback logic. It walks the dependency
 * graph starting from a set of root modules, validating each module's
 * journal entry against its current commit hash.
 *
 * The walk produces a {@link ResolutionResult} whose `frontier` indicates
 * completeness: empty means all modules validated (cache keys can be
 * computed), non-empty means some modules are stale or missing (the
 * pipeline falls back to layer-by-layer discovery).
 *
 * @module resolution
 */

import * as core from '@actions/core';
import * as trace_commands from 'trace-commands';
import type { Journal } from './cached-deps';
import type { GitFeatures } from './git-utils';
import { fetchModuleHashes } from './cache';

// ─── Resolution Result Types ────────────────────────────────────────

/**
 * Result of walking the dependency graph from graph roots.
 *
 * All visited modules and their commit hashes are recorded. Modules
 * whose journal entries were stale or missing go into `frontier`.
 * When `frontier` is empty the resolution is complete — the full
 * transitive closure is known and cache keys can be computed.
 * When `frontier` is non-empty the walk couldn't proceed past those
 * modules, so the pipeline falls back to layer-by-layer discovery.
 */
export interface ResolutionResult {
    /** All visited module names (validated + frontier) */
    modules: Set<string>;
    /** Per-module commit hashes for every visited module */
    hashes: Map<string, string>;
    /** Modules whose dependency data is stale or missing (empty = complete) */
    frontier: Set<string>;
}

/**
 * Whether the resolution covers the full transitive closure.
 *
 * @param result - Resolution result to check
 * @returns True if no modules have stale or missing dependency data
 */
export function isResolutionComplete(result: ResolutionResult): boolean {
    return result.frontier.size === 0;
}

/**
 * Resolves the dependency graph by walking from graph roots and validating
 * each module's journal entry against its current commit hash.
 *
 * For each module encountered:
 * 1. Fetch its current commit hash via `git ls-remote`.
 * 2. Look up the module in the journal.
 * 3. If found and the stored hash matches → follow stored directDeps.
 * 4. If hash doesn't match or module is missing → add to frontier.
 *
 * The walk cannot proceed past frontier modules because their deps are
 * untrusted. The result is Complete when the frontier is empty, Partial
 * otherwise.
 *
 * Hashes are fetched in batches of ~20 per layer to balance speed and
 * API friendliness.
 *
 * @param graphRoots - Entry points for the dependency walk
 * @param journal - Journal from a previous run, or null
 * @param branch - Boost branch or tag
 * @param gitFeatures - Git executable capabilities
 * @param patchUrlMap - Optional map of patch module name to repo URL for non-boostorg repos
 * @param prefetchedHashes - Optional pre-fetched commit hashes to avoid redundant `ls-remote` calls
 * @returns Complete or Partial resolution result
 */
export async function resolveModules(
    graphRoots: Set<string>,
    journal: Journal | null,
    branch: string,
    gitFeatures: GitFeatures,
    patchUrlMap?: Map<string, string>,
    prefetchedHashes?: Map<string, string>
): Promise<ResolutionResult> {
    const fnlog = trace_commands.scoped('resolveModules');

    const visited = new Set<string>();
    const hashes = new Map<string, string>();
    const frontier = new Set<string>();
    let queue = [...graphRoots];

    while (queue.length > 0) {
        // Drain the queue into the current layer
        const layer = queue;
        queue = [];

        // Filter out already-visited modules
        const unvisited = layer.filter(m => !visited.has(m));
        if (unvisited.length === 0) {
            break;
        }

        fnlog(`Processing layer of ${unvisited.length} modules: ${unvisited.join(', ')}`);

        // Split into already-known (prefetched) and unknown modules
        const unknown = unvisited.filter(m => !prefetchedHashes?.has(m));
        const fetchedHashes = unknown.length > 0
            ? await fetchModuleHashes(unknown, branch, gitFeatures, patchUrlMap)
            : new Map<string, string>();

        // Merge prefetched + freshly fetched into layerHashes
        const layerHashes = new Map<string, string>();
        for (const mod of unvisited) {
            const hash = prefetchedHashes?.get(mod) ?? fetchedHashes.get(mod) ?? '';
            layerHashes.set(mod, hash);
        }

        for (const mod of unvisited) {
            visited.add(mod);
            const currentHash = layerHashes.get(mod) ?? '';
            hashes.set(mod, currentHash);

            const entry = journal?.entries[mod];
            if (entry && currentHash !== '' && entry.commitHash === currentHash) {
                // Journal entry is valid — follow its direct deps
                fnlog(`${mod}: journal hit (hash ${currentHash.substring(0, 8)}), ${entry.directDeps.length} deps`);
                for (const dep of entry.directDeps) {
                    if (!visited.has(dep)) {
                        queue.push(dep);
                    }
                }
            } else {
                // Stale or missing — add to frontier
                const reason = entry ? `hash mismatch (journal=${entry.commitHash.substring(0, 8)}, current=${currentHash.substring(0, 8)})` : 'not in journal';
                fnlog(`${mod}: frontier (${reason})`);
                frontier.add(mod);
            }
        }
    }

    const validated = visited.size - frontier.size;
    core.info(`Resolution: ${validated} validated, ${frontier.size} frontier`);
    return { modules: visited, hashes, frontier };
}
