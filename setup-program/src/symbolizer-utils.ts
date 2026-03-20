/**
 * LLVM symbolizer discovery and environment variable export utilities.
 *
 * Provides cross-platform search for llvm-symbolizer and a helper to export
 * all sanitizer-related environment variables at once.
 *
 * @module symbolizer-utils
 */

import * as fs from 'fs';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as traceCommands from 'trace-commands';

/**
 * Builds an ordered list of absolute paths to probe for llvm-symbolizer.
 *
 * Returns platform-specific well-known locations so callers can short-circuit
 * on the first hit before falling back to PATH-based discovery.
 *
 * @param majorVersion - The LLVM major version to target (e.g., 14)
 * @param platform - Node.js platform string (defaults to process.platform)
 * @returns Ordered array of candidate absolute paths
 */
export function buildSymbolizerCandidatePaths(
    majorVersion: number,
    platform: string = process.platform
): string[] {
    if (platform === 'linux') {
        return [
            `/usr/lib/llvm-${majorVersion}/bin/llvm-symbolizer`,
            `/usr/bin/llvm-symbolizer-${majorVersion}`,
            '/usr/bin/llvm-symbolizer'
        ];
    }
    if (platform === 'darwin') {
        return [
            `/opt/homebrew/opt/llvm@${majorVersion}/bin/llvm-symbolizer`,
            `/usr/local/opt/llvm@${majorVersion}/bin/llvm-symbolizer`,
            '/opt/homebrew/opt/llvm/bin/llvm-symbolizer',
            '/usr/local/opt/llvm/bin/llvm-symbolizer'
        ];
    }
    if (platform === 'win32') {
        return [
            'C:\\Program Files\\LLVM\\bin\\llvm-symbolizer.exe'
        ];
    }
    return [];
}

/**
 * Searches for llvm-symbolizer on the system and returns its absolute path.
 *
 * Probes well-known platform-specific absolute paths first, then falls back
 * to PATH lookup via versioned and unversioned binary names.
 *
 * @param majorVersion - The LLVM major version to prefer (e.g., 14)
 * @returns Absolute path to llvm-symbolizer, or null if not found
 */
export async function findLlvmSymbolizer(majorVersion: number): Promise<string | null> {
    const fnlog = traceCommands.scoped('findLlvmSymbolizer');

    const absolutePaths = buildSymbolizerCandidatePaths(majorVersion);
    for (const p of absolutePaths) {
        if (fs.existsSync(p)) {
            fnlog(`Found llvm-symbolizer at ${p}`);
            return p;
        }
    }

    // On macOS, try xcrun to find llvm-symbolizer in the active Xcode toolchain
    if (process.platform === 'darwin') {
        try {
            const { stdout, exitCode } = await exec.getExecOutput('xcrun', ['--find', 'llvm-symbolizer'], { silent: true });
            const xcrunPath = stdout.trim();
            if (exitCode === 0 && xcrunPath && fs.existsSync(xcrunPath)) {
                fnlog(`Found llvm-symbolizer via xcrun: ${xcrunPath}`);
                return xcrunPath;
            }
        } catch {
            fnlog('xcrun --find llvm-symbolizer failed');
        }
    }

    const pathNames = [`llvm-symbolizer-${majorVersion}`, 'llvm-symbolizer'];
    for (const name of pathNames) {
        try {
            const found = await io.which(name, false);
            if (found) {
                fnlog(`Found llvm-symbolizer via PATH: ${found}`);
                return found;
            }
        } catch {
            // Continue checking other candidates
        }
    }

    fnlog('llvm-symbolizer not found');
    return null;
}

/**
 * Exports all sanitizer symbolizer environment variables to the GitHub Actions
 * environment.
 *
 * Sets LLVM_SYMBOLIZER_PATH, ASAN_SYMBOLIZER_PATH, MSAN_SYMBOLIZER_PATH,
 * TSAN_SYMBOLIZER_PATH, and UBSAN_SYMBOLIZER_PATH to the provided path.
 *
 * @param symbolizerPath - Absolute path to the llvm-symbolizer binary
 */
export function exportSymbolizerEnvVars(symbolizerPath: string): void {
    core.exportVariable('LLVM_SYMBOLIZER_PATH', symbolizerPath);
    core.exportVariable('ASAN_SYMBOLIZER_PATH', symbolizerPath);
    core.exportVariable('MSAN_SYMBOLIZER_PATH', symbolizerPath);
    core.exportVariable('TSAN_SYMBOLIZER_PATH', symbolizerPath);
    core.exportVariable('UBSAN_SYMBOLIZER_PATH', symbolizerPath);
}
