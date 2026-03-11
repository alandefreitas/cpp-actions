import * as core from '@actions/core';
import * as io from '@actions/io';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import * as setup_gcc from 'setup-gcc';
import * as setup_clang from 'setup-clang';
import * as setup_msvc from 'setup-msvc';

// Type imports and re-exports
import { type NormalizedCompiler, type Inputs, type SetupResult } from './types';
export type { NormalizedCompiler, Inputs, SetupResult }

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

/**
 * Normalizes a compiler name and extracts version information.
 *
 * This function handles various compiler name formats and normalizes them to
 * canonical forms. It extracts version numbers embedded in compiler strings
 * (e.g., "gcc-10.2.0" becomes compiler="gcc", version="10.2.0").
 *
 * Supported compiler families:
 * - GCC: gcc, g++ → normalized to "gcc"
 * - Clang: clang, apple-clang, appleclang → normalized to "clang" (or "clang-cl" on Windows)
 * - MSVC: msvc, cl → normalized to "msvc"
 *
 * @param compiler - The compiler name, possibly with embedded version (e.g., "gcc-10")
 * @param version - The explicit version string, used if not embedded in compiler name
 * @returns Object with normalized compiler name and version string
 */
export function normalizeCompiler(compiler: string, version: string): NormalizedCompiler {
    const parts = compiler.split(/-|\s/);
    const numParts = parts.length;

    // Split compiler from version in the compiler name
    // If the compiler is something like "gcc-10.2.0", we need to split it
    if (numParts !== 1 && /[\d\\.]+/.test(parts[numParts - 1])) {
        compiler = parts[0];
        for (let i = 1; i < numParts - 1; i++) {
            compiler += `-${parts[i]}`;
        }
        version = parts[numParts - 1];
    }

    // Normalize compiler name
    compiler = compiler.toLowerCase();
    if (compiler.startsWith('gcc') || compiler.startsWith('g++')) {
        compiler = 'gcc';
    } else if (compiler.startsWith('clang') || compiler.startsWith('apple-clang') || compiler.startsWith('appleclang')) {
        if (process.platform === 'win32') {
            compiler = 'clang-cl';
        } else {
            compiler = 'clang';
        }
    } else if (compiler.startsWith('msvc') || compiler.startsWith('cl')) {
        compiler = 'msvc';
    }

    return {
        compiler,
        version
    };
}

/**
 * Normalizes an architecture string to MSVC-compatible format.
 *
 * @param arch - Architecture string to normalize
 * @returns Normalized architecture: 'x86', 'x64', 'arm64', 'arm', or the original value
 */
function normalizeMSVCArchToken(arch: string): string {
    if (!arch) {
        return '';
    }
    const token = arch.toLowerCase();
    if (['x86', 'win32', 'i386', 'i486', 'i586', 'i686', 'ia32'].includes(token)) {
        return 'x86';
    }
    if (['x64', 'amd64', 'x86_64', 'x86-64'].includes(token)) {
        return 'x64';
    }
    if (['arm64', 'aarch64'].includes(token)) {
        return 'arm64';
    }
    if (['arm', 'arm32'].includes(token)) {
        return 'arm';
    }
    return arch;
}

/**
 * Resolves the target architecture for MSVC compilation.
 *
 * Normalizes architecture tokens to canonical MSVC values (x86, x64, arm, arm64).
 * Falls back through requested architecture, environment architecture, and finally
 * defaults to x64.
 *
 * @param requestedArch - The explicitly requested architecture (highest priority)
 * @param envArch - Architecture from environment variable PROCESSOR_ARCHITECTURE (fallback)
 * @returns Normalized architecture string: 'x86', 'x64', 'arm', or 'arm64'
 */
export function resolveMSVCArch(requestedArch: string, envArch: string | undefined): string {
    const normalizedRequested = normalizeMSVCArchToken(requestedArch);
    if (normalizedRequested) {
        return normalizedRequested;
    }
    const normalizedEnv = normalizeMSVCArchToken(envArch || '');
    if (normalizedEnv) {
        return normalizedEnv;
    }
    return 'x64';
}

/**
 * Main function that sets up the C++ compiler.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing compiler paths and version info
 */
