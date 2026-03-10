/**
 * Cache key computation for boost-clone action.
 *
 * This module is the single authority for all cache key computation.
 * Both the source directory key and the journal key are computed here.
 * No other module computes cache keys independently.
 *
 * ## Source Cache Key
 *
 * A single SHA-1 hash of per-module commit hashes (or synthetic
 * tag-based entries for release tags). The set of modules whose
 * hashes are included depends on the caching mode:
 * - Pessimistic: all modules in the transitive closure
 * - Optimistic: only graph root modules (direct + patches)
 *
 * The super-project `boostHash` **never** appears in the source cache key.
 *
 * ## Journal Cache Key
 *
 * Two-tier lookup: a content-addressed primary key (root names + branch
 * + root commit hashes) for exact matches, and a configuration-based
 * restore prefix (root names + branch) for fallback prefix matching.
 *
 * @module cache-key
 */

import * as crypto from 'crypto';
import * as trace_commands from 'trace-commands';
import type { Inputs } from './schema';

/**
 * Number of hex characters kept from SHA-1 digests in cache keys.
 *
 * 8 hex chars = 32 bits ≈ 4.3 billion values.  Per-repo cache
 * namespaces rarely exceed a few hundred distinct entries, so birthday
 * collision probability is negligible (~0.001% at 10 000 entries).
 */
const HASH_HEX_LENGTH = 8;

// ─── Branded Types ──────────────────────────────────────────────────

declare const ResolvedModuleSetBrand: unique symbol;
declare const SourceCacheKeyBrand: unique symbol;
declare const JournalCacheKeyBrand: unique symbol;

/**
 * Complete transitive closure with per-module commit hashes.
 * Required by `computeSourceCacheKey` — enforces at compile time that
 * a cache key can only be computed from a complete resolution.
 *
 * For release tag fast paths, `hashes` may be empty (release modules are
 * immutable; `computeSourceCacheKey` generates synthetic hash entries
 * from the tag name).
 */
export type ResolvedModuleSet = {
    readonly modules: Set<string>;
    readonly hashes: Map<string, string>;
    readonly [ResolvedModuleSetBrand]: true;
};

/**
 * Branded string identifying the Boost source directory contents.
 * Can only be constructed via `computeSourceCacheKey` from a
 * {@link ResolvedModuleSet}.
 */
export type SourceCacheKey = string & { readonly [SourceCacheKeyBrand]: true };

/**
 * Branded string for the journal cache key.
 * Derived from graph roots + branch.
 */
export type JournalCacheKey = string & { readonly [JournalCacheKeyBrand]: true };

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
    return Array.from(iterable).sort();
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
 * Constructs a branded {@link ResolvedModuleSet} from a complete module
 * set and per-module commit hashes.
 *
 * This is the sole constructor for the branded type. All other code
 * receives the branded type and TypeScript prevents constructing it
 * directly. Enforces at compile time that cache keys can only come from complete resolutions.
 *
 * @param modules - Complete set of modules in the transitive closure
 * @param hashes - Per-module commit hashes (may be empty for release tag fast path)
 * @returns Branded ResolvedModuleSet
 */
export function makeResolvedModuleSet(
    modules: Set<string>,
    hashes: Map<string, string>
): ResolvedModuleSet {
    return { modules, hashes } as unknown as ResolvedModuleSet;
}

/**
 * Computes the source directory cache key from a complete resolution.
 *
 * This is the single point of truth for source cache key derivation.
 * The key is a pure function of the resolved module set — no side
 * effects, no randomness, no dependence on execution path.
 *
 * The caching mode controls which per-module hashes enter the modulesHash:
 * - **Pessimistic** (default): all hashes from the complete resolution.
 * - **Optimistic**: only hashes for graph root modules (direct modules +
 *   patches). Transitive dependency hashes are excluded.
 *
 * For release tags (empty `hashes` map), synthetic entries are generated
 * using the tag name as the hash for each module, since release modules
 * are immutable.
 *
 * @param resolved - Complete resolution with modules and per-module hashes
 * @param inputs - User configuration inputs (uses `branch` and `optimistic_caching`)
 * @param graphRoots - Direct modules ∪ patch names (for optimistic mode hash selection)
 * @returns Branded SourceCacheKey string
 */
export function computeSourceCacheKey(
    resolved: ResolvedModuleSet,
    inputs: Inputs,
    graphRoots: Set<string>
): SourceCacheKey {
    const fnlog = trace_commands.scoped('computeSourceCacheKey');

    const allModulesSorted = toSortedArray(resolved.modules);

    // Select which per-module hashes enter the modulesHash
    let hashEntries: [string, string][];
    if (resolved.hashes.size === 0) {
        // Release tag: modules are immutable, use tag as synthetic hash
        hashEntries = allModulesSorted.map(m => [m, inputs.branch]);
    } else if (inputs.optimistic_caching) {
        // Optimistic: only graph root modules (direct + patches)
        hashEntries = [...resolved.hashes.entries()]
            .filter(([mod]) => graphRoots.has(mod))
            .sort(([a], [b]) => a.localeCompare(b));
    } else {
        // Pessimistic: all modules in the closure
        hashEntries = [...resolved.hashes.entries()]
            .sort(([a], [b]) => a.localeCompare(b));
    }

    const modulesHash = hashObject(hashEntries).substring(0, HASH_HEX_LENGTH);
    fnlog(`Modules hash (${resolved.hashes.size === 0 ? 'release-tag' : inputs.optimistic_caching ? 'optimistic' : 'pessimistic'}, ${hashEntries.length} modules): ${modulesHash}`);

    // The boostHash NEVER appears in this key
    const key = `boost-source-${modulesHash}`;
    fnlog(`Source cache key: ${key}`);

    return key as SourceCacheKey;
}

/**
 * Computes the journal cache key pair.
 *
 * Returns a content-addressed **primary key** and a configuration-based
 * **restore prefix** for the two-tier lookup:
 *
 * 1. **Primary key** — includes a hash of the root modules' current
 *    commit hashes.  An exact match means every root module is at
 *    the same commit as when the journal was saved, so the journal is
 *    guaranteed correct.  Because GitHub Actions cache keys are
 *    immutable, the same module state always maps to the same key,
 *    which is exactly what we want.
 *
 * 2. **Restore prefix** — derived from root *names* + branch only.
 *    When the primary key misses (some root committed new code), a
 *    prefix match finds the most recent journal for the same
 *    configuration.  That journal may contain stale entries, but the
 *    resolution walk detects and re-scans them.
 *
 * @param graphRoots - Root modules for the dependency walk
 * @param branch - Boost branch or tag
 * @param rootHashes - Current commit hashes for the root modules
 * @returns primaryKey for exact match + restorePrefix for fallback
 */
export function computeJournalKey(
    graphRoots: Set<string>,
    branch: string,
    rootHashes: Map<string, string>
): { primaryKey: JournalCacheKey; restorePrefix: string } {
    const sortedRoots = toSortedArray(graphRoots);
    const namesHash = hashObject({ roots: sortedRoots, branch }).substring(0, HASH_HEX_LENGTH);
    const restorePrefix = `boost-journal-${namesHash}`;

    const hashEntries = sortedRoots.map(r => [r, rootHashes.get(r) ?? '']);
    const contentHash = hashObject(hashEntries).substring(0, HASH_HEX_LENGTH);
    const primaryKey = `${restorePrefix}-${contentHash}` as JournalCacheKey;

    return { primaryKey, restorePrefix };
}
