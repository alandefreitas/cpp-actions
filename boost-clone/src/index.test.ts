// Mirror the production modules but replace side effects with controllable spies.
// Each mock maps to our runtime dependencies so we can assert call patterns
// without launching external processes.
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

jest.mock('@actions/cache', () => ({
    restoreCache: jest.fn(),
    saveCache: jest.fn(),
    isFeatureAvailable: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
}));

// Replace child-process execution helpers with spies; tests stub their results
// to simulate git output deterministically.
jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn(),
    exec: jest.fn()
}));

// Substitute setup-program helpers so git discovery never reaches
// the network during unit tests.
jest.mock('setup-program', () => ({
    findGit: jest.fn(),
    cloneGitRepo: jest.fn()
}));

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { main } from './index';
import { computeSourceCacheKey, makeResolvedModuleSet } from './cache-key';
import * as exec from '@actions/exec';
import * as cache from '@actions/cache';
import * as tc from '@actions/tool-cache';
import * as core from '@actions/core';
import type { Inputs } from './schema';
import type { GitFeatures } from './git-utils';
import { describePrettyErrors } from 'pretty-errors/test-helper';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

// ── Test helpers ──────────────────────────────────────────────────────

/**
 * Builds a complete {@link Inputs} object with sensible defaults for testing.
 *
 * @param overrides - Fields to override from the defaults
 * @returns A fully populated inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        boost_dir: '',
        branch: 'master',
        modules: new Set<string>(),
        patches: new Set<string>(),
        scan_modules_dir: new Set<string>(),
        modules_scan_paths: new Set<string>(),
        modules_exclude_paths: new Set<string>(),
        scan_modules_ignore: new Set<string>(),
        cache: true,
        optimistic_caching: false,
        trace_commands: false,
        clone_strategy: 'auto' as const,
        archive_threshold: 25,
        ...overrides
    };
}

/**
 * Writes minimal `.gitmodules` and `exceptions.txt` files to a temp directory.
 *
 * @param tmpDir - Directory where the files are created
 * @param moduleNames - Boost module names to list in .gitmodules
 * @param exceptionsContent - Raw text for exceptions.txt (empty by default)
 * @returns Absolute paths to both generated files
 */
async function createBoostMetadataFiles(
    tmpDir: string,
    moduleNames: string[],
    exceptionsContent = ''
): Promise<{ gitmodulesPath: string; exceptionsPath: string }> {
    const gitmodulesPath = path.join(tmpDir, '.gitmodules');
    const exceptionsPath = path.join(tmpDir, 'exceptions.txt');
    const gitmodulesContent = moduleNames.map(name =>
        `[submodule "libs/${name}"]\n\tpath = libs/${name}\n\turl = https://github.com/boostorg/${name}.git\n`
    ).join('');
    await fsp.writeFile(gitmodulesPath, gitmodulesContent);
    await fsp.writeFile(exceptionsPath, exceptionsContent);
    return { gitmodulesPath, exceptionsPath };
}

/**
 * Configures the most common mocks needed for a `main()` integration test.
 *
 * Sets up `findGit`, `cloneGitRepo`, `exec`, `getExecOutput`
 * (routing ls-remote calls through {@link opts.hashMap}), and optionally
 * `cache.isFeatureAvailable` and `cache.saveCache`.
 *
 * @param opts - Mock behaviour overrides
 * @param opts.cacheAvailable - Whether `cache.isFeatureAvailable` returns true (default: true)
 * @param opts.hashMap - Map of repo URL substring to commit hash for ls-remote mocks
 * @param opts.defaultHash - Fallback hash when no hashMap entry matches (default: `'hash'`)
 * @param opts.cacheSaveResult - If set, `cache.saveCache` resolves to this value
 */
