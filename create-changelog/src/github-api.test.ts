jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn() }
}));

import axios from 'axios';
import { Commit } from './types';
import {
    getGithubRepoOwner,
    getGithubRepoName,
    getIssueAuthor,
    getGithubTags,
    getGithubProfileName,
    getGithubUsername,
    populateGithubUsernames,
    checkGithubAdminPermissions,
    checkUserInstitution,
    populateIssueData
} from './github-api';

const mockGet = axios.get as jest.Mock;

/** A fake axios response or error for one URL. */
type Reply = { status?: number; statusText?: string; data?: unknown } | Error;

/**
 * Makes axios.get answer each request from a table keyed by URL.
 *
 * A URL missing from the table rejects with a "404" style error.
 *
 * @param routes - Map of URL to the response (or error) to return
 */
function route(routes: Record<string, Reply | ((params?: { page: number }) => Reply)>): void {
    mockGet.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
        const entry = routes[url];
        if (entry === undefined) {
            throw new Error(`unexpected url ${url}`);
        }
        const reply = typeof entry === 'function' ? entry(config?.params) : entry;
        if (reply instanceof Error) {
            throw reply;
        }
        return { status: 200, statusText: 'OK', ...reply };
    });
}

/**
 * Builds a commit with the GitHub identity fields set.
 *
 * @param fields - Fields to set on the commit
 * @returns The commit
 */
function makeCommit(fields: Partial<Commit>): Commit {
    return Object.assign(new Commit(), fields);
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
    mockGet.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleError.mockRestore();
});

describe('getGithubRepoOwner / getGithubRepoName', () => {
    it('extract owner and name from https and http URLs', () => {
        expect(getGithubRepoOwner('https://github.com/boostorg/url')).toBe('boostorg');
        expect(getGithubRepoName('https://github.com/boostorg/url')).toBe('url');
        expect(getGithubRepoOwner('http://github.com/boostorg/url')).toBe('boostorg');
        expect(getGithubRepoName('github.com/boostorg/url')).toBe('url');
    });

    it('return null for empty, non-GitHub or incomplete URLs', () => {
        expect(getGithubRepoOwner(undefined)).toBeNull();
        expect(getGithubRepoName('')).toBeNull();
        expect(getGithubRepoOwner('https://gitlab.com/a/b')).toBeNull();
        expect(getGithubRepoName('https://gitlab.com/a/b')).toBeNull();
        expect(getGithubRepoName('https://github.com/owner')).toBeNull();
    });
});

