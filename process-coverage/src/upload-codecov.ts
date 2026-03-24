/**
 * Codecov CLI download and coverage upload.
 *
 * Downloads the official Codecov CLI binary and uploads LCOV coverage
 * data to the Codecov service.
 *
 * @module upload-codecov
 */

import * as fs from 'node:fs/promises';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as traceCommands from 'trace-commands';

const fnlog = traceCommands.scoped('upload-codecov');

/**
 * Options for uploading coverage data to Codecov.
 */
export interface CodecovUploadOptions {
    /** Codecov upload token */
    token: string;
    /** Absolute path to the LCOV .info file */
    lcovFile: string;
    /** Comma-separated flags to tag the upload */
    flags: string;
    /** Extra CLI arguments appended to the upload command */
    extraArgs: string;
    /** Whether to throw on upload failure (false = warn and continue) */
    failOnError: boolean;
}

/**
 * Downloads the Codecov CLI binary for the current platform.
 *
 * @returns Absolute path to the downloaded codecov binary
 * @throws Error if the download fails
 */
async function downloadCodecovCli(): Promise<string> {
    const platformMap: Record<string, string> = {
        linux: 'linux/codecov',
        darwin: 'macos/codecov',
        win32: 'windows/codecov.exe'
    };
    const platformPath = platformMap[process.platform];
    if (!platformPath) {
        throw new Error(
            `Unsupported platform '${process.platform}' for Codecov CLI download. ` +
            `Supported: linux, darwin, win32.`
        );
    }
    const url = `https://cli.codecov.io/latest/${platformPath}`;
    fnlog(`Downloading Codecov CLI from ${url}`);
    const downloadPath = await tc.downloadTool(url);
    await fs.chmod(downloadPath, 0o755);
    return downloadPath;
}

/**
 * Uploads coverage data to Codecov using the official CLI.
 *
 * Downloads the Codecov CLI binary, then runs the `upload-process` command
 * with the provided LCOV file and options. If the upload fails and
 * `failOnError` is false, a warning is logged instead of throwing.
 *
 * @param options - Upload configuration
 * @throws Error if the upload fails and `failOnError` is true
 */
export async function uploadToCodecov(
    options: CodecovUploadOptions
): Promise<void> {
    core.startGroup('☁️ Upload to Codecov');
    try {
        core.setSecret(options.token);
        const codecovPath = await downloadCodecovCli();

        const args = [
            'upload-process',
            '--git-service',
            'github',
            '--file',
            options.lcovFile,
            '--token',
            options.token
        ];

        if (options.flags) {
            args.push('--flag', options.flags);
        }

        if (options.extraArgs) {
            const extra = options.extraArgs
                .split(/\s+/)
                .filter((a) => a.length > 0);
            args.push(...extra);
        }

        await exec.getExecOutput(codecovPath, args);
        core.info('Coverage uploaded to Codecov successfully.');
    } catch (error) {
        const message = `Codecov upload failed: ${error instanceof Error ? error.message : String(error)}`;
        if (options.failOnError) {
            throw new Error(message);
        }
        core.warning(message);
    } finally {
        core.endGroup();
    }
}