function setupBaseMocks(opts: {
    cacheAvailable?: boolean;
    hashMap?: Record<string, string>;
    defaultHash?: string;
    cacheSaveResult?: unknown;
} = {}): void {
    const {
        cacheAvailable = true,
        hashMap = {},
        defaultHash = 'hash',
        cacheSaveResult
    } = opts;
    if (cacheAvailable) {
        (cache.isFeatureAvailable as jest.Mock).mockReturnValue(true);
    }
    setup_program.findGit.mockResolvedValue('/usr/bin/git');
    setup_program.cloneGitRepo.mockResolvedValue(undefined);

    const versionOutput = { exitCode: 0, stdout: 'git version 2.30.0' };
    (exec.getExecOutput as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') return Promise.resolve(versionOutput);
        const repo = args[1] as string;
        for (const [pattern, hash] of Object.entries(hashMap)) {
            if (repo.includes(pattern)) {
                return Promise.resolve({ exitCode: 0, stdout: `${hash}\trefs\n` });
            }
        }
        return Promise.resolve({ exitCode: 0, stdout: `${defaultHash}\trefs\n` });
    });
    (exec.exec as jest.Mock).mockResolvedValue(0);

    if (cacheSaveResult !== undefined) {
        (cache.saveCache as jest.Mock).mockResolvedValue(cacheSaveResult);
    }
}

/**
 * Mocks `cache.restoreCache` to simulate a journal hit followed by a source cache check.
 *
 * The first call writes a `journal.json` file into the requested path and returns
 * `'journal-key'`. The second call returns {@link sourceCacheResult}.
 *
 * @param entries - Journal entries keyed by module name
 * @param sourceCacheResult - Value returned on the second restoreCache call (default: `'boost-source-key'`)
 */
function mockJournalRestore(
    entries: Record<string, { commitHash: string; directDeps: string[] }>,
    sourceCacheResult: string | undefined = 'boost-source-key'
): void {
    let callCount = 0;
    (cache.restoreCache as jest.Mock).mockImplementation(async (paths: string[]) => {
        callCount++;
        if (callCount === 1) {
            const journalFile = path.join(paths[0], 'journal.json');
            await fsp.writeFile(journalFile, JSON.stringify({ entries }));
            return 'journal-key';
        }
        return sourceCacheResult;
    });
}

/**
 * Mocks `tc.downloadTool` to return the given file paths in order.
 *
 * The first call resolves to {@link gitmodulesPath}, the second to {@link exceptionsPath}.
 *
 * @param gitmodulesPath - Path returned for the first downloadTool call (.gitmodules)
 * @param exceptionsPath - Path returned for the second downloadTool call (exceptions.txt)
 */
function mockDownloadTool(gitmodulesPath: string, exceptionsPath: string): void {
    (tc.downloadTool as jest.Mock)
        .mockResolvedValueOnce(gitmodulesPath)
        .mockResolvedValueOnce(exceptionsPath);
}

/**
 * Creates inputs for multi-patch dependency resolution tests (issue #31).
 *
 * Configures a scenario with direct modules (config, system) and three
 * cppalliance patches (buffers, http, capy) that each bring their own
 * transitive Boost dependencies.
 *
 * @param tmpDir - Temporary directory for boost_dir
 * @returns Inputs configured with config+system modules and three cppalliance patches
 */
function makeMultiPatchInputs(tmpDir: string): Inputs {
    return makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'develop',
        modules: new Set<string>(['config', 'system']),
        patches: new Set<string>([
            'https://github.com/cppalliance/buffers',
            'https://github.com/cppalliance/http',
            'https://github.com/cppalliance/capy'
        ]),
        modules_exclude_paths: new Set<string>(['test', 'tests'])
    });
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
    // Reset spies between tests to prevent cross-test contamination.
    jest.clearAllMocks();
});

test('computeSourceCacheKey reflects modules-exclude-paths', () => {
    const modules = new Set(['filesystem', 'core', 'config']);
    const hashes = new Map([
        ['filesystem', 'hash1'],
        ['core', 'hash2'],
        ['config', 'hash3']
    ]);
    const resolved = makeResolvedModuleSet(modules, hashes);
    const roots = new Set(['filesystem']);
    const baseInputs = makeInputs({
        modules: new Set<string>(['filesystem']),
        modules_exclude_paths: new Set<string>(['test']),
        optimistic_caching: true
    });

    const keyA = computeSourceCacheKey(resolved, baseInputs, roots);
    const keyB = computeSourceCacheKey(resolved, {
        ...baseInputs,
        modules_exclude_paths: new Set<string>(['examples'])
    }, roots);

    // Exclude lists no longer affect the cache key (they only affect module discovery,
    // not what ends up in the cached directory).
    expect(keyA).toEqual(keyB);
});

