jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

import {
    toSortedArray,
    hashObject,
    makeResolvedModuleSet,
    computeSourceCacheKey,
    computeJournalKey
} from './cache-key';
import type { Inputs } from './schema';

// ── toSortedArray ───────────────────────────────────────────────────

describe('toSortedArray', () => {
    it('returns sorted array from Set', () => {
        expect(toSortedArray(new Set(['c', 'a', 'b']))).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for null', () => {
        expect(toSortedArray(null)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
        expect(toSortedArray(undefined)).toEqual([]);
    });

    it('returns empty array for empty set', () => {
        expect(toSortedArray(new Set())).toEqual([]);
    });

    it('handles array input', () => {
        expect(toSortedArray(['z', 'm', 'a'])).toEqual(['a', 'm', 'z']);
    });
});

// ── hashObject ──────────────────────────────────────────────────────

describe('hashObject', () => {
    it('produces deterministic output', () => {
        const a = hashObject({ key: 'value' });
        const b = hashObject({ key: 'value' });
        expect(a).toBe(b);
    });

    it('produces different hashes for different values', () => {
        const a = hashObject({ key: 'value1' });
        const b = hashObject({ key: 'value2' });
        expect(a).not.toBe(b);
    });

    it('returns a hex string', () => {
        expect(hashObject('test')).toMatch(/^[a-f0-9]+$/);
    });
});

// ── makeResolvedModuleSet ───────────────────────────────────────────

describe('makeResolvedModuleSet', () => {
    it('creates a branded ResolvedModuleSet', () => {
        const modules = new Set(['a', 'b']);
        const hashes = new Map([['a', 'h1'], ['b', 'h2']]);
        const resolved = makeResolvedModuleSet(modules, hashes);
        expect(resolved.modules).toBe(modules);
        expect(resolved.hashes).toBe(hashes);
    });

    it('works with empty inputs', () => {
        const resolved = makeResolvedModuleSet(new Set(), new Map());
        expect(resolved.modules.size).toBe(0);
        expect(resolved.hashes.size).toBe(0);
    });
});

// ── Helper: creates standard test Inputs ────────────────────────────

function makeTestInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        branch: 'develop',
        patches: new Set<string>(),
        modules: new Set<string>(['config']),
        scan_modules_dir: new Set<string>(),
        modules_scan_paths: new Set<string>(),
        modules_exclude_paths: new Set<string>(['test', 'tests']),
        scan_modules_ignore: new Set<string>(),
        optimistic_caching: false,
        boost_dir: '/tmp/boost',
        cache: true,
        trace_commands: false,
        clone_strategy: 'auto' as const,
        archive_threshold: 25,
        ...overrides
    };
}

// ── computeSourceCacheKey ───────────────────────────────────────────

