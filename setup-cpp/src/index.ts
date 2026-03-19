import * as core from '@actions/core';
import * as io from '@actions/io';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import { ExpectedError } from 'pretty-errors';

import * as setup_gcc from 'setup-gcc';
import * as setup_clang from 'setup-clang';
import * as setup_msvc from 'setup-msvc';
import * as setup_program from 'setup-program';
import { scanInstalledXcodes } from './apple-clang-utils';

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
    version?: string | null;
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
 * - Apple Clang: apple-clang, appleclang → normalized to "apple-clang"
 * - Clang: clang → normalized to "clang" (or "clang-cl" on Windows)
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
    if (compiler === 'macos-gcc' || compiler === 'macosgcc' || compiler === 'brew-gcc' || compiler === 'brewgcc') {
        compiler = 'macos-gcc';
    } else if (compiler === 'macos-clang' || compiler === 'macosclang' || compiler === 'brew-clang' || compiler === 'brewclang' || compiler === 'macos-llvm') {
        compiler = 'macos-clang';
    } else if (compiler === 'mingw' || compiler === 'mingw32' || compiler === 'mingw64') {
        compiler = 'mingw';
    } else if (compiler === 'clang-cl') {
        compiler = 'clang-cl';
    } else if (compiler.startsWith('gcc') || compiler.startsWith('g++')) {
        compiler = 'gcc';
    } else if (compiler === 'apple-clang' || compiler.startsWith('appleclang')) {
        compiler = 'apple-clang';
    } else if (compiler.startsWith('clang')) {
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
     * @throws {ExpectedError} If apple-clang is requested on a non-macOS platform
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
        } else if (this.compiler === 'apple-clang' && process.platform !== 'darwin') {
            throw new ExpectedError(
                'Apple Clang is only available on macOS',
                'Unsupported Platform'
            );
        } else if (this.compiler === 'apple-clang' && this.version && this.version !== '*') {
            await this.setupAppleClang();
        } else if (this.compiler === 'apple-clang') {
            await this.setupAppleClangDefault();
        } else if (this.compiler === 'mingw') {
            if (process.platform !== 'win32') {
                throw new ExpectedError(
                    'MinGW is only available on Windows',
                    'Unsupported Platform'
                );
            }
            await this.setupDelegatedCompiler('gcc');
        } else if (this.compiler === 'clang-cl') {
            if (process.platform !== 'win32') {
                throw new ExpectedError(
                    'clang-cl is only available on Windows',
                    'Unsupported Platform'
                );
            }
            await this.setupDelegatedCompiler('clang');
        } else if (this.compiler === 'macos-gcc') {
            if (process.platform !== 'darwin') {
                throw new ExpectedError(
                    'macos-gcc is only available on macOS',
                    'Unsupported Platform'
                );
            }
            await this.setupDelegatedCompiler('gcc');
        } else if (this.compiler === 'macos-clang') {
            if (process.platform !== 'darwin') {
                throw new ExpectedError(
                    'macos-clang is only available on macOS',
                    'Unsupported Platform'
                );
            }
            await this.setupDelegatedCompiler('clang');
        } else if (['gcc', 'clang'].includes(this.compiler)) {
            await this.searchPathCompiler();
        }

        await this.ensureSymbolizerEnvVars();

        // Export compiler family for downstream actions (e.g., cmake-workflow
        // uses it to disambiguate artifact names for compilers sharing binaries)
        core.exportVariable('CPP_ACTIONS_COMPILER', this.compiler);

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
     * Delegates compiler setup to setup-gcc or setup-clang.
     *
     * Used for platform-specific compilers (mingw, clang-cl, macos-gcc, macos-clang)
     * that are handled by the respective setup actions' platform-dispatching pipelines.
     *
     * @param family - The setup action family to delegate to: 'gcc' or 'clang'
     */
    private async setupDelegatedCompiler(family: 'gcc' | 'clang'): Promise<void> {
        traceCommands.log(`compiler: ${this.compiler}... forwarding to setup-${family} action.`);
        const inputs = {
            version: this.version,
            path: this.inputs.path,
            checkLatest: this.inputs.checkLatest,
            updateEnvironment: this.inputs.updateEnvironment,
            traceCommands: this.inputs.traceCommands
        };
        let setupResult: SetupResult | null = null;
        if (family === 'gcc') {
            setupResult = await setup_gcc.main(inputs);
        } else {
            setupResult = await setup_clang.main(inputs);
        }
        if (setupResult !== null) {
            this.applySetupResult(setupResult);
        }
    }

    /**
     * Sets up MSVC by delegating to the setup-msvc action.
     *
     * @returns true if setup succeeded
     * @throws {ExpectedError} If MSVC setup fails
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
            throw new ExpectedError((error as Error).message, 'MSVC Setup Failed');
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
     * Sets up Apple Clang by selecting the Xcode installation whose Apple Clang
     * version satisfies the requested version range.
     *
     * Scans installed Xcodes, matches by version, sets DEVELOPER_DIR, and
     * falls back to xcode-select if DEVELOPER_DIR alone is insufficient.
     *
     * @throws {ExpectedError} If no installed Xcode matches the requested version
     */
    private async setupAppleClang(): Promise<void> {
        core.startGroup(`🍎 Setting up Apple Clang ${this.version}`);
        traceCommands.log(`compiler: apple-clang version ${this.version}... scanning installed Xcodes.`);

        const installedXcodes = await scanInstalledXcodes();
        if (installedXcodes.length === 0) {
            core.endGroup();
            throw new ExpectedError(
                'No Xcode installations found in /Applications/',
                'Apple Clang Setup Failed'
            );
        }

        // Match installed Xcodes against requested version
        const isJustMajor = /^\d+$/.test(this.version);
        const matching = installedXcodes.filter((x) => {
            const v = semver.coerce(x.appleClangVersion);
            if (!v) {
                return false;
            }
            if (isJustMajor) {
                return v.major === parseInt(this.version, 10);
            }
            const range = semver.validRange(this.version);
            if (range) {
                return semver.satisfies(v, this.version);
            }
            const requestedCoerced = semver.coerce(this.version);
            return requestedCoerced ? semver.eq(v, requestedCoerced) : false;
        });

        if (matching.length === 0) {
            core.endGroup();
            throw new ExpectedError(
                `No installed Xcode has Apple Clang version matching '${this.version}'. ` +
                `Available: ${installedXcodes.map((x) => `${x.appleClangVersion} (Xcode ${x.xcodeVersion})`).join(', ')}`,
                'Apple Clang Version Not Found'
            );
        }

        // Pick the first match (scanInstalledXcodes returns sorted by Apple Clang version descending)
        const selected = matching[0];
        const developerDir = `${selected.xcodePath}/Contents/Developer`;

        traceCommands.log(`Selected Xcode ${selected.xcodeVersion} at ${selected.xcodePath} (Apple Clang ${selected.appleClangVersion})`);

        // Set DEVELOPER_DIR for this process and future steps
        core.exportVariable('DEVELOPER_DIR', developerDir);
        process.env['DEVELOPER_DIR'] = developerDir;

        // Verify the selection works
        const verifyResult = await exec.getExecOutput('xcrun', ['clang', '--version'], {
            ignoreReturnCode: true,
            silent: true
        });

        if (verifyResult.exitCode !== 0) {
            core.warning('DEVELOPER_DIR did not work, falling back to xcode-select');
            await exec.exec('sudo', ['-n', 'xcode-select', '-s', selected.xcodePath], {
                ignoreReturnCode: true
            });
        }

        // Resolve cc and cxx paths
        const ccResult = await exec.getExecOutput('xcrun', ['--find', 'clang'], {
            silent: true,
            ignoreReturnCode: true
        });
        const cxxResult = await exec.getExecOutput('xcrun', ['--find', 'clang++'], {
            silent: true,
            ignoreReturnCode: true
        });

        this.cc = ccResult.stdout.trim();
        this.cxx = cxxResult.stdout.trim();
        if (!this.cc) {
            core.endGroup();
            throw new ExpectedError(
                'xcrun --find clang returned empty path. Ensure the selected Xcode is valid.',
                'Apple Clang Setup Failed'
            );
        }
        this.outputPath = this.cc;
        this.bindir = path.dirname(this.cc);
        this.dir = path.dirname(this.bindir);

        // Set version from the selected Xcode's Apple Clang version
        const parsedVersion = semver.coerce(selected.appleClangVersion);
        if (parsedVersion) {
            this.release = parsedVersion.toString();
            this.versionMajor = parsedVersion.major;
            this.versionMinor = parsedVersion.minor;
            this.versionPatch = parsedVersion.patch;
        }

        core.endGroup();

        await this.logCompilerTargetInfo();
    }

    /**
     * Sets up Apple Clang using the runner's default Xcode (no switching).
     *
     * Detects the current Apple Clang version via `xcrun clang --version` and
     * resolves cc/cxx paths via `xcrun --find`. Does not modify DEVELOPER_DIR
     * or call xcode-select.
     *
     * @throws {ExpectedError} If xcrun clang --version fails or cannot parse version
     */
    private async setupAppleClangDefault(): Promise<void> {
        core.startGroup('🍎 Detecting default Apple Clang');
        traceCommands.log('compiler: apple-clang (wildcard)... using runner default Xcode.');

        // Detect current Apple Clang version
        const versionResult = await exec.getExecOutput('xcrun', ['clang', '--version'], {
            ignoreReturnCode: true,
            silent: true
        });

        if (versionResult.exitCode !== 0) {
            core.endGroup();
            throw new ExpectedError(
                'Failed to run xcrun clang --version. Ensure Xcode or Command Line Tools are installed.',
                'Apple Clang Detection Failed'
            );
        }

        const versionMatch = versionResult.stdout.match(/Apple clang version (\d+\.\d+\.\d+)/);
        if (!versionMatch) {
            core.endGroup();
            throw new ExpectedError(
                'Could not parse Apple Clang version from xcrun clang --version output.',
                'Apple Clang Detection Failed'
            );
        }

        const parsedVersion = semver.coerce(versionMatch[1]);
        if (parsedVersion) {
            this.release = parsedVersion.toString();
            this.versionMajor = parsedVersion.major;
            this.versionMinor = parsedVersion.minor;
            this.versionPatch = parsedVersion.patch;
        }

        // Resolve cc and cxx paths via xcrun
        const ccResult = await exec.getExecOutput('xcrun', ['--find', 'clang'], {
            silent: true,
            ignoreReturnCode: true
        });
        const cxxResult = await exec.getExecOutput('xcrun', ['--find', 'clang++'], {
            silent: true,
            ignoreReturnCode: true
        });

        this.cc = ccResult.stdout.trim();
        this.cxx = cxxResult.stdout.trim();
        if (!this.cc) {
            core.endGroup();
            throw new ExpectedError(
                'xcrun --find clang returned empty path. Ensure Xcode or Command Line Tools are installed.',
                'Apple Clang Detection Failed'
            );
        }
        this.outputPath = this.cc;
        this.bindir = path.dirname(this.cc);
        this.dir = path.dirname(this.bindir);

        traceCommands.log(`Default Apple Clang ${this.release} at ${this.cc}`);
        core.endGroup();

        await this.logCompilerTargetInfo();
    }

    /**
     * Logs Apple Clang target triple and supported targets as informational output.
     *
     * Runs `clang --print-target-triple` and `clang --print-targets` within a
     * grouped log section. Failures are logged as warnings but do not fail the action.
     */
    private async logCompilerTargetInfo(): Promise<void> {
        core.startGroup('\uD83C\uDFAF Compiler target info');
        try {
            const tripleResult = await exec.getExecOutput('xcrun', ['clang', '--print-target-triple'], {
                ignoreReturnCode: true,
                silent: true
            });
            if (tripleResult.exitCode === 0) {
                core.info(`Target triple: ${tripleResult.stdout.trim()}`);
            } else {
                core.warning('Failed to get target triple from xcrun clang --print-target-triple');
            }

            const targetsResult = await exec.getExecOutput('xcrun', ['clang', '--print-targets'], {
                ignoreReturnCode: true,
                silent: true
            });
            if (targetsResult.exitCode === 0) {
                core.info(`Supported targets:\n${targetsResult.stdout.trim()}`);
            } else {
                core.warning('Failed to get supported targets from xcrun clang --print-targets');
            }
        } catch {
            core.warning('Failed to retrieve compiler target info');
        }
        core.endGroup();
    }

    /**
     * Searches PATH for a compiler executable (mingw, gcc, clang on non-Linux).
     */
    private async searchPathCompiler(): Promise<void> {
        core.startGroup(`🔍 Searching for ${this.compiler}`);
        traceCommands.log(`compiler: ${this.compiler}... looking for compiler in PATH.`);
        const whichArg = this.compiler === 'gcc' ? 'gcc' : this.compiler;
        let compilerPath: string | null;
        try {
            compilerPath = await io.which(whichArg);
        } catch {
            compilerPath = null;
        }
        if (compilerPath === null || compilerPath === '') {
            core.endGroup();
            throw new ExpectedError(`Cannot find ${whichArg}. Ensure the compiler is installed and available in PATH.`, 'Compiler Not Found');
        }
        this.outputPath = compilerPath;
        this.cc = compilerPath;
        this.cxx = compilerPath.replace(/gcc/g, 'g++').replace(/clang/g, 'clang++');
        if (!fs.existsSync(this.cxx)) {
            this.cxx = this.cc;
        }
        this.bindir = path.dirname(this.outputPath);
        this.dir = path.dirname(this.bindir);
        await this.detectVersionFromPath();
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
        this.release = result.version ?? null;
        this.versionMajor = result.versionMajor;
        this.versionMinor = result.versionMinor;
        this.versionPatch = result.versionPatch;
    }

    /**
     * Ensures LLVM_SYMBOLIZER_PATH and sanitizer env vars are set when a
     * symbolizer is available.
     *
     * Delegated compiler setups (setup-clang, setup-gcc on Linux) handle this
     * internally. This method covers the remaining paths: MSVC, mingw,
     * gcc/clang found via PATH on non-Linux, and clang-cl.
     */
    private async ensureSymbolizerEnvVars(): Promise<void> {
        if (!this.inputs.updateEnvironment) {
            return;
        }
        if (process.env['LLVM_SYMBOLIZER_PATH']) {
            return;
        }
        if (!this.outputPath) {
            return;
        }

        const majorVersion = this.versionMajor ?? 0;
        const symbolizerPath = await setup_program.findLlvmSymbolizer(majorVersion);
        if (symbolizerPath) {
            core.info(`llvm-symbolizer found at ${symbolizerPath}`);
            setup_program.exportSymbolizerEnvVars(symbolizerPath);
        }
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
        throw new ExpectedError(`Cannot setup ${this.compiler}. Check that the compiler is installed and the version is available.`, 'Compiler Setup Failed');
    }
}

/**
 * Main function that sets up the C++ compiler.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing compiler paths and version info
 */
export async function main(inputs: Inputs): Promise<Record<string, unknown>> {
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
