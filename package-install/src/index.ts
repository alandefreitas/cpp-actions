/**
 * Main entry point for package-install action.
 *
 * @module index
 */

import { runAction } from 'action-schema';

// Schema imports
import { type Inputs, inputsSchema, outputsSchema } from './schema';
export type { Inputs };
export { inputsSchema, outputsSchema };

// Module imports
import { aptGetMain } from './apt-install';
import { vcpkgMain, type VcpkgOutputs } from './vcpkg-install';
export type { VcpkgOutputs };

// Re-exports for external consumers
export { semverGteLoose } from './utils';

/**
 * Orchestrates package installation through apt-get and vcpkg.
 *
 * Frozen inputs are stored in the constructor. The `run()` method
 * delegates to apt-get on Linux and vcpkg on all platforms.
 */
class PackageInstallRunner {
    /** Frozen action inputs */
    private readonly inputs: Inputs;

    /**
     * Creates a new PackageInstallRunner with frozen inputs.
     *
     * Normalizes inputs: patches apt-get with vcpkg dependencies on Linux,
     * and detects force-install flags from special package list entries.
     *
     * @param inputs - Configuration inputs for package installation
     */
    constructor(inputs: Inputs) {
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

        this.inputs = effectiveInputs;
    }

    /**
     * Runs the package installation pipeline.
     *
     * @returns Vcpkg-related outputs including paths and configuration
     */
    async run(): Promise<VcpkgOutputs> {
        await this.installAptPackages();
        return await this.installVcpkgPackages();
    }

    /**
     * Installs apt-get packages on Linux when packages are specified.
     */
    private async installAptPackages(): Promise<void> {
        if (this.inputs.apt_get.length > 0 && process.platform === 'linux') {
            await aptGetMain(this.inputs);
        }
    }

    /**
     * Installs vcpkg packages when packages are specified or force-install is set.
     *
     * @returns Vcpkg-related outputs, or empty object if vcpkg is not needed
     */
    private async installVcpkgPackages(): Promise<VcpkgOutputs> {
        if (this.inputs.vcpkg.length > 0 || this.inputs.vcpkgForceInstall) {
            return await vcpkgMain(this.inputs);
        }
        return {};
    }
}

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
    return new PackageInstallRunner(inputs).run();
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
        return await main(inputs);
    },
    callerModule: module
});
