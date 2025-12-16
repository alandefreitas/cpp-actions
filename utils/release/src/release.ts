/**
 * Main release orchestration logic.
 */

import { execSync } from 'child_process';
import {
    git,
    fetchOrigin,
    getCommitSha,
    getCommitMessage,
    refExists,
    isWorkingTreeClean,
    createTag,
    pushToOrigin,
    rebase,
    getLog,
    GitOptions
} from './git';
import { WorktreeContext } from './worktree';
import { askConsent } from './prompt';
import { isValidSemver, normalizeTag, extractVersion } from './version';

/**
 * Runs an npm script in the repository root.
 * @param script - The npm script to run (e.g., 'version:set -- 1.2.3')
 * @param cwd - Working directory
 */
function runNpmScript(script: string, cwd: string): void {
    execSync(`npm run ${script}`, {
        cwd,
        stdio: 'inherit'
    });
}

/**
 * Checks if working tree is clean and prompts user to handle changes.
 * @param gitOpts - Git options
 * @param stepName - Name of the step that may have introduced changes
 * @returns True if can proceed, false if user wants to abort
 */
function requireCleanWorktree(gitOpts: GitOptions, stepName: string): boolean {
    if (isWorkingTreeClean(gitOpts)) {
        return true;
    }

    console.log(`\n⚠️  ${stepName} introduced changes to the working tree.`);
    console.log('Please review, commit, or stash these changes before continuing.');
    console.log('Run the release script again after handling the changes.\n');
    return false;
}

/**
 * Options for the release process.
 */
export interface ReleaseOptions {
    /** The version tag to release */
    tag: string;
    /** Whether to skip confirmation prompts */
    skipPrompts: boolean;
    /** Whether this is a dry run */
    dryRun: boolean;
    /** Root directory of the repository */
    rootDir: string;
}

/**
 * Result of a release step.
 */
interface StepResult {
    success: boolean;
    message: string;
}

/**
 * Executes a release step with consent.
 * @param description - Description of what the step does
 * @param command - The command that will be run
 * @param options - Release options
 * @param action - The action to execute
 * @returns Step result
 */
