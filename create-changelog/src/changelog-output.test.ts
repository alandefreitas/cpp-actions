jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('fs', () => ({
    writeFileSync: jest.fn()
}));

import * as fs from 'fs';
import * as path from 'path';
import { Commit, GitHubUser, type Changes } from './types';
import { featureSubjectIcon } from './commit-formatting';
import {
    identifyNonRegularContributors,
    filterChangesByType,
    compareCommits,
    sortChanges,
    categorizeCommits,
    generateOutput,
    writeChangelog
} from './changelog-output';

const mockWriteFileSync = fs.writeFileSync as jest.Mock;

beforeEach(() => {
    featureSubjectIcon.count = 0;
    jest.clearAllMocks();
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

describe('identifyNonRegularContributors', () => {
    it('should mark admin/affiliated/owner as regular', () => {
        const authors: Record<string, GitHubUser> = {};
        const admin = new GitHubUser();
        admin.username = 'admin';
        admin.isAdmin = true;
        admin.commits = 1;
        authors['admin'] = admin;

        const affiliated = new GitHubUser();
        affiliated.username = 'affiliated';
        affiliated.isAffiliated = true;
        affiliated.commits = 1;
        authors['affiliated'] = affiliated;

        const owner = new GitHubUser();
        owner.username = 'owner';
        owner.isOwner = true;
        owner.commits = 1;
        authors['owner'] = owner;

        identifyNonRegularContributors(authors);

        expect(authors['admin'].isRegular).toBe(true);
        expect(authors['affiliated'].isRegular).toBe(true);
        expect(authors['owner'].isRegular).toBe(true);
    });

    it('should mark contributors with few commits as non-regular', () => {
        const authors: Record<string, GitHubUser> = {};

        const main = new GitHubUser();
        main.username = 'main';
        main.commits = 100;
        authors['main'] = main;

        const small = new GitHubUser();
        small.username = 'small';
        small.commits = 2;
        authors['small'] = small;

        identifyNonRegularContributors(authors);

        expect(authors['small'].isRegular).toBe(false);
    });

    it('should mark contributors below 80th percentile as non-regular', () => {
        const authors: Record<string, GitHubUser> = {};

        for (let i = 0; i < 10; i++) {
            const user = new GitHubUser();
            user.username = `user${i}`;
            user.commits = 50 + i * 10;
            authors[`user${i}`] = user;
        }

        const lowContrib = new GitHubUser();
        lowContrib.username = 'low';
        lowContrib.commits = 4;
        authors['low'] = lowContrib;

        identifyNonRegularContributors(authors);

        expect(authors['low'].isRegular).toBe(false);
    });

    it('should mark high-commit contributors as regular', () => {
        const authors: Record<string, GitHubUser> = {};

        const topUser = new GitHubUser();
        topUser.username = 'top';
        topUser.commits = 100;
        authors['top'] = topUser;

        const anotherTop = new GitHubUser();
        anotherTop.username = 'top2';
        anotherTop.commits = 100;
        authors['top2'] = anotherTop;

        identifyNonRegularContributors(authors);

        expect(authors['top'].isRegular).toBe(true);
        expect(authors['top2'].isRegular).toBe(true);
    });

    it('should handle empty authors', () => {
        const authors: Record<string, GitHubUser> = {};
        identifyNonRegularContributors(authors);
        expect(Object.keys(authors)).toHaveLength(0);
    });

    it('should mark user with 3 or fewer commits as non-regular even if above 10%', () => {
        // 2 users: main has 20 commits, small has 3 commits
        // small has 3/23 = 13% of commits (passes 10% threshold)
        // but has <= 3 commits, so still non-regular
        const authors: Record<string, GitHubUser> = {};

        const mainUser = new GitHubUser();
        mainUser.username = 'main';
        mainUser.commits = 20;
        authors['main'] = mainUser;

        const smallUser = new GitHubUser();
        smallUser.username = 'small';
        smallUser.commits = 3;
        authors['small'] = smallUser;

        identifyNonRegularContributors(authors);

        expect(authors['small'].isRegular).toBe(false);
    });

    it('should handle single author', () => {
        const authors: Record<string, GitHubUser> = {};
        const user = new GitHubUser();
        user.username = 'solo';
        user.commits = 10;
        authors['solo'] = user;

        identifyNonRegularContributors(authors);

        expect(authors['solo'].isRegular).toBe(true);
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

    it('should return 0 for unknown sort option', () => {
        const a = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const b = createCommit('Wed Jan 3 10:00:00 2024 +0000', 100);

        expect(compareCommits(a, b, 'unknown' as any)).toBe(0);
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

        expect(changes.feat['null'][0].description).toBe('Commit B');
        expect(changes.feat['null'][1].description).toBe('Commit C');
        expect(changes.feat['null'][2].description).toBe('Commit A');
    });

    it('should sort commits within each scope by most-changes-first', () => {
        const commitA = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 10, 'Commit A');
        const commitB = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 5, 'Commit B');
        const commitC = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 100, 'Commit C');

        const changes: Changes = {
            feat: { 'null': [commitA, commitB, commitC] }
        };

        sortChanges(changes, 'most-changes-first');

        expect(changes.feat['null'][0].description).toBe('Commit C');
        expect(changes.feat['null'][1].description).toBe('Commit A');
        expect(changes.feat['null'][2].description).toBe('Commit B');
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

        expect(changes.feat['null'][0].description).toBe('Feat 1');
        expect(changes.feat['null'][1].description).toBe('Feat 2');

        expect(changes.fix['core'][0].description).toBe('Fix 2');
        expect(changes.fix['core'][1].description).toBe('Fix 1');
    });

    it('should sort commits across different scopes within the same type', () => {
        const scopeACommit = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 50, 'Scope A commit');
        const scopeBCommit = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 100, 'Scope B commit');
        const noScopeCommit = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 75, 'No scope commit');

        const changes: Changes = {
            refactor: {
                'scopeA': [scopeACommit],
                'scopeB': [scopeBCommit],
                'null': [noScopeCommit]
            }
        };

        sortChanges(changes, 'most-changes-first');

        const scopeOrder = Object.keys(changes.refactor);
        expect(scopeOrder[0]).toBe('scopeB');
        expect(scopeOrder[1]).toBe('null');
        expect(scopeOrder[2]).toBe('scopeA');
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

        const scopeOrder = Object.keys(changes.feat);
        expect(scopeOrder[0]).toBe('scopeA');

        expect(changes.feat['scopeA'][0].description).toBe('Scope A big');
        expect(changes.feat['scopeA'][1].description).toBe('Scope A small');

        expect(changes.feat['scopeB'][0].description).toBe('Scope B medium');
        expect(changes.feat['scopeB'][1].description).toBe('Scope B tiny');
    });
});