describe('getIssueAuthor', () => {
    it('returns the login of the issue author and sends the token', async () => {
        route({ 'https://api.github.com/repos/o/r/issues/12': { data: { user: { login: 'alice' } } } });
        await expect(getIssueAuthor('https://github.com/o/r/', '12', 'tok')).resolves.toBe('alice');
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('omits the Authorization header without a token', async () => {
        route({ 'https://api.github.com/repos/o/r/issues/12': { data: { user: { login: 'alice' } } } });
        await getIssueAuthor('https://github.com/o/r', '12', '');
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBeUndefined();
    });

    it('returns null on a non-200 status or a request error', async () => {
        route({ 'https://api.github.com/repos/o/r/issues/1': { status: 304 } });
        await expect(getIssueAuthor('https://github.com/o/r', '1', '')).resolves.toBeNull();

        route({});
        await expect(getIssueAuthor('https://github.com/o/r', '2', '')).resolves.toBeNull();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error fetching issue author'));
    });
});

describe('getGithubTags', () => {
    const url = 'https://api.github.com/repos/o/r/tags';

    it('returns [] without a repository URL', async () => {
        await expect(getGithubTags(undefined, /.*/, '')).resolves.toEqual([]);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('collects matching tags across pages until an empty page', async () => {
        route({
            [url]: (params) => ({
                data: params?.page === 1
                    ? [{ name: 'v1.0.0', commit: { sha: 'a' } }, { name: 'nightly', commit: { sha: 'b' } }]
                    : params?.page === 2 ? [{ name: 'v1.1.0', commit: { sha: 'c' } }] : []
            })
        });
        const tags = await getGithubTags('https://github.com/o/r', /^v/, 'tok');
        expect(tags).toEqual([{ name: 'v1.0.0', sha: 'a' }, { name: 'v1.1.0', sha: 'c' }]);
        expect(mockGet).toHaveBeenCalledTimes(3);
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('stops and keeps what it has on a non-200 status', async () => {
        route({ [url]: { status: 403, statusText: 'Forbidden', data: [] } });
        await expect(getGithubTags('https://github.com/o/r', /.*/, '')).resolves.toEqual([]);
        expect(consoleError).toHaveBeenCalledWith('Error: 403 - Forbidden');
    });

    it('reports HTTP errors and network errors', async () => {
        const httpError = Object.assign(new Error('boom'), { response: { status: 500, statusText: 'Server Error' } });
        route({ [url]: httpError });
        await expect(getGithubTags('https://github.com/o/r', /.*/, '')).resolves.toEqual([]);
        expect(consoleError).toHaveBeenCalledWith('Error: 500 - Server Error');

        route({ [url]: new Error('offline') });
        await expect(getGithubTags('https://github.com/o/r', /.*/, '')).resolves.toEqual([]);
        expect(consoleError).toHaveBeenCalledWith('Error: offline');
    });
});

describe('getGithubProfileName', () => {
    const url = 'https://api.github.com/users/alice';

    it('returns the profile name', async () => {
        route({ [url]: { data: { name: 'Alice A.' } } });
        await expect(getGithubProfileName('alice', 'tok')).resolves.toBe('Alice A.');
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('returns null when the profile has no name, on non-200, or on error', async () => {
        route({ [url]: { data: { name: null } } });
        await expect(getGithubProfileName('alice', '')).resolves.toBeNull();
        route({ [url]: { status: 404 } });
        await expect(getGithubProfileName('alice', '')).resolves.toBeNull();
        route({});
        await expect(getGithubProfileName('alice', '')).resolves.toBeNull();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error fetching GitHub profile name'));
    });
});

describe('getGithubUsername', () => {
    const url = 'https://api.github.com/search/users?q=a%2Bb%40x.com+in:email';

    it('returns the first login found for an email (URL-encoded)', async () => {
        route({ [url]: { data: { items: [{ login: 'ab' }, { login: 'other' }] } } });
        await expect(getGithubUsername('a+b@x.com', 'tok')).resolves.toBe('ab');
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('returns null with no results, on non-200, or on error', async () => {
        route({ [url]: { data: { items: [] } } });
        await expect(getGithubUsername('a+b@x.com', '')).resolves.toBeNull();
        route({ [url]: { status: 500 } });
        await expect(getGithubUsername('a+b@x.com', '')).resolves.toBeNull();
        route({});
        await expect(getGithubUsername('a+b@x.com', '')).resolves.toBeNull();
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error fetching GitHub username'));
    });
});

describe('populateGithubUsernames', () => {
    it('propagates a known username to commits with the same email', async () => {
        route({ 'https://api.github.com/users/alice': { data: { name: 'Alice' } } });
        const known = makeCommit({ ghUsername: 'alice', authorEmail: 'alice@x.com' });
        const sameEmail = makeCommit({ authorEmail: 'alice@x.com' });
        await populateGithubUsernames([known, sameEmail], '');
        expect(known.ghName).toBe('Alice');
        expect(sameEmail).toMatchObject({ ghUsername: 'alice', ghName: 'Alice' });
    });

    it('does not look up the profile when the commit already has a name', async () => {
        const known = makeCommit({ ghUsername: 'alice', ghName: 'Alice', authorEmail: 'a@x.com' });
        await populateGithubUsernames([known], '');
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('leaves the username alone when the profile has no name', async () => {
        route({ 'https://api.github.com/users/alice': { data: { name: '' } } });
        const known = makeCommit({ ghUsername: 'alice', authorEmail: 'a@x.com' });
        const other = makeCommit({ authorEmail: 'a@x.com', ghUsername: 'kept' });
        await populateGithubUsernames([known, other], '');
        expect(known.ghName).toBeNull();
        expect(other.ghUsername).toBe('kept');
    });

    it('searches by email for commits without a username', async () => {
        route({
            'https://api.github.com/search/users?q=bob%40x.com+in:email': { data: { items: [{ login: 'bob' }] } },
            'https://api.github.com/users/bob': { data: { name: 'Bob' } },
            'https://api.github.com/search/users?q=nobody%40x.com+in:email': { data: { items: [] } },
            'https://api.github.com/search/users?q=noname%40x.com+in:email': { data: { items: [{ login: 'noname' }] } },
            'https://api.github.com/users/noname': { data: {} }
        });
        const bob1 = makeCommit({ authorEmail: 'bob@x.com' });
        const bob2 = makeCommit({ authorEmail: 'bob@x.com' });
        const nobody = makeCommit({ authorEmail: 'nobody@x.com' });
        const noname = makeCommit({ authorEmail: 'noname@x.com' });
        const noEmail = makeCommit({});
        await populateGithubUsernames([bob1, bob2, nobody, noname, noEmail], '');
        expect(bob1).toMatchObject({ ghUsername: 'bob', ghName: 'Bob' });
        expect(bob2).toMatchObject({ ghUsername: 'bob', ghName: 'Bob' });
        expect(nobody.ghUsername).toBeNull();
        expect(noname.ghUsername).toBeNull();
        expect(noEmail.ghUsername).toBeNull();
        // bob is searched once: bob2 already has the username when the loop reaches it
        const searches = mockGet.mock.calls.filter(c => (c[0] as string).includes('bob%40x.com'));
        expect(searches).toHaveLength(1);
    });
});

describe('checkGithubAdminPermissions', () => {
    const url = 'https://api.github.com/repos/o/r/collaborators/alice/permission';

    it('is true only for the admin permission', async () => {
        route({ [url]: { data: { permission: 'admin' } } });
        await expect(checkGithubAdminPermissions('https://github.com/o/r/', 'alice', 'tok')).resolves.toBe(true);
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');

        route({ [url]: { data: { permission: 'write' } } });
        await expect(checkGithubAdminPermissions('https://github.com/o/r', 'alice', '')).resolves.toBe(false);

        route({ [url]: { status: 204 } });
        await expect(checkGithubAdminPermissions('https://github.com/o/r', 'alice', '')).resolves.toBe(false);
    });

    it('is false when the request fails', async () => {
        route({});
        await expect(checkGithubAdminPermissions('https://github.com/o/r', 'alice', '')).resolves.toBe(false);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error checking GitHub admin permissions'));
    });
});

describe('checkUserInstitution', () => {
    const userUrl = 'https://api.github.com/users/alice';
    const orgsUrl = 'https://api.github.com/users/alice/orgs';

    it('is true when the repository owner is one of the user orgs (paged)', async () => {
        route({
            [userUrl]: { data: { organizations_url: orgsUrl } },
            [`${orgsUrl}?page=1&perPage=100`]: { data: [{ login: 'acme' }] },
            [`${orgsUrl}?page=2&perPage=100`]: { data: [{ login: 'o' }] },
            [`${orgsUrl}?page=3&perPage=100`]: { data: [] }
        });
        await expect(checkUserInstitution('https://github.com/o/r', 'alice', 'tok')).resolves.toBe(true);
        expect(mockGet.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('is false when the owner is not in the orgs', async () => {
        route({
            [userUrl]: { data: { organizations_url: orgsUrl } },
            [`${orgsUrl}?page=1&perPage=100`]: { data: [{ login: 'acme' }] },
            [`${orgsUrl}?page=2&perPage=100`]: { status: 500 }
        });
        await expect(checkUserInstitution('https://github.com/o/r', 'alice', '')).resolves.toBe(false);
        expect(mockGet.mock.calls[0][1].headers).toEqual({});
    });

    it('is false on a non-200 user response or a request error', async () => {
        route({ [userUrl]: { status: 404 } });
        await expect(checkUserInstitution('https://github.com/o/r', 'alice', '')).resolves.toBe(false);
        route({});
        await expect(checkUserInstitution('https://github.com/o/r', 'alice', '')).resolves.toBe(false);
        expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Error checking user institution'));
    });
});

describe('populateIssueData', () => {
    it('returns no authors without a repository URL', async () => {
        await expect(populateIssueData([makeCommit({ ghUsername: 'a' })], undefined, 'o', '')).resolves.toEqual({});
        expect(mockGet).not.toHaveBeenCalled();
    });

    it('counts commits per author and adds issue reporters', async () => {
        route({
            'https://api.github.com/repos/o/r/collaborators/o/permission': { data: { permission: 'admin' } },
            'https://api.github.com/repos/o/r/collaborators/bob/permission': { data: { permission: 'read' } },
            'https://api.github.com/repos/o/r/collaborators/carol/permission': { data: { permission: 'read' } },
            'https://api.github.com/users/o': { data: { name: 'Owner', organizations_url: 'https://api.github.com/users/o/orgs' } },
            'https://api.github.com/users/o/orgs?page=1&perPage=100': { data: [] },
            'https://api.github.com/users/bob': { data: { organizations_url: 'https://api.github.com/users/bob/orgs' } },
            'https://api.github.com/users/bob/orgs?page=1&perPage=100': { data: [{ login: 'o' }] },
            'https://api.github.com/users/bob/orgs?page=2&perPage=100': { data: [] },
            'https://api.github.com/users/carol': { data: { name: 'Carol', organizations_url: 'https://api.github.com/users/carol/orgs' } },
            'https://api.github.com/users/carol/orgs?page=1&perPage=100': { data: [] }
        });
        const commits = [
            makeCommit({ ghUsername: 'o', ghName: 'Owner' }),
            makeCommit({ ghUsername: 'o', ghName: 'Owner', ghIssueUsername: 'carol' }),
            makeCommit({ ghUsername: 'bob', ghName: 'Bob', ghIssueUsername: 'carol' }),
            makeCommit({ ghIssueUsername: 'o' })
        ];
        const authors = await populateIssueData(commits, 'https://github.com/o/r', 'o', '');

        expect(Object.keys(authors).sort()).toEqual(['bob', 'carol', 'o']);
        expect(authors.o).toMatchObject({ username: 'o', name: 'Owner', commits: 2, commitsPerc: 0.5, isOwner: true, isAdmin: true, isAffiliated: false });
        expect(authors.bob).toMatchObject({ commits: 1, commitsPerc: 0.25, isOwner: false, isAdmin: false, isAffiliated: true });
        expect(authors.carol).toMatchObject({ name: 'Carol', commits: 0, commitsPerc: 0, isOwner: false, isAdmin: false });
    });

    it('marks an issue reporter who owns the repository', async () => {
        route({
            'https://api.github.com/users/o': { data: { name: 'Owner', organizations_url: 'https://api.github.com/users/o/orgs' } },
            'https://api.github.com/users/o/orgs?page=1&perPage=100': { data: [] },
            'https://api.github.com/repos/o/r/collaborators/o/permission': { data: { permission: 'admin' } }
        });
        const authors = await populateIssueData([makeCommit({ ghIssueUsername: 'o' })], 'https://github.com/o/r', 'o', '');
        expect(authors.o).toMatchObject({ name: 'Owner', commits: 0, isOwner: true, isAdmin: true });
    });
});
