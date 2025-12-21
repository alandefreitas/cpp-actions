import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as os from 'os';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

import {
    Inputs,
    ResolvedInputs,
    SetupCMakeOutputs,
    ResolvedParameters
} from './types';

import {
    createCMakeConfigureAnnotations,
    createCMakeBuildAnnotations,
    createCMakeTestAnnotations
} from './annotations';

import { resolvePreset } from './presets';
import { normalizeArchitectureInput, deriveGeneratorArchitectureFromArch, setupDefaultGenerator } from './generators';
import { downloadSourceCode, applyPatches } from './source-download';
import {
    parseExtraArgs,
    expandInputs,
    validateUniquePaths,
    normalizePath,
    applyPresetMacros
} from './input-expansion';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_cmake = require('setup-cmake');

/**
 * Returns the number of available CPU cores.
 *
 * @returns Number of available CPUs, minimum 1
 */
function numberOfCpus(): number {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length;
    if (!result || result === 0) {
        return 1;
    }
    return result;
}

/**
 * Converts an array of arguments to a shell-safe string.
 *
 * @param args - Array of command arguments
 * @returns Arguments joined as a shell-safe string
 */
function makeArgsString(args: string[]): string {
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
 * Resolves and validates CMake workflow input parameters.
 *
 * Applies presets, sets default values, identifies generator features,
 * resolves compiler paths, and prepares all parameters needed for the build.
 *
 * @param inputs - Raw input parameters from the action
 * @param setupCMakeOutputs - Outputs from CMake setup including paths and version info
 * @returns Resolved parameters ready for the CMake workflow execution
 */
async function resolveInputParameters(inputs: Inputs, setupCMakeOutputs: SetupCMakeOutputs): Promise<ResolvedParameters> {
    function fnlog(msg: string): void {
        trace_commands.log('resolveInputParameters: ' + msg);
    }

    // ----------------------------------------------
    // Identify and apply preset to input args
    // ----------------------------------------------
    resolvePreset(inputs, setupCMakeOutputs);

    // ----------------------------------------------
    // Set default values
    // ----------------------------------------------
    if (!inputs.preset) {
        // We don't set these when there's a preset because
        // it might be defined there
        inputs.build_type = inputs.build_type || 'Release';
        inputs.build_dir = inputs.build_dir || 'build';
    }
    inputs.cmake_path = setupCMakeOutputs.path || 'cmake';

    // ----------------------------------------------
    // Identify generator features
    // ----------------------------------------------
    if (!inputs.generator && !inputs.preset) {
        await setupDefaultGenerator(inputs);
    }
    let generator_is_multi_config = false;
    if (inputs.generator) {
        generator_is_multi_config = inputs.generator.startsWith('Visual Studio') || ['Ninja Multi-Config', 'Xcode'].includes(inputs.generator);
        core.info(`🔄 Generator "${inputs.generator}" ${generator_is_multi_config ? 'IS' : 'is NOT'} multi-config`);
    }

    // ----------------------------------------------
    // Find other cmake tools
    // ----------------------------------------------
    const ctest_path = path.join(setupCMakeOutputs.dir, 'ctest');
    core.info(`🧩 ctest_path: ${ctest_path}`);
    const cpack_path = path.join(setupCMakeOutputs.dir, 'cpack');
    core.info(`🧩 cpack_path: ${cpack_path}`);

    // ----------------------------------------------
    // Identify complete compiler paths
    // ----------------------------------------------
    async function resolveCompilerPath(compiler: string): Promise<string> {
        // If it's empty, there's nothing to resolve.
        if (!compiler) {
            return compiler;
        }
        // If it's only an application name, try to find it in PATH
        const isNameOnly = path.basename(compiler) === compiler;
        if (isNameOnly) {
            try {
                return await io.which(compiler);
            } catch (error) {
                fnlog(`Could not find ${compiler} in PATH`);
                return compiler;
            }
        }
        // If it's a relative path, resolve it
        const isRelative = compiler.startsWith('.');
        if (isRelative) {
            compiler = path.resolve(compiler);
        }
        // Check if we need to add .exe to the compiler path on windows
        if (process.platform === 'win32' && !compiler.endsWith('.exe')) {
            // Does the file exist with .exe and not without it?
            const compilerWithExe = compiler + '.exe';
            if (fs.existsSync(compilerWithExe) && !fs.existsSync(compiler)) {
                compiler = compilerWithExe;
            }
        }
        return compiler;
    }

    inputs.cc = await resolveCompilerPath(inputs.cc);
    core.info(`🧩 cc: ${inputs.cc}`);
    inputs.cxx = await resolveCompilerPath(inputs.cxx);
    core.info(`🧩 cxx: ${inputs.cxx}`);

    // ----------------------------------------------
    // Identify C++ standards to test
    // ----------------------------------------------
    if (inputs.cxxstd.length === 0) {
        // Null element represents the default compiler
        inputs.cxxstd = [null];
    }
    core.info(`🧩 cxxstd: ${inputs.cxxstd.map(element => (element === null ? '<default>' : element))}`);
    const main_cxxstd = inputs.cxxstd[inputs.cxxstd.length - 1];
    core.info(`🧩 main_cxxstd: ${main_cxxstd === null ? '<default>' : main_cxxstd}`);

    // ----------------------------------------------
    // Resolve paths
    // ----------------------------------------------
    inputs.source_dir = path.resolve(applyPresetMacros(inputs.source_dir, inputs) as string);
    if (inputs.build_dir) {
        inputs.build_dir = path.resolve(inputs.source_dir, applyPresetMacros(inputs.build_dir, inputs) as string);
    }
    if (inputs.install_prefix) {
        inputs.install_prefix = normalizePath(path.resolve(applyPresetMacros(inputs.install_prefix, inputs) as string));
    }
    if (inputs.package_dir) {
        inputs.package_dir = normalizePath(path.resolve(inputs.build_dir, applyPresetMacros(inputs.package_dir, inputs) as string));
    }

    // Apply preset macros to the inputs that accept them
    inputs = applyPresetMacros(inputs, inputs) as Inputs;

    // ----------------------------------------------
    // Print the adjusted parameters
    // ----------------------------------------------
    for (const [name, value] of Object.entries(inputs)) {
        core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`);
    }

    return {
        main_cxxstd,
        generator_is_multi_config,
        ctest_path,
        cpack_path
    };
}

/**
 * Generates a human-readable description of the current factor combination.
 *
 * @param entry - The resolved inputs for this entry
 * @returns Description string for logging
 */
function makeFactorDescription(entry: ResolvedInputs): string {
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
 * Processes a single resolved entry through the CMake workflow.
 *
 * Runs configure, build, test, install, and package steps for a single
 * combination of factors (cxxstd, extra_args).
 *
 * @param entry - Resolved inputs for this factor combination
 * @param setupCMakeOutputs - CMake setup results (paths, capabilities)
 * @param resolvedParams - Resolved parameters (generator info, tool paths)
 * @throws Error if any step fails
 */
async function processEntry(
    entry: ResolvedInputs,
    setupCMakeOutputs: SetupCMakeOutputs,
    resolvedParams: ResolvedParameters
): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log('processEntry: ' + msg);
    }

    const { generator_is_multi_config, ctest_path, cpack_path } = resolvedParams;
    const factorDesc = makeFactorDescription(entry);

    fnlog(`Processing entry: ${factorDesc}, build_dir=${entry.build_dir}`);

    // ==============================================
    // Configure step
    // ==============================================
    core.startGroup(`⚙️ Configure (${factorDesc})`);
    {
        const std_build_dir = entry.build_dir;

        const configure_args: string[] = [];
        // Copy entry fields that may be modified
        let cxxflags = entry.cxxflags;
        let ccflags = entry.ccflags;

        /*
            Build parameters
         */
        if (setupCMakeOutputs.supports_path_to_build) {
            // If this can't be set directly, then we need to change the
            // working directory when running the command
            configure_args.push('-S');
            configure_args.push(entry.source_dir);
            configure_args.push('-B');
            configure_args.push(std_build_dir);
        }
        if (entry.preset) {
            configure_args.push(`--preset=${entry.preset}`);
        }
        if (entry.generator) {
            configure_args.push('-G');
            configure_args.push(entry.generator);
        }
        if (entry.generator_toolset) {
            configure_args.push('-T');
            configure_args.push(entry.generator_toolset);
        }
        if (entry.generator_architecture) {
            configure_args.push('-A');
            configure_args.push(entry.generator_architecture);
        }
        if (cxxflags.includes('/m32') && entry.generator.startsWith('Visual Studio')) {
            // In Visual Studio, the -A option is used to specify the architecture,
            // and it needs to be set explicitly
            configure_args.push('-A', 'Win32');
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
        if (entry.build_type && !generator_is_multi_config) {
            // When the generator is multi-config, the build type is set
            // when building the target. `CMAKE_CONFIGURATION_TYPES`
            // should not be set in this case.
            configure_args.push('-D');
            configure_args.push(`CMAKE_BUILD_TYPE=${entry.build_type}`);
        }
        if (entry.toolchain) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_TOOLCHAIN_FILE=${entry.toolchain}`);
        }
        if (entry.run_tests !== undefined && entry.configure_tests_flag) {
            configure_args.push('-D');
            if (entry.configure_tests_flag.includes('=')) {
                configure_args.push(entry.configure_tests_flag);
            } else {
                configure_args.push(`${entry.configure_tests_flag}=${entry.run_tests ? 'ON' : 'OFF'}`);
            }
        }
        if (entry.shared) {
            configure_args.push('-D');
            configure_args.push('BUILD_SHARED_LIBS=ON');
        }
        if (entry.cc) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_C_COMPILER=${entry.cc}`);
        }
        if (ccflags) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_C_FLAGS=${ccflags}`);
        }
        if (entry.cxx) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_CXX_COMPILER=${entry.cxx}`);
        }
        if (cxxflags) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_CXX_FLAGS=${cxxflags}`);
        }
        if (entry.cxxstd) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_CXX_STANDARD=${entry.cxxstd}`);
        }
        if (entry.export_compile_commands === true) {
            configure_args.push('-D');
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=ON');
        } else if (entry.export_compile_commands === false) {
            configure_args.push('-D');
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=OFF');
        }
        configure_args.push('--no-warn-unused-cli');

        /*
            Install and package parameters
         */
        if (entry.install_prefix) {
            configure_args.push('-D');
            configure_args.push(`CMAKE_INSTALL_PREFIX=${entry.install_prefix}`);
        }
        if (entry.package_name.length > 0) {
            configure_args.push('-D');
            configure_args.push(`CPACK_GENERATOR=${entry.package_generators.join(';')}`);
        }
        if (entry.package_name) {
            configure_args.push('-D');
            configure_args.push(`CPACK_PACKAGE_NAME=${entry.package_name}`);
        }
        if (entry.package_dir) {
            configure_args.push('-D');
            configure_args.push(`CPACK_PACKAGE_DIRECTORY=${entry.package_dir}`);
        }
        if (entry.package_vendor) {
            configure_args.push('-D');
            configure_args.push(`CPACK_PACKAGE_VENDOR=${entry.package_vendor}`);
        }

        /*
            Extra arguments
         */
        fnlog(`Extra arguments: ${JSON.stringify(entry.extra_args)}`);
        for (const extra_arg of entry.extra_args) {
            configure_args.push(extra_arg);
        }
        if (!setupCMakeOutputs.supports_path_to_build) {
            // If CMake doesn't support the -S and -B options, then we will
            // need to change the working directory when running the command
            // and set the source directory as the last argument
            configure_args.push(`${entry.source_dir}`);
        }

        /*
            Prepare build directory
         */
        // Ensure build_dir exists
        const cmd_dir = setupCMakeOutputs.supports_path_to_build ? entry.source_dir : std_build_dir;
        if (!setupCMakeOutputs.supports_path_to_build) {
            await io.mkdirP(std_build_dir);
        }
        core.info(`💻 ${std_build_dir}> ${entry.cmake_path} ${makeArgsString(configure_args)}`);
        const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${entry.cmake_path}"`, configure_args, {
            cwd: cmd_dir,
            ignoreReturnCode: true
        });
        if (entry.create_annotations) {
            createCMakeConfigureAnnotations(stdout, entry);
        }
        if (exitCode !== 0) {
            throw new Error(`CMake configure failed with exit code ${exitCode}`);
        }
    }
    core.endGroup();

    // ==============================================
    // Build step
    // ==============================================
    core.startGroup(`🛠️ Build (${factorDesc})`);
    {
        const std_build_dir = entry.build_dir;

        // Normalize build targets
        let build_targets = entry.build_target;
        if (build_targets.length === 0) {
            // null represents the default target
            build_targets = [null];
        } else if (setupCMakeOutputs.supports_build_multiple_targets && build_targets.length > 1) {
            // If multiple targets are specified, then we can only build them
            // all at once if the generator supports it. The targets
            // need to be space separated.
            build_targets = [build_targets.join(' ')];
        }

        /*
            Build parameters
         */
        for (const cur_build_target of build_targets) {
            const build_args: string[] = ['--build'];
            build_args.push(std_build_dir);
            if (setupCMakeOutputs.supports_parallel_build) {
                build_args.push('--parallel');
                build_args.push(`${entry.jobs}`);
            }
            if (entry.build_type && generator_is_multi_config) {
                build_args.push('--config');
                build_args.push(entry.build_type || 'Release');
            }
            if (cur_build_target) {
                build_args.push('--target');
                for (const split_build_target of cur_build_target.split(' ').filter((input) => input !== '')) {
                    build_args.push(split_build_target);
                }
            }
            core.info(`💻 ${entry.source_dir}> ${entry.cmake_path} ${makeArgsString(build_args)}`);
            const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${entry.cmake_path}"`, build_args, {
                cwd: entry.source_dir,
                ignoreReturnCode: true
            });
            if (entry.create_annotations) {
                createCMakeBuildAnnotations(stdout, entry);
            }
            if (exitCode !== 0) {
                throw new Error(`CMake build failed with exit code ${exitCode}`);
            }
        }
    }
    core.endGroup();

    // ==============================================
    // Test step
    // ==============================================
    // Run tests if: tests are enabled AND (test_all_cxxstd OR this is the main entry)
    const shouldRunTests = entry.run_tests !== false && (entry.test_all_cxxstd || entry.is_main_entry);
    if (shouldRunTests) {
        core.startGroup(`🧪 Test (${factorDesc})`);
        {
            const std_build_dir = entry.build_dir;

            /*
                Test parameters
             */
            const test_args: string[] = ['--test-dir', std_build_dir];
            if (setupCMakeOutputs.supports_parallel_build) {
                test_args.push('--parallel');
                test_args.push(`${entry.jobs}`);
            }
            if (entry.build_type && generator_is_multi_config) {
                test_args.push('--build-config');
                test_args.push(entry.build_type || 'Release');
            }
            if (entry.run_tests === true) {
                test_args.push('--no-tests=error');
            } else {
                test_args.push('--no-tests=ignore');
            }
            test_args.push('--progress');
            test_args.push('--output-on-failure');
            if (entry.ctest_timeout !== undefined) {
                test_args.push('--timeout');
                test_args.push(`${entry.ctest_timeout}`);
            }

            /*
                Run
             */
            core.info(`💻 ${entry.source_dir}> ${ctest_path} ${makeArgsString(test_args)}`);
            const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${ctest_path}"`, test_args, {
                cwd: entry.source_dir,
                ignoreReturnCode: true
            });
            if (entry.create_annotations) {
                createCMakeTestAnnotations(stdout, entry);
            }
            if (exitCode !== 0 && entry.run_tests === true) {
                throw new Error(`CMake tests failed with exit code ${exitCode}`);
            }
        }
        core.endGroup();
    }

    // ==============================================
    // Install step
    // ==============================================
    // Run install if: install is enabled AND (install_all_cxxstd OR this is the main entry)
    const shouldInstall = entry.install !== false && (entry.install_all_cxxstd || entry.is_main_entry);
    if (shouldInstall) {
        core.startGroup(`🚚 Install (${factorDesc})`);
        {
            const std_build_dir = entry.build_dir;
            const std_install_dir = entry.install_prefix;

            // Ensure install_dir exists
            await io.mkdirP(std_install_dir);

            /*
                Install parameters
             */
            const install_args: string[] = [];
            if (setupCMakeOutputs.supports_cmake_install) {
                install_args.push('--install');
            } else {
                install_args.push('--build');
            }
            install_args.push(std_build_dir);
            if (entry.build_type && generator_is_multi_config) {
                install_args.push('--config');
                install_args.push(entry.build_type || 'Release');
            }
            if (setupCMakeOutputs.supports_cmake_install) {
                if (entry.install_prefix) {
                    install_args.push('--prefix');
                    install_args.push(std_install_dir);
                }
            } else {
                install_args.push('--target');
                install_args.push('install');
            }

            /*
                Run
             */
            core.info(`💻 ${entry.source_dir}> ${entry.cmake_path} ${makeArgsString(install_args)}`);
            const { exitCode: exitCode } = await exec.getExecOutput(`"${entry.cmake_path}"`, install_args, {
                cwd: entry.source_dir,
                ignoreReturnCode: true
            });
            if (exitCode !== 0 && entry.install === true) {
                throw new Error(`CMake install failed with exit code ${exitCode}`);
            }
        }
        core.endGroup();
    }

    // ==============================================
    // Package step
    // ==============================================
    // Run package if: package is enabled AND (package_all_cxxstd OR this is the main entry)
    const shouldPackage = entry.package && (entry.package_all_cxxstd || entry.is_main_entry);
    if (shouldPackage) {
        core.startGroup(`📦 Package (${factorDesc})`);

        /*
            Determine cpack generators
         */
        let use_default_generators = false;
        let package_generators = entry.package_generators;
        if (package_generators.length === 0) {
            fnlog(`No package generators specified. Using available generators.`);
            // Run something equivalent to
            // generators=$("${{ steps.params.outputs.cpack_path }}" --help | awk '/Generators/ {flag=1; next} flag && NF {print $1}' ORS=';' | sed 's/;$//')
            // to find the line where the list of generators starts, and then
            // get each generator from the following lines until a blank line.
            // The output of each of these lines is something like:
            //   7Z                           = 7-Zip file format
            const { stdout } = await exec.getExecOutput(`"${cpack_path}"`, ['--help'], {
                silent: true,
                ignoreReturnCode: true
            });
            const available_generators: string[] = [];
            let collecting_generators = false;
            for (const line of stdout.split(/\r?\n/)) {
                if (!collecting_generators) {
                    collecting_generators = line.trim() === 'Generators';
                } else {
                    if (line.trim() === '') {
                        break;
                    }
                    const parts = line.split('=');
                    if (parts.length !== 2) {
                        break;
                    }
                    available_generators.push(parts[0].trim());
                }
            }
            core.info(`🔄 Available CPack generators: ${available_generators.join(';')}`);
            package_generators = available_generators;
            use_default_generators = true;
        } else {
            fnlog(`Using specified package generators: ${package_generators.join(';')}`);
        }

        const std_build_dir = entry.build_dir;
        const package_files: string[] = [];

        // Internal loop over package generators (not a combinatorial factor)
        for (const package_generator of package_generators) {
            core.info(`⚙️ Generating package with generator "${package_generator}"`);
            const cpack_args: string[] = ['-G', package_generator];
            if (entry.build_type && generator_is_multi_config) {
                cpack_args.push('-C');
                cpack_args.push(entry.build_type || 'Release');
            }
            if (trace_commands.enabled()) {
                cpack_args.push('--verbose');
            }
            if (entry.package_name) {
                cpack_args.push('-P');
                cpack_args.push(entry.package_name);
            }
            if (entry.package_dir) {
                cpack_args.push('-B');
                cpack_args.push(entry.package_dir);
            }
            if (entry.package_vendor) {
                cpack_args.push('--vendor');
                cpack_args.push(entry.package_vendor);
            }
            /*
                Run
             */
            core.info(`💻 ${std_build_dir}> ${cpack_path} ${makeArgsString(cpack_args)}`);
            const { exitCode: exitCode, stdout } = await exec.getExecOutput(`"${cpack_path}"`, cpack_args, {
                cwd: std_build_dir,
                ignoreReturnCode: true
            });
            if (exitCode !== 0) {
                fnlog(`package: ${entry.package}`);
                fnlog(`use_default_generators: ${use_default_generators}`);
                const msg = `CPack (generator: ${package_generator}) failed with exit code ${exitCode}`;
                if (!use_default_generators) {
                    throw new Error(msg);
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
                    package_files.push(packagePath);
                    break;
                }
            }
        }
        core.endGroup();

        if (package_files.length !== 0 && entry.package_artifact) {
            core.startGroup(`⬆️ Upload package artifacts`);
            /*
                Generate artifacts
             */
            core.info(`📦 Package files: ${package_files.join(',')}`);

            // Determine the common prefix of the basenames of these files
            // to use as the artifact
            let common_prefix = '';
            for (const package_file of package_files) {
                if (common_prefix === '') {
                    common_prefix = package_file;
                } else {
                    let i = 0;
                    for (; i < common_prefix.length && i < package_file.length; i++) {
                        if (common_prefix[i] !== package_file[i]) {
                            break;
                        }
                    }
                    common_prefix = common_prefix.substring(0, i);
                }
            }
            fnlog(`Common package prefix: ${common_prefix}`);

            // Create a name for the artifact with all packages
            let artifact_name = path.basename(common_prefix) + '-';
            // Check if platform OS is Ubuntu
            if (artifact_name === 'linux' && fs.existsSync('/etc/os-release')) {
                const os_release = fs.readFileSync('/etc/os-release', 'utf8');
                if (os_release.includes('Ubuntu')) {
                    // Get ubuntu version
                    let ubuntu_version: string | undefined = undefined;
                    const regex = /VERSION_ID="(.*)"/;
                    const match = os_release.match(regex);
                    if (match) {
                        ubuntu_version = match[1];
                    }
                    if (!ubuntu_version) {
                        // Rely on lsb_release -rs
                        const { exitCode: exitCode, stdout } = await exec.getExecOutput('lsb_release', ['-rs'], {
                            ignoreReturnCode: true
                        });
                        if (exitCode === 0) {
                            artifact_name += stdout.trim();
                        }
                    }
                    if (!ubuntu_version) {
                        // Extract the Ubuntu version from /etc/lsb-release
                        const lsb_release = fs.readFileSync('/etc/lsb-release', 'utf8');
                        const regex = /DISTRIB_RELEASE=(.*)/;
                        const match = lsb_release.match(regex);
                        if (match) {
                            ubuntu_version = match[1].trim();
                        }
                    }
                    if (!ubuntu_version) {
                        // Extract Ubuntu version from uname -a
                        const { exitCode: exitCode, stdout } = await exec.getExecOutput('uname', ['-a'], {
                            ignoreReturnCode: true
                        });
                        if (exitCode === 0) {
                            const regex = /Ubuntu (.*)/;
                            const match = stdout.match(regex);
                            if (match) {
                                ubuntu_version = match[1].trim();
                            }
                        }
                    }
                    if (ubuntu_version) {
                        artifact_name += '-ubuntu-' + ubuntu_version;
                    }
                }
            } else {
                artifact_name += '-' + (process.env['RUNNER_OS'] || process.platform).toLowerCase();
            }

            // Add compiler to artifact name
            if (!entry.cxx && artifact_name === 'windows') {
                artifact_name += '-msvc';
            } else if (entry.cxx) {
                const cxx_basename = path.basename(entry.cxx);
                if (cxx_basename.startsWith('clang')) {
                    if (artifact_name !== 'windows') {
                        artifact_name += '-clang';
                    } else {
                        artifact_name += '-clang-cl';
                    }
                } else if (cxx_basename.startsWith('gcc') || cxx_basename.startsWith('g++')) {
                    if (artifact_name !== 'windows') {
                        artifact_name += '-gcc';
                    } else {
                        artifact_name += '-mingw';
                    }
                } else if (cxx_basename.startsWith('cl')) {
                    artifact_name += '-msvc';
                }
            }
            artifact_name += '-packages';
            fnlog(`Artifact name: ${artifact_name}`);
            fnlog(`Retention days: ${entry.package_retention_days}`);
            const packages_dir = path.dirname(common_prefix);
            fnlog(`Packages directory: ${packages_dir}`);
            const artifact = new DefaultArtifactClient();
            const { id, size } = await artifact.uploadArtifact(
                artifact_name,
                package_files,
                packages_dir,
                { retentionDays: entry.package_retention_days }
            );
            trace_commands.log(`Created artifact with id: ${id} (bytes: ${size}`);
            core.endGroup();
        }
    }
}

