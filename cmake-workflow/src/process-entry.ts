/**
 * CMake workflow entry processing — configure, build, test, install, package phases.
 *
 * @module process-entry
 */

import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';
import { ExpectedError } from 'pretty-errors';

import { type ResolvedInputs, type SetupCMakeOutputs, type ResolvedParameters } from './types';

import {
    createCMakeConfigureAnnotations,
    createCMakeBuildAnnotations,
    createCMakeTestAnnotations
} from './annotations';

/**
 * Converts an array of arguments to a shell-safe string.
 *
 * @param args - Array of command arguments
 * @returns Arguments joined as a shell-safe string
 */
export function makeArgsString(args: string[]): string {
    const res: string[] = [];
    for (const arg of args) {
        if (arg.includes(' ')) {
            res.push(`"${arg.replaceAll('"', '\\"')}"`);
        } else {
            res.push(arg);
        }
    }
    return res.join(' ');
}

/**
 * Generates a human-readable description of the current factor combination.
 *
 * @param entry - The resolved inputs for this entry
 * @returns Description string for logging
 */
export function makeFactorDescription(entry: ResolvedInputs): string {
    let description = '';
    if (entry.extra_args_key) {
        description = `${entry.extra_args_key}: `;
    }
    if (entry.cxxstd) {
        description += `C++${entry.cxxstd}`;
    } else {
        description += `Default C++ standard`;
    }
    return description;
}

/**
 * Runs the CMake configure step for a single entry.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param generatorIsMultiConfig - Whether the generator supports multiple configurations
 */
