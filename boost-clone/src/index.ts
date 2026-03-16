/**
 * Main entry point for boost-clone action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import { ExpectedError } from 'pretty-errors';

// Type imports
import type { Inputs, CloneStrategy } from './schema';
import type { GitFeatures } from './git-utils';
import type { ResolutionResult } from './resolution';
import type { SourceCacheKey } from './cache-key';
import type { Journal, JournalEntry } from './cached-deps';
import type { DiscoveryResult } from './submodules';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';

// Module imports
import { computeSourceCacheKey, computeJournalKey, makeResolvedModuleSet } from './cache-key';
import { getCachedBoost, cacheBoost, fetchModuleHashes } from './cache';
import { isReleaseTag, estimateTotalModules, decideStrategy, getBoostDepsData, getTransitiveClosure, getLatestRelease } from './module-deps';
import { initializeSubmodules, initializeAllSubmodules } from './submodules';
import { fetchBoostMetadata, scanBoostDependencies, listBoostDependencies } from './header-scan';
import { getArchiveUrl, downloadAndExtractArchive } from './archive';
import { findGitFeatures, cloneBoostSuperproject, applyPatches, getRepoName, cloneRepo } from './git-utils';
import { resolveModules, isResolutionComplete } from './resolution';
import { restoreJournal, saveJournal, updateJournal } from './cached-deps';

/**
 * Output values from the boost-clone action.
 */
export interface Outputs {
    /** Absolute path to the Boost source directory */
    boostDir: string;
}

// Re-export for external consumers
export { inputsSchema, outputsSchema } from './schema';
export { computeSourceCacheKey, makeResolvedModuleSet } from './cache-key';
export type { Inputs, CloneStrategy } from './schema';

// ─── Boost Cloner ───────────────────────────────────────────────────

/**
 * Orchestrates the Boost cloning pipeline: identifying required
 * modules, resolving dependencies, cloning the super-project, and
 * caching results.
 *
 * Shared state (git features, module sets, journal, cache availability)
 * is stored as instance fields so that pipeline methods can access it
 * directly without parameter threading.
 */
class BoostCloner {
    /**
     * Resolved action configuration.
     * Contains branch, modules, patches, scan dirs, cache settings, and clone strategy.
     */
    private readonly inputs: Inputs;

    /**
     * Output values returned to the action runner.
     * Currently only `boostDir` — the absolute path to the cloned Boost source.
     */
    private readonly outputs: Outputs;

    // ==== Detected capabilities (set in run() before any method call)

    /**
     * Git executable path, version, and feature flags.
     * Includes `gitPath`, parsed `version`, and booleans for `--jobs`, `--depth`,
     * and fsmonitor support.
     */
    private gitFeatures!: GitFeatures;

    /** Whether the GitHub cache service is available and enabled */
    private useCache!: boolean;

    // ==== Lazily-downloaded Boost metadata (.gitmodules, exceptions.txt)

    /**
     * Valid submodule paths from .gitmodules.
     * Set of strings like `libs/config`, `libs/url`, `tools/build`.
     */
    private submodulePaths: Set<string> | undefined;

    /**
     * Header-to-module exception map from exceptions.txt.
     * Maps header include paths (e.g. `boost/numeric/ublas.hpp`) to their
     * owning module name (e.g. `numeric/ublas`) for headers that can't be
     * resolved by the standard regex-based heuristics.
     */
    private exceptions: Record<string, string> | undefined;

    // ==== Pipeline state (set progressively as phases complete)

    /**
     * Direct modules ∪ patch names — fixed entry points for resolution,
     * caching, and initialization.
     * Set of module names like `config`, `url`, `buffers`.
     */
    private graphRoots!: Set<string>;

    /**
     * Cached per-module dependency data from previous runs.
     * Maps module name → `{ commitHash, direct_deps[] }` for both regular
     * Boost modules and patch modules. Entries persist across runs; stale
     * entries are replaced on the next journal save.
     */
    private journal: Journal | null = null;