describe('computeSourceCacheKey', () => {
    it('produces deterministic keys', () => {
        const modules = new Set(['config', 'core']);
        const hashes = new Map([['config', 'h1'], ['core', 'h2']]);
        const resolved = makeResolvedModuleSet(modules, hashes);
        const roots = new Set(['config']);
        const inputs = makeTestInputs();

        const key1 = computeSourceCacheKey(resolved, inputs, roots);
        const key2 = computeSourceCacheKey(resolved, inputs, roots);
        expect(key1).toBe(key2);
    });

    it('has correct format: boost-source-{modulesHash}', () => {
        const resolved = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'abc123']])
        );
        const key = computeSourceCacheKey(resolved, makeTestInputs(), new Set(['config']));
        expect(key).toMatch(/^boost-source-[a-f0-9]+$/);
    });

    it('never contains boostHash', () => {
        const resolved = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'confighash']])
        );
        const key = computeSourceCacheKey(resolved, makeTestInputs(), new Set(['config']));
        expect(key).not.toContain('boosthash');
    });

    it('changes when module set changes', () => {
        const roots = new Set(['config']);
        const inputs = makeTestInputs();

        const resolved1 = makeResolvedModuleSet(
            new Set(['config', 'core']),
            new Map([['config', 'h1'], ['core', 'h2']])
        );
        const resolved2 = makeResolvedModuleSet(
            new Set(['config', 'core', 'assert']),
            new Map([['config', 'h1'], ['core', 'h2'], ['assert', 'h3']])
        );

        const key1 = computeSourceCacheKey(resolved1, inputs, roots);
        const key2 = computeSourceCacheKey(resolved2, inputs, roots);
        expect(key1).not.toBe(key2);
    });

    it('changes when a module hash changes', () => {
        const roots = new Set(['config']);
        const inputs = makeTestInputs();

        const resolved1 = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'hash_v1']])
        );
        const resolved2 = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'hash_v2']])
        );

        const key1 = computeSourceCacheKey(resolved1, inputs, roots);
        const key2 = computeSourceCacheKey(resolved2, inputs, roots);
        expect(key1).not.toBe(key2);
    });

    it('is not affected by branch name when hashes are present', () => {
        const resolved = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'h1']])
        );
        const roots = new Set(['config']);

        const key1 = computeSourceCacheKey(resolved, makeTestInputs({ branch: 'develop' }), roots);
        const key2 = computeSourceCacheKey(resolved, makeTestInputs({ branch: 'master' }), roots);
        expect(key1).toBe(key2);
    });

    it('is not affected by modules_exclude_paths', () => {
        const resolved = makeResolvedModuleSet(
            new Set(['config']),
            new Map([['config', 'h1']])
        );
        const roots = new Set(['config']);

        const key1 = computeSourceCacheKey(
            resolved,
            makeTestInputs({ modules_exclude_paths: new Set(['test']) }),
            roots
        );
        const key2 = computeSourceCacheKey(
            resolved,
            makeTestInputs({ modules_exclude_paths: new Set(['examples']) }),
            roots
        );
        expect(key1).toBe(key2);
    });

    it('pessimistic mode includes all module hashes in versionHash', () => {
        const modules = new Set(['config', 'core', 'assert']);
        const hashes = new Map([
            ['config', 'h1'],
            ['core', 'h2'],
            ['assert', 'h3']
        ]);
        const resolved = makeResolvedModuleSet(modules, hashes);
        const roots = new Set(['config']);

        const pessimistic = computeSourceCacheKey(
            resolved,
            makeTestInputs({ optimistic_caching: false }),
            roots
        );
        // Change a transitive dep hash
        const hashes2 = new Map([['config', 'h1'], ['core', 'h2_changed'], ['assert', 'h3']]);
        const resolved2 = makeResolvedModuleSet(modules, hashes2);
        const pessimistic2 = computeSourceCacheKey(
            resolved2,
            makeTestInputs({ optimistic_caching: false }),
            roots
        );
        // Pessimistic detects the change
        expect(pessimistic).not.toBe(pessimistic2);
    });

    it('optimistic mode only includes graph root hashes in versionHash', () => {
        const modules = new Set(['config', 'core', 'assert']);
        const hashes = new Map([
            ['config', 'h1'],
            ['core', 'h2'],
            ['assert', 'h3']
        ]);
        const resolved = makeResolvedModuleSet(modules, hashes);
        const roots = new Set(['config']);

        const optimistic = computeSourceCacheKey(
            resolved,
            makeTestInputs({ optimistic_caching: true }),
            roots
        );
        // Change a transitive dep hash (core is not a graph root)
        const hashes2 = new Map([['config', 'h1'], ['core', 'h2_changed'], ['assert', 'h3']]);
        const resolved2 = makeResolvedModuleSet(modules, hashes2);
        const optimistic2 = computeSourceCacheKey(
            resolved2,
            makeTestInputs({ optimistic_caching: true }),
            roots
        );
        // Optimistic does NOT detect the change (core not in roots)
        expect(optimistic).toBe(optimistic2);
    });

    it('optimistic mode always includes patch module hashes', () => {
        const modules = new Set(['config', 'buffers']);
        const hashes = new Map([
            ['config', 'h1'],
            ['buffers', 'patch_h1']
        ]);
        const resolved = makeResolvedModuleSet(modules, hashes);
        const roots = new Set(['config', 'buffers']);

        const key1 = computeSourceCacheKey(
            resolved,
            makeTestInputs({ optimistic_caching: true }),
            roots
        );

        // Change patch hash
        const hashes2 = new Map([['config', 'h1'], ['buffers', 'patch_h2']]);
        const resolved2 = makeResolvedModuleSet(modules, hashes2);
        const key2 = computeSourceCacheKey(
            resolved2,
            makeTestInputs({ optimistic_caching: true }),
            roots
        );
        // Patch hash change is detected even in optimistic mode
        expect(key1).not.toBe(key2);
    });

    it('is order-independent for module sets', () => {
        const roots = new Set(['config']);
        const inputs = makeTestInputs();

        const resolved1 = makeResolvedModuleSet(
            new Set(['config', 'core', 'assert']),
            new Map([['config', 'h1'], ['core', 'h2'], ['assert', 'h3']])
        );
        const resolved2 = makeResolvedModuleSet(
            new Set(['assert', 'config', 'core']),
            new Map([['assert', 'h3'], ['config', 'h1'], ['core', 'h2']])
        );

        const key1 = computeSourceCacheKey(resolved1, inputs, roots);
        const key2 = computeSourceCacheKey(resolved2, inputs, roots);
        expect(key1).toBe(key2);
    });

    it('release tag with empty hashes produces a non-trivial key', () => {
        const resolved = makeResolvedModuleSet(
            new Set(['config', 'core']),
            new Map()
        );
        const key = computeSourceCacheKey(
            resolved,
            makeTestInputs({ branch: 'boost-1.87.0' }),
            new Set(['config'])
        );
        expect(key).toMatch(/^boost-source-[a-f0-9]+$/);
        // Should not be a constant — the hash depends on modules + tag
        expect(key).not.toBe('boost-source-');
    });

    it('same release tag + same modules = same key', () => {
        const resolved1 = makeResolvedModuleSet(new Set(['config', 'core']), new Map());
        const resolved2 = makeResolvedModuleSet(new Set(['core', 'config']), new Map());
        const inputs = makeTestInputs({ branch: 'boost-1.87.0' });
        const roots = new Set(['config']);

        const key1 = computeSourceCacheKey(resolved1, inputs, roots);
        const key2 = computeSourceCacheKey(resolved2, inputs, roots);
        expect(key1).toBe(key2);
    });

    it('different release tags = different keys', () => {
        const modules = new Set(['config', 'core']);
        const resolved = makeResolvedModuleSet(modules, new Map());
        const roots = new Set(['config']);

        const key1 = computeSourceCacheKey(resolved, makeTestInputs({ branch: 'boost-1.87.0' }), roots);
        const key2 = computeSourceCacheKey(resolved, makeTestInputs({ branch: 'boost-1.88.0' }), roots);
        expect(key1).not.toBe(key2);
    });

    it('different modules with same release tag = different keys', () => {
        const resolved1 = makeResolvedModuleSet(new Set(['config', 'core']), new Map());
        const resolved2 = makeResolvedModuleSet(new Set(['config', 'core', 'assert']), new Map());
        const inputs = makeTestInputs({ branch: 'boost-1.87.0' });
        const roots = new Set(['config']);

        const key1 = computeSourceCacheKey(resolved1, inputs, roots);
        const key2 = computeSourceCacheKey(resolved2, inputs, roots);
        expect(key1).not.toBe(key2);
    });
});

