jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

import { Commit, type Changes } from './types';
import { featureSubjectIcon } from './commit-formatting';
import {
    filterChangesByType,
    compareCommits,
    sortChanges,
    generateOutput
} from './changelog-output';

beforeEach(() => {
    featureSubjectIcon.count = 0;
});

describe('filterChangesByType', () => {
    /**
     * Asserts that `filtered` contains exactly feat and fix (no chore, style, docs).
     *
     * @param filtered - The filtered changes to verify
     */
    function expectOnlyFeatAndFix(filtered: Changes): void {
        expect(Object.keys(filtered)).toHaveLength(2);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).not.toHaveProperty('chore');
        expect(filtered).not.toHaveProperty('style');
        expect(filtered).not.toHaveProperty('docs');
    }

    function createTestChanges(): Changes {
        const featCommit = new Commit();
        featCommit.type = 'feat';
        featCommit.description = 'Add feature';
        featCommit.hash = 'abc1234000000000000000000000000000000000';

        const fixCommit = new Commit();
        fixCommit.type = 'fix';
        fixCommit.description = 'Fix bug';
        fixCommit.hash = 'def5678000000000000000000000000000000000';

        const choreCommit = new Commit();
        choreCommit.type = 'chore';
        choreCommit.description = 'Update deps';
        choreCommit.hash = 'ghi9012000000000000000000000000000000000';

        const styleCommit = new Commit();
        styleCommit.type = 'style';
        styleCommit.description = 'Format code';
        styleCommit.hash = 'jkl3456000000000000000000000000000000000';

        const docsCommit = new Commit();
        docsCommit.type = 'docs';
        docsCommit.description = 'Update readme';
        docsCommit.hash = 'mno7890000000000000000000000000000000000';

        return {
            feat: { 'null': [featCommit] },
            fix: { 'core': [fixCommit] },
            chore: { 'null': [choreCommit] },
            style: { 'null': [styleCommit] },
            docs: { 'null': [docsCommit] }
        };
    }

    it('should include all types when both sets are empty', () => {
        const changes = createTestChanges();
        const filtered = filterChangesByType(changes, new Set(), new Set());

        expect(Object.keys(filtered)).toHaveLength(5);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).toHaveProperty('chore');
        expect(filtered).toHaveProperty('style');
        expect(filtered).toHaveProperty('docs');
    });

    it('should filter to only included types when include set is specified', () => {
        const changes = createTestChanges();
        const filtered = filterChangesByType(
            changes,
            new Set(['feat', 'fix']),
            new Set()
        );

        expectOnlyFeatAndFix(filtered);
    });

    it('should exclude specified types', () => {
        const changes = createTestChanges();
        const filtered = filterChangesByType(
            changes,
            new Set(),
            new Set(['chore', 'style'])
        );

        expect(Object.keys(filtered)).toHaveLength(3);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).toHaveProperty('docs');
        expect(filtered).not.toHaveProperty('chore');
        expect(filtered).not.toHaveProperty('style');
    });

    it('should apply exclude after include', () => {
        const changes = createTestChanges();
        // Include feat, fix, chore; then exclude chore
        const filtered = filterChangesByType(
            changes,
            new Set(['feat', 'fix', 'chore']),
            new Set(['chore'])
        );

        expectOnlyFeatAndFix(filtered);
    });

    it('should handle other type filtering', () => {
        const otherCommit = new Commit();
        otherCommit.type = 'other';
        otherCommit.description = 'Random change';
        otherCommit.hash = 'pqr1234000000000000000000000000000000000';

        const changes = createTestChanges();
        changes.other = { 'null': [otherCommit] };

        const filtered = filterChangesByType(
            changes,
            new Set(),
            new Set(['other'])
        );

        expect(filtered).not.toHaveProperty('other');
        expect(Object.keys(filtered)).toHaveLength(5);
    });

    it('should return empty object when all types are excluded', () => {
        const changes = createTestChanges();
        const filtered = filterChangesByType(
            changes,
            new Set(),
            new Set(['feat', 'fix', 'chore', 'style', 'docs'])
        );

        expect(Object.keys(filtered)).toHaveLength(0);
    });

    it('should return empty object when include set has no matches', () => {
        const changes = createTestChanges();
        const filtered = filterChangesByType(
            changes,
            new Set(['nonexistent']),
            new Set()
        );

        expect(Object.keys(filtered)).toHaveLength(0);
    });
});

