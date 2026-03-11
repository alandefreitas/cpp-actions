/**
 * CMake preset handling for cmake-workflow action.
 *
 * @module presets
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import { type Inputs, type SetupCMakeOutputs, type PresetFileResult } from './types';

/**
 * Reads and validates a CMake preset file.
 *
 * @param presetPath - Path to the preset file
 * @param supportedPresetsVersion - Maximum supported preset version
 * @returns Preset file result with existence, support status, and content
 */
export function readAndValidatePresetFile(presetPath: string, supportedPresetsVersion: number): PresetFileResult {
    let exists = false;
    let supported = false;
    let presetJson: Record<string, unknown> = {};

    const presetPathExists = fs.existsSync(presetPath);
    const presetPathIsFile = presetPathExists ? fs.statSync(presetPath).isFile() : false;
    if (!presetPathExists || !presetPathIsFile) {
        core.info(`Preset file not found: ${presetPath}`);
        return { exists, supported, presetJson };
    }
    exists = true;
    const presetFileContents = fs.readFileSync(presetPath, 'utf8');
    try {
        presetJson = JSON.parse(presetFileContents) as Record<string, unknown>;
    } catch (error) {
        traceCommands.log(`Failed to parse preset file: ${error}`);
        return { exists, supported, presetJson };
    }
    if (typeof presetJson !== 'object') {
        traceCommands.log(`Preset file is not an object`);
        return { exists, supported, presetJson };
    }
    if (!('version' in presetJson)) {
        traceCommands.log(`Preset file does not have a 'version' field`);
        return { exists, supported, presetJson };
    }
    if (typeof presetJson['version'] !== 'number') {
        traceCommands.log(`Preset file 'version' field is not a number`);
        return { exists, supported, presetJson };
    }
    const presetVersion = presetJson['version'] as number;
    if (presetVersion > supportedPresetsVersion) {
        traceCommands.log(`Preset file version ${presetVersion} is greater than the maximum supported version ${supportedPresetsVersion}`);
        return { exists, supported, presetJson };
    }
    // The preset file is supported
    supported = true;
    return { exists, supported, presetJson };
}

/**
 * Merges two CMake preset objects recursively.
 *
 * @param presetJson - Base preset JSON object
 * @param userPresetJson - User preset JSON to merge
 * @returns Merged preset JSON object
 */
export function mergeCMakePresetObject(
    presetJson: Record<string, unknown>,
    userPresetJson: Record<string, unknown> | undefined
): Record<string, unknown> {
    if (!userPresetJson) {
        return presetJson;
    }
    const merged: Record<string, unknown> = { ...presetJson };
    for (const key in userPresetJson) {
        if (!Object.prototype.hasOwnProperty.call(presetJson, key)) {
            merged[key] = userPresetJson[key];
        } else {
            const presetValue = presetJson[key];
            const userValue = userPresetJson[key];
            if (typeof presetValue === 'number' && typeof userValue === 'number') {
                merged[key] = Math.max(presetValue, userValue);
            } else if (Array.isArray(presetValue) && Array.isArray(userValue)) {
                merged[key] = presetValue.concat(userValue);
            } else if (typeof presetValue === 'object' && typeof userValue === 'object') {
                merged[key] = mergeCMakePresetObject(
                    presetValue as Record<string, unknown>,
                    userValue as Record<string, unknown>
                );
            } else {
                merged[key] = userValue !== undefined ? userValue : presetValue;
            }
        }
    }
    return merged;
}

/**
 * Merges a configure preset with its inherited base preset.
 *
 * @param presetJson - Configure preset JSON object
 * @param basePreset - Base preset to inherit from
 * @returns Merged configure preset object
 */
