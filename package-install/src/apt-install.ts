/**
 * APT package installation logic.
 *
 * @module apt-install
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';

import { type Inputs } from './schema';
import { formatTime, semverGteLoose } from './utils';

import { isSudoRequired, importGpgKey, addAptSource } from './apt-utils';

/**
 * Builds a tool/args pair that prepends sudo when required.
 *
 * When sudo is needed, returns `{ tool: 'sudo', args: ['-n', ...command, ...args] }`.
 * When sudo is not needed, returns `{ tool: command, args }`.
 *
 * @param sudoRequired - Whether sudo is needed for this invocation
 * @param command - The command to run (e.g. 'apt-get', 'apt-add-repository')
 * @param args - Arguments to pass to the command
 * @param preserveEnv - Whether to add the -E flag to sudo (preserves environment)
 * @returns Object with `tool` and `args` suitable for exec.exec()
 */
function buildSudoCommand(sudoRequired: boolean, command: string, args: string[], preserveEnv = false): { tool: string; args: string[] } {
    if (sudoRequired) {
        const sudoArgs = preserveEnv ? ['-n', '-E', command, ...args] : ['-n', command, ...args];
        return { tool: 'sudo', args: sudoArgs };
    }
    return { tool: command, args };
}

/**
 * Installs apt sources, keys, and packages with retries and version-aware flags.
 *
 * Handles APT source key installation, repository addition, architecture
 * configuration, and package installation with retry logic.
 *
 * @param inputs - Configuration inputs for APT package installation
 * @throws Error if package installation fails and ignoreMissing is false
 */
