/**
 * Main release orchestration logic.
 */

import { execSync } from 'child_process';
import {
    fetchOrigin,
    getCommitSha,
    getCommitMessage,
    refExists,
    isWorkingTreeClean,
    createTag,
    createTagForce,
    pushBranchToOrigin,
    pushTagToOrigin,
    pushTagForce,
    rebase,
    getLog,
    gitSafe,
    commitAll,
    getChangeSummary,
    type GitOptions
} from './git';
import { WorktreeContext } from './worktree';
import { askConsent } from './prompt';
import { isValidSemver, normalizeTag, extractVersion, parseSemver } from './version';
import * as fs from 'fs';
import * as path from 'path';

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
 * Checks whether all workspaces (including root) already have the target version.
 * If any package.json is missing or has a different version, returns false.
 * @param cwd - Repo root
 * @param targetVersion - Version string without 'v' prefix
 */
function packagesAlreadyOnVersion(cwd: string, targetVersion: string): boolean {
    try {
        const rootPkgPath = path.join(cwd, 'package.json');
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
        const workspaces: string[] = rootPkg.workspaces ?? [];
        const packageFiles = [rootPkgPath, ...workspaces.map(w => path.join(cwd, w, 'package.json'))];

        for (const pkgPath of packageFiles) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.version !== targetVersion) {
                return false;
            }
        }
        return true;
    } catch {
        // Fall back to running version:set if anything goes wrong
        return false;
    }
}

/**
 * Checks if working tree is clean and offers to commit changes if not.
 * @param gitOpts - Git options
 * @param stepName - Name of the step that may have introduced changes
 * @param commitMessage - Message to use if committing changes
 * @param options - Release options for consent prompts
 * @returns True if can proceed (clean or committed), false if user wants to abort
 */