describe('compareCommits', () => {
    function createCommit(date: string, linesChanged: number): Commit {
        const commit = new Commit();
        commit.date = date;
        commit.linesChanged = linesChanged;
        return commit;
    }

    it('should sort by latest-first (newest first)', () => {
        const older = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const newer = createCommit('Wed Jan 3 10:00:00 2024 +0000', 5);

        expect(compareCommits(older, newer, 'latest-first')).toBeGreaterThan(0);
        expect(compareCommits(newer, older, 'latest-first')).toBeLessThan(0);
        expect(compareCommits(older, older, 'latest-first')).toBe(0);
    });

    it('should sort by oldest-first', () => {
        const older = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const newer = createCommit('Wed Jan 3 10:00:00 2024 +0000', 5);

        expect(compareCommits(older, newer, 'oldest-first')).toBeLessThan(0);
        expect(compareCommits(newer, older, 'oldest-first')).toBeGreaterThan(0);
    });

    it('should sort by most-changes-first', () => {
        const fewLines = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const manyLines = createCommit('Wed Jan 3 10:00:00 2024 +0000', 100);

        expect(compareCommits(fewLines, manyLines, 'most-changes-first')).toBeGreaterThan(0);
        expect(compareCommits(manyLines, fewLines, 'most-changes-first')).toBeLessThan(0);
    });
});