    /**
     * Result of walking the dependency graph from `graphRoots` using the
     * journal. Each module's journal entry is validated against its current
     * commit hash (fetched via `git ls-remote`); valid entries contribute
     * their `direct_deps` to the walk.
     *
     * `undefined` means resolution wasn't attempted (no cache, no journal,
     * or no modules requested).
     *
     * Complete (empty frontier) means every reachable module had a valid
     * journal entry, so the full transitive closure and all commit hashes
     * are known. This enables batch submodule init and source cache key
     * computation.
     *
     * Partial (non-empty frontier) means some modules had stale or missing
     * journal entries, so their dependencies are unknown. This is not a
     * failure — it just means the fast paths (batch init, cache lookup)
     * are unavailable. The pipeline falls back to layer-by-layer header
     * scanning, which always produces a correct result. The partial
     * result's `hashes` are still reused so those modules don't need
     * re-hashing later.
     */
    private resolutionResult: ResolutionResult | undefined;

    /**
     * Journal cache key pair computed from graph roots + root commit hashes.
     * Set during `restoreJournal()` and reused by `persistJournal()`.
     */
    private journalKey: { primaryKey: string; restorePrefix: string } | undefined;

    /**
     * Cache key for the Boost source directory.
     * Format: `boost-source-{modulesHash}`, where modulesHash is a truncated
     * hash of per-module commit hashes (pessimistic: all modules, optimistic:
     * roots only). For release tags, the tag name is used as a synthetic
     * hash since release modules are immutable.
     */
    private sourceKey: SourceCacheKey | undefined;

    /**
     * Layer-by-layer discovery result when batch init is not possible.
     * Contains `initialized` (set of all module names) and `discoveredDeps`
     * (map of module name → direct dependency names found by header scanning).
     */
    private discoveryResult: DiscoveryResult | undefined;

    /**
     * Pre-fetched commit hashes for graph root modules.
     *
     * Populated during {@link restoreJournal} (where hashes are needed for
     * the journal cache key) and reused by {@link discoverPatchDependencies}
     * and {@link resolveDependencyGraph} to avoid redundant `ls-remote` calls.
     */
    private rootHashes = new Map<string, string>();

    /**
     * Temporary directories holding pre-scanned patch clones.
     *
     * Populated during {@link discoverPatchDependencies} and consumed by
     * {@link applyPatches} (via `executeGitStrategy` or the archive path)
     * to avoid cloning each patch twice. Remaining entries are cleaned up
     * at the end of the pipeline.
     */
    private readonly patchCloneDirs = new Map<string, string>();

    /**
     * @param inputs - Configuration inputs from the action
     */
    constructor(inputs: Inputs) {
        this.inputs = { ...inputs };
        // Compute boostDir default if not provided (depends on branch)
        if (!this.inputs.boostDir) {
            this.inputs.boostDir = path.join(os.tmpdir(), `boost-${this.inputs.branch}`);
        }
        this.inputs.boostDir = path.resolve(this.inputs.boostDir);
        this.outputs = { boostDir: this.inputs.boostDir };
    }

