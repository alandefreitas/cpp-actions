/**
 * Compiler type and version detection from various sources.
 *
 * Provides a fallback chain for determining the compiler family (`gcc`
 * or `clang`) and major version when the user does not provide them
 * explicitly. Detection sources include the `cxx` binary's `--version`
 * output and coverage file extensions in build directories.
 *
 * @module detect-compiler
 */

import { readdir, open } from 'node:fs/promises';
import * as path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import * as traceCommands from 'trace-commands';

const fnlog = traceCommands.scoped('detect-compiler');

/**
 * Resolved compiler identification.
 */
export interface CompilerInfo {
    /** Compiler family: `'gcc'` or `'clang'`. */
    compiler: string;
    /** Major version as a string (e.g., `'14'`), or `''` if unknown. */
    majorVersion: string;
}

/**
 * Detects the compiler family and major version by running `cxx --version`.
 *
 * Parses the output for GCC (`g++ ... N.M.P`) or Clang (`clang version N`)
 * patterns and returns the compiler family and major version.
 *
 * @param cxxPath - Path to the C++ compiler binary
 * @returns Detected compiler info, or `null` if detection fails
 */
export async function detectFromCxx(cxxPath: string): Promise<CompilerInfo | null> {
    if (!cxxPath) {
        return null;
    }

    try {
        const { exitCode, stdout } = await exec.getExecOutput(
            cxxPath, ['--version'],
            { silent: true, ignoreReturnCode: true }
        );
        if (exitCode !== 0) {
            return null;
        }

        // Clang: "... clang version 18.1.3 ..."
        const clangMatch = /clang version (\d+)/.exec(stdout);
        if (clangMatch) {
            return {
                compiler: 'clang',
                majorVersion: clangMatch[1]
            };
        }

        // GCC: "g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0" or "gcc ... 14.2.0"
        // The version number at the end of the first line is the GCC version
        const gccMatch = /\b(\d+)\.\d+\.\d+\b/.exec(stdout);
        if (gccMatch && !stdout.toLowerCase().includes('clang')) {
            return {
                compiler: 'gcc',
                majorVersion: gccMatch[1]
            };
        }

        return null;
    } catch {
        core.debug(`Failed to run '${cxxPath} --version' for compiler detection`);
        return null;
    }
}

/**
 * Detects the compiler family from coverage file extensions in build directories.
 *
 * Searches for `.profraw` files (Clang) or `.gcda` files (GCC) in the
 * provided build directories. This only determines the compiler family,
 * not the version.
 *
 * @param buildDirs - Build directories to search
 * @param profrawPattern - Glob pattern for profraw files (e.g., `'default-*.profraw'`)
 * @returns `'clang'`, `'gcc'`, or `null` if no coverage files found
 */
export async function detectFromCoverageFiles(
    buildDirs: string[],
    profrawPattern: string
): Promise<string | null> {
    // Check for Clang profraw files
    for (const dir of buildDirs) {
        const profrawGlob = await glob.create(`${dir}/**/${profrawPattern}`);
        const profrawFiles = await profrawGlob.glob();
        if (profrawFiles.length > 0) {
            fnlog(`Found ${profrawFiles.length} .profraw file(s) — detected Clang coverage`);
            return 'clang';
        }
    }

    // Check for GCC gcda files
    for (const dir of buildDirs) {
        const gcdaGlob = await glob.create(`${dir}/**/*.gcda`);
        const gcdaFiles = await gcdaGlob.glob();
        if (gcdaFiles.length > 0) {
            fnlog(`Found ${gcdaFiles.length} .gcda file(s) — detected GCC coverage`);
            return 'gcc';
        }
    }

    return null;
}

/**
 * Resolves the compiler family and major version using a fallback chain.
 *
 * Detection priority:
 * 1. Explicit `compiler` and `compilerVersion` inputs (if non-empty)
 * 2. `cxx` input — run `cxx --version` to detect both family and version
 * 3. Coverage file detection — glob build directories for `.profraw` (Clang)
 *    or `.gcda` (GCC) files (determines family only, not version)
 *
 * @param inputs - Object with `compiler`, `compilerVersion`, `cxx`, `buildDir`,
 *                 and `profrawPattern` fields
 * @returns Resolved compiler info
 * @throws If the compiler family cannot be determined from any source
 */
