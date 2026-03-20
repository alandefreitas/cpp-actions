import * as core from '@actions/core';
import * as io from '@actions/io';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import { ExpectedError } from 'pretty-errors';

import * as setup_program from 'setup-program';
import {
    findProgramWithBrew,
    installProgramWithBrew,
    findProgramWithChoco,
    installProgramWithChoco,
    findProgramWithApt
} from 'package-install';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Re-export removeGCCPrefix for external use
export { removeGCCPrefix } from './schema';

// Type imports and re-exports
import { type Inputs } from './schema';
import { type ProgramResult } from './gcc-download';
import { downloadGccFromUrl } from './gcc-download';
export type { Inputs };
export type { ProgramResult };

/**
 * Output values produced by GCC setup.
 */
export interface MainOutputs {
    outputPath: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    versionMajor: number;
    versionMinor: number;
    versionPatch: number;
}

// ─── SetupGccRunner ─────────────────────────────────────────────────

/**
 * Orchestrates GCC compiler setup on the runner.
 *
 * Pipeline phases:
 * 1. Discover available GCC versions
 * 2. Search user-provided paths
 * 3. Search system paths
 * 4. Search via APT package manager
 * 5. Download from release binaries
 * 6. Find/install llvm-symbolizer and export env vars
 * 7. Build output values (cc, cxx, bindir, etc.)
 */
class SetupGccRunner {
    /** Frozen copy of action inputs */
    private readonly inputs: Inputs;

    /** All known GCC versions fetched from version data */
    private allVersions: string[] = [];

    /** Resolved path to the gcc/g++ binary, set progressively by search phases */
    private outputPath: string | null = null;

    /** Resolved version string, set progressively by search phases */
    private outputVersion: string | null = null;

    /** Path to llvm-symbolizer, set by installSymbolizer phase */
    private symbolizerPath: string | null = null;

    /** Program names to search for — prefer g++ so libstdc++ headers come along */
    private readonly names = ['g++', 'gcc'];

    constructor(inputs: Inputs) {
        this.inputs = { ...inputs };
    }

    /**
     * Runs the full GCC setup pipeline and returns output values.
     *
     * Dispatches to platform-specific pipelines:
     * - Linux: user paths → system paths → APT → download → symbolizer
     * - macOS: user paths → system paths → Homebrew → symbolizer
     * - Windows: user paths → system paths → Chocolatey → symbolizer
     * - Other platforms: throws ExpectedError
     *
     * @returns Object containing paths to gcc/g++, version info, and environment changes
     */
    async run(): Promise<MainOutputs> {
        await this.discoverVersions();
        await this.searchUserPaths();
        await this.searchSystemPaths();
        if (process.platform === 'linux') {
            await this.searchApt();
            await this.downloadFromUrl();
        } else if (process.platform === 'darwin') {
            await this.searchBrew();
        } else if (process.platform === 'win32') {
            await this.searchChoco();
        }
        await this.installSymbolizer();
        return this.buildOutputs();
    }

    /**
     * Discovers all available GCC versions and configures platform-specific
     * environment variables.
     *
     * @throws ExpectedError if the current platform is not linux, darwin, or win32
     */
    private async discoverVersions(): Promise<void> {
        core.startGroup('🔎 Find GCC versions');
        if (process.platform === 'darwin') {
            process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
        }

        if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
            process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
        }

        if (process.platform !== 'linux' && process.platform !== 'darwin' && process.platform !== 'win32') {
            // Untested: requires an unsupported platform like freebsd
            throw new ExpectedError(
                `This action is not supported on ${process.platform}`,
                'Unsupported Platform'
            );
        }