test('computeSourceCacheKey is deterministic', () => {
    const modules = new Set(['a', 'b', 'c']);
    const hashes = new Map([['a', 'h1'], ['b', 'h2'], ['c', 'h3']]);
    const resolved = makeResolvedModuleSet(modules, hashes);
    const roots = new Set(['a']);
    const inputs = makeInputs({ branch: 'develop', modules: new Set<string>(['a']) });

    const key1 = computeSourceCacheKey(resolved, inputs, roots);
    const key2 = computeSourceCacheKey(resolved, inputs, roots);
    expect(key1).toBe(key2);
});

test('computeSourceCacheKey never contains boostHash', () => {
    const modules = new Set(['config']);
    const hashes = new Map([['config', 'confighash']]);
    const resolved = makeResolvedModuleSet(modules, hashes);
    const roots = new Set(['config']);
    const inputs = makeInputs({ modules: new Set<string>(['config']) });

    const key = computeSourceCacheKey(resolved, inputs, roots);
    // Key format: boost-source-{modulesHash}
    expect(key).toMatch(/^boost-source-[a-f0-9]+$/);
    // The boostHash 'boosthash' should not appear in the key
    expect(key).not.toContain('boosthash');
});

test('optimistic vs pessimistic produces different keys when extra modules differ', () => {
    const modules = new Set(['config', 'core', 'assert']);
    const hashes = new Map([
        ['config', 'h1'],
        ['core', 'h2'],
        ['assert', 'h3']
    ]);
    const resolved = makeResolvedModuleSet(modules, hashes);
    const roots = new Set(['config']);
    const baseInputs = makeInputs({ modules: new Set<string>(['config']) });

    const pessimisticKey = computeSourceCacheKey(resolved, baseInputs, roots);
    const optimisticKey = computeSourceCacheKey(resolved, {
        ...baseInputs,
        optimistic_caching: true
    }, roots);

    // With extra transitive modules (core, assert) having different hashes,
    // pessimistic includes all while optimistic only includes direct
    expect(pessimisticKey).not.toEqual(optimisticKey);
});

test('main short-circuits on cache hit before downloads and saves', async () => {
    setupBaseMocks();
    (cache.restoreCache as jest.Mock).mockResolvedValue('cache-hit');

    const inputs = makeInputs({ boost_dir: path.join(os.tmpdir(), 'boost-cache-hit') });
    await main(inputs);

    // With no modules requested → trivially complete → cache check
    expect(cache.restoreCache).toHaveBeenCalled();
    expect(tc.downloadTool).not.toHaveBeenCalled();
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();
});

/**
 * Sets up a cache-miss scenario: creates metadata files, mocks base calls with
 * no cache, and runs main with a single 'config' module.
 *
 * @param tmpPrefix - Prefix for the temp directory name
 * @returns The inputs used for the run
 */
async function runCacheMissScenario(tmpPrefix: string): Promise<void> {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(tmpDir, ['config'], 'throw_exception.hpp: exception\n');

    setupBaseMocks({ defaultHash: 'modulehash', cacheSaveResult: 'saved' });
    (cache.restoreCache as jest.Mock).mockResolvedValue(undefined);
    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        modules: new Set<string>(['config']),
        optimistic_caching: true
    });

    await main(inputs);
}

test('main saves cache on miss', async () => {
    await runCacheMissScenario('boost-cache-miss-');

    // Journal restore (miss) + source cache check are called via restoreCache
    expect(cache.restoreCache).toHaveBeenCalled();
    // .gitmodules and exceptions.txt downloaded
    expect(tc.downloadTool).toHaveBeenCalledTimes(2);
    // Journal save + boost source save
    expect(cache.saveCache).toHaveBeenCalled();
    // Source cache key saved
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Saved under key'));
});