describe('sortChanges', () => {
    function createCommitWithDateAndLines(date: string, linesChanged: number, description: string): Commit {
        const commit = new Commit();
        commit.date = date;
        commit.linesChanged = linesChanged;
        commit.description = description;
        commit.hash = 'abc1234000000000000000000000000000000000';
        return commit;
    }

    it('should sort commits within each scope by latest-first', () => {
        const commitA = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 10, 'Commit A');
        const commitB = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 5, 'Commit B');
        const commitC = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 15, 'Commit C');

        const changes: Changes = {
            feat: { 'null': [commitA, commitB, commitC] }
        };

        sortChanges(changes, 'latest-first');

        expect(changes.feat['null'][0].description).toBe('Commit B'); // Jan 3 - newest
        expect(changes.feat['null'][1].description).toBe('Commit C'); // Jan 2
        expect(changes.feat['null'][2].description).toBe('Commit A'); // Jan 1 - oldest
    });

    it('should sort commits within each scope by most-changes-first', () => {
        const commitA = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 10, 'Commit A');
        const commitB = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 5, 'Commit B');
        const commitC = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 100, 'Commit C');

        const changes: Changes = {
            feat: { 'null': [commitA, commitB, commitC] }
        };

        sortChanges(changes, 'most-changes-first');

        expect(changes.feat['null'][0].description).toBe('Commit C'); // 100 lines
        expect(changes.feat['null'][1].description).toBe('Commit A'); // 10 lines
        expect(changes.feat['null'][2].description).toBe('Commit B'); // 5 lines
    });

    it('should sort commits in multiple scopes independently', () => {
        const featCommit1 = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 50, 'Feat 1');
        const featCommit2 = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 10, 'Feat 2');
        const fixCommit1 = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 5, 'Fix 1');
        const fixCommit2 = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 20, 'Fix 2');

        const changes: Changes = {
            feat: { 'null': [featCommit1, featCommit2] },
            fix: { 'core': [fixCommit1, fixCommit2] }
        };

        sortChanges(changes, 'most-changes-first');

        // feat scope should be sorted by lines
        expect(changes.feat['null'][0].description).toBe('Feat 1'); // 50 lines
        expect(changes.feat['null'][1].description).toBe('Feat 2'); // 10 lines

        // fix scope should also be sorted by lines
        expect(changes.fix['core'][0].description).toBe('Fix 2'); // 20 lines
        expect(changes.fix['core'][1].description).toBe('Fix 1'); // 5 lines
    });

    it('should sort commits across different scopes within the same type', () => {
        // This tests the fix for the bug where commits in different scopes
        // were not sorted relative to each other
        const scopeACommit = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 50, 'Scope A commit');
        const scopeBCommit = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 100, 'Scope B commit');
        const noScopeCommit = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 75, 'No scope commit');

        // Scopes added in order: scopeA (50), scopeB (100), null (75)
        const changes: Changes = {
            refactor: {
                'scopeA': [scopeACommit],
                'scopeB': [scopeBCommit],
                'null': [noScopeCommit]
            }
        };

        sortChanges(changes, 'most-changes-first');

        // After sorting by most-changes-first, scopes should be reordered
        // so that scopeB (100) comes first, then null (75), then scopeA (50)
        const scopeOrder = Object.keys(changes.refactor);
        expect(scopeOrder[0]).toBe('scopeB'); // 100 lines - should be first
        expect(scopeOrder[1]).toBe('null');   // 75 lines - should be second
        expect(scopeOrder[2]).toBe('scopeA'); // 50 lines - should be third
    });

    it('should handle mixed scopes with multiple commits each', () => {
        const scopeACommit1 = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 100, 'Scope A big');
        const scopeACommit2 = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 20, 'Scope A small');
        const scopeBCommit1 = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 50, 'Scope B medium');
        const scopeBCommit2 = createCommitWithDateAndLines('Thu Jan 4 10:00:00 2024 +0000', 10, 'Scope B tiny');

        const changes: Changes = {
            feat: {
                'scopeA': [scopeACommit1, scopeACommit2],
                'scopeB': [scopeBCommit1, scopeBCommit2]
            }
        };

        sortChanges(changes, 'most-changes-first');

        // After sorting: scopeA (100) first, then scopeB (50), then scopeA (20), then scopeB (10)
        // Since we rebuild the scope map in sorted order, scopeA appears first (has 100-line commit)
        const scopeOrder = Object.keys(changes.feat);
        expect(scopeOrder[0]).toBe('scopeA'); // Has the 100-line commit

        // Within scopeA, commits should be sorted by lines
        expect(changes.feat['scopeA'][0].description).toBe('Scope A big'); // 100 lines
        expect(changes.feat['scopeA'][1].description).toBe('Scope A small'); // 20 lines

        // Within scopeB, commits should be sorted by lines
        expect(changes.feat['scopeB'][0].description).toBe('Scope B medium'); // 50 lines
        expect(changes.feat['scopeB'][1].description).toBe('Scope B tiny'); // 10 lines
    });
});

describe('generateOutput', () => {
    it('should avoid duplicating scope for multiline entries', () => {
        const commitA = new Commit();
        commitA.type = 'docs';
        commitA.scope = 'setup-cmake';
        commitA.description = 'Clarify behavior of check-latest.';
        commitA.hash = '0dae13a0000000000000000000000000000000000';

        const commitB = new Commit();
        commitB.type = 'docs';
        commitB.scope = 'setup-cmake';
        commitB.description = 'Enhance cmake path descriptions.';
        commitB.hash = '6370bd9000000000000000000000000000000000';

        const changes = {
            docs: {
                'setup-cmake': [commitA, commitB]
            }
        };
        const changeTypePriority = ['docs'];
        const args = {
            linkCommits: false,
            thankNonRegular: false
        } as any;
        const authors = {};

        const output = generateOutput(changes, changeTypePriority, args, undefined, authors, null);

        expect(output).toContain('- setup-cmake:\n    - Clarify behavior of check-latest. 0dae13a');
        expect(output).toContain('    - Enhance cmake path descriptions. 6370bd9');
        expect(output).not.toContain('setup-cmake: Clarify behavior of check-latest.');
        expect(output).not.toContain('setup-cmake: Enhance cmake path descriptions.');
    });
});
