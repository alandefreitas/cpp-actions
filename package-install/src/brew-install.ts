/**
 * Homebrew package installation logic.
 *
 * @module brew-install
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';
import * as traceCommands from 'trace-commands';

import { type Inputs } from './schema';
import { formatTime } from './utils';

const LINUXBREW_PREFIX = '/home/linuxbrew/.linuxbrew';

/**
 * Sets up Linuxbrew PATH and environment variables on Linux when brew is not already in PATH.
 *
 * On Ubuntu runners, Homebrew is pre-installed at /home/linuxbrew/.linuxbrew but not in PATH
 * since Sep 2022 (runner-images issue #6283). This function performs the equivalent of
 * `eval $(brew shellenv)` by setting HOMEBREW_PREFIX, HOMEBREW_CELLAR, HOMEBREW_REPOSITORY,
 * and adding the bin/sbin directories to PATH.
 *
 * @param fnlog - Scoped logging function for trace output
 * @returns true if brew is available (already in PATH or Linuxbrew was set up), false otherwise
 */
export async function ensureBrewInPath(fnlog: (msg: string) => void): Promise<boolean> {
    // Check if brew is already in PATH
    try {
        await io.which('brew', true);
        fnlog('brew found in PATH');
        return true;
    } catch {
        // brew not in PATH — continue to check for Linuxbrew
    }

    if (process.platform !== 'linux') {
        core.warning('brew is not available — skipping brew packages');
        return false;
    }

    // Check for Linuxbrew installation
    const linuxbrewBin = `${LINUXBREW_PREFIX}/bin/brew`;
    if (!fs.existsSync(linuxbrewBin)) {
        core.warning('brew is not installed — skipping brew packages');
        return false;
    }

    // Set up Linuxbrew environment (equivalent to eval $(brew shellenv))
    fnlog(`Setting up Linuxbrew from ${LINUXBREW_PREFIX}`);
    process.env.HOMEBREW_PREFIX = LINUXBREW_PREFIX;
    process.env.HOMEBREW_CELLAR = `${LINUXBREW_PREFIX}/Cellar`;
    process.env.HOMEBREW_REPOSITORY = `${LINUXBREW_PREFIX}/Homebrew`;

    const currentPath = process.env.PATH ?? '';
    process.env.PATH = `${LINUXBREW_PREFIX}/bin:${LINUXBREW_PREFIX}/sbin:${currentPath}`;

    fnlog('Linuxbrew PATH and environment configured');
    return true;
}

/**
 * Installs Homebrew formula and cask packages with retries and exponential backoff.
 *
 * Iterates over the brew package list and runs `brew install <formula>` for each.
 * Supports the `formula@version` syntax which is passed through directly to brew.
 * Cask packages are installed with `brew install --cask <package>` on macOS only;
 * on Linux, cask installs are silently skipped since casks are macOS GUI apps.
 *
 * @param inputs - Configuration inputs including brew/brewCask package lists and retry settings
 * @throws Error if a package install fails after all retry attempts
 */
export async function brewMain(inputs: Inputs): Promise<void> {
    const fnlog = traceCommands.scoped('brewMain');

    if (inputs.brew.length === 0 && inputs.brewCask.length === 0) {
        fnlog('No brew packages to install');
        return;
    }

    if (process.platform === 'win32') {
        core.debug('Skipping brew installs — Homebrew is not available on Windows');
        return;
    }

    // Ensure brew is available (set up Linuxbrew PATH on Linux if needed)
    const brewAvailable = await ensureBrewInPath(fnlog);
    if (!brewAvailable) {
        return;
    }

    // CI-optimized Homebrew environment variables passed to exec calls
    // rather than mutating process.env (which would leak into subsequent workflow steps)
    const brewEnv: Record<string, string> = {
        ...process.env as Record<string, string>,
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_UPGRADE: '1',
        HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
        HOMEBREW_NO_INSTALL_CLEANUP: '1',
        HOMEBREW_NO_ANALYTICS: '1'
    };
    fnlog('Prepared CI-optimized Homebrew environment variables for exec calls');

    const retries = inputs.brewRetries || inputs.retries;

    // Install formulae
    for (const formula of inputs.brew) {
        core.startGroup(`🍺 Install brew formula: ${formula}`);
        let retryTime = 2000;
        for (let i = 0; i < retries; i++) {
            const exitCode = await exec.exec('brew', ['install', formula], {
                ignoreReturnCode: i !== retries - 1,
                env: brewEnv
            });
            if (exitCode === 0) {
                break;
            }
            if (i !== retries - 1) {
                core.info(`Failed to install formula ${formula}, retrying in ${formatTime(retryTime)}`);
                await new Promise((resolve) => setTimeout(resolve, retryTime));
                retryTime *= 2;
            }
        }
        core.endGroup();
    }

    // Install casks (macOS only — casks are .app bundles that don't exist on Linux)
    if (inputs.brewCask.length > 0) {
        if (process.platform !== 'darwin') {
            core.debug('Skipping brew cask installs — casks are macOS-only (.app bundles)');
            return;
        }

        for (const cask of inputs.brewCask) {
            core.startGroup(`🍺 Install brew cask: ${cask}`);
            let retryTime = 2000;
            for (let i = 0; i < retries; i++) {
                const exitCode = await exec.exec('brew', ['install', '--cask', cask], {
                    ignoreReturnCode: i !== retries - 1,
                    env: brewEnv
                });
                if (exitCode === 0) {
                    break;
                }
                if (i !== retries - 1) {
                    core.info(`Failed to install cask ${cask}, retrying in ${formatTime(retryTime)}`);
                    await new Promise((resolve) => setTimeout(resolve, retryTime));
                    retryTime *= 2;
                }
            }
            core.endGroup();
        }
    }
}