describe('categorizeCommits', () => {
    it('should categorize commits by type and scope', () => {
        const feat = new Commit();
        feat.type = 'feat';
        feat.scope = 'core';
        feat.description = 'Add feature';

        const fix = new Commit();
        fix.type = 'fix';
        fix.scope = 'api';
        fix.description = 'Fix bug';

        const result = categorizeCommits([feat, fix]);

        expect(result.changes).toHaveProperty('feat');
        expect(result.changes).toHaveProperty('fix');
        expect(result.changes.feat['core']).toHaveLength(1);
        expect(result.changes.fix['api']).toHaveLength(1);
    });

    it('should use "other" type for commits without type', () => {
        const commit = new Commit();
        commit.description = 'Random change';

        const result = categorizeCommits([commit]);

        expect(result.changes).toHaveProperty('other');
        expect(result.changes.other['null']).toHaveLength(1);
    });

    it('should use "null" scope for commits without scope', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'No scope';

        const result = categorizeCommits([commit]);

        expect(result.changes.feat['null']).toHaveLength(1);
    });

    it('should extract parentRelease commit', () => {
        const release = new Commit();
        release.isParentRelease = true;
        release.tag = 'v1.0.0';
        release.hash = 'abc1234000000000000000000000000000000000';

        const feat = new Commit();
        feat.type = 'feat';
        feat.description = 'After release';

        const result = categorizeCommits([feat, release]);

        expect(result.parentRelease).not.toBeNull();
        expect(result.parentRelease!.tag).toBe('v1.0.0');
    });

    it('should include standard types in changeTypePriority', () => {
        const commit = new Commit();
        commit.type = 'feat';

        const result = categorizeCommits([commit]);

        expect(result.changeTypePriority).toContain('feat');
        expect(result.changeTypePriority).toContain('fix');
        expect(result.changeTypePriority).toContain('other');
    });

    it('should add unknown types to changeTypePriority', () => {
        const commit = new Commit();
        commit.type = 'custom';
        commit.description = 'Custom type';

        const result = categorizeCommits([commit]);

        expect(result.changeTypePriority).toContain('custom');
        expect(result.changeTypePriority).toContain('other');
    });

    it('should return null parentRelease when no release commit exists', () => {
        const commit = new Commit();
        commit.type = 'feat';

        const result = categorizeCommits([commit]);

        expect(result.parentRelease).toBeNull();
    });
});

