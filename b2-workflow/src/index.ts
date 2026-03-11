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

// Schema imports
import { type Inputs, inputsSchema, outputsSchema } from './schema';
export { type Inputs, inputsSchema, outputsSchema };

// Module imports
import { type ArchConfig, deriveB2ArchConfig } from './arch-utils';
export type { ArchConfig } from './arch-utils';

/**
 * Configuration for options that accept boolean or string values.
 *
 * Allows users to provide either true/false or custom string values
 * for B2 options.
 */
export interface BoolOrStringOption {
    /** Input key name */
    key: string;
    /** Corresponding B2 command-line key */
    b2Key: string;
    /** Value to use when option is true */
    trueValue: string;
    /** Value to use when option is false, or undefined to omit */
    falseValue: string | undefined;
}

/**
 * Orchestrates a Boost.Build (B2) workflow for building and testing C++ libraries.
 *
 * Configures user-config.jam with compiler settings, bootstraps B2 if needed,
 * and runs the specified build targets with the provided options.
 */
class B2WorkflowRunner {
    /** Frozen configuration inputs */
    private readonly inputs: Inputs;

    /** Architecture configuration derived from arch input */
    private archConfig!: ArchConfig;

    /** Path to the B2 executable after bootstrap */
    private b2Path!: string;

    /** Resolved CXX compiler path — may be modified from the original input */
    private cxx: string;

    /** Resolved address model — may be derived from arch config */
    private addressModel: string;

    /**
     * Creates a new B2WorkflowRunner from parsed inputs.
     *
     * @param inputs - Inputs from schema parsing (transforms already applied)
     */
    constructor(inputs: Inputs) {
        this.inputs = inputs;
        this.cxx = this.inputs.cxx;
        this.addressModel = this.inputs.addressModel;
    }

    /**
     * Runs the full B2 workflow pipeline.
     *
     * @throws Error if B2 bootstrap, headers, or build fails
     */
    async run(): Promise<void> {
        this.deriveArchitecture();
        await this.createUserConfig();
        await this.bootstrapB2();
        await this.bootstrapHeaders();
        await this.buildAndTest();
    }

    /**
     * Derives B2 architecture settings (address model, architecture family) from the arch input.
     */
    private deriveArchitecture(): void {
        this.archConfig = deriveB2ArchConfig(this.inputs.arch);
        if (!this.addressModel && this.archConfig.addressModel) {
            this.addressModel = this.archConfig.addressModel;
        }
    }

    /**
     * Creates user-config.jam with toolset compiler path when appropriate.
     *
     * In B2, instead of passing the compiler path in the command line
     * arguments, it is set in the user-config.jam file. This is a
     * Jamfile that is read by B2 before the build starts and is somewhat
     * equivalent to the CMAKE_CXX_COMPILER cache variable in CMake.
     * The user is responsible for setting this configuration properly
     * if providing its own user-config.jam file.
     */
    private async createUserConfig(): Promise<void> {
        if (!this.inputs.userConfig && this.cxx && this.inputs.toolset && this.inputs.toolset !== 'clang-win') {
            const fnlog = traceCommands.scoped('createUserConfig');
            core.startGroup('🔧 Create user-config.jam');
            if (this.cxx && path.basename(this.cxx) === this.cxx) {
                try {
                    this.cxx = await io.which(this.cxx);
                } catch {
                    fnlog(`Could not find ${this.cxx} in PATH`);
                }
            }
            core.info(`🧩 cxx: ${this.cxx}`);
            this.cxx = this.cxx.replaceAll('\\', '\\\\');
            // toolsetBasename is toolset up to first '-'
            // For instance, for the toolset `gcc-13`, we should include the
            // path to `gcc` in user-config.jam. For `clang-win`, we should
            // include the path to `clang`.
            const toolsetBasename = this.inputs.toolset.split('-')[0];
            const userConfigJam = path.join(os.homedir(), 'user-config.jam');
            fnlog(`user-config.jam: ${userConfigJam}`);
            const userConfigJamContents = `using ${toolsetBasename} : : "${this.cxx}" ;`;
            fnlog(`user-config.jam contents: ${userConfigJamContents}`);
            fs.writeFileSync(userConfigJam, userConfigJamContents);
            core.info(`📝 ${userConfigJam} contents:`);
            core.info(userConfigJamContents);
            core.endGroup();
        }
    }

