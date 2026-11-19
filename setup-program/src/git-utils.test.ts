jest.mock('@actions/io', () => ({
    which: jest.fn(),
    rmRF: jest.fn(),
    mkdirP: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('package-install', () => ({
    updateAptPackageLists: jest.fn(),
    installProgramWithApt: jest.fn(),
    findProgramWithApt: jest.fn()
}));

jest.mock('./utils', () => ({
    sleep: jest.fn()
}));

jest.mock('./version-cache', () => ({
    readVersionsFromFile: jest.fn(),
    saveVersionsToFile: jest.fn()
}));

import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as packageInstall from 'package-install';
import { ExpectedError } from 'pretty-errors';

import { sleep } from './utils';
import { readVersionsFromFile, saveVersionsToFile } from './version-cache';
import {
    findGit,
    fetchGitTags,
    findVersionsFromTags,
    findGCCVersions,
    findClangVersions,
    findCMakeVersions,
    cloneGitRepo
} from './git-utils';

const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockRmRF = io.rmRF as jest.MockedFunction<typeof io.rmRF>;
const mockMkdirP = io.mkdirP as jest.MockedFunction<typeof io.mkdirP>;
const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockUpdateApt = packageInstall.updateAptPackageLists as jest.Mock;
const mockInstallWithApt = packageInstall.installProgramWithApt as jest.Mock;
const mockFindWithApt = packageInstall.findProgramWithApt as jest.Mock;
const mockSleep = sleep as jest.MockedFunction<typeof sleep>;
const mockReadVersions = readVersionsFromFile as jest.MockedFunction<typeof readVersionsFromFile>;
const mockSaveVersions = saveVersionsToFile as jest.MockedFunction<typeof saveVersionsToFile>;

const GIT = '/usr/bin/git';

/**
 * Builds `git ls-remote --tags` output from a list of refs.
 *
 * @param refs - Tag refs to include
 * @returns Output text with one `<sha>\t<ref>` line per ref
 */
function lsRemote(refs: string[]): string {
    return refs.map((ref, i) => `${String(i).padStart(40, '0')}\t${ref}`).join('\n') + '\n';
}

beforeEach(() => {
    jest.resetAllMocks();
    mockSleep.mockResolvedValue(undefined);
    mockExec.mockResolvedValue(0);
});

describe('findGit', () => {
    it('returns the git path found in PATH without touching APT', async () => {
        mockWhich.mockResolvedValue(GIT);
        await expect(findGit()).resolves.toBe(GIT);
        expect(mockUpdateApt).not.toHaveBeenCalled();
        expect(mockInstallWithApt).not.toHaveBeenCalled();
    });

    it('installs git with APT when it is not in PATH', async () => {
        mockWhich.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(GIT);
        await expect(findGit()).resolves.toBe(GIT);
        expect(mockUpdateApt).toHaveBeenCalledTimes(1);
        expect(mockInstallWithApt).toHaveBeenCalledWith('git', null, [], { tryAptitude: false, tryAlternatives: false });
    });

    it('installs git with APT when which returns an empty string', async () => {
        mockWhich.mockResolvedValueOnce('').mockResolvedValueOnce(GIT);
        await expect(findGit()).resolves.toBe(GIT);
        expect(mockInstallWithApt).toHaveBeenCalled();
    });

    it('returns null when git is still missing after the APT install', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        await expect(findGit()).resolves.toBeNull();
    });

    it('returns null when which keeps returning an empty string', async () => {
        mockWhich.mockResolvedValue('');
        await expect(findGit()).resolves.toBeNull();
    });
});

describe('fetchGitTags', () => {
    it('parses ls-remote output, skipping peeled refs and malformed lines', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: lsRemote(['refs/tags/v1.0.0', 'refs/tags/v1.0.0^{}', 'refs/tags/v2.0.0']) + 'garbage-line\n',
            stderr: ''
        });

        const tags = await fetchGitTags('https://example.com/repo.git');

        expect(tags).toEqual(['refs/tags/v1.0.0', 'refs/tags/v2.0.0']);
        expect(mockGetExecOutput).toHaveBeenCalledWith(`"${GIT}"`, ['ls-remote', '--tags', 'https://example.com/repo.git'], { silent: true });
    });

    it('retries with exponential backoff and succeeds on a later attempt', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput
            .mockResolvedValueOnce({ exitCode: 128, stdout: '', stderr: 'network' })
            .mockRejectedValueOnce('string failure')
            .mockResolvedValueOnce({ exitCode: 0, stdout: lsRemote(['refs/tags/v3.0.0']), stderr: '' });

        const tags = await fetchGitTags('repo', { maxRetries: 5 });

        expect(tags).toEqual(['refs/tags/v3.0.0']);
        expect(mockSleep.mock.calls).toEqual([[1000], [2000]]);
    });

    it('caps the backoff delay at 60 seconds', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });

        await expect(fetchGitTags('repo', { maxRetries: 9, defaultTags: ['refs/tags/default'] })).resolves.toEqual(['refs/tags/default']);

        const delays = mockSleep.mock.calls.map(call => call[0]);
        expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    });

    it('returns default tags when all retries fail', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' });

        const tags = await fetchGitTags('repo', { maxRetries: 2, defaultTags: ['refs/tags/fallback'] });

        expect(tags).toEqual(['refs/tags/fallback']);
        expect(mockGetExecOutput).toHaveBeenCalledTimes(2);
    });

    it('throws an ExpectedError when all retries fail and there are no default tags', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({ exitCode: 2, stdout: '', stderr: '' });

        const promise = fetchGitTags('repo', { maxRetries: 1 });
        await expect(promise).rejects.toBeInstanceOf(ExpectedError);
        await expect(fetchGitTags('repo', { maxRetries: 1 })).rejects.toThrow(/Max retries reached fetching Git tags: Git ls-remote failed with exit code 2/);
    });

    it('stringifies non-Error failures in the final error message', async () => {
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockRejectedValue('boom');

        await expect(fetchGitTags('repo', { maxRetries: 1 })).rejects.toThrow(/Max retries reached fetching Git tags: boom/);
    });

    it('returns default tags when git cannot be found or installed', async () => {
        mockWhich.mockResolvedValue('');

        const tags = await fetchGitTags('repo', { defaultTags: ['refs/tags/default'] });

        expect(tags).toEqual(['refs/tags/default']);
        expect(mockFindWithApt).toHaveBeenCalledWith(['git'], '*', true);
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('throws when git cannot be found and there are no default tags', async () => {
        mockWhich.mockResolvedValue('');

        await expect(fetchGitTags('repo')).rejects.toThrow('Error fetching Git tags: Git not found');
    });

    it('treats a throwing git lookup as git not found', async () => {
        mockWhich.mockResolvedValue('');
        mockUpdateApt.mockRejectedValueOnce(new Error('apt broken'));

        await expect(fetchGitTags('repo', { defaultTags: ['refs/tags/d'] })).resolves.toEqual(['refs/tags/d']);
        expect(mockFindWithApt).toHaveBeenCalled();
    });

    it('returns default tags when maxRetries is zero', async () => {
        mockWhich.mockResolvedValue(GIT);

        await expect(fetchGitTags('repo', { maxRetries: 0, defaultTags: ['refs/tags/x'] })).resolves.toEqual(['refs/tags/x']);
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('wraps non-Error exceptions from the git lookup', async () => {
        mockWhich.mockResolvedValue('');
        mockFindWithApt.mockRejectedValueOnce('apt exploded');

        await expect(fetchGitTags('repo')).rejects.toThrow('Error fetching Git tags: apt exploded');
    });
});

describe('findVersionsFromTags', () => {
    it('returns cached versions without fetching tags', async () => {
        mockReadVersions.mockReturnValue(['1.0.0']);

        await expect(findVersionsFromTags('Tool', 'repo', 'tool.txt', /^refs\/tags\/v(.*)$/)).resolves.toEqual(['1.0.0']);
        expect(mockGetExecOutput).not.toHaveBeenCalled();
        expect(mockSaveVersions).not.toHaveBeenCalled();
    });

    it('extracts versions with the regex, sorts them by semver and caches them', async () => {
        mockReadVersions.mockReturnValue(null);
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: lsRemote(['refs/tags/v10.0.0', 'refs/tags/v2.1.0', 'refs/tags/other', 'refs/tags/v9.3.1']),
            stderr: ''
        });

        const versions = await findVersionsFromTags('Tool', 'repo', 'tool.txt', /^refs\/tags\/v(\d+\.\d+\.\d+)$/);

        expect(versions).toEqual(['2.1.0', '9.3.1', '10.0.0']);
        expect(mockSaveVersions).toHaveBeenCalledWith(['2.1.0', '9.3.1', '10.0.0'], 'tool.txt');
    });

    it('skips tags whose capture group is empty', async () => {
        mockReadVersions.mockReturnValue(null);
        mockWhich.mockResolvedValue(GIT);
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: lsRemote(['refs/tags/v', 'refs/tags/v1.2.3']), stderr: '' });

        await expect(findVersionsFromTags('Tool', 'repo', 'tool.txt', /^refs\/tags\/v(.*)$/)).resolves.toEqual(['1.2.3']);
    });
});

