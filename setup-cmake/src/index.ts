/**
 * Main entry point for setup-cmake action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

// Type imports and re-exports
import { Inputs, Outputs, ProgramResult } from './types';
export type { Inputs, Outputs, ProgramResult }

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
    function fnlog(msg: string): void {
        trace_commands.log('setup-cmake: ' + msg);
    }

    let {
        version,
        architecture,
        cmake_file,
        path: inputPath,
        check_latest,
        update_environment
    } = inputs;

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
    version = updateCMakeVersionFromFile(cmake_file, version, allVersions);
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

    let output_path: string | null = null;
    let output_version: string | null = null;

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
        const __ret: ProgramResult = await setup_program.find_program_in_path(execPaths, version, check_latest);
        if (__ret.output_version && __ret.output_path) {
            core.info(`✅ Found CMake ${__ret.output_version} in ${__ret.output_path}`);
        }
        output_version = __ret.output_version;
        output_path = __ret.output_path;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Look for system CMake
    // ----------------------------------------------
    if (output_path === null) {
        if (subgroups) {
            core.startGroup('📦 Look for system CMake');
        }
        core.info(`Searching for CMake ${version} in PATH`);

        // Check environment variable $CMAKE_ROOT and include both $CMAKE_ROOT
        // and $CMAKE_ROOT/bin in paths. This action will also define CMAKE_ROOT
        // if CMAKE_ROOT ends up being downloaded from a URL in a previous step.
        const extraPaths: string[] = [];
        if (process.env['CMAKE_ROOT']?.trim()) {
            const cmake_root = process.env['CMAKE_ROOT'];
            if (!extraPaths.includes(cmake_root)) {
                extraPaths.push(cmake_root);
            }
            if (!extraPaths.includes(path.join(cmake_root, 'bin'))) {
                extraPaths.push(path.join(cmake_root, 'bin'));
            }
        }

        // Include all versions potentially cached with tc
        const tc_paths = tc.findAllVersions('CMake');
        for (const tc_path of tc_paths) {
            if (!extraPaths.includes(tc_path)) {
                extraPaths.push(tc_path);
            }
        }

        const __ret: ProgramResult = await setup_program.find_program_in_system_paths(extraPaths, ['cmake'], version, check_latest);
        if (__ret.output_path && __ret.output_version) {
            core.info(`✅ Found CMake ${__ret.output_version} in ${__ret.output_path}`);
        }
        output_version = __ret.output_version;
        output_path = __ret.output_path;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Look for CMake in APT (Linux only)
    // ----------------------------------------------
    if (!output_version && process.platform === 'linux') {
        if (subgroups) {
            core.startGroup('📦 Look for CMake in APT');
        }
        core.info(`Searching for CMake ${version} in APT repositories`);
        const __ret: ProgramResult = await setup_program.find_program_with_apt(['cmake'], version, check_latest);
        if (__ret.output_version && __ret.output_path) {
            core.info(`✅ Found CMake ${__ret.output_version} via APT at ${__ret.output_path}`);
        }
        output_version = __ret.output_version;
        output_path = __ret.output_path;
        if (subgroups) {
            core.endGroup();
        }
    }

    // ----------------------------------------------
    // Download CMake
    // ----------------------------------------------
    if (!output_version) {
        if (subgroups) {
            core.startGroup('⬇️ Download CMake');
        }
        version = inputs.check_latest ?
            semver.maxSatisfying(allVersions, version) || version :
            semver.minSatisfying(allVersions, version) || version;
        const coercedVersion = semver.coerce(version);
        if (!coercedVersion) {
            throw new Error(`Invalid version: ${version}`);
        }
        version = coercedVersion.toString();

        core.info(`Downloading CMake ${version}`);
        const cmake_url = generateCMakeURL(version, architecture, fnlog);
        const __ret: ProgramResult = await setup_program.install_program_from_url(['cmake'], version, check_latest, cmake_url, update_environment);
        if (__ret.output_version && __ret.output_path) {
            core.info(`✅ Installed CMake ${__ret.output_version} to ${__ret.output_path}`);
        }
        output_version = __ret.output_version;
        output_path = __ret.output_path;
        if (subgroups) {
            core.endGroup();
        }
    }

    if (subgroups) {
        core.startGroup('📤 Return outputs');
    }
    if (!output_path) {
        core.error(`❌ Could not find or install CMake ${version}`);
        fnlog(`output_version: ${output_version}`);
        fnlog(`output_path: ${output_path}`);
        return {};
    }

    inputPath = output_path;
    if (!output_version) {
        throw new Error('No version found');
    }
    version = output_version;
    const versionSV = semver.coerce(version);
    if (!versionSV) {
        throw new Error(`Invalid version: ${version}`);
    }
    fnlog(`Found CMake ${version} in ${inputPath}`);
    if (subgroups) {
        core.endGroup();
    }

    const max_supported_presets_version =
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
        version_major: versionSV.major,
        version_minor: versionSV.minor,
        version_patch: versionSV.patch,
        // Cache is always disabled because it's not needed
        cache_hit: false,
        supports_path_to_build: semver.gte(versionSV, '3.13.0'),
        supports_parallel_build: semver.gte(versionSV, '3.12.0'),
        supports_build_multiple_targets: semver.gte(versionSV, '3.15.0'),
        supports_cmake_install: semver.gte(versionSV, '3.15.0'),
        supported_presets_version: max_supported_presets_version
    };
}

/**
 * Main entry point for the setup-cmake GitHub Action.
 *
 * Parses inputs and sets up CMake on the runner.
 */
async function run(): Promise<void> {
    const inputs: Inputs = {
        version: gh_inputs.getInput('version', { defaultValue: '*' }),
        architecture: gh_inputs.getInput('architecture'),
        cmake_file: gh_inputs.getInput('cmake-file'),
        path: gh_inputs.getInput('path'),
        cmake_path: gh_inputs.getInput('cmake-path'),
        cache: gh_inputs.getBoolean('cache'),
        check_latest: gh_inputs.getBoolean('check-latest'),
        update_environment: gh_inputs.getBoolean('update-environment'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    if (inputs.cmake_path) {
        inputs.path = inputs.cmake_path;
    }

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs);
    // Parse Final program / Setup version / Outputs
    if (outputs['path']) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot setup CMake');
    }
}

if (require.main === module) {
    (async (): Promise<void> => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: 'Setup CMake failed'
            });
        }
    })();
}
