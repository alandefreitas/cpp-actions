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
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

// Type imports
import { Inputs, MainOutputs } from './types';

// Module imports
import { clangDownloadCandidates, install_program_from_clang_urls } from './download';
import { installCompanionPackages } from './companion-packages';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

/**
 * Removes "clang-" or "clang++-" prefixes from a version string.
 *
 * @param version - Version string potentially prefixed with clang- or clang++-
 * @returns Cleaned version string without the prefix
 */
function removeClangPrefix(version: string): string {
    // Remove "clang-" or "clang++-" prefix
    if (version.startsWith('clang-') || version.startsWith('clang++-')) {
        version = version.replace('clang-', '').replace('clang++-', '');
    }

    // Remove "clang " or "clang++ " prefix
    if (version.startsWith('clang ') || version.startsWith('clang++ ')) {
        version = version.replace('clang ', '').replace('clang++ ', '');
    }

    return version;
}

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
 * @param check_latest - If true, checks for the latest available version matching
 *                       the version constraint
 * @param update_environment - If true, updates PATH and environment variables to
 *                             make the compiler available for subsequent steps
 * @returns Object containing paths to clang/clang++, version info, and environment changes
 */
export async function main(
    version: string,
    paths: string[],
    check_latest: boolean,
    update_environment: boolean
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
    let output_path: string | null = null;
    let output_version: string | null = null;
    let installed_apt_package: string | null = null;

    // Setup path program
    if (paths.length > 0) {
        core.startGroup('🔍 Find clang in specified paths');
        core.info(`Searching for Clang ${version} in paths [${paths.join(',')}]`);
        const result = await setup_program.find_program_in_path(paths, version, check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup system program
    if (!output_path) {
        core.startGroup('📁 Find clang in system paths');
        core.info(`Searching for Clang ${version} in PATH`);
        trace_commands.log(`Arguments: ${paths}, ['clang++'], ${version}, ${check_latest}`);
        const result = await setup_program.find_program_in_system_paths(
            paths,
            ['clang++'],
            version,
            check_latest
        );
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup APT program
    if (!output_version && process.platform === 'linux') {
        core.startGroup('📦 Find clang with APT');
        core.info(`Searching for Clang ${version} with APT`);

        // Add repositories for major clang versions
        const allVersionMajors = allVersions
            .filter((v) => semver.satisfies(v, version))
            .map((v) => semver.parse(v)?.major)
            .filter((value): value is number => value !== undefined && value >= 10)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort((a, b) => b - a);
        trace_commands.log(`All version major candidates: [${allVersionMajors.join(', ')}]`);

        const ubuntuName = setup_program.getCurrentUbuntuName() as string | null;
        trace_commands.log(`Ubuntu version name: ${ubuntuName}`);
        trace_commands.log(`allVersionMajors.length: ${allVersionMajors.length}`);
        if (ubuntuName !== null && allVersionMajors.length !== 0) {
            core.info(
                `Adding APT repositories for Clang ${version} major versions [${allVersionMajors.join(', ')}]`
            );

            // Adding a key requires gnupg
            await setup_program.find_program_with_apt(['gnupg'], '*', true);

            // Download repo key
            const gpg_key_url = 'https://apt.llvm.org/llvm-snapshot.gpg.key';
            const keyPath = await tc.downloadTool(gpg_key_url);
            if (setup_program.isSudoRequired()) {
                await setup_program.ensureSudoIsAvailable();
                await exec.exec(`sudo -n sudo apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            } else {
                await exec.exec(`apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            }

            // add-apt-repository requires installing software-properties-common
            await setup_program.find_program_with_apt(['software-properties-common'], '*', true);
            let add_apt_repository_path: string | null = null;
            try {
                add_apt_repository_path = await io.which('add-apt-repository');
                trace_commands.log(`add-apt-repository found at ${add_apt_repository_path}`);
            } catch {
                add_apt_repository_path = null;
            }

            // Add APT repositories
            if (add_apt_repository_path !== null && add_apt_repository_path !== '') {
                for (const major of allVersionMajors) {
                    const ReleaseFileURL = `https://apt.llvm.org/${ubuntuName}/dists/llvm-toolchain-${ubuntuName}-${major}/Release`;
                    trace_commands.log(`Checking if ${ReleaseFileURL} exists`);
                    if (!(await setup_program.urlExists(ReleaseFileURL))) {
                        trace_commands.log(
                            `Skipping repository for major version ${major} because ${ReleaseFileURL} does not exist`
                        );
                        continue;
                    }
                    await setup_program.ensureAddAptRepositoryIsAvailable();
                    const repo = `deb https://apt.llvm.org/${ubuntuName}/ llvm-toolchain-${ubuntuName}-${major} main`;
                    trace_commands.log(`Adding repository "${repo}"`);
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
        const result = await setup_program.find_program_with_apt(['clang'], version, check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        installed_apt_package = result.installed_package ?? null;
        core.endGroup();
    } else {
        if (output_version !== null) {
            trace_commands.log(
                `Skipping APT step because Clang ${output_version} was already found in ${output_path}`
            );
        } else if (process.platform !== 'linux') {
            trace_commands.log(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // If output_version === null, and it gets installed at all, it will be installed from a URL
    const will_install_from_url = output_version === null;
    if (output_version === null) {
        core.startGroup('⬇️ Download clang');
        const { version_candidates, ubuntu_versions } = clangDownloadCandidates(
            version,
            allVersions,
            check_latest
        );
        const result = await install_program_from_clang_urls(
            ubuntu_versions,
            version_candidates,
            version,
            check_latest,
            update_environment,
            output_version,
            output_path
        );
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    } else {
        trace_commands.log(
            `Skipping download step because Clang ${output_version} was already found in ${output_path}`
        );
    }

    // Install companion packages for tool parity (llvm-symbolizer, sanitizer runtimes)
    let symbolizer_path: string | null = null;
    if (output_version) {
        core.startGroup('🔧 Install companion packages');
        const companionResult = await installCompanionPackages(output_version, installed_apt_package, will_install_from_url);
        symbolizer_path = companionResult.symbolizerPath;
        core.endGroup();

        // Set sanitizer symbolizer environment variables if symbolizer was found
        if (symbolizer_path && update_environment) {
            core.info(`Setting sanitizer symbolizer path to ${symbolizer_path}`);
            core.exportVariable('ASAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('MSAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('TSAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('UBSAN_SYMBOLIZER_PATH', symbolizer_path);
        }
    }

    // Create outputs
    let cc: string | null = output_path;
    let cxx: string | null = output_path;
    let bindir = '';
    let dir = '';
    let release = '0.0.0';
    let version_major = 0;
    let version_minor = 0;
    let version_patch = 0;

    if (output_path) {
        const path_basename = path.basename(output_path);
        if (path_basename.startsWith('clang++')) {
            cc = path.join(path.dirname(output_path), path_basename.replace('clang++', 'clang'));
        } else if (path_basename.startsWith('clang')) {
            cxx = path.join(path.dirname(output_path), path_basename.replace('clang', 'clang++'));
        }

        if (cc && !fs.existsSync(cc)) {
            trace_commands.log(`Could not find ${cc}, using ${output_path} as cc instead`);
            cc = output_path;
        }

        if (cxx && !fs.existsSync(cxx)) {
            trace_commands.log(`Could not find ${cxx}, using ${output_path} as cxx instead`);
            cxx = output_path;
        }

        const semverV =
            output_version !== null
                ? semver.parse(output_version, { loose: true })
                : semver.parse('0.0.0', { loose: true });

        if (semverV) {
            release = semverV.toString();
            version_major = semverV.major;
            version_minor = semverV.minor;
            version_patch = semverV.patch;
        }

        bindir = path.dirname(output_path);
        if (update_environment) {
            core.addPath(bindir);
        }
        dir = path.dirname(bindir);

        if (will_install_from_url) {
            // If it's installed from the url, we need to add the lib dirs to LD_LIBRARY_PATH,
            // or it won't be able to find the default shared libraries
            let LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
            let LD_LIBRARY_PATHS: string[] = [];
            if (LD_LIBRARY_PATH !== null && LD_LIBRARY_PATH !== undefined) {
                LD_LIBRARY_PATHS = LD_LIBRARY_PATH.split(':').filter((x) => x !== '');
            }
            const lib_dirs = [path.join(dir, 'lib')];
            for (const lib_dir of lib_dirs) {
                if (fs.existsSync(lib_dir)) {
                    if (!LD_LIBRARY_PATHS.includes(lib_dir)) {
                        trace_commands.log(`Adding ${lib_dir} to LD_LIBRARY_PATH`);
                        LD_LIBRARY_PATHS.push(lib_dir);
                    } else {
                        trace_commands.log(`Skipping ${lib_dir} because it is already in LD_LIBRARY_PATH`);
                    }
                } else {
                    trace_commands.log(`Skipping ${lib_dir} because it does not exist`);
                }
            }
            LD_LIBRARY_PATH = LD_LIBRARY_PATHS.join(':');
            if (LD_LIBRARY_PATH !== process.env.LD_LIBRARY_PATH) {
                trace_commands.log(`Setting LD_LIBRARY_PATH to ${LD_LIBRARY_PATH}`);
                core.exportVariable('LD_LIBRARY_PATH', LD_LIBRARY_PATH);
            }
        }
    }
    return {
        output_path,
        cc,
        cxx,
        bindir,
        dir,
        version: release,
        version_major,
        version_minor,
        version_patch,
        symbolizer_path
    };
}

let lastInputsForErrors: Inputs | undefined = undefined;

/**
 * Main entry point for the setup-clang GitHub Action.
 *
 * Parses inputs and sets up the Clang compiler environment.
 */
async function run(): Promise<void> {
    const inputs: Inputs = {
        version: removeClangPrefix(gh_inputs.getInput('version', { defaultValue: '*' })),
        path: gh_inputs.getArray('path', /[:;]/),
        check_latest: gh_inputs.getBoolean('check-latest'),
        update_environment: gh_inputs.getBoolean('update-environment'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    lastInputsForErrors = inputs;

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs.version, inputs.path, inputs.check_latest, inputs.update_environment);

    // Parse Final program / Setup version / Outputs
    if (outputs.output_path) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot setup Clang');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            const capturedInputs = lastInputsForErrors as Inputs | undefined;
            const hint = capturedInputs?.trace_commands
                ? 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
                : 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            await reportAndSetFailed(error as Error, {
                title: 'Setup Clang failed',
                hint
            });
        }
    })();
}
