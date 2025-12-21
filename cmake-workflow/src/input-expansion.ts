/**
 * Input expansion and parsing for cmake-workflow action.
 *
 * Handles parsing of extra arguments and expansion of combinatorial factors
 * to generate multiple build configurations.
 *
 * @module input-expansion
 */

import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';

import { Inputs, ResolvedInputs } from './types';

/**
 * Parses extra arguments into a list or map of arguments.
 *
 * Supports both simple argument lists and key-value pairs for matrix builds.
 *
 * @param extra_args - Raw extra arguments to parse
 * @returns Parsed arguments as array or map
 */
export function parseExtraArgs(extra_args: string[]): string[] | Record<string, string[]> {
    function fnlog(msg: string): void {
        trace_commands.log('parseExtraArgs: ' + msg);
    }

    if (extra_args.length === 0) {
        return [];
    }

    // Extra args is a multiline string. It can be parsed as either
    // a single line representing the arguments or as a map of arguments.
    // When a map is provided, the workflow will be run for each
    // key-value pair in the map.

    function getLineKeyValue(line: string): { key: string; value: string } | undefined {
        // Check if the line has a key-value pair or if it's just
        // more args. The key is any identifier followed by ":".
        const regex = /^([^:]+):(.*)$/;
        const match = line.match(regex);
        if (!match) {
            return undefined;
        }
        const key = match[1].trim();
        const keyIsQuoted =
            (key.startsWith('"') && key.endsWith('"')) ||
            (key.startsWith('\'') && key.endsWith('\''));
        if (keyIsQuoted) {
            return { key: key.substring(1, key.length - 1), value: match[2] };
        }
        const keyIsInvalid = key.trim().includes(' ');
        if (keyIsInvalid) {
            return undefined;
        }
        return { key: key, value: match[2] };
    }

    const first_line = extra_args[0];
    let res = getLineKeyValue(first_line);
    if (!res) {
        // Parse all lines as a single line of cmake args
        fnlog('Parsing all lines as a single line of cmake args');
        return gh_inputs.parseBashArguments(extra_args);
    } else {
        // Parse lines as a map of key-value pairs where each value
        // is one factor we have to test.
        fnlog('Parsing lines as a map of key-value pairs');
        const extraArgsMap: Record<string, string[]> = {};
        extraArgsMap[res.key] = [res.value];
        let curKey = res.key;
        for (let i = 1; i < extra_args.length; i++) {
            const line = extra_args[i];
            res = getLineKeyValue(line);
            if (!res) {
                // Continuation of the previous key
                extraArgsMap[curKey].push(line);
            } else {
                extraArgsMap[res.key] = [res.value];
                curKey = res.key;
            }
        }
        fnlog(`Parsed extra args map: ${JSON.stringify(extraArgsMap)}`);
        // Parse each value in the map as a single line of cmake args
        for (const key in extraArgsMap) {
            extraArgsMap[key] = gh_inputs.parseBashArguments(extraArgsMap[key]);
        }
        fnlog(`Parsed extra args map: ${JSON.stringify(extraArgsMap)}`);
        return extraArgsMap;
    }
}

/**
 * Sanitizes a key string for use in directory names.
 *
 * Replaces invalid filesystem characters with underscores and collapses
 * consecutive underscores.
 *
 * @param key - Key string to sanitize
 * @returns Sanitized string safe for filesystem use
 */
