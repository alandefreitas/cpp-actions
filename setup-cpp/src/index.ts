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

// Schema imports
import { type Inputs, inputsSchema, outputsSchema } from './schema';
export type { Inputs };
export { inputsSchema, outputsSchema };

/**
 * Result of normalizing a compiler name and version.
 */
export interface NormalizedCompiler {
    compiler: string;
    version: string;
}

/**
 * Result of setting up a C++ compiler.
 */
export interface SetupResult {
    outputPath?: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string | null;
    dir: string | null;
    release?: string | null;
    versionMajor: number | null;
    versionMinor: number | null;
    versionPatch: number | null;
}

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
 * Runner class for the setup-cpp action.
 *
 * Orchestrates compiler setup by delegating to the appropriate setup action
 * (setup-gcc, setup-clang, setup-msvc) or searching PATH for the compiler.
 */
class SetupCppRunner {
    /** Frozen action inputs */
    private readonly inputs: Inputs;

    /** Normalized compiler name (gcc, clang, clang-cl, msvc, mingw, etc.) */
    private compiler!: string;

    /** Resolved compiler version */
    private version!: string;

    /** Normalized architecture for MSVC */
    private normalizedArch!: string;

    /** Absolute path to the C compiler executable */
    private cc: string | null = null;

    /** Absolute path to the C++ compiler executable */
    private cxx: string | null = null;

    /** Absolute path to the directory containing the executable */
    private bindir: string | null = null;

    /** Absolute path to the directory containing the installation */
    private dir: string | null = null;

    /** Path to the compiler output (typically same as cc) */
    private outputPath: string | null = null;

    /** Resolved compiler version string (e.g., "14.2.0") */
    private release: string | null = null;

    /** Resolved version major component */
    private versionMajor: number | null = null;

    /** Resolved version minor component */
    private versionMinor: number | null = null;

    /** Resolved version patch component */
    private versionPatch: number | null = null;

    /**
     * Creates a new SetupCppRunner instance.
     *
     * @param inputs - Action inputs frozen at construction time
     */
    constructor(inputs: Inputs) {
        this.inputs = { ...inputs };
    }

    /**
     * Executes the compiler setup pipeline.
     *
     * @returns Output map with compiler paths and version info, or empty on failure
     */
    async run(): Promise<Record<string, unknown>> {
        this.normalizedArch = normalizeMSVCArchToken(this.inputs.arch);
        const normalized = normalizeCompiler(this.inputs.compiler, this.inputs.version);
        this.compiler = normalized.compiler;
        this.version = normalized.version;

        if (['clang', 'gcc'].includes(this.compiler) && process.platform === 'linux') {
            await this.setupLinuxCompiler();
        } else if (this.compiler === 'msvc') {
            const success = await this.setupMsvc();
            if (!success) {
                return {};
            }
        } else if (['mingw', 'mingw32', 'mingw64', 'gcc', 'clang', 'clang-cl'].includes(this.compiler)) {
            await this.searchPathCompiler();
        }

        return this.buildOutputs();
    }

    /**
     * Sets up GCC or Clang on Linux by delegating to the respective setup action.
     */
    private async setupLinuxCompiler(): Promise<void> {
        traceCommands.log(`compiler: ${this.compiler}... forwarding to setup ${this.compiler} action.`);
        let setupResult: SetupResult | null = null;
        if (this.compiler === 'clang') {
            setupResult = await setup_clang.main({
                version: this.version,
                path: this.inputs.path,
                checkLatest: this.inputs.checkLatest,
                updateEnvironment: this.inputs.updateEnvironment,
                traceCommands: this.inputs.traceCommands
            });
        } else if (this.compiler === 'gcc') {
            setupResult = await setup_gcc.main({
                version: this.version,
                path: this.inputs.path,
                checkLatest: this.inputs.checkLatest,
                updateEnvironment: this.inputs.updateEnvironment,
                traceCommands: this.inputs.traceCommands
            });
        }
        if (setupResult !== null) {
            this.applySetupResult(setupResult);
        }
    }