export function mergeCMakeConfigurePresetObject(
    presetJson: Record<string, unknown>,
    basePreset: Record<string, unknown> | undefined
): Record<string, unknown> {
    if (!basePreset) {
        return presetJson;
    }
    // Merge two configure presets
    // The presetJson inherits all fields from basePreset
    const merged: Record<string, unknown> = { ...presetJson };
    for (const key in basePreset) {
        if (!Object.prototype.hasOwnProperty.call(presetJson, key)) {
            if (key === 'hidden') {
                // "hidden is not inherited"
                continue;
            }
            // If a field is only present in basePreset, it is inherited
            merged[key] = basePreset[key];
            continue;
        }
        // If a field is present in both, the value from presetJson is used,
        // but we still merge values for objects and arrays
        const presetValue = presetJson[key];
        const baseValue = basePreset[key];
        if (Array.isArray(presetValue) && Array.isArray(baseValue)) {
            // If both contain the key and are arrays, concatenate them
            merged[key] = presetValue.concat(baseValue);
        } else if (Array.isArray(presetValue) && typeof baseValue === 'string') {
            // If both contain the key and are arrays, concatenate them
            merged[key] = presetValue.concat([baseValue]);
        } else if (typeof presetValue === 'string' && Array.isArray(baseValue)) {
            // If both contain the key and are arrays, concatenate them
            merged[key] = [presetValue].concat(baseValue);
        } else if (typeof presetValue === 'object' && typeof baseValue === 'object') {
            // If both contain the key and are objects, merge them, giving
            // priority to keys in presetJson
            const mergedValue: Record<string, unknown> = { ...(presetValue as Record<string, unknown>) };
            for (const subKey in (baseValue as Record<string, unknown>)) {
                if (!Object.prototype.hasOwnProperty.call(presetValue, subKey)) {
                    mergedValue[subKey] = (baseValue as Record<string, unknown>)[subKey];
                }
            }
            merged[key] = mergedValue;
        }
        // If we got here, the value is a primitive type (string, number, boolean),
        // so in this case, the value from presetJson is used
    }
    return merged;
}

/**
 * Converts a CMake cache variable value to a command-line argument string.
 *
 * @param value - Cache variable value (boolean, string, or object with type/value)
 * @returns String representation or undefined if invalid
 */
export function cacheVariableValueToArgsString(value: unknown): string | undefined {
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'object' && value !== null) {
        // type and value
        const obj = value as Record<string, unknown>;
        if (!('type' in obj) || !('value' in obj)) {
            return undefined;
        }
        return cacheVariableValueToArgsString(obj['value']);
    }
    return undefined;
}

/**
 * Converts cache variables to a CMake command-line arguments array.
 *
 * @param cacheVariables - Map of variable names to values
 * @returns Array of -D arguments for CMake
 */
export function makeCacheVariablesArgsArray(cacheVariables: Record<string, unknown>): string[] {
    const cacheVariablesArray: string[] = [];
    for (const [key, value] of Object.entries(cacheVariables)) {
        const valueStr = cacheVariableValueToArgsString(value);
        if (valueStr) {
            cacheVariablesArray.push(`-D`);
            cacheVariablesArray.push(`${key}=${valueStr}`);
        }
    }
    return cacheVariablesArray;
}

/**
 * Resolves CMake preset settings and applies them to inputs.
 *
 * Reads CMakePresets.json and CMakeUserPresets.json, merges them,
 * and applies preset settings to the workflow inputs.
 *
 * @param inputs - Workflow inputs to update
 * @param setupCMakeOutputs - CMake setup outputs with version info
 */