async function runConfigureStep(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    generatorIsMultiConfig: boolean
): Promise<void> {
    const fnlog = traceCommands.scoped('runConfigureStep');
    const stdBuildDir = entry.buildDir;

    const configureArgs: string[] = [];
    // Copy entry fields that may be modified
    let cxxflags = entry.cxxflags;
    let ccflags = entry.ccflags;

    /*
        Build parameters
     */
    if (setupCMakeOutputs.supportsPathToBuild) {
        // If this can't be set directly, then we need to change the
        // working directory when running the command
        configureArgs.push('-S');
        configureArgs.push(entry.sourceDir);
        configureArgs.push('-B');
        configureArgs.push(stdBuildDir);
    }
    if (entry.preset) {
        configureArgs.push(`--preset=${entry.preset}`);
    }
    if (entry.generator) {
        configureArgs.push('-G');
        configureArgs.push(entry.generator);
    }
    if (entry.generatorToolset) {
        configureArgs.push('-T');
        configureArgs.push(entry.generatorToolset);
    }
    if (entry.generatorArchitecture) {
        configureArgs.push('-A');
        configureArgs.push(entry.generatorArchitecture);
    }
    if (cxxflags.includes('/m32') && entry.generator.startsWith('Visual Studio')) {
        // In Visual Studio, the -A option is used to specify the architecture,
        // and it needs to be set explicitly
        configureArgs.push('-A', 'Win32');
        // Remove /m32 from cxxflags
        cxxflags = cxxflags
            .split(' ').filter((input) => input !== '')
            .filter((input) => input !== '/m32')
            .join(' ');
        ccflags = ccflags
            .split(' ').filter((input) => input !== '')
            .filter((input) => input !== '/m32')
            .join(' ');
    }
    if (entry.buildType && !generatorIsMultiConfig) {
        // When the generator is multi-config, the build type is set
        // when building the target. `CMAKE_CONFIGURATION_TYPES`
        // should not be set in this case.
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_BUILD_TYPE=${entry.buildType}`);
    }
    if (entry.toolchain) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_TOOLCHAIN_FILE=${entry.toolchain}`);
    }
    if (entry.runTests !== undefined && entry.configureTestsFlag) {
        configureArgs.push('-D');
        if (entry.configureTestsFlag.includes('=')) {
            configureArgs.push(entry.configureTestsFlag);
        } else {
            configureArgs.push(`${entry.configureTestsFlag}=${entry.runTests ? 'ON' : 'OFF'}`);
        }
    }
    if (entry.shared) {
        configureArgs.push('-D');
        configureArgs.push('BUILD_SHARED_LIBS=ON');
    }
    if (entry.cc) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_C_COMPILER=${entry.cc}`);
    }
    if (ccflags) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_C_FLAGS=${ccflags}`);
    }
    if (entry.cxx) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_CXX_COMPILER=${entry.cxx}`);
    }
    if (cxxflags) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_CXX_FLAGS=${cxxflags}`);
    }
    if (entry.cxxstd) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_CXX_STANDARD=${entry.cxxstd}`);
    }
    if (entry.exportCompileCommands === true) {
        configureArgs.push('-D');
        configureArgs.push('CMAKE_EXPORT_COMPILE_COMMANDS=ON');
    } else if (entry.exportCompileCommands === false) {
        configureArgs.push('-D');
        configureArgs.push('CMAKE_EXPORT_COMPILE_COMMANDS=OFF');
    }
    configureArgs.push('--no-warn-unused-cli');

    /*
        Install and package parameters
     */
    if (entry.installPrefix) {
        configureArgs.push('-D');
        configureArgs.push(`CMAKE_INSTALL_PREFIX=${entry.installPrefix}`);
    }
    if (entry.packageName.length > 0) {
        configureArgs.push('-D');
        configureArgs.push(`CPACK_GENERATOR=${entry.packageGenerators.join(';')}`);
    }
    if (entry.packageName) {
        configureArgs.push('-D');
        configureArgs.push(`CPACK_PACKAGE_NAME=${entry.packageName}`);
    }
    if (entry.packageDir) {
        configureArgs.push('-D');
        configureArgs.push(`CPACK_PACKAGE_DIRECTORY=${entry.packageDir}`);
    }
    if (entry.packageVendor) {
        configureArgs.push('-D');
        configureArgs.push(`CPACK_PACKAGE_VENDOR=${entry.packageVendor}`);
    }

    /*
        Extra arguments
     */
    fnlog(`Extra arguments: ${JSON.stringify(entry.extraArgs)}`);
    for (const extraArg of entry.extraArgs) {
        configureArgs.push(extraArg);
    }
    if (!setupCMakeOutputs.supportsPathToBuild) {
        // If CMake doesn't support the -S and -B options, then we will
        // need to change the working directory when running the command
        // and set the source directory as the last argument
        configureArgs.push(`${entry.sourceDir}`);
    }

    /*
        Prepare build directory
     */
    // Ensure buildDir exists
    const cmdDir = setupCMakeOutputs.supportsPathToBuild ? entry.sourceDir : stdBuildDir;
    if (!setupCMakeOutputs.supportsPathToBuild) {
        await io.mkdirP(stdBuildDir);
    }
    core.info(`💻 ${stdBuildDir}> ${entry.cmakePath} ${makeArgsString(configureArgs)}`);
    const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${entry.cmakePath}"`, configureArgs, {
        cwd: cmdDir,
        ignoreReturnCode: true
    });
    if (entry.createAnnotations) {
        createCMakeConfigureAnnotations(stdout, entry);
    }
    if (exitCode !== 0) {
        throw new ExpectedError(`CMake configure failed with exit code ${exitCode}. Check the configure output above for details.`, 'CMake Configure Failed');
    }
}

/**
 * Runs the CMake build step for a single entry.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param generatorIsMultiConfig - Whether the generator supports multiple configurations
 */