async function executeStep(
    description: string,
    command: string,
    options: ReleaseOptions,
    action: () => void
): Promise<StepResult> {
    const consent = await askConsent(description, command, options.skipPrompts, options.dryRun);

    if (!consent) {
        if (options.dryRun) {
            return { success: true, message: `[DRY RUN] Would: ${description}` };
        }
        return { success: false, message: 'User declined' };
    }

    try {
        action();
        return { success: true, message: description };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Failed: ${description} - ${errorMessage}` };
    }
}

/**
 * Executes the release process.
 * @param options - Release options
 * @returns Promise resolving to true if release succeeded
 */
export async function executeRelease(options: ReleaseOptions): Promise<boolean> {
    const { tag, rootDir, dryRun } = options;
    const gitOpts: GitOptions = { cwd: rootDir };

    // Validate tag format
    if (!isValidSemver(tag)) {
        console.error(`Invalid tag format: ${tag}`);
        console.error('Expected format: vX.Y.Z (e.g., v1.2.3)');
        return false;
    }

    const normalizedTag = normalizeTag(tag);
    const version = extractVersion(normalizedTag);

    console.log(`\n========================================`);
    console.log(`  Release ${normalizedTag}`);
    console.log(`========================================\n`);

    if (dryRun) {
        console.log('[DRY RUN MODE] No changes will be made\n');
    }

    // Pre-release Step 1: Update package versions
    console.log('\n==== Pre-release: Update package versions ====');
    const versionResult = await executeStep(
        `Update package.json versions to ${version}`,
        `npm run version:set -- ${version}`,
        options,
        () => runNpmScript(`version:set -- ${version}`, rootDir)
    );
    if (!versionResult.success && !dryRun) {
        console.error(versionResult.message);
        return false;
    }
    if (!dryRun && !requireCleanWorktree(gitOpts, 'Version update')) {
        return false;
    }

    // Pre-release Step 2: Rebuild all bundles
    console.log('\n==== Pre-release: Rebuild bundles ====');
    const buildResult = await executeStep(
        'Regenerate dist outputs for fresh builds',
        'npm run build',
        options,
        () => runNpmScript('build', rootDir)
    );
    if (!buildResult.success && !dryRun) {
        console.error(buildResult.message);
        return false;
    }
    if (!dryRun && !requireCleanWorktree(gitOpts, 'Build')) {
        return false;
    }

    // Pre-release Step 3: Dependency audit
    console.log('\n==== Pre-release: Dependency audit ====');
    const depcheckResult = await executeStep(
        'Run depcheck to verify dependency health',
        'npm run depcheck',
        options,
        () => runNpmScript('depcheck', rootDir)
    );
    if (!depcheckResult.success && !dryRun) {
        console.error(depcheckResult.message);
        return false;
    }
    if (!dryRun && !requireCleanWorktree(gitOpts, 'Depcheck')) {
        return false;
    }

    // Pre-release Step 4: Update dependencies
    console.log('\n==== Pre-release: Update dependencies ====');
    const updateDepsResult = await executeStep(
        'Update package versions',
        'npm run update-deps',
        options,
        () => runNpmScript('update-deps', rootDir)
    );
    if (!updateDepsResult.success && !dryRun) {
        console.error(updateDepsResult.message);
        return false;
    }
    if (!dryRun && !requireCleanWorktree(gitOpts, 'Dependency updates')) {
        return false;
    }

    // Step 1: Fetch from origin
    console.log('\n==== Step 1: Fetch from origin ====');
    const fetchResult = await executeStep(
        'Fetch latest refs from origin',
        'git fetch origin',
        options,
        () => fetchOrigin(gitOpts)
    );
    if (!fetchResult.success && !dryRun) {
        console.error(fetchResult.message);
        return false;
    }

    // Step 2: Verify develop branch
    console.log('\n==== Step 2: Verify develop branch ====');
    if (!dryRun) {
        if (!refExists('refs/heads/develop', gitOpts)) {
            console.error('Local develop branch not found');
            return false;
        }

        const localDevelop = getCommitSha('refs/heads/develop', gitOpts);
        const remoteDevelop = getCommitSha('origin/develop', gitOpts);

        if (localDevelop !== remoteDevelop) {
            console.error('Local develop branch is not up to date with remote.');
            console.error(`Local develop:  ${localDevelop}`);
            console.error(`  ${getCommitMessage('refs/heads/develop', gitOpts)}`);
            console.error(`Remote develop: ${remoteDevelop}`);
            console.error(`  ${getCommitMessage('origin/develop', gitOpts)}`);
            console.error('\nPlease update your local develop branch first.');
            return false;
        }
        console.log(`\u2705 develop branch is up to date (${localDevelop.substring(0, 8)})`);
    } else {
        console.log('[DRY RUN] Would verify develop matches origin/develop');
    }

    // Step 3: Create worktree for master
    console.log('\n==== Step 3: Create worktree for master ====');
    const worktreeContext = new WorktreeContext(gitOpts);
    let worktreeOpts: GitOptions | null = null;

    try {
        if (!dryRun) {
            if (!refExists('refs/heads/master', gitOpts)) {
                console.error('Local master branch not found');
                return false;
            }

            worktreeOpts = worktreeContext.create('master');
            console.log(`\u2705 Worktree created at ${worktreeContext.getPath()}`);
        } else {
            console.log('[DRY RUN] Would create worktree for master branch');
        }

        // Step 4: Rebase master onto origin/develop if needed
        console.log('\n==== Step 4: Update master branch ====');
        if (!dryRun && worktreeOpts) {
            const masterSha = getCommitSha('HEAD', worktreeOpts);
            const remoteDevelop = getCommitSha('origin/develop', gitOpts);

            if (masterSha !== remoteDevelop) {
                console.log('master is not up to date with origin/develop');
                console.log(`master:         ${masterSha.substring(0, 8)} ${getCommitMessage('HEAD', worktreeOpts)}`);
                console.log(`origin/develop: ${remoteDevelop.substring(0, 8)} ${getCommitMessage('origin/develop', gitOpts)}`);

                const pendingCommits = getLog('HEAD', 'origin/develop', worktreeOpts);
                if (pendingCommits.trim()) {
                    console.log('\nCommits to be added to master:');
                    console.log(pendingCommits);
                }

                const rebaseResult = await executeStep(
                    'Rebase master onto origin/develop',
                    'git rebase origin/develop',
                    options,
                    () => rebase('origin/develop', worktreeOpts!)
                );
                if (!rebaseResult.success) {
                    console.error(rebaseResult.message);
                    return false;
                }
            } else {
                console.log(`\u2705 master is already at origin/develop (${masterSha.substring(0, 8)})`);
            }
        } else {
            console.log('[DRY RUN] Would rebase master onto origin/develop if needed');
        }

        // Step 5: Push master to origin
        console.log('\n==== Step 5: Push master to origin ====');
        const pushMasterResult = await executeStep(
            'Push master to origin',
            'git push origin master',
            options,
            () => {
                if (worktreeOpts) {
                    pushToOrigin('master', worktreeOpts);
                }
            }
        );
        if (!pushMasterResult.success && !dryRun) {
            console.error(pushMasterResult.message);
            return false;
        }

        // Step 6: Create tag
        console.log('\n==== Step 6: Create tag ====');
        const createTagResult = await executeStep(
            `Create local tag ${normalizedTag}`,
            `git tag ${normalizedTag}`,
            options,
            () => {
                if (worktreeOpts) {
                    createTag(normalizedTag, worktreeOpts);
                }
            }
        );
        if (!createTagResult.success && !dryRun) {
            console.error(createTagResult.message);
            return false;
        }

        // Step 7: Push tag to origin
        console.log('\n==== Step 7: Push tag to origin ====');
        const pushTagResult = await executeStep(
            `Push tag ${normalizedTag} to origin`,
            `git push origin ${normalizedTag}`,
            options,
            () => {
                if (worktreeOpts) {
                    pushToOrigin(normalizedTag, worktreeOpts);
                }
            }
        );
        if (!pushTagResult.success && !dryRun) {
            console.error(pushTagResult.message);
            return false;
        }

    } finally {
        // Step 8: Cleanup worktree
        console.log('\n==== Step 8: Cleanup ====');
        if (!dryRun) {
            worktreeContext.cleanup();
        } else {
            console.log('[DRY RUN] Would remove worktree');
        }
    }

    // Success!
    console.log('\n========================================');
    if (dryRun) {
        console.log(`  [DRY RUN] Release ${normalizedTag} would be created`);
    } else {
        console.log(`  \u2705 Release ${normalizedTag} completed successfully!`);
        console.log(`\n  Tag ${normalizedTag} has been created and pushed to origin.`);
    }
    console.log('========================================\n');

    return true;
}