export function resolvePreset(inputs: Inputs, setupCMakeOutputs: SetupCMakeOutputs): void {
    if (!inputs.preset) {
        return;
    }
    const presetPath = path.resolve(inputs.sourceDir, 'CMakePresets.json');
    const {
        exists,
        supported,
        presetJson
    } = readAndValidatePresetFile(presetPath, setupCMakeOutputs.supportedPresetsVersion);

    const userPresetPath = path.resolve(inputs.sourceDir, 'CMakeUserPresets.json');
    const {
        exists: userExists,
        supported: userSupported,
        presetJson: userPresetJson
    } = readAndValidatePresetFile(userPresetPath, setupCMakeOutputs.supportedPresetsVersion);

    if (exists && supported && (!userExists || userSupported)) {
        // Everything OK. User built-in support for presets
        return;
    }

    // Apply preset manually:
    // Check if at least the main preset file exists
    if (!exists) {
        traceCommands.log(`Preset file not found: ${presetPath}`);
        return;
    }

    const mergedPresetJson =
        userExists ?
            mergeCMakePresetObject(presetJson, userPresetJson) :
            presetJson;

    // Function to get a configuration preset from a preset json
    // The preset is in configurePresets and is identified by the name field
    function getPreset(presetName: string, presetJson: Record<string, unknown>): Record<string, unknown> | undefined {
        const presets = presetJson['configurePresets'] as Record<string, unknown>[];
        for (const preset of presets) {
            if (preset['name'] === presetName) {
                return preset;
            }
        }
        return undefined;
    }

    // Find the main preset
    let mainPreset = getPreset(inputs.preset, mergedPresetJson);
    if (!mainPreset) {
        traceCommands.log(`Preset ${inputs.preset} not found`);
        return;
    }
    if (mainPreset['inherits'] && !Array.isArray(mainPreset['inherits']) && typeof mainPreset['inherits'] !== 'string') {
        traceCommands.log(`Preset ${inputs.preset} has an invalid inherits field`);
        return;
    }
    if (mainPreset['inherits'] && typeof mainPreset['inherits'] === 'string') {
        mainPreset['inherits'] = [mainPreset['inherits']];
    }

    // Preset becomes an empty string and we don't use it in the command line
    // because the current cmake version doens't support presets
    inputs.preset = '';

    // Apply any inheritance
    // While the main preset has an "inherits" field, keep applying inheritance
    // until there is no more inheritance to apply. The field can be a string
    // or an array of strings.
    const inheritedPresetNames: string[] = [];
    while (mainPreset['inherits']) {
        const inherits = [...(mainPreset['inherits'] as string[])];
        for (const inherit of inherits) {
            if (inheritedPresetNames.includes(inherit)) {
                traceCommands.log(`Inherited preset ${inherit} already inherited`);
                continue;
            }
            const inheritedPreset = getPreset(inherit, mergedPresetJson);
            if (!inheritedPreset) {
                traceCommands.log(`Inherited preset ${inherit} not found`);
                continue;
            }
            mainPreset = mergeCMakeConfigurePresetObject(mainPreset, inheritedPreset);
            inheritedPresetNames.push(inherit);
        }
        // Remove the already inherited objects from the array
        for (const inherit of inherits) {
            const index = (mainPreset['inherits'] as string[]).indexOf(inherit);
            if (index !== -1) {
                (mainPreset['inherits'] as string[]).splice(index, 1);
            }
        }
    }

    // Apply the preset values to inputs with precedence to the user's inputs
    inputs.generator = inputs.generator || (mainPreset['generator'] as string) || '';
    inputs.buildDir = inputs.buildDir || (mainPreset['binaryDir'] as string) || '';
    inputs.toolchain = inputs.toolchain || (mainPreset['toolchainFile'] as string) || '';
    inputs.generatorToolset = inputs.generatorToolset || (mainPreset['toolset'] as string) || '';
    inputs.generatorArchitecture = inputs.generatorArchitecture || (mainPreset['architecture'] as string) || '';
    inputs.toolchain = inputs.toolchain || (mainPreset['toolchainFile'] as string) || '';
    inputs.installPrefix = inputs.installPrefix || (mainPreset['installDir'] as string) || '';
    inputs.cmakePath = inputs.cmakePath || (mainPreset['cmakeExecutable'] as string) || '';
    if ('cacheVariables' in mainPreset) {
        const cacheVariablesArgsArray = makeCacheVariablesArgsArray(mainPreset['cacheVariables'] as Record<string, unknown>);
        (inputs.extraArgs as string[]) = (inputs.extraArgs as string[]).concat(cacheVariablesArgsArray);
    }
    if ('environment' in mainPreset) {
        const environment = mainPreset['environment'] as Record<string, string | null>;
        for (const key in environment) {
            if (environment[key] !== null) {
                process.env[key] = environment[key] as string;
            }
        }
    }
    if ('warnings' in mainPreset) {
        const warningsObj = mainPreset['warnings'] as Record<string, boolean>;
        for (const warning in warningsObj) {
            const value = warningsObj[warning];
            if (typeof value !== 'boolean') {
                continue;
            }
            if (warning === 'dev') {
                if (value) {
                    (inputs.extraArgs as string[]).push('-Wdev');
                } else {
                    (inputs.extraArgs as string[]).push('-Wno-dev');
                }
            } else if (warning === 'deprecated') {
                if (value) {
                    (inputs.extraArgs as string[]).push('-Wdeprecated');
                } else {
                    (inputs.extraArgs as string[]).push('-Wno-deprecated');
                }
            } else if (warning === 'uninitialized') {
                if (value) {
                    (inputs.extraArgs as string[]).push('--warn-uninitialized');
                }
            } else if (warning === 'unusedCli') {
                if (!value) {
                    (inputs.extraArgs as string[]).push('--no-warn-unused-cli');
                }
            } else if (warning === 'systemVars') {
                if (value) {
                    (inputs.extraArgs as string[]).push('--check-system-vars');
                }
            }
        }
    }
    if ('errors' in mainPreset) {
        const errorsObj = mainPreset['errors'] as Record<string, boolean>;
        for (const error in errorsObj) {
            const value = errorsObj[error];
            if (typeof value !== 'boolean') {
                continue;
            }
            if (error === 'dev') {
                if (value) {
                    (inputs.extraArgs as string[]).push('-Werror=dev');
                } else {
                    (inputs.extraArgs as string[]).push('-Wno-error=dev');
                }
            } else if (error === 'deprecated') {
                if (value) {
                    (inputs.extraArgs as string[]).push('-Werror=deprecated');
                } else {
                    (inputs.extraArgs as string[]).push('-Wno-error=deprecated');
                }
            }
        }
    }
    if ('debug' in mainPreset) {
        const debug = mainPreset['debug'] as Record<string, boolean>;
        for (const key in debug) {
            const value = debug[key];
            if (typeof value !== 'boolean') {
                continue;
            }
            if (key === 'output') {
                if (value) {
                    (inputs.extraArgs as string[]).push('--debug-output');
                }
            } else if (key === 'tryCompile') {
                if (value) {
                    (inputs.extraArgs as string[]).push('--debug-trycompile');
                }
            } else if (key === 'find') {
                if (value) {
                    (inputs.extraArgs as string[]).push('--debug-find');
                }
            }
        }
    }
    if ('trace' in mainPreset) {
        const trace = mainPreset['trace'] as Record<string, unknown>;
        for (const key in trace) {
            const value = trace[key];
            if (key === 'output') {
                if (typeof value !== 'string') {
                    continue;
                }
                if (value === 'on') {
                    (inputs.extraArgs as string[]).push('--trace');
                } else if (value === 'expand') {
                    (inputs.extraArgs as string[]).push('--trace-expand');
                }
            } else if (key === 'format') {
                if (typeof value !== 'string') {
                    continue;
                }
                (inputs.extraArgs as string[]).push(`--trace-format=${value}`);
            } else if (key === 'source') {
                if (!Array.isArray(value) && typeof value !== 'string') {
                    continue;
                }
                const sources = Array.isArray(value) ? value : [value];
                for (const source of sources) {
                    const escapedSource = (source as string).replace(/"/g, '\\"');
                    (inputs.extraArgs as string[]).push(`--trace-source="${escapedSource}"`);
                }
            } else if (key === 'redirect') {
                if (typeof value !== 'string') {
                    continue;
                }
                const escapedValue = value.replace(/"/g, '\\"');
                (inputs.extraArgs as string[]).push(`--trace-redirect="${escapedValue}"`);
            }
        }
    }
}
