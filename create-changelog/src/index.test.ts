jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    summary: {
        addRaw: jest.fn().mockReturnThis(),
        write: jest.fn().mockResolvedValue({})
    }
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
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('action-schema', () => ({
    ...jest.requireActual('action-schema'),
    runAction: jest.fn()
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import axios from 'axios';
import { runAction } from 'action-schema';
import { describePrettyErrors } from 'pretty-errors/test-helper';
import * as index from './index';
import { main, inputsSchema, outputsSchema } from './index';
import * as types from './types';
import * as commitFormatting from './commit-formatting';
import * as changelogOutput from './changelog-output';
import type { Inputs } from './schema';

const mockExec = exec.exec as jest.Mock;
const mockGet = axios.get as jest.Mock;
const mockAddRaw = core.summary.addRaw as jest.Mock;
const mockWrite = core.summary.write as jest.Mock;

/** Options captured from the runAction call made when index.ts was loaded. */
const runActionOptions = (runAction as jest.Mock).mock.calls[0][0];

/** One commit as printed by `git log`. */
interface LogEntry {
    hash: string;
    message: string;
    author: string;
}

/**
 * Renders commits the way `git --no-pager log` prints them.
 *
 * @param entries - Commits, newest first
 * @returns The log text
 */
function gitLog(entries: LogEntry[]): string {
    return entries.map(e =>
        `commit ${e.hash}\nAuthor: ${e.author}\nDate:   Mon Jan 1 00:00:00 2024 +0000\n\n` +
        e.message.split('\n').map(l => `    ${l}`).join('\n') + '\n\n'
    ).join('');
}

const alice = 'Alice Doe <alice@example.com>';
const bob = 'Bob Roe <bob@example.com>';

const log = gitLog([
    { hash: 'a1a1a1a1a1', message: 'feat(api): add widgets', author: alice },
    { hash: 'b2b2b2b2b2', message: 'fix: crash on start\n\nThe init order was wrong.', author: bob },
    { hash: 'c3c3c3c3c3', message: 'chore: tidy up', author: alice },
    { hash: 'rel0rel0rel', message: 'fix: last fix of 1.0', author: alice },
    { hash: 'old0old0old', message: 'feat: before the release', author: alice }
]);

/** Lines changed per commit, as `git show --numstat` would print. */
const numstat: Record<string, string> = {
    'a1a1a1a1a1': '1\t0\ta.ts\n',
    'b2b2b2b2b2': '50\t10\tb.ts\n'
};

/**
 * Makes exec.exec answer git commands for a small repository.
 *
 * @param remote - Output of `git remote -v`
 */
function fakeGit(remote: string): void {
    mockExec.mockImplementation(async (cmd: string, args: string[] = [], opts?: { listeners?: { stdout?: (b: Buffer) => void } }) => {
        let out = '';
        if (cmd === 'git remote -v') out = remote;
        else if (args[0] === 'rev-parse') out = 'heads/local-branch\n';
        else if (args[0] === 'tag') out = 'v1.0.0\n';
        else if (args[0] === 'rev-list') out = 'rel0rel0rel\n';
        else if (args[0] === 'ls-remote') out = '';
        else if (args[1] === 'log') out = log;
        else if (args[0] === 'show') out = numstat[args[3]] ?? '';
        else throw new Error(`unexpected git ${cmd} ${args.join(' ')}`);
        if (out) opts?.listeners?.stdout?.(Buffer.from(out));
        return 0;
    });
}

/**
 * Makes axios.get answer the GitHub API: alice is a known admin; everything else fails.
 */
function fakeGithub(): void {
    mockGet.mockImplementation(async (url: string) => {
        const routes: Record<string, unknown> = {
            'https://api.github.com/search/users?q=alice%40example.com+in:email': { items: [{ login: 'alice' }] },
            'https://api.github.com/users/alice': { name: 'Alice Doe', organizations_url: 'https://api.github.com/users/alice/orgs' },
            'https://api.github.com/users/alice/orgs?page=1&perPage=100': [],
            'https://api.github.com/repos/o/r/collaborators/alice/permission': { permission: 'admin' }
        };
        if (!(url in routes)) {
            throw new Error(`offline: ${url}`);
        }
        return { status: 200, data: routes[url] };
    });
}

let tmpDir: string;
let consoleError: jest.SpyInstance;
const savedEnv = { ...process.env };

/**
 * Builds the inputs of a run that writes into the temporary directory.
 *
 * @param overrides - Inputs to change
 * @returns Complete inputs
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        sourceDir: tmpDir,
        versionPattern: /(Bump|Set)\s+version/,
        tagPattern: /^v\d+\.\d+\.\d+$/,
        outputPath: path.join(tmpDir, 'CHANGELOG.md'),
        limit: 0,
        thankNonRegular: true,
        checkUnconventional: 'warn',
        linkCommits: false,
        githubToken: '',
        updateSummary: false,
        includeTypes: new Set<string>(),
        excludeTypes: new Set(['chore', 'style']),
        sortBy: 'most-changes-first',
        ...overrides
    } as Inputs;
}

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-changelog-test-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    mockExec.mockReset();
    mockGet.mockReset();
    mockAddRaw.mockClear();
    mockWrite.mockReset();
    mockWrite.mockResolvedValue({});
    jest.mocked(core.info).mockClear();
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_TOKEN;
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    process.env = { ...savedEnv };
    consoleError.mockRestore();
});

describe('main', () => {
    it('writes the changelog of the commits since the last tag', async () => {
        process.env.GITHUB_REF_NAME = 'develop';
        process.env.GITHUB_TOKEN = 'env-token';
        fakeGit('origin\thttps://github.com/o/r.git (fetch)\n');
        fakeGithub();
        const inputs = makeInputs({ updateSummary: true });

        await main(inputs);

        const changelog = fs.readFileSync(inputs.outputPath, 'utf8');
        // The chore commit is excluded and the tagged commit ends the list
        expect(changelog).toBe(
            '## 🚀 Features\n\n' +
            'New features and additions\n\n' +
            '- ✨ api: Add widgets. a1a1a1a\n' +
            '\n## 🐛 Fixes\n\n' +
            'Bug fixes and error corrections\n\n' +
            '- Crash on start.[^1] b2b2b2b\n' +
            '\n> Parent release: [v1.0.0](https://github.com/o/r/releases/tag/v1.0.0) rel0rel\n' +
            '\n[^1]: The init order was wrong.\n');
        // alice is a regular contributor (admin); bob has no GitHub account found
        expect(changelog).not.toContain('thanks');

        expect(core.info).toHaveBeenCalledWith('Repository Branch develop from GITHUB_REF_NAME');
        expect(core.info).toHaveBeenCalledWith('Access token **** from GITHUB_TOKEN');
        expect(mockExec.mock.calls.some(c => c[1]?.[0] === 'rev-parse')).toBe(false);
        expect(mockExec.mock.calls.filter(c => c[1]?.[0] === 'show').map(c => c[1][3]))
            .toEqual(['a1a1a1a1a1', 'b2b2b2b2b2', 'c3c3c3c3c3', 'rel0rel0rel']);
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer env-token');

        expect(mockAddRaw).toHaveBeenCalledWith(`# Changelog\n\n${changelog}`);
        expect(mockWrite).toHaveBeenCalled();
    });

    it('prefers GITHUB_BASE_REF and the explicit token', async () => {
        process.env.GITHUB_BASE_REF = 'main';
        process.env.GITHUB_REF_NAME = 'refs/pull/1/merge';
        process.env.GITHUB_TOKEN = 'env-token';
        fakeGit('origin\thttps://github.com/o/r.git (fetch)\n');
        fakeGithub();

        await main(makeInputs({ githubToken: 'input-token', sortBy: 'latest-first' }));

        expect(core.info).toHaveBeenCalledWith('Repository Branch main from GITHUB_BASE_REF');
        expect(core.info).not.toHaveBeenCalledWith('Access token **** from GITHUB_TOKEN');
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer input-token');
        expect(mockExec.mock.calls.some(c => c[1]?.[0] === 'show')).toBe(false);
        expect(mockAddRaw).not.toHaveBeenCalled();
    });

    it('takes the branch from git, applies the limit and the type filters', async () => {
        fakeGit('origin\tgit@github.com:o/r.git (fetch)\n');
        mockGet.mockRejectedValue(new Error('offline'));
        const inputs = makeInputs({
            limit: 2,
            sortBy: 'oldest-first',
            includeTypes: new Set(['fix']),
            excludeTypes: new Set()
        });

        await main(inputs);

        expect(core.info).toHaveBeenCalledWith('Repository Branch local-branch from local path');
        expect(core.info).toHaveBeenCalledWith('Limited to 2 commits');
        const changelog = fs.readFileSync(inputs.outputPath, 'utf8');
        expect(changelog).toContain('Crash on start');
        expect(changelog).not.toContain('Add widgets');
        expect(changelog).not.toContain('Parent release');
        // no GitHub remote: only the per-email user search is attempted
        expect(mockGet.mock.calls.every(c => (c[0] as string).includes('/search/users'))).toBe(true);
    });

    it('works without any branch', async () => {
        mockExec.mockImplementation(async (_cmd: string, args: string[] = []) => (args[0] === 'rev-parse' ? 1 : 0));
        const inputs = makeInputs({ sortBy: 'latest-first' });
        await main(inputs);
        expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('Repository Branch'));
        expect(fs.readFileSync(inputs.outputPath, 'utf8')).toBe('');
    });

    it('fails with a clear error when the summary cannot be written', async () => {
        fakeGit('');
        mockGet.mockRejectedValue(new Error('offline'));
        mockWrite.mockRejectedValue(new Error('disk full'));
        await expect(main(makeInputs({ updateSummary: true, sortBy: 'latest-first' })))
            .rejects.toThrow('Failed to write summary: disk full');
    });
});

describe('action entry point', () => {
    it('registers the schemas and a main that runs the pipeline', async () => {
        expect(runActionOptions).toMatchObject({ title: 'Create Changelog', inputsSchema, outputsSchema });
        fakeGit('');
        mockGet.mockRejectedValue(new Error('offline'));
        const inputs = makeInputs({ sortBy: 'latest-first' });
        await expect(runActionOptions.main(inputs)).resolves.toEqual({});
        expect(fs.existsSync(inputs.outputPath)).toBe(true);
    });
});

describe('re-exports', () => {
    it('exposes the types and helpers of the internal modules', () => {
        expect(index.Commit).toBe(types.Commit);
        expect(index.GitHubUser).toBe(types.GitHubUser);
        expect(index.parseSortByOption).toBe(types.parseSortByOption);
        expect(index.featureSubjectIcon).toBe(commitFormatting.featureSubjectIcon);
        expect(index.filterChangesByType).toBe(changelogOutput.filterChangesByType);
        expect(index.compareCommits).toBe(changelogOutput.compareCommits);
        expect(index.sortChanges).toBe(changelogOutput.sortChanges);
        expect(index.generateOutput).toBe(changelogOutput.generateOutput);
    });
});

describePrettyErrors('changelog boom', 'Create changelog failed');
