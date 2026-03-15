import * as os from 'os';
import * as fs from 'fs';
import {
    getWorktreePath,
    createWorktree,
    removeWorktree,
    listWorktrees,
    pruneWorktrees,
    WorktreeContext
} from './worktree';
import * as git from './git';

jest.mock('fs');
jest.mock('./git');

const mockGit = git.git as jest.Mock;
const mockGitSafe = git.gitSafe as jest.Mock;
const mockExistsSync = fs.existsSync as jest.Mock;
const mockMkdirSync = fs.mkdirSync as jest.Mock;
const mockRmSync = fs.rmSync as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGitSafe.mockReturnValue(true);
});

afterEach(() => {
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

const opts = { cwd: '/main/repo' };

describe('getWorktreePath', () => {
    it('should return a path in temp directory', () => {
        const result = getWorktreePath('master');
        expect(result.startsWith(os.tmpdir())).toBe(true);
    });

    it('should include sanitized branch name', () => {
        const result = getWorktreePath('feature/my-branch');
        expect(result).toContain('feature-my-branch');
    });

    it('should include cpp-actions-release prefix', () => {
        const result = getWorktreePath('main');
        expect(result).toContain('cpp-actions-release-');
    });
});

describe('listWorktrees', () => {
    it('should parse porcelain worktree output', () => {
        mockGit.mockReturnValue(
            'worktree /main/repo\nbranch refs/heads/main\n\nworktree /tmp/wt\nbranch refs/heads/develop\n'
        );
        const result = listWorktrees(opts);
        expect(result).toEqual([
            { path: '/main/repo', branch: 'refs/heads/main' },
            { path: '/tmp/wt', branch: 'refs/heads/develop' }
        ]);
    });

    it('should handle worktrees without branch (detached HEAD)', () => {
        mockGit.mockReturnValue('worktree /main/repo\nHEAD abc123\ndetached\n');
        const result = listWorktrees(opts);
        expect(result).toEqual([
            { path: '/main/repo', branch: null }
        ]);
    });

    it('should handle empty output', () => {
        mockGit.mockReturnValue('');
        const result = listWorktrees(opts);
        expect(result).toEqual([]);
    });
});

describe('pruneWorktrees', () => {
    it('should call gitSafe with worktree prune', () => {
        pruneWorktrees(opts);
        expect(mockGitSafe).toHaveBeenCalledWith(['worktree', 'prune'], opts);
    });
});

describe('createWorktree', () => {
    it('should create worktree for branch with no conflicts', () => {
        // listWorktrees returns no entries matching branch
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') {
                return 'worktree /main/repo\nbranch refs/heads/main\n';
            }
            if (args[0] === 'rev-parse') {
                return 'abc123\n';
            }
            return '';
        });
        mockExistsSync.mockReturnValue(true);

        const result = createWorktree('develop', '/tmp/wt', opts);
        expect(result).toEqual({
            path: '/tmp/wt',
            branch: 'develop',
            commitSha: 'abc123'
        });
        expect(mockGit).toHaveBeenCalledWith(['worktree', 'add', '/tmp/wt', 'develop'], opts);
    });

    it('should create parent directory if it does not exist', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') return '';
            if (args[0] === 'rev-parse') return 'abc123\n';
            return '';
        });
        mockExistsSync.mockReturnValue(false);

        createWorktree('develop', '/tmp/sub/wt', opts);
        expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/sub', { recursive: true });
    });

    it('should remove stale worktree if branch already checked out in a temp worktree', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') {
                return 'worktree /tmp/cpp-actions-release-develop-123\nbranch refs/heads/develop\n';
            }
            if (args[0] === 'worktree' && args[1] === 'remove') return '';
            if (args[0] === 'worktree' && args[1] === 'add') return '';
            if (args[0] === 'rev-parse') return 'sha456\n';
            return '';
        });
        mockExistsSync.mockReturnValue(true);

        const result = createWorktree('develop', '/tmp/new-wt', opts);
        expect(result.commitSha).toBe('sha456');
        // Should have called remove for the stale worktree
        expect(mockGit).toHaveBeenCalledWith(
            ['worktree', 'remove', '--force', '/tmp/cpp-actions-release-develop-123'],
            expect.any(Object)
        );
    });

    it('should throw when branch is checked out in a non-temp worktree', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') {
                return 'worktree /some/other/path\nbranch refs/heads/develop\n';
            }
            return '';
        });

        expect(() => createWorktree('develop', '/tmp/wt', opts)).toThrow(
            'Branch develop is already checked out at /some/other/path'
        );
    });
});

