/**
 * Git worktree management for release workflow.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { git, gitSafe, GitOptions } from './git';

/**
 * Information about a worktree.
 */
export interface WorktreeInfo {
    /** Path to the worktree directory */
    path: string;
    /** Branch checked out in the worktree */
    branch: string;
    /** Commit SHA at worktree HEAD */
    commitSha: string;
}

/**
 * Creates a unique temporary directory path for a worktree.
 * @param branch - The branch name (used in the directory name)
 * @returns Temporary directory path
 */
export function getWorktreePath(branch: string): string {
    const safeBranch = branch.replace(/[^a-zA-Z0-9]/g, '-');
    const timestamp = Date.now();
    return path.join(os.tmpdir(), `cpp-actions-release-${safeBranch}-${timestamp}`);
}

/**
 * Creates a new worktree for a branch.
 * @param branch - The branch to check out
 * @param worktreePath - The path for the worktree
 * @param options - Git options (cwd should be the main repo)
 * @returns Information about the created worktree
 */
export function createWorktree(branch: string, worktreePath: string, options: GitOptions): WorktreeInfo {
    console.log(`Creating worktree for ${branch} at ${worktreePath}...`);

    // Ensure the parent directory exists
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    // Create the worktree
    git(['worktree', 'add', worktreePath, branch], options);

    // Get the commit SHA
    const commitSha = git(['rev-parse', 'HEAD'], { cwd: worktreePath, silent: true }).trim();

    console.log(`Worktree created at ${worktreePath}`);

    return {
        path: worktreePath,
        branch,
        commitSha
    };
}

/**
 * Removes a worktree.
 * @param worktreePath - The path to the worktree
 * @param options - Git options (cwd should be the main repo)
 * @param force - Whether to force removal
 */
export function removeWorktree(worktreePath: string, options: GitOptions, force = false): void {
    console.log(`Removing worktree at ${worktreePath}...`);

    const args = ['worktree', 'remove'];
    if (force) {
        args.push('--force');
    }
    args.push(worktreePath);

    try {
        git(args, { ...options, silent: true });
        console.log('Worktree removed');
    } catch (err) {
        // Try force removal if normal removal fails
        if (!force) {
            console.log('Normal removal failed, trying force removal...');
            removeWorktree(worktreePath, options, true);
        } else {
            // Last resort: manual cleanup
            console.log('Force removal failed, attempting manual cleanup...');
            try {
                if (fs.existsSync(worktreePath)) {
                    fs.rmSync(worktreePath, { recursive: true, force: true });
                }
                git(['worktree', 'prune'], { ...options, silent: true });
                console.log('Manual cleanup completed');
            } catch (cleanupErr) {
                console.error(`Warning: Could not clean up worktree at ${worktreePath}`);
            }
        }
    }
}

/**
 * Lists all worktrees.
 * @param options - Git options
 * @returns Array of worktree paths
 */
export function listWorktrees(options: GitOptions): string[] {
    const output = git(['worktree', 'list', '--porcelain'], { ...options, silent: true });
    const paths: string[] = [];

    for (const line of output.split('\n')) {
        if (line.startsWith('worktree ')) {
            paths.push(line.substring(9));
        }
    }

    return paths;
}

/**
 * Prunes stale worktree entries.
 * @param options - Git options
 */
export function pruneWorktrees(options: GitOptions): void {
    gitSafe(['worktree', 'prune'], options);
}

/**
 * Context manager for worktree operations.
 * Ensures the worktree is cleaned up even if an error occurs.
 */
export class WorktreeContext {
    private worktreePath: string | null = null;
    private mainRepoOptions: GitOptions;

    /**
     * Creates a new worktree context.
     * @param mainRepoOptions - Git options for the main repository
     */
    constructor(mainRepoOptions: GitOptions) {
        this.mainRepoOptions = mainRepoOptions;
    }

    /**
     * Creates a worktree and returns options for operating in it.
     * @param branch - The branch to check out
     * @returns Git options configured for the worktree
     */
    create(branch: string): GitOptions {
        this.worktreePath = getWorktreePath(branch);
        createWorktree(branch, this.worktreePath, this.mainRepoOptions);
        return { cwd: this.worktreePath };
    }

    /**
     * Gets the worktree path.
     * @returns The worktree path or null if not created
     */
    getPath(): string | null {
        return this.worktreePath;
    }

    /**
     * Cleans up the worktree.
     */
    cleanup(): void {
        if (this.worktreePath) {
            removeWorktree(this.worktreePath, this.mainRepoOptions, true);
            this.worktreePath = null;
        }
    }
}