async function runBuildStep(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    generatorIsMultiConfig: boolean
): Promise<void> {
    const stdBuildDir = entry.buildDir;

    // Normalize build targets
    let buildTargets = entry.buildTarget;
    if (buildTargets.length === 0) {
        // null represents the default target
        buildTargets = [null];
    } else if (setupCMakeOutputs.supportsBuildMultipleTargets && buildTargets.length > 1) {
        // If multiple targets are specified, then we can only build them
        // all at once if the generator supports it. The targets
        // need to be space separated.
        buildTargets = [buildTargets.join(' ')];
    }

    /*
        Build parameters
     */
    for (const curBuildTarget of buildTargets) {
        const buildArgs: string[] = ['--build'];
        buildArgs.push(stdBuildDir);
        if (setupCMakeOutputs.supportsParallelBuild) {
            buildArgs.push('--parallel');
            buildArgs.push(`${entry.jobs}`);
        }
        if (entry.buildType && generatorIsMultiConfig) {
            buildArgs.push('--config');
            buildArgs.push(entry.buildType || 'Release');
        }
        if (curBuildTarget) {
            buildArgs.push('--target');
            for (const splitBuildTarget of curBuildTarget.split(' ').filter((input) => input !== '')) {
                buildArgs.push(splitBuildTarget);
            }
        }
        core.info(`💻 ${entry.sourceDir}> ${entry.cmakePath} ${makeArgsString(buildArgs)}`);
        const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${entry.cmakePath}"`, buildArgs, {
            cwd: entry.sourceDir,
            ignoreReturnCode: true
        });
        if (entry.createAnnotations) {
            createCMakeBuildAnnotations(stdout, entry);
        }
        if (exitCode !== 0) {
            throw new ExpectedError(`CMake build failed with exit code ${exitCode}. Check the build output above for details.`, 'CMake Build Failed');
        }
    }
}

/**
 * Runs the CTest step for a single entry.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param generatorIsMultiConfig - Whether the generator supports multiple configurations
 * @param ctestPath - Path to the CTest executable
 */
async function runTestStep(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    generatorIsMultiConfig: boolean,
    ctestPath: string
): Promise<void> {
    const stdBuildDir = entry.buildDir;

    /*
        Test parameters
     */
    const testArgs: string[] = ['--test-dir', stdBuildDir];
    if (setupCMakeOutputs.supportsParallelBuild) {
        testArgs.push('--parallel');
        testArgs.push(`${entry.jobs}`);
    }
    if (entry.buildType && generatorIsMultiConfig) {
        testArgs.push('--build-config');
        testArgs.push(entry.buildType || 'Release');
    }
    if (entry.runTests === true) {
        testArgs.push('--no-tests=error');
    } else {
        testArgs.push('--no-tests=ignore');
    }
    testArgs.push('--progress');
    testArgs.push('--output-on-failure');
    if (entry.ctestTimeout !== undefined) {
        testArgs.push('--timeout');
        testArgs.push(`${entry.ctestTimeout}`);
    }

    /*
        Run
     */
    core.info(`💻 ${entry.sourceDir}> ${ctestPath} ${makeArgsString(testArgs)}`);
    const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${ctestPath}"`, testArgs, {
        cwd: entry.sourceDir,
        ignoreReturnCode: true
    });
    if (entry.createAnnotations) {
        createCMakeTestAnnotations(stdout, entry);
    }
    if (exitCode !== 0 && entry.runTests === true) {
        throw new ExpectedError(`CMake tests failed with exit code ${exitCode}. Check the test output above for details.`, 'CMake Tests Failed');
    }
}

/**
 * Runs the CMake install step for a single entry.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param generatorIsMultiConfig - Whether the generator supports multiple configurations
 */
async function runInstallStep(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    generatorIsMultiConfig: boolean
): Promise<void> {
    const stdBuildDir = entry.buildDir;
    const stdInstallDir = entry.installPrefix;

    // Ensure install_dir exists
    await io.mkdirP(stdInstallDir);

    /*
        Install parameters
     */
    const installArgs: string[] = [];
    if (setupCMakeOutputs.supportsCmakeInstall) {
        installArgs.push('--install');
    } else {
        installArgs.push('--build');
    }
    installArgs.push(stdBuildDir);
    if (entry.buildType && generatorIsMultiConfig) {
        installArgs.push('--config');
        installArgs.push(entry.buildType || 'Release');
    }
    if (setupCMakeOutputs.supportsCmakeInstall) {
        if (entry.installPrefix) {
            installArgs.push('--prefix');
            installArgs.push(stdInstallDir);
        }
    } else {
        installArgs.push('--target');
        installArgs.push('install');
    }

    /*
        Run
     */
    core.info(`💻 ${entry.sourceDir}> ${entry.cmakePath} ${makeArgsString(installArgs)}`);
    const { exitCode: exitCode } = await exec.getExecOutput(`"${entry.cmakePath}"`, installArgs, {
        cwd: entry.sourceDir,
        ignoreReturnCode: true
    });
    if (exitCode !== 0 && entry.install === true) {
        throw new ExpectedError(`CMake install failed with exit code ${exitCode}. Check the install output above for details.`, 'CMake Install Failed');
    }
}

