import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

interface Inputs {
    version: string;
    architecture: string;
    cmake_file: string;
    path: string;
    cmake_path: string;
    cache: boolean;
    check_latest: boolean;
    update_environment: boolean;
    trace_commands: boolean;
}

interface Outputs {
    path: string;
    dir: string;
    version: string;
    version_major: number;
    version_minor: number;
    version_patch: number;
    cache_hit: boolean;
    supports_path_to_build: boolean;
    supports_parallel_build: boolean;
    supports_build_multiple_targets: boolean;
    supports_cmake_install: boolean;
    supported_presets_version: number;
}

interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
}

function updateCMakeVersionFromFile(cmake_file: string, version: string, allVersions: string[]): string {
    function fnlog(msg: string): void {
        trace_commands.log('updateCMakeVersionFromFile: ' + msg);
    }

    if (!cmake_file) {
        fnlog('No CMake file specified');
        return version;
    }

    // Check if cmake_file exists
    let cmake_file_path = path.resolve(process.cwd(), cmake_file);
    fnlog(`cmake_file: ${cmake_file} resolved to ${cmake_file_path}`);
    if (!fs.existsSync(cmake_file_path)) {
        fnlog(`CMake file ${cmake_file_path} does not exist`);
        return version;
    }

    if (fs.lstatSync(cmake_file_path).isDirectory()) {
        fnlog(`CMake file ${cmake_file_path} is a directory`);
        cmake_file_path = path.join(cmake_file_path, 'CMakeLists.txt');
        if (!fs.existsSync(cmake_file_path)) {
            fnlog(`CMake file ${cmake_file_path} also does not exist`);
            return version;
        }
        return updateCMakeVersionFromFile(cmake_file_path, version, allVersions);
    }

    // Read cmake_file
    fnlog(`Reading Cmake file ${cmake_file_path}`);
    const cmake_file_content = fs.readFileSync(cmake_file_path, 'utf8');

    // Extract requirement from CMakeLists.txt
    // cmake_minimum_required(VERSION <min>[...<policy_max>] [FATAL_ERROR])
    const regex = /\s*cmake_minimum_required\(VERSION\s+(\d+(\.\d+)?)(?:\s*\.\.\.\s*(\d+(\.\d+)?))?\s*(?:FATAL_ERROR)?\)/;
    let cmake_file_requirement: string | undefined;
    const match = cmake_file_content.match(regex);
    if (match) {
        fnlog(`Matched: ${match[0]}`);
        cmake_file_requirement = match[1];
        fnlog(`CMake file requirement: ${cmake_file_requirement}`);
    }

    if (!cmake_file_requirement) {
        fnlog(`Could not find CMake file requirement in ${cmake_file_path}`);
        fnlog(`File contents: ${cmake_file_content}`);
        return version;
    }

    // Merge version requirements
    try {
        const semverSV = semver.coerce(cmake_file_requirement);
        if (semverSV !== null) {
            cmake_file_requirement = '>=' + semverSV.toString();
            fnlog(`Coerced cMake file requirement: ${cmake_file_requirement}`);
            if (!version || version === '*') {
                version = cmake_file_requirement;
            } else if (semver.intersects(version, cmake_file_requirement)) {
                // If ranges don't intersect, `version` has priority
                // If the intersect, then we need to merge the ranges
                const matchingVersions = allVersions
                    .filter((v) =>
                        semver.satisfies(v, cmake_file_requirement!) && semver.satisfies(v, version));
                fnlog(`Matching versions: ${matchingVersions}`);
                if (!matchingVersions) {
                    fnlog(`No matching versions for ${cmake_file_requirement} and ${version}`);
                    fnlog(`Setting version requirement to ${version}`);
                    return version;
                } else {
                    // Create a range string from the matching versions
                    const mergedRange = matchingVersions.join(' || ');
                    const simplifiedRange = semver.simplifyRange(allVersions, mergedRange);
                    version = typeof simplifiedRange === 'string' ? simplifiedRange : simplifiedRange.toString();
                    fnlog(`Merged version requirement to ${version}`);
                }
            }
        }
    } catch (error) {
        fnlog(`Error parsing CMake file requirement ${cmake_file_requirement} as semver string: ${error}`);
    }

    return version;
}

