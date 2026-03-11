import * as path from 'path';
import { getCurrentBranch, isWorkingTreeClean, refExists, type GitOptions } from './git';

describe('git utilities', () => {
    // Use the actual repo root for testing
    const rootDir = path.resolve(__dirname, '../../..');
    const gitOpts: GitOptions = { cwd: rootDir };

    describe('getCurrentBranch', () => {
        it('should return current branch name', () => {
            const branch = getCurrentBranch(gitOpts);
            expect(typeof branch).toBe('string');
            expect(branch.length).toBeGreaterThan(0);
        });
    });

    describe('refExists', () => {
        it('should return true for HEAD', () => {
            expect(refExists('HEAD', gitOpts)).toBe(true);
        });

        it('should return false for non-existent ref', () => {
            expect(refExists('refs/heads/non-existent-branch-12345', gitOpts)).toBe(false);
        });
    });

    describe('isWorkingTreeClean', () => {
        it('should return boolean', () => {
            const result = isWorkingTreeClean(gitOpts);
            expect(typeof result).toBe('boolean');
        });
    });
});
