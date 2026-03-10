jest.mock('@actions/cache', () => ({
    restoreCache: jest.fn(),
    saveCache: jest.fn()
}));

jest.mock('@actions/core', () => ({
    warning: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as cache from '@actions/cache';
import type { Journal, JournalEntry } from './cached-deps';
import {
    restoreJournal,
    saveJournal,
    updateJournal
} from './cached-deps';

beforeEach(() => {
    jest.clearAllMocks();
});

// ── restoreJournal ──────────────────────────────────────────────────

describe('restoreJournal', () => {
    it('returns parsed journal on cache hit', async () => {
        const expectedJournal: Journal = {
            entries: {
                config: { commitHash: 'abc123', directDeps: ['core', 'assert'] },
                core: { commitHash: 'def456', directDeps: [] }
            }
        };

        (cache.restoreCache as jest.Mock).mockImplementation(async (paths: string[]) => {
            const journalFile = path.join(paths[0], 'journal.json');
            await fsp.writeFile(journalFile, JSON.stringify(expectedJournal));
            return 'boost-journal-abc12345';
        });

        const result = await restoreJournal('boost-journal-abc-fff000', 'boost-journal-abc');
        expect(result).toEqual(expectedJournal);
        expect(cache.restoreCache).toHaveBeenCalledWith(
            [expect.stringContaining('boost-journal-')],
            'boost-journal-abc-fff000',
            ['boost-journal-abc']
        );
    });

    it('returns null on cache miss', async () => {
        (cache.restoreCache as jest.Mock).mockResolvedValue(undefined);

        const result = await restoreJournal('boost-journal-abc-fff000', 'boost-journal-abc');
        expect(result).toBeNull();
    });

    it('returns null when cache hit but journal.json missing', async () => {
        (cache.restoreCache as jest.Mock).mockResolvedValue('some-key');

        const result = await restoreJournal('boost-journal-abc-fff000', 'boost-journal-abc');
        expect(result).toBeNull();
    });

    it('returns null on error', async () => {
        (cache.restoreCache as jest.Mock).mockRejectedValue(new Error('network error'));

        const result = await restoreJournal('boost-journal-abc-fff000', 'boost-journal-abc');
        expect(result).toBeNull();
    });
});

// ── saveJournal ─────────────────────────────────────────────────────

describe('saveJournal', () => {
    const testJournal: Journal = {
        entries: {
            config: { commitHash: 'abc123', directDeps: ['core'] }
        }
    };

    it('writes JSON and calls saveCache', async () => {
        (cache.saveCache as jest.Mock).mockResolvedValue('saved');

        await saveJournal('boost-journal-abc12345', 'boost-journal-abc', testJournal);

        expect(cache.saveCache).toHaveBeenCalledWith(
            [expect.stringContaining('boost-journal-')],
            'boost-journal-abc12345',
            {}
        );
    });

    it('handles ReserveCacheError gracefully', async () => {
        const error = new Error('Cache already exists');
        error.name = 'ReserveCacheError';
        (cache.saveCache as jest.Mock).mockRejectedValue(error);

        await expect(saveJournal('test-key', 'test', testJournal)).resolves.toBeUndefined();
    });

    it('handles other errors gracefully', async () => {
        (cache.saveCache as jest.Mock).mockRejectedValue(new Error('unexpected'));

        await expect(saveJournal('test-key', 'test', testJournal)).resolves.toBeUndefined();
    });
});

// ── updateJournal ───────────────────────────────────────────────────

describe('updateJournal', () => {
    it('creates a new journal from scratch when existing is null', () => {
        const newEntries = new Map<string, JournalEntry>([
            ['config', { commitHash: 'abc', directDeps: ['core'] }],
            ['core', { commitHash: 'def', directDeps: [] }]
        ]);
        const allModules = new Set(['config', 'core']);

        const result = updateJournal(null, newEntries, allModules);
        expect(Object.keys(result.entries)).toHaveLength(2);
        expect(result.entries['config'].commitHash).toBe('abc');
        expect(result.entries['core'].directDeps).toEqual([]);
    });

    it('merges new entries over existing', () => {
        const existing: Journal = {
            entries: {
                config: { commitHash: 'old-hash', directDeps: ['core'] },
                core: { commitHash: 'core-hash', directDeps: [] }
            }
        };
        const newEntries = new Map<string, JournalEntry>([
            ['config', { commitHash: 'new-hash', directDeps: ['core', 'assert'] }]
        ]);
        const allModules = new Set(['config', 'core']);

        const result = updateJournal(existing, newEntries, allModules);
        expect(result.entries['config'].commitHash).toBe('new-hash');
        expect(result.entries['config'].directDeps).toEqual(['core', 'assert']);
        expect(result.entries['core'].commitHash).toBe('core-hash');
    });

    it('prunes entries not in the current module closure', () => {
        const existing: Journal = {
            entries: {
                config: { commitHash: 'abc', directDeps: [] },
                stale_module: { commitHash: 'xyz', directDeps: [] }
            }
        };
        const newEntries = new Map<string, JournalEntry>();
        const allModules = new Set(['config']);

        const result = updateJournal(existing, newEntries, allModules);
        expect(Object.keys(result.entries)).toEqual(['config']);
        expect(result.entries['stale_module']).toBeUndefined();
    });

    it('preserves existing entries that are still in the closure', () => {
        const existing: Journal = {
            entries: {
                config: { commitHash: 'abc', directDeps: ['core'] },
                core: { commitHash: 'def', directDeps: [] }
            }
        };
        const newEntries = new Map<string, JournalEntry>();
        const allModules = new Set(['config', 'core', 'assert']);

        const result = updateJournal(existing, newEntries, allModules);
        expect(result.entries['config'].commitHash).toBe('abc');
        expect(result.entries['core'].commitHash).toBe('def');
    });
});
