/**
 * System and process utilities for setup-program action.
 *
 * Provides wrappers for executing commands with elevated privileges,
 * checking URL availability, and moving files with permission handling.
 *
 * @module system-utils
 */

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as httpm from '@actions/http-client';
import * as traceCommands from 'trace-commands';

import { type ExecOutput } from './types';

import {
    isSymlink,
    copySymlink
} from './file-utils';

/**
 * Determines whether sudo is required for privileged operations.
 *
 * Returns true on Linux when the current process is not running as root.
 *
 * @returns True if sudo is needed, false otherwise
 */
export function isSudoRequired(): boolean {
    if (process.platform !== 'linux') {
        return false;
    }
    return process.getuid?.() !== 0;
}

/**
 * Executes a command, prepending sudo if required on Linux.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Execution options passed to exec.exec
 * @returns The exit code from the command
 */
export async function execWithSudo(
    command: string,
    args: string[] = [],
    options: exec.ExecOptions = {}
): Promise<number> {
    if (isSudoRequired()) {
        return await exec.exec('sudo', ['-n', command, ...args], options);
    }
    return await exec.exec(command, args, options);
}

/**
 * Executes a command with output capture, prepending sudo if required on Linux.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param options - Execution options passed to exec.getExecOutput
 * @returns The execution output including exit code, stdout, and stderr
 */
export async function getExecOutputWithSudo(
    command: string,
    args: string[] = [],
    options: exec.ExecOptions = {}
): Promise<ExecOutput> {
    if (isSudoRequired()) {
        return await exec.getExecOutput('sudo', ['-n', command, ...args], options);
    }
    return await exec.getExecOutput(command, args, options);
}

/**
 * Checks if a URL exists by sending a HEAD request.
 *
 * @param url - The URL to check
 * @returns True if the URL returns HTTP 200, false otherwise
 */
export async function urlExists(url: string): Promise<boolean> {
    const httpClient = new httpm.HttpClient('setup-clang', [], {
        allowRetries: true, maxRetries: 3
    });
    try {
        const res = await httpClient.head(url);
        return res.message.statusCode === 200;
    } catch {
        return false;
    }
}

/**
 * Ensures the sudo command is available on the system.
 *
 * Installs sudo via apt-get if not already present (requires running as root).
 *
 * @throws Error if sudo cannot be found or installed
 */
export async function ensureSudoIsAvailable(): Promise<void> {
    const fnlog = traceCommands.scoped('ensureSudoIsAvailable');

    let sudoPath: string | null = null;
    try {
        sudoPath = await io.which('sudo');
        fnlog(`sudo found at ${sudoPath}`);
    } catch {
        sudoPath = null;
    }
    if (sudoPath === null || sudoPath === '') {
        await exec.exec(`apt-get update`, [], { ignoreReturnCode: true });
        await exec.exec(`apt-get install -y sudo`, [], { ignoreReturnCode: true });
        await io.which('sudo');
    }
}

/**
 * Moves files using sudo for elevated privileges.
 *
 * Used as a fallback when regular move operations fail due to permission issues.
 *
 * @param source - Source directory path to move from
 * @param destination - Destination directory path to move to
 * @param copyInstead - If true, copy instead of move
 * @param level - Recursion depth for logging indentation
 * @returns True if successful, false if operation failed
 */
