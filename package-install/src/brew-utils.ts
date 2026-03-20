/**
 * Homebrew package management utilities for package-install action.
 *
 * Provides functions for searching, installing, and managing packages
 * via Homebrew on macOS systems.
 *
 * @module brew-utils
 */

import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as traceCommands from 'trace-commands';

/**
 * Output from executing a command via exec.getExecOutput.
 */
interface ExecOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Result of finding a program installed via Homebrew.
 */
export interface BrewProgramResult {
    /** Full path to the binary */
    path: string;
    /** Version string detected from `--version` output */
    version: string;
}

/**
 * Checks if Homebrew is available on the system.
 *
 * @returns True if `brew` is on PATH, false otherwise
 */
export async function isBrewAvailable(): Promise<boolean> {
    try {
        const brewPath = await io.which('brew');
        return brewPath !== '';
    } catch {
        // Untested: requires macOS environment without Homebrew
        return false;
    }
}

/**
 * Returns the Homebrew prefix path for a given formula.
 *
 * Runs `brew --prefix {formula}` to determine where the formula is installed.
 * For keg-only formulas (like LLVM), this is the only reliable way to find binaries
 * since they are not symlinked to the standard Homebrew bin directory.
 *
 * @param formula - The Homebrew formula name (e.g., "gcc@14", "llvm@18")
 * @returns The prefix path (e.g., "/opt/homebrew/opt/llvm@18"), or null if not installed
 * @throws Error if brew command fails unexpectedly
 */
export async function getBrewPrefix(formula: string): Promise<string | null> {
    const fnlog = traceCommands.scoped('getBrewPrefix');

    try {
        const output: ExecOutput = await exec.getExecOutput('brew', ['--prefix', formula], { silent: true });
        if (output.exitCode !== 0) {
            fnlog(`brew --prefix ${formula} failed with exit code ${output.exitCode}`);
            return null;
        }
        const prefix = output.stdout.trim();
        if (prefix === '') {
            // Untested: brew --prefix returning empty stdout is unexpected
            fnlog(`brew --prefix ${formula} returned empty output`);
            return null;
        }
        fnlog(`Homebrew prefix for ${formula}: ${prefix}`);
        return prefix;
    } catch {
        // Untested: requires brew command to throw unexpectedly
        fnlog(`Failed to get Homebrew prefix for ${formula}`);
        return null;
    }
}

/**
 * Searches for a binary installed by a Homebrew formula.
 *
 * Looks for the binary in the formula's Homebrew prefix directory.
 * This handles keg-only formulas (like LLVM) where binaries are not
 * symlinked to the standard Homebrew bin directory.
 *
 * @param formula - The Homebrew formula name (e.g., "gcc@14", "llvm@18")
 * @param binaryName - The name of the binary to find (e.g., "gcc-14", "clang")
 * @returns Object with path and version if found, or null if not found
 */
export async function findProgramWithBrew(formula: string, binaryName: string): Promise<BrewProgramResult | null> {
    const fnlog = traceCommands.scoped('findProgramWithBrew');

    fnlog(`Searching for ${binaryName} in Homebrew formula ${formula}`);

    const prefix = await getBrewPrefix(formula);
    if (prefix === null) {
        fnlog(`Formula ${formula} is not installed`);
        return null;
    }

    const binaryPath = `${prefix}/bin/${binaryName}`;
    fnlog(`Checking for binary at ${binaryPath}`);

    try {
        const output: ExecOutput = await exec.getExecOutput(binaryPath, ['--version'], { silent: true });
        if (output.exitCode !== 0) {
            fnlog(`${binaryPath} --version failed with exit code ${output.exitCode}`);
            return null;
        }

        const versionOutput = output.stdout.trim() || output.stderr.trim();
        const version = parseVersionFromOutput(versionOutput);
        if (version === null) {
            // Untested: requires --version output that doesn't match any known format
            fnlog(`Could not parse version from output: ${versionOutput}`);
            return null;
        }

        fnlog(`Found ${binaryName} at ${binaryPath} with version ${version}`);
        return { path: binaryPath, version };
    } catch {
        fnlog(`Binary ${binaryPath} not found or not executable`);
        return null;
    }
}

/**
 * Installs a Homebrew formula and returns the install prefix path.
 *
 * Runs `brew install {formula}` and then retrieves the prefix path.
 * The prefix is particularly important for keg-only formulas where
 * binaries are not added to PATH automatically.
 *
 * @param formula - The Homebrew formula to install (e.g., "gcc@14", "llvm@18")
 * @returns The install prefix path, or null if installation failed
 */
export async function installProgramWithBrew(formula: string): Promise<string | null> {
    const fnlog = traceCommands.scoped('installProgramWithBrew');

    fnlog(`Installing Homebrew formula ${formula}`);

    try {
        const exitCode = await exec.exec('brew', ['install', formula], { ignoreReturnCode: true });
        if (exitCode !== 0) {
            fnlog(`brew install ${formula} failed with exit code ${exitCode}`);
            return null;
        }
    } catch {
        // Untested: requires brew install to throw unexpectedly
        fnlog(`Failed to run brew install ${formula}`);
        return null;
    }

    const prefix = await getBrewPrefix(formula);
    if (prefix !== null) {
        core.addPath(`${prefix}/bin`);
        fnlog(`Added ${prefix}/bin to PATH`);
    }

    return prefix;
}

/**
 * Parses a version string from `--version` command output.
 *
 * Handles common version output formats:
 * - GCC: `gcc-14 (Homebrew GCC 14.2.0) 14.2.0` → `14.2.0`
 * - Clang: `Homebrew clang version 18.1.8 (...)` → `18.1.8`
 * - Generic: any line containing a semver-like `X.Y.Z` pattern
 *
 * @param output - The full stdout from a `--version` command
 * @returns The parsed version string, or null if no version found
 */
export function parseVersionFromOutput(output: string): string | null {
    // Match semver-like patterns (X.Y.Z)
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
}
