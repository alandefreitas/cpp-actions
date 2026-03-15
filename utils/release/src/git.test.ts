import {
    git,
    gitSafe,
    fetchOrigin,
    getCurrentBranch,
    getCommitSha,
    getCommitMessage,
    refExists,
    isWorkingTreeClean,
    createTag,
    createTagForce,
    pushTagForce,
    pushBranchToOrigin,
    pushTagToOrigin,
    rebase,
    getLog,
    commitAll,
    getChangeSummary
} from './git';
import { execFileSync } from 'child_process';

jest.mock('child_process');

const mockExecFileSync = execFileSync as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    (console.log as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

const opts = { cwd: '/test/repo' };

describe('git', () => {
    it('should call execFileSync with git and provided args', () => {
        mockExecFileSync.mockReturnValue('output');
        const result = git(['status'], opts);
        expect(result).toBe('output');
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ cwd: '/test/repo' }));
    });

    it('should use inherit stdio when not silent', () => {
        mockExecFileSync.mockReturnValue('');
        git(['status'], opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ stdio: 'inherit' }));
    });

    it('should use pipe stdio when silent', () => {
        mockExecFileSync.mockReturnValue('');
        git(['status'], { ...opts, silent: true });
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }));
    });

    it('should throw when execFileSync throws', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('git failed'); });
        expect(() => git(['bad-command'], opts)).toThrow('git failed');
    });
});

describe('gitSafe', () => {
    it('should return true when git command succeeds', () => {
        mockExecFileSync.mockReturnValue('');
        expect(gitSafe(['status'], opts)).toBe(true);
    });

    it('should return false when git command fails', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });
        expect(gitSafe(['bad'], opts)).toBe(false);
    });
});

describe('fetchOrigin', () => {
    it('should call git fetch origin', () => {
        mockExecFileSync.mockReturnValue('');
        fetchOrigin(opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['fetch', 'origin'], expect.objectContaining({ cwd: '/test/repo' }));
    });
});

describe('getCurrentBranch', () => {
    it('should return branch name', () => {
        mockExecFileSync.mockReturnValue('main\n');
        expect(getCurrentBranch(opts)).toBe('main');
    });

    it('should return HEAD on error', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('detached'); });
        expect(getCurrentBranch(opts)).toBe('HEAD');
    });
});

describe('getCommitSha', () => {
    it('should return trimmed SHA', () => {
        mockExecFileSync.mockReturnValue('abc123\n');
        expect(getCommitSha('HEAD', opts)).toBe('abc123');
    });
});

describe('getCommitMessage', () => {
    it('should return trimmed commit message', () => {
        mockExecFileSync.mockReturnValue('fix: some bug\n');
        expect(getCommitMessage('HEAD', opts)).toBe('fix: some bug');
    });
});

describe('refExists', () => {
    it('should return true when ref exists', () => {
        mockExecFileSync.mockReturnValue('abc123');
        expect(refExists('HEAD', opts)).toBe(true);
    });

    it('should return false when ref does not exist', () => {
        mockExecFileSync.mockImplementation(() => { throw new Error('bad ref'); });
        expect(refExists('nonexistent', opts)).toBe(false);
    });
});

describe('isWorkingTreeClean', () => {
    it('should return true when status is empty', () => {
        mockExecFileSync.mockReturnValue('');
        expect(isWorkingTreeClean(opts)).toBe(true);
    });

    it('should return false when there are changes', () => {
        mockExecFileSync.mockReturnValue(' M file.ts\n');
        expect(isWorkingTreeClean(opts)).toBe(false);
    });
});

describe('createTag', () => {
    it('should call git tag', () => {
        mockExecFileSync.mockReturnValue('');
        createTag('v1.0.0', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['tag', 'v1.0.0'], expect.any(Object));
    });
});

describe('createTagForce', () => {
    it('should call git tag -f', () => {
        mockExecFileSync.mockReturnValue('');
        createTagForce('v1', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['tag', '-f', 'v1'], expect.any(Object));
    });
});

describe('pushTagForce', () => {
    it('should call git push --force with refspec', () => {
        mockExecFileSync.mockReturnValue('');
        pushTagForce('v1', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', '--force', 'origin', 'refs/tags/v1:refs/tags/v1'], expect.any(Object));
    });
});

describe('pushBranchToOrigin', () => {
    it('should call git push with branch refspec', () => {
        mockExecFileSync.mockReturnValue('');
        pushBranchToOrigin('main', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', 'origin', 'refs/heads/main:refs/heads/main'], expect.any(Object));
    });
});

describe('pushTagToOrigin', () => {
    it('should call git push with tag refspec', () => {
        mockExecFileSync.mockReturnValue('');
        pushTagToOrigin('v1.0.0', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['push', 'origin', 'refs/tags/v1.0.0:refs/tags/v1.0.0'], expect.any(Object));
    });
});

describe('rebase', () => {
    it('should call git rebase with target', () => {
        mockExecFileSync.mockReturnValue('');
        rebase('origin/main', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['rebase', 'origin/main'], expect.any(Object));
    });
});

describe('getLog', () => {
    it('should return log output', () => {
        mockExecFileSync.mockReturnValue('abc123 commit msg\ndef456 another\n');
        const result = getLog('v1.0.0', 'HEAD', opts);
        expect(result).toContain('abc123');
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['log', 'v1.0.0..HEAD', '--oneline'], expect.any(Object));
    });
});

describe('commitAll', () => {
    it('should stage all changes and commit', () => {
        mockExecFileSync.mockReturnValue('');
        commitAll('feat: new feature', opts);
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['add', '-A'], expect.any(Object));
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['commit', '-m', 'feat: new feature'], expect.any(Object));
    });
});

describe('getChangeSummary', () => {
    it('should return status --short output', () => {
        mockExecFileSync.mockReturnValue(' M file.ts\n?? new.ts\n');
        const result = getChangeSummary(opts);
        expect(result).toContain('file.ts');
        expect(mockExecFileSync).toHaveBeenCalledWith('git', ['status', '--short'], expect.any(Object));
    });
});