    /**
     * Sets up MSVC by delegating to the setup-msvc action.
     *
     * @returns true if setup succeeded, false if it failed
     */
    private async setupMsvc(): Promise<boolean> {
        traceCommands.log(`compiler: ${this.compiler}... forwarding to setup-msvc.`);
        const arch = resolveMSVCArch(this.normalizedArch, process.env['PROCESSOR_ARCHITECTURE']);
        let msvcOutputs: SetupResult;
        try {
            msvcOutputs = await setup_msvc.main({
                version: this.version,
                arch,
                sdk: '',
                toolset: '',
                uwp: false,
                spectre: false,
                visualStudioVersion: '',
                traceCommands: this.inputs.traceCommands
            });
        } catch (error) {
            core.setFailed((error as Error).message);
            return false;
        }
        core.startGroup('📗 MSVC Environment Variables');
        for (const [key, value] of Object.entries(process.env)) {
            traceCommands.log(`${key}: ${value}`);
        }
        core.endGroup();
        this.applySetupResult(msvcOutputs);
        this.outputPath = msvcOutputs.cc;
        return true;
    }

    /**
     * Searches PATH for a compiler executable (mingw, gcc, clang on non-Linux).
     */
    private async searchPathCompiler(): Promise<void> {
        core.startGroup(`🔍 Searching for ${this.compiler}`);
        traceCommands.log(`compiler: ${this.compiler}... looking for compiler in PATH.`);
        let whichArg: string;
        if (['mingw', 'mingw32', 'mingw64', 'gcc'].includes(this.compiler)) {
            whichArg = 'gcc';
        } else if (this.compiler === 'clang' && process.platform === 'win32') {
            whichArg = 'clang-cl';
        } else {
            whichArg = this.compiler;
        }
        let compilerPath: string | null;
        try {
            compilerPath = await io.which(whichArg);
        } catch {
            compilerPath = null;
        }
        if (compilerPath === null || compilerPath === '') {
            core.setFailed(`Cannot find ${whichArg}`);
        } else {
            this.outputPath = compilerPath;
            this.cc = compilerPath;
            this.cxx = compilerPath.replace(/gcc/g, 'g++').replace(/clang/g, 'clang++');
            if (!fs.existsSync(this.cxx)) {
                this.cxx = this.cc;
            }
            this.bindir = path.dirname(this.outputPath);
            this.dir = path.dirname(this.bindir);
            await this.detectVersionFromPath();
        }
        core.endGroup();
    }

    /**
     * Detects the compiler version by running `--version` on the output path.
     */
    private async detectVersionFromPath(): Promise<void> {
        const { exitCode, stdout } = await exec.getExecOutput(`"${this.outputPath}"`, ['--version']);
        const versionOutput = stdout.trim();
        if (exitCode !== 0) {
            traceCommands.log(`Path program ${this.outputPath} --version exited with code ${exitCode}`);
            this.release = '0.0.0';
            this.versionMajor = 0;
            this.versionMinor = 0;
            this.versionPatch = 0;
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
                    this.release = parsedVersion.toString();
                    this.versionMajor = parsedVersion.major;
                    this.versionMinor = parsedVersion.minor;
                    this.versionPatch = parsedVersion.patch;
                    break;
                }
            }
        }
    }

    /**
     * Applies a setup result from a delegated action to class members.
     *
     * @param result - The setup result to apply
     */
    private applySetupResult(result: SetupResult): void {
        this.outputPath = result.outputPath ?? null;
        this.cc = result.cc;
        this.cxx = result.cxx;
        this.bindir = result.bindir;
        this.dir = result.dir;
        this.release = result.release ?? null;
        this.versionMajor = result.versionMajor;
        this.versionMinor = result.versionMinor;
        this.versionPatch = result.versionPatch;
    }

    /**
     * Builds the output map from accumulated state.
     *
     * @returns Output map with compiler paths and version, or empty on failure
     */
    private buildOutputs(): Record<string, unknown> {
        if (this.outputPath !== null && this.outputPath !== undefined) {
            return {
                cc: this.cc,
                cxx: this.cxx,
                bindir: this.bindir,
                dir: this.dir,
                version: this.release,
                versionMajor: this.versionMajor,
                versionMinor: this.versionMinor,
                versionPatch: this.versionPatch
            };
        }
        core.setFailed(`Cannot setup ${this.compiler}`);
        return {};
    }
}

/**
 * Main function that sets up the C++ compiler.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing compiler paths and version info
 */
async function main(inputs: Inputs): Promise<Record<string, unknown>> {
    return new SetupCppRunner(inputs).run();
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