function generateCMakeURL(version: string, architecture: string, fnlog: (msg: string) => void): string {
    const versionSV = semver.parse(version);
    if (!versionSV) {
        throw new Error(`Invalid version: ${version}`);
    }
    const { major, minor } = versionSV;

    // Determine path to download
    const system_os = (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    let url_os = system_os;
    // Put it in the same format as the GitHub Actions runner
    if (url_os === 'darwin') {
        url_os = 'macos';
    } else if (url_os === 'win32') {
        url_os = 'windows';
    } else {
        url_os = 'linux';
    }

    let url_arch = (architecture || process.env['RUNNER_ARCH'] || process.arch).toLowerCase();
    // Put it in the same format as the GitHub Actions runner (X86, X64, ARM, or ARM64)
    if (url_arch === 'ia32') {
        url_arch = 'x86';
    }

    // CMake 3.19.0 and below use a different URL format for OS
    if (semver.lte(version, '3.19.0')) {
        if (url_os === 'windows') {
            if (url_arch === 'x86') {
                url_os = 'win32';
            } else {
                url_os = 'win64';
            }
        } else if (url_os === 'linux') {
            url_os = 'Linux';
        } else if (url_os === 'macos' && semver.lte(version, '3.18.2')) {
            url_os = 'Darwin';
        }
    }

    // Arch URL format depends on OS
    if (url_os === 'windows') {
        url_arch = url_arch.startsWith('arm') ? 'arm64' : 'x86_64';
    } else if (url_os === 'win32') {
        url_arch = 'x86';
    } else if (url_os === 'win64') {
        url_arch = 'x64';
    } else if (url_os.toLowerCase() === 'linux') {
        url_arch = url_arch.startsWith('arm') ? 'aarch64' : 'x86_64';
    } else if (url_os === 'macos') {
        url_arch = 'universal';
    }

    // Form complete URL
    const url_extension = (system_os === 'windows') ? 'zip' : 'tar.gz';
    const cmake_basename = `cmake-${version}-${url_os}-${url_arch}`;
    const cmake_filename = `${cmake_basename}.${url_extension}`;
    const cmake_url = `https://cmake.org/files/v${major}.${minor}/${cmake_filename}`;
    fnlog(`CMake URL: ${cmake_url}`);
    return cmake_url;
}

function isDebianLike(osReleaseContents: string): boolean {
    const lower = osReleaseContents.toLowerCase();
    const idLike = lower.match(/^id_like=(.+)$/m);
    const idLine = lower.match(/^id=(.+)$/m);
    const tokens: string[] = [];
    if (idLike && idLike[1]) {
        tokens.push(...idLike[1].replace(/"/g, '').split(/\s+/));
    }
    if (idLine && idLine[1]) {
        tokens.push(...idLine[1].replace(/"/g, '').split(/\s+/));
    }
    return tokens.some((token) => token === 'debian' || token === 'ubuntu');
}

export async function ensureGit({ subgroups = true, fnlog = (): void => {} }: { subgroups?: boolean; fnlog?: (msg: string) => void } = {}): Promise<string | null> {
    const runnerOS = (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    let git_path: string | null = null;

    try {
        git_path = await io.which('git');
    } catch (error) {
        git_path = null;
    }

    if (git_path) {
        fnlog(`git already available at ${git_path}`);
        return git_path;
    }

    if (subgroups) {
        core.startGroup('🔧 Ensure git availability');
    }
    fnlog('git not found in PATH; attempting installation when supported');

    if (runnerOS !== 'linux') {
        core.info('git is missing and automatic installation is only attempted on Debian/Ubuntu runners; please pre-install git on this platform.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    let osRelease = '';
    try {
        osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    } catch (error) {
        fnlog('Unable to read /etc/os-release; skipping automatic git installation.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    if (!isDebianLike(osRelease)) {
        core.info('git is missing but runner is not Debian/Ubuntu; skipping automatic installation.');
        if (subgroups) {
            core.endGroup();
        }
        return null;
    }

    const aptBase = setup_program.isSudoRequired() ? ['sudo', '-n', 'apt-get'] : ['apt-get'];
    const execOpts = { ignoreReturnCode: true, silent: true };

    fnlog('Running apt-get update to refresh package metadata before installing git');
    const updateCode = await exec.exec(aptBase[0], [...aptBase.slice(1), 'update'], execOpts);
    if (updateCode !== 0) {
        core.info(`apt-get update returned exit code ${updateCode}; continuing to git install attempt`);
    }

    fnlog('Installing git via apt-get');
    const installCode = await exec.exec(aptBase[0], [...aptBase.slice(1), 'install', '-y', 'git'], execOpts);
    if (installCode !== 0) {
        core.info(`apt-get install git returned exit code ${installCode}; rechecking git presence`);
    }

    let gitAfterInstall: string | null = null;
    try {
        gitAfterInstall = await io.which('git');
    } catch (error) {
        gitAfterInstall = null;
    }

    if (subgroups) {
        core.endGroup();
    }

    if (!gitAfterInstall) {
        throw new Error('git is required to resolve CMake tags but could not be installed automatically');
    }

    fnlog(`git installed at ${gitAfterInstall}`);
    return gitAfterInstall;
}

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

let lastInputsForErrors: Inputs | undefined = undefined;

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

    lastInputsForErrors = inputs;

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
            const capturedInputs = lastInputsForErrors as Inputs | undefined;
            const hint = capturedInputs?.trace_commands
                ? 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
                : 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            await reportAndSetFailed(error as Error, {
                title: 'Setup CMake failed',
                hint,
                locals: () => ({ inputs: capturedInputs }),
                includeStackInSetFailed: true
            });
        }
    })();
}