export async function aptGetMain(inputs: Inputs): Promise<void> {
    const fnlog = traceCommands.scoped('aptGetMain');

    core.startGroup('🔍 Find apt-get');
    fnlog(`Check if apt-get is installed`);
    const aptGetPath = await io.which('apt-get', true);
    const sudoRequired = isSudoRequired();
    core.info(`🧩 apt-get-path: ${aptGetPath}`);
    core.info(`🧩 sudo-required: ${sudoRequired}`);

    core.endGroup();

    const aptEnv = {
        // set the DEBIAN_FRONTEND environment variable to
        // noninteractive so that the tzdata package
        // doesn't prompt for input
        DEBIAN_FRONTEND: 'noninteractive',
        TZ: 'Etc/UTC',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    };

    const importedKeyPaths: Map<number, string | null> = new Map();
    if (inputs.aptGetSourceKeys.length > 0) {
        core.startGroup('🔑 Install apt-get source keys');
        for (let keyIndex = 0; keyIndex < inputs.aptGetSourceKeys.length; keyIndex++) {
            const key = inputs.aptGetSourceKeys[keyIndex];
            const keyName = `source-key-${keyIndex}`;
            let retryTime = 2000;
            for (let i = 0; i < inputs.aptGetRetries; i++) {
                try {
                    core.info(`Import key ${key} as ${keyName}`);
                    const keyPath = await importGpgKey(key, keyName);
                    importedKeyPaths.set(keyIndex, keyPath);
                    break;
                } catch (error) {
                    if (i === inputs.aptGetRetries - 1) {
                        throw error;
                    }
                    core.info(`Failed to import key ${key}, retrying in ${formatTime(retryTime)}`);
                    await new Promise((resolve) => setTimeout(resolve, retryTime));
                    retryTime *= 2;
                }
            }
            if (!importedKeyPaths.has(keyIndex) && keyIndex >= inputs.aptGetSources.length) {
                core.info(`Key ${key} imported to keyrings (no paired source)`);
            }
        }
        core.endGroup();
    }

    if (inputs.aptGetSources.length > 0) {
        core.startGroup('🌐 Install apt-get sources');

        // Get the version of software-properties-common
        const {
            exitCode,
            stdout
        } = await exec.getExecOutput('dpkg-query', ['--showformat=${Version}', '--show', 'software-properties-common']);
        if (exitCode !== 0) {
            throw new Error('Failed to get the version of software-properties-common');
        }
        const softwarePropertiesCommonVersion = stdout.trim();

        // Identify features of apt-add-repository command and set initial args
        const aptAddRepoCommonArgs = semverGteLoose(softwarePropertiesCommonVersion, '0.96.24.20') ? ['-y', '-n'] : ['-y'];
        const aptAddRepoHasSourceArgs = semverGteLoose(softwarePropertiesCommonVersion, '0.98.10');

        // Iterate through each source and attempt to add it with retries
        for (let sourceIndex = 0; sourceIndex < inputs.aptGetSources.length; sourceIndex++) {
            const source = inputs.aptGetSources[sourceIndex];
            const pairedKeyPath = importedKeyPaths.get(sourceIndex);

            // If this source has a paired key, use addAptSource with signed-by injection
            if (pairedKeyPath) {
                core.info(`Adding source ${source} with signed-by=${pairedKeyPath}`);
                await addAptSource(source, pairedKeyPath, `source-${sourceIndex}`);
                continue;
            }

            // Otherwise fall back to apt-add-repository
            let retryTime = 2000;

            // Construct the arguments
            const aptAddRepoArgs = [...aptAddRepoCommonArgs];

            // Modify arguments based on source type
            if (aptAddRepoHasSourceArgs) {
                switch (true) {
                    case source.startsWith('ppa:'):
                        aptAddRepoArgs.push('-P');
                        break;
                    case source.startsWith('deb '):
                        aptAddRepoArgs.push('-S');
                        break;
                    default:
                        aptAddRepoArgs.push('-U');
                }
            }
            aptAddRepoArgs.push(source);

            const { tool, args } = buildSudoCommand(sudoRequired, 'apt-add-repository', aptAddRepoArgs, true);

            for (let i = 0; i < inputs.aptGetRetries; i++) {
                try {
                    // Execute the apt-add-repository command
                    const exitCode = await exec.exec(tool, args, {
                        ignoreReturnCode: i !== inputs.aptGetRetries - 1
                    });
                    if (exitCode === 0) {
                        core.info(`Added source ${source}`);
                        break;
                    }
                    if (i !== inputs.aptGetRetries - 1) {
                        core.info(`Failed to add source ${source}, retrying in ${formatTime(retryTime)}`);
                        await new Promise((resolve) => setTimeout(resolve, retryTime));
                        retryTime *= 2;
                    }
                } catch (error) {
                    console.error(`Failed to add repository: ${error}`);
                    await new Promise((resolve) => setTimeout(resolve, retryTime));
                    retryTime *= 2;
                }
            }
        }
        core.endGroup();
    }

    // Add architectures
    if (inputs.aptGetAddArchitecture.length > 0) {
        core.startGroup('📦 Add architectures');
        for (const arch of inputs.aptGetAddArchitecture) {
            const { tool, args } = buildSudoCommand(sudoRequired, 'dpkg', ['--add-architecture', arch]);
            await exec.exec(tool, args);
        }
        core.endGroup();
    }

    // Update apt-get
    core.startGroup('♻️ Update apt-get');
    const { tool: updateTool, args: updateArgs } = buildSudoCommand(sudoRequired, 'apt-get', ['-o', `Acquire::Retries=${inputs.aptGetRetries}`, 'update']);
    await exec.exec(updateTool, updateArgs);
    core.endGroup();

    // Install packages
    if (inputs.aptGetIgnoreMissing || !inputs.aptGetBulkInstall) {
        for (const pkg of inputs.apt_get) {
            core.startGroup('📦 Install apt-get package: ' + pkg);
            const pkgArgs = inputs.aptGetIgnoreMissing ?
                ['-o', 'Acquire::Retries=' + inputs.aptGetRetries, '--ignore-missing', 'install', '-y', pkg] :
                ['-o', 'Acquire::Retries=' + inputs.aptGetRetries, 'install', '-y', pkg];
            const { tool, args } = buildSudoCommand(sudoRequired, 'apt-get', pkgArgs);
            let retryTime = 2000;
            for (let i = 0; i < inputs.aptGetRetries; i++) {
                const exitCode = await exec.exec(tool, args, {
                    env: aptEnv,
                    ignoreReturnCode: i !== inputs.aptGetRetries - 1
                });
                if (exitCode === 0) {
                    break;
                }
                if (exitCode !== 0 && i === inputs.aptGetRetries - 1 && !inputs.aptGetIgnoreMissing) {
                    core.endGroup();
                    throw new Error(`Failed to install package ${pkg}`);
                }
                if (i !== inputs.aptGetRetries - 1) {
                    core.info(`Failed to install ${pkg}, retrying in ${formatTime(retryTime)}`);
                    await new Promise((resolve) => setTimeout(resolve, retryTime));
                    retryTime *= 2;
                }
            }
            core.endGroup();
        }
    } else {
        core.startGroup('📦 Install apt-get packages');
        const bulkArgs = ['-o', `Acquire::Retries=${inputs.aptGetRetries}`, 'install', '-y', ...inputs.apt_get];
        const { tool, args } = buildSudoCommand(sudoRequired, 'apt-get', bulkArgs);
        let retryTime = 2000;
        for (let i = 0; i < inputs.aptGetRetries; i++) {
            const exitCode = await exec.exec(tool, args, {
                env: aptEnv,
                ignoreReturnCode: i !== inputs.aptGetRetries - 1
            });
            if (exitCode === 0) {
                break;
            }
            if (i !== inputs.aptGetRetries - 1) {
                core.info(`Failed to install packages, retrying in ${formatTime(retryTime)}`);
                await new Promise((resolve) => setTimeout(resolve, retryTime));
                retryTime *= 2;
            }
        }
        core.endGroup();
    }
}
