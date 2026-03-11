/**
 * Main entry point for setup-clang action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

// Type imports
import { type Inputs, type MainOutputs } from './types';
export type { Inputs, MainOutputs };

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Re-export removeClangPrefix for external use
export { removeClangPrefix } from './schema';

// Module imports
import { clangDownloadCandidates, installProgramFromClangUrls } from './download';
import { installCompanionPackages } from './companion-packages';

import * as setup_program from 'setup-program';

/**
 * Sets up Clang compiler on the runner with the specified version.
 *
 * This function locates or installs Clang with the requested version, searching
 * the provided paths first, then falling back to apt-get installation on Linux.
 * On macOS, it uses the system-provided Clang. It can optionally update
 * environment variables to make the compiler available.
 *
 * @param version - The Clang version to set up (e.g., "14", "14.0", ">=14"). Supports
 *                  semver ranges for flexible version matching.
 * @param paths - Array of paths to search for existing Clang installations before
 *                attempting installation
 * @param checkLatest - If true, checks for the latest available version matching
 *                       the version constraint
 * @param updateEnvironment - If true, updates PATH and environment variables to
 *                             make the compiler available for subsequent steps
 * @returns Object containing paths to clang/clang++, version info, and environment changes
 */
export async function main(
    version: string,
    paths: string[],
    checkLatest: boolean,
    updateEnvironment: boolean
): Promise<MainOutputs> {
    core.startGroup('🔎 Find clang versions');
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }
    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux');
    }

    const allVersions: string[] = await setup_program.findClangVersions();
    core.endGroup();

    // Path program version
    let outputPath: string | null = null;
    let outputVersion: string | null = null;
    let installedAptPackage: string | null = null;

    // Setup path program
    if (paths.length > 0) {
        core.startGroup('🔍 Find clang in specified paths');
        core.info(`Searching for Clang ${version} in paths [${paths.join(',')}]`);
        const result = await setup_program.findProgramInPath(paths, version, checkLatest);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    }

    // Setup system program
    if (!outputPath) {
        core.startGroup('📁 Find clang in system paths');
        core.info(`Searching for Clang ${version} in PATH`);
        traceCommands.log(`Arguments: ${paths}, ['clang++'], ${version}, ${checkLatest}`);
        const result = await setup_program.findProgramInSystemPaths(
            paths,
            ['clang++'],
            version,
            checkLatest
        );
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    }

    // Setup APT program
    if (!outputVersion && process.platform === 'linux') {
        core.startGroup('📦 Find clang with APT');
        core.info(`Searching for Clang ${version} with APT`);

        // Add repositories for major clang versions
        const allVersionMajors = allVersions
            .filter((v) => semver.satisfies(v, version))
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
                `Adding APT repositories for Clang ${version} major versions [${allVersionMajors.join(', ')}]`
            );

            // Adding a key requires gnupg
            await setup_program.findProgramWithApt(['gnupg'], '*', true);

            // Download repo key
            const gpgKeyUrl = 'https://apt.llvm.org/llvm-snapshot.gpg.key';
            const keyPath = await tc.downloadTool(gpgKeyUrl);
            if (setup_program.isSudoRequired()) {
                await setup_program.ensureSudoIsAvailable();
                await exec.exec(`sudo -n sudo apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            } else {
                await exec.exec(`apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            }

            // add-apt-repository requires installing software-properties-common
            await setup_program.findProgramWithApt(['software-properties-common'], '*', true);
            let addAptRepositoryPath: string | null = null;
            try {
                addAptRepositoryPath = await io.which('add-apt-repository');
                traceCommands.log(`add-apt-repository found at ${addAptRepositoryPath}`);
            } catch {
                addAptRepositoryPath = null;
            }

            // Add APT repositories
            if (addAptRepositoryPath !== null && addAptRepositoryPath !== '') {
                for (const major of allVersionMajors) {
                    const ReleaseFileURL = `https://apt.llvm.org/${ubuntuName}/dists/llvm-toolchain-${ubuntuName}-${major}/Release`;
                    traceCommands.log(`Checking if ${ReleaseFileURL} exists`);
                    if (!(await setup_program.urlExists(ReleaseFileURL))) {
                        traceCommands.log(
                            `Skipping repository for major version ${major} because ${ReleaseFileURL} does not exist`
                        );
                        continue;
                    }
                    await setup_program.ensureAddAptRepositoryIsAvailable();
                    const repo = `deb https://apt.llvm.org/${ubuntuName}/ llvm-toolchain-${ubuntuName}-${major} main`;
                    traceCommands.log(`Adding repository "${repo}"`);
                    if (setup_program.isSudoRequired()) {
                        await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], {
                            ignoreReturnCode: true
                        });
                    } else {
                        await exec.exec(`add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
                    }
                }
            }
        }

        core.info(`Searching for Clang ${version} with APT`);
        const result = await setup_program.findProgramWithApt(['clang'], version, checkLatest);
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        installedAptPackage = result.installedPackage ?? null;
        core.endGroup();
    } else {
        if (outputVersion !== null) {
            traceCommands.log(
                `Skipping APT step because Clang ${outputVersion} was already found in ${outputPath}`
            );
        } else if (process.platform !== 'linux') {
            traceCommands.log(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // If outputVersion === null, and it gets installed at all, it will be installed from a URL
    const willInstallFromUrl = outputVersion === null;
    if (outputVersion === null) {
        core.startGroup('⬇️ Download clang');
        const { versionCandidates, ubuntuVersions } = clangDownloadCandidates(
            version,
            allVersions,
            checkLatest
        );
        const result = await installProgramFromClangUrls(
            ubuntuVersions,
            versionCandidates,
            version,
            checkLatest,
            updateEnvironment,
            outputVersion,
            outputPath
        );
        outputVersion = result.outputVersion;
        outputPath = result.outputPath;
        core.endGroup();
    } else {
        traceCommands.log(
            `Skipping download step because Clang ${outputVersion} was already found in ${outputPath}`
        );
    }

    // Install companion packages for tool parity (llvm-symbolizer, sanitizer runtimes)
    let symbolizerPath: string | null = null;
    if (outputVersion) {
        core.startGroup('🔧 Install companion packages');
        const companionResult = await installCompanionPackages(outputVersion, installedAptPackage, willInstallFromUrl);
        symbolizerPath = companionResult.symbolizerPath;
        core.endGroup();

        // Set sanitizer symbolizer environment variables if symbolizer was found
        if (symbolizerPath && updateEnvironment) {
            core.info(`Setting sanitizer symbolizer path to ${symbolizerPath}`);
            core.exportVariable('ASAN_SYMBOLIZER_PATH', symbolizerPath);
            core.exportVariable('MSAN_SYMBOLIZER_PATH', symbolizerPath);
            core.exportVariable('TSAN_SYMBOLIZER_PATH', symbolizerPath);
            core.exportVariable('UBSAN_SYMBOLIZER_PATH', symbolizerPath);
        }
    }

    // Create outputs
    let cc: string | null = outputPath;
    let cxx: string | null = outputPath;
    let bindir = '';
    let dir = '';
    let release = '0.0.0';
    let versionMajor = 0;
    let versionMinor = 0;
    let versionPatch = 0;

    if (outputPath) {
        const pathBasename = path.basename(outputPath);
        if (pathBasename.startsWith('clang++')) {
            cc = path.join(path.dirname(outputPath), pathBasename.replace('clang++', 'clang'));
        } else if (pathBasename.startsWith('clang')) {
            cxx = path.join(path.dirname(outputPath), pathBasename.replace('clang', 'clang++'));
        }

        if (cc && !fs.existsSync(cc)) {
            traceCommands.log(`Could not find ${cc}, using ${outputPath} as cc instead`);
            cc = outputPath;
        }

        if (cxx && !fs.existsSync(cxx)) {
            traceCommands.log(`Could not find ${cxx}, using ${outputPath} as cxx instead`);
            cxx = outputPath;
        }

        const semverV =
            outputVersion !== null
                ? semver.parse(outputVersion, { loose: true })
                : semver.parse('0.0.0', { loose: true });

        if (semverV) {
            release = semverV.toString();
            versionMajor = semverV.major;
            versionMinor = semverV.minor;
            versionPatch = semverV.patch;
        }

        bindir = path.dirname(outputPath);
        if (updateEnvironment) {
            core.addPath(bindir);
        }
        dir = path.dirname(bindir);

        if (willInstallFromUrl) {
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
        outputPath,
        cc,
        cxx,
        bindir,
        dir,
        version: release,
        versionMajor,
        versionMinor,
        versionPatch,
        symbolizerPath
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
    title: 'Setup Clang',
    main: async (inputs: Inputs) => {
        const outputs = await main(
            inputs.version,
            inputs.path,
            inputs.checkLatest,
            inputs.updateEnvironment
        );

        // Validate that Clang was found
        if (!outputs.outputPath) {
            core.setFailed('Cannot setup Clang');
        }

        return outputs;
    },
    callerModule: module
});