    /**
     * Runs the full Boost installation pipeline.
     *
     * The flow is:
     * 1. Detect git features and identify direct modules
     * 2. Restore journal and pre-scan patch dependencies
     * 3. Estimate modules and select clone strategy
     * 4. Resolve dependency graph
     * 5. Check source cache (early return on hit)
     * 6. Clone super-project and initialize submodules
     * 7. Save journal and source cache
     *
     * @returns Outputs including the Boost directory path
     */
    async run(): Promise<Outputs> {
        await fsp.mkdir(this.inputs.boostDir, { recursive: true });

        core.startGroup('📐 Identify git features and modules');
        core.info(`Cache path: ${this.inputs.boostDir}`);
        core.info(`Cache enabled: ${this.inputs.cache}`);
        core.info(`Optimistic caching: ${this.inputs.optimisticCaching}`);
        core.info(`Clone strategy: ${this.inputs.cloneStrategy}`);
        core.info(`Archive threshold: ${this.inputs.archiveThreshold}`);

        this.gitFeatures = await findGitFeatures(this.inputs);
        await this.identifyDirectModules();

        this.useCache = this.inputs.cache && cache.isFeatureAvailable();
        if (this.inputs.cache && !this.useCache) {
            core.info('GitHub cache service unavailable; continuing without cache');
        }
        core.endGroup();

        await this.restoreJournal();
        await this.prescanPatches();
        const strategy = this.estimateAndSelectStrategy();
        await this.resolveDependencyGraph();

        // ── Check source cache (complete resolution only) ──────────
        core.startGroup('💾 Restore Boost source');
        if (this.resolutionResult && isResolutionComplete(this.resolutionResult) && this.useCache) {
            const resolved = makeResolvedModuleSet(
                this.resolutionResult.modules,
                this.resolutionResult.hashes
            );
            this.sourceKey = computeSourceCacheKey(resolved, this.inputs, this.graphRoots);
            core.info(`Caching mode: ${this.inputs.optimisticCaching ? 'optimistic' : 'pessimistic'}`);
            core.info(`Source cache key: ${this.sourceKey}`);
            const cacheHit = await getCachedBoost(this.inputs, this.sourceKey);
            if (cacheHit) {
                core.info('Cache hit: skipping clone and submodule init');
                core.endGroup();
                await this.cleanupPatchCloneDirs();
                return this.outputs;
            }
        } else if (!this.useCache && !this.inputs.cache) {
            core.info('Caching disabled; skipping');
        } else if (!this.resolutionResult && this.useCache) {
            core.info('Resolution not attempted; skipping');
        } else if (this.resolutionResult && !isResolutionComplete(this.resolutionResult)) {
            core.info(`Partial resolution (${this.resolutionResult.frontier.size} frontier modules); skipping`);
        }
        core.endGroup();

        // ── Clone and initialize ───────────────────────────────────
        if (strategy === 'archive') {
            core.startGroup('📦 Download Boost Archive');
            await this.ensureBoostMetadata();
            const archiveUrl = getArchiveUrl(this.inputs.branch);
            try {
                await downloadAndExtractArchive(archiveUrl, this.inputs.boostDir);
            } catch (error) {
                core.warning(`Archive download failed: ${error}. Falling back to git strategy.`);
                await this.executeGitStrategy();
            }
            core.endGroup();

            if (this.inputs.patches.size > 0) {
                core.startGroup('🔨 Apply Boost Patches');
                await applyPatches(this.inputs, this.patchCloneDirs);
                core.endGroup();
            }
        } else {
            await this.executeGitStrategy();
        }

        const allHashes = await this.updateAndSaveJournal();
        await this.saveSourceCache(allHashes);
        await this.cleanupPatchCloneDirs();
        return this.outputs;
    }

    /**
     * Downloads `.gitmodules` and `exceptions.txt` from the Boost
     * super-project if not already available. Idempotent — subsequent
     * calls are no-ops.
     */
    private async ensureBoostMetadata(): Promise<void> {
        if (this.submodulePaths) {
            return;
        }

        core.info('Downloading .gitmodules and exceptions.txt');
        const metadata = await fetchBoostMetadata(this.inputs.branch);
        this.submodulePaths = metadata.submodulePaths;
        this.exceptions = metadata.exceptions;
    }

