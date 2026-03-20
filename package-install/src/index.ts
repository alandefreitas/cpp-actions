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
import * as core from '@actions/core';
import { aptGetMain } from './apt-install';
import { brewMain } from './brew-install';
import { chocoMain } from './choco-install';
import { routePackages, mergePackages } from './packages-routing';
import { vcpkgMain, type VcpkgOutputs } from './vcpkg-install';
export type { VcpkgOutputs };

// Re-exports for external consumers
export { semverGteLoose } from './utils';

// Re-export program search utilities for external consumers
export { type ProgramResult, isExecutable, findProgramInPaths, findProgramInPath, findProgramInSystemPaths } from './program-search';

// Re-export Homebrew utilities for external consumers
export {
    type BrewProgramResult,
    isBrewAvailable,
    getBrewPrefix,
    findProgramWithBrew,
    installProgramWithBrew,
    parseVersionFromOutput
} from './brew-utils';

// Re-export APT utilities for external consumers
export {
    PackagePreferenceTier,
    type AptPackageMatch,
    type AptInstallOptions,
    isSudoRequired,
    getPackagePreferenceTier,
    searchAptPackages,
    installProgramWithApt,
    isAptAvailable,
    updateAptPackageLists,
    findProgramWithApt,
    ensureAddAptRepositoryIsAvailable
} from './apt-utils';

// Re-export Chocolatey utilities for external consumers
export {
    type ChocoProgramResult,
    isChocoAvailable,
    findProgramWithChoco,
    installProgramWithChoco,
    parseVersionFromOutput as parseChocoVersionFromOutput
} from './choco-utils';

/**
 * Orchestrates package installation through apt-get, brew, choco, and vcpkg.
 *
 * Frozen inputs are stored in the constructor. The `run()` method
 * delegates to the appropriate package managers based on platform and inputs.
 * Install order: apt → brew → choco → vcpkg (system packages first, then C++ libraries).
 */
class PackageInstallRunner {
    /** Frozen action inputs */
    private readonly inputs: Inputs;

    /**
     * Creates a new PackageInstallRunner with frozen inputs.
     *
     * Normalizes inputs: routes cross-platform packages to OS-native PMs,
     * resolves per-PM retry counts from shared defaults, patches apt-get with
     * vcpkg dependencies on Linux, and detects force-install flags from special
     * package list entries (with deprecation warnings).
     *
     * @param inputs - Configuration inputs for package installation
     */
    constructor(inputs: Inputs) {
        const effectiveInputs = { ...inputs };
        effectiveInputs.apt_get = [...inputs.apt_get];
        effectiveInputs.brew = [...inputs.brew];
        effectiveInputs.brewCask = [...inputs.brewCask];
        effectiveInputs.choco = [...inputs.choco];
        effectiveInputs.vcpkg = [...inputs.vcpkg];

        // Route cross-platform packages to OS-native PM and merge with PM-specific lists
        if (inputs.packages.length > 0) {
            const routed = routePackages(inputs.packages, process.platform);
            effectiveInputs.apt_get = mergePackages(effectiveInputs.apt_get, routed.apt);
            effectiveInputs.brew = mergePackages(effectiveInputs.brew, routed.brew);
            effectiveInputs.choco = mergePackages(effectiveInputs.choco, routed.choco);
        }

        // Resolve per-PM retry counts: PM-specific → shared → hardcoded default 5
        effectiveInputs.aptGetRetries = inputs.aptGetRetries || inputs.retries;
        effectiveInputs.brewRetries = inputs.brewRetries || inputs.retries;
        effectiveInputs.chocoRetries = inputs.chocoRetries || inputs.retries;

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
        // (deprecated sentinel values — emit warnings guiding users to vcpkg-force-install: true)
        if (effectiveInputs.apt_get.includes('vcpkg')) {
            core.warning(
                'Passing "vcpkg" in the apt-get package list to trigger vcpkg bootstrap is deprecated. ' +
                'Use "vcpkg-force-install: true" instead.'
            );
            effectiveInputs.vcpkgForceInstall = true;
            effectiveInputs.apt_get = effectiveInputs.apt_get.filter((item) => item !== 'vcpkg');
        } else if (effectiveInputs.vcpkg.includes('true')) {
            core.warning(
                'Passing "true" in the vcpkg package list to trigger vcpkg bootstrap is deprecated. ' +
                'Use "vcpkg-force-install: true" instead.'
            );
            effectiveInputs.vcpkgForceInstall = true;
            effectiveInputs.vcpkg = effectiveInputs.vcpkg.filter((item) => item !== 'true');
        }

        this.inputs = effectiveInputs;
    }

    /**
     * Runs the package installation pipeline.
     *
     * Install order: apt → brew → choco → vcpkg.
     *
     * @returns Vcpkg-related outputs including paths and configuration
     */
    async run(): Promise<VcpkgOutputs> {
        await this.installAptPackages();
        await this.installBrewPackages();
        await this.installChocoPackages();
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
     * Installs Homebrew packages on macOS and Linux when packages are specified.
     */
    private async installBrewPackages(): Promise<void> {
        if (this.inputs.brew.length > 0 || this.inputs.brewCask.length > 0) {
            if (process.platform !== 'win32') {
                await brewMain(this.inputs);
            }
        }
    }

    /**
     * Installs Chocolatey packages on Windows when packages are specified.
     */
    private async installChocoPackages(): Promise<void> {
        if (this.inputs.choco.length > 0) {
            if (process.platform === 'win32') {
                await chocoMain(this.inputs);
            }
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
 * Main entry: drive apt-get, brew, choco, and vcpkg workflows based on provided inputs.
 *
 * Handles package installation through apt-get on Linux, brew on macOS/Linux,
 * choco on Windows, and vcpkg on all platforms. Routes cross-platform packages
 * to OS-native PMs, resolves retry counts, and manages vcpkg bootstrap.
 *
 * @param inputs - Configuration inputs for package installation
 * @returns Vcpkg-related outputs including paths and configuration
 */
export async function main(inputs: Inputs): Promise<VcpkgOutputs> {
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