async function moveWithSudo(source: string, destination: string, copyInstead = false, level: number): Promise<boolean> {
    const fnlog = traceCommands.scoped('moveWithSudo');

    await ensureSudoIsAvailable();
    const levelPrefix = '  '.repeat(level);
    const files = fs.readdirSync(source);
    let count = 0;
    for (const file of files) {
        const sourcePath = path.join(source, file);
        const destinationPath = path.join(destination, file);
        count++;
        if (isSymlink(sourcePath)) {
            fnlog(`${levelPrefix}${count}) Recreate symlink ${sourcePath} in ${destinationPath}`);
            const targetPath = fs.readlinkSync(sourcePath);
            fnlog(`${levelPrefix}${count}) Symlink found from ${sourcePath} to ${targetPath}`);
            const lnCommand = `sudo ln -sf "${targetPath}" "${destinationPath}"`;
            await exec.getExecOutput(lnCommand);
            fnlog(`${levelPrefix}${count}) Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`);
        } else if (fs.statSync(sourcePath).isDirectory() && fs.existsSync(destinationPath)) {
            const ok = await moveWithSudo(sourcePath, destinationPath, copyInstead, level + 1);
            if (!ok) {
                return false;
            }
        } else {
            const mkdirCommand = `sudo mkdir -p "${destination}"`;
            if (!fs.existsSync(destinationPath)) {
                await exec.getExecOutput(mkdirCommand);
            }
            const mvCommand = `sudo mv "${sourcePath}" "${destination}"`;
            const cpCommand = `sudo cp -r "${sourcePath}" "${destination}"`;
            const command = copyInstead ? cpCommand : mvCommand;
            const { exitCode, stdout }: ExecOutput = await exec.getExecOutput(command);
            const sudoOutput = stdout.trim();
            if (exitCode !== 0) {
                core.warning(`${levelPrefix}${count}) Error occurred while moving with sudo: exit code ${exitCode}`);
                fnlog(sudoOutput);
                return false;
            } else {
                fnlog(`${levelPrefix}${count}) Successfully moved ${sourcePath} to ${destinationPath} with sudo.`);
            }
        }
    }
    return true;
}

/**
 * Moves files considering permissions and ownership that make the operation
 * fail on various environments.
 *
 * Handles cross-device moves by falling back to copy, permission errors by
 * using sudo, and directory merging for existing destinations.
 *
 * @param source - Source directory path to move from
 * @param destination - Destination directory path to move to
 * @param copyInstead - If true, copy instead of move (used for cross-device fallback)
 * @param level - Recursion depth level for logging indentation
 * @returns True if successful, false if move/copy failed
 * @throws Error if a nested move operation fails
 */
export async function moveWithPermissions(source: string, destination: string, copyInstead = false, level = 0): Promise<boolean> {
    const fnlog = traceCommands.scoped('moveWithPermissions');

    const levelPrefix = '  '.repeat(level);
    try {
        // Iterate all files in source directory
        const files = fs.readdirSync(source);
        let count = 0;
        for (const file of files) {
            count++;
            const sourcePath = path.join(source, file);
            const destinationPath = path.join(destination, file);
            fnlog(`${levelPrefix}${count}) Handle move from ${sourcePath} to ${destinationPath}`);
            if (isSymlink(sourcePath)) {
                fnlog(`${levelPrefix}${count}) Recreate symlink ${sourcePath} in ${destinationPath}`);
                copySymlink(sourcePath, destinationPath, level);
            } else if (fs.statSync(sourcePath).isDirectory() && fs.existsSync(destinationPath)) {
                fnlog(`${levelPrefix}${count}) Merge directory ${sourcePath} with existing ${destinationPath}`);
                const ok = await moveWithPermissions(sourcePath, destinationPath, copyInstead, level + 1);
                if (!ok) {
                    throw new Error(`Failed to move ${sourcePath} to ${destinationPath}`);
                }
            } else /* regular file or directory that doesn't exist at destination */ {
                if (!copyInstead) {
                    fnlog(`${levelPrefix}${count}) Moving ${sourcePath} to ${destinationPath}`);
                    await io.mv(sourcePath, destinationPath);
                } else {
                    fnlog(`${levelPrefix}${count}) Copy ${sourcePath} to ${destinationPath}`);
                    await io.cp(sourcePath, destinationPath, { recursive: true });
                }
            }
        }
        fnlog(`${levelPrefix}Successfully moved ${source} to ${destination}.`);
        return true;
    } catch (error: unknown) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        core.info(`${levelPrefix}Error occurred while moving ${source} to ${destination}: ${error} (code : ${errorCode})`);
        // If failed because destination is on a different device, retry as copy
        if (errorCode === 'EXDEV' && !copyInstead) {
            return await moveWithPermissions(source, destination, true, level);
        }
        // If permission denied error, retry the move with sudo
        // Also move with sudo when the file is a symlink and can't be moved because of that
        if (((errorCode || 'EACCES') === 'EACCES' || errorCode === 'ENOENT') && process.platform === 'linux') {
            return await moveWithSudo(source, destination, copyInstead, level);
        }
        return false;
    }
}