        this.allVersions = await setup_program.findGCCVersions();
        core.endGroup();
    }

    /**
     * Searches for GCC in the user-provided paths.
     */
    private async searchUserPaths(): Promise<void> {
        core.startGroup('🔍 Find GCC in specified paths');
        core.info(`Searching for GCC ${this.inputs.version} in paths [${this.inputs.path.join(',')}]`);
        const pathResult: ProgramResult = await setup_program.findProgramInPath(
            this.inputs.path, this.inputs.version, this.inputs.checkLatest
        );
        this.outputVersion = pathResult.outputVersion;
        this.outputPath = pathResult.outputPath;
        core.endGroup();
    }

    /**
     * Searches for GCC in standard system paths (PATH).
     * Skipped if a binary was already found in user-provided paths.
     */
    private async searchSystemPaths(): Promise<void> {
        if (this.outputPath !== null) {
            return;
        }
        core.startGroup('📁 Find GCC in system paths');
        core.info(`Searching for GCC ${this.inputs.version} in PATH`);
        const systemResult: ProgramResult = await setup_program.findProgramInSystemPaths(
            this.inputs.path, this.names, this.inputs.version, this.inputs.checkLatest
        );
        this.outputVersion = systemResult.outputVersion;
        this.outputPath = systemResult.outputPath;
        core.endGroup();
    }

    /**
     * Searches for GCC via Homebrew on macOS.
     *
     * Homebrew installs GCC with versioned binary names (e.g., gcc-14, g++-14).
     * If not already found, attempts to install the formula `gcc@{major}`.
     * Skipped if a binary was already found in user-provided or system paths.
     */
    private async searchBrew(): Promise<void> {
        if (this.outputPath !== null) {
            return;
        }
        core.startGroup('🍺 Find GCC with Homebrew');
        const parsed = this.inputs.version !== '*'
            ? semver.coerce(this.inputs.version, { loose: true })
            : null;
        const major = parsed?.major ?? null;

        if (major === null) {
            core.info('No specific GCC version requested — cannot determine Homebrew formula');
            core.endGroup();
            return;
        }

        const formula = `gcc@${major}`;
        const binaryName = `gcc-${major}`;
        core.info(`Searching for GCC ${major} via Homebrew formula ${formula}`);

        // Try to find the already-installed formula
        let result = await findProgramWithBrew(formula, binaryName);
        if (result === null) {
            // Not found — attempt installation
            core.info(`${formula} not found, installing via Homebrew`);
            const prefix = await installProgramWithBrew(formula);
            if (prefix !== null) {
                result = await findProgramWithBrew(formula, binaryName);
            }
        }

        if (result !== null) {
            this.outputPath = result.path;
            this.outputVersion = result.version;
            core.info(`Found GCC ${result.version} at ${result.path}`);
        }

        core.endGroup();
    }

    /**
     * Searches for GCC (MinGW) via Chocolatey on Windows.
     *
     * Searches known MinGW install paths (`C:\mingw64\bin` for runner pre-installed,
     * `C:\ProgramData\mingw64\bin` for Chocolatey-installed). If not found or the
     * wrong version, installs via `choco install mingw`.
     * Skipped if a binary was already found in user-provided or system paths.
     */
    private async searchChoco(): Promise<void> {
        if (this.outputPath !== null) {
            return;
        }
        core.startGroup('🍫 Find GCC (MinGW) with Chocolatey');
        const parsed = this.inputs.version !== '*'
            ? semver.coerce(this.inputs.version, { loose: true })
            : null;
        const major = parsed?.major ?? null;

        const searchPaths = [
            'C:\\mingw64\\bin',
            'C:\\ProgramData\\mingw64\\bin'
        ];

        // Search known install paths
        const result = await findProgramWithChoco('mingw', 'gcc.exe', searchPaths);
        if (result !== null) {
            // Check if version matches the requested major
            const foundMajor = semver.coerce(result.version, { loose: true })?.major ?? null;
            if (major === null || foundMajor === major) {
                this.outputPath = result.path;
                this.outputVersion = result.version;
                core.info(`Found MinGW GCC ${result.version} at ${result.path}`);
                core.endGroup();
                return;
            }
            core.info(`Found MinGW GCC ${result.version} but need major ${major}`);
        }

        // Not found or wrong version — attempt Chocolatey install
        if (major !== null) {
            core.info(`Installing MinGW GCC ${major} via Chocolatey`);

            // Find the exact installable version matching the requested major
            const chocoVersion = this.findInstallableVersion(major);
            const installDir = 'C:\\ProgramData\\mingw64\\bin';

            const installResult = await installProgramWithChoco('mingw', chocoVersion ?? undefined, installDir);
            if (installResult !== null) {
                const afterInstall = await findProgramWithChoco('mingw', 'gcc.exe', searchPaths);
                if (afterInstall !== null) {
                    this.outputPath = afterInstall.path;
                    this.outputVersion = afterInstall.version;
                    core.info(`Installed MinGW GCC ${afterInstall.version} at ${afterInstall.path}`);
                }
            }
        } else {
            core.info('No specific GCC version requested — cannot determine Chocolatey version');
        }

        core.endGroup();
    }

    /**
     * Finds the exact installable MinGW version matching a requested major version.
     *
     * Searches the `installable_mingw` list from the Windows data file for a version
     * whose major matches the requested major. Returns the highest matching version.
     *
     * @param major - The requested GCC major version
     * @returns The exact installable version string, or null if not found
     */
    private findInstallableVersion(major: number): string | null {
        try {
            const data = setup_program.loadWindowsMsvcDefaults();
            const installable = data.installable_mingw ?? [];
            let best: string | null = null;
            for (const v of installable) {
                const coerced = semver.coerce(v, { loose: true });
                if (coerced && coerced.major === major) {
                    if (best === null || semver.gt(coerced, best)) {
                        best = coerced.format();
                    }
                }
            }
            return best;
        } catch {
            // Untested: requires missing or corrupt data file
            return null;
        }
    }

    /**
     * Searches for GCC via APT package manager on Linux.
     * Adds the ubuntu-toolchain-r PPA if available.
     * Skipped if a binary was already found or if not on Linux.
     */
    private async searchApt(): Promise<void> {
        if (this.outputVersion !== null) {
            traceCommands.log(
                `Skipping APT step because GCC ${this.outputVersion} was already found in ${this.outputPath}`
            );
            return;
        }
        if (process.platform !== 'linux') {
            traceCommands.log(`Skipping APT step because platform is ${process.platform}`);
            return;
        }
        // outputVersion === null && process.platform === 'linux'
        core.startGroup('📦 Find GCC with APT');
        core.info(`Searching for GCC ${this.inputs.version} with APT`);

        // Add APT repository
        await findProgramWithApt(['software-properties-common'], '*', true);
        let addAptRepositoryPath: string | null = null;
        try {
            addAptRepositoryPath = await io.which('add-apt-repository');
            traceCommands.log(`add-apt-repository found at ${addAptRepositoryPath}`);
        } catch {
            addAptRepositoryPath = null;
        }
        if (addAptRepositoryPath !== null && addAptRepositoryPath !== '') {
            const repo = `ppa:ubuntu-toolchain-r/ppa`;
            traceCommands.log(`Adding repository "${repo}"`);
            if (setup_program.isSudoRequired()) {
                await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
            } else {
                await exec.exec(`add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
            }
        }

        const aptResult: ProgramResult = await findProgramWithApt(
            this.names, this.inputs.version, this.inputs.checkLatest
        );
        this.outputVersion = aptResult.outputVersion;
        this.outputPath = aptResult.outputPath;
        core.endGroup();
    }

    /**
     * Downloads GCC from release binaries as a last resort.
     * Tries Ubuntu-versioned binaries first, then generic Linux binaries.
     * Skipped if a binary was already found.
     */
    private async downloadFromUrl(): Promise<void> {
        if (this.outputVersion !== null) {
            traceCommands.log(
                `Skipping download step because GCC ${this.outputVersion} was already found in ${this.outputPath}`
            );
            return;
        }

        core.startGroup('⬇️ Download GCC from release binaries');
        core.info(`Fetching GCC ${this.inputs.version} from release binaries`);

        const result = await downloadGccFromUrl({
            version: this.inputs.version,
            checkLatest: this.inputs.checkLatest,
            updateEnvironment: this.inputs.updateEnvironment,
            allVersions: this.allVersions
        });
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;

        core.endGroup();
    }

    /**
     * Discovers llvm-symbolizer and exports sanitizer environment variables.
     *
     * GCC ships its own sanitizer runtime libraries, so no sanitizer runtime
     * installation is performed. The symbolizer is attempted via APT on Linux
     * when not already present, but failure is non-fatal.
     *
     * Uses version 0 for LLVM discovery because GCC's major version is
     * independent of the LLVM version — this falls through to unversioned
     * paths and PATH-based lookup.
     */
    private async installSymbolizer(): Promise<void> {
        if (!this.outputVersion || !this.inputs.updateEnvironment) {
            return;
        }

        core.startGroup('🔧 Find llvm-symbolizer');

        // GCC major version has no relationship to LLVM version, so use 0
        // to skip version-specific paths and rely on unversioned fallbacks
        this.symbolizerPath = await setup_program.findLlvmSymbolizer(0);

        if (!this.symbolizerPath && process.platform === 'linux') {
            traceCommands.log('llvm-symbolizer not found, attempting APT install (best-effort)');
            try {
                const opts = {
                    env: { DEBIAN_FRONTEND: 'noninteractive', TZ: 'Etc/UTC' },
                    ignoreReturnCode: true,
                    silent: true
                };
                const sudoPrefix = setup_program.isSudoRequired() ? 'sudo -n ' : '';
                const exitCode = await exec.exec(`${sudoPrefix}apt-get install -y llvm`, [], opts);
                if (exitCode === 0) {
                    traceCommands.log('Installed llvm');
                    this.symbolizerPath = await setup_program.findLlvmSymbolizer(0);
                }
            } catch (err) {
                traceCommands.log(`APT install attempt failed: ${(err as Error).message}`);
            }
        }

        if (this.symbolizerPath) {
            core.info(`llvm-symbolizer found at ${this.symbolizerPath}`);
            setup_program.exportSymbolizerEnvVars(this.symbolizerPath);
        } else {
            core.info('llvm-symbolizer not found; sanitizer output may lack symbolization');
        }

        core.endGroup();
    }

    /**
     * Builds final output values from the resolved compiler path and version.
     * Derives cc/cxx paths, installs g++ package if needed, and parses version components.
     *
     * @returns The complete set of action outputs
     */
    private async buildOutputs(): Promise<MainOutputs> {
        core.startGroup('📤 Set outputs');
        let cc: string | null = this.outputPath;
        let cxx: string | null = this.outputPath;
        let bindir = '';
        let dir = '';
        let releaseStr = '0.0.0';
        let versionMajor = 0;
        let versionMinor = 0;
        let versionPatch = 0;
        if (this.outputPath !== null && this.outputPath !== undefined) {
            const pathBasename = path.basename(this.outputPath);
            if (pathBasename.startsWith('gcc')) {
                cxx = path.join(path.dirname(this.outputPath), pathBasename.replace('gcc', 'g++'));
            } else if (pathBasename.startsWith('g++')) {
                cc = path.join(path.dirname(this.outputPath), pathBasename.replace('g++', 'gcc'));
            }

            if (cc && !fs.existsSync(cc)) {
                traceCommands.log(`Could not find ${cc}, using ${this.outputPath} as cc instead`);
                cc = this.outputPath;
            }

            if (cxx && !fs.existsSync(cxx)) {
                traceCommands.log(`Could not find ${cxx}, using ${this.outputPath} as cxx instead`);
                cxx = this.outputPath;
            }

            // If we still don't have a working cxx (cc1plus missing), try installing the matching g++ package
            const cxxMissing = !cxx || !fs.existsSync(cxx);
            const cxxLooksLikeGcc = cxx ? /(?:^|\/|\b)gcc(?:-\d+)?$/.test(cxx) : false;
            if (process.platform === 'linux' && (cxxMissing || cxxLooksLikeGcc)) {
                cxx = await this.tryInstallGPlusPlus(cxx);
            }

            bindir = path.dirname(this.outputPath);
            if (this.inputs.updateEnvironment) {
                core.addPath(bindir);
            }
            dir = path.dirname(bindir);

            const semverV = this.outputVersion !== null
                ? semver.parse(this.outputVersion, { loose: true })
                : semver.parse('0.0.0', { loose: true });
            if (semverV) {
                releaseStr = semverV.toString();
                versionMajor = semverV.major;
                versionMinor = semverV.minor;
                versionPatch = semverV.patch;
            }
        }
        core.endGroup();
        return {
            outputPath: this.outputPath, cc, cxx, bindir, dir,
            version: releaseStr, versionMajor, versionMinor, versionPatch
        };
    }

    /**
     * Attempts to install the matching g++ APT package when cxx is missing or
     * points to a gcc binary instead of g++.
     *
     * @param currentCxx - Current cxx path that may need replacement
     * @returns Updated cxx path, or the original if installation fails
     */
    private async tryInstallGPlusPlus(currentCxx: string | null): Promise<string | null> {
        try {
            const parsed = this.outputVersion ? semver.parse(this.outputVersion, { loose: true }) : null;
            const gccMajor = parsed?.major ?? null;
            const pkg = gccMajor ? `g++-${gccMajor}` : 'g++';
            traceCommands.log(`Attempting to install ${pkg} because g++ for ${this.outputVersion} was not found`);
            const installArgs = ['install', '-y', pkg];
            const opts = { env: { DEBIAN_FRONTEND: 'noninteractive', TZ: 'Etc/UTC' }, ignoreReturnCode: true };
            if (setup_program.isSudoRequired()) {
                await exec.exec('sudo', ['-n', 'apt-get', 'update'], opts);
                await exec.exec('sudo', ['-n', 'apt-get', ...installArgs], opts);
            } else {
                await exec.exec('apt-get', ['update'], opts);
                await exec.exec('apt-get', installArgs, opts);
            }
            const guessed = gccMajor ? `/usr/bin/g++-${gccMajor}` : await io.which('g++', false).catch(() => null);
            if (guessed && fs.existsSync(guessed)) {
                traceCommands.log(`Using ${guessed} as C++ compiler`);
                return guessed;
            }
        } catch (err) {
            traceCommands.log(`Unable to auto-install g++: ${(err as Error).message}`);
        }
        return currentCxx;
    }
}

// ─── Exported API ───────────────────────────────────────────────────

/**
 * Sets up GCC compiler on the runner with the specified version.
 *
 * This function locates or installs GCC with the requested version, searching
 * the provided paths first, then falling back to apt-get installation on Linux.
 * It can optionally update environment variables to make the compiler available.
 *
 * @param inputs - Configuration inputs for the GCC setup
 * @returns Object containing paths to gcc/g++, version info, and environment changes
 */
export async function main(inputs: Inputs): Promise<MainOutputs> {
    return new SetupGccRunner(inputs).run();
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
    title: 'Setup GCC',
    main: async (inputs: Inputs) => {
        const outputs = await main(inputs);

        // Validate that GCC was found
        if (!outputs.outputPath) {
            throw new ExpectedError(
                'Cannot setup GCC: no suitable version was found in the specified paths, system paths, or platform package manager. Check the version requirement and available versions.',
                'GCC Setup Failed'
            );
        }

        return outputs;
    },
    callerModule: module
});
