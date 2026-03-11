jest.mock('@actions/core', () => ({
    info: jest.fn(),
    warning: jest.fn()
}));

import {
    isReleaseTag,
    getLatestRelease,
    estimateTotalModules,
    getTransitiveClosure,
    decideStrategy,
    getBoostDepsData
} from './module-deps';
import type { Inputs } from './schema';

// ── isReleaseTag ────────────────────────────────────────────────────

describe('isReleaseTag', () => {
    it('matches release tags', () => {
        expect(isReleaseTag('boost-1.87.0')).toBe(true);
        expect(isReleaseTag('boost-1.90.0')).toBe(true);
    });

    it('rejects non-release branches', () => {
        expect(isReleaseTag('develop')).toBe(false);
        expect(isReleaseTag('master')).toBe(false);
        expect(isReleaseTag('boost-1.87')).toBe(false);
        expect(isReleaseTag('boost-1.87.0-rc1')).toBe(false);
    });
});

// ── getLatestRelease ────────────────────────────────────────────────

describe('getLatestRelease', () => {
    it('returns a release tag', () => {
        const latest = getLatestRelease();
        expect(latest).toMatch(/^boost-\d+\.\d+\.\d+$/);
    });
});

// ── getBoostDepsData ────────────────────────────────────────────────

describe('getBoostDepsData', () => {
    it('returns data with releases', () => {
        const data = getBoostDepsData();
        expect(data.releases).toBeDefined();
        expect(Object.keys(data.releases).length).toBeGreaterThan(0);
    });

    it('modules only have direct_deps (no transitive_deps or total_count)', () => {
        const data = getBoostDepsData();
        const firstRelease = Object.values(data.releases)[0];
        const firstModule = Object.values(firstRelease.modules)[0];
        expect(firstModule.direct_deps).toBeDefined();
        expect(Array.isArray(firstModule.direct_deps)).toBe(true);
        // Should not have old fields
        expect((firstModule as unknown as Record<string, unknown>)['transitive_deps']).toBeUndefined();
        expect((firstModule as unknown as Record<string, unknown>)['total_count']).toBeUndefined();
    });
});

// ── getTransitiveClosure ────────────────────────────────────────────

describe('getTransitiveClosure', () => {
    it('returns null for unknown release', () => {
        expect(getTransitiveClosure(new Set(['config']), 'boost-0.0.0')).toBeNull();
    });

    it('computes transitive closure from direct_deps', () => {
        const latest = getLatestRelease()!;
        const closure = getTransitiveClosure(new Set(['system']), latest);
        expect(closure).not.toBeNull();
        expect(closure!.has('system')).toBe(true);
        // system depends on config (direct dep)
        expect(closure!.has('config')).toBe(true);
        // Should include transitive deps of system's deps
        expect(closure!.size).toBeGreaterThan(1);
    });

    it('handles unknown modules gracefully', () => {
        const latest = getLatestRelease()!;
        const closure = getTransitiveClosure(new Set(['nonexistent_module']), latest);
        expect(closure).not.toBeNull();
        expect(closure!.has('nonexistent_module')).toBe(true);
        expect(closure!.size).toBe(1);
    });

    it('handles mixed known and unknown modules', () => {
        const latest = getLatestRelease()!;
        const closure = getTransitiveClosure(
            new Set(['system', 'nonexistent']),
            latest
        );
        expect(closure).not.toBeNull();
        expect(closure!.has('system')).toBe(true);
        expect(closure!.has('nonexistent')).toBe(true);
        expect(closure!.has('config')).toBe(true);
    });

    it('computes same result for repeated calls (pure function)', () => {
        const latest = getLatestRelease()!;
        const c1 = getTransitiveClosure(new Set(['system']), latest);
        const c2 = getTransitiveClosure(new Set(['system']), latest);
        expect([...c1!].sort()).toEqual([...c2!].sort());
    });
});

// ── estimateTotalModules ────────────────────────────────────────────

describe('estimateTotalModules', () => {
    it('returns fromPrecomputed=true for known releases', () => {
        const latest = getLatestRelease()!;
        const result = estimateTotalModules(new Set(['system']), latest);
        expect(result.fromPrecomputed).toBe(true);
        expect(result.totalCount).toBeGreaterThan(1);
        expect(result.allModules.has('system')).toBe(true);
    });

    it('returns fromPrecomputed=false for unknown releases', () => {
        const result = estimateTotalModules(new Set(['system']), 'boost-0.0.0');
        expect(result.fromPrecomputed).toBe(false);
        expect(result.totalCount).toBe(1);
    });

    it('returns fromPrecomputed=false when releaseTag is null', () => {
        const result = estimateTotalModules(new Set(['system']), null);
        expect(result.fromPrecomputed).toBe(false);
        expect(result.totalCount).toBe(1);
    });
});

// ── decideStrategy ──────────────────────────────────────────────────

describe('decideStrategy', () => {
    function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
        return {
            branch: 'develop',
            patches: new Set<string>(),
            modules: new Set<string>(),
            scanModulesDir: new Set<string>(),
            modulesScanPaths: new Set<string>(),
            modulesExcludePaths: new Set<string>(),
            scanModulesIgnore: new Set<string>(),
            optimisticCaching: false,
            boostDir: '/tmp/boost',
            cache: true,
            traceCommands: false,
            cloneStrategy: 'auto' as const,
            archiveThreshold: 25,
            ...overrides
        };
    }

    it('respects explicit git strategy', () => {
        expect(decideStrategy(makeInputs({ cloneStrategy: 'git' }), 100)).toBe('git');
    });

    it('respects explicit archive strategy for release tags', () => {
        expect(decideStrategy(
            makeInputs({ cloneStrategy: 'archive', branch: 'boost-1.87.0' }), 100
        )).toBe('archive');
    });

    it('falls back to git for archive on non-release branch', () => {
        expect(decideStrategy(
            makeInputs({ cloneStrategy: 'archive', branch: 'develop' }), 100
        )).toBe('git');
    });

    it('auto mode uses git for non-release branches', () => {
        expect(decideStrategy(makeInputs({ branch: 'develop' }), 100)).toBe('git');
    });

    it('auto mode uses archive for release tags above threshold', () => {
        expect(decideStrategy(
            makeInputs({ branch: 'boost-1.87.0', archiveThreshold: 25 }), 30
        )).toBe('archive');
    });

    it('auto mode uses git for release tags below threshold', () => {
        expect(decideStrategy(
            makeInputs({ branch: 'boost-1.87.0', archiveThreshold: 25 }), 10
        )).toBe('git');
    });
});
