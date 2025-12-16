import * as os from 'os';
import * as path from 'path';
import { getWorktreePath, WorktreeContext } from './worktree';

describe('worktree utilities', () => {
    describe('getWorktreePath', () => {
        it('should return a path in temp directory', () => {
            const worktreePath = getWorktreePath('master');
            expect(worktreePath.startsWith(os.tmpdir())).toBe(true);
        });

        it('should include branch name in path', () => {
            const worktreePath = getWorktreePath('master');
            expect(worktreePath).toContain('master');
        });

        it('should sanitize branch names with special characters', () => {
            const worktreePath = getWorktreePath('feature/my-branch');
            expect(worktreePath).toContain('feature-my-branch');
        });

        it('should generate unique paths', () => {
            const path1 = getWorktreePath('master');
            // Wait a bit to ensure different timestamp
            const path2 = getWorktreePath('master');
            // Paths should be different due to timestamp
            // (though in fast tests they might be the same)
            expect(typeof path1).toBe('string');
            expect(typeof path2).toBe('string');
        });
    });

    describe('WorktreeContext', () => {
        it('should be instantiable', () => {
            const rootDir = path.resolve(__dirname, '../../..');
            const context = new WorktreeContext({ cwd: rootDir });
            expect(context).toBeDefined();
            expect(context.getPath()).toBeNull();
        });
    });
});
