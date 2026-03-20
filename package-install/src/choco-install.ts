/**
 * Chocolatey package installation logic.
 *
 * @module choco-install
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';

import { type Inputs } from './schema';
import { formatTime } from './utils';

/**
 * Checks whether choco output indicates a rate-limit error from the Chocolatey community repository.
 *
 * Detects HTTP 429, "rate limit", and "Too Many Requests" patterns that occur when the
 * community repository enforces its ~20 downloads/min per IP throttle.
 *
 * @param output - Combined stdout/stderr from the choco command
 * @returns True if the output contains rate-limit indicators
 */
export function isRateLimitError(output: string): boolean {
    const lower = output.toLowerCase();
    return lower.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('too many requests');
}

/**
 * Computes retry delay with jitter to prevent thundering herd when multiple parallel
 * CI jobs retry simultaneously against the Chocolatey community repository.
 *
 * Adds random jitter of 0-50% of the base backoff interval.
 *
 * @param baseDelay - Base exponential backoff delay in milliseconds
 * @returns Delay with random jitter added
 */
export function addJitter(baseDelay: number): number {
    const jitter = Math.random() * 0.5 * baseDelay;
    return baseDelay + jitter;
}

/**
 * Installs Chocolatey packages with rate-limit-aware retries and exponential backoff with jitter.
 *
 * Iterates over the choco package list and runs `choco install <package> -y --no-progress`
 * for each. Supports the `--version=X.Y.Z` syntax which is passed through directly to choco.
 *
 * Packages are only installed on Windows. On macOS and Linux, this function is a no-op
 * with a debug log.
 *
 * Retry backoff includes random jitter (0-50% of base interval) to prevent thundering herd
 * when multiple parallel CI jobs hit Chocolatey rate limits simultaneously.
 *
 * @param inputs - Configuration inputs including choco package list and retry settings
 * @throws Error if a package install fails after all retry attempts
 */
export async function chocoMain(inputs: Inputs): Promise<void> {
    const fnlog = traceCommands.scoped('chocoMain');

    if (inputs.choco.length === 0) {
        fnlog('No choco packages to install');
        return;
    }

    if (process.platform !== 'win32') {
        core.debug('Skipping choco installs — Chocolatey is Windows-only');
        return;
    }

    const retries = inputs.chocoRetries || inputs.retries;

    for (const pkg of inputs.choco) {
        core.startGroup(`🍫 Install choco package: ${pkg}`);
        let retryTime = 2000;

        // Parse package name and any --version flag
        const args = ['install', ...pkg.split(/\s+/), '-y', '--no-progress'];

        for (let i = 0; i < retries; i++) {
            let stderr = '';
            let stdout = '';
            const exitCode = await exec.exec('choco', args, {
                ignoreReturnCode: i !== retries - 1,
                listeners: {
                    stderr: (data: Buffer) => {
                        stderr += data.toString();
                    },
                    stdout: (data: Buffer) => {
                        stdout += data.toString();
                    }
                }
            });
            if (exitCode === 0) {
                break;
            }
            if (i !== retries - 1) {
                if (isRateLimitError(stderr + stdout)) {
                    core.warning(
                        `Chocolatey rate limit detected for package ${pkg}. ` +
                        'The community repository enforces ~20 downloads/min per IP. ' +
                        `Retrying with backoff (attempt ${i + 1}/${retries})...`
                    );
                }
                const delay = addJitter(retryTime);
                core.info(`Failed to install choco package ${pkg}, retrying in ${formatTime(delay)}`);
                await new Promise((resolve) => setTimeout(resolve, delay));
                retryTime *= 2;
            }
        }
        core.endGroup();
    }
}