export function sanitizeKey(key: string): string {
    return key
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/**
 * Generates a directory suffix from combinatorial factor values.
 *
 * Creates a suffix string that uniquely identifies this combination of factors.
 * Returns empty string for the main/default entry (first extra_args key + main cxxstd).
 *
 * @param extraArgsKey - The extra_args configuration key (undefined if not using map)
 * @param cxxstd - The C++ standard version for this entry
 * @param mainCxxstd - The main/default C++ standard version
 * @param isFirstExtraArgsKey - Whether this is the first (default) extra_args key
 * @returns Suffix string (empty for main entry, e.g., "-asan-cxx20" otherwise)
 */
export function generateFactorSuffix(
    extraArgsKey: string | undefined,
    cxxstd: string | null,
    mainCxxstd: string | null,
    isFirstExtraArgsKey: boolean
): string {
    const parts: string[] = [];

    // Add extra_args key if not the first/default
    if (extraArgsKey && !isFirstExtraArgsKey) {
        parts.push(sanitizeKey(extraArgsKey));
    }

    // Add cxxstd if not the main standard
    if (cxxstd && cxxstd !== mainCxxstd) {
        parts.push(`cxx${cxxstd}`);
    }

    return parts.length > 0 ? `-${parts.join('-')}` : '';
}

/**
 * Combines a base path with a factor suffix.
 *
 * @param basePath - Base directory path
 * @param suffix - Factor suffix (may be empty)
 * @returns Combined path
 */
export function makeFactorPath(basePath: string, suffix: string): string {
    return suffix ? `${basePath}${suffix}` : basePath;
}

/**
 * Expands combinatorial factors in Inputs to a list of ResolvedInputs.
 *
 * Creates the Cartesian product of:
 * - extra_args keys (if extra_args is a map)
 * - cxxstd values
 *
 * The first combination (first extra_args key + first cxxstd) is marked as the
 * main entry and receives the exact user-specified paths without suffixes.
 *
 * @param inputs - Raw inputs with combinatorial factors
 * @returns Array of resolved inputs, one per factor combination
 */
export function expandInputs(inputs: Inputs): ResolvedInputs[] {
    function fnlog(msg: string): void {
        trace_commands.log('expandInputs: ' + msg);
    }

    const results: ResolvedInputs[] = [];

    // Determine extra_args structure
    const isExtraArgsMap = !Array.isArray(inputs.extra_args);
    const extraArgsKeys: (string | undefined)[] = isExtraArgsMap
        ? Object.keys(inputs.extra_args as Record<string, string[]>)
        : [undefined];
    const firstExtraArgsKey = extraArgsKeys[0];

    // Main cxxstd is the first in the list
    const mainCxxstd = inputs.cxxstd[0];

    fnlog(`Expanding inputs: ${extraArgsKeys.length} extra_args keys × ${inputs.cxxstd.length} cxxstd values`);

    for (const extraArgsKey of extraArgsKeys) {
        const isFirstExtraArgsKey = extraArgsKey === firstExtraArgsKey;

        // Get the extra_args array for this key
        const extraArgsArray: string[] = isExtraArgsMap
            ? (inputs.extra_args as Record<string, string[]>)[extraArgsKey as string]
            : (inputs.extra_args as string[]);

        for (const cxxstd of inputs.cxxstd) {
            const isMainEntry = isFirstExtraArgsKey && cxxstd === mainCxxstd;
            const suffix = generateFactorSuffix(extraArgsKey, cxxstd, mainCxxstd, isFirstExtraArgsKey);

            fnlog(`Entry: extra_args_key=${extraArgsKey ?? '(none)'}, cxxstd=${cxxstd ?? '(default)'}, suffix="${suffix}", is_main=${isMainEntry}`);

            const entry: ResolvedInputs = {
                // Copy non-factor fields
                cmake_path: inputs.cmake_path,
                cmake_version: inputs.cmake_version,
                source_dir: inputs.source_dir,
                url: inputs.url,
                git_repository: inputs.git_repository,
                git_tag: inputs.git_tag,
                download_dir: inputs.download_dir,
                patches: inputs.patches,
                preset: inputs.preset,
                cc: inputs.cc,
                ccflags: inputs.ccflags,
                cxx: inputs.cxx,
                cxxflags: inputs.cxxflags,
                shared: inputs.shared,
                toolchain: inputs.toolchain,
                generator: inputs.generator,
                generator_toolset: inputs.generator_toolset,
                generator_architecture: inputs.generator_architecture,
                arch: inputs.arch,
                build_type: inputs.build_type,
                build_target: inputs.build_target,
                export_compile_commands: inputs.export_compile_commands,
                jobs: inputs.jobs,
                run_tests: inputs.run_tests,
                configure_tests_flag: inputs.configure_tests_flag,
                ctest_timeout: inputs.ctest_timeout,
                install: inputs.install,
                package: inputs.package,
                package_name: inputs.package_name,
                package_vendor: inputs.package_vendor,
                package_generators: inputs.package_generators,
                package_artifact: inputs.package_artifact,
                package_retention_days: inputs.package_retention_days,
                create_annotations: inputs.create_annotations,
                ref_source_dir: inputs.ref_source_dir,
                trace_commands: inputs.trace_commands,

                // Resolved factor fields
                cxxstd: cxxstd,
                extra_args: extraArgsArray,
                extra_args_key: extraArgsKey,
                is_main_entry: isMainEntry,

                // Flags controlling which steps run for non-main entries
                test_all_cxxstd: inputs.test_all_cxxstd,
                install_all_cxxstd: inputs.install_all_cxxstd,
                package_all_cxxstd: inputs.package_all_cxxstd,

                // Paths with factor suffixes
                build_dir: makeFactorPath(inputs.build_dir || 'build', suffix),
                install_prefix: makeFactorPath(inputs.install_prefix || 'install', suffix),
                package_dir: makeFactorPath(inputs.package_dir || 'package', suffix),
            };

            results.push(entry);
        }
    }

    fnlog(`Expanded to ${results.length} entries`);
    return results;
}

/**
 * Validates that all expanded entries have unique output paths.
 *
 * Throws an error if duplicate path suffixes are detected, which would cause
 * entries to overwrite each other's outputs.
 *
 * @param entries - Array of resolved inputs to validate
 * @throws Error if duplicate output paths are detected
 */
export function validateUniquePaths(entries: ResolvedInputs[]): void {
    const buildDirs = new Set<string>();

    for (const entry of entries) {
        if (buildDirs.has(entry.build_dir)) {
            const factorDesc = entry.extra_args_key
                ? `extra_args_key="${entry.extra_args_key}", cxxstd=${entry.cxxstd ?? 'default'}`
                : `cxxstd=${entry.cxxstd ?? 'default'}`;
            throw new Error(
                `Duplicate build directory "${entry.build_dir}" detected for entry (${factorDesc}). ` +
                `Ensure factor combinations produce unique identifiers.`
            );
        }
        buildDirs.add(entry.build_dir);
    }
}

/**
 * Normalizes file paths by converting backslashes to forward slashes on Windows.
 *
 * @param inputPath - File path to normalize
 * @returns Normalized path with forward slashes
 */
export function normalizePath(inputPath: string): string {
    if (process.platform === 'win32') {
        inputPath = inputPath.replace(/\\/g, '/');
    }
    return inputPath;
}

/**
 * Applies CMake preset macros to a value.
 *
 * Replaces macro placeholders like ${sourceDir}, ${generator}, $env{VAR}
 * with their actual values.
 *
 * @param value - Value to process for macro expansion
 * @param allInputs - All workflow inputs for macro resolution
 * @returns Value with macros expanded
 */
export function applyPresetMacros(value: unknown, allInputs: Inputs): unknown {
    // The action allows preset macros to be used in the input.
    // Macros are recognized in the form $<macro-namespace>{<macro-name>}
    // Most placeholders are allowed:
    // - ${sourceDir}: The source directory
    // - ${sourceParentDir}: The parent directory of the source directory
    // - ${sourceDirName}: The name of the source directory
    // - ${presetName}: The name of the preset
    // - ${generator}: The CMake generator
    // - ${hostSystemName}: Only Linux, Windows, and Darwin are supported
    // - ${dollar}: The dollar sign ($)
    // - ${pathListSep}: The path list separator (; on Windows, : on other systems)
    // - $env{<variable-name>}: The value of the environment variable
    // - $penv{<variable-name>}: The value of the environment variable
    if (typeof value === 'string' || value instanceof String) {
        return (value as string).replace(/\${sourceDir}/g, allInputs.source_dir)
            .replace(/\${sourceParentDir}/g, path.dirname(allInputs.source_dir))
            .replace(/\${sourceDirName}/g, path.basename(allInputs.source_dir))
            .replace(/\${presetName}/g, allInputs.preset)
            .replace(/\${generator}/g, allInputs.generator)
            .replace(/\${hostSystemName}/g, process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'Darwin' : 'Linux'))
            .replace(/\${dollar}/g, '$')
            .replace(/\${pathListSep}/g, process.platform === 'win32' ? ';' : ':')
            .replace(/\$env{([^}]+)}/g, (_, name) => process.env[name] || '')
            .replace(/\$penv{([^}]+)}/g, (_, name) => process.env[name] || '');
    } else if (Array.isArray(value)) {
        return value.map((element) => applyPresetMacros(element, allInputs));
    } else if (typeof value === 'object' && value !== null) {
        const result: Record<string, unknown> = {};
        for (const key in (value as Record<string, unknown>)) {
            result[key] = applyPresetMacros((value as Record<string, unknown>)[key], allInputs);
        }
        return result;
    } else {
        return value;
    }
}
