jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn()
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn() }
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import axios from 'axios';
import { Commit } from './types';
import {
    getCurrentBranch,
    getGithubRemote,
    processTags,
    populateConventional,
    populateDiffStats,
    removeCommitDuplicates,
    processCommits
} from './git-parsing';

/**
 * Parses a commit message the way the action parses local commits.
 *
 * @param message - Full commit message
 * @returns The populated commit
 */
async function parse(message: string): Promise<Commit> {
    const commit = new Commit();
    commit.hash = 'abc1234000000000000000000000000000000000';
    commit.message = message;
    return populateConventional(commit, undefined, /^v\d+\.\d+\.\d+$/, []);
}

describe('populateConventional', () => {
    it('should keep the lines of a body paragraph', async () => {
        const commit = await parse('fix: subject\n\nline one\nline two\n');
        expect(commit.body).toBe('line one\nline two');
    });

    it('should keep a blank line between body paragraphs', async () => {
        const commit = await parse('fix: subject\n\nfirst\n\n  \nsecond\n');
        expect(commit.body).toBe('first\n\nsecond');
    });

    it('should not add a paragraph break before footers', async () => {
        const commit = await parse('fix: subject\n\nbody\n\nCloses #12\n');
        expect(commit.body).toBe('body');
        expect(commit.footers).toEqual({ 'Closes': '#12' });
    });
});

describe('removeCommitDuplicates', () => {
    it('should separate merged bodies with a paragraph break', async () => {
        const first = await parse('fix: subject\n\nfirst body\n');
        const second = await parse('fix: subject\n\nsecond body\n');
        const merged = removeCommitDuplicates([first, second]);
        expect(merged).toHaveLength(1);
        expect(merged[0].body).toBe('first body\n\nsecond body');
    });

    it('should take the body of a duplicate when the first has none', async () => {
        const first = await parse('fix: subject\n');
        const second = await parse('fix: subject\n\nsecond body\n');
        expect(removeCommitDuplicates([first, second])[0].body).toBe('second body');
    });
});

const mockExec = exec.exec as jest.Mock;
const mockGet = axios.get as jest.Mock;

/** What the fake `git` prints (stdout) and returns (exit code), or an error it throws. */
type GitReply = string | { stdout?: string; exitCode?: number } | Error;

/**
 * Makes exec.exec behave like git, answering each call through a handler.
 *
 * @param handler - Receives the git arguments (and the command) and returns the reply
 */
function fakeGit(handler: (args: string[], cmd: string) => GitReply): void {
    mockExec.mockImplementation(async (cmd: string, args: string[] = [], opts?: { listeners?: { stdout?: (b: Buffer) => void } }) => {
        const reply = handler(args, cmd);
        if (reply instanceof Error) {
            throw reply;
        }
        const { stdout = '', exitCode = 0 } = typeof reply === 'string' ? { stdout: reply } : reply;
        if (stdout) {
            opts?.listeners?.stdout?.(Buffer.from(stdout));
        }
        return exitCode;
    });
}

/** One commit as printed by `git log`. */
interface LogEntry {
    hash: string;
    message: string;
    author?: string;
}

/**
 * Renders commits the way `git --no-pager log` prints them.
 *
 * @param entries - Commits, newest first
 * @returns The log text
 */
function gitLog(entries: LogEntry[]): string {
    return entries.map(e =>
        `commit ${e.hash}\n` +
        `Author: ${e.author ?? 'Alice Doe <alice@example.com>'}\n` +
        'Date:   Mon Jan 1 00:00:00 2024 +0000\n' +
        '\n' +
        e.message.split('\n').map(l => `    ${l}`).join('\n') + '\n\n'
    ).join('');
}

/**
 * Builds an entry of the GitHub "list commits" API response.
 *
 * @param sha - Commit hash
 * @param message - Commit message
 * @param login - GitHub login of the committer, if any
 * @returns The API commit object
 */
function apiCommit(sha: string, message: string, login?: string): object {
    return {
        sha,
        commit: { message, committer: { name: 'Xavier', email: 'x@example.com', date: '2024-01-01T00:00:00Z' } },
        committer: login ? { login } : null
    };
}

const versionPattern = /(Bump|Set)\s+version/;

beforeEach(() => {
    mockExec.mockReset();
    mockGet.mockReset();
    jest.mocked(core.error).mockClear();
    jest.mocked(core.warning).mockClear();
    jest.mocked(core.info).mockClear();
});

