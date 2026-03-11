/**
 * Main entry point for b2-workflow action.
 *
 * @module index
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as os from 'os';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

// Type imports and re-exports
import { type RawInputs, type Inputs, type BoolOrStringOption } from './types';
export type { Inputs, ArchConfig, BoolOrStringOption } from './types';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

// Module imports
import { numberOfCpus, normalizeArchitectureInput, deriveB2ArchConfig } from './arch-utils';

/**
 * Executes a Boost.Build (B2) workflow for building and testing C++ libraries.
 *
 * Configures user-config.jam with compiler settings, bootstraps B2 if needed,
 * and runs the specified build targets with the provided options.
 *
 * @param inputs - Configuration inputs including toolset, flags, source directory, and build options
 * @throws Error if B2 bootstrap, headers, or build fails
 */
export async function main(inputs: Inputs): Promise<void> {
    const fnlog = traceCommands.scoped('b2-workflow');
    const archConfig = deriveB2ArchConfig(inputs.arch);
    if (archConfig.normalizedArch) {
        inputs.arch = archConfig.normalizedArch;
    }

    // ----------------------------------------------
    // Set toolset compiler
    // ----------------------------------------------
    // In B2, instead of passing the compiler path in the command line
    // arguments, it is set in the user-config.jam file. This is a
    // Jamfile that is read by B2 before the build starts and is somewhat
    // equivalent to the CMAKE_CXX_COMPILER cache variable in CMake.
    // The user is responsible for setting this configuration properly
    // if providing its own user-config.jam file.
    if (!inputs.userConfig && inputs.cxx && inputs.toolset && inputs.toolset !== 'clang-win') {
        core.startGroup('🔧 Create user-config.jam');
        if (inputs.cxx && path.basename(inputs.cxx) === inputs.cxx) {
            try {
                inputs.cxx = await io.which(inputs.cxx);
            } catch {
                fnlog(`Could not find ${inputs.cxx} in PATH`);
            }
        }
        core.info(`🧩 cxx: ${inputs.cxx}`);
        inputs.cxx = inputs.cxx.replaceAll('\\', '\\\\');
        // toolsetBasename is toolset up to first '-'
        // For instance, for the toolset `gcc-13`, we should include the
        // path to `gcc` in user-config.jam. For `clang-win`, we should
        // include the path to `clang`.
        const toolsetBasename = inputs.toolset.split('-')[0];
        const userConfigJam = path.join(os.homedir(), 'user-config.jam');
        fnlog(`user-config.jam: ${userConfigJam}`);
        const userConfigJamContents = `using ${toolsetBasename} : : "${inputs.cxx}" ;`;
        fnlog(`user-config.jam contents: ${userConfigJamContents}`);
        fs.writeFileSync(userConfigJam, userConfigJamContents);
        core.info(`📝 ${userConfigJam} contents:`);
        core.info(userConfigJamContents);
        core.endGroup();
    }

    // ----------------------------------------------
    // Bootstrap B2
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap B2');
    // Run bootstrap.sh or bootstrap.bat from the source directory
    // to build B2
    const prevCxx = process.env['CXX'];
    process.env['CXX'] = ''; // Let B2 identify the compiler at this step
    const bootstrapPath = path.join(inputs.sourceDir, 'bootstrap' + (process.platform === 'win32' ? '.bat' : '.sh'));
    fnlog(`bootstrapPath: ${bootstrapPath}`);
    const bootstrapArgs: string[] = [];
    // if (inputs.toolset && inputs.toolset !== 'clang-win') {
    //     bootstrapArgs.push(inputs.toolset)
    // }
    core.info(`💻 ${inputs.sourceDir}> ${bootstrapPath} ${bootstrapArgs.join(' ')}`);
    {
        const { exitCode } = await exec.getExecOutput(`"${bootstrapPath}"`, bootstrapArgs, {
            cwd: inputs.sourceDir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            throw new Error(`B2 bootstrap failed with exit code ${exitCode}`);
        }
    }
    process.env['CXX'] = prevCxx;
    core.endGroup();

    // ----------------------------------------------
    // Bootstrap headers
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap headers');
    // ./b2 headers
    const b2Path = path.join(inputs.sourceDir, 'b2' + (process.platform === 'win32' ? '.exe' : ''));
    fnlog(`b2Path: ${b2Path}`);
    const bootstrapHeadersArgs = ['headers'];
    core.info(`💻 ${inputs.sourceDir}> ${b2Path} ${bootstrapHeadersArgs.join(' ')}`);
    {
        const { exitCode } = await exec.getExecOutput(`"${b2Path}"`, bootstrapHeadersArgs, {
            cwd: inputs.sourceDir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            throw new Error(`B2 headers failed with exit code ${exitCode}`);
        }
    }
    core.endGroup();

    // ----------------------------------------------
    // Build step
    // ----------------------------------------------
    // In B2, all the configure/build/test/install/package steps are
    // combined into a single step.
    core.startGroup('🛠️ Build and Test');

    /*
        Basic configuration options
     */
    let b2Args: string[] = [];
    if (!inputs.addressModel && archConfig.addressModel) {
        inputs.addressModel = archConfig.addressModel;
    }
    if (inputs.buildDir) {
        b2Args.push(`--build-dir=${inputs.buildDir}`);
    }
    b2Args.push('-j');
    b2Args.push(`${inputs.jobs}`);
    if (inputs.toolset) {
        b2Args.push(`--toolset=${inputs.toolset}`);
    }
    if (inputs.addressModel) {
        b2Args.push(`address-model=${inputs.addressModel}`);
    }
    if (archConfig.architecture) {
        b2Args.push(`architecture=${archConfig.architecture}`);
    }
    if (inputs.cxxstd) {
        b2Args.push(`cxxstd=${inputs.cxxstd}`);
    }
    if (inputs.buildType) {
        let lcBuildType = inputs.buildType.toLowerCase();
        if (lcBuildType === 'relwithdebinfo') {
            lcBuildType = 'release';
            b2Args.push(`variant=${lcBuildType}`);
            b2Args.push('debug-symbols=on');
        } else {
            b2Args.push(`variant=${lcBuildType}`);
        }
    }
    if (inputs.extraArgs) {
        b2Args = b2Args.concat(inputs.extraArgs);
    }

    /*
        Flags
     */
    if (inputs.cxxflags) {
        b2Args.push(`cxxflags=${inputs.cxxflags}`);
    }
    if (inputs.ccflags) {
        b2Args.push(`cflags=${inputs.ccflags}`);
    }
    if (inputs.linkflags) {
        b2Args.push(`linkflags=${inputs.linkflags}`);
    }

    /*
        B2-specific options
     */
    if (inputs.threading) {
        b2Args.push(`threading=${inputs.threading}`);
    }
    if (inputs.shared === true) {
        b2Args.push('link=shared');
    } else if (inputs.shared === false) {
        b2Args.push('link=static');
    }

    // The user can provide these options as a boolean (true/false) or as any
    // string. If the user provides a string, we pass it as-is to B2.
    // An empty string or undefined value is ignored.
    const boolOrStringOptions: BoolOrStringOption[] = [
        { key: 'warningsAsErrors', b2Key: 'warnings-as-errors', trueValue: 'on', falseValue: 'off' },
        { key: 'rtti', b2Key: 'rtti', trueValue: 'on', falseValue: 'off' },
        { key: 'asan', b2Key: 'address-sanitizer', trueValue: 'norecover', falseValue: undefined },
        { key: 'ubsan', b2Key: 'undefined-sanitizer', trueValue: 'norecover', falseValue: undefined },
        { key: 'msan', b2Key: 'memory-sanitizer', trueValue: 'norecover', falseValue: undefined },
        { key: 'tsan', b2Key: 'thread-sanitizer', trueValue: 'norecover', falseValue: undefined },
        { key: 'runtimeLink', b2Key: 'runtime-link', trueValue: 'shared', falseValue: 'static' }
    ];
    for (const option of boolOrStringOptions) {
        const inputVal = inputs[option.key as keyof Inputs];
        if (typeof inputVal === 'string') {
            if (inputVal !== '') {
                b2Args.push(`${option.b2Key}=${inputVal}`);
            }
        } else if (inputVal || typeof inputVal === 'boolean') {
            if (option.falseValue !== undefined) {
                b2Args.push(`${option.b2Key}=${inputVal ? option.trueValue : option.falseValue}`);
            } else if (inputVal) {
                b2Args.push(`${option.b2Key}=${option.trueValue}`);
            }
        }
    }

    if (inputs.coverage) {
        b2Args.push('coverage=on');
    }
    if (inputs.toolset === 'clang-win') {
        b2Args.push('embed-manifest-via=linker');
    }
    if (inputs.cleanAll) {
        b2Args.push('--clean-all');
    } else if (inputs.clean) {
        b2Args.push('--clean');
    }

    if (inputs.abbreviatePaths) {
        b2Args.push('--abbreviate-paths');
    } else if (inputs.hash) {
        b2Args.push('--hash');
    }
    if (inputs.rebuildAll) {
        b2Args.push('-a');
    }
    if (inputs.dryRun) {
        b2Args.push('-n');
    }
    if (inputs.stopOnError) {
        b2Args.push('-q');
    }

    if (inputs.config) {
        b2Args.push(`--config=${inputs.config}`);
    }
    if (inputs.siteConfig) {
        b2Args.push(`--site-config=${inputs.siteConfig}`);
    }
    if (inputs.userConfig) {
        b2Args.push(`--user-config=${inputs.userConfig}`);
    }
    if (inputs.projectConfig) {
        b2Args.push(`--project-config=${inputs.projectConfig}`);
    }
    if (inputs.debugConfiguration) {
        b2Args.push('--debug-configuration');
    }
    if (inputs.debugBuilding) {
        b2Args.push('--debug-building');
    }
    if (inputs.debugGenerators) {
        b2Args.push('--debug-generators');
    }
    if (inputs.include) {
        b2Args.push(`--include=${inputs.include}`);
    }
    if (inputs['define']) {
        b2Args.push(`--define=${inputs['define']}`);
    }


    /*
        Modules
     */
    const moduleTargetsRaw = Array.isArray(inputs.moduleTarget) ? inputs.moduleTarget : [];
    let moduleTargets = moduleTargetsRaw
        .map((target: string) => (target && target.trim ? target.trim() : target))
        .filter((target: string) => target);
    if (moduleTargets.length === 0) {
        moduleTargets = ['test'];
    }
    for (const moduleEntry of inputs.modules) {
        const module = moduleEntry && moduleEntry.trim ? moduleEntry.trim() : moduleEntry;
        if (!module) {
            continue;
        }
        const hasExplicitTarget = module.includes('/') || module.includes('\\') || module.includes(':');
        if (hasExplicitTarget) {
            b2Args.push(module);
        } else {
            for (const target of moduleTargets) {
                b2Args.push(`libs/${module}/${target}`);
            }
        }
    }

    /*
        Run
     */
    {
        core.info(`💻 ${inputs.sourceDir}> ${b2Path} ${b2Args.join(' ')}`);
        for (const arg of b2Args) {
            fnlog(`arg: ${arg} (${typeof arg})`);
        }
        const { exitCode } = await exec.getExecOutput(`"${b2Path}"`, b2Args, {
            cwd: inputs.sourceDir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            throw new Error(`B2 build failed with exit code ${exitCode}`);
        }
    }
    core.endGroup();
}


/**
 * Parses a bool-or-string option value.
 *
 * Returns true/false for boolean-like strings, the string itself for custom values,
 * or undefined for empty strings.
 *
 * @param value - The string value to parse
 * @returns true/false for boolean strings, the original string for custom values, or undefined for empty
 */
function parseBoolOrString(value: string): boolean | string | undefined {
    if (value === '') {
        return undefined;
    }
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'on' || lower === 'yes' || lower === '1') {
        return true;
    }
    if (lower === 'false' || lower === 'off' || lower === 'no' || lower === '0') {
        return false;
    }
    return value;
}

/**
 * Converts raw parsed inputs to the internal Inputs type.
 *
 * @param raw - Raw inputs from schema parsing
 * @returns Converted Inputs object
 */
function convertRawInputs(raw: RawInputs): Inputs {
    // Use buildVariant if provided, otherwise fall back to buildType
    const buildType = (raw.buildVariant || raw.buildType).toLowerCase();

    return {
        // Configure options
        sourceDir: path.resolve(raw.sourceDir),
        buildDir: raw.buildDir,
        cxx: raw.cxx,
        ccflags: raw.ccflags,
        cxxflags: raw.cxxflags,
        cxxstd: raw.cxxstd,
        shared: raw.shared,
        toolset: raw.toolset,
        arch: normalizeArchitectureInput(raw.arch),
        buildType,
        modules: raw.modules,
        moduleTarget: raw.moduleTarget,
        extraArgs: raw.extraArgs,
        // B2-specific options
        warningsAsErrors: parseBoolOrString(raw.warningsAsErrors),
        addressModel: raw.addressModel || undefined,
        asan: parseBoolOrString(raw.asan),
        ubsan: parseBoolOrString(raw.ubsan),
        msan: parseBoolOrString(raw.msan),
        tsan: parseBoolOrString(raw.tsan),
        coverage: raw.coverage || undefined,
        linkflags: raw.linkflags || undefined,
        threading: raw.threading || undefined,
        rtti: parseBoolOrString(raw.rtti),
        clean: raw.clean,
        cleanAll: raw.cleanAll,
        abbreviatePaths: raw.abbreviatePaths,
        hash: raw.hash,
        rebuildAll: raw.rebuildAll,
        dryRun: raw.dryRun,
        stopOnError: raw.stopOnError,
        config: raw.config,
        siteConfig: raw.siteConfig,
        userConfig: raw.userConfig,
        projectConfig: raw.projectConfig,
        debugConfiguration: raw.debugConfiguration,
        debugBuilding: raw.debugBuilding,
        debugGenerators: raw.debugGenerators,
        include: raw.include,
        define: raw.define || undefined,
        runtimeLink: parseBoolOrString(raw.runtimeLink),
        // Build options
        jobs: raw.jobs || numberOfCpus(),
        // Annotations and tracing
        traceCommands: raw.traceCommands
    };
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'B2 Workflow',
    main: async (rawInputs: RawInputs) => {
        const inputs = convertRawInputs(rawInputs);
        await main(inputs);
        return {};
    },
    callerModule: module
});

export { main as default };