describe('generateOutput', () => {
    /**
     * Creates a basic args object for generateOutput tests.
     *
     * @param overrides - Properties to override
     * @returns Test args object
     */
    function makeArgs(overrides: Partial<{ linkCommits: boolean; thankNonRegular: boolean }> = {}): any {
        return {
            linkCommits: false,
            thankNonRegular: false,
            ...overrides
        };
    }

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

        const output = generateOutput(changes, changeTypePriority, makeArgs(), undefined, {}, null);

        expect(output).toContain('- setup-cmake:\n    - Clarify behavior of check-latest. 0dae13a');
        expect(output).toContain('    - Enhance cmake path descriptions. 6370bd9');
        expect(output).not.toContain('setup-cmake: Clarify behavior of check-latest.');
        expect(output).not.toContain('setup-cmake: Enhance cmake path descriptions.');
    });

    it('should generate section title with icon and humanized type', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Add feature';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('## 🚀 Features');
    });

    it('should add type description under section title', () => {
        const commit = new Commit();
        commit.type = 'fix';
        commit.description = 'Fix a bug';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { fix: { 'null': [commit] }, feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['fix', 'feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('Bug fixes and error corrections');
    });

    it('should add breaking indicator', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Breaking change';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.breaking = true;

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('🚨 BREAKING');
    });

    it('should add body as footnote', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Add feature';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.body = 'This is a detailed description of the feature.';

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('[^1]');
        expect(output).toContain('[^1]: This is a detailed description of the feature.');
    });

    it('should include footer keys', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Add feature';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.footers = { 'Closes': '#123', 'Refs': 'some-ref' };

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('Closes #123');
        expect(output).toContain('Refs: some-ref');
    });

    it('should JSON.stringify non-string footer values', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Feature';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.footers = { 'Data': ['a', 'b'] as any };

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('Data: ["a","b"]');
    });

    it('should link commits when linkCommits is true', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Add feature';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const repoUrl = 'https://github.com/owner/repo';
        const output = generateOutput(changes, ['feat'], makeArgs({ linkCommits: true }), repoUrl, {}, null);

        expect(output).toContain(`[abc1234](${repoUrl}/commit/${commit.hash})`);
    });

    it('should include extra hashes', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Squashed';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.extraHashes = ['def5678000000000000000000000000000000000'];

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('abc1234');
        expect(output).toContain('def5678');
    });

    it('should thank non-regular contributors when enabled', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'External contribution';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.ghUsername = 'external-user';

        const authors: Record<string, GitHubUser> = {};
        const user = new GitHubUser();
        user.username = 'external-user';
        user.isRegular = false;
        authors['external-user'] = user;

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs({ thankNonRegular: true }), undefined, authors, null);

        expect(output).toContain('(thanks @external-user)');
    });

    it('should thank issue username if different from commit username', () => {
        const commit = new Commit();
        commit.type = 'fix';
        commit.description = 'Fix reported bug';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.ghUsername = 'fixer';
        commit.ghIssueUsername = 'reporter';

        const authors: Record<string, GitHubUser> = {};
        const fixer = new GitHubUser();
        fixer.username = 'fixer';
        fixer.isRegular = false;
        authors['fixer'] = fixer;

        const reporter = new GitHubUser();
        reporter.username = 'reporter';
        reporter.isRegular = false;
        authors['reporter'] = reporter;

        const changes: Changes = { fix: { 'null': [commit] } };
        const output = generateOutput(changes, ['fix'], makeArgs({ thankNonRegular: true }), undefined, authors, null);

        expect(output).toContain('(thanks @fixer, @reporter)');
    });

    it('should not thank regular contributors', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Internal feature';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.ghUsername = 'regular-user';

        const authors: Record<string, GitHubUser> = {};
        const user = new GitHubUser();
        user.username = 'regular-user';
        user.isRegular = true;
        authors['regular-user'] = user;

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs({ thankNonRegular: true }), undefined, authors, null);

        expect(output).not.toContain('thanks');
    });

    it('should include parent release with repo URL', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'New feature';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const parentRelease = new Commit();
        parentRelease.tag = 'v1.0.0';
        parentRelease.hash = 'def5678000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const repoUrl = 'https://github.com/owner/repo';
        const output = generateOutput(changes, ['feat'], makeArgs(), repoUrl, {}, parentRelease);

        expect(output).toContain('Parent release:');
        expect(output).toContain(`[v1.0.0](${repoUrl}/releases/tag/v1.0.0)`);
        expect(output).toContain('def5678');
    });

    it('should include parent release without repo URL', () => {
        const parentRelease = new Commit();
        parentRelease.tag = 'v1.0.0';
        parentRelease.hash = 'def5678000000000000000000000000000000000';

        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Feature';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), null as any, {}, parentRelease);

        expect(output).toContain('Parent release:');
        expect(output).toContain('v1.0.0');
    });

    it('should show scope prefix for single-commit scopes', () => {
        const commit = new Commit();
        commit.type = 'fix';
        commit.scope = 'api';
        commit.description = 'Fix endpoint';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { fix: { 'api': [commit] } };
        const output = generateOutput(changes, ['fix'], makeArgs(), undefined, {}, null);

        expect(output).toContain('- api: Fix endpoint.');
    });

    it('should add feature subject icons for feat commits', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Feature one';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['feat'], makeArgs(), undefined, {}, null);

        expect(output).toContain('✨');
    });

    it('should skip section header when only "other" type with single type', () => {
        const commit = new Commit();
        commit.type = 'other';
        commit.description = 'Random';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { other: { 'null': [commit] } };
        const output = generateOutput(changes, ['other'], makeArgs(), undefined, {}, null);

        expect(output).not.toContain('## ');
    });

    it('should skip types not in changes from the priority list', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Only feature';
        commit.hash = 'abc1234000000000000000000000000000000000';

        const changes: Changes = { feat: { 'null': [commit] } };
        const output = generateOutput(changes, ['fix', 'feat'], makeArgs(), undefined, {}, null);

        expect(output).not.toContain('Fixes');
        expect(output).toContain('Features');
    });

    it('should add newline between sections', () => {
        const feat = new Commit();
        feat.type = 'feat';
        feat.description = 'Feature';
        feat.hash = 'abc1234000000000000000000000000000000000';

        const fix = new Commit();
        fix.type = 'fix';
        fix.description = 'Bug fix';
        fix.hash = 'def5678000000000000000000000000000000000';

        const changes: Changes = {
            feat: { 'null': [feat] },
            fix: { 'null': [fix] }
        };
        const output = generateOutput(changes, ['feat', 'fix'], makeArgs(), undefined, {}, null);

        expect(output).toContain('Features');
        expect(output).toContain('Fixes');
    });

    it('should handle linked commits with extra hashes', () => {
        const commit = new Commit();
        commit.type = 'feat';
        commit.description = 'Squashed';
        commit.hash = 'abc1234000000000000000000000000000000000';
        commit.extraHashes = ['def5678000000000000000000000000000000000'];

        const changes: Changes = { feat: { 'null': [commit] } };
        const repoUrl = 'https://github.com/owner/repo';
        const output = generateOutput(changes, ['feat'], makeArgs({ linkCommits: true }), repoUrl, {}, null);

        expect(output).toContain(`[abc1234](${repoUrl}/commit/${commit.hash})`);
        expect(output).toContain(`[def5678](${repoUrl}/commit/def5678000000000000000000000000000000000)`);
    });
});

describe('writeChangelog', () => {
    it('should write content to file at resolved path', () => {
        writeChangelog('output/CHANGELOG.md', '# Changelog\n');

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            path.resolve('output/CHANGELOG.md'),
            '# Changelog\n'
        );
    });

    it('should handle absolute paths', () => {
        writeChangelog('/tmp/CHANGELOG.md', 'content');

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            path.resolve('/tmp/CHANGELOG.md'),
            'content'
        );
    });
});
