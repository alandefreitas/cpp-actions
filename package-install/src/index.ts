/**
 * Main entry point for package-install action.
 *
 * @module index
 */

import { runAction } from 'action-schema';

// Type imports and re-exports
import { type Inputs, type VcpkgOutputs } from './types';
export type { Inputs, VcpkgOutputs }

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Module imports
import { aptGetMain } from './apt-install';
import { vcpkgMain } from './vcpkg-install';

// Re-exports for external consumers
export { semverGteLoose } from './utils';

/**
 * Main entry: drive apt-get and vcpkg workflows based on provided inputs.
 *
 * Handles package installation through apt-get on Linux and vcpkg on all platforms.
 * Manages vcpkg bootstrap, triplet configuration, and package caching.
 *
 * @param inputs - Configuration inputs for package installation
 * @param _forceInstallVcpkg - Force vcpkg installation even without packages specified
 * @returns Vcpkg-related outputs including paths and configuration
 */
export async function main(inputs: Inputs, _forceInstallVcpkg?: boolean): Promise<VcpkgOutputs> {
    // ----------------------------------------------
    // apt-get
    // ----------------------------------------------
    // Check if environment is Linux
    if (inputs.apt_get.length > 0 && process.platform === 'linux') {
        await aptGetMain(inputs);
    }

    // ----------------------------------------------
    // Vcpkg
    // ----------------------------------------------
    if (inputs.vcpkg.length > 0 || inputs.vcpkgForceInstall) {
        return await vcpkgMain(inputs);
    }

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
    title: 'Package Install',
    main: async (inputs: Inputs) => {
        // Create a mutable copy
        const effectiveInputs = { ...inputs };
        effectiveInputs.apt_get = [...inputs.apt_get];
        effectiveInputs.vcpkg = [...inputs.vcpkg];

        // Patch apt-get packages for vcpkg dependencies
        if (effectiveInputs.vcpkg.length > 0 && process.platform === 'linux') {
            const vcpkgDependencies = ['git', 'curl', 'zip', 'unzip', 'tar'];
            for (const pkg of vcpkgDependencies) {
                if (!effectiveInputs.apt_get.includes(pkg)) {
                    effectiveInputs.apt_get.push(pkg);
                }
            }
        }

        // Force install vcpkg if 'vcpkg' is in apt-get list or 'true' is in vcpkg list
        if (effectiveInputs.apt_get.includes('vcpkg')) {
            effectiveInputs.vcpkgForceInstall = true;
            effectiveInputs.apt_get = effectiveInputs.apt_get.filter((item) => item !== 'vcpkg');
        } else if (effectiveInputs.vcpkg.includes('true')) {
            effectiveInputs.vcpkgForceInstall = true;
            effectiveInputs.vcpkg = effectiveInputs.vcpkg.filter((item) => item !== 'true');
        }

        const outputs = await main(effectiveInputs);
        return outputs;
    },
    callerModule: module
});
