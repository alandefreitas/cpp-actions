import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as git from './git';
import { askConsent } from './prompt';
import { WorktreeContext } from './worktree';
import { executeRelease, type ReleaseOptions } from './release';

jest.mock('child_process');
jest.mock('fs');
jest.mock('./git');
jest.mock('./prompt');
jest.mock('./worktree');

const rootDir = path.join('repo', 'root');
const worktreePath = path.join('tmp', 'cpp-actions-master');
const rootOpts = { cwd: rootDir };
const wtOpts = { cwd: worktreePath };

const mockExecSync = execSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as unknown as jest.Mock;
const mockAskConsent = askConsent as jest.Mock;
const MockWorktreeContext = WorktreeContext as unknown as jest.Mock;
const g = git as jest.Mocked<typeof git>;

let wtCreate: jest.Mock;
let wtGetPath: jest.Mock;
let wtCleanup: jest.Mock;
let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

/**
 * Builds the release options used by most tests.
 * @param overrides - Fields to override
 * @returns Release options
 */
function makeOptions(overrides: Partial<ReleaseOptions> = {}): ReleaseOptions {
    return { tag: 'v1.2.3', skipPrompts: true, dryRun: false, rootDir, ...overrides };
}

/**
 * Collects every message passed to a console spy, one string per call.
 * @param spy - Console spy
 * @returns Joined call arguments
 */
function messages(spy: jest.SpyInstance): string[] {
    return spy.mock.calls.map(args => args.map(String).join(' '));
}

/**
 * Lists the npm scripts that were run through execSync.
 * @returns Commands passed to execSync
 */
function npmCommands(): string[] {
    return mockExecSync.mock.calls.map(c => c[0] as string);
}

/**
 * Returns the commands shown to the user in consent prompts.
 * @returns Consent commands in order
 */
function consentCommands(): string[] {
    return mockAskConsent.mock.calls.map(c => c[1] as string);
}

beforeEach(() => {
    jest.resetAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Packages are on an older version by default, so version:set runs
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0', workspaces: [] }));

    // Mirror the real askConsent: decline in dry-run, accept otherwise (--yes)
    mockAskConsent.mockImplementation(
        (_d: string, _c: string, _skip: boolean, dryRun: boolean) => Promise.resolve(!dryRun)
    );

    g.isWorkingTreeClean.mockReturnValue(true);
    g.refExists.mockReturnValue(true);
    g.getCommitSha.mockReturnValue('0123456789abcdef');
    g.getCommitMessage.mockReturnValue('feat: something');
    g.getLog.mockReturnValue('');
    g.getChangeSummary.mockReturnValue(' M package.json');

    wtCreate = jest.fn().mockReturnValue(wtOpts);
    wtGetPath = jest.fn().mockReturnValue(worktreePath);
    wtCleanup = jest.fn();
    MockWorktreeContext.mockImplementation(() => ({
        create: wtCreate,
        getPath: wtGetPath,
        cleanup: wtCleanup
    }));
});

afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
});