/**
 * GitHub Actions entry point for the CMake workflow action.
 *
 * Parses action inputs, expands combinatorial factors, and executes
 * the CMake workflow for each factor combination.
 */
async function run(): Promise<void> {
    // ==============================================
    // Parse inputs
    // ==============================================
    const inputs: Inputs = {
        // CMake
        cmake_path: gh_inputs.getInput('cmake-path'),
        cmake_version: gh_inputs.getInput('cmake-version', { defaultValue: '*' }),
        // Source project
        source_dir: gh_inputs.getResolvedPath('source-dir'),
        url: gh_inputs.getInput('url'),
        git_repository: gh_inputs.getInput('git-repository'),
        git_tag: gh_inputs.getInput('git-tag'),
        download_dir: gh_inputs.getNormalizedPath('download-dir'),
        patches: gh_inputs.getMultilineInput('patches'),
        // Configure options
        build_dir: gh_inputs.getNormalizedPath('build-dir'),
        preset: gh_inputs.getInput('preset') || '',
        cc: gh_inputs.getNormalizedPath('cc', { fallbackEnv: 'CC' }),
        ccflags: gh_inputs.getInput('ccflags', { fallbackEnv: 'CFLAGS' }),
        cxx: gh_inputs.getNormalizedPath('cxx', { fallbackEnv: 'CXX' }),
        cxxflags: gh_inputs.getInput('cxxflags', { fallbackEnv: 'CXXFLAGS' }),
        cxxstd: gh_inputs.getArray('cxxstd', undefined, undefined, { fallbackEnv: 'CXXSTD' }),
        shared: gh_inputs.getTribool('shared', { fallbackEnv: 'BUILD_SHARED_LIBS' }),
        toolchain: gh_inputs.getNormalizedPath('toolchain', { fallbackEnv: 'CMAKE_TOOLCHAIN_FILE' }),
        generator: gh_inputs.getInput('generator', { fallbackEnv: 'CMAKE_GENERATOR' }),
        generator_toolset: gh_inputs.getInput('generator-toolset', { fallbackEnv: 'CMAKE_GENERATOR_TOOLSET' }),
        generator_architecture: gh_inputs.getInput('generator-architecture', { fallbackEnv: 'CMAKE_GENERATOR_ARCHITECTURE' }),
        arch: gh_inputs.getInput('arch'),
        build_type: gh_inputs.getInput('build-type', { fallbackEnv: 'CMAKE_BUILD_TYPE' }),
        build_target: gh_inputs.getArray('build-target'),
        extra_args: parseExtraArgs(gh_inputs.getMultilineInput('extra-args')),
        export_compile_commands: gh_inputs.getTribool('export-compile-commands', { fallbackEnv: 'CMAKE_EXPORT_COMPILE_COMMANDS' }),
        // Build options
        jobs: gh_inputs.getInt('jobs', { fallbackEnv: 'CMAKE_JOBS' }) ?? numberOfCpus(),
        // Test options
        run_tests: gh_inputs.getTribool('run-tests', { fallbackEnv: 'CMAKE_RUN_TESTS' }),
        configure_tests_flag: gh_inputs.getInput('configure-tests-flag'),
        test_all_cxxstd: gh_inputs.getBoolean('test-all-cxxstd'),
        ctest_timeout: gh_inputs.getInt('ctest-timeout', { fallbackEnv: 'CTEST_TEST_TIMEOUT' }),
        // Install
        install: gh_inputs.getTribool('install', { fallbackEnv: 'CMAKE_INSTALL' }),
        install_all_cxxstd: gh_inputs.getTribool('install-all-cxxstd'),
        install_prefix: gh_inputs.getNormalizedPath('install-prefix', { fallbackEnv: 'CMAKE_INSTALL_PREFIX' }),
        // Package
        package: gh_inputs.getTribool('package', { fallbackEnv: 'CMAKE_PACKAGE' }),
        package_all_cxxstd: gh_inputs.getBoolean('package-all-cxxstd'),
        package_name: gh_inputs.getInput('package-name'),
        package_dir: gh_inputs.getNormalizedPath('package-dir'),
        package_vendor: gh_inputs.getInput('package-vendor'),
        package_generators: gh_inputs.getArray('package-generators', undefined, undefined, { fallbackEnv: 'CPACK_GENERATOR' }),
        package_artifact: gh_inputs.getTribool('package-artifact', {
            fallbackEnv: 'CMAKE_PACKAGE_ARTIFACT',
            defaultValue: true
        }),
        package_retention_days: gh_inputs.getInt('package-retention-days') ?? 10,
        // Annotations and tracing
        create_annotations: gh_inputs.getTribool('create-annotations', {
            fallbackEnv: 'CMAKE_CREATE_ANNOTATIONS',
            defaultValue: true
        }),
        ref_source_dir: gh_inputs.getResolvedPath('ref-source-dir', { fallbackEnv: 'GITHUB_WORKSPACE' }),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }
    inputs.arch = normalizeArchitectureInput(inputs.arch);

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    // ==============================================
    // Download source code (once)
    // ==============================================
    if (inputs.url || inputs.git_repository) {
        core.startGroup(`🌎 Download source code`);
        await downloadSourceCode(inputs);
        core.endGroup();
    }

    // ==============================================
    // Apply patches (once)
    // ==============================================
    if (inputs.patches.length > 0) {
        core.startGroup(`🩹 Apply patches`);
        await applyPatches(inputs);
        core.endGroup();
    }

    // ==============================================
    // Setup CMake (once)
    // ==============================================
    core.startGroup(`🔎 Setup CMake`);
    const setupCMakeOutputs: SetupCMakeOutputs = await setup_cmake.main({
        trace_commands: trace_commands,
        version: inputs.cmake_version,
        cmake_file: path.resolve(inputs.source_dir, 'CMakeLists.txt'),
        path: inputs.cmake_path,
        cmake_path: 'cmake',
        cache: false,
        check_latest: false,
        update_environment: false
    }, false);
    if (!setupCMakeOutputs.path) {
        throw new Error('❌ CMake not found');
    }
    inputs.cmake_path = setupCMakeOutputs.path;
    core.endGroup();

    // ==============================================
    // Resolve parameters (once)
    // ==============================================
    core.startGroup(`🎛️ CMake parameters`);
    const resolvedParams = await resolveInputParameters(inputs, setupCMakeOutputs);
    core.endGroup();

    // ==============================================
    // Expand combinatorial factors
    // ==============================================
    core.startGroup(`🔢 Expand factor combinations`);
    const entries = expandInputs(inputs);
    validateUniquePaths(entries);
    core.info(`📊 Expanded to ${entries.length} factor combination(s)`);
    for (const entry of entries) {
        const desc = makeFactorDescription(entry);
        core.info(`  • ${desc}: build_dir=${entry.build_dir}`);
    }
    core.endGroup();

    // ==============================================
    // Process each entry
    // ==============================================
    for (const entry of entries) {
        const desc = makeFactorDescription(entry);
        core.startGroup(`🧩 Processing: ${desc}`);
        await processEntry(entry, setupCMakeOutputs, resolvedParams);
        core.endGroup();
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
            title: 'CMake workflow failed'
            });
        }
    })();
}

export {
    processEntry,
    expandInputs as _expandInputs,
    validateUniquePaths as _validateUniquePaths,
    resolveInputParameters as _resolveInputParameters,
    normalizePath as _normalizePathForCMake,
    deriveGeneratorArchitectureFromArch as _deriveGeneratorArchitectureFromArch,
    normalizeArchitectureInput as _normalizeArchitectureInput,
    applyPatches as _applyPatches
};