describe('compiler version finders', () => {
    beforeEach(() => {
        mockReadVersions.mockReturnValue(null);
        mockWhich.mockResolvedValue(GIT);
    });

    it('findGCCVersions queries the GCC repository and parses release tags', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: lsRemote(['refs/tags/releases/gcc-13.2.0', 'refs/tags/releases/gcc-12.3.0', 'refs/tags/basepoints/gcc-14']),
            stderr: ''
        });

        await expect(findGCCVersions()).resolves.toEqual(['12.3.0', '13.2.0']);
        expect(mockGetExecOutput.mock.calls[0][1]).toEqual(['ls-remote', '--tags', 'git://gcc.gnu.org/git/gcc.git']);
        expect(mockSaveVersions).toHaveBeenCalledWith(['12.3.0', '13.2.0'], 'gcc-versions.txt');
    });

    it('findClangVersions queries the LLVM repository and parses llvmorg tags', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: lsRemote(['refs/tags/llvmorg-17.0.6', 'refs/tags/llvmorg-18.1.0-rc1', 'refs/tags/llvmorg-16.0.0']),
            stderr: ''
        });

        await expect(findClangVersions()).resolves.toEqual(['16.0.0', '17.0.6']);
        expect(mockGetExecOutput.mock.calls[0][1]).toEqual(['ls-remote', '--tags', 'https://github.com/llvm/llvm-project']);
        expect(mockSaveVersions).toHaveBeenCalledWith(['16.0.0', '17.0.6'], 'clang-versions.txt');
    });

    it('findCMakeVersions queries the Kitware repository and parses v tags', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: lsRemote(['refs/tags/v3.28.1', 'refs/tags/v3.27.0-rc2', 'refs/tags/v3.9.0']),
            stderr: ''
        });

        await expect(findCMakeVersions()).resolves.toEqual(['3.9.0', '3.28.1']);
        expect(mockGetExecOutput.mock.calls[0][1]).toEqual(['ls-remote', '--tags', 'https://github.com/Kitware/CMake.git']);
        expect(mockSaveVersions).toHaveBeenCalledWith(['3.9.0', '3.28.1'], 'cmake-versions.txt');
    });
});

