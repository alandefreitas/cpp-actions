import * as core from '@actions/core';
import * as io from '@actions/io';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import { runAction } from 'action-schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_gcc = require('setup-gcc');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_clang = require('setup-clang');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_msvc = require('setup-msvc');

// Type imports and re-exports
import { NormalizedCompiler, Inputs, SetupResult } from './types';
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
    const num_parts = parts.length;

    // Split compiler from version in the compiler name
    // If the compiler is something like "gcc-10.2.0", we need to split it
    if (num_parts !== 1 && /[\d\\.]+/.test(parts[num_parts - 1])) {
        compiler = parts[0];
        for (let i = 1; i < num_parts - 1; i++) {
            compiler += `-${parts[i]}`;
        }
        version = parts[num_parts - 1];
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

    let output_path: string | null = null;
    let cc: string | null = null;
    let cxx: string | null = null;
    let bindir: string | null = null;
    let dir: string | null = null;
    let release: string | null = null;
    let version_major: number | null = null;
    let version_minor: number | null = null;
    let version_patch: number | null = null;

    if (['clang', 'gcc'].includes(compiler) && process.platform === 'linux') {
        trace_commands.log(`compiler: ${compiler}... forwarding to setup ${compiler} action.`);
        let setupResult: SetupResult | null = null;
        if (compiler === 'clang') {
            setupResult = await setup_clang.main(
                version,
                inputs.path,
                inputs.check_latest,
                inputs.update_environment
            );
        } else if (compiler === 'gcc') {
            setupResult = await setup_gcc.main(
                version,
                inputs.path,
                inputs.check_latest,
                inputs.update_environment
            );
        }
        if (setupResult !== null) {
            output_path = setupResult.output_path;
            cc = setupResult.cc;
            cxx = setupResult.cxx;
            bindir = setupResult.bindir;
            dir = setupResult.dir;
            release = setupResult.release;
            version_major = setupResult.version_major;
            version_minor = setupResult.version_minor;
            version_patch = setupResult.version_patch;
        }
    } else if (compiler === 'msvc') {
        trace_commands.log(`compiler: ${compiler}... forwarding to setup-msvc.`);
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
            trace_commands.log(`${key}: ${value}`);
        }
        core.endGroup();
        output_path = msvcOutputs.cc;
        cc = msvcOutputs.cc;
        cxx = msvcOutputs.cxx;
        bindir = msvcOutputs.bindir;
        dir = msvcOutputs.dir;
        release = msvcOutputs.release;
        version_major = msvcOutputs.version_major;
        version_minor = msvcOutputs.version_minor;
        version_patch = msvcOutputs.version_patch;
    } else if (['mingw', 'mingw32', 'mingw64', 'gcc', 'clang', 'clang-cl'].includes(compiler)) {
        core.startGroup(`🔍 Searching for ${compiler}`);
        trace_commands.log(`compiler: ${compiler}... looking for compiler in PATH.`);
        let which_arg: string;
        if (['mingw', 'mingw32', 'mingw64', 'gcc'].includes(compiler)) {
            which_arg = 'gcc';
        } else if (compiler === 'clang' && process.platform === 'win32') {
            which_arg = 'clang-cl';
        } else {
            which_arg = compiler;
        }
        // Check if executable exists
        let compiler_path: string | null;
        try {
            compiler_path = await io.which(which_arg);
        } catch {
            compiler_path = null;
        }
        if (compiler_path === null || compiler_path === '') {
            core.setFailed(`Cannot find ${which_arg}`);
        } else {
            // Set outputs
            output_path = compiler_path;
            cc = compiler_path;
            cxx = compiler_path.replace(/gcc/g, 'g++').replace(/clang/g, 'clang++');
            if (!fs.existsSync(cxx)) {
                cxx = cc;
            }
            bindir = path.dirname(output_path);
            dir = path.dirname(bindir);

            // Get version
            const { exitCode, stdout } = await exec.getExecOutput(`"${output_path}"`, ['--version']);
            const version_output = stdout.trim();
            if (exitCode !== 0) {
                trace_commands.log(`Path program ${output_path} --version exited with code ${exitCode}`);
                release = '0.0.0';
                version_major = 0;
                version_minor = 0;
                version_patch = 0;
            } else {
                const version_regexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
                for (const version_regex of version_regexes) {
                    const version_matches = version_output.match(version_regex);
                    if (version_matches !== null) {
                        const version_str = version_matches[1];
                        const parsedVersion = semver.coerce(version_str, { loose: true });
                        if (parsedVersion === null) {
                            continue;
                        }
                        release = parsedVersion.toString();
                        version_major = parsedVersion.major;
                        version_minor = parsedVersion.minor;
                        version_patch = parsedVersion.patch;
                        break;
                    }
                }
            }
        }
        core.endGroup();
    }

    // Return outputs
    if (output_path !== null && output_path !== undefined) {
        return {
            cc,
            cxx,
            bindir,
            dir,
            version: release,
            version_major,
            version_minor,
            version_patch
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