export async function resolveCompilerInfo(inputs: {
    compiler: string;
    compilerVersion: string;
    cxx: string;
    buildDir: string[];
    profrawPattern: string;
}): Promise<CompilerInfo> {
    let compiler = inputs.compiler;
    let majorVersion = inputs.compilerVersion;

    // Try cxx --version to fill in missing fields (skip if both already set)
    if (inputs.cxx && (!compiler || !majorVersion)) {
        fnlog(`Detecting compiler from '${inputs.cxx} --version'`);
        const detected = await detectFromCxx(inputs.cxx);
        if (detected) {
            if (!compiler) {
                compiler = detected.compiler;
                fnlog(`Detected compiler family: ${compiler}`);
            }
            if (!majorVersion) {
                majorVersion = detected.majorVersion;
                fnlog(`Detected compiler major version: ${majorVersion}`);
            }
        } else {
            core.warning(
                `Could not detect compiler from '${inputs.cxx} --version'. ` +
                `Falling back to coverage file detection.`
            );
        }
    }

    // If we still don't know the compiler family, check coverage files
    if (!compiler) {
        fnlog('Detecting compiler family from coverage files in build directories');
        const detected = await detectFromCoverageFiles(
            inputs.buildDir,
            inputs.profrawPattern
        );
        if (detected) {
            compiler = detected;
        }
    }

    if (!compiler) {
        throw new Error(
            'Cannot determine the compiler family. Provide at least one of: ' +
            '`compiler` input (\'gcc\' or \'clang\'), `cxx` input (path to compiler binary), ' +
            'or ensure coverage files (.profraw or .gcda) exist in the build directories.'
        );
    }

    if (compiler !== 'gcc' && compiler !== 'clang') {
        throw new Error(
            `Unsupported compiler '${compiler}'. Expected 'gcc' or 'clang'.`
        );
    }

    return { compiler, majorVersion };
}

/** ELF magic number (first 4 bytes of any ELF binary). */
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

/** Mach-O magic numbers (32-bit, 64-bit, and fat/universal). */
const MACHO_MAGICS = [
    Buffer.from([0xfe, 0xed, 0xfa, 0xce]),  // MH_MAGIC (32-bit)
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),  // MH_MAGIC_64
    Buffer.from([0xce, 0xfa, 0xed, 0xfe]),  // MH_CIGAM (32-bit, reversed)
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),  // MH_CIGAM_64 (reversed)
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),  // FAT_MAGIC (universal)
];

/**
 * Checks whether a file is a native executable by reading its magic bytes.
 *
 * Recognizes ELF (Linux) and Mach-O (macOS) binaries.
 *
 * @param filePath - Absolute path to the file
 * @returns `true` if the file starts with a recognized executable magic number
 */
async function isNativeExecutable(filePath: string): Promise<boolean> {
    let fh;
    try {
        fh = await open(filePath, 'r');
        const buf = Buffer.alloc(4);
        const { bytesRead } = await fh.read(buf, 0, 4, 0);
        if (bytesRead < 4) {
            return false;
        }
        if (buf.equals(ELF_MAGIC)) {
            return true;
        }
        for (const magic of MACHO_MAGICS) {
            if (buf.equals(magic)) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    } finally {
        await fh?.close();
    }
}

/**
 * Discovers native executable files in the given directories.
 *
 * Recursively searches each directory for files that are ELF or Mach-O
 * binaries (identified by magic bytes). Skips common non-test paths
 * like `CMakeFiles/`, `.cmake/`, and object file directories.
 *
 * @param dirs - Directories to search
 * @returns Array of absolute paths to discovered executables
 */
export async function discoverExecutables(dirs: string[]): Promise<string[]> {
    const executables: string[] = [];

    const skipDirs = new Set([
        'CMakeFiles', '.cmake', '_CPack_Packages',
        'node_modules', '.git'
    ]);

    async function walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    await walk(fullPath);
                }
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            // Skip obvious non-executables by extension
            if (/\.(o|a|so|dylib|lib|dll|profraw|profdata|gcda|gcno|info|json|txt|cmake|log|d|h|hpp|cpp|c)$/i.test(entry.name)) {
                continue;
            }

            if (await isNativeExecutable(fullPath)) {
                executables.push(fullPath);
            }
        }
    }

    for (const dir of dirs) {
        await walk(dir);
    }

    return executables;
}
