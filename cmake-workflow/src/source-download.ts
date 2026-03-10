/**
 * Source code download and patching for cmake-workflow action.
 *
 * @module source-download
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import * as os from 'os';
import * as trace_commands from 'trace-commands';

import { Inputs } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

/**
 * Downloads source code from a URL.
 *
 * @param inputs - Workflow inputs with URL and download directory
 * @throws Error if download fails
 */
export async function downloadUrlSourceCode(inputs: Inputs): Promise<void> {
    if (inputs.download_dir) {
        const res = await setup_program.downloadAndExtract(inputs.url, inputs.download_dir);
        if (res === undefined) {
            throw new Error(`Failed to download source code from ${inputs.url}`);
        }
    } else {
        const res = await setup_program.downloadAndExtract(inputs.url);
        if (res === undefined) {
            throw new Error(`Failed to download source code from ${inputs.url}`);
        }
        inputs.download_dir = res;
    }
    await setup_program.stripSingleDirectoryFromPath(inputs.download_dir);
}

/**
 * Clones a Git repository for building.
 *
 * @param inputs - Workflow inputs with git repository and tag info
 */
export async function cloneGitRepository(inputs: Inputs): Promise<void> {
    if (!inputs.download_dir) {
        inputs.download_dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'source-'));
    }
    inputs.download_dir = path.resolve(inputs.download_dir);
    if (inputs.git_tag) {
        await setup_program.cloneGitRepo(inputs.git_repository, inputs.download_dir, inputs.git_tag, { shallow: true });
    } else {
        await setup_program.cloneGitRepo(inputs.git_repository, inputs.download_dir, undefined, { shallow: true });
    }
}

/**
 * Downloads source code from URL or Git repository.
 *
 * @param inputs - Workflow inputs with source download configuration
 */
export async function downloadSourceCode(inputs: Inputs): Promise<void> {
    if (!inputs.download_dir) {
        inputs.download_dir = inputs.source_dir;
    }
    if (inputs.url) {
        await downloadUrlSourceCode(inputs);
    } else {
        await cloneGitRepository(inputs);
    }
}

/**
 * Applies patches to the source directory.
 *
 * Copies patch files or directories to the source directory.
 *
 * @param inputs - Workflow inputs with patch file paths
 */
export async function applyPatches(inputs: Inputs): Promise<void> {
    const fnlog = trace_commands.scoped('applyPatches');

    if (!inputs.patches || inputs.patches.length === 0) {
        return;
    }
    for (const patch of inputs.patches) {
        if (!patch || patch.trim() === '') {
            fnlog('Skipping empty patch entry');
            continue;
        }
        const patchPath = path.resolve(patch);
        if (!fs.existsSync(patchPath)) {
            fnlog(`Patch file not found: ${patchPath}`);
            continue;
        }
        const isDir = fs.statSync(patchPath).isDirectory();
        if (isDir) {
            // Copy all files from the directory to the source directory
            const files = fs.readdirSync(patchPath);
            for (const file of files) {
                const filePath = path.resolve(patchPath, file);
                const destPath = path.resolve(inputs.source_dir, file);
                core.info(`Copying ${filePath} to ${destPath}`);
                await io.cp(filePath, destPath, { recursive: true, force: true });
            }
        } else {
            const filePath = path.resolve(patch);
            const destPath = path.resolve(inputs.source_dir, path.basename(patch));
            core.info(`Copying ${filePath} to ${destPath}`);
            await io.cp(filePath, destPath, { force: true });
        }
    }
}
