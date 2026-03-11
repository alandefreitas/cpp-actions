/**
 * CMake generator handling for cmake-workflow action.
 *
 * @module generators
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';

import { type Inputs } from './types';

import { normalizeArchitectureInput } from 'setup-program';
export { normalizeArchitectureInput };

/**
 * Derives the CMake generator architecture from the target architecture.
 *
 * Maps normalized architecture names to Visual Studio generator architecture values.
 * Only applies when using Visual Studio generators.
 *
 * @param arch - Target architecture (x86, x64, arm, arm64)
 * @param generator - CMake generator name
 * @returns Visual Studio architecture string (Win32, x64, ARM, ARM64) or empty if not applicable
 */
export function deriveGeneratorArchitectureFromArch(arch: string, generator: string): string {
    const normalizedArch = normalizeArchitectureInput(arch);
    if (!normalizedArch) {
        return '';
    }
    const generatorIsVisualStudio = generator && generator.startsWith('Visual Studio');
    if (!generatorIsVisualStudio) {
        return '';
    }
    const mapping: Record<string, string> = {
        x86: 'Win32',
        x64: 'x64',
        arm: 'ARM',
        arm64: 'ARM64'
    };
    return mapping[normalizedArch] || '';
}

/**
 * Sets up the default CMake generator if none is specified.
 *
 * Queries CMake for the system default generator or infers it from the OS.
 *
 * @param inputs - Workflow inputs to update with generator info
 */
export async function setupDefaultGenerator(inputs: Inputs): Promise<void> {
    const fnlog = traceCommands.scoped('setupDefaultGenerator');

    // Execute and get the output of:
    fnlog(`Identifying default generator`);
    // "$cmakePath" --system-information | sed -n 's/^CMAKE_GENERATOR [[:space:]]*"\([^"]*\)".*/\1/p')
    const {
        exitCode: exitCode,
        stdout
    } = await exec.getExecOutput(`"${inputs.cmakePath}"`, ['--system-information'], {
        silent: true,
        ignoreReturnCode: true
    });
    let match: RegExpMatchArray | null = null;
    if (exitCode === 0) {
        // Find the first line in stdout that describes the default 'CMAKE_GENERATOR'
        // The pattern is: CMAKE_GENERATOR "<generator>"
        const regex = /^\s*CMAKE_GENERATOR\s+"([^"]*)"/;
        for (const line of stdout.split(/\r?\n/).map(line => line.trim())) {
            match = line.match(regex);
            if (match) {
                fnlog(`Matched: ${match[0]}`);
                break;
            }
        }
    }
    if (match) {
        inputs.generator = match[1];
    } else {
        fnlog(`Could not identify default generator. Inferring default generator from OS.`);
        if (process.platform === 'win32') {
            inputs.generator = 'Visual Studio';
        } else {
            inputs.generator = 'Unix Makefiles';
        }
    }

    if (process.platform === 'win32') {
        const preferredVsGenerator = 'Visual Studio 17 2022';
        const needsOverride = !inputs.generator
            || inputs.generator === 'Visual Studio'
            || /^Visual Studio\s+(1[0-6])/.test(inputs.generator);
        if (needsOverride) {
            fnlog(`Overriding Windows generator to "${preferredVsGenerator}"`);
            inputs.generator = preferredVsGenerator;
        }
    }
    fnlog(`Default generator: ${inputs.generator}`);
    if (!inputs.generatorArchitecture && inputs.arch) {
        const derivedArch = deriveGeneratorArchitectureFromArch(inputs.arch, inputs.generator);
        if (derivedArch) {
            inputs.generatorArchitecture = derivedArch;
            core.info(`Derived CMake generator architecture "${derivedArch}" from arch "${inputs.arch}"`);
        }
    }
}
