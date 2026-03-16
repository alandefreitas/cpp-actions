/**
 * APT package management utilities for setup-program action.
 *
 * Provides functions for searching, installing, and managing packages
 * via APT on Linux systems.
 *
 * @module apt-utils
 */

import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';
import { ExpectedError } from 'pretty-errors';

import { type ProgramResult, type ExecOutput } from './types';

import {
    escapeRegExp,
    removeSemverLeadingZeros
} from './utils';

import {
    findProgramInSystemPaths
} from './program-search';

import {
    execWithSudo,
    isSudoRequired,
    ensureSudoIsAvailable
} from './system-utils';

/**
 * Package preference tier for APT package selection.
 *
 * Lower tier number means higher preference:
 * - Tier 1: Unversioned packages (e.g., "clang", "gcc") - best system integration
 * - Tier 2: Raw versioned packages (e.g., "clang-14", "gcc-12") - what users expect
 * - Tier 3: Other versioned packages (e.g., "clang-14-tools") - fallback only
 */
export enum PackagePreferenceTier {
    UNVERSIONED = 1,
    RAW_VERSIONED = 2,
    OTHER_VERSIONED = 3
}

/**
 * Result of searching APT repositories for a package.
 */
export interface AptPackageMatch {
    /** The best matching package name (e.g., "clang-14") */
    packageName: string;
    /** The specific APT version string for installation (e.g., "1:14.0.0-1ubuntu1") */
    packageVersion: string | null;
    /** The parsed semver version (e.g., "14.0.0") */
    semverVersion: string;
    /** The preference tier of this package */
    tier: PackagePreferenceTier;
    /** Alternative packages that also satisfy requirements, in "package=version" format */
    alternatives: string[];
}

/**
 * Options for APT package installation.
 */
export interface AptInstallOptions {
    /** Try aptitude as fallback if apt-get fails */
    tryAptitude?: boolean;
    /** Try alternative packages if primary install fails */
    tryAlternatives?: boolean;
}

/**
 * Determines the preference tier for an APT package based on its name.
 *
 * Packages are categorized into tiers to prefer system-integrated packages
 * over standalone versioned packages when both satisfy version requirements.
 *
 * @param packageName - The APT package name (e.g., "clang", "clang-14", "clang-14-tools")
 * @param baseNames - The base program names being searched for (e.g., ["clang", "clang++"])
 * @returns The preference tier for the package
 */
export function getPackagePreferenceTier(packageName: string, baseNames: string[]): PackagePreferenceTier {
    // Check if package name exactly matches any base name (unversioned)
    for (const baseName of baseNames) {
        if (packageName === baseName) {
            return PackagePreferenceTier.UNVERSIONED;
        }
    }

    // Check if package name is base name followed by version only (raw versioned)
    // e.g., "clang-14", "gcc-12", "cmake-3.24"
    for (const baseName of baseNames) {
        const rawVersionedRegex = new RegExp(`^${escapeRegExp(baseName)}-[0-9.]+$`);
        if (rawVersionedRegex.test(packageName)) {
            return PackagePreferenceTier.RAW_VERSIONED;
        }
    }

    // Everything else is other versioned (e.g., "clang-14-tools", "clang-format-14")
    return PackagePreferenceTier.OTHER_VERSIONED;
}

/**
 * Searches APT repositories for packages matching the specified names and version.
 *
 * Queries apt-cache to find available packages and their versions, then filters
 * and ranks results based on version requirements and package naming preferences.
 *
 * @param names - Array of package/executable names to search for (e.g., ["clang", "clang++"])
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns The best matching package info, or null if no match found
 * @throws ExpectedError if apt-cache search or showpkg commands fail
 */
