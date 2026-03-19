/**
 * Chocolatey package management utilities for setup-program action.
 *
 * Provides functions for searching, installing, and managing packages
 * via Chocolatey on Windows systems.
 *
 * @module choco-utils
 */

import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import { type ExecOutput } from './types';

/**
 * Result of finding a program installed via Chocolatey.
 */
export interface ChocoProgramResult {
    /** Full path to the binary */
    path: string;
    /** Version string detected from `--version` output */
    version: string;
}

/**
 * Checks if Chocolatey is available on the system.
 *
 * @returns True if `choco` is on PATH, false otherwise
 */
export async function isChocoAvailable(): Promise<boolean> {
    try {
        const chocoPath = await io.which('choco');
        return chocoPath !== '';
    } catch {
        // Untested: requires Windows environment without Chocolatey
        return false;
    }
}

/**
 * Searches known install paths for a binary installed by a Chocolatey package.
 *
 * Does not invoke Chocolatey itself — instead searches the provided filesystem
 * paths where Chocolatey and runner pre-installed packages are known to place
 * their binaries.
 *
 * Known install locations:
 * - MinGW: `C:\ProgramData\mingw64\bin` (Chocolatey), `C:\mingw64\bin` (runner pre-installed)
 * - LLVM: `C:\Program Files\LLVM\bin` (both Chocolatey and runner pre-installed)
 *
 * @param packageName - The Chocolatey package name (e.g., "mingw", "llvm")
 * @param binaryName - The name of the binary to find (e.g., "gcc.exe", "clang-cl.exe")
 * @param searchPaths - Array of directory paths to search for the binary
 * @returns Object with path and version if found, or null if not found
 */
export async function findProgramWithChoco(
    packageName: string,
    binaryName: string,
    searchPaths: string[]
): Promise<ChocoProgramResult | null> {
    const fnlog = traceCommands.scoped('findProgramWithChoco');

    fnlog(`Searching for ${binaryName} in known ${packageName} install paths`);

    for (const searchDir of searchPaths) {
        const binaryPath = path.join(searchDir, binaryName);
        fnlog(`Checking for binary at ${binaryPath}`);

        if (!fs.existsSync(binaryPath)) {
            fnlog(`Binary not found at ${binaryPath}`);
            continue;
        }

        try {
            const output: ExecOutput = await exec.getExecOutput(binaryPath, ['--version'], { silent: true });
            if (output.exitCode !== 0) {
                fnlog(`${binaryPath} --version failed with exit code ${output.exitCode}`);
                continue;
            }

            const versionOutput = output.stdout.trim() || output.stderr.trim();
            const version = parseVersionFromOutput(versionOutput);
            if (version === null) {
                // Untested: requires --version output that doesn't match any known format
                fnlog(`Could not parse version from output: ${versionOutput}`);
                continue;
            }

            fnlog(`Found ${binaryName} at ${binaryPath} with version ${version}`);
            return { path: binaryPath, version };
        } catch {
            fnlog(`Binary ${binaryPath} not executable or errored`);
            continue;
        }
    }

    fnlog(`${binaryName} not found in any search path`);
    return null;
}

/**
 * Installs a Chocolatey package and returns the install directory.
 *
 * Runs `choco install {packageName} -y --no-progress` with an optional
 * `--version` flag. After installation, adds the install directory to PATH
 * via `core.addPath()`.
 *
 * @param packageName - The Chocolatey package to install (e.g., "mingw", "llvm")
 * @param version - Optional specific version to install (e.g., "14.2.0", "20.1.8")
 * @param installDir - The expected install bin directory to add to PATH after installation
 * @returns The install bin directory path, or null if installation failed
 */
export async function installProgramWithChoco(
    packageName: string,
    version?: string,
    installDir?: string
): Promise<string | null> {
    const fnlog = traceCommands.scoped('installProgramWithChoco');

    const args = ['install', packageName, '-y', '--no-progress'];
    if (version) {
        args.push('--version', version);
    }

    fnlog(`Installing Chocolatey package: choco ${args.join(' ')}`);

    try {
        const exitCode = await exec.exec('choco', args, { ignoreReturnCode: true });
        if (exitCode !== 0) {
            fnlog(`choco install ${packageName} failed with exit code ${exitCode}`);
            return null;
        }
    } catch {
        // Untested: requires choco command to throw unexpectedly
        fnlog(`Failed to run choco install ${packageName}`);
        return null;
    }

    if (installDir) {
        core.addPath(installDir);
        fnlog(`Added ${installDir} to PATH`);
    }

    return installDir ?? null;
}

/**
 * Parses a version string from `--version` command output.
 *
 * Handles common version output formats:
 * - GCC: `gcc.exe (x86_64-posix-seh-rev0, Built by MinGW-W64) 14.2.0` → `14.2.0`
 * - Clang-CL: `clang version 20.1.8 (...)` → `20.1.8`
 * - Generic: any line containing a semver-like `X.Y.Z` pattern
 *
 * @param output - The full stdout from a `--version` command
 * @returns The parsed version string, or null if no version found
 */
export function parseVersionFromOutput(output: string): string | null {
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
}