describe('getCurrentBranch', () => {
    it('returns the branch without the heads/ prefix', async () => {
        fakeGit(args => {
            expect(args).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
            return 'heads/develop\n';
        });
        await expect(getCurrentBranch('/repo')).resolves.toBe('develop');
        expect(mockExec.mock.calls[0][2].cwd).toBe('/repo');
    });

    it('returns a plain branch name as is', async () => {
        fakeGit(() => 'main\n');
        await expect(getCurrentBranch('/repo')).resolves.toBe('main');
    });

    it('returns null and reports a failing git', async () => {
        fakeGit(() => ({ exitCode: 128 }));
        await expect(getCurrentBranch('/repo')).resolves.toBeNull();
        expect(core.error).toHaveBeenCalledWith('Git command execution failed with exit code 128');

        fakeGit(() => new Error('git not found'));
        await expect(getCurrentBranch('/repo')).resolves.toBeNull();
        expect(core.error).toHaveBeenCalledWith('Error executing Git command: git not found');
    });
});

describe('getGithubRemote', () => {
    it('returns the https GitHub URL of origin without .git', async () => {
        fakeGit((_args, cmd) => {
            expect(cmd).toBe('git remote -v');
            return 'upstream\thttps://github.com/up/r.git (fetch)\n' +
                'origin\thttps://github.com/o/r.git (fetch)\n' +
                'origin\thttps://github.com/o/r.git (push)\n';
        });
        await expect(getGithubRemote('/repo')).resolves.toBe('https://github.com/o/r');
    });

    it('keeps a URL that has no .git suffix', async () => {
        fakeGit(() => 'origin\thttps://github.com/o/r (fetch)\n');
        await expect(getGithubRemote('/repo')).resolves.toBe('https://github.com/o/r');
    });

    it('returns null for a non-https or non-GitHub origin', async () => {
        fakeGit(() => 'origin\tgit@github.com:o/r.git (fetch)\norigin\n');
        await expect(getGithubRemote('/repo')).resolves.toBeNull();
    });

    it('returns null when git fails', async () => {
        fakeGit(() => new Error('not a repo'));
        await expect(getGithubRemote('/repo')).resolves.toBeNull();
        expect(core.error).toHaveBeenCalledWith("Failed to execute 'git remote -v' command: not a repo");
    });
});

