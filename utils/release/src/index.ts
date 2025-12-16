#!/usr/bin/env node
/**
 * Release CLI - Release orchestration for cpp-actions monorepo.
 *
 * This utility replaces the legacy release.sh script, providing a
 * TypeScript-based release workflow that uses git worktrees to avoid
 * checkout conflicts with untracked files.
 */

import * as path from 'path';
import { parseArgs, printHelp } from './cli';
import { determineVersion, isValidSemver, normalizeTag } from './version';
import { executeRelease } from './release';
import { isWorkingTreeClean, getCurrentBranch, GitOptions } from './git';

/**
 * Main entry point for the release CLI.
 */
async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    // Determine root directory (two levels up from dist/index.js)
    const rootDir = path.resolve(__dirname, '../../..');
    const gitOpts: GitOptions = { cwd: rootDir };

    console.log('Release CLI for cpp-actions\n');

    // Check current branch
    const currentBranch = getCurrentBranch(gitOpts);
    console.log(`Current branch: ${currentBranch}`);

    if (currentBranch !== 'develop' && !args.dryRun) {
        console.warn('\nWarning: You are not on the develop branch.');
        console.warn('The release process expects to be run from develop.');
        console.warn('Consider switching to develop before releasing.\n');
    }

    // Check working tree status
    if (!isWorkingTreeClean(gitOpts) && !args.dryRun) {
        console.warn('\nWarning: Working tree has uncommitted changes.');
        console.warn('Consider committing or stashing changes before releasing.\n');
    }

    // Determine version
    let tag: string;
    if (args.version) {
        tag = normalizeTag(args.version);
        if (!isValidSemver(tag)) {
            console.error(`Invalid version format: ${args.version}`);
            console.error('Expected format: X.Y.Z or vX.Y.Z (e.g., 1.2.3 or v1.2.3)');
            process.exit(1);
        }
        console.log(`Using specified version: ${tag}`);
    } else {
        console.log('\nDetermining version...');
        tag = await determineVersion(rootDir);
        if (!isValidSemver(tag)) {
            console.error(`Invalid version: ${tag}`);
            process.exit(1);
        }
    }

    // Execute release
    const success = await executeRelease({
        tag,
        skipPrompts: args.yes,
        dryRun: args.dryRun,
        rootDir
    });

    process.exit(success ? 0 : 1);
}

main().catch((err) => {
    console.error('Release failed with error:', err);
    process.exit(1);
});
