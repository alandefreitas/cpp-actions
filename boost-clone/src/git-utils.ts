/**
 * Git utilities for boost-clone action.
 *
 * @module git-utils
 */

import * as exec from '@actions/exec';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';
import type { Inputs } from './schema';

/**
 * Detected git executable capabilities.
 */
export interface GitFeatures {
    /** Path to the git executable */
    gitPath: string;
    /** Parsed git version */
    version: semver.SemVer;
    /** Whether git supports --jobs for parallel submodule fetches */
    supportsJobs: boolean;
    /** Whether git supports fsmonitor/scan scripts */
    supportsScanScripts: boolean;
    /** Whether git supports --depth for shallow submodule clones */
    supportsDepth: boolean;
}

import * as setup_program from 'setup-program';

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git';

/**
 * Detects the git executable and its feature capabilities.
 *
 * @param _inputs - Action inputs (currently unused)
 * @returns Git path, version, and supported features
 * @throws Error if git is not found
 */
export async function findGitFeatures(_inputs: Inputs): Promise<GitFeatures> {
    const gitPath = await setup_program.findGit();
    if (!gitPath) {
        throw new Error('Git not found');
    }
    const { stdout } = await exec.getExecOutput(`"${gitPath}"`, ['--version']);
    const versionOutput = stdout.trim();
    const versionRegex = /(\d+\.\d+\.\d+)/;
    const versionMatches = versionOutput.match(versionRegex);
    const versionStr = versionMatches![1];
    const version = semver.coerce(versionStr, { includePrerelease: false, loose: true })!;
    const supportsJobs = semver.gte(version, '2.27.0');
    const supportsScanScripts = semver.gte(version, '3.5.0');
    const supportsDepth = semver.gte(version, '2.17.0');
    return { gitPath, version, supportsJobs, supportsScanScripts, supportsDepth };
}

/**
 * Clones a git repository to a local directory at the given branch.
 *
 * @param url - Repository URL to clone
 * @param dest - Local directory to clone into
 * @param branch - Branch or tag to check out
 */
export async function cloneRepo(url: string, dest: string, branch: string): Promise<void> {
    await setup_program.cloneGitRepo(url, dest, branch);
}

/**
 * Clones the Boost super-project repository to the target directory.
 *
 * @param inputs - Action inputs containing branch and directory settings
 */
export async function cloneBoostSuperproject(inputs: Inputs): Promise<void> {
    await setup_program.cloneGitRepo(boostSuperProjectRepo, inputs.boostDir, inputs.branch);
}

/**
 * Extracts the repository name from a git URL.
 *
 * @param url - Git repository URL
 * @returns The repository name without path or extension
 */
export function getRepoName(url: string): string {
    // Strip query parameters and fragment identifiers
    const cleanUrl = url.split(/[?#]/)[0];

    // Remove trailing slashes and the `.git` extension if present
    return cleanUrl.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop()!;
}

/**
 * Applies patch repositories by cloning them into the Boost libs directory.
 *
 * When `preScannedDirs` contains a temp directory for a patch (from dependency
 * pre-scanning), the directory is moved into place instead of re-cloning.
 *
 * @param inputs - Action inputs containing patches and directory settings
 * @param preScannedDirs - Map of patch name to temp directory from pre-scanning
 */
export async function applyPatches(inputs: Inputs, preScannedDirs?: Map<string, string>): Promise<void> {
    const fnlog = traceCommands.scoped('applyPatches');

    await Promise.all([...inputs.patches].map(async (patch) => {
        const patchName = getRepoName(patch);
        const patchDir = path.join(inputs.boostDir, 'libs', patchName);
        try {
            await fsp.access(patchDir);
            fnlog(`Removing existing directory: ${patchDir}`);
            await fsp.rm(patchDir, { recursive: true });
        } catch {
            // Directory doesn't exist, no need to remove
        }

        const preScannedDir = preScannedDirs?.get(patchName);
        if (preScannedDir) {
            fnlog(`Reusing pre-scanned clone: ${preScannedDir} → ${patchDir}`);
            // Remove from the map so cleanupPatchCloneDirs doesn't try
            // to delete an already-moved directory.
            preScannedDirs!.delete(patchName);
            try {
                await fsp.mkdir(path.dirname(patchDir), { recursive: true });
                await fsp.rename(preScannedDir, patchDir);
            } catch {
                // rename can fail across filesystems; fall back to clone
                fnlog(`Rename failed, falling back to clone`);
                await setup_program.cloneGitRepo(patch, patchDir, inputs.branch);
                await fsp.rm(preScannedDir, { recursive: true, force: true }).catch(() => {});
            }
        } else {
            await setup_program.cloneGitRepo(patch, patchDir, inputs.branch);
        }
    }));
}
