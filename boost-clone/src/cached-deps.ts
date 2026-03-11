/**
 * Journal I/O for boost-clone action.
 *
 * This module manages the accumulative journal stored in GitHub Actions cache.
 * The journal records per-module dependency data (`module → { commitHash,
 * direct_deps[] }`) discovered during previous runs. On subsequent runs, the
 * journal enables the resolution walk to validate modules without re-cloning.
 *
 * The journal key uses `restore-keys` prefix matching so that the most recent
 * journal for the same configuration (graph roots + branch) is found even when
 * the run-unique suffix differs.
 *
 * @module cached-deps
 */

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

/**
 * Per-module dependency data entry.
 * Shared format between precomputed data (boost-deps.json) and the journal.
 * Records only direct dependencies — the transitive closure is computed
 * by walking the graph at resolution time.
 */
export interface JournalEntry {
    /** Commit hash of the module at the time deps were recorded */
    commitHash: string;
    /** Direct dependencies only (NOT the transitive closure) */
    direct_deps: string[];
}

/**
 * Journal: accumulative map of module dependency data.
 * Persisted in GitHub Actions cache between runs. Entries from prior
 * runs persist; stale entries are replaced; entries for modules no
 * longer in the closure are pruned.
 */
export interface Journal {
    /** Per-module dependency entries */
    entries: Record<string, JournalEntry>;
}

const JOURNAL_FILENAME = 'journal.json';

/**
 * Returns a deterministic directory path for journal cache operations.
 *
 * `@actions/cache` includes a hash of the `paths` array in its cache
 * lookup (the "archive version"). Both {@link saveJournal} and
 * {@link restoreJournal} must use the same path so the version matches;
 * using `mkdtemp` would produce random names and a permanent cache miss.
 *
 * The restore prefix is embedded in the path so that multiple
 * boost-clone steps in the same job (with different branches or
 * modules) use distinct directories and never collide, while all
 * keys that share a prefix (i.e. same roots + branch) map to the
 * same directory — required for prefix-based fallback restores.
 *
 * @param restorePrefix - Stable prefix portion of the journal key
 *                        (e.g. `boost-journal-0949897a`)
 * @returns Absolute path to the journal cache directory
 */
function journalCacheDir(restorePrefix: string): string {
    return path.join(os.tmpdir(), restorePrefix);
}

/**
 * Restores the journal from GitHub Actions cache.
 *
 * Uses a two-tier lookup: the primary key is content-addressed (includes
 * root commit hashes) so an exact hit guarantees the journal is current.
 * On miss, the restore prefix (root names + branch) finds the most
 * recent journal for the same configuration as a fallback.
 *
 * @param primaryKey - Content-addressed key for exact match
 * @param restorePrefix - Configuration-based prefix for fallback
 * @returns Parsed journal on cache hit, or null on miss
 */
export async function restoreJournal(primaryKey: string, restorePrefix: string): Promise<Journal | null> {
    const fnlog = traceCommands.scoped('restoreJournal');

    const cacheDir = journalCacheDir(restorePrefix);
    const journalFile = path.join(cacheDir, JOURNAL_FILENAME);

    try {
        await fs.mkdir(cacheDir, { recursive: true });

        fnlog(`Attempting to restore journal (primary: ${primaryKey}, prefix: ${restorePrefix})`);
        const hit = await cache.restoreCache(
            [cacheDir],
            primaryKey,
            [restorePrefix]
        );
        if (hit === undefined) {
            fnlog('Journal cache miss');
            return null;
        }

        fnlog(`Journal cache hit: ${hit}`);
        try {
            await fs.access(journalFile);
        } catch {
            fnlog('Cache hit but journal.json not found in restored directory');
            return null;
        }

        const raw = await fs.readFile(journalFile, 'utf-8');
        const data = JSON.parse(raw) as Journal;
        if (!data.entries || typeof data.entries !== 'object') {
            fnlog('Journal has no valid entries object');
            return null;
        }
        // Prune entries with missing or invalid direct_deps
        for (const [mod, entry] of Object.entries(data.entries)) {
            if (!entry || typeof entry.commitHash !== 'string' || !Array.isArray(entry.direct_deps)) {
                delete data.entries[mod];
            }
        }
        const entryCount = Object.keys(data.entries).length;
        fnlog(`Restored journal with ${entryCount} entries`);
        return data;
    } catch (error) {
        core.warning(`Failed to restore journal: ${error}`);
        return null;
    } finally {
        try {
            await fs.rm(cacheDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Saves the journal to GitHub Actions cache.
 *
 * Writes the journal as JSON to a temporary directory and saves it under
 * the given cache key. GitHub Actions cache keys are immutable, so only
 * the first save per key succeeds; `ReserveCacheError` on subsequent
 * runs is expected and handled gracefully.
 *
 * @param key - Journal cache key
 * @param restorePrefix - Stable prefix for directory path (must match restore)
 * @param journal - The journal data to cache
 */
export async function saveJournal(key: string, restorePrefix: string, journal: Journal): Promise<void> {
    const fnlog = traceCommands.scoped('saveJournal');

    const cacheDir = journalCacheDir(restorePrefix);
    const journalFile = path.join(cacheDir, JOURNAL_FILENAME);

    try {
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(journalFile, JSON.stringify(journal, null, 2));
        const entryCount = Object.keys(journal.entries).length;
        fnlog(`Saving journal (${entryCount} entries) to cache key: ${key}`);
        await cache.saveCache([cacheDir], key, {});
        fnlog('Journal saved successfully');
    } catch (error) {
        if (error instanceof Error && error.name === 'ReserveCacheError') {
            fnlog(`Journal cache key already exists (immutable): ${key}`);
        } else {
            core.warning(`Failed to save journal: ${key}: ${error}`);
        }
    } finally {
        try {
            await fs.rm(cacheDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Updates the journal with newly discovered entries and prunes stale ones.
 *
 * Merges existing entries with new entries (new/updated overwrite old),
 * then prunes keys not in the current module closure. This ensures the
 * journal stays compact and only contains relevant data.
 *
 * @param existing - The previously restored journal, or null
 * @param newEntries - Newly discovered/validated journal entries
 * @param allModules - The complete module set from the current resolution
 * @returns Updated journal ready for saving
 */
export function updateJournal(
    existing: Journal | null,
    newEntries: Map<string, JournalEntry>,
    allModules: Set<string>
): Journal {
    const fnlog = traceCommands.scoped('updateJournal');

    const merged: Record<string, JournalEntry> = {};

    // Start with existing entries
    if (existing) {
        for (const [mod, entry] of Object.entries(existing.entries)) {
            merged[mod] = entry;
        }
    }

    // Overwrite with new entries
    for (const [mod, entry] of newEntries) {
        merged[mod] = entry;
    }

    // Prune modules not in the current closure
    const pruned: Record<string, JournalEntry> = {};
    let prunedCount = 0;
    for (const mod of Object.keys(merged)) {
        if (allModules.has(mod)) {
            pruned[mod] = merged[mod];
        } else {
            prunedCount++;
        }
    }
    if (prunedCount > 0) {
        fnlog(`Pruned ${prunedCount} stale entries from journal`);
    }

    fnlog(`Updated journal: ${Object.keys(pruned).length} entries`);
    return { entries: pruned };
}
