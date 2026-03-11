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

// Type imports and re-exports
import { type Inputs, type Outputs, type ProgramResult } from './types';
export type { Inputs, Outputs, ProgramResult }

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Module imports
import { updateCMakeVersionFromFile } from './version-resolve';
import { generateCMakeURL } from './url-generation';
import { ensureGit } from './system-utils';

// Re-exports for external consumers
export { ensureGit } from './system-utils';

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
    const fnlog = traceCommands.scoped('setup-cmake');

    let { version, path: inputPath } = inputs;
    const { architecture, cmakeFile, checkLatest, updateEnvironment } = inputs;

    await ensureGit({ subgroups, fnlog });

    // ----------------------------------------------
    // Look for CMake versions
    // ----------------------------------------------
    if (subgroups) {
        core.startGroup('🌐 Find CMake versions');
    }
    const allVersions: string[] = await setup_program.findCMakeVersions();
    fnlog('All CMake versions: ' + allVersions);
    if (subgroups) {
        core.endGroup();
    }

    // ----------------------------------------------
    // Identify requirements
    // ----------------------------------------------
    if (subgroups) {
        core.startGroup('📋 Identify requirements');
    }
    const simplifiedVersion = semver.simplifyRange(allVersions, version);
    version = simplifiedVersion && typeof simplifiedVersion === 'string' ? simplifiedVersion : simplifiedVersion ? simplifiedVersion.toString() : '*';
    if (!version) {
        version = '*';
    }
    version = updateCMakeVersionFromFile(cmakeFile, version, allVersions);
    if (subgroups) {
        core.endGroup();
    }

    // ----------------------------------------------
    // Adjust hostedtoolcache directory
    // ----------------------------------------------
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }

    let outputPath: string | null = null;
    let outputVersion: string | null = null;

    // ----------------------------------------------
    // Look for path CMake
    // ----------------------------------------------
    const execPaths = inputPath.split(/[:;]/).filter((inputPath) => inputPath !== '');
    if (execPaths.length !== 0) {
        if (subgroups) {
            core.startGroup(`📂 Look for CMake in ${inputPath}`);
        }

        // Setup from provided path
        core.info(`Searching for CMake ${version} in path${execPaths.length === 1 ? '' : 's'} [${execPaths.join(',')}]`);
        const result: ProgramResult = await setup_program.findProgramInPath(execPaths, version, checkLatest);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Found CMake ${result.outputVersion} in ${result.outputPath}`);
        }
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Look for system CMake
    // ----------------------------------------------
    if (outputPath === null) {
        if (subgroups) {
            core.startGroup('📦 Look for system CMake');
        }
        core.info(`Searching for CMake ${version} in PATH`);

        // Check environment variable $CMAKE_ROOT and include both $CMAKE_ROOT
        // and $CMAKE_ROOT/bin in paths. This action will also define CMAKE_ROOT
        // if CMAKE_ROOT ends up being downloaded from a URL in a previous step.
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

        // Include all versions potentially cached with tc
        const tcPaths = tc.findAllVersions('CMake');
        for (const tcPath of tcPaths) {
            if (!extraPaths.includes(tcPath)) {
                extraPaths.push(tcPath);
            }
        }

        const result: ProgramResult = await setup_program.findProgramInSystemPaths(extraPaths, ['cmake'], version, checkLatest);
        if (result.outputPath && result.outputVersion) {
            core.info(`✅ Found CMake ${result.outputVersion} in ${result.outputPath}`);
        }
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Look for CMake in APT (Linux only)
    // ----------------------------------------------
    if (!outputVersion && process.platform === 'linux') {
        if (subgroups) {
            core.startGroup('📦 Look for CMake in APT');
        }
        core.info(`Searching for CMake ${version} in APT repositories`);
        const result: ProgramResult = await setup_program.findProgramWithApt(['cmake'], version, checkLatest);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Found CMake ${result.outputVersion} via APT at ${result.outputPath}`);
        }
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Download CMake
    // ----------------------------------------------
    if (!outputVersion) {
        if (subgroups) {
            core.startGroup('⬇️ Download CMake');
        }
        version = inputs.checkLatest ?
            semver.maxSatisfying(allVersions, version) || version :
            semver.minSatisfying(allVersions, version) || version;
        const coercedVersion = semver.coerce(version);
        if (!coercedVersion) {
            throw new Error(`Invalid version: ${version}`);
        }
        version = coercedVersion.toString();

        core.info(`Downloading CMake ${version}`);
        const cmakeUrl = generateCMakeURL(version, architecture, fnlog);
        const result: ProgramResult = await setup_program.installProgramFromUrl(['cmake'], version, checkLatest, cmakeUrl, updateEnvironment, null);
        if (result.outputVersion && result.outputPath) {
            core.info(`✅ Installed CMake ${result.outputVersion} to ${result.outputPath}`);
        }
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        if (subgroups) {
            core.endGroup();
        }
    }

    if (subgroups) {
        core.startGroup('📤 Return outputs');
    }
    if (!outputPath) {
        core.error(`❌ Could not find or install CMake ${version}`);
        fnlog(`outputVersion: ${outputVersion}`);
        fnlog(`outputPath: ${outputPath}`);
        return {};
    }

    inputPath = outputPath;
    if (!outputVersion) {
        throw new Error('No version found');
    }
    version = outputVersion;
    const versionSV = semver.coerce(version);
    if (!versionSV) {
        throw new Error(`Invalid version: ${version}`);
    }
    fnlog(`Found CMake ${version} in ${inputPath}`);
    if (subgroups) {
        core.endGroup();
    }

    const maxSupportedPresetsVersion =
        semver.gte(versionSV, '3.25.3') ? 6 :
            semver.gte(versionSV, '3.24.4') ? 5 :
                semver.gte(versionSV, '3.23.5') ? 4 :
                    semver.gte(versionSV, '3.21.7') ? 3 :
                        semver.gte(versionSV, '3.20.6') ? 2 :
                            semver.gte(versionSV, '3.19.8') ? 1 : 0;

    // Create outputs
    return {
        path: inputPath,
        dir: path.dirname(inputPath),
        version: versionSV.toString(),
        versionMajor: versionSV.major,
        versionMinor: versionSV.minor,
        versionPatch: versionSV.patch,
        // Cache is always disabled because it's not needed
        cacheHit: false,
        supportsPathToBuild: semver.gte(versionSV, '3.13.0'),
        supportsParallelBuild: semver.gte(versionSV, '3.12.0'),
        supportsBuildMultipleTargets: semver.gte(versionSV, '3.15.0'),
        supportsCmakeInstall: semver.gte(versionSV, '3.15.0'),
        supportedPresetsVersion: maxSupportedPresetsVersion
    };
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
        // Handle cmakePath alias for backwards compatibility
        const effectiveInputs = { ...inputs };
        if (effectiveInputs.cmakePath) {
            effectiveInputs.path = effectiveInputs.cmakePath;
        }

        const outputs = await main(effectiveInputs);

        if (!outputs.path) {
            core.setFailed('Cannot setup CMake');
        }

        return outputs;
    },
    callerModule: module
});
