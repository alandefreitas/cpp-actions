import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as io from '@actions/io';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import {
    type ResolvedInputs,
    type SetupCMakeOutputs,
    type ResolvedParameters
} from './types';

import { type Inputs } from './schema';

// Schema imports
import { inputsSchema, outputsSchema } from './schema';
export { inputsSchema, outputsSchema };

import { resolvePreset } from './presets';
import { normalizeArchitectureInput, deriveGeneratorArchitectureFromArch, setupDefaultGenerator } from './generators';
import { downloadSourceCode, applyPatches } from './source-download';
import {
    expandInputs,
    validateUniquePaths,
    normalizePath,
    applyPresetMacros
} from './input-expansion';

import { processEntry, makeFactorDescription } from './process-entry';

import * as setup_cmake from 'setup-cmake';

// Re-export types used by process-entry and other modules
export type { SetupCMakeOutputs, ResolvedParameters };

/**
 * Resolves a compiler path by looking it up on PATH or fixing extensions.
 *
 * @param compiler - Compiler name or path to resolve
 * @returns Resolved compiler path
 */
async function resolveCompilerPath(compiler: string): Promise<string> {
    if (!compiler) {
        return compiler;
    }
    const fnlog = traceCommands.scoped('resolveCompilerPath');
    // If it's only an application name, try to find it in PATH
    const isNameOnly = path.basename(compiler) === compiler;
    if (isNameOnly) {
        try {
            return await io.which(compiler);
        } catch {
            fnlog(`Could not find ${compiler} in PATH`);
            return compiler;
        }
    }
    // If it's a relative path, resolve it
    const isRelative = compiler.startsWith('.');
    if (isRelative) {
        compiler = path.resolve(compiler);
    }
    // Check if we need to add .exe to the compiler path on windows
    if (process.platform === 'win32' && !compiler.endsWith('.exe')) {
        const compilerWithExe = compiler + '.exe';
        if (fs.existsSync(compilerWithExe) && !fs.existsSync(compiler)) {
            compiler = compilerWithExe;
        }
    }
    return compiler;
}

/**
 * Resolves and validates CMake workflow input parameters.
 *
 * Applies presets, sets default values, identifies generator features,
 * resolves compiler paths, and prepares all parameters needed for the build.
 *
 * @param inputs - Raw input parameters from the action
 * @param setupCMakeOutputs - Outputs from CMake setup including paths and version info
 * @returns Resolved parameters ready for the CMake workflow execution
 */