/**
 * Runs the CPack packaging step for a single entry.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param generatorIsMultiConfig - Whether the generator supports multiple configurations
 * @param cpackPath - Path to the CPack executable
 */
async function runPackageStep(
    entry: ResolvedInputs,
    generatorIsMultiConfig: boolean,
    cpackPath: string
): Promise<void> {
    const fnlog = traceCommands.scoped('runPackageStep');

    /*
        Determine cpack generators
     */
    let useDefaultGenerators = false;
    let packageGenerators = entry.packageGenerators;
    if (packageGenerators.length === 0) {
        fnlog(`No package generators specified. Using available generators.`);
        // Run something equivalent to
        // generators=$("${{ steps.params.outputs.cpackPath }}" --help | awk '/Generators/ {flag=1; next} flag && NF {print $1}' ORS=';' | sed 's/;$//')
        // to find the line where the list of generators starts, and then
        // get each generator from the following lines until a blank line.
        // The output of each of these lines is something like:
        //   7Z                           = 7-Zip file format
        const { stdout } = await exec.getExecOutput(`"${cpackPath}"`, ['--help'], {
            silent: true,
            ignoreReturnCode: true
        });
        const availableGenerators: string[] = [];
        let collectingGenerators = false;
        for (const line of stdout.split(/\r?\n/)) {
            if (!collectingGenerators) {
                collectingGenerators = line.trim() === 'Generators';
            } else {
                if (line.trim() === '') {
                    break;
                }
                const parts = line.split('=');
                if (parts.length !== 2) {
                    break;
                }
                availableGenerators.push(parts[0].trim());
            }
        }
        core.info(`🔄 Available CPack generators: ${availableGenerators.join(';')}`);
        packageGenerators = availableGenerators;
        useDefaultGenerators = true;
    } else {
        fnlog(`Using specified package generators: ${packageGenerators.join(';')}`);
    }

    const stdBuildDir = entry.buildDir;
    const packageFiles: string[] = [];

    // Internal loop over package generators (not a combinatorial factor)
    for (const packageGenerator of packageGenerators) {
        core.info(`⚙️ Generating package with generator "${packageGenerator}"`);
        const cpackArgs: string[] = ['-G', packageGenerator];
        if (entry.buildType && generatorIsMultiConfig) {
            cpackArgs.push('-C');
            cpackArgs.push(entry.buildType || 'Release');
        }
        if (traceCommands.enabled()) {
            cpackArgs.push('--verbose');
        }
        if (entry.packageName) {
            cpackArgs.push('-P');
            cpackArgs.push(entry.packageName);
        }
        if (entry.packageDir) {
            cpackArgs.push('-B');
            cpackArgs.push(entry.packageDir);
        }
        if (entry.packageVendor) {
            cpackArgs.push('--vendor');
            cpackArgs.push(entry.packageVendor);
        }
        /*
            Run
         */
        core.info(`💻 ${stdBuildDir}> ${cpackPath} ${makeArgsString(cpackArgs)}`);
        const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${cpackPath}"`, cpackArgs, {
            cwd: stdBuildDir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            fnlog(`package: ${entry.package}`);
            fnlog(`useDefaultGenerators: ${useDefaultGenerators}`);
            const msg = `CPack (generator: ${packageGenerator}) failed with exit code ${exitCode}`;
            if (!useDefaultGenerators) {
                throw new ExpectedError(`${msg}. Check the packaging output above for details.`, 'CPack Failed');
            } else {
                // If we are using the default generators, then we
                // can ignore the failure and continue with the
                // next generator because the generator hasn't been
                // explicitly specified by the user.
                fnlog(msg);
                continue;
            }
        }

        // Find package file from the command output
        const lines = stdout.split(/\r?\n/);
        const regex = /^\s*CPack: - package: (.*) generated\.$/;
        for (const line of lines) {
            const match = line.match(regex);
            if (match) {
                const packagePath = match[1];
                core.info(`✅ Generated package: ${packagePath}`);
                packageFiles.push(packagePath);
                break;
            }
        }
    }

    if (packageFiles.length !== 0 && entry.packageArtifact) {
        await uploadPackageArtifacts(entry, packageFiles, fnlog);
    }
}

