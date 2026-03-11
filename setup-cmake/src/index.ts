/**
 * Main entry point for setup-cmake action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import * as setup_program from 'setup-program';

// Schema imports and types
import { inputsSchema, outputsSchema, type Inputs } from './schema';
export { inputsSchema, outputsSchema };
export type { Inputs };

/**
 * Output values produced by CMake setup.
 */
export interface Outputs {
    path: string;
    dir: string;
    version: string;
    versionMajor: number;
    versionMinor: number;
    versionPatch: number;
    cacheHit: boolean;
    supportsPathToBuild: boolean;
    supportsParallelBuild: boolean;
    supportsBuildMultipleTargets: boolean;
    supportsCmakeInstall: boolean;
    supportedPresetsVersion: number;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}

// Module imports
import { updateCMakeVersionFromFile } from './version-resolve';
import { generateCMakeURL } from './url-generation';
import { ensureGit } from './system-utils';

// Re-exports for external consumers
export { ensureGit } from './system-utils';

/**
 * Orchestrates CMake setup: version discovery, path/system/APT search, URL download, and output generation.
 *
 * Encapsulates waterfall state (outputPath, outputVersion) as class members so pipeline
 * phases can read/write shared state without parameter threading.
 */
class SetupCmakeRunner {
    /** Frozen copy of the action inputs */
    private readonly inputs: Inputs;

    /** Whether to wrap output in GitHub Actions log groups */
    private readonly subgroups: boolean;

    /** Scoped trace-command logger */
    private readonly fnlog: (msg: string) => void;

    /** Resolved CMake executable path (set by search/download phases) */
    private outputPath: string | null = null;

    /** Resolved CMake version string (set by search/download phases) */
    private outputVersion: string | null = null;

    /** All available CMake versions fetched from remote tags */
    private allVersions: string[] = [];

    /** Working copy of the version requirement (may be narrowed by phases) */
    private version: string;

    /**
     * Creates a new SetupCmakeRunner with frozen inputs.
     *
     * @param inputs - Configuration inputs for cmake setup
     * @param subgroups - Whether to use GitHub Actions log groups
     */
    constructor(inputs: Inputs, subgroups: boolean) {
        const effectiveInputs = { ...inputs };
        // Handle cmakePath alias for backwards compatibility
        if (effectiveInputs.cmakePath) {
            effectiveInputs.path = effectiveInputs.cmakePath;
        }
        this.inputs = effectiveInputs;
        this.subgroups = subgroups;
        this.fnlog = traceCommands.scoped('setup-cmake');
        this.version = inputs.version;
    }

    /**
     * Runs the full CMake setup pipeline.
     *
     * @returns Output information including CMake path, version, and binary directory
     * @throws Error if the specified version is invalid or CMake cannot be installed
     */
    async run(): Promise<Partial<Outputs>> {
        await ensureGit({ subgroups: this.subgroups, fnlog: this.fnlog });

        await this.discoverVersions();
        this.identifyRequirements();
        this.configureCacheDirectory();
        await this.searchUserPaths();

        if (this.outputPath === null) {
            await this.searchSystemPaths();
        }

        if (!this.outputVersion && process.platform === 'linux') {
            await this.searchApt();
        }

        if (!this.outputVersion) {
            await this.downloadFromUrl();
        }

        return this.buildOutputs();
    }

