import * as core from '@actions/core';
import * as semver from 'semver';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';
import { ExpectedError } from 'pretty-errors';

import { type SetupProgramInputs } from './types';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

import {
    findProgramInPath,
    findProgramInSystemPaths
} from './program-search';

import {
    findProgramWithApt
} from './apt-utils';

import { installProgramFromUrl } from './url-install';

// Re-export utilities for consumers
export { normalizeArchitectureInput } from './utils';

// Re-export types for external consumers
export { PackagePreferenceTier, type AptPackageMatch, type AptInstallOptions } from './apt-utils';
export { type FetchGitTagsOptions, type CloneGitRepoOptions } from './git-utils';

// Re-export version cache functions for external consumers
export { setVersionsCacheDir, resolveVersionsCachePath, readVersionsFromFile, saveVersionsToFile } from './version-cache';

// Re-export download utilities for external consumers
export { downloadAndExtract, stripSingleDirectoryFromPath } from './download-utils';

// Re-export program search functions for external consumers
export { findProgramInPath, findProgramInSystemPaths } from './program-search';

// Re-export system utilities for external consumers
export {
    isSudoRequired,
    execWithSudo,
    getExecOutputWithSudo,
    urlExists,
    ensureSudoIsAvailable,
    moveWithPermissions
} from './system-utils';

// Re-export APT utilities for external consumers
export {
    getPackagePreferenceTier,
    searchAptPackages,
    installProgramWithApt,
    isAptAvailable,
    updateAptPackageLists,
    findProgramWithApt,
    ensureAddAptRepositoryIsAvailable
} from './apt-utils';

// Re-export Git utilities for external consumers
export {
    findGit,
    fetchGitTags,
    findVersionsFromTags,
    findGCCVersions,
    findClangVersions,
    findCMakeVersions,
    cloneGitRepo
} from './git-utils';

// Re-export Ubuntu utilities for external consumers
export {
    getCurrentUbuntuVersion,
    getCurrentUbuntuName
} from './ubuntu-utils';

// Re-export URL installation for external consumers
export { installProgramFromUrl } from './url-install';

/**
 * Orchestrates the setup-program pipeline: search user paths, system paths,
 * APT repositories, and URL download — in priority order.
 *
 * This class is private; consumers call the exported {@link main} function.
 */
class SetupProgramRunner {
    /** Frozen copy of the action inputs — never mutated after construction */
    private readonly inputs: SetupProgramInputs;

    /** Resolved executable path, set progressively by pipeline phases */
    private outputPath: string | null = null;

    /** Resolved program version, set progressively by pipeline phases */
    private outputVersion: string | null = null;

    /** Scoped logger for trace output */
    private readonly fnlog: (msg: string) => void;

    constructor(inputs: SetupProgramInputs) {
        this.inputs = { ...inputs };
        this.fnlog = traceCommands.scoped('setup-program');
    }

    /**
     * Runs the full setup pipeline and returns action outputs.
     *
     * @returns Object containing path, version, and found status
     */
    async run(): Promise<Record<string, unknown>> {
        this.configureCacheDirectory();
        await this.searchUserPaths();
        await this.searchSystemPaths();
        await this.searchApt();
        await this.downloadFromUrl();
        return this.buildOutputs();
    }

    /**
     * Sets up tool-cache directory environment variables for macOS runners.
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
     * Searches for the program in user-provided paths.
     */
    private async searchUserPaths(): Promise<void> {
        if (!this.inputs.path || this.inputs.path.length === 0) {
            return;
        }
        core.startGroup('🔍 Searching in user provided paths');
        core.info(`Searching for ${this.inputs.name} ${this.inputs.version} in paths [${this.inputs.path.join(',')}]`);
        const result = await findProgramInPath(this.inputs.path, this.inputs.version, this.inputs.checkLatest);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Searches for the program in system PATH directories.
     */
    private async searchSystemPaths(): Promise<void> {
        if (this.outputPath !== null) {
            return;
        }
        core.startGroup('🔍 Searching in system paths');
        core.info(`Searching for ${this.inputs.name} ${this.inputs.version} in PATH`);
        const result = await findProgramInSystemPaths(this.inputs.path, this.inputs.name, this.inputs.version, this.inputs.checkLatest);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Searches for and installs the program using APT on Linux.
     */
    private async searchApt(): Promise<void> {
        if (this.outputVersion !== null) {
            this.fnlog(`Skipping APT step because ${this.inputs.name} ${this.outputVersion} was already found in ${this.outputPath}`);
            return;
        }
        if (process.platform !== 'linux') {
            this.fnlog(`Skipping APT step because platform is ${process.platform}`);
            return;
        }
        core.startGroup('📦 Searching with APT');
        core.info(`Searching for ${this.inputs.name} ${this.inputs.version} with APT`);
        const result = await findProgramWithApt(this.inputs.name, this.inputs.version, this.inputs.checkLatest);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Downloads and installs the program from a URL template.
     */
    private async downloadFromUrl(): Promise<void> {
        const url = this.inputs.url || null;
        const installPrefix = this.inputs.installPrefix || null;
        if (this.outputVersion !== null) {
            this.fnlog(`Skipping download step because ${this.inputs.name} ${this.outputVersion} was already found in ${this.outputPath}`);
            return;
        }
        if (url === null) {
            this.fnlog(`Skipping download step because no URL was provided. URL: ${url}`);
            return;
        }
        core.startGroup('🚚 Downloading and Installing');
        core.info(`Fetching ${this.inputs.name} ${this.inputs.version} from URL`);
        const result = await installProgramFromUrl(
            this.inputs.name,
            this.inputs.version,
            this.inputs.checkLatest,
            url,
            this.inputs.updateEnvironment,
            installPrefix);
        this.outputVersion = result.outputVersion;
        this.outputPath = result.outputPath;
        core.endGroup();
    }

    /**
     * Builds the final action output object from accumulated state.
     *
     * @returns Object containing path, version, and found status
     */
    private buildOutputs(): Record<string, unknown> {
        if (this.outputPath) {
            const semverVersion = this.outputVersion !== null ?
                semver.coerce(this.outputVersion, { loose: true }) :
                semver.coerce('0.0.0', { loose: true });
            if (semverVersion) {
                return {
                    path: this.outputPath,
                    dir: path.dirname(this.outputPath),
                    version: semverVersion.toString(),
                    versionMajor: semverVersion.major,
                    versionMinor: semverVersion.minor,
                    versionPatch: semverVersion.patch,
                    found: true
                };
            }
        }

        core.setOutput('found', false);
        if (this.inputs.failOnError) {
            throw new ExpectedError('Cannot find program. Ensure the program is installed and available in PATH.', 'Program Not Found');
        } else {
            core.info('Cannot find program');
        }
        return { found: false };
    }
}

/**
 * Main function that searches for and optionally installs a program.
 *
 * @param inputs - Configuration inputs for the action
 * @returns Object containing path, version, and found status
 */
async function main(inputs: SetupProgramInputs): Promise<Record<string, unknown>> {
    return new SetupProgramRunner(inputs).run();
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
    title: 'Setup Program',
    main: async (inputs: SetupProgramInputs) => {
        return await main(inputs);
    },
    callerModule: module
});
