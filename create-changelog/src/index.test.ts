import * as main from './index';

beforeEach(() => {
    main.featureSubjectIcon.count = 0;
});

describe('filterChangesByType', () => {
    function createTestChanges(): main.Changes {
        const featCommit = new main.Commit();
        featCommit.type = 'feat';
        featCommit.description = 'Add feature';
        featCommit.hash = 'abc1234000000000000000000000000000000000';

        const fixCommit = new main.Commit();
        fixCommit.type = 'fix';
        fixCommit.description = 'Fix bug';
        fixCommit.hash = 'def5678000000000000000000000000000000000';

        const choreCommit = new main.Commit();
        choreCommit.type = 'chore';
        choreCommit.description = 'Update deps';
        choreCommit.hash = 'ghi9012000000000000000000000000000000000';

        const styleCommit = new main.Commit();
        styleCommit.type = 'style';
        styleCommit.description = 'Format code';
        styleCommit.hash = 'jkl3456000000000000000000000000000000000';

        const docsCommit = new main.Commit();
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
        const filtered = main.filterChangesByType(changes, new Set(), new Set());

        expect(Object.keys(filtered)).toHaveLength(5);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).toHaveProperty('chore');
        expect(filtered).toHaveProperty('style');
        expect(filtered).toHaveProperty('docs');
    });

    it('should filter to only included types when include set is specified', () => {
        const changes = createTestChanges();
        const filtered = main.filterChangesByType(
            changes,
            new Set(['feat', 'fix']),
            new Set()
        );

        expect(Object.keys(filtered)).toHaveLength(2);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).not.toHaveProperty('chore');
        expect(filtered).not.toHaveProperty('style');
        expect(filtered).not.toHaveProperty('docs');
    });

    it('should exclude specified types', () => {
        const changes = createTestChanges();
        const filtered = main.filterChangesByType(
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
        const filtered = main.filterChangesByType(
            changes,
            new Set(['feat', 'fix', 'chore']),
            new Set(['chore'])
        );

        expect(Object.keys(filtered)).toHaveLength(2);
        expect(filtered).toHaveProperty('feat');
        expect(filtered).toHaveProperty('fix');
        expect(filtered).not.toHaveProperty('chore');
        expect(filtered).not.toHaveProperty('style');
        expect(filtered).not.toHaveProperty('docs');
    });

    it('should handle other type filtering', () => {
        const otherCommit = new main.Commit();
        otherCommit.type = 'other';
        otherCommit.description = 'Random change';
        otherCommit.hash = 'pqr1234000000000000000000000000000000000';

        const changes = createTestChanges();
        changes.other = { 'null': [otherCommit] };

        const filtered = main.filterChangesByType(
            changes,
            new Set(),
            new Set(['other'])
        );

        expect(filtered).not.toHaveProperty('other');
        expect(Object.keys(filtered)).toHaveLength(5);
    });

    it('should return empty object when all types are excluded', () => {
        const changes = createTestChanges();
        const filtered = main.filterChangesByType(
            changes,
            new Set(),
            new Set(['feat', 'fix', 'chore', 'style', 'docs'])
        );

        expect(Object.keys(filtered)).toHaveLength(0);
    });

    it('should return empty object when include set has no matches', () => {
        const changes = createTestChanges();
        const filtered = main.filterChangesByType(
            changes,
            new Set(['nonexistent']),
            new Set()
        );

        expect(Object.keys(filtered)).toHaveLength(0);
    });
});

describe('parseSortByOption', () => {
    it('should parse valid sort options', () => {
        expect(main.parseSortByOption('most-changes-first')).toBe('most-changes-first');
        expect(main.parseSortByOption('latest-first')).toBe('latest-first');
        expect(main.parseSortByOption('oldest-first')).toBe('oldest-first');
    });

    it('should handle case insensitivity', () => {
        expect(main.parseSortByOption('LATEST-FIRST')).toBe('latest-first');
        expect(main.parseSortByOption('MOST-CHANGES-FIRST')).toBe('most-changes-first');
    });

    it('should default to most-changes-first for invalid values', () => {
        expect(main.parseSortByOption('invalid')).toBe('most-changes-first');
        expect(main.parseSortByOption('')).toBe('most-changes-first');
        expect(main.parseSortByOption('  ')).toBe('most-changes-first');
    });
});