    /** Patch name → git URL mapping, derived from inputs.patches */
    private get patchUrlMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const patch of this.inputs.patches) {
            map.set(getRepoName(patch), patch);
        }
        return map;
    }

    /** Patch module names derived from inputs.patches */
    private get patchNames(): Set<string> {
        return new Set([...this.inputs.patches].map(getRepoName));
    }

    /**
     * Identifies the directly-requested Boost modules by merging explicit
     * module names with modules discovered by scanning user source
     * directories for `#include <boost/...>` headers.
     *
     * Sets: `graphRoots`, `patchUrlMap`, and optionally
     * `submodulePaths`/`exceptions` (when scan dirs require metadata
     * download).
     */
    private async identifyDirectModules(): Promise<void> {
        const modules = new Set(this.inputs.modules);

        if (this.inputs.scanModulesDir.size > 0) {
            await this.ensureBoostMetadata();

            const scanResults = await Promise.all([...this.inputs.scanModulesDir].map(scanDir =>
                scanBoostDependencies(scanDir, this.inputs, this.exceptions!, this.submodulePaths!)
            ));
            for (const scannedModules of scanResults) {
                for (const module of scannedModules) {
                    modules.add(module);
                }
            }
        }

        this.graphRoots = new Set([...modules, ...this.patchNames]);
    }

    /**
     * Restores the dependency journal from cache.
     *
     * Sets: `journal`.
     */
    private async restoreJournal(): Promise<void> {
        if (!this.useCache) {
            return;
        }

        core.startGroup('📓 Restore journal');
        this.rootHashes = await fetchModuleHashes(
            this.graphRoots, this.inputs.branch, this.gitFeatures, this.patchUrlMap
        );
        this.journalKey = computeJournalKey(this.graphRoots, this.inputs.branch, this.rootHashes);
        core.info(`Journal cache key: ${this.journalKey.primaryKey}`);
        this.journal = await restoreJournal(this.journalKey.primaryKey, this.journalKey.restorePrefix);
        if (this.journal) {
            core.info(`Journal restored: ${Object.keys(this.journal.entries).length} entries`);
        } else {
            core.info('No journal found (first run)');
        }
        core.endGroup();
    }

    /**
     * Pre-scans patch module headers so their transitive deps are available
     * for strategy selection and graph resolution.
     *
     * Each patch is cloned to a temp directory for scanning. The temp
     * directories are kept in {@link patchCloneDirs} so that
     * {@link applyPatches} can move them into place instead of re-cloning.
     *
     * Sets: `journal` entries for each patch, `patchCloneDirs`.
     */
    private async prescanPatches(): Promise<void> {
        if (this.inputs.patches.size === 0 || !this.useCache) {
            return;
        }

        if (!this.journal) {
            this.journal = { entries: {} };
        }

        core.startGroup('🩹 Pre-scan Patch Dependencies');
        await this.ensureBoostMetadata();
        await this.discoverPatchDependencies();
        core.info(`Journal after patch pre-scan: ${Object.keys(this.journal.entries).length} entries`);
        core.endGroup();
    }

    /**
     * Discovers Boost dependencies for patch modules whose journal entries
     * are absent or stale.
     *
     * For each patch, fetches its current commit hash and compares it to
     * the journal entry. If the entry is valid, the patch is skipped.
     * Otherwise the patch is cloned to a temp directory, scanned for
     * Boost header dependencies, and a journal entry is created. The temp
     * directory is kept in {@link patchCloneDirs} for later reuse by
     * {@link applyPatches}. Per-patch errors are caught and warned, not
     * fatal.
     */
    private async discoverPatchDependencies(): Promise<void> {
        const fnlog = traceCommands.scoped('discoverPatchDependencies');

        const results = await Promise.all([...this.inputs.patches].map(async (patchUrl) => {
            const patchName = getRepoName(patchUrl);

            // Reuse the commit hash already fetched during restoreJournal
            const currentHash = this.rootHashes.get(patchName) ?? '';
            if (!currentHash) {
                core.warning(`No hash available for patch ${patchName}; skipping dependency scan`);
                return null;
            }

            // Skip patches whose journal entry is still valid
            const entry = this.journal!.entries[patchName];
            if (entry && entry.commitHash === currentHash) {
                fnlog(`${patchName}: journal entry valid (hash ${currentHash.substring(0, 8)}), skipping`);
                return null;
            }
            if (entry) {
                fnlog(`${patchName}: journal entry stale (journal=${entry.commitHash.substring(0, 8)}, current=${currentHash.substring(0, 8)}), re-scanning`);
            }

            const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `boost-patch-${patchName}-`));
            try {
                fnlog(`${patchName}: cloning ${patchUrl} to temp dir`);
                await cloneRepo(patchUrl, tmpDir, this.inputs.branch);

                // Scan library headers only (exclude test/example dirs for lightweight discovery)
                const scanDirs = ['include', 'src', 'source'];
                const deps = await listBoostDependencies(
                    tmpDir, scanDirs, this.exceptions!, this.submodulePaths!
                );
                fnlog(`${patchName}: discovered ${deps.size} deps: ${[...deps].join(', ')}`);
                fnlog(`${patchName}: commit hash ${currentHash.substring(0, 8)}`);

                return { patchName, currentHash, deps, tmpDir };
            } catch (error) {
                core.warning(`Failed to pre-scan patch ${patchName}: ${error}`);
                await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
                return null;
            }
        }));

        // Apply results sequentially
        for (const result of results) {
            if (!result) continue;
            this.journal!.entries[result.patchName] = {
                commitHash: result.currentHash,
                direct_deps: [...result.deps]
            };
            this.patchCloneDirs.set(result.patchName, result.tmpDir);
        }
    }

    /**
     * Removes any remaining pre-scanned patch temp directories.
     *
     * Called after patches have been applied (dirs moved into place) or on
     * cache hit (dirs not needed). Idempotent.
     */
    private async cleanupPatchCloneDirs(): Promise<void> {
        for (const [, dir] of this.patchCloneDirs) {
            await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        this.patchCloneDirs.clear();
    }

    /**
     * Estimates the total module count (including transitive dependencies)
     * and selects the optimal clone strategy (git vs archive) based on the
     * estimated size and user configuration.
     *
     * @returns Selected clone strategy
     */
    private estimateAndSelectStrategy(): CloneStrategy {
        core.startGroup('📊 Estimate Total Modules');
        const releaseForEstimate = isReleaseTag(this.inputs.branch) ? this.inputs.branch : getLatestRelease();
        const estimationRoots = new Set(this.graphRoots);
        for (const name of this.patchNames) {
            estimationRoots.add(name);
            const entry = this.journal?.entries[name];
            if (entry) {
                for (const dep of entry.direct_deps) {
                    estimationRoots.add(dep);
                }
            }
        }
        const estimation = estimateTotalModules(estimationRoots, releaseForEstimate);
        core.info(`Graph roots (direct + patches): ${this.graphRoots.size}`);
        core.info(`Patch modules: ${this.patchUrlMap.size}`);
        core.info(`Estimated total modules (with transitive deps): ${estimation.totalCount}`);
        core.info(`Estimation from precomputed data: ${estimation.fromPrecomputed}`);
        core.endGroup();

        core.startGroup('🎯 Select Clone Strategy');
        const strategy = decideStrategy(this.inputs, estimation.totalCount);
        core.info(`Selected strategy: ${strategy}`);
        core.endGroup();

        return strategy;
    }

    /**
     * Resolves the full dependency graph using the best available strategy:
     * trivial (no modules), precomputed data for known release tags, or
     * journal-based graph walk with per-module hash validation.
     *
     * Sets: `resolutionResult`.
     */
    private async resolveDependencyGraph(): Promise<void> {
        const fnlog = traceCommands.scoped('resolveDependencyGraph');

        if (this.graphRoots.size === 0) {
            fnlog('No modules or patches requested; trivially complete resolution');
            this.resolutionResult = { modules: new Set(), hashes: new Map(), frontier: new Set() };
            return;
        }

        // Try precomputed fast path for exact release tags without patches
        const isExactRelease = isReleaseTag(this.inputs.branch);
        const depsData = getBoostDepsData();
        const hasPatches = this.inputs.patches.size > 0;
        const precomputedAvailable = isExactRelease && this.inputs.branch in depsData.releases && !hasPatches;

        if (precomputedAvailable) {
            core.startGroup('📋 Precomputed dependencies');
            const closure = getTransitiveClosure(this.graphRoots, this.inputs.branch);
            if (closure) {
                fnlog(`Precomputed fast path: ${closure.size} modules from boost-deps.json`);
                core.info(`Precomputed hit: ${closure.size} modules from boost-deps.json`);
                this.resolutionResult = { modules: closure, hashes: new Map(), frontier: new Set() };
            }
            core.endGroup();
        }

        // If precomputed data didn't resolve, try journal-based resolution + per-module hash validation
        if (!this.resolutionResult && this.useCache && this.journal) {
            core.startGroup('🔗 Journal-based resolution');
            core.info(`Journal entries for resolution: ${Object.keys(this.journal.entries).length}`);
            this.resolutionResult = await resolveModules(
                this.graphRoots, this.journal, this.inputs.branch,
                this.gitFeatures, this.patchUrlMap, this.rootHashes
            );
            core.endGroup();
        }
    }

    /**
     * Executes the git clone strategy: clones the super-project, applies
     * patches, and initializes submodules using the best available method
     * (all, batch, or layer-by-layer discovery).
     *
     * Sets: `discoveryResult` when layer-by-layer discovery is used.
     */
    private async executeGitStrategy(): Promise<void> {
        core.startGroup('🚀 Clone Boost Super-project');
        await this.ensureBoostMetadata();
        await cloneBoostSuperproject(this.inputs);
        core.endGroup();

        if (this.inputs.patches.size > 0) {
            core.startGroup('🔨 Apply Boost Patches');
            await applyPatches(this.inputs, this.patchCloneDirs);
            core.endGroup();
        }

        // Extend submodulePaths with patch names
        const allValidPaths = new Set(this.submodulePaths!);
        for (const name of this.patchNames) {
            allValidPaths.add(`libs/${name}`);
        }

        if (this.graphRoots.size === 0) {
            core.startGroup('🔧 Initialize All Boost Submodules');
            await initializeAllSubmodules(this.inputs, this.gitFeatures);
            core.endGroup();
        } else {
            core.startGroup('🔧 Initialize Boost Submodules');

            // Seed with resolution results when available:
            // - initModules: all modules visited during resolution (not just roots)
            // - preScannedDeps: journal deps for validated modules (skip re-scanning)
            // When resolution is complete, preScannedDeps covers everything and
            // the scan loop exits immediately. Partial resolution seeds what it
            // can and the scan loop discovers the rest.
            // When resolution wasn't attempted (cache disabled or no journal),
            // we start from graphRoots with no pre-scanned data — pure
            // layer-by-layer discovery.
            const initModules = this.resolutionResult?.modules ?? this.graphRoots;
            const preScannedDeps = new Map<string, string[]>();
            if (this.resolutionResult) {
                for (const mod of this.resolutionResult.modules) {
                    if (this.resolutionResult.frontier.has(mod)) continue;
                    const entry = this.journal?.entries[mod];
                    if (entry) {
                        preScannedDeps.set(mod, entry.direct_deps);
                    }
                }
                core.info(`Initializing ${initModules.size} modules (${preScannedDeps.size} pre-scanned, ${this.resolutionResult.frontier.size} frontier)`);
            } else {
                core.info(`No resolution available (cache disabled or first run); discovering all dependencies from scratch`);
            }

            this.discoveryResult = await initializeSubmodules(
                this.inputs, initModules, this.gitFeatures,
                this.exceptions!, allValidPaths, this.patchNames,
                preScannedDeps
            );
            core.endGroup();
        }
    }

    /**
     * Fetches any missing commit hashes, populates the journal with
     * discovered dependency data, and saves it to the GitHub Actions cache.
     *
     * Modules already hashed during resolution are reused; only modules
     * discovered during layer-by-layer scanning need fresh `ls-remote`
     * calls. The resulting hash map is returned for use by
     * {@link saveSourceCache}.
     *
     * @returns Per-module commit hashes for all initialized modules
     */
    private async updateAndSaveJournal(): Promise<Map<string, string>> {
        if (!this.useCache || !this.discoveryResult) {
            return new Map<string, string>();
        }

        core.startGroup('📓 Save journal');

        // Fetch hashes for modules discovered after resolution
        const existingHashes = this.resolutionResult?.hashes ?? new Map<string, string>();
        const allModules = this.discoveryResult.initialized;
        const unhashed = [...allModules].filter(m => !existingHashes.has(m));
        let allHashes = new Map(existingHashes);

        if (unhashed.length > 0) {
            core.info(`Fetching hashes for ${unhashed.length} newly discovered modules`);
            const newHashes = await fetchModuleHashes(
                unhashed, this.inputs.branch, this.gitFeatures, this.patchUrlMap
            );
            allHashes = new Map([...allHashes, ...newHashes]);
        }

        // Build journal entries from discovered deps + hashes
        const newEntries = new Map<string, JournalEntry>();
        for (const [mod, deps] of this.discoveryResult.discoveredDeps) {
            newEntries.set(mod, {
                commitHash: allHashes.get(mod) ?? '',
                direct_deps: deps
            });
        }

        const updatedJournal = updateJournal(this.journal, newEntries, allModules);
        await saveJournal(this.journalKey!.primaryKey, this.journalKey!.restorePrefix, updatedJournal);
        core.info(`Saved ${Object.keys(updatedJournal.entries).length} entries under key: ${this.journalKey!.primaryKey}`);
        core.endGroup();

        return allHashes;
    }

    /**
     * Computes the source cache key and saves the Boost installation
     * to the GitHub Actions cache.
     *
     * @param allHashes - Per-module commit hashes for all initialized modules
     */
    private async saveSourceCache(allHashes: Map<string, string>): Promise<void> {
        if (!this.useCache) {
            return;
        }

        core.startGroup('💾 Save Boost source');

        if (this.discoveryResult) {
            const resolved = makeResolvedModuleSet(this.discoveryResult.initialized, allHashes);
            this.sourceKey = computeSourceCacheKey(resolved, this.inputs, this.graphRoots);
            core.info(`Caching mode: ${this.inputs.optimisticCaching ? 'optimistic' : 'pessimistic'}`);
            core.info(`Source cache key: ${this.sourceKey}`);
        }

        if (this.sourceKey) {
            await cacheBoost(this.inputs, this.sourceKey);
            core.info(`Saved under key: ${this.sourceKey}`);
        }

        core.endGroup();
    }
}

// ─── Exported Entry Points ──────────────────────────────────────────

/**
 * Installs Boost by cloning the super-project, applying patches, and
 * initializing the required submodules with their transitive dependencies.
 *
 * @param inputs - Configuration inputs including branch, modules, patches, and cache settings
 * @returns Outputs including the Boost directory path
 */
export async function main(inputs: Inputs): Promise<Outputs> {
    return new BoostCloner(inputs).run();
}

/**
 * Action entry point using schema-driven runner.
 *
 * This replaces the previous manual input extraction and error handling
 * with the standardized runAction wrapper.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'Boost Clone',
    main: async (inputs: Inputs) => {
        const outputs = await main(inputs);

        if (!outputs.boostDir) {
            throw new ExpectedError('Cannot clone Boost. Check the output above for details.', 'Boost Clone Failed');
        }

        return outputs;
    },
    callerModule: module
});
