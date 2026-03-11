import * as core from '@actions/core';
import * as io from '@actions/io';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as httpm from '@actions/http-client';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import * as setup_program from 'setup-program';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Re-export removeGCCPrefix for external use
export { removeGCCPrefix } from './schema';

// Type imports and re-exports
import { type Inputs, type MainOutputs, type ProgramResult } from './types';
export type { Inputs, MainOutputs, ProgramResult };

/**
 * Sets up GCC compiler on the runner with the specified version.
 *
 * This function locates or installs GCC with the requested version, searching
 * the provided paths first, then falling back to apt-get installation on Linux.
 * It can optionally update environment variables to make the compiler available.
 *
 * @param version - The GCC version to set up (e.g., "10", "10.2", ">=10"). Supports
 *                  semver ranges for flexible version matching.
 * @param paths - Array of paths to search for existing GCC installations before
 *                attempting installation
 * @param checkLatest - If true, checks for the latest available version matching
 *                       the version constraint
 * @param updateEnvironment - If true, updates PATH and environment variables to
 *                             make the compiler available for subsequent steps
 * @returns Object containing paths to gcc/g++, version info, and environment changes
 */
export async function main(
    version: string,
    paths: string[],
    checkLatest: boolean,
    updateEnvironment: boolean
): Promise<MainOutputs> {
    core.startGroup('🔎 Find GCC versions');
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }

    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux');
    }

    const allVersions: string[] = await setup_program.findGCCVersions();
    core.endGroup();

    // Path program version
    let outputPath: string | null = null;
    let outputVersion: string | null = null;

    // Setup path program
    core.startGroup('🔍 Find GCC in specified paths');
    core.info(`Searching for GCC ${version} in paths [${paths.join(',')}]`);
    const pathResult: ProgramResult = await setup_program.findProgramInPath(paths, version, checkLatest);
    outputVersion = pathResult.outputVersion;
    outputPath = pathResult.outputPath;
    core.endGroup();

    // Setup system program
    // Prefer g++ packages so libstdc++ headers come along, but keep gcc in the
    // search list so we still pick up preinstalled C-only toolchains.
    const names = ['g++', 'gcc'];
    if (outputPath === null) {
        core.startGroup('📁 Find GCC in system paths');
        core.info(`Searching for GCC ${version} in PATH`);
        const systemResult: ProgramResult = await setup_program.findProgramInSystemPaths(paths, names, version, checkLatest);
        outputVersion = systemResult.outputVersion;
        outputPath = systemResult.outputPath;
        core.endGroup();
    }

    // Setup APT program
    if (outputVersion === null && process.platform === 'linux') {
        core.startGroup('📦 Find GCC with APT');
        core.info(`Searching for GCC ${version} with APT`);

        // Add APT repository
        await setup_program.findProgramWithApt(['software-properties-common'], '*', true);
        let addAptRepositoryPath: string | null = null;
        try {
            addAptRepositoryPath = await io.which('add-apt-repository');
            traceCommands.log(`add-apt-repository found at ${addAptRepositoryPath}`);
        } catch {
            addAptRepositoryPath = null;
        }
        if (addAptRepositoryPath !== null && addAptRepositoryPath !== '') {
            const repo = `ppa:ubuntu-toolchain-r/ppa`;
            traceCommands.log(`Adding repository "${repo}"`);
            if (setup_program.isSudoRequired()) {
                await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
            } else {
                await exec.exec(`add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
            }
        }

        const aptResult: ProgramResult = await setup_program.findProgramWithApt(names, version, checkLatest);
        outputVersion = aptResult.outputVersion;
        outputPath = aptResult.outputPath;
        core.endGroup();
    } else {
        if (outputVersion !== null) {
            traceCommands.log(`Skipping APT step because GCC ${outputVersion} was already found in ${outputPath}`);
        } else if (process.platform !== 'linux') {
            traceCommands.log(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // Install program from a valid URL
    if (outputVersion === null) {
        core.startGroup('⬇️ Download GCC from release binaries');
        core.info(`Fetching GCC ${version} from release binaries`);
        // Determine the release to install and version candidates to fallback to
        traceCommands.log('All GCC versions: ' + allVersions);
        const maxV = semver.maxSatisfying(allVersions, version);
        traceCommands.log(`Max version in requirement "${version}": ` + maxV);
        const minV = semver.minSatisfying(allVersions, version);
        traceCommands.log(`Min version in requirement "${version}": ` + minV);
        const release = checkLatest ? maxV : minV;
        traceCommands.log(`Target release ${release} (check latest: ${checkLatest})`);
        const semverRelease = semver.parse(release);
        if (semverRelease) {
            traceCommands.log(`Parsed release "${release}" is "${semverRelease.toString()}"`);
            const major = semverRelease.major;
            const minor = semverRelease.minor;
            const patch = semverRelease.patch;
            const versionCandidates: string[] = [release!];
            for (const v of allVersions) {
                const sv = semver.parse(v);
                if (sv && sv.major === major && sv.minor === minor && sv.patch !== patch) {
                    versionCandidates.push(v);
                }
            }
            for (const v of allVersions) {
                const sv = semver.parse(v);
                if (sv && sv.major === major && sv.minor !== minor) {
                    versionCandidates.push(v);
                }
            }
            traceCommands.log(`Version candidates: [${versionCandidates.join(', ')}]`);

            // Determine ubuntu version
            const curUbuntuVersion = setup_program.getCurrentUbuntuVersion();
            traceCommands.log(`Ubuntu version: ${curUbuntuVersion}`);
            let ubuntuVersions: string[];
            if (curUbuntuVersion === '20.04') {
                ubuntuVersions = ['20.04', '22.04', '18.04', '16.04', '14.04', '12.04', '10.04'];
            } else if (curUbuntuVersion === '18.04') {
                ubuntuVersions = ['18.04', '20.04', '16.04', '22.04', '14.04', '12.04', '10.04'];
            } else if (curUbuntuVersion === '16.04') {
                ubuntuVersions = ['16.04', '18.04', '14.04', '20.04', '12.04', '22.04', '10.04'];
            } else if (curUbuntuVersion === '12.04') {
                ubuntuVersions = ['12.04', '14.04', '10.04', '16.04', '18.04', '20.04', '22.04'];
            } else if (curUbuntuVersion === '10.04') {
                ubuntuVersions = ['10.04', '12.04', '14.04', '16.04', '18.04', '20.04', '22.04'];
            } else {
                ubuntuVersions = ['22.04', '20.04', '18.04', '16.04', '14.04', '12.04', '10.04'];
            }
            traceCommands.log(`Ubuntu version binaries: [${ubuntuVersions.join(', ')}]`);

            // Try URLs considering ubuntu versions
            const httpClient = new httpm.HttpClient('setup-gcc', [], {
                allowRetries: true, maxRetries: 3
            });

            for (const ubuntuVersion of ubuntuVersions) {
                for (const versionCandidate of versionCandidates) {
                    traceCommands.log(`Trying to fetch GCC ${versionCandidate} for Ubuntu ${ubuntuVersion}`);
                    const ubuntuImage = `ubuntu-${ubuntuVersion}`;
                    traceCommands.log(`Ubuntu image: ${ubuntuImage}`);
                    const gccBasename = `gcc-${versionCandidate}-x86_64-linux-gnu-${ubuntuImage}`;
                    traceCommands.log(`GCC basename: ${gccBasename}`);
                    const gccFilename = `${gccBasename}.tar.gz`;
                    traceCommands.log(`GCC filename: ${gccFilename}`);
                    const gccUrl = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gccFilename}`;
                    const res = await httpClient.head(gccUrl);
                    if (res.message.statusCode !== 200) {
                        traceCommands.log(`Skipping ${gccUrl} because it does not exist`);
                        continue;
                    }
                    const urlResult: ProgramResult = await setup_program.installProgramFromUrl(['gcc'], version, checkLatest, gccUrl, updateEnvironment, '/usr/local');
                    outputVersion = urlResult.outputVersion;
                    outputPath = urlResult.outputPath;
                    if (outputVersion !== null) {
                        break;
                    }
                }
                if (outputVersion !== null) {
                    break;
                }
            }

            if (outputVersion === null) {
                // Find a URL for binaries (no ubuntu version)
                for (const versionCandidate of versionCandidates) {
                    traceCommands.log(`Trying to fetch GCC ${versionCandidate} for Linux`);
                    const gccBasename = `gcc-${versionCandidate}-Linux-x86_64`;
                    traceCommands.log(`GCC basename: ${gccBasename}`);
                    const gccFilename = `${gccBasename}.tar.gz`;
                    traceCommands.log(`GCC filename: ${gccFilename}`);
                    const gccUrl = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gccFilename}`;
                    const res = await httpClient.head(gccUrl);
                    if (res.message.statusCode !== 200) {
                        traceCommands.log(`Skipping ${gccUrl} because it does not exist`);
                        continue;
                    }
                    const urlResult: ProgramResult = await setup_program.installProgramFromUrl(['gcc'], version, checkLatest, gccUrl, updateEnvironment, '/usr/local');
                    outputVersion = urlResult.outputVersion;
                    outputPath = urlResult.outputPath;
                    if (outputVersion !== null) {
                        break;
                    }
                }
            }
        }
        core.endGroup();
    } else {
        if (outputVersion !== null) {
            traceCommands.log(`Skipping download step because GCC ${outputVersion} was already found in ${outputPath}`);
        }
    }

    // Create outputs
    core.startGroup('📤 Set outputs');
    let cc: string | null = outputPath;
    let cxx: string | null = outputPath;
    let bindir = '';
    let dir = '';
    let releaseStr = '0.0.0';
    let versionMajor = 0;
    let versionMinor = 0;
    let versionPatch = 0;
    if (outputPath !== null && outputPath !== undefined) {
        const pathBasename = path.basename(outputPath);
        if (pathBasename.startsWith('gcc')) {
            cxx = path.join(path.dirname(outputPath), pathBasename.replace('gcc', 'g++'));
        } else if (pathBasename.startsWith('g++')) {
            cc = path.join(path.dirname(outputPath), pathBasename.replace('g++', 'gcc'));
        }

        if (cc && !fs.existsSync(cc)) {
            traceCommands.log(`Could not find ${cc}, using ${outputPath} as cc instead`);
            cc = outputPath;
        }

        if (cxx && !fs.existsSync(cxx)) {
            traceCommands.log(`Could not find ${cxx}, using ${outputPath} as cxx instead`);
            cxx = outputPath;
        }

        // If we still don't have a working cxx (cc1plus missing), try installing the matching g++ package
        const cxxMissing = !cxx || !fs.existsSync(cxx);
        const cxxLooksLikeGcc = cxx ? /(?:^|\/|\b)gcc(?:-\d+)?$/.test(cxx) : false;
        if (process.platform === 'linux' && (cxxMissing || cxxLooksLikeGcc)) {
            try {
                const parsed = outputVersion ? semver.parse(outputVersion, { loose: true }) : null;
                const gccMajor = parsed?.major ?? null;
                const pkg = gccMajor ? `g++-${gccMajor}` : 'g++';
                traceCommands.log(`Attempting to install ${pkg} because g++ for ${outputVersion} was not found`);
                const installArgs = ['install', '-y', pkg];
                const opts = { env: { DEBIAN_FRONTEND: 'noninteractive', TZ: 'Etc/UTC' }, ignoreReturnCode: true };
                if (setup_program.isSudoRequired()) {
                    await exec.exec('sudo', ['-n', 'apt-get', 'update'], opts);
                    await exec.exec('sudo', ['-n', 'apt-get', ...installArgs], opts);
                } else {
                    await exec.exec('apt-get', ['update'], opts);
                    await exec.exec('apt-get', installArgs, opts);
                }
                const guessed = gccMajor ? `/usr/bin/g++-${gccMajor}` : await io.which('g++', false).catch(() => null);
                if (guessed && fs.existsSync(guessed)) {
                    cxx = guessed;
                    traceCommands.log(`Using ${cxx} as C++ compiler`);
                }
            } catch (err) {
                traceCommands.log(`Unable to auto-install g++: ${(err as Error).message}`);
            }
        }

        bindir = path.dirname(outputPath);
        if (updateEnvironment) {
            core.addPath(bindir);
        }
        dir = path.dirname(bindir);

        const semverV = outputVersion !== null
            ? semver.parse(outputVersion, { loose: true })
            : semver.parse('0.0.0', { loose: true });
        if (semverV) {
            releaseStr = semverV.toString();
            versionMajor = semverV.major;
            versionMinor = semverV.minor;
            versionPatch = semverV.patch;
        }
    }
    core.endGroup();
    return { outputPath, cc, cxx, bindir, dir, version: releaseStr, versionMajor, versionMinor, versionPatch };
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
    title: 'Setup GCC',
    main: async (inputs: Inputs) => {
        const outputs = await main(
            inputs.version,
            inputs.path,
            inputs.checkLatest,
            inputs.updateEnvironment
        );

        // Validate that GCC was found
        if (!outputs.outputPath) {
            core.setFailed('Cannot setup GCC');
        }

        return outputs;
    },
    callerModule: module
});