/**
 * Uploads package files as GitHub Actions artifacts.
 *
 * @param entry - Resolved inputs for this factor combination
 * @param packageFiles - List of package file paths to upload
 * @param fnlog - Trace logging function
 */
async function uploadPackageArtifacts(
    entry: ResolvedInputs,
    packageFiles: string[],
    fnlog: (msg: string) => void
): Promise<void> {
    core.startGroup(`⬆️ Upload package artifacts`);
    /*
        Generate artifacts
     */
    core.info(`📦 Package files: ${packageFiles.join(',')}`);

    // Determine the common prefix of the basenames of these files
    // to use as the artifact
    let commonPrefix = '';
    for (const packageFile of packageFiles) {
        if (commonPrefix === '') {
            commonPrefix = packageFile;
        } else {
            let i = 0;
            for (; i < commonPrefix.length && i < packageFile.length; i++) {
                if (commonPrefix[i] !== packageFile[i]) {
                    break;
                }
            }
            commonPrefix = commonPrefix.substring(0, i);
        }
    }
    fnlog(`Common package prefix: ${commonPrefix}`);

    // Create a name for the artifact with all packages
    let artifactName = path.basename(commonPrefix) + '-';
    // Check if platform OS is Ubuntu
    if (artifactName === 'linux' && fs.existsSync('/etc/os-release')) {
        const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
        if (osRelease.includes('Ubuntu')) {
            // Get ubuntu version
            let ubuntuVersion: string | undefined = undefined;
            const regex = /VERSION_ID="(.*)"/;
            const match = osRelease.match(regex);
            if (match) {
                ubuntuVersion = match[1];
            }
            if (!ubuntuVersion) {
                // Rely on lsbRelease -rs
                const { exitCode: exitCode, stdout } = await exec.getExecOutput('lsbRelease', ['-rs'], {
                    ignoreReturnCode: true
                });
                if (exitCode === 0) {
                    artifactName += stdout.trim();
                }
            }
            if (!ubuntuVersion) {
                // Extract the Ubuntu version from /etc/lsb-release
                const lsbRelease = fs.readFileSync('/etc/lsb-release', 'utf8');
                const regex = /DISTRIB_RELEASE=(.*)/;
                const match = lsbRelease.match(regex);
                if (match) {
                    ubuntuVersion = match[1].trim();
                }
            }
            if (!ubuntuVersion) {
                // Extract Ubuntu version from uname -a
                const { exitCode: exitCode, stdout } = await exec.getExecOutput('uname', ['-a'], {
                    ignoreReturnCode: true
                });
                if (exitCode === 0) {
                    const regex = /Ubuntu (.*)/;
                    const match = stdout.match(regex);
                    if (match) {
                        ubuntuVersion = match[1].trim();
                    }
                }
            }
            if (ubuntuVersion) {
                artifactName += '-ubuntu-' + ubuntuVersion;
            }
        }
    } else {
        artifactName += '-' + (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    }

    // Add compiler to artifact name.
    // Use CPP_ACTIONS_COMPILER env var (set by setup-cpp) when available
    // to disambiguate families that share the same binary name (e.g.,
    // apple-clang and macos-clang both use clang++).
    const compilerFamily = process.env['CPP_ACTIONS_COMPILER'] || '';
    if (compilerFamily) {
        artifactName += '-' + compilerFamily;
    } else if (!entry.cxx && artifactName.includes('windows')) {
        artifactName += '-msvc';
    } else if (entry.cxx) {
        const cxxBasename = path.basename(entry.cxx);
        if (cxxBasename.startsWith('clang')) {
            if (artifactName.includes('windows')) {
                artifactName += '-clang-cl';
            } else {
                artifactName += '-clang';
            }
        } else if (cxxBasename.startsWith('gcc') || cxxBasename.startsWith('g++')) {
            if (artifactName.includes('windows')) {
                artifactName += '-mingw';
            } else {
                artifactName += '-gcc';
            }
        } else if (cxxBasename.startsWith('cl')) {
            artifactName += '-msvc';
        }
    }
    artifactName += '-packages';
    fnlog(`Artifact name: ${artifactName}`);
    fnlog(`Retention days: ${entry.packageRetentionDays}`);
    const packagesDir = path.dirname(commonPrefix);
    fnlog(`Packages directory: ${packagesDir}`);
    const artifact = new DefaultArtifactClient();
    const { id, size } = await artifact.uploadArtifact(
        artifactName,
        packageFiles,
        packagesDir,
        { retentionDays: entry.packageRetentionDays }
    );
    traceCommands.log(`Created artifact with id: ${id} (bytes: ${size}`);
    core.endGroup();
}

/**
 * Processes a single resolved entry through the CMake workflow.
 *
 * Runs configure, build, test, install, and package steps for a single
 * combination of factors (cxxstd, extraArgs).
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param resolvedParams - Resolved parameters (generator info, tool paths)
 * @throws Error if any step fails
 */
export async function processEntry(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    resolvedParams: ResolvedParameters
): Promise<void> {
    const fnlog = traceCommands.scoped('processEntry');

    const { generatorIsMultiConfig, ctestPath, cpackPath } = resolvedParams;
    const factorDesc = makeFactorDescription(entry);

    fnlog(`Processing entry: ${factorDesc}, buildDir=${entry.buildDir}`);

    // ==============================================
    // Configure step
    // ==============================================
    core.startGroup(`⚙️ Configure (${factorDesc})`);
    await runConfigureStep(entry, setupCMakeOutputs, generatorIsMultiConfig);
    core.endGroup();

    // ==============================================
    // Build step
    // ==============================================
    core.startGroup(`🛠️ Build (${factorDesc})`);
    await runBuildStep(entry, setupCMakeOutputs, generatorIsMultiConfig);
    core.endGroup();

    // ==============================================
    // Test step
    // ==============================================
    // Run tests if: tests are enabled AND (testAllCxxstd OR this is the main entry)
    const shouldRunTests = entry.runTests !== false && (entry.testAllCxxstd || entry.is_main_entry);
    if (shouldRunTests) {
        core.startGroup(`🧪 Test (${factorDesc})`);
        await runTestStep(entry, setupCMakeOutputs, generatorIsMultiConfig, ctestPath);
        core.endGroup();
    }

    // ==============================================
    // Install step
    // ==============================================
    // Run install if: install is enabled AND (installAllCxxstd OR this is the main entry)
    const shouldInstall = entry.install !== false && (entry.installAllCxxstd || entry.is_main_entry);
    if (shouldInstall) {
        core.startGroup(`🚚 Install (${factorDesc})`);
        await runInstallStep(entry, setupCMakeOutputs, generatorIsMultiConfig);
        core.endGroup();
    }

    // ==============================================
    // Package step
    // ==============================================
    // Run package if: package is enabled AND (packageAllCxxstd OR this is the main entry)
    const shouldPackage = entry.package && (entry.packageAllCxxstd || entry.is_main_entry);
    if (shouldPackage) {
        core.startGroup(`📦 Package (${factorDesc})`);
        await runPackageStep(entry, generatorIsMultiConfig, cpackPath);
        core.endGroup();
    }
}
