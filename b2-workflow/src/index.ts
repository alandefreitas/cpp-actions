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
import * as trace_commands from 'trace-commands';
import { runAction } from 'action-schema';

// Type imports and re-exports
import { RawInputs, Inputs, BoolOrStringOption } from './types';
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
    const fnlog = trace_commands.scoped('b2-workflow');
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
    if (!inputs.user_config && inputs.cxx && inputs.toolset && inputs.toolset !== 'clang-win') {
        core.startGroup('🔧 Create user-config.jam');
        if (inputs.cxx && path.basename(inputs.cxx) === inputs.cxx) {
            try {
                inputs.cxx = await io.which(inputs.cxx);
            } catch (error) {
                fnlog(`Could not find ${inputs.cxx} in PATH`);
            }
        }
        core.info(`🧩 cxx: ${inputs.cxx}`);
        inputs.cxx = inputs.cxx.replaceAll('\\', '\\\\');
        // toolset_basename is toolset up to first '-'
        // For instance, for the toolset `gcc-13`, we should include the
        // path to `gcc` in user-config.jam. For `clang-win`, we should
        // include the path to `clang`.
        const toolset_basename = inputs.toolset.split('-')[0];
        const user_config_jam = path.join(os.homedir(), 'user-config.jam');
        fnlog(`user-config.jam: ${user_config_jam}`);
        const user_config_jam_contents = `using ${toolset_basename} : : "${inputs.cxx}" ;`;
        fnlog(`user-config.jam contents: ${user_config_jam_contents}`);
        fs.writeFileSync(user_config_jam, user_config_jam_contents);
        core.info(`📝 ${user_config_jam} contents:`);
        core.info(user_config_jam_contents);
        core.endGroup();
    }

    // ----------------------------------------------
    // Bootstrap B2
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap B2');
    // Run bootstrap.sh or bootstrap.bat from the source directory
    // to build B2
    const prev_cxx = process.env['CXX'];
    process.env['CXX'] = ''; // Let B2 identify the compiler at this step
    const bootstrap_path = path.join(inputs.source_dir, 'bootstrap' + (process.platform === 'win32' ? '.bat' : '.sh'));
    fnlog(`bootstrap_path: ${bootstrap_path}`);
    const bootstrap_args: string[] = [];
    // if (inputs.toolset && inputs.toolset !== 'clang-win') {
    //     bootstrap_args.push(inputs.toolset)
    // }
    core.info(`💻 ${inputs.source_dir}> ${bootstrap_path} ${bootstrap_args.join(' ')}`);
    {
        const { exitCode } = await exec.getExecOutput(`"${bootstrap_path}"`, bootstrap_args, {
            cwd: inputs.source_dir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            throw new Error(`B2 bootstrap failed with exit code ${exitCode}`);
        }
    }
    process.env['CXX'] = prev_cxx;
    core.endGroup();

    // ----------------------------------------------
    // Bootstrap headers
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap headers');
    // ./b2 headers
    const b2_path = path.join(inputs.source_dir, 'b2' + (process.platform === 'win32' ? '.exe' : ''));
    fnlog(`b2_path: ${b2_path}`);
    const bootstrap_headers_args = ['headers'];
    core.info(`💻 ${inputs.source_dir}> ${b2_path} ${bootstrap_headers_args.join(' ')}`);
    {
        const { exitCode } = await exec.getExecOutput(`"${b2_path}"`, bootstrap_headers_args, {
            cwd: inputs.source_dir,
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
    let b2_args: string[] = [];
    if (!inputs.address_model && archConfig.addressModel) {
        inputs.address_model = archConfig.addressModel;
    }
    if (inputs.build_dir) {
        b2_args.push(`--build-dir=${inputs.build_dir}`);
    }
    b2_args.push('-j');
    b2_args.push(`${inputs.jobs}`);
    if (inputs.toolset) {
        b2_args.push(`--toolset=${inputs.toolset}`);
    }
    if (inputs.address_model) {
        b2_args.push(`address-model=${inputs.address_model}`);
    }
    if (archConfig.architecture) {
        b2_args.push(`architecture=${archConfig.architecture}`);
    }
    if (inputs.cxxstd) {
        b2_args.push(`cxxstd=${inputs.cxxstd}`);
    }
    if (inputs.build_type) {
        let lc_build_type = inputs.build_type.toLowerCase();
        if (lc_build_type === 'relwithdebinfo') {
            lc_build_type = 'release';
            b2_args.push(`variant=${lc_build_type}`);
            b2_args.push('debug-symbols=on');
        } else {
            b2_args.push(`variant=${lc_build_type}`);
        }
    }
    if (inputs.extra_args) {
        b2_args = b2_args.concat(inputs.extra_args);
    }

    /*
        Flags
     */
    if (inputs.cxxflags) {
        b2_args.push(`cxxflags=${inputs.cxxflags}`);
    }
    if (inputs.ccflags) {
        b2_args.push(`cflags=${inputs.ccflags}`);
    }
    if (inputs.linkflags) {
        b2_args.push(`linkflags=${inputs.linkflags}`);
    }

    /*
        B2-specific options
     */
    if (inputs.threading) {
        b2_args.push(`threading=${inputs.threading}`);
    }
    if (inputs.shared === true) {
        b2_args.push('link=shared');
    } else if (inputs.shared === false) {
        b2_args.push('link=static');
    }

    // The user can provide these options as a boolean (true/false) or as any
    // string. If the user provides a string, we pass it as-is to B2.
    // An empty string or undefined value is ignored.
    const boolOrStringOptions: BoolOrStringOption[] = [
        { key: 'warnings_as_errors', b2_key: 'warnings-as-errors', true_value: 'on', false_value: 'off' },
        { key: 'rtti', b2_key: 'rtti', true_value: 'on', false_value: 'off' },
        { key: 'asan', b2_key: 'address-sanitizer', true_value: 'norecover', false_value: undefined },
        { key: 'ubsan', b2_key: 'undefined-sanitizer', true_value: 'norecover', false_value: undefined },
        { key: 'msan', b2_key: 'memory-sanitizer', true_value: 'norecover', false_value: undefined },
        { key: 'tsan', b2_key: 'thread-sanitizer', true_value: 'norecover', false_value: undefined },
        { key: 'runtime_link', b2_key: 'runtime-link', true_value: 'shared', false_value: 'static' }
    ];
    for (const option of boolOrStringOptions) {
        const inputVal = inputs[option.key as keyof Inputs];
        if (typeof inputVal === 'string') {
            if (inputVal !== '') {
                b2_args.push(`${option.b2_key}=${inputVal}`);
            }
        } else if (inputVal || typeof inputVal === 'boolean') {
            if (option.false_value !== undefined) {
                b2_args.push(`${option.b2_key}=${inputVal ? option.true_value : option.false_value}`);
            } else if (inputVal) {
                b2_args.push(`${option.b2_key}=${option.true_value}`);
            }
        }
    }

    if (inputs.coverage) {
        b2_args.push('coverage=on');
    }
    if (inputs.toolset === 'clang-win') {
        b2_args.push('embed-manifest-via=linker');
    }
    if (inputs.clean_all) {
        b2_args.push('--clean-all');
    } else if (inputs.clean) {
        b2_args.push('--clean');
    }

    if (inputs.abbreviate_paths) {
        b2_args.push('--abbreviate-paths');
    } else if (inputs.hash) {
        b2_args.push('--hash');
    }
    if (inputs.rebuild_all) {
        b2_args.push('-a');
    }
    if (inputs.dry_run) {
        b2_args.push('-n');
    }
    if (inputs.stop_on_error) {
        b2_args.push('-q');
    }

    if (inputs.config) {
        b2_args.push(`--config=${inputs.config}`);
    }
    if (inputs.site_config) {
        b2_args.push(`--site-config=${inputs.site_config}`);
    }
    if (inputs.user_config) {
        b2_args.push(`--user-config=${inputs.user_config}`);
    }
    if (inputs.project_config) {
        b2_args.push(`--project-config=${inputs.project_config}`);
    }
    if (inputs.debug_configuration) {
        b2_args.push('--debug-configuration');
    }
    if (inputs.debug_building) {
        b2_args.push('--debug-building');
    }
    if (inputs.debug_generators) {
        b2_args.push('--debug-generators');
    }
    if (inputs.include) {
        b2_args.push(`--include=${inputs.include}`);
    }
    if (inputs['define']) {
        b2_args.push(`--define=${inputs['define']}`);
    }


    /*
        Modules
     */
    const moduleTargetsRaw = Array.isArray(inputs.module_target) ? inputs.module_target : [];
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
            b2_args.push(module);
        } else {
            for (const target of moduleTargets) {
                b2_args.push(`libs/${module}/${target}`);
            }
        }
    }

    /*
        Run
     */
    {
        core.info(`💻 ${inputs.source_dir}> ${b2_path} ${b2_args.join(' ')}`);
        for (const arg of b2_args) {
            fnlog(`arg: ${arg} (${typeof arg})`);
        }
        const { exitCode } = await exec.getExecOutput(`"${b2_path}"`, b2_args, {
            cwd: inputs.source_dir,
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
    // Use build_variant if provided, otherwise fall back to build_type
    const build_type = (raw.build_variant || raw.build_type).toLowerCase();

    return {
        // Configure options
        source_dir: path.resolve(raw.source_dir),
        build_dir: raw.build_dir,
        cxx: raw.cxx,
        ccflags: raw.ccflags,
        cxxflags: raw.cxxflags,
        cxxstd: raw.cxxstd,
        shared: raw.shared,
        toolset: raw.toolset,
        arch: normalizeArchitectureInput(raw.arch),
        build_type,
        modules: raw.modules,
        module_target: raw.module_target,
        extra_args: raw.extra_args,
        // B2-specific options
        warnings_as_errors: parseBoolOrString(raw.warnings_as_errors),
        address_model: raw.address_model || undefined,
        asan: parseBoolOrString(raw.asan),
        ubsan: parseBoolOrString(raw.ubsan),
        msan: parseBoolOrString(raw.msan),
        tsan: parseBoolOrString(raw.tsan),
        coverage: raw.coverage || undefined,
        linkflags: raw.linkflags || undefined,
        threading: raw.threading || undefined,
        rtti: parseBoolOrString(raw.rtti),
        clean: raw.clean,
        clean_all: raw.clean_all,
        abbreviate_paths: raw.abbreviate_paths,
        hash: raw.hash,
        rebuild_all: raw.rebuild_all,
        dry_run: raw.dry_run,
        stop_on_error: raw.stop_on_error,
        config: raw.config,
        site_config: raw.site_config,
        user_config: raw.user_config,
        project_config: raw.project_config,
        debug_configuration: raw.debug_configuration,
        debug_building: raw.debug_building,
        debug_generators: raw.debug_generators,
        include: raw.include,
        define: raw.define || undefined,
        runtime_link: parseBoolOrString(raw.runtime_link),
        // Build options
        jobs: raw.jobs || numberOfCpus(),
        // Annotations and tracing
        trace_commands: raw.trace_commands
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
