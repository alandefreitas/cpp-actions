/**
 * Companion package utilities for setup-clang action.
 *
 * @module companion-packages
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';
/**
 * Result of companion package installation.
 */
export interface CompanionPackageResult {
    /** Path to llvm-symbolizer if found, null otherwise */
    symbolizerPath: string | null;
}

import * as setup_program from 'setup-program';

// Re-export findLlvmSymbolizer from the shared library for backward compatibility
export { findLlvmSymbolizer } from 'setup-program';

/**
 * Recursively searches for a file matching the given name in a directory.
 *
 * @param dir - Directory to search in
 * @param filename - Filename to search for
 * @param maxDepth - Maximum recursion depth
 * @returns True if file is found
 */
export function findFileRecursive(dir: string, filename: string, maxDepth: number): boolean {
    if (maxDepth <= 0 || !fs.existsSync(dir)) {
        return false;
    }

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) {
                return true;
            }
            if (entry.isDirectory()) {
                if (findFileRecursive(fullPath, filename, maxDepth - 1)) {
                    return true;
                }
            }
        }
    } catch {
        // Permission denied or other error, skip this directory
    }

    return false;
}

/**
 * Checks if sanitizer runtime libraries are available.
 *
 * @param majorVersion - The major version of Clang installed
 * @returns True if ASan runtime library is found (used as proxy for all sanitizer runtimes)
 */
export function hasSanitizerRuntimes(majorVersion: number): boolean {
    // Check common locations for sanitizer runtime libraries
    // We check for ASan as a proxy for all sanitizer runtimes
    const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
    const asanFilename = `libclang_rt.asan-${arch}.a`;

    // Direct paths to check first (most common locations)
    const directPaths = [
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}/lib/linux/${asanFilename}`,
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}.0.0/lib/linux/${asanFilename}`,
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}.0.1/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}.0.0/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}.0.1/lib/linux/${asanFilename}`
    ];

    for (const p of directPaths) {
        if (fs.existsSync(p)) {
            return true;
        }
    }

    // Search in base directories with limited recursion depth
    const baseDirs = [
        `/usr/lib/llvm-${majorVersion}/lib/clang`,
        '/usr/lib/clang'
    ];

    for (const baseDir of baseDirs) {
        if (findFileRecursive(baseDir, asanFilename, 5)) {
            return true;
        }
    }

    return false;
}

/**
 * Installs companion packages for Clang to ensure tool parity.
 *
 * Different Clang installation sources provide different tools. This function
 * checks if required tools are present and installs them if missing:
 * - llvm-symbolizer: Required for readable sanitizer stack traces
 * - Sanitizer runtimes: Required for ASan, UBSan, TSan, MSan
 *
 * @param installedVersion - The version of Clang that was installed (e.g., "14.0.0")
 * @param installedAptPackage - The APT package name that was installed (e.g., "clang" or "clang-14"), or null if not from APT
 * @param installedFromUrl - True if Clang was installed from URL download
 * @returns Object containing the symbolizer path if found
 */
export async function installCompanionPackages(installedVersion: string, installedAptPackage: string | null, installedFromUrl: boolean): Promise<CompanionPackageResult> {
    const fnlog = traceCommands.scoped('installCompanionPackages');

    let symbolizerPath: string | null = null;

    // Only install companion packages on Linux with APT
    if (process.platform !== 'linux') {
        fnlog('Skipping companion packages: not on Linux');
        return { symbolizerPath };
    }

    // Check if APT is available
    try {
        const exitCode = await exec.exec('apt', ['--version'], { silent: true });
        if (exitCode !== 0) {
            fnlog('APT not available');
            return { symbolizerPath };
        }
    } catch {
        fnlog('APT not available');
        return { symbolizerPath };
    }

    const version = semver.coerce(installedVersion);
    if (!version) {
        fnlog(`Could not parse version: ${installedVersion}`);
        return { symbolizerPath };
    }
    const majorVersion = version.major;

    // Determine if the installed package is unversioned (e.g., "clang" vs "clang-14")
    const isUnversionedPackage = installedAptPackage !== null &&
        setup_program.getPackagePreferenceTier(installedAptPackage, ['clang']) === setup_program.PackagePreferenceTier.UNVERSIONED;

    fnlog(`Installed APT package: ${installedAptPackage ?? 'none'}, isUnversioned: ${isUnversionedPackage}, fromUrl: ${installedFromUrl}`);

    const opts = {
        env: {
            DEBIAN_FRONTEND: 'noninteractive',
            TZ: 'Etc/UTC',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        },
        ignoreReturnCode: true,
        silent: true
    };

    // Determine sudo prefix
    let sudoPrefix = '';
    try {
        const { exitCode } = await exec.getExecOutput('sudo', ['-n', 'true'], { silent: true, ignoreReturnCode: true });
        if (exitCode === 0) {
            sudoPrefix = 'sudo -n ';
        }
    } catch {
        // sudo not available
    }

    // Check if llvm-symbolizer is already available
    symbolizerPath = await setup_program.findLlvmSymbolizer(majorVersion);
    if (symbolizerPath) {
        fnlog(`llvm-symbolizer already available at ${symbolizerPath}`);
        core.info(`llvm-symbolizer already available at ${symbolizerPath}`);
    } else {
        fnlog('llvm-symbolizer not found, attempting to install');
        // For unversioned clang, prefer unversioned llvm; for versioned, prefer versioned llvm
        const llvmPackages = isUnversionedPackage
            ? ['llvm', `llvm-${majorVersion}`]
            : [`llvm-${majorVersion}`, 'llvm'];
        for (const pkg of llvmPackages) {
            fnlog(`Trying to install ${pkg}`);
            const exitCode = await exec.exec(`${sudoPrefix}apt-get install -y ${pkg}`, [], opts);
            if (exitCode === 0) {
                core.info(`Installed ${pkg} for llvm-symbolizer`);
                // Find the symbolizer path after installation
                symbolizerPath = await setup_program.findLlvmSymbolizer(majorVersion);
                if (symbolizerPath) {
                    fnlog(`llvm-symbolizer found at ${symbolizerPath}`);
                }
                break;
            }
        }
    }

    // Check if sanitizer runtimes are already available
    if (hasSanitizerRuntimes(majorVersion)) {
        fnlog('Sanitizer runtimes already available, skipping installation');
        core.info('Sanitizer runtimes already available');
    } else {
        fnlog('Sanitizer runtimes not found, attempting to install');
        const rtPackages = [
            `libclang-rt-${majorVersion}-dev`,
            `libclang-common-${majorVersion}-dev`
        ];
        for (const pkg of rtPackages) {
            fnlog(`Trying to install ${pkg}`);
            const exitCode = await exec.exec(`${sudoPrefix}apt-get install -y ${pkg}`, [], opts);
            if (exitCode === 0) {
                core.info(`Installed ${pkg} for sanitizer runtimes`);
                break;
            }
        }
    }

    return { symbolizerPath };
}