describe('executeRelease', () => {
    describe('tag validation', () => {
        it.each(['1.2', 'v1.2.3-beta', 'latest', ''])('rejects invalid tag %p without side effects', async (tag) => {
            await expect(executeRelease(makeOptions({ tag }))).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(`Invalid tag format: ${tag}`);
            expect(mockExecSync).not.toHaveBeenCalled();
            expect(mockAskConsent).not.toHaveBeenCalled();
            expect(MockWorktreeContext).not.toHaveBeenCalled();
        });
    });

    describe('successful release', () => {
        it('runs every step and creates the full, minor and major tags', async () => {
            await expect(executeRelease(makeOptions({ tag: '1.2.3' }))).resolves.toBe(true);

            expect(npmCommands()).toEqual([
                'npm run version:set -- 1.2.3',
                'npm run build',
                'npm run depcheck',
                'npm run update-deps'
            ]);
            for (const call of mockExecSync.mock.calls) {
                expect(call[1]).toEqual({ cwd: rootDir, stdio: 'inherit' });
            }

            expect(g.fetchOrigin).toHaveBeenCalledWith(rootOpts);
            expect(MockWorktreeContext).toHaveBeenCalledWith(rootOpts);
            expect(wtCreate).toHaveBeenCalledWith('master');
            expect(g.rebase).not.toHaveBeenCalled();
            expect(g.pushBranchToOrigin).toHaveBeenCalledTimes(1);
            expect(g.pushBranchToOrigin).toHaveBeenCalledWith('master', wtOpts);

            expect(g.createTag).toHaveBeenCalledWith('v1.2.3', wtOpts);
            expect(g.pushTagToOrigin).toHaveBeenCalledWith('v1.2.3', wtOpts);
            expect(g.createTagForce.mock.calls).toEqual([['v1', wtOpts], ['v1.2', wtOpts]]);
            expect(g.pushTagForce.mock.calls).toEqual([['v1', wtOpts], ['v1.2', wtOpts]]);
            expect(g.commitAll).not.toHaveBeenCalled();
            expect(wtCleanup).toHaveBeenCalledTimes(1);

            const logs = messages(logSpy);
            expect(logs).toContain('    - v1.2.3 (full version)');
            expect(logs).toContain('    - v1.2 (rolling minor)');
            expect(logs).toContain('    - v1 (rolling major)');
        });

        it('shows the exact tag commands in the consent prompts', async () => {
            await executeRelease(makeOptions({ tag: 'v2.10.4' }));
            expect(consentCommands()).toEqual([
                'npm run version:set -- 2.10.4',
                'npm run build',
                'npm run depcheck',
                'npm run update-deps',
                'git fetch origin',
                'git push origin refs/heads/master:refs/heads/master',
                'git tag v2.10.4',
                'git push origin refs/tags/v2.10.4:refs/tags/v2.10.4',
                'git tag -f v2 && git tag -f v2.10',
                'git push --force origin refs/tags/v2 refs/tags/v2.10'
            ]);
        });

        it('passes skipPrompts and dryRun through to askConsent', async () => {
            await executeRelease(makeOptions({ skipPrompts: false }));
            for (const call of mockAskConsent.mock.calls) {
                expect(call[2]).toBe(false);
                expect(call[3]).toBe(false);
            }
        });
    });

    describe('package version check', () => {
        it('skips version:set when root and all workspaces already have the version', async () => {
            mockReadFileSync.mockImplementation((p: string) => {
                if (p === path.join(rootDir, 'package.json')) {
                    return JSON.stringify({ version: '1.2.3', workspaces: ['a', path.join('utils', 'b')] });
                }
                return JSON.stringify({ version: '1.2.3' });
            });

            await expect(executeRelease(makeOptions())).resolves.toBe(true);

            expect(mockReadFileSync.mock.calls.map(c => c[0])).toEqual([
                path.join(rootDir, 'package.json'),
                path.join(rootDir, 'package.json'),
                path.join(rootDir, 'a', 'package.json'),
                path.join(rootDir, 'utils', 'b', 'package.json')
            ]);
            expect(npmCommands()).not.toContain('npm run version:set -- 1.2.3');
            expect(logSpy).toHaveBeenCalledWith('All packages already at 1.2.3; skipping version:set.');
        });

        it('runs version:set when one workspace is on a different version', async () => {
            mockReadFileSync.mockImplementation((p: string) => {
                if (p === path.join(rootDir, 'package.json')) {
                    return JSON.stringify({ version: '1.2.3', workspaces: ['a'] });
                }
                return JSON.stringify({ version: '1.2.2' });
            });
            await executeRelease(makeOptions());
            expect(npmCommands()[0]).toBe('npm run version:set -- 1.2.3');
        });

        it('treats a missing workspaces field as root-only and skips version:set', async () => {
            mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.2.3' }));
            await executeRelease(makeOptions());
            expect(npmCommands()).not.toContain('npm run version:set -- 1.2.3');
        });

        it('falls back to version:set when package.json cannot be read', async () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error('ENOENT');
            });
            await executeRelease(makeOptions());
            expect(npmCommands()[0]).toBe('npm run version:set -- 1.2.3');
        });
    });

    describe('dry run', () => {
        it('makes no changes and reports the tags that would be created', async () => {
            await expect(executeRelease(makeOptions({ dryRun: true, tag: '3.4.5' }))).resolves.toBe(true);

            expect(mockExecSync).not.toHaveBeenCalled();
            expect(g.fetchOrigin).not.toHaveBeenCalled();
            expect(g.refExists).not.toHaveBeenCalled();
            expect(g.commitAll).not.toHaveBeenCalled();
            expect(g.rebase).not.toHaveBeenCalled();
            expect(g.pushBranchToOrigin).not.toHaveBeenCalled();
            expect(g.createTag).not.toHaveBeenCalled();
            expect(g.createTagForce).not.toHaveBeenCalled();
            expect(g.pushTagToOrigin).not.toHaveBeenCalled();
            expect(g.pushTagForce).not.toHaveBeenCalled();
            expect(wtCreate).not.toHaveBeenCalled();
            expect(wtCleanup).not.toHaveBeenCalled();

            const logs = messages(logSpy);
            expect(logs).toContain('[DRY RUN MODE] No changes will be made\n');
            expect(logs).toContain('[DRY RUN] Would verify develop matches origin/develop');
            expect(logs).toContain('[DRY RUN] Would create worktree for master branch');
            expect(logs).toContain('[DRY RUN] Would rebase master onto origin/develop if needed');
            expect(logs).toContain('[DRY RUN] Would remove worktree');
            expect(logs).toContain('  [DRY RUN] Release v3.4.5 would be created');
            expect(logs).toContain('  Rolling tags v3 and v3.4 would be updated');
            expect(consentCommands()).toContain('git tag -f v3 && git tag -f v3.4');
        });
    });

    describe('pre-release step failures', () => {
        it.each([
            ['version:set', 'Update package.json versions to 1.2.3'],
            ['build', 'Regenerate dist outputs for fresh builds'],
            ['update-deps', 'Update package versions']
        ])('stops when npm run %s fails', async (script, description) => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.startsWith(`npm run ${script}`)) {
                    throw new Error('exit code 1');
                }
            });
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(`Failed: ${description} - exit code 1`);
            expect(g.fetchOrigin).not.toHaveBeenCalled();
            expect(MockWorktreeContext).not.toHaveBeenCalled();
        });

        it('reports non-Error exceptions as strings', async () => {
            mockExecSync.mockImplementation(() => {
                throw 'boom';
            });
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Failed: Update package.json versions to 1.2.3 - boom');
        });

        it('continues when depcheck fails', async () => {
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd === 'npm run depcheck') {
                    throw new Error('unused deps');
                }
            });
            await expect(executeRelease(makeOptions())).resolves.toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(
                'Non-blocking failure: Run depcheck to verify dependency health - unused deps'
            );
            expect(npmCommands()).toContain('npm run update-deps');
            expect(g.createTag).toHaveBeenCalled();
        });

        it.each([
            ['version:set', 0],
            ['build', 1],
            ['depcheck', 2],
            ['update-deps', 3]
        ])('stops when the user declines the %s step', async (_name, index) => {
            let call = 0;
            mockAskConsent.mockImplementation(() => Promise.resolve(call++ !== index));
            await expect(executeRelease(makeOptions({ skipPrompts: false }))).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('User declined');
            expect(g.fetchOrigin).not.toHaveBeenCalled();
        });
    });

    describe('dirty working tree after a pre-release step', () => {
        it.each([
            ['Version update', 'chore: bump version to 1.2.3', 0],
            ['Build', 'chore: rebuild dist bundles for v1.2.3', 1],
            ['Depcheck', 'chore: depcheck fixes for v1.2.3', 2],
            ['Dependency updates', 'chore: update dependencies for v1.2.3', 3]
        ])('commits the changes left by %s when the user agrees', async (step, message, index) => {
            let check = 0;
            g.isWorkingTreeClean.mockImplementation(() => check++ !== index);

            await expect(executeRelease(makeOptions())).resolves.toBe(true);

            expect(g.commitAll).toHaveBeenCalledTimes(1);
            expect(g.commitAll).toHaveBeenCalledWith(message, rootOpts);
            expect(logSpy).toHaveBeenCalledWith(`\n⚠️  ${step} introduced changes to the working tree.`);
            expect(logSpy).toHaveBeenCalledWith(' M package.json');
            expect(consentCommands()).toContain(`git add -A && git commit -m "${message}"`);
        });

        it.each([0, 1, 2, 3])('aborts without committing when the user declines (check %i)', async (index) => {
            let check = 0;
            g.isWorkingTreeClean.mockImplementation(() => check++ !== index);
            mockAskConsent.mockImplementation((_d: string, cmd: string) =>
                Promise.resolve(!cmd.startsWith('git add -A')));

            await expect(executeRelease(makeOptions())).resolves.toBe(false);

            expect(g.commitAll).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith('Please review, commit, or stash these changes before continuing.');
            expect(g.fetchOrigin).not.toHaveBeenCalled();
        });
    });

    describe('fetch and develop verification', () => {
        it('stops when fetching from origin fails', async () => {
            g.fetchOrigin.mockImplementation(() => {
                throw new Error('network down');
            });
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Failed: Fetch latest refs from origin - network down');
            expect(MockWorktreeContext).not.toHaveBeenCalled();
        });

        it('stops when the local develop branch does not exist', async () => {
            g.refExists.mockImplementation((ref: string) => ref !== 'refs/heads/develop');
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Local develop branch not found');
            expect(MockWorktreeContext).not.toHaveBeenCalled();
        });

        /**
         * Makes local and remote develop point to different commits.
         * @param remoteIsAncestor - Whether origin/develop is an ancestor of develop
         * @param localIsAncestor - Whether develop is an ancestor of origin/develop
         */
        function divergeDevelop(remoteIsAncestor: boolean, localIsAncestor: boolean): void {
            g.getCommitSha.mockImplementation((ref: string) =>
                ref === 'refs/heads/develop' ? 'localsha000' : 'remotesha00');
            g.gitSafe.mockImplementation((args: string[]) =>
                args[2] === 'origin/develop' ? remoteIsAncestor : localIsAncestor);
        }

        it('pushes develop when it is ahead of origin/develop', async () => {
            divergeDevelop(true, false);
            await executeRelease(makeOptions());
            expect(g.gitSafe).toHaveBeenCalledWith(
                ['merge-base', '--is-ancestor', 'origin/develop', 'refs/heads/develop'], rootOpts);
            expect(g.pushBranchToOrigin).toHaveBeenCalledWith('develop', rootOpts);
            expect(logSpy).toHaveBeenCalledWith('Local develop is ahead of origin/develop.');
            expect(wtCreate).toHaveBeenCalledWith('master');
        });

        it('stops when pushing develop fails', async () => {
            divergeDevelop(true, false);
            g.pushBranchToOrigin.mockImplementation(() => {
                throw new Error('rejected');
            });
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Failed: Push develop to origin - rejected');
            expect(MockWorktreeContext).not.toHaveBeenCalled();
        });

        it('stops when develop is behind origin/develop', async () => {
            divergeDevelop(false, true);
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Local develop is behind origin/develop.');
            expect(g.pushBranchToOrigin).not.toHaveBeenCalled();
        });

        it.each([[false, false], [true, true]])(
            'stops when develop and origin/develop have diverged (remote ancestor %p, local ancestor %p)',
            async (remote, local) => {
                divergeDevelop(remote, local);
                await expect(executeRelease(makeOptions())).resolves.toBe(false);
                expect(errorSpy).toHaveBeenCalledWith(
                    'Local and origin develop have diverged. Please reconcile before releasing.');
                expect(g.pushBranchToOrigin).not.toHaveBeenCalled();
            });
    });

    describe('master worktree', () => {
        it('stops when the local master branch does not exist and still cleans up', async () => {
            g.refExists.mockImplementation((ref: string) => ref !== 'refs/heads/master');
            await expect(executeRelease(makeOptions())).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('Local master branch not found');
            expect(wtCreate).not.toHaveBeenCalled();
            expect(wtCleanup).toHaveBeenCalledTimes(1);
            expect(g.createTag).not.toHaveBeenCalled();
        });

        it('rebases master onto origin/develop when it is behind and lists pending commits', async () => {
            g.getCommitSha.mockImplementation((ref: string) => (ref === 'HEAD' ? 'mastersha00' : 'developsha0'));
            g.getLog.mockReturnValue('abc123 feat: new thing\n');

            await expect(executeRelease(makeOptions())).resolves.toBe(true);

            expect(g.getCommitSha).toHaveBeenCalledWith('HEAD', wtOpts);
            expect(g.getLog).toHaveBeenCalledWith('HEAD', 'origin/develop', wtOpts);
            expect(logSpy).toHaveBeenCalledWith('abc123 feat: new thing\n');
            expect(g.rebase).toHaveBeenCalledWith('origin/develop', wtOpts);
            expect(consentCommands()).toContain(`git -C ${worktreePath} rebase origin/develop`);
        });

        it('rebases without listing commits when the log is empty and the path is unknown', async () => {
            g.getCommitSha.mockImplementation((ref: string) => (ref === 'HEAD' ? 'mastersha00' : 'developsha0'));
            wtGetPath.mockReturnValue(null);

            await expect(executeRelease(makeOptions())).resolves.toBe(true);

            expect(logSpy).not.toHaveBeenCalledWith('\nCommits to be added to master:');
            expect(consentCommands()).toContain('git rebase origin/develop');
            expect(g.rebase).toHaveBeenCalledWith('origin/develop', wtOpts);
        });

        it('stops and cleans up when the rebase fails', async () => {
            g.getCommitSha.mockImplementation((ref: string) => (ref === 'HEAD' ? 'mastersha00' : 'developsha0'));
            g.rebase.mockImplementation(() => {
                throw new Error('conflict');
            });

            await expect(executeRelease(makeOptions())).resolves.toBe(false);

            expect(errorSpy).toHaveBeenCalledWith(
                'Failed: Rebase master worktree onto origin/develop (does not touch your local develop) - conflict');
            expect(g.pushBranchToOrigin).not.toHaveBeenCalled();
            expect(g.createTag).not.toHaveBeenCalled();
            expect(wtCleanup).toHaveBeenCalledTimes(1);
        });
    });

    describe('tag step failures', () => {
        it.each([
            ['pushBranchToOrigin', 'Failed: Push master to origin - fail'],
            ['createTag', 'Failed: Create local tag v1.2.3 - fail'],
            ['pushTagToOrigin', 'Failed: Push tag v1.2.3 to origin - fail'],
            ['createTagForce', 'Failed: Create rolling tags v1 and v1.2 - fail'],
            ['pushTagForce', 'Failed: Force-push rolling tags v1 and v1.2 to origin - fail']
        ] as const)('stops and cleans up when %s fails', async (fn, message) => {
            g[fn].mockImplementation(() => {
                throw new Error('fail');
            });

            await expect(executeRelease(makeOptions())).resolves.toBe(false);

            expect(errorSpy).toHaveBeenCalledWith(message);
            expect(wtCleanup).toHaveBeenCalledTimes(1);
            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('completed successfully'));
        });

        it('does not push the tag when the user declines to create it', async () => {
            mockAskConsent.mockImplementation((_d: string, cmd: string) =>
                Promise.resolve(cmd !== 'git tag v1.2.3'));
            await expect(executeRelease(makeOptions({ skipPrompts: false }))).resolves.toBe(false);
            expect(errorSpy).toHaveBeenCalledWith('User declined');
            expect(g.createTag).not.toHaveBeenCalled();
            expect(g.pushTagToOrigin).not.toHaveBeenCalled();
            expect(g.createTagForce).not.toHaveBeenCalled();
            expect(wtCleanup).toHaveBeenCalledTimes(1);
        });
    });
});