// ── computeJournalKey ───────────────────────────────────────────────

describe('computeJournalKey', () => {
    const hashes = new Map([['config', 'h1'], ['url', 'h2'], ['buffers', 'h3']]);

    it('produces deterministic primary key', () => {
        const { primaryKey: k1 } = computeJournalKey(new Set(['config', 'url', 'buffers']), 'develop', hashes);
        const { primaryKey: k2 } = computeJournalKey(new Set(['config', 'url', 'buffers']), 'develop', hashes);
        expect(k1).toBe(k2);
    });

    it('primary key changes with different roots', () => {
        const { primaryKey: k1 } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h1']]));
        const { primaryKey: k2 } = computeJournalKey(new Set(['config', 'url']), 'develop', new Map([['config', 'h1'], ['url', 'h2']]));
        expect(k1).not.toBe(k2);
    });

    it('primary key changes with different branch', () => {
        const h = new Map([['config', 'h1']]);
        const { primaryKey: k1 } = computeJournalKey(new Set(['config']), 'develop', h);
        const { primaryKey: k2 } = computeJournalKey(new Set(['config']), 'master', h);
        expect(k1).not.toBe(k2);
    });

    it('primary key changes when root hashes change', () => {
        const { primaryKey: k1 } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h1']]));
        const { primaryKey: k2 } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h2']]));
        expect(k1).not.toBe(k2);
    });

    it('restore prefix does NOT change when root hashes change', () => {
        const { restorePrefix: p1 } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h1']]));
        const { restorePrefix: p2 } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h2']]));
        expect(p1).toBe(p2);
    });

    it('primary key starts with restore prefix', () => {
        const { primaryKey, restorePrefix } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h1']]));
        expect(primaryKey.startsWith(restorePrefix)).toBe(true);
    });

    it('primary key has correct format', () => {
        const { primaryKey } = computeJournalKey(new Set(['config']), 'develop', new Map([['config', 'h1']]));
        expect(primaryKey).toMatch(/^boost-journal-[a-f0-9]+-[a-f0-9]+$/);
    });

    it('is order-independent for roots', () => {
        const h = new Map([['url', 'h1'], ['config', 'h2'], ['system', 'h3'], ['buffers', 'h4'], ['http', 'h5']]);
        const { primaryKey: k1 } = computeJournalKey(
            new Set(['url', 'config', 'system', 'buffers', 'http']), 'develop', h
        );
        const { primaryKey: k2 } = computeJournalKey(
            new Set(['config', 'system', 'url', 'http', 'buffers']), 'develop', h
        );
        expect(k1).toBe(k2);
    });
});