describe('compareCommits', () => {
    function createCommit(date: string, linesChanged: number): main.Commit {
        const commit = new main.Commit();
        commit.date = date;
        commit.lines_changed = linesChanged;
        return commit;
    }

    it('should sort by latest-first (newest first)', () => {
        const older = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const newer = createCommit('Wed Jan 3 10:00:00 2024 +0000', 5);

        expect(main.compareCommits(older, newer, 'latest-first')).toBeGreaterThan(0);
        expect(main.compareCommits(newer, older, 'latest-first')).toBeLessThan(0);
        expect(main.compareCommits(older, older, 'latest-first')).toBe(0);
    });

    it('should sort by oldest-first', () => {
        const older = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const newer = createCommit('Wed Jan 3 10:00:00 2024 +0000', 5);

        expect(main.compareCommits(older, newer, 'oldest-first')).toBeLessThan(0);
        expect(main.compareCommits(newer, older, 'oldest-first')).toBeGreaterThan(0);
    });

    it('should sort by most-changes-first', () => {
        const fewLines = createCommit('Mon Jan 1 10:00:00 2024 +0000', 10);
        const manyLines = createCommit('Wed Jan 3 10:00:00 2024 +0000', 100);

        expect(main.compareCommits(fewLines, manyLines, 'most-changes-first')).toBeGreaterThan(0);
        expect(main.compareCommits(manyLines, fewLines, 'most-changes-first')).toBeLessThan(0);
    });
});

describe('sortChanges', () => {
    function createCommitWithDateAndLines(date: string, linesChanged: number, description: string): main.Commit {
        const commit = new main.Commit();
        commit.date = date;
        commit.lines_changed = linesChanged;
        commit.description = description;
        commit.hash = 'abc1234000000000000000000000000000000000';
        return commit;
    }

    it('should sort commits within each scope by latest-first', () => {
        const commitA = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 10, 'Commit A');
        const commitB = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 5, 'Commit B');
        const commitC = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 15, 'Commit C');

        const changes: main.Changes = {
            feat: { 'null': [commitA, commitB, commitC] }
        };

        main.sortChanges(changes, 'latest-first');

        expect(changes.feat['null'][0].description).toBe('Commit B'); // Jan 3 - newest
        expect(changes.feat['null'][1].description).toBe('Commit C'); // Jan 2
        expect(changes.feat['null'][2].description).toBe('Commit A'); // Jan 1 - oldest
    });

    it('should sort commits within each scope by most-changes-first', () => {
        const commitA = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 10, 'Commit A');
        const commitB = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 5, 'Commit B');
        const commitC = createCommitWithDateAndLines('Tue Jan 2 10:00:00 2024 +0000', 100, 'Commit C');

        const changes: main.Changes = {
            feat: { 'null': [commitA, commitB, commitC] }
        };

        main.sortChanges(changes, 'most-changes-first');

        expect(changes.feat['null'][0].description).toBe('Commit C'); // 100 lines
        expect(changes.feat['null'][1].description).toBe('Commit A'); // 10 lines
        expect(changes.feat['null'][2].description).toBe('Commit B'); // 5 lines
    });

    it('should sort commits in multiple scopes independently', () => {
        const featCommit1 = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 50, 'Feat 1');
        const featCommit2 = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 10, 'Feat 2');
        const fixCommit1 = createCommitWithDateAndLines('Mon Jan 1 10:00:00 2024 +0000', 5, 'Fix 1');
        const fixCommit2 = createCommitWithDateAndLines('Wed Jan 3 10:00:00 2024 +0000', 20, 'Fix 2');

        const changes: main.Changes = {
            feat: { 'null': [featCommit1, featCommit2] },
            fix: { 'core': [fixCommit1, fixCommit2] }
        };

        main.sortChanges(changes, 'most-changes-first');

        // feat scope should be sorted by lines
        expect(changes.feat['null'][0].description).toBe('Feat 1'); // 50 lines
        expect(changes.feat['null'][1].description).toBe('Feat 2'); // 10 lines

        // fix scope should also be sorted by lines
        expect(changes.fix['core'][0].description).toBe('Fix 2'); // 20 lines
        expect(changes.fix['core'][1].description).toBe('Fix 1'); // 5 lines
    });
});

test('generateOutput avoids duplicating scope for multiline entries', () => {
    const commitA = new main.Commit();
    commitA.type = 'docs';
    commitA.scope = 'setup-cmake';
    commitA.description = 'Clarify behavior of check-latest.';
    commitA.hash = '0dae13a0000000000000000000000000000000000';

    const commitB = new main.Commit();
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
        link_commits: false,
        thank_non_regular: false
    } as any;
    const authors = {};

    const output = main.generateOutput(changes, changeTypePriority, args, undefined, authors, null);

    expect(output).toContain('- setup-cmake:\n    - Clarify behavior of check-latest. 0dae13a');
    expect(output).toContain('    - Enhance cmake path descriptions. 6370bd9');
    expect(output).not.toContain('setup-cmake: Clarify behavior of check-latest.');
    expect(output).not.toContain('setup-cmake: Enhance cmake path descriptions.');
});

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>;
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                };
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message);
                        mockCore.setFailed(error.message);
                    },
                    __mockCore: mockCore
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors');

            runPromise = prettyErrors.reportAndSetFailed(new Error('changelog boom'), { title: 'Create changelog failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('changelog boom');
            });
        });

        await runPromise!;
    });
});