    /**
     * Bootstraps the B2 build system from the source directory.
     *
     * @throws Error if B2 bootstrap fails
     */
    private async bootstrapB2(): Promise<void> {
        const fnlog = traceCommands.scoped('bootstrapB2');
        core.startGroup('🔎 Bootstrap B2');
        const prevCxx = process.env['CXX'];
        process.env['CXX'] = ''; // Let B2 identify the compiler at this step
        const bootstrapPath = path.join(this.inputs.sourceDir, 'bootstrap' + (process.platform === 'win32' ? '.bat' : '.sh'));
        fnlog(`bootstrapPath: ${bootstrapPath}`);
        const bootstrapArgs: string[] = [];
        core.info(`💻 ${this.inputs.sourceDir}> ${bootstrapPath} ${bootstrapArgs.join(' ')}`);
        {
            const { exitCode } = await exec.getExecOutput(`"${bootstrapPath}"`, bootstrapArgs, {
                cwd: this.inputs.sourceDir,
                ignoreReturnCode: true
            });
            if (exitCode !== 0) {
                throw new Error(`B2 bootstrap failed with exit code ${exitCode}`);
            }
        }
        process.env['CXX'] = prevCxx;
        core.endGroup();
    }

    /**
     * Bootstraps Boost headers by running `b2 headers`.
     *
     * @throws Error if B2 headers bootstrap fails
     */
    private async bootstrapHeaders(): Promise<void> {
        const fnlog = traceCommands.scoped('bootstrapHeaders');
        core.startGroup('🔎 Bootstrap headers');
        this.b2Path = path.join(this.inputs.sourceDir, 'b2' + (process.platform === 'win32' ? '.exe' : ''));
        fnlog(`b2Path: ${this.b2Path}`);
        const bootstrapHeadersArgs = ['headers'];
        core.info(`💻 ${this.inputs.sourceDir}> ${this.b2Path} ${bootstrapHeadersArgs.join(' ')}`);
        {
            const { exitCode } = await exec.getExecOutput(`"${this.b2Path}"`, bootstrapHeadersArgs, {
                cwd: this.inputs.sourceDir,
                ignoreReturnCode: true
            });
            if (exitCode !== 0) {
                throw new Error(`B2 headers failed with exit code ${exitCode}`);
            }
        }
        core.endGroup();
    }

