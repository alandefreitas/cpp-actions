/**
 * Coveralls coverage-reporter download and coverage upload.
 *
 * Downloads the official Coveralls coverage-reporter binary and uploads
 * LCOV coverage data to the Coveralls service.
 *
 * @module upload-coveralls
 */

import * as fs from 'node:fs/promises';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as traceCommands from 'trace-commands';

const fnlog = traceCommands.scoped('upload-coveralls');

/**
 * Options for uploading coverage data to Coveralls.
 */
export interface CoverallsUploadOptions {
    /** Coveralls repo token */
    token: string;
    /** Absolute path to the LCOV .info file */
    lcovFile: string;
    /** Extra CLI arguments appended to the upload command */
    extraArgs: string;
    /** Whether to throw on upload failure (false = warn and continue) */
    failOnError: boolean;
}

/**
 * Downloads the Coveralls coverage-reporter binary for the current platform.
 *
 * @returns Absolute path to the downloaded coverage-reporter binary
 * @throws Error if the download fails
 */
async function downloadCoverallsCli(): Promise<string> {
    const platformMap: Record<string, string> = {
        linux: 'coveralls-linux',
        darwin: 'coveralls-macos',
        win32: 'coveralls-windows.exe'
    };
    const binaryName = platformMap[process.platform];
    if (!binaryName) {
        throw new Error(
            `Unsupported platform '${process.platform}' for Coveralls CLI download. ` +
            `Supported: linux, darwin, win32.`
        );
    }
    const url =
        `https://github.com/coverallsapp/coverage-reporter/releases/latest/download/${binaryName}`;
    fnlog(`Downloading Coveralls coverage-reporter from ${url}`);
    const downloadPath = await tc.downloadTool(url);
    await fs.chmod(downloadPath, 0o755);
    return downloadPath;
}

/**
 * Uploads coverage data to Coveralls using the official coverage-reporter CLI.
 *
 * Downloads the Coveralls coverage-reporter binary, then runs it with the
 * provided LCOV file and options. If the upload fails and `failOnError` is
 * false, a warning is logged instead of throwing.
 *
 * @param options - Upload configuration
 * @throws Error if the upload fails and `failOnError` is true
 */
export async function uploadToCoveralls(
    options: CoverallsUploadOptions
): Promise<void> {
    core.startGroup('☁️ Upload to Coveralls');
    try {
        core.setSecret(options.token);
        const reporterPath = await downloadCoverallsCli();

        const args = [
            '--repo-token',
            options.token,
            '--file',
            options.lcovFile
        ];

        if (options.extraArgs) {
            const extra = options.extraArgs
                .split(/\s+/)
                .filter((a) => a.length > 0);
            args.push(...extra);
        }

        await exec.getExecOutput(reporterPath, args);
        core.info('Coverage uploaded to Coveralls successfully.');
    } catch (error) {
        const message = `Coveralls upload failed: ${error instanceof Error ? error.message : String(error)}`;
        if (options.failOnError) {
            throw new Error(message);
        }
        core.warning(message);
    } finally {
        core.endGroup();
    }
}
