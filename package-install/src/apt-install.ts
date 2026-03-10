/**
 * APT package installation logic.
 *
 * @module apt-install
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as io from '@actions/io';
import * as trace_commands from 'trace-commands';

import { Inputs } from './types';
import { formatTime, semverGteLoose } from './utils';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

/**
 * Installs apt sources, keys, and packages with retries and version-aware flags.
 *
 * Handles APT source key installation, repository addition, architecture
 * configuration, and package installation with retry logic.
 *
 * @param inputs - Configuration inputs for APT package installation
 * @throws Error if package installation fails and ignore_missing is false
 */
export async function apt_get_main(inputs: Inputs): Promise<void> {
    const fnlog = trace_commands.scoped('apt_get_main');

    core.startGroup('🔍 Find apt-get');
    fnlog(`Check if apt-get is installed`);
    const apt_get_path = await io.which('apt-get', true);
    const sudo_required = setup_program.isSudoRequired();
    const sudoPrefix = sudo_required ? 'sudo ' : '';
    core.info(`🧩 apt-get-path: ${apt_get_path}`);
    core.info(`🧩 sudo-required: ${sudo_required}`);

    core.endGroup();

    if (inputs.apt_get_source_keys.length > 0) {
        core.startGroup('🔑 Install apt-get source keys');
        for (const key of inputs.apt_get_source_keys) {
            let retryTime = 2000;
            for (let i = 0; i < inputs.apt_get_retries; i++) {
                core.info(`Add key ${key}`);
                const key_path = await tc.downloadTool(key);
                const exitCode = await exec.exec(`${sudoPrefix} apt-key add ${key_path}`, [], {
                    ignoreReturnCode: i !== inputs.apt_get_retries - 1
                });
                if (exitCode === 0) {
                    break;
                }
                if (i !== inputs.apt_get_retries - 1) {
                    core.info(`Failed to add key ${key}, retrying in ${formatTime(retryTime)}`);
                    await new Promise((resolve) => setTimeout(resolve, retryTime));
                    retryTime *= 2;
                }
            }
        }
        core.endGroup();
    }

    if (inputs.apt_get_sources.length > 0) {
        core.startGroup('🌐 Install apt-get sources');

        // Get the version of software-properties-common
        const {
            exitCode,
            stdout
        } = await exec.getExecOutput('dpkg-query --showformat=\'${Version}\' --show software-properties-common');
        if (exitCode !== 0) {
            throw new Error('Failed to get the version of software-properties-common');
        }
        const softwarePropertiesCommonVersion = stdout.trim();

        // Identify features of apt-add-repository command and set initial args
        const aptAddRepoCommonArgs = semverGteLoose(softwarePropertiesCommonVersion, '0.96.24.20') ? ['-y', '-n'] : ['-y'];
        const aptAddRepoHasSourceArgs = semverGteLoose(softwarePropertiesCommonVersion, '0.98.10');

        // Iterate through each source and attempt to add it with retries
        for (const source of inputs.apt_get_sources) {
            let retryTime = 2000;

            // Construct the arguments
            let aptAddRepoArgs = [...aptAddRepoCommonArgs];

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

            for (let i = 0; i < inputs.apt_get_retries; i++) {
                try {
                    // Execute the apt-add-repository command
                    const exitCode = await exec.exec(`${sudoPrefix} -E apt-add-repository ${aptAddRepoArgs.join(' ')}`, [], {
                        ignoreReturnCode: i !== inputs.apt_get_retries - 1
                    });
                    if (exitCode === 0) {
                        core.info(`Added source ${source}`);
                        break;
                    }
                    if (i !== inputs.apt_get_retries - 1) {
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
    if (inputs.apt_get_add_architecture.length > 0) {
        core.startGroup('📦 Add architectures');
        for (const arch of inputs.apt_get_add_architecture) {
            await exec.exec(`${sudoPrefix} dpkg --add-architecture ${arch}`, []);
        }
        core.endGroup();
    }

    // Update apt-get
    // $sudo_prefix apt-get -o Acquire::Retries=${{ inputs.apt-get-retries }} update
    core.startGroup('♻️ Update apt-get');
    await exec.exec(`${sudoPrefix} apt-get -o Acquire::Retries=${inputs.apt_get_retries} update`, []);
    core.endGroup();

    // Install packages
    if (inputs.apt_get_ignore_missing || !inputs.apt_get_bulk_install) {
        for (const pkg of inputs.apt_get) {
            core.startGroup('📦 Install apt-get package: ' + pkg);
            const args = inputs.apt_get_ignore_missing ?
                ['-o', 'Acquire::Retries=' + inputs.apt_get_retries, '--ignore-missing', 'install', '-y', pkg] :
                ['-o', 'Acquire::Retries=' + inputs.apt_get_retries, 'install', '-y', pkg];
            const exitCode = await exec.exec(`${sudoPrefix} apt-get`, args, {
                env: {
                    // set the DEBIAN_FRONTEND environment variable to
                    // noninteractive so that the tzdata package
                    // doesn't prompt for input
                    DEBIAN_FRONTEND: 'noninteractive',
                    TZ: 'Etc/UTC',
                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                },
                ignoreReturnCode: true
            });
            if (exitCode !== 0 && !inputs.apt_get_ignore_missing) {
                core.endGroup();
                throw new Error(`Failed to install package ${pkg}`);
            }
            core.endGroup();
        }
    } else {
        core.startGroup('📦 Install apt-get packages');
        await exec.exec(`${sudoPrefix} apt-get -o Acquire::Retries=${inputs.apt_get_retries} install -y ${inputs.apt_get.join(' ')}`, []);
        core.endGroup();
    }
}