describe('removeWorktree', () => {
    it('should remove worktree without force by default', () => {
        mockGit.mockReturnValue('');
        removeWorktree('/tmp/wt', opts);
        expect(mockGit).toHaveBeenCalledWith(
            ['worktree', 'remove', '/tmp/wt'],
            expect.objectContaining({ silent: true })
        );
    });

    it('should add --force flag when force is true', () => {
        mockGit.mockReturnValue('');
        removeWorktree('/tmp/wt', opts, true);
        expect(mockGit).toHaveBeenCalledWith(
            ['worktree', 'remove', '--force', '/tmp/wt'],
            expect.objectContaining({ silent: true })
        );
    });

    it('should retry with force when normal removal fails', () => {
        let callCount = 0;
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'remove') {
                callCount++;
                if (callCount === 1 && !args.includes('--force')) {
                    throw new Error('worktree dirty');
                }
                return '';
            }
            return '';
        });

        removeWorktree('/tmp/wt', opts);
        expect(console.log).toHaveBeenCalledWith('Normal removal failed, trying force removal...');
    });

    it('should do manual cleanup when force removal also fails', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'remove') {
                throw new Error('removal failed');
            }
            if (args[0] === 'worktree' && args[1] === 'prune') {
                return '';
            }
            return '';
        });
        mockExistsSync.mockReturnValue(true);
        mockRmSync.mockReturnValue(undefined);

        removeWorktree('/tmp/wt', opts, true);
        expect(console.log).toHaveBeenCalledWith('Force removal failed, attempting manual cleanup...');
        expect(mockRmSync).toHaveBeenCalledWith('/tmp/wt', { recursive: true, force: true });
    });

    it('should handle manual cleanup failure gracefully', () => {
        mockGit.mockImplementation(() => { throw new Error('fail'); });
        mockExistsSync.mockImplementation(() => { throw new Error('fs fail'); });

        removeWorktree('/tmp/wt', opts, true);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Could not clean up worktree'));
    });

    it('should skip rmSync when worktree path does not exist', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'remove') {
                throw new Error('fail');
            }
            return '';
        });
        mockExistsSync.mockReturnValue(false);

        removeWorktree('/tmp/wt', opts, true);
        expect(mockRmSync).not.toHaveBeenCalled();
    });
});

describe('WorktreeContext', () => {
    it('should have null path initially', () => {
        const ctx = new WorktreeContext(opts);
        expect(ctx.getPath()).toBeNull();
    });

    it('should create worktree and return options', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') return '';
            if (args[0] === 'rev-parse') return 'sha123\n';
            return '';
        });
        mockExistsSync.mockReturnValue(true);

        const ctx = new WorktreeContext(opts);
        const wtOpts = ctx.create('release-branch');
        expect(wtOpts.cwd).toBeTruthy();
        expect(ctx.getPath()).toBeTruthy();
    });

    it('should cleanup worktree', () => {
        mockGit.mockImplementation((args: string[]) => {
            if (args[0] === 'worktree' && args[1] === 'list') return '';
            if (args[0] === 'rev-parse') return 'sha123\n';
            return '';
        });
        mockExistsSync.mockReturnValue(true);

        const ctx = new WorktreeContext(opts);
        ctx.create('release-branch');
        expect(ctx.getPath()).not.toBeNull();

        ctx.cleanup();
        expect(ctx.getPath()).toBeNull();
    });

    it('should be a no-op when cleanup is called without create', () => {
        const ctx = new WorktreeContext(opts);
        ctx.cleanup(); // Should not throw
        expect(ctx.getPath()).toBeNull();
    });
});