export async function searchAptPackages(
    names: string[],
    version: string,
    checkLatest: boolean
): Promise<AptPackageMatch | null> {
    const fnlog = traceCommands.scoped('searchAptPackages');

    // Search for matching package names
    const packageNames: string[] = [];
    for (const name of names) {
        const searchExpression = `${escapeRegExp(name)}(-[0-9\\.]+)?`;
        fnlog(`Searching for packages matching ${searchExpression}`);
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['search', `^${searchExpression}$`]);
        if (output.exitCode !== 0) {
            throw new ExpectedError(`Failed to run apt-cache search (exit code ${output.exitCode}). Check that APT package lists are up to date.`, 'APT Search Failed');
        }
        fnlog(`apt-cache search. Exit code ${output.exitCode}`);
        const aptOutput = output.stdout.trim();
        const aptLines = aptOutput.split('\n');
        for (const aptLine of aptLines) {
            const aptLineRegex = new RegExp(`^(${searchExpression}) `);
            const aptLineMatches = aptLine.match(aptLineRegex);
            if (aptLineMatches !== null) {
                packageNames.push(aptLineMatches[1]);
            }
        }
    }
    fnlog(`Found packages [${packageNames.join(', ')}]`);

    // Find the best matching package and version
    fnlog(`Listing all versions of packages [${packageNames.join(', ')}]`);
    let bestMatch: AptPackageMatch | null = null;
    const installMatches: string[] = [];

    for (const packageName of packageNames) {
        const output: ExecOutput = await exec.getExecOutput('apt-cache', ['showpkg', packageName], { silent: true });
        if (output.exitCode !== 0) {
            throw new ExpectedError(`Failed to run "apt-cache showpkg '${packageName}'" (exit code ${output.exitCode}). Check that APT package lists are up to date.`, 'APT Package Query Failed');
        }
        if (output.stdout.trim() === '') {
            fnlog('No output from apt-cache showpkg ' + packageName);
            continue;
        }

        const showpkgLines = output.stdout.trim().split('\n');
        const dependenciesIndex = showpkgLines.findIndex((line) => line.startsWith('Dependencies:'));
        if (dependenciesIndex === -1) {
            continue;
        }
        let providesIndex = showpkgLines.findIndex((line) => line.startsWith('Provides:'));
        if (providesIndex === -1) {
            providesIndex = showpkgLines.length;
        }
        const dependenciesLines = showpkgLines.slice(dependenciesIndex + 1, providesIndex);
        const packageVersions = dependenciesLines.map((line) => line.split(' ')[0]);
        fnlog(`Package ${packageName} has APT versions [${packageVersions.join(', ')}]`);

        const pkgTier = getPackagePreferenceTier(packageName, names);
        fnlog(`Package ${packageName} has preference tier ${pkgTier}`);

        // Check each version against requirements
        for (const packageVersion of packageVersions) {
            const versionRegexes = [/\d+:(\d+.\d+)-\d+/, /\d+:(\d+)-\d+/, /(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/];
            for (const versionRegex of versionRegexes) {
                const versionMatches = packageVersion.match(versionRegex);
                if (versionMatches !== null) {
                    const pkgVersionStr = removeSemverLeadingZeros(versionMatches[1]);
                    const pkgVersion = semver.coerce(pkgVersionStr);
                    const satisfies = pkgVersion !== null ? semver.satisfies(pkgVersion, version) : true;

                    if (!satisfies) {
                        fnlog(`Package ${packageName}=${packageVersion} version ${pkgVersion} does NOT satisfy ${names.join(', ')} version ${version}`);
                    } else if (pkgVersion !== null) {
                        installMatches.push(`${packageName}=${packageVersion}`);

                        const isBetterTier = bestMatch === null || pkgTier < bestMatch.tier;
                        const isSameTier = bestMatch !== null && pkgTier === bestMatch.tier;
                        const isBetterVersion = bestMatch !== null &&
                            ((checkLatest && semver.gt(pkgVersion, bestMatch.semverVersion)) ||
                             (!checkLatest && semver.lt(pkgVersion, bestMatch.semverVersion)));
                        const isFirstMatch = bestMatch === null;

                        if (isFirstMatch || isBetterTier || (isSameTier && isBetterVersion)) {
                            fnlog(`Package ${packageName}=${packageVersion} version ${pkgVersion} (tier ${pkgTier}) selected as best match for ${names.join(', ')} version ${version}`);
                            bestMatch = {
                                packageName: packageName,
                                packageVersion: packageVersion,
                                semverVersion: pkgVersion.toString(),
                                tier: pkgTier,
                                alternatives: installMatches
                            };
                        }
                    }
                    break;
                }
            }
        }
    }

    // Update alternatives in the final result
    if (bestMatch !== null) {
        bestMatch.alternatives = installMatches;
    }

    return bestMatch;
}

/**
 * Installs a package using the APT package manager.
 *
 * Attempts installation with apt-get, optionally falling back to aptitude
 * for better dependency resolution, and can try alternative package versions.
 *
 * @param packageName - The package name to install
 * @param packageVersion - Optional specific version string (e.g., "1:14.0.0-1ubuntu1")
 * @param alternatives - Alternative "package=version" strings to try if primary fails
 * @param options - Installation options
 * @returns The name of the successfully installed package, or null if installation failed
 */
export async function installProgramWithApt(
    packageName: string,
    packageVersion: string | null = null,
    alternatives: string[] = [],
    options: AptInstallOptions = {}
): Promise<string | null> {
    const fnlog = traceCommands.scoped('installProgramWithApt');

    const { tryAptitude = true, tryAlternatives = true } = options;

    const installPkg = packageVersion !== null
        ? `${packageName}=${packageVersion}`
        : packageName;

    fnlog(`Installing ${installPkg}`);
    const execOpts: exec.ExecOptions = {
        env: {
            DEBIAN_FRONTEND: 'noninteractive',
            TZ: 'Etc/UTC',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        },
        ignoreReturnCode: true
    };

    // Try apt-get install
    let exitCode = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', installPkg], execOpts);
    if (exitCode === 0) {
        return packageName;
    }

    fnlog(`Failed to install ${installPkg}. Exit code: ${exitCode}`);

    // Try aptitude as fallback
    if (tryAptitude) {
        let aptitudePath: string | null;
        try {
            aptitudePath = await io.which('aptitude');
        } catch {
            aptitudePath = null;
        }

        if (aptitudePath) {
            fnlog('Retrying with aptitude for better dependency resolution');
            exitCode = await execWithSudo('aptitude', ['install', '-f', '-y', installPkg], execOpts);
            if (exitCode === 0) {
                return packageName;
            }
            fnlog(`aptitude also failed. Exit code: ${exitCode}`);
        } else {
            fnlog('aptitude unavailable');
        }
    }

    // Try alternative packages
    if (tryAlternatives && alternatives.length > 0) {
        fnlog(`Trying alternative packages [${alternatives.join(', ')}]`);
        for (const altPkg of alternatives) {
            exitCode = await execWithSudo('apt-get', ['install', '-f', '-y', '--allow-downgrades', altPkg], execOpts);
            if (exitCode === 0) {
                // Extract package name from "package=version" format
                return altPkg.split('=')[0];
            }
        }
    }

    return null;
}

