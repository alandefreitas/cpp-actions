jest.mock('@actions/core', () => ({
    info: jest.fn(),
    warning: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

import * as semver from 'semver';
import * as exec from '@actions/exec';
import type { Journal } from './cached-deps';
import type { GitFeatures } from './git-utils';
import { resolveModules, isResolutionComplete } from './resolution';

const gitFeatures: GitFeatures = {
    gitPath: '/usr/bin/git',
    version: new semver.SemVer('2.30.0'),
    supportsJobs: true,
    supportsScanScripts: true,
    supportsDepth: true
};

beforeEach(() => {
    jest.clearAllMocks();
});

// ── resolveModules ──────────────────────────────────────────────────

describe('resolveModules', () => {
    function mockHashes(hashMap: Record<string, string>): void {
        (exec.getExecOutput as jest.Mock).mockImplementation(
            (_cmd: string, args: string[]) => {
                const repo = args[1];
                for (const [mod, hash] of Object.entries(hashMap)) {
                    if (repo.includes(`boostorg/${mod}`) || repo.includes(`cppalliance/${mod}`)) {
                        return Promise.resolve({
                            exitCode: 0,
                            stdout: `${hash}\trefs/heads/develop\n`
                        });
                    }
                }
                return Promise.resolve({
                    exitCode: 0,
                    stdout: `fallbackhash\trefs/heads/develop\n`
                });
            }
        );
    }

    it('returns complete when all roots have valid journal entries', async () => {
        mockHashes({ config: 'confighash', core: 'corehash', assert: 'asserthash' });

        const roots = new Set(['config']);
        const journal: Journal = {
            entries: {
                config: { commitHash: 'confighash', direct_deps: ['core'] },
                core: { commitHash: 'corehash', direct_deps: ['assert'] },
                assert: { commitHash: 'asserthash', direct_deps: [] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(true);
        expect(result.modules.has('config')).toBe(true);
        expect(result.modules.has('core')).toBe(true);
        expect(result.modules.has('assert')).toBe(true);
        expect(result.modules.size).toBe(3);
        expect(result.hashes.get('config')).toBe('confighash');
        expect(result.hashes.get('core')).toBe('corehash');
    });

    it('returns partial when a journal entry is stale (hash mismatch)', async () => {
        mockHashes({ config: 'confighash_new', core: 'corehash' });

        const roots = new Set(['config']);
        const journal: Journal = {
            entries: {
                config: { commitHash: 'confighash_old', direct_deps: ['core'] },
                core: { commitHash: 'corehash', direct_deps: [] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('config')).toBe(true);
        expect(result.frontier.size).toBe(1);
        // Config is in frontier, so its deps (core) are not followed
        expect(result.modules.size - result.frontier.size).toBe(0);
    });

    it('returns partial when a module is missing from journal', async () => {
        mockHashes({ config: 'confighash', core: 'corehash' });

        const roots = new Set(['config']);
        const journal: Journal = {
            entries: {
                config: { commitHash: 'confighash', direct_deps: ['core'] }
                // core missing from journal
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('core')).toBe(true);
        // config was validated (not in frontier)
        expect(result.modules.has('config')).toBe(true);
        expect(result.frontier.has('config')).toBe(false);
    });

    it('returns partial when journal is null', async () => {
        mockHashes({ config: 'confighash' });

        const roots = new Set(['config']);

        const result = await resolveModules(roots, null, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('config')).toBe(true);
    });

    it('does not treat empty hash as valid match', async () => {
        // Simulate a module whose repo doesn't exist: ls-remote fails → getGitHash
        // throws → fetchModuleHashes catches → empty hash
        (exec.getExecOutput as jest.Mock).mockImplementation(
            (_cmd: string, args: string[]) => {
                const repo = args[1];
                if (repo.includes('boostorg/alias_mod')) {
                    return Promise.resolve({ exitCode: 1, stdout: '' });
                }
                return Promise.resolve({
                    exitCode: 0,
                    stdout: `somehash\trefs/heads/develop\n`
                });
            }
        );

        const roots = new Set(['alias_mod']);
        // Journal has empty hash for alias_mod (from previous run where it also didn't exist)
        const journal: Journal = {
            entries: {
                alias_mod: { commitHash: '', direct_deps: ['core'] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        // Empty hash should NOT match '' in journal
        expect(result.frontier.has('alias_mod')).toBe(true);
    });

    it('handles diamond dependencies without duplicate visits', async () => {
        mockHashes({
            config: 'ch', core: 'crh', assert: 'ah', system: 'sh'
        });

        const roots = new Set(['core', 'system']);
        // Diamond: core→assert, system→assert
        const journal: Journal = {
            entries: {
                core: { commitHash: 'crh', direct_deps: ['assert', 'config'] },
                system: { commitHash: 'sh', direct_deps: ['assert', 'config'] },
                assert: { commitHash: 'ah', direct_deps: ['config'] },
                config: { commitHash: 'ch', direct_deps: [] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(true);
        expect(result.modules.size).toBe(4);
    });

    it('resolves patch modules included in graph roots', async () => {
        mockHashes({ config: 'ch', buffers: 'bh', core: 'crh' });

        const roots = new Set(['config', 'buffers']);
        const journal: Journal = {
            entries: {
                config: { commitHash: 'ch', direct_deps: [] },
                buffers: { commitHash: 'bh', direct_deps: ['core'] },
                core: { commitHash: 'crh', direct_deps: [] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(true);
        expect(result.modules.has('config')).toBe(true);
        expect(result.modules.has('buffers')).toBe(true);
        expect(result.modules.has('core')).toBe(true);
        expect(result.modules.size).toBe(3);
    });

    it('issue #31 scenario: patches with transitive deps cause partial when journal incomplete', async () => {
        // Simulates the issue #31 scenario:
        // - User scans code → discovers config, url, system, assert, core
        // - Patches: buffers, http, capy
        // - Patch modules have their own deps (json, endian, container, etc.)
        // - Journal doesn't know about patch deps → frontier grows
        mockHashes({
            config: 'ch', url: 'uh', system: 'sh', assert: 'ah', core: 'crh',
            buffers: 'bfh', http: 'hth', capy: 'cph',
            json: 'jh', endian: 'eh', container: 'cth'
        });

        const roots = new Set(['config', 'url', 'system', 'assert', 'core', 'buffers', 'http', 'capy']);

        // Journal only has data for the direct modules, not patch deps
        const journal: Journal = {
            entries: {
                config: { commitHash: 'ch', direct_deps: [] },
                url: { commitHash: 'uh', direct_deps: ['core', 'config'] },
                system: { commitHash: 'sh', direct_deps: ['config', 'assert'] },
                assert: { commitHash: 'ah', direct_deps: ['config'] },
                core: { commitHash: 'crh', direct_deps: ['config', 'assert'] }
                // buffers, http, capy NOT in journal
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        // Patch modules should be in the frontier
        expect(result.frontier.has('buffers')).toBe(true);
        expect(result.frontier.has('http')).toBe(true);
        expect(result.frontier.has('capy')).toBe(true);
        // Direct modules should be validated (in modules but not in frontier)
        expect(result.modules.has('config')).toBe(true);
        expect(result.frontier.has('config')).toBe(false);
        expect(result.modules.has('url')).toBe(true);
        expect(result.frontier.has('url')).toBe(false);
    });

    it('issue #31 scenario: complete resolution when journal has patch deps', async () => {
        // Same scenario but journal has complete data including patch deps
        mockHashes({
            config: 'ch', url: 'uh', system: 'sh', assert: 'ah', core: 'crh',
            buffers: 'bfh', http: 'hth', capy: 'cph',
            json: 'jh', endian: 'eh'
        });

        const roots = new Set(['config', 'url', 'system', 'assert', 'core', 'buffers', 'http', 'capy']);

        // Journal has COMPLETE data including patch dependencies
        const journal: Journal = {
            entries: {
                config: { commitHash: 'ch', direct_deps: [] },
                url: { commitHash: 'uh', direct_deps: ['core', 'config'] },
                system: { commitHash: 'sh', direct_deps: ['config', 'assert'] },
                assert: { commitHash: 'ah', direct_deps: ['config'] },
                core: { commitHash: 'crh', direct_deps: ['config', 'assert'] },
                buffers: { commitHash: 'bfh', direct_deps: ['core', 'assert'] },
                http: { commitHash: 'hth', direct_deps: ['core', 'url', 'json'] },
                capy: { commitHash: 'cph', direct_deps: ['system', 'config'] },
                json: { commitHash: 'jh', direct_deps: ['core', 'endian'] },
                endian: { commitHash: 'eh', direct_deps: ['config'] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(true);
        // All modules from roots + their transitive deps
        expect(result.modules.has('config')).toBe(true);
        expect(result.modules.has('buffers')).toBe(true);
        expect(result.modules.has('http')).toBe(true);
        expect(result.modules.has('capy')).toBe(true);
        expect(result.modules.has('json')).toBe(true);
        expect(result.modules.has('endian')).toBe(true);
        expect(result.modules.size).toBe(10);
    });

    /**
     * Sets up shared state for the patchUrlMap tests: exec hash mock, roots, and journal.
     *
     * @param extraHashes - Additional URL-to-hash mappings beyond the base set
     * @returns Roots set and journal for resolveModules calls
     */
    function setupPatchUrlTest(extraHashes: Record<string, string> = {}): {
        roots: Set<string>;
        journal: Journal;
    } {
        const hashMap: Record<string, string> = {
            'boostorg/config': 'confighash',
            'boostorg/buffers': 'boostorg_bh',
            'boostorg/core': 'corehash',
            ...extraHashes
        };
        (exec.getExecOutput as jest.Mock).mockImplementation(
            (_cmd: string, args: string[]) => {
                const repo = args[1];
                for (const [pattern, hash] of Object.entries(hashMap)) {
                    if (repo.includes(pattern)) {
                        return Promise.resolve({ exitCode: 0, stdout: `${hash}\trefs/heads/develop\n` });
                    }
                }
                return Promise.resolve({ exitCode: 0, stdout: 'fallbackhash\trefs/heads/develop\n' });
            }
        );

        return {
            roots: new Set(['config', 'buffers']),
            journal: {
                entries: {
                    config: { commitHash: 'confighash', direct_deps: [] },
                    buffers: { commitHash: 'cppalliance_bh', direct_deps: ['core'] },
                    core: { commitHash: 'corehash', direct_deps: [] }
                }
            }
        };
    }

    it('uses patchUrlMap for correct repo URLs during hash fetch', async () => {
        // Without patchUrlMap, buffers would use boostorg/buffers.git URL
        // and get a different hash ('boostorg_bh') than what's in the journal ('cppalliance_bh').
        // With patchUrlMap, it uses cppalliance/buffers.git and gets the correct hash.
        const { roots, journal } = setupPatchUrlTest({
            'cppalliance/buffers': 'cppalliance_bh'
        });

        const patchUrlMap = new Map([
            ['buffers', 'https://github.com/cppalliance/buffers.git']
        ]);

        const result = await resolveModules(roots, journal, 'develop', gitFeatures, patchUrlMap);
        // With correct URL, journal hash matches → complete resolution
        expect(isResolutionComplete(result)).toBe(true);
        expect(result.modules.has('config')).toBe(true);
        expect(result.modules.has('buffers')).toBe(true);
        expect(result.modules.has('core')).toBe(true);
        expect(result.modules.size).toBe(3);
        expect(result.hashes.get('buffers')).toBe('cppalliance_bh');
    });

    it('skips ls-remote for modules present in prefetchedHashes', async () => {
        // Provide prefetched hashes for config and core — ls-remote should
        // NOT be called for them.  Only assert (a transitive dep) should
        // trigger ls-remote.
        mockHashes({ assert: 'asserthash' });

        const roots = new Set(['config']);
        const journal: Journal = {
            entries: {
                config: { commitHash: 'confighash', direct_deps: ['core'] },
                core: { commitHash: 'corehash', direct_deps: ['assert'] },
                assert: { commitHash: 'asserthash', direct_deps: [] }
            }
        };
        const prefetched = new Map([
            ['config', 'confighash'],
            ['core', 'corehash']
        ]);

        const result = await resolveModules(roots, journal, 'develop', gitFeatures, undefined, prefetched);
        expect(isResolutionComplete(result)).toBe(true);
        expect(result.modules.size).toBe(3);
        expect(result.hashes.get('config')).toBe('confighash');
        expect(result.hashes.get('core')).toBe('corehash');
        expect(result.hashes.get('assert')).toBe('asserthash');

        // ls-remote should only have been called for 'assert' (not config/core)
        const lsRemoteCalls = (exec.getExecOutput as jest.Mock).mock.calls
            .filter((call: unknown[]) => {
                const args = call[1] as string[];
                return args[0] === 'ls-remote';
            });
        expect(lsRemoteCalls.length).toBe(1);
        expect((lsRemoteCalls[0][1] as string[])[1]).toContain('boostorg/assert');
    });

    it('treats journal entry with missing direct_deps as frontier', async () => {
        mockHashes({ config: 'confighash', core: 'corehash' });

        const roots = new Set(['config']);
        // Simulate a cached journal where direct_deps is missing (e.g. written
        // by an older version of the code or corrupted cache data).
        const journal: Journal = {
            entries: {
                config: {
                    commitHash: 'confighash',
                    direct_deps: undefined as unknown as string[]
                },
                core: { commitHash: 'corehash', direct_deps: [] }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('config')).toBe(true);
        // core is not followed because config went to frontier
        expect(result.modules.has('core')).toBe(false);
    });

    it('treats journal entry with non-array direct_deps as frontier', async () => {
        mockHashes({ config: 'confighash' });

        const roots = new Set(['config']);
        const journal: Journal = {
            entries: {
                config: {
                    commitHash: 'confighash',
                    direct_deps: 'not-an-array' as unknown as string[]
                }
            }
        };

        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('config')).toBe(true);
    });

    it('without patchUrlMap, patch module gets wrong hash and goes to frontier', async () => {
        // Same setup as above but without patchUrlMap — uses boostorg URL
        const { roots, journal } = setupPatchUrlTest();

        // No patchUrlMap → uses boostorg URL → hash mismatch → partial
        const result = await resolveModules(roots, journal, 'develop', gitFeatures);
        expect(isResolutionComplete(result)).toBe(false);
        expect(result.frontier.has('buffers')).toBe(true);
    });
});