test('main journal hit leads to cache check', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-journal-hit-'));

    setupBaseMocks({
        hashMap: { 'boostorg/config': 'confighash', 'boostorg/core': 'corehash' },
        defaultHash: 'confighash'
    });
    mockJournalRestore({
        config: { commitHash: 'confighash', directDeps: ['core'] },
        core: { commitHash: 'corehash', directDeps: [] }
    });

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        modules: new Set<string>(['config']),
        optimistic_caching: true
    });

    await main(inputs);

    // Journal restore + source cache check
    expect(cache.restoreCache).toHaveBeenCalledTimes(2);
    // Source cache hit → skip clone
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();
});

test('main falls through to layer-by-layer discovery when journal misses', async () => {
    await runCacheMissScenario('boost-discovery-');

    // Clone should have been called (no cache hit possible)
    expect(setup_program.cloneGitRepo).toHaveBeenCalled();
    // Journal save + boost source save
    expect(cache.saveCache).toHaveBeenCalled();
});

test('initializeSubmodules returns DiscoveryResult', async () => {
    const { initializeSubmodules } = await import('./submodules');

    (exec.exec as jest.Mock).mockResolvedValue(0);

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-init-'));

    const gitFeatures: GitFeatures = {
        gitPath: '/usr/bin/git',
        version: new semver.SemVer('2.30.0'),
        supportsJobs: true,
        supportsScanScripts: true,
        supportsDepth: true
    };

    const inputs = makeInputs({
        boost_dir: tmpDir,
        modules: new Set<string>(['config']),
        modules_exclude_paths: new Set<string>(['test', 'tests', 'example', 'examples'])
    });

    const result = await initializeSubmodules(
        inputs,
        new Set(['config']),
        gitFeatures,
        {},
        new Set(['libs/config', 'libs/headers']),
        new Set()
    );

    // Should return DiscoveryResult with initialized set and discoveredDeps map
    expect(result).toHaveProperty('initialized');
    expect(result).toHaveProperty('discoveredDeps');
    expect(result.initialized).toBeInstanceOf(Set);
    expect(result.initialized.has('config')).toBe(true);
    expect(result.initialized.has('headers')).toBe(true);
    expect(result.discoveredDeps).toBeInstanceOf(Map);
});

test('issue #31: empty journal triggers patch pre-scan and full clone', async () => {
    // Reproduces the exact issue #31 scenario with no prior journal:
    // - User library needs: config, system
    // - Patches: buffers (deps: core, assert), http (deps: core, json), capy (deps: system, config)
    // - Each patch has its own transitive Boost deps
    //
    // Expected flow:
    //   1. Metadata downloaded (.gitmodules + exceptions.txt)
    //   2. Journal restore → miss (no prior data)
    //   3. discoverPatchDependencies clones each patch to tmp, scans headers
    //      → journal now has entries for buffers, http, capy with their deps
    //   4. Resolution walk: direct modules (config, system) NOT in journal → partial
    //   5. Full clone + layer-by-layer discovery
    //   6. Journal saved with all entries, source cache saved

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-issue31-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(
        tmpDir, ['config', 'core', 'system', 'assert', 'json']
    );

    setupBaseMocks({
        cacheSaveResult: 'saved',
        hashMap: {
            'boostorg/config': 'confighash', 'boostorg/core': 'corehash',
            'boostorg/system': 'systemhash', 'boostorg/assert': 'asserthash',
            'boostorg/json': 'jsonhash', 'cppalliance/buffers': 'buffershash',
            'cppalliance/http': 'httphash', 'cppalliance/capy': 'capyhash'
        },
        defaultHash: 'otherhash'
    });
    (cache.restoreCache as jest.Mock).mockResolvedValue(undefined);

    // cloneGitRepo: for patch pre-scan clones, write headers that declare real deps
    const preScanClones: string[] = [];
    setup_program.cloneGitRepo.mockImplementation(async (url: string, dest: string) => {
        if (url.includes('cppalliance/buffers') && dest.includes('boost-patch-')) {
            preScanClones.push('buffers');
            const incDir = path.join(dest, 'include');
            await fsp.mkdir(incDir, { recursive: true });
            await fsp.writeFile(path.join(incDir, 'buffers.hpp'),
                '#include <boost/core/span.hpp>\n#include <boost/assert/source_location.hpp>\n');
        } else if (url.includes('cppalliance/http') && dest.includes('boost-patch-')) {
            preScanClones.push('http');
            const incDir = path.join(dest, 'include');
            await fsp.mkdir(incDir, { recursive: true });
            await fsp.writeFile(path.join(incDir, 'http.hpp'),
                '#include <boost/core/detail/string_view.hpp>\n#include <boost/json/value.hpp>\n');
        } else if (url.includes('cppalliance/capy') && dest.includes('boost-patch-')) {
            preScanClones.push('capy');
            const incDir = path.join(dest, 'include');
            await fsp.mkdir(incDir, { recursive: true });
            await fsp.writeFile(path.join(incDir, 'capy.hpp'),
                '#include <boost/system/error_code.hpp>\n#include <boost/config/detail/suffix.hpp>\n');
        }
        // For boost superproject clone and applyPatches clones: no-op
    });

    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeMultiPatchInputs(tmpDir);

    await main(inputs);

    // All 3 patches should have been cloned for pre-scanning
    expect(preScanClones).toContain('buffers');
    expect(preScanClones).toContain('http');
    expect(preScanClones).toContain('capy');

    // Pre-scan should log about discovered patch deps in the journal
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Journal after patch pre-scan'));

    // Source cache key should be saved
    const sourceCall = (cache.saveCache as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).startsWith('boost-source-')
    );
    expect(sourceCall).toBeDefined();
    const savedKey = sourceCall![1] as string;
    expect(savedKey).toMatch(/^boost-source-[a-f0-9]+$/);

    // Journal should also be saved (for journal-based resolution in future runs)
    const journalCall = (cache.saveCache as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).startsWith('boost-journal-')
    );
    expect(journalCall).toBeDefined();

    // Clone should have happened (first run → partial resolution → layer-by-layer discovery)
    expect(setup_program.cloneGitRepo).toHaveBeenCalled();
});