async function resolveInputParameters(inputs: Inputs, setupCMakeOutputs: SetupCMakeOutputs): Promise<ResolvedParameters> {
    // ----------------------------------------------
    // Identify and apply preset to input args
    // ----------------------------------------------
    resolvePreset(inputs, setupCMakeOutputs);

    // ----------------------------------------------
    // Set default values
    // ----------------------------------------------
    if (!inputs.preset) {
        // We don't set these when there's a preset because
        // it might be defined there
        inputs.buildType = inputs.buildType || 'Release';
        inputs.buildDir = inputs.buildDir || 'build';
    }
    inputs.cmakePath = setupCMakeOutputs.path || 'cmake';

    // ----------------------------------------------
    // Identify generator features
    // ----------------------------------------------
    if (!inputs.generator && !inputs.preset) {
        await setupDefaultGenerator(inputs);
    }
    let generatorIsMultiConfig = false;
    if (inputs.generator) {
        generatorIsMultiConfig = inputs.generator.startsWith('Visual Studio') || ['Ninja Multi-Config', 'Xcode'].includes(inputs.generator);
        core.info(`🔄 Generator "${inputs.generator}" ${generatorIsMultiConfig ? 'IS' : 'is NOT'} multi-config`);
    }

    // ----------------------------------------------
    // Find other cmake tools
    // ----------------------------------------------
    const ctestPath = path.join(setupCMakeOutputs.dir, 'ctest');
    core.info(`🧩 ctestPath: ${ctestPath}`);
    const cpackPath = path.join(setupCMakeOutputs.dir, 'cpack');
    core.info(`🧩 cpackPath: ${cpackPath}`);

    // ----------------------------------------------
    // Identify complete compiler paths
    // ----------------------------------------------
    inputs.cc = await resolveCompilerPath(inputs.cc);
    core.info(`🧩 cc: ${inputs.cc}`);
    inputs.cxx = await resolveCompilerPath(inputs.cxx);
    core.info(`🧩 cxx: ${inputs.cxx}`);

    // ----------------------------------------------
    // Identify C++ standards to test
    // ----------------------------------------------
    if (inputs.cxxstd.length === 0) {
        // Null element represents the default compiler
        inputs.cxxstd = [null];
    }
    core.info(`🧩 cxxstd: ${inputs.cxxstd.map(element => (element === null ? '<default>' : element))}`);
    const mainCxxstd = inputs.cxxstd[inputs.cxxstd.length - 1];
    core.info(`🧩 mainCxxstd: ${mainCxxstd === null ? '<default>' : mainCxxstd}`);

    // ----------------------------------------------
    // Resolve paths
    // ----------------------------------------------
    inputs.sourceDir = path.resolve(applyPresetMacros(inputs.sourceDir, inputs) as string);
    if (inputs.buildDir) {
        inputs.buildDir = path.resolve(inputs.sourceDir, applyPresetMacros(inputs.buildDir, inputs) as string);
    }
    if (inputs.installPrefix) {
        inputs.installPrefix = normalizePath(path.resolve(applyPresetMacros(inputs.installPrefix, inputs) as string));
    }
    if (inputs.packageDir) {
        inputs.packageDir = normalizePath(path.resolve(inputs.buildDir, applyPresetMacros(inputs.packageDir, inputs) as string));
    }

    // Apply preset macros to the inputs that accept them
    inputs = applyPresetMacros(inputs, inputs) as Inputs;

    // ----------------------------------------------
    // Print the adjusted parameters
    // ----------------------------------------------
    for (const [name, value] of Object.entries(inputs)) {
        core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`);
    }

    return {
        mainCxxstd,
        generatorIsMultiConfig,
        ctestPath,
        cpackPath
    };
}

/**
 * Orchestrates the CMake workflow pipeline: download, patch, setup,
 * resolve parameters, expand factors, and process each entry.
 *
 * Inputs are frozen at construction time. A mutable working copy is
 * created during execution so the original inputs are never modified.
 */
class CmakeWorkflowRunner {
    /** Original inputs, frozen at construction time */
    private readonly inputs: Readonly<Inputs>;

    /** Outputs from the setup-cmake step */
    private setupCMakeOutputs!: SetupCMakeOutputs;

    /** Resolved parameters computed during input resolution */
    private resolvedParams!: ResolvedParameters;

    /**
     * Creates a new CmakeWorkflowRunner.
     *
     * @param inputs - Converted input parameters for the workflow
     */
    constructor(inputs: Inputs) {
        this.inputs = Object.freeze({ ...inputs });
    }

    /**
     * Runs the full CMake workflow pipeline.
     *
     * @throws Error if any CMake step fails
     */
    async run(): Promise<void> {
        // Create a mutable working copy so this.inputs stays frozen
        const inputs = this.createWorkingInputs();

        // ==============================================
        // Download source code (once)
        // ==============================================
        if (inputs.url || inputs.gitRepository) {
            core.startGroup(`🌎 Download source code`);
            await downloadSourceCode(inputs);
            core.endGroup();
        }

        // ==============================================
        // Apply patches (once)
        // ==============================================
        if (inputs.patches.length > 0) {
            core.startGroup(`🩹 Apply patches`);
            await applyPatches(inputs);
            core.endGroup();
        }

        // ==============================================
        // Setup CMake (once)
        // ==============================================
        core.startGroup(`🔎 Setup CMake`);
        this.setupCMakeOutputs = await setup_cmake.main({
            traceCommands: inputs.traceCommands,
            version: inputs.cmakeVersion,
            cmakeFile: path.resolve(inputs.sourceDir, 'CMakeLists.txt'),
            path: inputs.cmakePath,
            cmakePath: 'cmake',
            cache: false,
            checkLatest: false,
            updateEnvironment: false
        } as setup_cmake.Inputs, false) as unknown as SetupCMakeOutputs;
        if (!this.setupCMakeOutputs.path) {
            throw new Error('CMake not found');
        }
        inputs.cmakePath = this.setupCMakeOutputs.path;
        core.endGroup();

        // ==============================================
        // Resolve parameters (once)
        // ==============================================
        core.startGroup(`🎛️ CMake parameters`);
        this.resolvedParams = await resolveInputParameters(inputs, this.setupCMakeOutputs);
        core.endGroup();

        // ==============================================
        // Expand combinatorial factors
        // ==============================================
        core.startGroup(`🔢 Expand factor combinations`);
        const entries = expandInputs(inputs);
        validateUniquePaths(entries);
        core.info(`📊 Expanded to ${entries.length} factor combination(s)`);
        for (const entry of entries) {
            const desc = makeFactorDescription(entry);
            core.info(`  • ${desc}: buildDir=${entry.buildDir}`);
        }
        core.endGroup();

        // ==============================================
        // Process each entry
        // ==============================================
        for (const entry of entries) {
            const desc = makeFactorDescription(entry);
            core.startGroup(`🧩 Processing: ${desc}`);
            await this.processEntry(entry);
            core.endGroup();
        }
    }

    /**
     * Processes a single resolved entry through the CMake workflow.
     *
     * Delegates to the standalone processEntry function, supplying
     * class members so the caller does not need to thread them.
     *
     * @param entry - Resolved inputs for this factor combination
     * @throws Error if any step fails
     */
    private async processEntry(entry: ResolvedInputs): Promise<void> {
        return processEntry(entry, this.setupCMakeOutputs, this.resolvedParams);
    }

    /**
     * Creates a mutable deep copy of inputs for pipeline execution.
     *
     * Array fields are shallow-copied so that mutations during
     * resolution (e.g., pushes to extraArgs) do not affect the
     * frozen original.
     *
     * @returns Mutable copy of inputs
     */
    private createWorkingInputs(): Inputs {
        return {
            ...this.inputs,
            cxxstd: [...this.inputs.cxxstd],
            patches: [...this.inputs.patches],
            buildTarget: [...this.inputs.buildTarget],
            packageGenerators: [...this.inputs.packageGenerators],
            extraArgs: Array.isArray(this.inputs.extraArgs)
                ? [...this.inputs.extraArgs]
                : Object.fromEntries(
                    Object.entries(this.inputs.extraArgs as Record<string, string[]>)
                        .map(([k, v]) => [k, [...v]])
                ),
        };
    }
}

/**
 * Main entry point for the CMake workflow.
 *
 * Delegates to CmakeWorkflowRunner which orchestrates all pipeline
 * phases with frozen inputs and class-level state management.
 *
 * @param inputs - Configuration inputs for the workflow
 * @throws Error if any CMake step (configure, build, test, install) fails
 */
export async function main(inputs: Inputs): Promise<void> {
    return new CmakeWorkflowRunner(inputs).run();
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'CMake Workflow',
    main: async (inputs: Inputs) => {
        await main(inputs);
        return {};
    },
    callerModule: module
});

export {
    processEntry,
    expandInputs as _expandInputs,
    validateUniquePaths as _validateUniquePaths,
    resolveInputParameters as _resolveInputParameters,
    normalizePath as _normalizePathForCMake,
    deriveGeneratorArchitectureFromArch as _deriveGeneratorArchitectureFromArch,
    normalizeArchitectureInput as _normalizeArchitectureInput,
    applyPatches as _applyPatches
};
