/**
 * Main entry point for package-install action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

// Type imports and re-exports
import { Inputs, VcpkgOutputs } from './types';
export type { Inputs, VcpkgOutputs }

// Module imports
import { apt_get_main } from './apt-install';
import { vcpkg_main } from './vcpkg-install';

// Re-exports for external consumers
export { semverGteLoose } from './utils';

/**
 * Main entry: drive apt-get and vcpkg workflows based on provided inputs.
 *
 * Handles package installation through apt-get on Linux and vcpkg on all platforms.
 * Manages vcpkg bootstrap, triplet configuration, and package caching.
 *
 * @param inputs - Configuration inputs for package installation
 * @param _force_install_vcpkg - Force vcpkg installation even without packages specified
 * @returns Vcpkg-related outputs including paths and configuration
 */
export async function main(inputs: Inputs, _force_install_vcpkg?: boolean): Promise<VcpkgOutputs> {
    // ----------------------------------------------
    // apt-get
    // ----------------------------------------------
    // Check if environment is Linux
    if (inputs.apt_get.length > 0 && process.platform === 'linux') {
        await apt_get_main(inputs);
    }

    // ----------------------------------------------
    // Vcpkg
    // ----------------------------------------------
    if (inputs.vcpkg.length > 0 || inputs.vcpkg_force_install) {
        return await vcpkg_main(inputs);
    }

    return {};
}

/**
 * Main entry point for the package-install GitHub Action.
 *
 * Parses inputs and orchestrates apt-get and vcpkg package installation.
 */
async function run(): Promise<void> {
    let inputs: Inputs = {
        // packages
        vcpkg: gh_inputs.getArray('vcpkg'),
        apt_get: gh_inputs.getArray('apt-get'),
        // vcpkg options
        cxx: gh_inputs.getNormalizedPath('cxx', {fallbackEnv: 'CXX'}),
        cxxflags: gh_inputs.getInput('cxxflags', {fallbackEnv: 'CXXFLAGS'}),
        cc: gh_inputs.getNormalizedPath('cc', {fallbackEnv: 'CC'}),
        ccflags: gh_inputs.getInput('ccflags', {fallbackEnv: 'CFLAGS'}),
        vcpkg_triplet: gh_inputs.getInput('vcpkg-triplet'),
        vcpkg_dir: gh_inputs.getNormalizedPath('vcpkg-dir'),
        vcpkg_branch: gh_inputs.getInput('vcpkg-branch'),
        vcpkg_cache: gh_inputs.getBoolean('vcpkg-cache', {defaultValue: true}),
        vcpkg_force_install: gh_inputs.getBoolean('vcpkg-force-install', {defaultValue: false}),
        // apt-get options
        apt_get_retries: (gh_inputs.getInt('apt-get-retries', {fallbackEnv: 'APT_GET_RETRIES', defaultValue: '3'}) ?? 3),
        apt_get_sources: gh_inputs.getArray('apt-get-sources'),
        apt_get_source_keys: gh_inputs.getArray('apt-get-source-keys'),
        apt_get_ignore_missing: gh_inputs.getBoolean('apt-get-ignore-missing', {defaultValue: false}),
        apt_get_add_architecture: gh_inputs.getArray('apt-get-add-architecture'),
        apt_get_bulk_install: gh_inputs.getBoolean('apt-get-bulk-install', {defaultValue: false}),
        // Annotations and tracing
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    // Resolve paths
    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    // ----------------------------------------------
    // patch apt-get packages for vcpkg
    // ----------------------------------------------
    if (inputs.vcpkg.length > 0 && process.platform === 'linux') {
        let vcpkgDependencies = ['git', 'curl', 'zip', 'unzip', 'tar'];
        for (const pkg of vcpkgDependencies) {
            if (!inputs.apt_get.includes(pkg)) {
                inputs.apt_get.push(pkg);
            }
        }
    }

    // ----------------------------------------------
    // Force install vcpkg anyway
    // ----------------------------------------------
    if (inputs.apt_get.includes('vcpkg')) {
        inputs.vcpkg_force_install = true;
        inputs.apt_get = inputs.apt_get.filter((item) => item !== 'vcpkg');
    } else if (inputs.vcpkg.includes('true')) {
        inputs.vcpkg_force_install = true;
        inputs.vcpkg = inputs.vcpkg.filter((item) => item !== 'true');
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs);
    core.startGroup('📤 Action Outputs');
    gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
    core.endGroup();
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: 'Package install failed'
            });
        }
    })();
}