describe('cloneGitRepo', () => {
    const dest = '/tmp/clone-dest';

    beforeEach(() => {
        mockWhich.mockResolvedValue(GIT);
        mockExistsSync.mockReturnValue(false);
    });

    it('performs a shallow clone of a branch', async () => {
        await cloneGitRepo('https://example.com/repo.git', dest, 'develop');

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec).toHaveBeenCalledWith(`"${GIT}"`, ['clone', 'https://example.com/repo.git', dest, '--depth', '1', '--branch', 'develop']);
        expect(mockRmRF).not.toHaveBeenCalled();
    });

    it('performs a full clone of the default branch when shallow is false and no ref is given', async () => {
        await cloneGitRepo('repo', dest, undefined, { shallow: false });

        expect(mockExec).toHaveBeenCalledWith(`"${GIT}"`, ['clone', 'repo', dest]);
    });

    it('removes an existing destination before cloning', async () => {
        mockExistsSync.mockReturnValue(true);

        await cloneGitRepo('repo', dest);

        expect(mockRmRF).toHaveBeenCalledWith(dest);
        expect(mockExec).toHaveBeenCalledWith(`"${GIT}"`, ['clone', 'repo', dest, '--depth', '1']);
    });

    it('uses init, fetch and checkout when the ref is a commit hash', async () => {
        const sha = 'a'.repeat(40);

        await cloneGitRepo('repo', dest, sha);

        expect(mockMkdirP).toHaveBeenCalledWith(dest);
        const calls = mockExec.mock.calls.map(call => call[1]);
        expect(calls).toEqual([
            ['config', '--global', 'init.defaultBranch', 'master'],
            ['config', '--global', 'advice.detachedHead', 'false'],
            ['init'],
            ['remote', 'add', 'origin', 'repo'],
            ['fetch', '--depth', '1', 'origin', sha],
            ['checkout', 'FETCH_HEAD']
        ]);
        for (const call of mockExec.mock.calls) {
            expect(call[2]).toEqual({ cwd: dest });
        }
    });

    it('fetches the full history of a commit hash when shallow is false', async () => {
        const sha = '0123456789abcdef0123456789abcdef01234567';

        await cloneGitRepo('repo', dest, sha, { shallow: false });

        expect(mockExec.mock.calls[4][1]).toEqual(['fetch', 'origin', sha]);
    });

    it('throws an ExpectedError when git is not available', async () => {
        mockWhich.mockResolvedValue('');

        const promise = cloneGitRepo('repo', dest);
        await expect(promise).rejects.toBeInstanceOf(ExpectedError);
        await expect(cloneGitRepo('repo', dest)).rejects.toThrow('Error cloning Git repository: Git not found');
        expect(mockExec).not.toHaveBeenCalled();
    });

    it('wraps clone failures in an ExpectedError', async () => {
        mockExec.mockRejectedValue('exit code 128');

        await expect(cloneGitRepo('repo', dest)).rejects.toThrow('Error cloning Git repository: exit code 128');
    });
});
