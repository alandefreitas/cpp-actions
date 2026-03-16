/**
 * Main entry point for setup-clang action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import { ExpectedError } from 'pretty-errors';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Re-export removeClangPrefix for external use
export { removeClangPrefix } from './schema';

// Type imports and re-exports
import { type Inputs } from './schema';
export type { Inputs };

/**
 * Output values produced by Clang setup.
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
    symbolizerPath: string | null;
}

// Module imports
import { clangDownloadCandidates, installProgramFromClangUrls } from './download';
import { installCompanionPackages } from './companion-packages';

import * as setup_program from 'setup-program';

// ─── SetupClangRunner ───────────────────────────────────────────────

/**
 * Orchestrates Clang compiler setup on the runner.
 *
 * Pipeline phases:
 * 1. Discover available Clang versions
 * 2. Search user-provided paths
 * 3. Search system paths
 * 4. Search via APT package manager
 * 5. Download from release binaries
 * 6. Install companion packages (symbolizer, sanitizer runtimes)
 * 7. Build output values (cc, cxx, bindir, etc.)
 */
class SetupClangRunner {
    /** Frozen copy of action inputs */
    private readonly inputs: Inputs;

    /** All known Clang versions fetched from version data */
    private allVersions: string[] = [];

    /** Resolved path to the clang/clang++ binary, set progressively by search phases */
    private outputPath: string | null = null;

    /** Resolved version string, set progressively by search phases */
    private outputVersion: string | null = null;

    /** APT package name that was installed, if any */
    private installedAptPackage: string | null = null;

    /** Whether the final install came from a URL download */
    private willInstallFromUrl = false;

    constructor(inputs: Inputs) {
        this.inputs = { ...inputs };
    }

    /**
     * Runs the full Clang setup pipeline and returns output values.
     *
     * @returns Object containing paths to clang/clang++, version info, and environment changes
     */
    async run(): Promise<MainOutputs> {
        await this.discoverVersions();
        await this.searchUserPaths();
        await this.searchSystemPaths();
        await this.searchApt();
        await this.downloadFromUrl();
        await this.installCompanions();
        return this.buildOutputs();
    }

    /**
     * Discovers all available Clang versions and configures platform-specific
     * environment variables.
     */
    private async discoverVersions(): Promise<void> {
        core.startGroup('🔎 Find clang versions');
        if (process.platform === 'darwin') {
            process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
        }

        if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
            process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
        }
        if (process.platform !== 'linux') {
            throw new ExpectedError('This action is only supported on Linux', 'Unsupported Platform');
        }