async function main(inputs: Inputs): Promise<Record<string, unknown>> {
    // Normalize architecture
    const normalizedArch = normalizeMSVCArchToken(inputs.arch);

    // Normalize compiler and version
    const { compiler, version } = normalizeCompiler(inputs.compiler, inputs.version);

    let outputPath: string | null = null;
    let cc: string | null = null;
    let cxx: string | null = null;
    let bindir: string | null = null;
    let dir: string | null = null;
    let release: string | null = null;
    let versionMajor: number | null = null;
    let versionMinor: number | null = null;
    let versionPatch: number | null = null;

    if (['clang', 'gcc'].includes(compiler) && process.platform === 'linux') {
        traceCommands.log(`compiler: ${compiler}... forwarding to setup ${compiler} action.`);
        let setupResult: SetupResult | null = null;
        if (compiler === 'clang') {
            setupResult = await setup_clang.main(
                version,
                inputs.path,
                inputs.checkLatest,
                inputs.updateEnvironment
            );
        } else if (compiler === 'gcc') {
            setupResult = await setup_gcc.main(
                version,
                inputs.path,
                inputs.checkLatest,
                inputs.updateEnvironment
            );
        }
        if (setupResult !== null) {
            outputPath = setupResult.outputPath ?? null;
            cc = setupResult.cc;
            cxx = setupResult.cxx;
            bindir = setupResult.bindir;
            dir = setupResult.dir;
            release = setupResult.release ?? null;
            versionMajor = setupResult.versionMajor;
            versionMinor = setupResult.versionMinor;
            versionPatch = setupResult.versionPatch;
        }
    } else if (compiler === 'msvc') {
        traceCommands.log(`compiler: ${compiler}... forwarding to setup-msvc.`);
        const arch = resolveMSVCArch(normalizedArch, process.env['PROCESSOR_ARCHITECTURE']);
        let msvcOutputs: SetupResult;
        try {
            msvcOutputs = await setup_msvc.main(
                version,
                arch,
                '',
                '',
                false,
                false,
                ''
            );
        } catch (error) {
            core.setFailed((error as Error).message);
            return {};
        }
        core.startGroup('📗 MSVC Environment Variables');
        for (const [key, value] of Object.entries(process.env)) {
            traceCommands.log(`${key}: ${value}`);
        }
        core.endGroup();
        outputPath = msvcOutputs.cc;
        cc = msvcOutputs.cc;
        cxx = msvcOutputs.cxx;
        bindir = msvcOutputs.bindir;
        dir = msvcOutputs.dir;
        release = msvcOutputs.release ?? null;
        versionMajor = msvcOutputs.versionMajor;
        versionMinor = msvcOutputs.versionMinor;
        versionPatch = msvcOutputs.versionPatch;
    } else if (['mingw', 'mingw32', 'mingw64', 'gcc', 'clang', 'clang-cl'].includes(compiler)) {
        core.startGroup(`🔍 Searching for ${compiler}`);
        traceCommands.log(`compiler: ${compiler}... looking for compiler in PATH.`);
        let whichArg: string;
        if (['mingw', 'mingw32', 'mingw64', 'gcc'].includes(compiler)) {
            whichArg = 'gcc';
        } else if (compiler === 'clang' && process.platform === 'win32') {
            whichArg = 'clang-cl';
        } else {
            whichArg = compiler;
        }
        // Check if executable exists
        let compilerPath: string | null;
        try {
            compilerPath = await io.which(whichArg);
        } catch {
            compilerPath = null;
        }
        if (compilerPath === null || compilerPath === '') {
            core.setFailed(`Cannot find ${whichArg}`);
        } else {
            // Set outputs
            outputPath = compilerPath;
            cc = compilerPath;
            cxx = compilerPath.replace(/gcc/g, 'g++').replace(/clang/g, 'clang++');
            if (!fs.existsSync(cxx)) {
                cxx = cc;
            }
            bindir = path.dirname(outputPath);
            dir = path.dirname(bindir);

            // Get version
            const { exitCode, stdout } = await exec.getExecOutput(`"${outputPath}"`, ['--version']);
            const versionOutput = stdout.trim();
            if (exitCode !== 0) {
                traceCommands.log(`Path program ${outputPath} --version exited with code ${exitCode}`);
                release = '0.0.0';
                versionMajor = 0;
                versionMinor = 0;
                versionPatch = 0;
            } else {
                const versionRegexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
                for (const versionRegex of versionRegexes) {
                    const versionMatches = versionOutput.match(versionRegex);
                    if (versionMatches !== null) {
                        const versionStr = versionMatches[1];
                        const parsedVersion = semver.coerce(versionStr, { loose: true });
                        if (parsedVersion === null) {
                            continue;
                        }
                        release = parsedVersion.toString();
                        versionMajor = parsedVersion.major;
                        versionMinor = parsedVersion.minor;
                        versionPatch = parsedVersion.patch;
                        break;
                    }
                }
            }
        }
        core.endGroup();
    }

    // Return outputs
    if (outputPath !== null && outputPath !== undefined) {
        return {
            cc,
            cxx,
            bindir,
            dir,
            version: release,
            versionMajor,
            versionMinor,
            versionPatch
        };
    }

    core.setFailed(`Cannot setup ${compiler}`);
    return {};
}

/**
 * Action entry point using schema-driven runner.
 *
 * This replaces the previous manual input extraction and error handling
 * with the standardized runAction wrapper.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'Setup C++',
    main: async (inputs: Inputs) => {
        return await main(inputs);
    },
    callerModule: module
});