    /**
     * Builds B2 command-line arguments and runs the build/test step.
     *
     * In B2, all the configure/build/test/install/package steps are
     * combined into a single invocation.
     *
     * @throws Error if B2 build fails
     */
    private async buildAndTest(): Promise<void> {
        core.startGroup('🛠️ Build and Test');

        let b2Args = this.buildBasicArgs();
        b2Args = b2Args.concat(this.buildFlagArgs());
        b2Args = b2Args.concat(this.buildB2SpecificArgs());
        b2Args = b2Args.concat(this.buildModuleArgs());

        const fnlog = traceCommands.scoped('buildAndTest');
        core.info(`💻 ${this.inputs.sourceDir}> ${this.b2Path} ${b2Args.join(' ')}`);
        for (const arg of b2Args) {
            fnlog(`arg: ${arg} (${typeof arg})`);
        }
        const { exitCode } = await exec.getExecOutput(`"${this.b2Path}"`, b2Args, {
            cwd: this.inputs.sourceDir,
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            throw new Error(`B2 build failed with exit code ${exitCode}`);
        }
        core.endGroup();
    }

    /**
     * Builds basic B2 configuration arguments (build dir, jobs, toolset, address model,
     * architecture, cxxstd, build type, extra args).
     *
     * @returns Array of basic B2 arguments
     */
    private buildBasicArgs(): string[] {
        let b2Args: string[] = [];
        if (this.inputs.buildDir) {
            b2Args.push(`--build-dir=${this.inputs.buildDir}`);
        }
        b2Args.push('-j');
        b2Args.push(`${this.inputs.jobs}`);
        if (this.inputs.toolset) {
            b2Args.push(`--toolset=${this.inputs.toolset}`);
        }
        if (this.addressModel) {
            b2Args.push(`address-model=${this.addressModel}`);
        }
        if (this.archConfig.architecture) {
            b2Args.push(`architecture=${this.archConfig.architecture}`);
        }
        if (this.inputs.cxxstd) {
            b2Args.push(`cxxstd=${this.inputs.cxxstd}`);
        }
        if (this.inputs.buildType) {
            if (this.inputs.buildType === 'relwithdebinfo') {
                b2Args.push('variant=release');
                b2Args.push('debug-symbols=on');
            } else {
                b2Args.push(`variant=${this.inputs.buildType}`);
            }
        }
        if (this.inputs.extraArgs) {
            b2Args = b2Args.concat(this.inputs.extraArgs);
        }
        return b2Args;
    }

    /**
     * Builds compiler flag arguments (cxxflags, ccflags, linkflags).
     *
     * @returns Array of flag arguments
     */
    private buildFlagArgs(): string[] {
        const args: string[] = [];
        if (this.inputs.cxxflags) {
            args.push(`cxxflags=${this.inputs.cxxflags}`);
        }
        if (this.inputs.ccflags) {
            args.push(`cflags=${this.inputs.ccflags}`);
        }
        if (this.inputs.linkflags) {
            args.push(`linkflags=${this.inputs.linkflags}`);
        }
        return args;
    }

    /**
     * Builds B2-specific option arguments (threading, shared, sanitizers, debug flags, etc.).
     *
     * @returns Array of B2-specific arguments
     */
    private buildB2SpecificArgs(): string[] {
        const args: string[] = [];

        if (this.inputs.threading) {
            args.push(`threading=${this.inputs.threading}`);
        }
        if (this.inputs.shared === true) {
            args.push('link=shared');
        } else if (this.inputs.shared === false) {
            args.push('link=static');
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
            const inputVal = parseBoolOrString(this.inputs[option.key as keyof Inputs] as string);
            if (typeof inputVal === 'string') {
                if (inputVal !== '') {
                    args.push(`${option.b2Key}=${inputVal}`);
                }
            } else if (inputVal || typeof inputVal === 'boolean') {
                if (option.falseValue !== undefined) {
                    args.push(`${option.b2Key}=${inputVal ? option.trueValue : option.falseValue}`);
                } else if (inputVal) {
                    args.push(`${option.b2Key}=${option.trueValue}`);
                }
            }
        }

        if (this.inputs.coverage) {
            args.push('coverage=on');
        }
        if (this.inputs.toolset === 'clang-win') {
            args.push('embed-manifest-via=linker');
        }
        if (this.inputs.cleanAll) {
            args.push('--clean-all');
        } else if (this.inputs.clean) {
            args.push('--clean');
        }

        if (this.inputs.abbreviatePaths) {
            args.push('--abbreviate-paths');
        } else if (this.inputs.hash) {
            args.push('--hash');
        }
        if (this.inputs.rebuildAll) {
            args.push('-a');
        }
        if (this.inputs.dryRun) {
            args.push('-n');
        }
        if (this.inputs.stopOnError) {
            args.push('-q');
        }

        if (this.inputs.config) {
            args.push(`--config=${this.inputs.config}`);
        }
        if (this.inputs.siteConfig) {
            args.push(`--site-config=${this.inputs.siteConfig}`);
        }
        if (this.inputs.userConfig) {
            args.push(`--user-config=${this.inputs.userConfig}`);
        }
        if (this.inputs.projectConfig) {
            args.push(`--project-config=${this.inputs.projectConfig}`);
        }
        if (this.inputs.debugConfiguration) {
            args.push('--debug-configuration');
        }
        if (this.inputs.debugBuilding) {
            args.push('--debug-building');
        }
        if (this.inputs.debugGenerators) {
            args.push('--debug-generators');
        }
        if (this.inputs.include) {
            args.push(`--include=${this.inputs.include}`);
        }
        if (this.inputs['define']) {
            args.push(`--define=${this.inputs['define']}`);
        }

        return args;
    }

    /**
     * Builds module target arguments from modules and moduleTarget inputs.
     *
     * @returns Array of module target arguments
     */
    private buildModuleArgs(): string[] {
        const args: string[] = [];
        const moduleTargetsRaw = Array.isArray(this.inputs.moduleTarget) ? this.inputs.moduleTarget : [];
        let moduleTargets = moduleTargetsRaw
            .map((target: string) => (target && target.trim ? target.trim() : target))
            .filter((target: string) => target);
        if (moduleTargets.length === 0) {
            moduleTargets = ['test'];
        }
        for (const moduleEntry of this.inputs.modules) {
            const module = moduleEntry && moduleEntry.trim ? moduleEntry.trim() : moduleEntry;
            if (!module) {
                continue;
            }
            const hasExplicitTarget = module.includes('/') || module.includes('\\') || module.includes(':');
            if (hasExplicitTarget) {
                args.push(module);
            } else {
                for (const target of moduleTargets) {
                    args.push(`libs/${module}/${target}`);
                }
            }
        }
        return args;
    }
}

/**
 * Executes a Boost.Build (B2) workflow for building and testing C++ libraries.
 *
 * @param inputs - Parsed inputs from schema (transforms already applied)
 * @throws Error if B2 bootstrap, headers, or build fails
 */
export async function main(inputs: Inputs): Promise<void> {
    return new B2WorkflowRunner(inputs).run();
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
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'B2 Workflow',
    main: async (inputs: Inputs) => {
        await main(inputs);
        return {};
    },
    callerModule: module
});

export { main as default };
