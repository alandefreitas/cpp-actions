/**
 * Git operations for the release workflow.
 */

import { execFileSync, ExecSyncOptions } from 'child_process';

/**
 * Options for git command execution.
 */
export interface GitOptions {
    /** Working directory */
    cwd: string;
    /** Whether to suppress output */
    silent?: boolean;
}

/**
 * Executes a git command and returns the output.
 * Uses execFileSync to properly handle arguments with spaces.
 * @param args - Git command arguments
 * @param options - Execution options
 * @returns Command output as string
 * @throws Error if command fails
 */
export function git(args: string[], options: GitOptions): string {
    const execOptions: ExecSyncOptions = {
        cwd: options.cwd,
        encoding: 'utf-8',
        stdio: options.silent ? ['pipe', 'pipe', 'pipe'] : 'inherit'
    };

    return execFileSync('git', args, execOptions) as string;
}

/**
 * Executes a git command and returns success status.
 * @param args - Git command arguments
 * @param options - Execution options
 * @returns True if command succeeded
 */
export function gitSafe(args: string[], options: GitOptions): boolean {
    try {
        git(args, { ...options, silent: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetches from origin.
 * @param options - Execution options
 */
export function fetchOrigin(options: GitOptions): void {
    console.log('Fetching from origin...');
    git(['fetch', 'origin'], options);
}

/**
 * Gets the current branch name.
 * @param options - Execution options
 * @returns Current branch name or 'HEAD' if detached
 */
export function getCurrentBranch(options: GitOptions): string {
    try {
        return git(['rev-parse', '--abbrev-ref', 'HEAD'], { ...options, silent: true }).trim();
    } catch {
        return 'HEAD';
    }
}

/**
 * Gets the commit SHA for a ref.
 * @param ref - The ref to resolve
 * @param options - Execution options
 * @returns The commit SHA
 */
export function getCommitSha(ref: string, options: GitOptions): string {
    return git(['rev-parse', ref], { ...options, silent: true }).trim();
}

/**
 * Gets the commit message for a ref.
 * @param ref - The ref to get message for
 * @param options - Execution options
 * @returns The commit message (first line)
 */
export function getCommitMessage(ref: string, options: GitOptions): string {
    return git(['log', '-1', '--pretty=format:%s', ref], { ...options, silent: true }).trim();
}

/**
 * Checks if a ref exists.
 * @param ref - The ref to check
 * @param options - Execution options
 * @returns True if ref exists
 */
export function refExists(ref: string, options: GitOptions): boolean {
    return gitSafe(['rev-parse', '--verify', ref], options);
}

/**
 * Checks if working tree is clean (no uncommitted changes to tracked files).
 * @param options - Execution options
 * @returns True if clean
 */
export function isWorkingTreeClean(options: GitOptions): boolean {
    const status = git(['status', '--porcelain', '--untracked-files=no'], { ...options, silent: true });
    return status.trim() === '';
}

/**
 * Creates a tag.
 * @param tag - The tag name
 * @param options - Execution options
 */
export function createTag(tag: string, options: GitOptions): void {
    console.log(`Creating tag ${tag}...`);
    git(['tag', tag], options);
}

/**
 * Creates or updates a tag (force mode).
 * Used for rolling tags like v1 or v1.2 that move with each release.
 * @param tag - The tag name
 * @param options - Execution options
 */
export function createTagForce(tag: string, options: GitOptions): void {
    console.log(`Creating/updating tag ${tag}...`);
    git(['tag', '-f', tag], options);
}

/**
 * Force-pushes a tag to origin using explicit refspec.
 * Used for rolling tags that need to be updated on remote.
 * @param tag - The tag to push
 * @param options - Execution options
 */
export function pushTagForce(tag: string, options: GitOptions): void {
    console.log(`Force-pushing tag ${tag} to origin...`);
    git(['push', '--force', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], options);
}

/**
 * Pushes a branch to origin using explicit refspec to avoid ambiguity.
 * @param branch - The branch name to push
 * @param options - Execution options
 */
export function pushBranchToOrigin(branch: string, options: GitOptions): void {
    console.log(`Pushing branch ${branch} to origin...`);
    git(['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], options);
}

/**
 * Pushes a tag to origin.
 * @param tag - The tag to push
 * @param options - Execution options
 */
export function pushTagToOrigin(tag: string, options: GitOptions): void {
    console.log(`Pushing tag ${tag} to origin...`);
    git(['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], options);
}

/**
 * Rebases current branch onto target.
 * @param target - The target ref to rebase onto
 * @param options - Execution options
 */
export function rebase(target: string, options: GitOptions): void {
    console.log(`Rebasing onto ${target}...`);
    git(['rebase', target], options);
}

/**
 * Gets the log of commits between two refs.
 * @param from - Start ref
 * @param to - End ref
 * @param options - Execution options
 * @returns Log output
 */
export function getLog(from: string, to: string, options: GitOptions): string {
    return git(['log', `${from}..${to}`, '--oneline'], { ...options, silent: true });
}

/**
 * Stages all changes and creates a commit.
 * @param message - The commit message
 * @param options - Execution options
 */
export function commitAll(message: string, options: GitOptions): void {
    console.log('Staging all changes...');
    git(['add', '-A'], options);
    console.log(`Creating commit: ${message}`);
    git(['commit', '-m', message], options);
}

/**
 * Gets a summary of uncommitted changes.
 * @param options - Execution options
 * @returns Short status output
 */
export function getChangeSummary(options: GitOptions): string {
    return git(['status', '--short'], { ...options, silent: true });
}
