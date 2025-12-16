/**
 * Git operations for the release workflow.
 */

import { execSync, ExecSyncOptions } from 'child_process';

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

    const command = `git ${args.join(' ')}`;
    return execSync(command, execOptions) as string;
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
 * Pushes a ref to origin.
 * @param ref - The ref to push
 * @param options - Execution options
 */
export function pushToOrigin(ref: string, options: GitOptions): void {
    console.log(`Pushing ${ref} to origin...`);
    git(['push', 'origin', ref], options);
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
