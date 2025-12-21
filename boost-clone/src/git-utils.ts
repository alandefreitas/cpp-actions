/**
 * Git utilities for boost-clone action.
 *
 * @module git-utils
 */

import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as trace_commands from 'trace-commands';
import { Inputs, GitFeatures } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git';

/**
 * Detects the git executable and its feature capabilities.
 *
 * @param _inputs - Action inputs (currently unused)
 * @returns Git path, version, and supported features
 */
export async function findGitFeatures(_inputs: Inputs): Promise<GitFeatures> {
    const gitPath = await setup_program.findGit();
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
 * Clones the Boost super-project repository to the target directory.
 *
 * @param inputs - Action inputs containing branch and directory settings
 */
export async function cloneBoostSuperproject(inputs: Inputs): Promise<void> {
    await setup_program.cloneGitRepo(boostSuperProjectRepo, inputs.boost_dir, inputs.branch);
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
 * @param inputs - Action inputs containing patches and directory settings
 */
export async function applyPatches(inputs: Inputs): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log(`applyPatches: ${msg}`);
    }

    for (const patch of inputs.patches) {
        const patchName = getRepoName(patch);
        const patchDir = path.join(inputs.boost_dir, 'libs', patchName);
        if (fs.existsSync(patchDir)) {
            fnlog(`Removing existing directory: ${patchDir}`);
            fs.rmdirSync(patchDir, { recursive: true });
        }
        await setup_program.cloneGitRepo(patch, patchDir, inputs.branch);
    }
}