/**
 * Checks if APT package manager is available on the system.
 *
 * @returns True if APT is available and working, false otherwise
 */
export async function isAptAvailable(): Promise<boolean> {
    try {
        const exitCode = await exec.exec('apt', ['--version'], { silent: true });
        return exitCode === 0;
    } catch {
        return false;
    }
}

/**
 * Updates APT package lists.
 *
 * Runs apt-get update with appropriate sudo privileges if needed.
 */
export async function updateAptPackageLists(): Promise<void> {
    await execWithSudo('apt-get', ['update'], { ignoreReturnCode: true });
}

/**
 * Searches for and installs a program using APT package manager on Linux.
 *
 * This is the high-level orchestration function that:
 * 1. Checks if APT is available
 * 2. Updates package lists
 * 3. Searches for matching packages via {@link searchAptPackages}
 * 4. Installs the best match via {@link installProgramWithApt}
 * 5. Locates the installed executable
 *
 * For direct package installation without searching, use {@link installProgramWithApt} directly.
 *
 * @param names - Array of package/executable names to search for
 * @param version - Semver version constraint (e.g., ">=10", "14.0.0", "*")
 * @param checkLatest - If true, prefer latest matching version; if false, prefer earliest
 * @returns Object containing the found executable path and version, or nulls if not found
 */
export async function findProgramWithApt(names: string[], version: string, checkLatest: boolean): Promise<ProgramResult> {
    const fnlog = traceCommands.scoped('findProgramWithApt');

    let outputVersion: string | null = null;
    let outputPath: string | null = null;
    let installedPackage: string | null = null;

    // Check APT availability
    fnlog('Checking if APT is available');
    if (!await isAptAvailable()) {
        fnlog('APT is not available');
        return { outputVersion, outputPath, installedPackage };
    }

    try {
        // Update package lists
        fnlog(`Searching for ${names.join(', ')} with APT`);
        await updateAptPackageLists();

        // Search for matching packages
        const match = await searchAptPackages(names, version, checkLatest);
        if (match === null) {
            fnlog(`No matching package found for ${names.join(', ')} version ${version}`);
            return { outputVersion, outputPath, installedPackage };
        }

        fnlog(`Best match: ${match.packageName}=${match.packageVersion} (version ${match.semverVersion}, tier ${match.tier})`);

        // Install the package
        installedPackage = await installProgramWithApt(
            match.packageName,
            match.packageVersion,
            match.alternatives
        );

        if (installedPackage !== null) {
            // Locate the installed executable
            const result = await findProgramInSystemPaths([], names, version, checkLatest);
            outputVersion = result.outputVersion;
            outputPath = result.outputPath;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(errorMessage);
    }

    // Log results
    if (outputPath !== null) {
        fnlog(`Program found: ${outputPath}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (outputVersion !== null) {
        fnlog(`Package version found ${outputVersion}`);
    } else {
        fnlog(`Failed to find ${names[0]} packages with APT`);
    }
    if (installedPackage !== null) {
        fnlog(`Installed package: ${installedPackage}`);
    }

    return { outputVersion, outputPath, installedPackage };
}

/**
 * Ensures the add-apt-repository command is available on the system.
 *
 * Installs software-properties-common package if add-apt-repository is not present.
 *
 * @throws Error if add-apt-repository cannot be found or installed
 */
export async function ensureAddAptRepositoryIsAvailable(): Promise<void> {
    const fnlog = traceCommands.scoped('ensureAddAptRepositoryIsAvailable');

    let addAptRepositoryPath: string | null = null;
    try {
        addAptRepositoryPath = await io.which('add-apt-repository');
        fnlog(`add-apt-repository found at ${addAptRepositoryPath}`);
    } catch {
        addAptRepositoryPath = null;
    }
    if (addAptRepositoryPath === null || addAptRepositoryPath === '') {
        if (isSudoRequired()) {
            await ensureSudoIsAvailable();
        }
        await updateAptPackageLists();
        await installProgramWithApt('software-properties-common', null, [], { tryAptitude: false, tryAlternatives: false });
        await io.which('add-apt-repository');
    }
}