test('issue #31: complete journal with patch deps resolves all and hits cache', async () => {
    // Simulates having a complete journal that already knows about all patch deps:
    // - User library needs: config, system
    // - Patches: buffers (deps: core, assert), http (deps: core, json), capy (deps: system, config)
    // - Journal has COMPLETE data for all modules + patch deps
    //
    // Expected flow:
    //   1. Metadata downloaded
    //   2. Journal restore → hit (complete data)
    //   3. discoverPatchDependencies → all 3 patches already in journal → skip clone
    //   4. Resolution walk uses patchUrlMap → correct cppalliance hashes → all match → complete
    //   5. Source cache key computed → cache hit → return immediately, NO clone

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-issue31-run2-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(
        tmpDir, ['config', 'core', 'system', 'assert', 'json']
    );

    setupBaseMocks({
        hashMap: {
            'boostorg/config': 'confighash', 'boostorg/core': 'corehash',
            'boostorg/system': 'systemhash', 'boostorg/assert': 'asserthash',
            'boostorg/json': 'jsonhash', 'cppalliance/buffers': 'buffershash',
            'cppalliance/http': 'httphash', 'cppalliance/capy': 'capyhash',
            // boostorg/buffers would return DIFFERENT hash — proves patchUrlMap is needed
            'boostorg/buffers': 'WRONG_boostorg_bh',
            'boostorg/http': 'WRONG_boostorg_hh',
            'boostorg/capy': 'WRONG_boostorg_ch'
        },
        defaultHash: 'otherhash'
    });
    mockJournalRestore({
        config: { commitHash: 'confighash', directDeps: [] },
        core: { commitHash: 'corehash', directDeps: ['config'] },
        system: { commitHash: 'systemhash', directDeps: ['config'] },
        assert: { commitHash: 'asserthash', directDeps: ['config'] },
        json: { commitHash: 'jsonhash', directDeps: ['config', 'core'] },
        buffers: { commitHash: 'buffershash', directDeps: ['core', 'assert'] },
        http: { commitHash: 'httphash', directDeps: ['core', 'json'] },
        capy: { commitHash: 'capyhash', directDeps: ['system', 'config'] }
    });
    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeMultiPatchInputs(tmpDir);

    await main(inputs);

    // NO clone should have happened — journal complete → resolution complete → cache hit
    // This is the critical assertion: if patchUrlMap wasn't forwarded, resolution would
    // use boostorg URLs → get WRONG_boostorg_* hashes → mismatch → partial → clone
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();

    // Resolution should have completed (0 frontier)
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('0 frontier'));
    // Source cache key should have been computed and checked
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Source cache key'));
    expect(core.info).toHaveBeenCalledWith('Cache hit: skipping clone and submodule init');
});

