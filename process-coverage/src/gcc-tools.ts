/**
 * GCC coverage tool discovery utilities.
 *
 * Locates version-matched gcov binaries and lcov/genhtml tools
 * on the system PATH for processing GCC-generated coverage data.
 *
 * @module gcc-tools
 */

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';
import { execWithSudo } from 'setup-program';

const fnlog = traceCommands.scoped('gcc-tools');

/**
 * Finds the version-matched gcov binary on the system PATH.
 *
 * Searches for `gcov-{majorVersion}` first, then falls back to the
 * unversioned `gcov` with a warning about potential version mismatch.
 *
 * @param majorVersion - The GCC major version number (e.g. `'14'`)
 * @returns Absolute path to the gcov binary
 * @throws If no gcov binary is found on the system PATH
 */
export async function findGcov(majorVersion: string): Promise<string> {
    // Try versioned binary first (skip if major version unknown)
    if (majorVersion !== '') {
        const versionedName = `gcov-${majorVersion}`;
        try {
            const versionedPath = await io.which(versionedName, true);
            fnlog(`Found ${versionedName} at ${versionedPath}`);
            return versionedPath;
        } catch {
            core.debug(`${versionedName} not found on PATH, trying unversioned gcov`);
        }
    }

    // Fall back to unversioned gcov
    try {
        const fallbackPath = await io.which('gcov', true);
        if (majorVersion !== '') {
            core.warning(
                `Version-matched gcov-${majorVersion} not found. ` +
                `Falling back to ${fallbackPath} — this may cause version mismatch errors.`
            );
        } else {
            fnlog(`Found gcov at ${fallbackPath}`);
        }
        return fallbackPath;
    } catch {
        throw new Error(
            `No gcov binary found on PATH. ` +
            (majorVersion !== ''
                ? `Searched for gcov-${majorVersion} and gcov. Install GCC ${majorVersion} or ensure gcov is available.`
                : `Ensure gcov is available on PATH.`
            )
        );
    }
}

/**
 * Attempts to find a tool on PATH, auto-installing lcov via apt-get if not found.
 *
 * @param toolName - The binary name to search for (e.g. `'lcov'`, `'genhtml'`)
 * @returns Absolute path to the tool binary
 * @throws If the tool cannot be found or installed
 */
async function findOrInstallLcovTool(toolName: string): Promise<string> {
    try {
        const toolPath = await io.which(toolName, true);
        fnlog(`Found ${toolName} at ${toolPath}`);
        return toolPath;
    } catch {
        fnlog(`${toolName} not found on PATH, installing lcov via apt-get`);
    }

    await execWithSudo('apt-get', ['update', '-qq']);
    await execWithSudo('apt-get', ['install', '-y', 'lcov']);

    try {
        const toolPath = await io.which(toolName, true);
        fnlog(`Found ${toolName} at ${toolPath} after installation`);
        return toolPath;
    } catch {
        throw new Error(
            `${toolName} not found on PATH after installing lcov. ` +
            `Ensure apt-get install lcov completed successfully.`
        );
    }
}

/**
 * Finds the lcov binary on the system PATH, installing it via apt-get if not found.
 *
 * @returns Absolute path to the lcov binary
 * @throws If lcov cannot be found or installed
 */
export async function findLcov(): Promise<string> {
    return findOrInstallLcovTool('lcov');
}

/**
 * Finds the genhtml binary on the system PATH, installing lcov via apt-get if not found.
 *
 * genhtml ships as part of the lcov package, so installing lcov also provides genhtml.
 *
 * @returns Absolute path to the genhtml binary
 * @throws If genhtml cannot be found or installed
 */
export async function findGenhtml(): Promise<string> {
    return findOrInstallLcovTool('genhtml');
}