    /**
     * Fetches all known CMake version tags.
     */
    private async discoverVersions(): Promise<void> {
        if (this.subgroups) {
            core.startGroup('🌐 Find CMake versions');
        }
        this.allVersions = await setup_program.findCMakeVersions();
        this.fnlog('All CMake versions: ' + this.allVersions);
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Simplifies the version range and merges with cmake_minimum_required from file.
     */
    private identifyRequirements(): void {
        if (this.subgroups) {
            core.startGroup('📋 Identify requirements');
        }
        const simplifiedVersion = semver.simplifyRange(this.allVersions, this.version);
        this.version = simplifiedVersion && typeof simplifiedVersion === 'string' ? simplifiedVersion : simplifiedVersion ? simplifiedVersion.toString() : '*';
        if (!this.version) {
            this.version = '*';
        }
        this.version = updateCMakeVersionFromFile(this.inputs.cmakeFile, this.version, this.allVersions);
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Adjusts the hosted tool cache directory for macOS runners.
     */
    private configureCacheDirectory(): void {
        if (process.platform === 'darwin') {
            process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
        }

        if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
            process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
        }
    }

    /**
     * Searches for CMake in user-specified paths.
     */
    private async searchUserPaths(): Promise<void> {
        const execPaths = this.inputs.path.split(/[:;]/).filter((p) => p !== '');
        if (execPaths.length === 0) {
            return;
        }

        if (this.subgroups) {
            core.startGroup(`📂 Look for CMake in ${this.inputs.path}`);
        }

        core.info(`Searching for CMake ${this.version} in path${execPaths.length === 1 ? '' : 's'} [${execPaths.join(',')}]`);
        const result: ProgramResult = await setup_program.findProgramInPath(execPaths, this.version, this.inputs.checkLatest);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Found CMake ${result.outputVersion} in ${result.outputPath}`);
        }
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Searches for CMake in system paths, CMAKE_ROOT, and the tool cache.
     */
    private async searchSystemPaths(): Promise<void> {
        if (this.subgroups) {
            core.startGroup('📦 Look for system CMake');
        }
        core.info(`Searching for CMake ${this.version} in PATH`);

        const extraPaths: string[] = [];
        if (process.env['CMAKE_ROOT']?.trim()) {
            const cmakeRoot = process.env['CMAKE_ROOT'];
            if (!extraPaths.includes(cmakeRoot)) {
                extraPaths.push(cmakeRoot);
            }
            if (!extraPaths.includes(path.join(cmakeRoot, 'bin'))) {
                extraPaths.push(path.join(cmakeRoot, 'bin'));
            }
        }

        const tcPaths = tc.findAllVersions('CMake');
        for (const tcPath of tcPaths) {
            if (!extraPaths.includes(tcPath)) {
                extraPaths.push(tcPath);
            }
        }

        const result: ProgramResult = await setup_program.findProgramInSystemPaths(extraPaths, ['cmake'], this.version, this.inputs.checkLatest);
        if (result.outputPath && result.outputVersion) {
            core.info(`✅ Found CMake ${result.outputVersion} in ${result.outputPath}`);
        }
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Searches for CMake via APT package manager (Linux only).
     */
    private async searchApt(): Promise<void> {
        if (this.subgroups) {
            core.startGroup('📦 Look for CMake in APT');
        }
        core.info(`Searching for CMake ${this.version} in APT repositories`);
        const result: ProgramResult = await setup_program.findProgramWithApt(['cmake'], this.version, this.inputs.checkLatest);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Found CMake ${result.outputVersion} via APT at ${result.outputPath}`);
        }
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Downloads and installs CMake from the official URL.
     *
     * @throws Error if the resolved version is invalid
     */
    private async downloadFromUrl(): Promise<void> {
        if (this.subgroups) {
            core.startGroup('⬇️ Download CMake');
        }
        this.version = this.inputs.checkLatest ?
            semver.maxSatisfying(this.allVersions, this.version) || this.version :
            semver.minSatisfying(this.allVersions, this.version) || this.version;
        const coercedVersion = semver.coerce(this.version);
        if (!coercedVersion) {
            throw new Error(`Invalid version: ${this.version}`);
        }
        this.version = coercedVersion.toString();

        core.info(`Downloading CMake ${this.version}`);
        const cmakeUrl = generateCMakeURL(this.version, this.inputs.architecture, this.fnlog);
        const result: ProgramResult = await setup_program.installProgramFromUrl(['cmake'], this.version, this.inputs.checkLatest, cmakeUrl, this.inputs.updateEnvironment, null);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Installed CMake ${result.outputVersion} to ${result.outputPath}`);
        }
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        if (this.subgroups) {
            core.endGroup();
        }
    }

    /**
     * Validates results and constructs the output object with version capabilities.
     *
     * @returns Partial outputs with CMake path, version, and capability flags
     * @throws Error if no valid version was found
     */
    private buildOutputs(): Partial<Outputs> {
        if (this.subgroups) {
            core.startGroup('📤 Return outputs');
        }
        if (!this.outputPath) {
            core.error(`❌ Could not find or install CMake ${this.version}`);
            this.fnlog(`outputVersion: ${this.outputVersion}`);
            this.fnlog(`outputPath: ${this.outputPath}`);
            return {};
        }

        if (!this.outputVersion) {
            throw new Error('No version found');
        }
        const versionSV = semver.coerce(this.outputVersion);
        if (!versionSV) {
            throw new Error(`Invalid version: ${this.outputVersion}`);
        }
        this.fnlog(`Found CMake ${this.outputVersion} in ${this.outputPath}`);
        if (this.subgroups) {
            core.endGroup();
        }

        const maxSupportedPresetsVersion =
            semver.gte(versionSV, '3.25.3') ? 6 :
                semver.gte(versionSV, '3.24.4') ? 5 :
                    semver.gte(versionSV, '3.23.5') ? 4 :
                        semver.gte(versionSV, '3.21.7') ? 3 :
                            semver.gte(versionSV, '3.20.6') ? 2 :
                                semver.gte(versionSV, '3.19.8') ? 1 : 0;

        return {
            path: this.outputPath,
            dir: path.dirname(this.outputPath),
            version: versionSV.toString(),
            versionMajor: versionSV.major,
            versionMinor: versionSV.minor,
            versionPatch: versionSV.patch,
            cacheHit: false,
            supportsPathToBuild: semver.gte(versionSV, '3.13.0'),
            supportsParallelBuild: semver.gte(versionSV, '3.12.0'),
            supportsBuildMultipleTargets: semver.gte(versionSV, '3.15.0'),
            supportsCmakeInstall: semver.gte(versionSV, '3.15.0'),
            supportedPresetsVersion: maxSupportedPresetsVersion
        };
    }
}

/**
 * Sets up CMake on the runner with the specified version and configuration.
 *
 * Searches for existing CMake installations, downloads if necessary, and
 * configures environment variables for subsequent workflow steps.
 *
 * @param inputs - Configuration inputs including version, architecture, and paths
 * @param subgroups - Whether to use GitHub Actions log groups for output organization
 * @returns Output information including CMake path, version, and binary directory
 * @throws Error if the specified version is invalid or CMake cannot be installed
 */
export async function main(inputs: Inputs, subgroups = true): Promise<Partial<Outputs>> {
    return new SetupCmakeRunner(inputs, subgroups).run();
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
    title: 'Setup CMake',
    main: async (inputs: Inputs) => {
        const outputs = await main(inputs);

        if (!outputs.path) {
            core.setFailed('Cannot setup CMake');
        }

        return outputs;
    },
    callerModule: module
});