describe('processTags', () => {
    it('collects matching local and remote tags without duplicates', async () => {
        fakeGit(args => {
            if (args[0] === 'tag') return 'v1.0.0\nnightly\nv1.1.0\n';
            if (args[0] === 'rev-list') return args[3] === 'v1.0.0' ? 'aaa\n' : 'bbb\n';
            if (args[0] === 'ls-remote') {
                return 'aaa\trefs/tags/v1.0.0\n' +
                    'ccc\trefs/tags/v2.0.0\n' +
                    'ddd\trefs/tags/nightly\n' +
                    'eee\trefs/heads/main\n';
            }
            throw new Error(`unexpected git ${args.join(' ')}`);
        });
        const tags = await processTags('/repo', /^v\d/, 'https://github.com/o/r', '');
        expect(tags).toEqual([
            { name: 'v1.0.0', sha: 'aaa' },
            { name: 'v1.1.0', sha: 'bbb' },
            { name: 'v2.0.0', sha: 'ccc' }
        ]);
        expect(mockExec.mock.calls.filter(c => c[1][0] === 'rev-list')).toHaveLength(2);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('falls back to the GitHub tags when there are no local tags', async () => {
        fakeGit(() => '');
        mockGet.mockImplementation(async (_url: string, config: { params: { page: number } }) => ({
            status: 200,
            data: config.params.page === 1 ? [{ name: 'v3.0.0', commit: { sha: 'fff' } }] : []
        }));
        const tags = await processTags('/repo', /^v\d/, 'https://github.com/o/r', 'tok');
        expect(tags).toEqual([{ name: 'v3.0.0', sha: 'fff' }]);
        expect(mockGet.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/tags');
    });
});

describe('populateConventional (more cases)', () => {
    it('parses type, scope and the ! breaking marker', async () => {
        const commit = await parse('feat(api)!: drop v1 endpoints');
        expect(commit).toMatchObject({
            type: 'feat', scope: 'api', description: 'drop v1 endpoints', breaking: true, conventional: true
        });
    });

    it('treats a non-conventional subject as "other" and detects BREAKING in it', async () => {
        const commit = await parse('Rework everything, BREAKING');
        expect(commit).toMatchObject({
            type: 'other', scope: null, description: 'Rework everything, BREAKING', breaking: true, conventional: false
        });
    });

    it('reads a BREAKING CHANGE footer', async () => {
        const commit = await parse('fix: x\n\nbody\n\nBREAKING CHANGE: removed y\nRefs: #9');
        expect(commit.breaking).toBe(true);
        expect(commit.footers).toEqual({ 'BREAKING CHANGE': 'removed y', 'Refs': '#9' });
        expect(commit.body).toBe('body');
    });

    it('reads a lone "breaking change" footer line', async () => {
        const commit = await parse('fix: x\n\nbody\n\nBreaking Change');
        expect(commit.breaking).toBe(true);
        expect(commit.body).toBe('body');
    });

    it('treats a lone "breaking" line inside the body as a breaking marker', async () => {
        const commit = await parse('fix: x\n\nbreaking\n\nmore text');
        expect(commit.breaking).toBe(true);
        expect(commit.body).toBe('more text');
    });

    it('keeps "key: value" lines that are not in the last paragraph in the body', async () => {
        const commit = await parse('fix: x\n\nobject: the parser\n\nfinal words');
        expect(commit.footers).toEqual({});
        expect(commit.body).toBe('object: the parser\n\nfinal words');
    });

    it('drops the "issue" word and trailing punctuation in "Closes issue #N."', async () => {
        const commit = await parse('fix: x\n\nCloses issue #1146.');
        expect(commit.footers).toEqual({ 'Closes': '#1146' });
        expect(commit.issue).toBe('1146');
        expect(commit.ghIssueUsername).toBeNull();
    });

    it('looks up the issue author when the repository URL is known', async () => {
        mockGet.mockResolvedValue({ status: 200, data: { user: { login: 'reporter' } } });
        const commit = new Commit();
        commit.hash = 'abc';
        commit.message = 'fix: x\n\nFixes: #7';
        await populateConventional(commit, 'https://github.com/o/r', versionPattern, []);
        expect(commit.issue).toBe('7');
        expect(commit.ghIssueUsername).toBe('reporter');
        expect(mockGet.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r/issues/7');
    });

    it('does not take a non-issue footer value as the issue', async () => {
        const commit = await parse('fix: x\n\nFixes: the build\nSee #8');
        expect(commit.issue).toBeNull();
        expect(commit.footers).toEqual({ 'Fixes': 'the build', 'See': '#8' });
    });

    it('collects #tags and takes the type of an unconventional commit from them', async () => {
        const commit = await parse('Update the readme\n\n#unknown-tag\n  #docs  \n\nmore');
        expect(commit.tags).toEqual(['unknown-tag', 'docs']);
        expect(commit.type).toBe('docs');
        expect(commit.body).toBe('more');
    });

    it('keeps "other" when no #tag is a valid type', async () => {
        const commit = await parse('Update the readme\n\n#whatever');
        expect(commit.type).toBe('other');
    });

    it('marks a commit with a matching git tag as the parent release', async () => {
        const commit = new Commit();
        commit.hash = 'deadbeef00';
        commit.message = 'fix: x';
        await populateConventional(commit, undefined, versionPattern, [
            { name: 'v0.9.0', sha: 'other' },
            { name: 'v1.0.0', sha: 'deadbeef00' }
        ]);
        expect(commit.tag).toBe('v1.0.0');
        expect(commit.isParentRelease).toBe(true);
        expect(core.info).toHaveBeenCalledWith('Stopping at commit id deadbeef (tag v1.0.0)');
    });

    it('marks a release from the description or, failing that, the subject', async () => {
        const fromDescription = await parse('chore: v1.2.3');
        expect(fromDescription.isParentRelease).toBe(true);
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('(description: v1.2.3)'));

        const commit = new Commit();
        commit.hash = 'abc';
        commit.message = 'release: 1.2.3';
        await populateConventional(commit, undefined, /^release:/, []);
        expect(commit.description).toBe('1.2.3');
        expect(commit.isParentRelease).toBe(true);
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('(subject: release: 1.2.3)'));

        const normal = await parse('fix: nothing to see');
        expect(normal.isParentRelease).toBe(false);
    });
});

describe('removeCommitDuplicates (merging)', () => {
    it('merges footers, tags, breaking and hashes into the first commit', async () => {
        const first = await parse('fix(io): same\n\nbody\n\nRefs: #1');
        first.hash = 'h1';
        first.tags = ['a'];
        const second = await parse('fix(io): same\n\nbody\n\nRefs: #2\nSee: docs');
        second.hash = 'h2';
        second.tags = ['a', 'b'];
        second.breaking = true;
        const third = await parse('fix(io): same');
        third.hash = null;
        const other = await parse('fix(net): same');

        const merged = removeCommitDuplicates([first, second, other, third]);
        expect(merged).toEqual([first, other]);
        expect(first.body).toBe('body');
        expect(first.footers).toEqual({ 'Refs': '#1', 'See': 'docs' });
        expect(first.tags).toEqual(['a', 'b']);
        expect(first.breaking).toBe(true);
        expect(first.extraHashes).toEqual(['h2']);
    });
});

describe('populateDiffStats', () => {
    it('sums added and deleted lines, ignoring binary files', async () => {
        fakeGit(args => {
            expect(args.slice(0, 3)).toEqual(['show', '--numstat', '--format=']);
            return args[3] === 'h1'
                ? '10\t2\tsrc/a.ts\n-\t-\timg.png\n3\t0\tsrc/b.ts\n'
                : '1\t1\tREADME.md\n';
        });
        const c1 = Object.assign(new Commit(), { hash: 'h1' });
        const c2 = Object.assign(new Commit(), { hash: 'h2' });
        const noHash = new Commit();
        await populateDiffStats('/repo', [c1, noHash, c2]);
        expect(c1).toMatchObject({ linesAdded: 13, linesDeleted: 2, linesChanged: 15 });
        expect(c2).toMatchObject({ linesAdded: 1, linesDeleted: 1, linesChanged: 2 });
        expect(noHash.linesChanged).toBe(0);
        expect(mockExec).toHaveBeenCalledTimes(2);
    });

    it('leaves the stats at zero when git fails', async () => {
        fakeGit(() => new Error('bad object'));
        const c1 = Object.assign(new Commit(), { hash: 'h1' });
        await populateDiffStats('/repo', [c1]);
        expect(c1.linesChanged).toBe(0);
    });
});

describe('processCommits', () => {
    it('parses the local log up to the release commit', async () => {
        fakeGit(args => {
            expect(args).toEqual(['--no-pager', 'log']);
            return gitLog([
                { hash: 'a1', message: 'feat: new thing\n\nIt is new.', author: 'Bob Roe <bob@example.com>' },
                { hash: 'b2', message: '[ci] details only' },
                { hash: 'c3', message: 'fix(core): broken thing' },
                { hash: 'd4', message: 'chore: Bump version to 1.0.0' },
                { hash: 'e5', message: 'feat: older than the release' },
                { hash: 'f6', message: 'feat: oldest' }
            ]);
        });
        const commits = await processCommits('/repo', undefined, versionPattern, [], 'main', '', 'warn');
        expect(commits.map(c => c.hash)).toEqual(['a1', 'c3', 'd4']);
        expect(commits[0]).toMatchObject({
            author: 'Bob Roe <bob@example.com>',
            authorName: 'Bob Roe',
            authorEmail: 'bob@example.com',
            date: '  Mon Jan 1 00:00:00 2024 +0000',
            message: 'feat: new thing\n\nIt is new.',
            body: 'It is new.'
        });
        expect(commits[2].isParentRelease).toBe(true);
        expect(mockGet).not.toHaveBeenCalled();
        expect(core.warning).not.toHaveBeenCalled();
    });

    it('never stops at the first commit even if it looks like a release', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'chore: Set version 2.0.0' },
            { hash: 'b2', message: 'fix: y' },
            { hash: 'c3', message: 'chore: Set version 1.0.0' },
            { hash: 'd4', message: 'fix: z' }
        ]));
        const commits = await processCommits('/repo', undefined, versionPattern, [], undefined, '', 'false');
        expect(commits.map(c => [c.hash, c.isParentRelease])).toEqual([['a1', false], ['b2', false], ['c3', true]]);
    });

    it('keeps an author line without an email as the author', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'fix: x', author: 'nobody' },
            { hash: 'b2', message: 'chore: Bump version 1' },
            { hash: 'c3', message: 'fix: z' }
        ]));
        const [first] = await processCommits('/repo', undefined, versionPattern, [], undefined, '', 'false');
        expect(first).toMatchObject({ author: 'nobody', authorName: null, authorEmail: null });
    });

    it('fails on an unconventional commit in "error" mode', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'update the readme' },
            { hash: 'b2', message: 'chore: Bump version 1' },
            { hash: 'c3', message: 'fix: z' }
        ]));
        await expect(processCommits('/repo', undefined, versionPattern, [], undefined, '', 'error'))
            .rejects.toThrow('Commit "update the readme" is not a conventional commit');
    });

    it('warns with a count when several commits are unconventional', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'update the readme' },
            { hash: 'b2', message: 'tweak things' },
            { hash: 'c3', message: 'chore: Bump version 1' },
            { hash: 'd4', message: 'fix: z' }
        ]));
        await processCommits('/repo', undefined, versionPattern, [], undefined, '', 'warn');
        expect(core.warning).toHaveBeenCalledWith('2 unconventional commits', { title: 'Conventional Commits' });
    });

    it('does not check unconventional commits in "false" mode', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'update the readme' },
            { hash: 'b2', message: 'chore: Bump version 1' },
            { hash: 'c3', message: 'fix: z' }
        ]));
        await processCommits('/repo', undefined, versionPattern, [], undefined, '', 'false');
        expect(core.warning).not.toHaveBeenCalled();
    });

    it('does not query GitHub without a repository URL or a branch', async () => {
        fakeGit(() => '');
        await expect(processCommits('/repo', undefined, versionPattern, [], 'main', '', 'false')).resolves.toEqual([]);
        await expect(processCommits('/repo', 'https://github.com/o/r', versionPattern, [], undefined, '', 'false')).resolves.toEqual([]);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('completes the history from the GitHub API when no local release is found', async () => {
        fakeGit(() => gitLog([
            { hash: 'a1', message: 'feat: local' },
            { hash: 'b2', message: 'fix: local too' }
        ]));
        mockGet.mockImplementation(async (url: string, config?: { headers: Record<string, string>; params?: { page: number } }) => {
            if (url === 'https://api.github.com/users/xavier') {
                return { status: 200, data: { name: 'Xavier X.' } };
            }
            expect(url).toBe('https://api.github.com/repos/o/r/commits');
            expect(config?.headers).toMatchObject({ sha: 'main', Authorization: 'Bearer tok' });
            if (config?.params?.page === 1) {
                return { status: 200, data: [apiCommit('a1', 'feat: local'), apiCommit('x1', 'fix: remote', 'xavier')] };
            }
            return {
                status: 200, data: [
                    apiCommit('y2', '[docs] detail'),
                    apiCommit('z3', 'chore: Set version 0.9'),
                    apiCommit('w4', 'fix: never reached')
                ]
            };
        });
        const commits = await processCommits('/repo', 'https://github.com/o/r', versionPattern, [], 'main', 'tok', 'false');
        expect(commits.map(c => c.hash)).toEqual(['a1', 'x1', 'z3']);
        expect(commits[1]).toMatchObject({
            author: 'Xavier <x@example.com>',
            authorName: 'Xavier',
            authorEmail: 'x@example.com',
            ghUsername: 'xavier',
            ghName: 'Xavier X.',
            date: '2024-01-01T00:00:00Z',
            type: 'fix'
        });
        expect(commits[2].isParentRelease).toBe(true);
        expect(mockGet.mock.calls.filter(c => c[0].endsWith('/commits'))).toHaveLength(2);
    });

    it('stops at an empty API page and sends no token when there is none', async () => {
        fakeGit(() => '');
        mockGet.mockImplementation(async (_url: string, config: { headers: Record<string, string>; params: { page: number } }) => {
            expect(config.headers.Authorization).toBeUndefined();
            return { status: 200, data: config.params.page === 1 ? [apiCommit('r1', 'fix: remote')] : [] };
        });
        const commits = await processCommits('/repo', 'https://github.com/o/r', versionPattern, [], 'main', '', 'false');
        expect(commits.map(c => c.hash)).toEqual(['r1']);
    });

    it('keeps the commits fetched so far when the API fails', async () => {
        fakeGit(() => '');
        mockGet.mockResolvedValueOnce({ status: 200, data: [apiCommit('r1', 'fix: remote')] });
        mockGet.mockResolvedValueOnce({ status: 403, statusText: 'Forbidden', data: [] });
        await expect(processCommits('/repo', 'https://github.com/o/r', versionPattern, [], 'main', '', 'false'))
            .resolves.toHaveLength(1);
        expect(core.error).toHaveBeenCalledWith('Error: 403 - Forbidden');

        mockGet.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, statusText: 'Server Error' } }));
        await expect(processCommits('/repo', 'https://github.com/o/r', versionPattern, [], 'main', '', 'false'))
            .resolves.toEqual([]);
        expect(core.error).toHaveBeenCalledWith('Error: 500 - Server Error');

        mockGet.mockRejectedValueOnce(new Error('offline'));
        await expect(processCommits('/repo', 'https://github.com/o/r', versionPattern, [], 'main', '', 'false'))
            .resolves.toEqual([]);
        expect(core.error).toHaveBeenCalledWith('Error: offline');
    });
});