test('partial journal resolution reuses hashes and merges journal on save', async () => {
    // Scenario: direct modules = {config, system}. Journal has valid entries
    // for config→[assert] and assert→[], but system's hash has changed (stale).
    //
    // Resolution walk:
    //   Layer 1: config, system (both are graph roots)
    //   - config → hash matches → follow deps → [assert]
    //   - system → hash mismatch → frontier (deps NOT followed)
    //   Layer 2: assert
    //   - assert → hash matches → follow deps → []
    //   Result: resolved={config, assert}, frontier={system}, partial
    //
    // Then layer-by-layer discovery clones and discovers everything.
    // On finalize:
    //   - hashes has config, system, assert (all visited during walk)
    //   - system's hash was fetched during the walk — it should NOT be re-fetched
    //   - Journal save merges old + new entries

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-partial-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(
        tmpDir, ['config', 'system', 'assert']
    );

    setupBaseMocks({
        cacheSaveResult: 'saved',
        hashMap: {
            'boostorg/config': 'confighash',
            'boostorg/system': 'systemhash_NEW',
            'boostorg/assert': 'asserthash'
        },
        defaultHash: 'otherhash'
    });
    // Journal: config and assert are current, system is stale
    mockJournalRestore({
        config: { commitHash: 'confighash', directDeps: ['assert'] },
        assert: { commitHash: 'asserthash', directDeps: [] },
        system: { commitHash: 'systemhash_OLD', directDeps: ['config'] }
    }, undefined);
    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'develop',
        modules: new Set<string>(['config', 'system']),
        modules_exclude_paths: new Set<string>(['test', 'tests'])
    });

    await main(inputs);

    // Resolution should have been partial (system stale → frontier)
    expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Partial resolution')
    );

    // Clone should have happened (partial → layer-by-layer discovery)
    expect(setup_program.cloneGitRepo).toHaveBeenCalled();

    // Journal should be saved
    const journalSaveCall = (cache.saveCache as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).startsWith('boost-journal-')
    );
    expect(journalSaveCall).toBeDefined();

    // Source cache should also be saved
    const sourceSaveCall = (cache.saveCache as jest.Mock).mock.calls.find(
        (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).startsWith('boost-source-')
    );
    expect(sourceSaveCall).toBeDefined();

    // Verify hash reuse: root hashes (config, system) are fetched once
    // during restoreJournal and reused via prefetchedHashes during
    // resolution. Transitive-only deps (assert) are fetched only during
    // resolution. No module should be re-fetched beyond that.
    const lsRemoteCalls = (exec.getExecOutput as jest.Mock).mock.calls
        .filter((call: unknown[]) => {
            const args = call[1] as string[];
            return args[0] === 'ls-remote';
        });
    const configCalls = lsRemoteCalls.filter(
        (call: unknown[]) => (call[1] as string[])[1].includes('boostorg/config')
    );
    const systemCalls = lsRemoteCalls.filter(
        (call: unknown[]) => (call[1] as string[])[1].includes('boostorg/system')
    );
    const assertCalls = lsRemoteCalls.filter(
        (call: unknown[]) => (call[1] as string[])[1].includes('boostorg/assert')
    );
    // Root modules fetched once (journal key); resolution reuses prefetched.
    // Transitive dep (assert) fetched once during resolution.
    expect(configCalls.length).toBe(1);
    expect(systemCalls.length).toBe(1);
    expect(assertCalls.length).toBe(1);
});

test('main with cache disabled skips all cache operations', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-no-cache-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(tmpDir, ['config']);

    setupBaseMocks({ cacheAvailable: false });
    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        modules: new Set<string>(['config']),
        cache: false
    });

    await main(inputs);

    // No cache operations at all
    expect(cache.restoreCache).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();
    // But clone still happens
    expect(setup_program.cloneGitRepo).toHaveBeenCalled();
});

