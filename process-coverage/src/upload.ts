/**
 * Multi-service coverage upload orchestration.
 *
 * Runs Codecov and Coveralls uploads independently so that a failure
 * in one service does not prevent the other from completing.
 *
 * @module upload
 */

import * as core from '@actions/core';

import { uploadToCodecov } from './upload-codecov';
import { uploadToCoveralls } from './upload-coveralls';

/**
 * Options for the multi-service upload orchestrator.
 */
export interface UploadOptions {
    /** Absolute path to the LCOV .info file */
    lcovFile: string;
    /** Whether to fail the action if any upload fails */
    failOnUploadError: boolean;
    /** Codecov upload token (empty string to skip) */
    codecovToken: string;
    /** Codecov flags */
    codecovFlags: string;
    /** Extra Codecov CLI arguments */
    codecovArgs: string;
    /** Coveralls repo token (empty string to skip) */
    coverallsToken: string;
    /** Extra Coveralls CLI arguments */
    coverallsArgs: string;
}

/**
 * Runs coverage uploads to Codecov and/or Coveralls independently.
 *
 * Each enabled upload runs in its own try/catch so that a failure in one
 * does not prevent the other from completing. Errors are collected and,
 * if `failOnUploadError` is true, a combined error is thrown after both
 * uploads have been attempted.
 *
 * @param options - Upload configuration for all services
 * @throws Error if any upload fails and `failOnUploadError` is true,
 *   with a combined message listing all failures
 */
export async function runUploads(options: UploadOptions): Promise<void> {
    const errors: string[] = [];

    if (options.codecovToken) {
        try {
            await uploadToCodecov({
                token: options.codecovToken,
                lcovFile: options.lcovFile,
                flags: options.codecovFlags,
                extraArgs: options.codecovArgs,
                failOnError: true
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            errors.push(message);
            core.warning(message);
        }
    }

    if (options.coverallsToken) {
        try {
            await uploadToCoveralls({
                token: options.coverallsToken,
                lcovFile: options.lcovFile,
                extraArgs: options.coverallsArgs,
                failOnError: true
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            errors.push(message);
            core.warning(message);
        }
    }

    if (errors.length > 0 && options.failOnUploadError) {
        throw new Error(
            `Coverage upload failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
        );
    }
}
