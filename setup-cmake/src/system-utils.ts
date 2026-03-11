/**
 * System utilities for Git installation and OS detection.
 *
 * @module system-utils
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as fs from 'fs';

import * as setup_program from 'setup-program';

/**
 * Checks if the OS is Debian-based using /etc/os-release contents.
 *
 * @param osReleaseContents - Contents of /etc/os-release file
 * @returns True if the system is Debian or Ubuntu-based
 */
export function isDebianLike(osReleaseContents: string): boolean {
    const lower = osReleaseContents.toLowerCase();
    const idLike = lower.match(/^id_like=(.+)$/m);
    const idLine = lower.match(/^id=(.+)$/m);
    const tokens: string[] = [];
    if (idLike && idLike[1]) {
        tokens.push(...idLike[1].replace(/"/g, '').split(/\s+/));
    }
    if (idLine && idLine[1]) {
        tokens.push(...idLine[1].replace(/"/g, '').split(/\s+/));
    }
    return tokens.some((token) => token === 'debian' || token === 'ubuntu');
}

/**
 * Ensures Git is available on the system, installing it if necessary.
 *
 * On Debian/Ubuntu Linux, attempts automatic installation via apt-get.
 * Other platforms require Git to be pre-installed.
 *
 * @param options - Configuration options with subgroups (use log groups) and fnlog (logging function)
 * @param options.subgroups - Whether to use GitHub Actions log groups (default: true)
 * @param options.fnlog - Logging function for trace output (default: no-op)
 * @returns Path to the Git executable, or null if unavailable
 * @throws Error if Git is required but cannot be installed
 */
export async function ensureGit({ subgroups = true, fnlog = (): void => {} }: { subgroups?: boolean; fnlog?: (msg: string) => void } = {}): Promise<string | null> {
    const runnerOS = (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    let gitPath: string | null = null;

    try {
        gitPath = await io.which('git');
    } catch {
        gitPath = null;
    }

    if (gitPath) {
        fnlog(`git already available at ${gitPath}`);
        return gitPath;
    }

    if (subgroups) {
        core.startGroup('🔧 Ensure git availability');
    }
    fnlog('git not found in PATH; attempting installation when supported');

    if (runnerOS !== 'linux') {
        core.info('git is missing and automatic installation is only attempted on Debian/Ubuntu runners; please pre-install git on this platform.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    let osRelease = '';
    try {
        osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    } catch {
        fnlog('Unable to read /etc/os-release; skipping automatic git installation.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    if (!isDebianLike(osRelease)) {
        core.info('git is missing but runner is not Debian/Ubuntu; skipping automatic installation.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    const aptBase = setup_program.isSudoRequired() ? ['sudo', '-n', 'apt-get'] : ['apt-get'];
    const execOpts = { ignoreReturnCode: true, silent: true };

    fnlog('Running apt-get update to refresh package metadata before installing git');
    const updateCode = await exec.exec(aptBase[0], [...aptBase.slice(1), 'update'], execOpts);
    if (updateCode !== 0) {
        core.info(`apt-get update returned exit code ${updateCode}; continuing to git install attempt`);
    }

    fnlog('Installing git via apt-get');
    const installCode = await exec.exec(aptBase[0], [...aptBase.slice(1), 'install', '-y', 'git'], execOpts);
    if (installCode !== 0) {
        core.info(`apt-get install git returned exit code ${installCode}; rechecking git presence`);
    }

    let gitAfterInstall: string | null = null;
    try {
        gitAfterInstall = await io.which('git');
    } catch {
        gitAfterInstall = null;
    }

    if (subgroups) {
        core.endGroup();
    }

    if (!gitAfterInstall) {
        throw new Error('git is required to resolve CMake tags but could not be installed automatically');
    }

    fnlog(`git installed at ${gitAfterInstall}`);
    return gitAfterInstall;
}