test('main with release tag uses precomputed deps', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-precomputed-'));

    setupBaseMocks();
    (cache.restoreCache as jest.Mock).mockResolvedValue('cache-hit');

    // Use the actual latest release from our boost-deps.json
    const { getLatestRelease } = await import('./module-deps');
    const release = getLatestRelease()!;

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: release,
        modules: new Set<string>(['system'])
    });

    await main(inputs);

    // Precomputed fast path should log about precomputed data
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Precomputed hit'));
    // Cache hit → no clone
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
});

test('main no modules and no patches uses trivially complete resolution', async () => {
    setupBaseMocks();
    (cache.restoreCache as jest.Mock).mockResolvedValue('cache-hit');

    const inputs = makeInputs({ boost_dir: path.join(os.tmpdir(), 'boost-empty') });
    await main(inputs);

    // Trivially complete → cache check → hit → no clone
    expect(cache.restoreCache).toHaveBeenCalled();
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
});

test('patch pre-scan populates journal before resolution walk (first run)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-patch-prescan-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(
        tmpDir, ['config', 'core', 'system']
    );

    setupBaseMocks({
        cacheSaveResult: 'saved',
        hashMap: {
            'boostorg/config': 'confighash', 'boostorg/core': 'corehash',
            'boostorg/system': 'systemhash', 'cppalliance/buffers': 'buffershash'
        },
        defaultHash: 'otherhash'
    });
    (cache.restoreCache as jest.Mock).mockResolvedValue(undefined);

    // Track cloneGitRepo calls to verify patch pre-scan clones
    const cloneCalls: string[] = [];
    setup_program.cloneGitRepo.mockImplementation(async (url: string, dest: string) => {
        cloneCalls.push(url);
        // For patch clone, create a minimal include dir with a boost header
        if (url.includes('cppalliance/buffers')) {
            const includeDir = path.join(dest, 'include');
            await fsp.mkdir(includeDir, { recursive: true });
            await fsp.writeFile(path.join(includeDir, 'test.hpp'),
                '#include <boost/core/detail.hpp>\n#include <boost/system/error.hpp>\n');
        }
    });

    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'develop',
        modules: new Set<string>(['config']),
        patches: new Set<string>(['https://github.com/cppalliance/buffers']),
        modules_exclude_paths: new Set<string>(['test', 'tests'])
    });

    await main(inputs);

    // Patch should have been cloned for pre-scanning
    expect(cloneCalls.some(url => url.includes('cppalliance/buffers'))).toBe(true);
    // Cache should have been saved
    expect(cache.saveCache).toHaveBeenCalled();
    // The pre-scan should log about patch dependencies
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Journal after patch pre-scan'));
});

test('patch pre-scan uses correct URL for hash fetch (cache hit with patches)', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'boost-patch-url-'));
    const { gitmodulesPath, exceptionsPath } = await createBoostMetadataFiles(tmpDir, ['config', 'core']);

    setupBaseMocks({
        hashMap: {
            'boostorg/config': 'confighash', 'boostorg/core': 'corehash',
            'cppalliance/buffers': 'cppalliance_bh', 'boostorg/buffers': 'boostorg_bh'
        },
        defaultHash: 'otherhash'
    });
    mockJournalRestore({
        config: { commitHash: 'confighash', directDeps: [] },
        buffers: { commitHash: 'cppalliance_bh', directDeps: ['core'] },
        core: { commitHash: 'corehash', directDeps: [] }
    });
    mockDownloadTool(gitmodulesPath, exceptionsPath);

    const inputs = makeInputs({
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'develop',
        modules: new Set<string>(['config']),
        patches: new Set<string>(['https://github.com/cppalliance/buffers'])
    });

    await main(inputs);

    // With patchUrlMap, buffers gets hashed via cppalliance URL → matches journal → cache hit
    // If patchUrlMap wasn't passed, it would use boostorg URL → hash mismatch → no cache hit
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
});

describePrettyErrors('boost boom', 'Boost clone failed');