async function requireCleanWorktree(
    gitOpts: GitOptions,
    stepName: string,
    commitMessage: string,
    options: ReleaseOptions
): Promise<boolean> {
    if (isWorkingTreeClean(gitOpts)) {
        return true;
    }

    console.log(`\n⚠️  ${stepName} introduced changes to the working tree.`);
    const changes = getChangeSummary(gitOpts);
    console.log('Changed files:');
    console.log(changes);

    const consent = await askConsent(
        `Commit these changes`,
        `git add -A && git commit -m "${commitMessage}"`,
        options.skipPrompts,
        options.dryRun,
        true // default yes
    );

    if (!consent) {
        if (options.dryRun) {
            console.log(`[DRY RUN] Would commit: ${commitMessage}`);
            return true;
        }
        console.log('Please review, commit, or stash these changes before continuing.');
        console.log('Run the release script again after handling the changes.\n');
        return false;
    }

    commitAll(commitMessage, gitOpts);
    return true;
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
    action: () => void,
    defaultYes = true,
    continueOnFailure = false
): Promise<StepResult> {
    const consent = await askConsent(description, command, options.skipPrompts, options.dryRun, defaultYes);

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
        if (continueOnFailure) {
            console.warn(`Non-blocking failure: ${description} - ${errorMessage}`);
            return { success: true, message: `Non-blocking failure: ${description}` };
        }
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
    const versionsAligned = packagesAlreadyOnVersion(rootDir, version);
    if (versionsAligned) {
        console.log(`All packages already at ${version}; skipping version:set.`);
    } else {
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
        if (!dryRun && !await requireCleanWorktree(
            gitOpts,
            'Version update',
            `chore: bump version to ${version}`,
            options
        )) {
            return false;
        }
    }

    // Pre-release Step 2: Rebuild all bundles
    console.log('\n==== Pre-release: Rebuild bundles ====');
    const buildResult = await executeStep(
        'Regenerate dist outputs for fresh builds',
        'npm run build',
        options,
        () => runNpmScript('build', rootDir),
        true // default Yes; rebuilding should generally proceed
    );
    if (!buildResult.success && !dryRun) {
        console.error(buildResult.message);
        return false;
    }
    if (!dryRun && !await requireCleanWorktree(
        gitOpts,
        'Build',
        `chore: rebuild dist bundles for ${normalizedTag}`,
        options
    )) {
        return false;
    }

    // Pre-release Step 3: Dependency audit
    console.log('\n==== Pre-release: Dependency audit ====');
    const depcheckResult = await executeStep(
        'Run depcheck to verify dependency health',
        'npm run depcheck',
        options,
        () => runNpmScript('depcheck', rootDir),
        true, // default Yes
        true  // continue even if depcheck reports unused deps
    );
    if (!depcheckResult.success && !dryRun) {
        console.error(depcheckResult.message);
        return false;
    }
    if (!dryRun && !await requireCleanWorktree(
        gitOpts,
        'Depcheck',
        `chore: depcheck fixes for ${normalizedTag}`,
        options
    )) {
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
    if (!dryRun && !await requireCleanWorktree(
        gitOpts,
        'Dependency updates',
        `chore: update dependencies for ${normalizedTag}`,
        options
    )) {
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
            const remoteIsAncestor = gitSafe(
                ['merge-base', '--is-ancestor', 'origin/develop', 'refs/heads/develop'],
                gitOpts
            );
            const localIsAncestor = gitSafe(
                ['merge-base', '--is-ancestor', 'refs/heads/develop', 'origin/develop'],
                gitOpts
            );

            if (remoteIsAncestor && !localIsAncestor) {
                console.log('Local develop is ahead of origin/develop.');
                console.log(`Local develop:  ${localDevelop}  ${getCommitMessage('refs/heads/develop', gitOpts)}`);
                console.log(`Remote develop: ${remoteDevelop}  ${getCommitMessage('origin/develop', gitOpts)}`);
                const pushDevelop = await executeStep(
                    'Push develop to origin',
                    'git push origin refs/heads/develop:refs/heads/develop',
                    options,
                    () => pushBranchToOrigin('develop', gitOpts),
                    true // default yes
                );
                if (!pushDevelop.success) {
                    console.error(pushDevelop.message);
                    return false;
                }
            } else if (localIsAncestor && !remoteIsAncestor) {
                console.error('Local develop is behind origin/develop.');
                console.error(`Local develop:  ${localDevelop}  ${getCommitMessage('refs/heads/develop', gitOpts)}`);
                console.error(`Remote develop: ${remoteDevelop}  ${getCommitMessage('origin/develop', gitOpts)}`);
                console.error('\nPlease pull or rebase develop before releasing.');
                return false;
            } else {
                console.error('Local and origin develop have diverged. Please reconcile before releasing.');
                console.error(`Local develop:  ${localDevelop}  ${getCommitMessage('refs/heads/develop', gitOpts)}`);
                console.error(`Remote develop: ${remoteDevelop}  ${getCommitMessage('origin/develop', gitOpts)}`);
                return false;
            }
        } else {
            console.log(`\u2705 develop branch is up to date (${localDevelop.substring(0, 8)})`);
        }
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
            const worktreePath = worktreeContext.getPath();
            const rebaseCmd = worktreePath
                ? `git -C ${worktreePath} rebase origin/develop`
                : 'git rebase origin/develop';

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
                    'Rebase master worktree onto origin/develop (does not touch your local develop)',
                    rebaseCmd,
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
            'git push origin refs/heads/master:refs/heads/master',
            options,
            () => {
                if (worktreeOpts) {
                    pushBranchToOrigin('master', worktreeOpts);
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
            `git push origin refs/tags/${normalizedTag}:refs/tags/${normalizedTag}`,
            options,
            () => {
                if (worktreeOpts) {
                    pushTagToOrigin(normalizedTag, worktreeOpts);
                }
            }
        );
        if (!pushTagResult.success && !dryRun) {
            console.error(pushTagResult.message);
            return false;
        }

        // Step 8: Create rolling major/minor tags
        console.log('\n==== Step 8: Create rolling tags ====');
        const semver = parseSemver(normalizedTag);
        const majorTag = `v${semver.major}`;
        const minorTag = `v${semver.major}.${semver.minor}`;

        const createRollingTagsResult = await executeStep(
            `Create rolling tags ${majorTag} and ${minorTag}`,
            `git tag -f ${majorTag} && git tag -f ${minorTag}`,
            options,
            () => {
                if (worktreeOpts) {
                    createTagForce(majorTag, worktreeOpts);
                    createTagForce(minorTag, worktreeOpts);
                }
            }
        );
        if (!createRollingTagsResult.success && !dryRun) {
            console.error(createRollingTagsResult.message);
            return false;
        }

        // Step 9: Push rolling tags to origin
        console.log('\n==== Step 9: Push rolling tags to origin ====');
        const pushRollingTagsResult = await executeStep(
            `Force-push rolling tags ${majorTag} and ${minorTag} to origin`,
            `git push --force origin refs/tags/${majorTag} refs/tags/${minorTag}`,
            options,
            () => {
                if (worktreeOpts) {
                    pushTagForce(majorTag, worktreeOpts);
                    pushTagForce(minorTag, worktreeOpts);
                }
            }
        );
        if (!pushRollingTagsResult.success && !dryRun) {
            console.error(pushRollingTagsResult.message);
            return false;
        }

    } finally {
        // Step 10: Cleanup worktree
        console.log('\n==== Step 10: Cleanup ====');
        if (!dryRun) {
            worktreeContext.cleanup();
        } else {
            console.log('[DRY RUN] Would remove worktree');
        }
    }

    // Success!
    const semverFinal = parseSemver(normalizedTag);
    const majorTagFinal = `v${semverFinal.major}`;
    const minorTagFinal = `v${semverFinal.major}.${semverFinal.minor}`;

    console.log('\n========================================');
    if (dryRun) {
        console.log(`  [DRY RUN] Release ${normalizedTag} would be created`);
        console.log(`  Rolling tags ${majorTagFinal} and ${minorTagFinal} would be updated`);
    } else {
        console.log(`  \u2705 Release ${normalizedTag} completed successfully!`);
        console.log(`\n  Tags pushed to origin:`);
        console.log(`    - ${normalizedTag} (full version)`);
        console.log(`    - ${minorTagFinal} (rolling minor)`);
        console.log(`    - ${majorTagFinal} (rolling major)`);
    }
    console.log('========================================\n');

    return true;
}