        this.allVersions = await setup_program.findClangVersions();
        core.endGroup();
    }

    /**
     * Searches for Clang in user-provided paths.
     */
    private async searchUserPaths(): Promise<void> {
        if (this.inputs.path.length === 0) {
            return;
        }
        core.startGroup('🔍 Find clang in specified paths');
        core.info(`Searching for Clang ${this.inputs.version} in paths [${this.inputs.path.join(',')}]`);
        const result = await setup_program.findProgramInPath(this.inputs.path, this.inputs.version, this.inputs.checkLatest);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Searches for Clang in standard system paths (PATH).
     * Skipped if a binary was already found in user-provided paths.
     */
    private async searchSystemPaths(): Promise<void> {
        if (this.outputPath) {
            return;
        }
        core.startGroup('📁 Find clang in system paths');
        core.info(`Searching for Clang ${this.inputs.version} in PATH`);
        traceCommands.log(`Arguments: ${this.inputs.path}, ['clang++'], ${this.inputs.version}, ${this.inputs.checkLatest}`);
        const result = await setup_program.findProgramInSystemPaths(
            this.inputs.path,
            ['clang++'],
            this.inputs.version,
            this.inputs.checkLatest
        );
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Searches for Clang via APT package manager on Linux.
     * Adds LLVM APT repositories for matching major versions.
     * Skipped if a binary was already found or if not on Linux.
     */
    private async searchApt(): Promise<void> {
        if (this.outputVersion !== null && process.platform === 'linux') {
            traceCommands.log(
                `Skipping APT step because Clang ${this.outputVersion} was already found in ${this.outputPath}`
            );
            return;
        }
        if (process.platform !== 'linux') {
            traceCommands.log(`Skipping APT step because platform is ${process.platform}`);
            return;
        }

        core.startGroup('📦 Find clang with APT');
        core.info(`Searching for Clang ${this.inputs.version} with APT`);

        // Add repositories for major clang versions
        const allVersionMajors = this.allVersions
            .filter((v) => semver.satisfies(v, this.inputs.version))
            .map((v) => semver.parse(v)?.major)
            .filter((value): value is number => value !== undefined && value >= 10)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort((a, b) => b - a);
        traceCommands.log(`All version major candidates: [${allVersionMajors.join(', ')}]`);

        const ubuntuName = setup_program.getCurrentUbuntuName() as string | null;
        traceCommands.log(`Ubuntu version name: ${ubuntuName}`);
        traceCommands.log(`allVersionMajors.length: ${allVersionMajors.length}`);
        if (ubuntuName !== null && allVersionMajors.length !== 0) {
            core.info(
                `Adding APT repositories for Clang ${this.inputs.version} major versions [${allVersionMajors.join(', ')}]`
            );

            // Download and install repo signing key using modern signed-by approach
            // (apt-key was removed in Ubuntu 24.10+)
            await setup_program.findProgramWithApt(['gnupg'], '*', true);
            const gpgKeyUrl = 'https://apt.llvm.org/llvm-snapshot.gpg.key';
            const keyPath = await tc.downloadTool(gpgKeyUrl);
            const keyringPath = '/etc/apt/keyrings/llvm-snapshot.gpg';
            const sudo = setup_program.isSudoRequired() ? 'sudo -n' : '';
            if (sudo) {
                await setup_program.ensureSudoIsAvailable();
            }
            await exec.exec(`${sudo} mkdir -p /etc/apt/keyrings`.trim(), [], { ignoreReturnCode: true });
            await exec.exec(`${sudo} gpg --dearmor -o ${keyringPath} ${keyPath}`.trim(), [], { ignoreReturnCode: true });

            // Add APT repositories with signed-by
            for (const major of allVersionMajors) {
                const ReleaseFileURL = `https://apt.llvm.org/${ubuntuName}/dists/llvm-toolchain-${ubuntuName}-${major}/Release`;
                traceCommands.log(`Checking if ${ReleaseFileURL} exists`);
                if (!(await setup_program.urlExists(ReleaseFileURL))) {
                    traceCommands.log(
                        `Skipping repository for major version ${major} because ${ReleaseFileURL} does not exist`
                    );
                    continue;
                }
                const repoLine = `deb [signed-by=${keyringPath}] https://apt.llvm.org/${ubuntuName}/ llvm-toolchain-${ubuntuName}-${major} main`;
                const listFile = `/etc/apt/sources.list.d/llvm-${major}.list`;
                traceCommands.log(`Adding repository "${repoLine}" to ${listFile}`);
                await exec.exec(`bash -c '${sudo} tee ${listFile} <<< "${repoLine}" > /dev/null'`.trim(), [], {
                    ignoreReturnCode: true
                });
            }
            await exec.exec(`${sudo} apt-get update`.trim(), [], { ignoreReturnCode: true });
        }

        core.info(`Searching for Clang ${this.inputs.version} with APT`);
        const result = await setup_program.findProgramWithApt(['clang'], this.inputs.version, this.inputs.checkLatest);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        this.installedAptPackage = result.installedPackage ?? null;
        core.endGroup();
    }

    /**
     * Downloads Clang from release binaries as a last resort.
     * Tries multiple URL patterns and Ubuntu versions.
     * Skipped if a binary was already found.
     */
    private async downloadFromUrl(): Promise<void> {
        this.willInstallFromUrl = this.outputVersion === null;
        if (this.outputVersion !== null) {
            traceCommands.log(
                `Skipping download step because Clang ${this.outputVersion} was already found in ${this.outputPath}`
            );
            return;
        }

        core.startGroup('⬇️ Download clang');
        const { versionCandidates, ubuntuVersions } = clangDownloadCandidates(
            this.inputs.version,
            this.allVersions,
            this.inputs.checkLatest
        );
        const result = await installProgramFromClangUrls(
            ubuntuVersions,
            versionCandidates,
            this.inputs.version,
            this.inputs.checkLatest,
            this.inputs.updateEnvironment,
            this.outputVersion,
            this.outputPath
        );
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Installs companion packages for tool parity (llvm-symbolizer, sanitizer runtimes).
     * Skipped if no Clang version was found.
     *
     * @returns Path to llvm-symbolizer if found
     */
    private async installCompanions(): Promise<void> {
        if (!this.outputVersion) {
            return;
        }
        core.startGroup('🔧 Install companion packages');
        const companionResult = await installCompanionPackages(this.outputVersion, this.installedAptPackage, this.willInstallFromUrl);
        this.symbolizerPath = companionResult.symbolizerPath;
        core.endGroup();

        // Set sanitizer symbolizer environment variables if symbolizer was found
        if (this.symbolizerPath && this.inputs.updateEnvironment) {
            core.info(`Setting sanitizer symbolizer path to ${this.symbolizerPath}`);
            core.exportVariable('ASAN_SYMBOLIZER_PATH', this.symbolizerPath);
            core.exportVariable('MSAN_SYMBOLIZER_PATH', this.symbolizerPath);
            core.exportVariable('TSAN_SYMBOLIZER_PATH', this.symbolizerPath);
            core.exportVariable('UBSAN_SYMBOLIZER_PATH', this.symbolizerPath);
        }
    }

    /** Path to llvm-symbolizer, set by installCompanions phase */
    private symbolizerPath: string | null = null;

    /**
     * Builds final output values from the resolved compiler path and version.
     * Derives cc/cxx paths and parses version components.
     *
     * @returns The complete set of action outputs
     */
    private buildOutputs(): MainOutputs {
        let cc: string | null = this.outputPath;
        let cxx: string | null = this.outputPath;
        let bindir = '';
        let dir = '';
        let release = '0.0.0';
        let versionMajor = 0;
        let versionMinor = 0;
        let versionPatch = 0;

        if (this.outputPath) {
            const pathBasename = path.basename(this.outputPath);
            if (pathBasename.startsWith('clang++')) {
                cc = path.join(path.dirname(this.outputPath), pathBasename.replace('clang++', 'clang'));
            } else if (pathBasename.startsWith('clang')) {
                cxx = path.join(path.dirname(this.outputPath), pathBasename.replace('clang', 'clang++'));
            }

            if (cc && !fs.existsSync(cc)) {
                traceCommands.log(`Could not find ${cc}, using ${this.outputPath} as cc instead`);
                cc = this.outputPath;
            }

            if (cxx && !fs.existsSync(cxx)) {
                traceCommands.log(`Could not find ${cxx}, using ${this.outputPath} as cxx instead`);
                cxx = this.outputPath;
            }

            const semverV =
                this.outputVersion !== null
                    ? semver.parse(this.outputVersion, { loose: true })
                    : semver.parse('0.0.0', { loose: true });

            if (semverV) {
                release = semverV.toString();
                versionMajor = semverV.major;
                versionMinor = semverV.minor;
                versionPatch = semverV.patch;
            }

            bindir = path.dirname(this.outputPath);
            if (this.inputs.updateEnvironment) {
                core.addPath(bindir);
            }
            dir = path.dirname(bindir);

            if (this.willInstallFromUrl) {
                // If it's installed from the url, we need to add the lib dirs to LD_LIBRARY_PATH,
                // or it won't be able to find the default shared libraries
                let LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
                let LD_LIBRARY_PATHS: string[] = [];
                if (LD_LIBRARY_PATH !== null && LD_LIBRARY_PATH !== undefined) {
                    LD_LIBRARY_PATHS = LD_LIBRARY_PATH.split(':').filter((x) => x !== '');
                }
                const libDirs = [path.join(dir, 'lib')];
                for (const libDir of libDirs) {
                    if (fs.existsSync(libDir)) {
                        if (!LD_LIBRARY_PATHS.includes(libDir)) {
                            traceCommands.log(`Adding ${libDir} to LD_LIBRARY_PATH`);
                            LD_LIBRARY_PATHS.push(libDir);
                        } else {
                            traceCommands.log(`Skipping ${libDir} because it is already in LD_LIBRARY_PATH`);
                        }
                    } else {
                        traceCommands.log(`Skipping ${libDir} because it does not exist`);
                    }
                }
                LD_LIBRARY_PATH = LD_LIBRARY_PATHS.join(':');
                if (LD_LIBRARY_PATH !== process.env.LD_LIBRARY_PATH) {
                    traceCommands.log(`Setting LD_LIBRARY_PATH to ${LD_LIBRARY_PATH}`);
                    core.exportVariable('LD_LIBRARY_PATH', LD_LIBRARY_PATH);
                }
            }
        }
        return {
            outputPath: this.outputPath,
            cc,
            cxx,
            bindir,
            dir,
            version: release,
            versionMajor,
            versionMinor,
            versionPatch,
            symbolizerPath: this.symbolizerPath
        };
    }
}

// ─── Exported API ───────────────────────────────────────────────────

/**
 * Sets up Clang compiler on the runner with the specified version.
 *
 * This function locates or installs Clang with the requested version, searching
 * the provided paths first, then falling back to apt-get installation on Linux.
 * It can optionally update environment variables to make the compiler available.
 *
 * @param inputs - Configuration inputs for the Clang setup
 * @returns Object containing paths to clang/clang++, version info, and environment changes
 */
export async function main(inputs: Inputs): Promise<MainOutputs> {
    return new SetupClangRunner(inputs).run();
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
    title: 'Setup Clang',
    main: async (inputs: Inputs) => {
        const outputs = await main(inputs);

        // Validate that Clang was found
        if (!outputs.outputPath) {
            throw new ExpectedError(
                'Cannot setup Clang: no suitable version was found in the specified paths, system paths, APT, or release binaries. Check the version requirement and available versions.',
                'Clang Setup Failed'
            );
        }

        return outputs;
    },
    callerModule: module
});
