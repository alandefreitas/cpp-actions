/**
 * Clang coverage tool discovery utilities.
 *
 * Locates version-matched llvm-profdata and llvm-cov binaries
 * on the system PATH or in common LLVM install directories
 * for processing Clang-generated coverage data.
 *
 * @module clang-tools
 */

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';
import { access, constants } from 'node:fs/promises';
import { execWithSudo } from 'setup-program';

const fnlog = traceCommands.scoped('clang-tools');

/**
 * Builds candidate paths where an LLVM tool might be installed.
 *
 * @param toolName - The LLVM tool binary name (e.g. `'llvm-profdata'`)
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @returns Array of absolute paths to search
 */
function buildCandidatePaths(toolName: string, majorVersion: string): string[] {
    return [
        `/usr/lib/llvm-${majorVersion}/bin/${toolName}`,
        `/usr/bin/${toolName}-${majorVersion}`,
        `/usr/bin/${toolName}`
    ];
}

/**
 * Searches for an LLVM tool by checking candidate filesystem paths.
 *
 * @param toolName - The LLVM tool binary name
 * @param majorVersion - The LLVM/Clang major version number
 * @returns Absolute path to the tool if found, or `null` if not found
 */
async function searchCandidatePaths(toolName: string, majorVersion: string): Promise<string | null> {
    const candidates = buildCandidatePaths(toolName, majorVersion);

    for (const candidate of candidates) {
        try {
            await access(candidate, constants.X_OK);
            fnlog(`Found ${toolName} at ${candidate}`);
            return candidate;
        } catch {
            core.debug(`${toolName} not found at ${candidate}`);
        }
    }

    return null;
}

/**
 * Searches for an LLVM tool without attempting installation.
 *
 * Searches in this order:
 * 1. `{tool}-{majorVersion}` on PATH via `io.which`
 * 2. Common LLVM install paths (`/usr/lib/llvm-{ver}/bin/`, `/usr/bin/`)
 * 3. Unversioned `{tool}` on PATH as final fallback (with warning)
 *
 * @param toolName - The LLVM tool binary name (e.g. `'llvm-profdata'`)
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @returns Absolute path to the tool binary, or `null` if not found
 */
async function searchForLlvmTool(toolName: string, majorVersion: string): Promise<string | null> {
    // 1. Try versioned name on PATH (skip if major version unknown)
    if (majorVersion !== '') {
        const versionedName = `${toolName}-${majorVersion}`;
        try {
            const versionedPath = await io.which(versionedName, true);
            fnlog(`Found ${versionedName} at ${versionedPath}`);
            return versionedPath;
        } catch {
            core.debug(`${versionedName} not found on PATH`);
        }

        // 2. Search common LLVM install directories
        const candidatePath = await searchCandidatePaths(toolName, majorVersion);
        if (candidatePath) {
            return candidatePath;
        }
    }

    // 3. Fall back to unversioned name on PATH
    try {
        const fallbackPath = await io.which(toolName, true);
        if (majorVersion !== '') {
            core.warning(
                `Version-matched ${toolName}-${majorVersion} not found. ` +
                `Falling back to ${fallbackPath} — this may cause version mismatch errors.`
            );
        } else {
            fnlog(`Found ${toolName} at ${fallbackPath}`);
        }
        return fallbackPath;
    } catch {
        return null;
    }
}

/**
 * Finds a version-matched LLVM tool on the system, auto-installing if not found.
 *
 * Searches in this order:
 * 1. `{tool}-{majorVersion}` on PATH via `io.which`
 * 2. Common LLVM install paths (`/usr/lib/llvm-{ver}/bin/`, `/usr/bin/`)
 * 3. Unversioned `{tool}` on PATH as final fallback
 * 4. Auto-installs `llvm-{majorVersion}-tools` via apt-get and retries search
 *
 * @param toolName - The LLVM tool binary name (e.g. `'llvm-profdata'`)
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @returns Absolute path to the tool binary
 * @throws If the tool cannot be found even after auto-installation
 */
async function findLlvmTool(toolName: string, majorVersion: string): Promise<string> {
    // Try to find the tool without installing
    const found = await searchForLlvmTool(toolName, majorVersion);
    if (found) {
        return found;
    }

    // Auto-install and retry
    fnlog(`${toolName} not found, installing llvm-${majorVersion}-tools via apt-get`);
    await installLlvmTools(majorVersion);

    const foundAfterInstall = await searchForLlvmTool(toolName, majorVersion);
    if (foundAfterInstall) {
        return foundAfterInstall;
    }

    throw new Error(
        `No ${toolName} binary found after installing llvm-${majorVersion}-tools. ` +
        `Searched for ${toolName}-${majorVersion} on PATH, ` +
        `common LLVM install paths, and unversioned ${toolName}. ` +
        `Ensure the LLVM ${majorVersion} package installed correctly.`
    );
}

/**
 * Installs LLVM tools for the specified major version via apt-get.
 *
 * Runs `apt-get install -y llvm-{majorVersion}-tools` which provides
 * llvm-profdata, llvm-cov, and other LLVM utilities for the given version.
 *
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @throws If the apt-get installation fails
 */
export async function installLlvmTools(majorVersion: string): Promise<void> {
    const packageName = `llvm-${majorVersion}-tools`;
    fnlog(`Installing ${packageName} via apt-get`);
    await execWithSudo('apt-get', ['update', '-qq']);
    await execWithSudo('apt-get', ['install', '-y', packageName]);
    fnlog(`Successfully installed ${packageName}`);
}

/**
 * Finds the version-matched llvm-profdata binary on the system.
 *
 * Searches for `llvm-profdata-{majorVersion}` on PATH first, then
 * checks common LLVM install directories, falls back to the unversioned
 * `llvm-profdata` with a warning, and auto-installs `llvm-{majorVersion}-tools`
 * via apt-get if the tool is not found anywhere.
 *
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @returns Absolute path to the llvm-profdata binary
 * @throws If no llvm-profdata binary is found even after auto-installation
 */
export async function findLlvmProfdata(majorVersion: string): Promise<string> {
    return findLlvmTool('llvm-profdata', majorVersion);
}

/**
 * Finds the version-matched llvm-cov binary on the system.
 *
 * Searches for `llvm-cov-{majorVersion}` on PATH first, then
 * checks common LLVM install directories, falls back to the unversioned
 * `llvm-cov` with a warning, and auto-installs `llvm-{majorVersion}-tools`
 * via apt-get if the tool is not found anywhere.
 *
 * @param majorVersion - The LLVM/Clang major version number (e.g. `'18'`)
 * @returns Absolute path to the llvm-cov binary
 * @throws If no llvm-cov binary is found even after auto-installation
 */
export async function findLlvmCov(majorVersion: string): Promise<string> {
    return findLlvmTool('llvm-cov', majorVersion);
}
