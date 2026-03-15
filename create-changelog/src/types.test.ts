import { parseSortByOption, parseCheckUnconventionalMode, Commit, GitHubUser } from './types';

describe('parseSortByOption', () => {
    it('should parse valid sort options', () => {
        expect(parseSortByOption('most-changes-first')).toBe('most-changes-first');
        expect(parseSortByOption('latest-first')).toBe('latest-first');
        expect(parseSortByOption('oldest-first')).toBe('oldest-first');
    });

    it('should handle case insensitivity', () => {
        expect(parseSortByOption('LATEST-FIRST')).toBe('latest-first');
        expect(parseSortByOption('MOST-CHANGES-FIRST')).toBe('most-changes-first');
    });

    it('should default to most-changes-first for invalid values', () => {
        expect(parseSortByOption('invalid')).toBe('most-changes-first');
        expect(parseSortByOption('')).toBe('most-changes-first');
        expect(parseSortByOption('  ')).toBe('most-changes-first');
    });
});

describe('parseCheckUnconventionalMode', () => {
    it('should parse "false" as false mode', () => {
        expect(parseCheckUnconventionalMode('false')).toBe('false');
        expect(parseCheckUnconventionalMode('FALSE')).toBe('false');
    });

    it('should parse "error" as error mode', () => {
        expect(parseCheckUnconventionalMode('error')).toBe('error');
        expect(parseCheckUnconventionalMode('ERROR')).toBe('error');
    });

    it('should default to warn for "true", "warn", or other values', () => {
        expect(parseCheckUnconventionalMode('true')).toBe('warn');
        expect(parseCheckUnconventionalMode('warn')).toBe('warn');
        expect(parseCheckUnconventionalMode('anything')).toBe('warn');
    });
});

describe('Commit', () => {
    it('should have correct default values', () => {
        const c = new Commit();
        expect(c.hash).toBeNull();
        expect(c.extraHashes).toEqual([]);
        expect(c.type).toBeNull();
        expect(c.scope).toBeNull();
        expect(c.breaking).toBe(false);
        expect(c.conventional).toBe(true);
        expect(c.isParentRelease).toBe(false);
        expect(c.linesChanged).toBe(0);
        expect(c.footers).toEqual({});
        expect(c.tags).toEqual([]);
        expect(c.body).toBe('');
        expect(c.message).toBe('');
    });
});

describe('GitHubUser', () => {
    it('should have correct default values', () => {
        const u = new GitHubUser();
        expect(u.username).toBeNull();
        expect(u.name).toBeNull();
        expect(u.commits).toBe(0);
        expect(u.commitsPerc).toBe(0);
        expect(u.isOwner).toBe(false);
        expect(u.isAdmin).toBe(false);
        expect(u.isAffiliated).toBe(false);
        expect(u.isRegular).toBe(true);
    });
});
