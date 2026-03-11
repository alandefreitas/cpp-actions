/**
 * Main entry point for setup-msvc action.
 *
 * @module index
 */

import * as core from '@actions/core'
import * as child_process from 'child_process'
import * as path from 'path'
import * as process from 'process'
import { runAction } from 'action-schema'

// Type imports
import type { InferInputs } from 'action-schema'
import { type Outputs, type BuildOutputsMetadata } from './compiler'
export type { Outputs, BuildOutputsMetadata }

/**
 * Input configuration for the setup-msvc action.
 * Inferred from the schema definition in schema.ts.
 */
export type Inputs = InferInputs<typeof inputsSchema>

/**
 * Extended output values including the version string.
 */
export interface MainOutputs extends Outputs {
    version: string
}

// Schema imports
import { inputsSchema, outputsSchema } from './schema'
export { inputsSchema, outputsSchema }

// Module imports
import { listInstalledToolsets, selectToolsetVersion } from './version-utils'
import { findVcvarsall, VSWHERE_PATH } from './discovery'
import { isPathVariable, deduplicatePathValue } from './environment'
import { findMSVCCompilerExecutable, getMSVCCompilerVersion } from './compiler'
import { buildMSVCOutputs } from './compiler'

// Re-exports for external consumers
export { releaseYearToProductVersion, productVersionToReleaseYear } from './version-utils'
export { buildMSVCOutputs } from './compiler'

/**
 * Returns the default target architecture based on processor architecture.
 *
 * @returns The processor architecture from environment or "x64" as fallback
 */
function getDefaultArch(): string {
    return process.env['PROCESSOR_ARCHITECTURE'] || 'x64'
}

/**
 * Orchestrates MSVC developer command prompt configuration and compiler discovery.
 *
 * Pipeline phases:
 * 1. Validate platform and resolve architecture aliases
 * 2. Locate vcvarsall.bat and resolve toolset version
 * 3. Execute vcvarsall and apply environment diff
 * 4. Find compiler executable and read its version
 * 5. Build output metadata
 */
class SetupMsvcRunner {
    /** Frozen copy of action inputs. */
    private readonly inputs: Readonly<Inputs>

    /** Resolved target architecture after alias normalization. */
    private arch!: string

    /** Path to the located vcvarsall.bat script. */
    private vcvarsallPath!: string

    /** Resolved MSVC toolset version after matching against installed versions. */
    private resolvedToolset: string | null = null

    /** Absolute path to cl.exe after environment configuration. */
    private compilerPath: string | null = null

    /** MSVC front-end compiler version string (e.g., 19.44.35219). */
    private compilerVersion: string | null = null

    /**
     * Creates a new runner with frozen inputs.
     *
     * @param inputs - Action inputs from schema.
     */
    constructor(inputs: Inputs) {
        this.inputs = { ...inputs }
    }

    /**
     * Executes the full MSVC setup pipeline and returns action outputs.
     *
     * @returns Compiler paths, version info, and environment changes.
     * @throws {Error} When executed outside Windows or when vcvarsall cannot be located.
     */
    async run(): Promise<MainOutputs> {
        this.resolveArchitecture()
        this.validatePlatform()
        this.addVswherePath()
        this.normalizeArchAliases()
        const vcvarsArgs = this.buildVcvarsArgs()
        this.discoverToolset(vcvarsArgs)
        this.executeVcvarsAndApplyEnvironment(vcvarsArgs)
        await this.findCompiler()
        return this.buildOutputs()
    }

    /**
     * Resolves the target architecture from inputs, falling back to processor architecture.
     */
    private resolveArchitecture(): void {
        this.arch = this.inputs.arch || getDefaultArch()
    }

    /**
     * Validates that the current platform is Windows.
     *
     * @throws {Error} When not running on Windows.
     */
    private validatePlatform(): void {
        if (process.platform !== 'win32') {
            throw new Error('MSVC compiler setup is only supported on Windows environments')
        }
    }

    /**
     * Adds the standard vswhere location to PATH.
     */
    private addVswherePath(): void {
        process.env.PATH += path.delimiter + VSWHERE_PATH
    }

    /**
     * Normalizes common architecture aliases to values accepted by vcvarsall.
     */
    private normalizeArchAliases(): void {
        const archAliases: Record<string, string> = {
            'win32': 'x86',
            'win64': 'x64',
            'x86_64': 'x64',
            'x86-64': 'x64'
        }
        if (this.arch.toLowerCase() in archAliases) {
            this.arch = archAliases[this.arch.toLowerCase()]
        }
    }

    /**
     * Builds the initial vcvarsall argument list from inputs (arch, uwp, sdk).
     *
     * @returns Array of command-line arguments for vcvarsall.bat.
     */
    private buildVcvarsArgs(): string[] {
        const args: string[] = [this.arch]
        if (this.inputs.uwp) {
            args.push('uwp')
        }
        if (this.inputs.sdk) {
            args.push(this.inputs.sdk)
        }
        return args
    }

    /**
     * Locates vcvarsall.bat, lists installed toolsets, and resolves the requested toolset version.
     *
     * @param vcvarsArgs - Argument list to append toolset/spectre flags to.
     */
    private discoverToolset(vcvarsArgs: string[]): void {
        const resolvedToolsetInput = this.inputs.toolset || (this.inputs.version && this.inputs.version !== '*' ? this.inputs.version : '')

        core.startGroup('🔍 Find vcvarsall.bat')
        this.vcvarsallPath = findVcvarsall(this.inputs.visualStudioVersion || '')
        const installedToolsets = listInstalledToolsets(this.vcvarsallPath)
        core.startGroup('📦 Installed MSVC toolsets')
        if (installedToolsets.length > 0) {
            core.info(`Available toolsets: [${installedToolsets.join(', ')}]`)
        } else {
            core.info(`No MSVC toolset folders were detected under ${path.join(path.dirname(path.dirname(path.dirname(this.vcvarsallPath))), 'Tools', 'MSVC')}`)
        }
        core.endGroup()
        this.resolvedToolset = selectToolsetVersion(resolvedToolsetInput, installedToolsets)
        if (resolvedToolsetInput && !this.resolvedToolset) {
            core.startGroup('⚠️ Toolset warning')
            core.warning(`Requested toolset version '${resolvedToolsetInput}' not found. Available versions: [${installedToolsets.join(', ')}]. Falling back to Visual Studio default.`)
            core.endGroup()
        }
        if (this.resolvedToolset) {
            vcvarsArgs.push(`-vcvars_ver=${this.resolvedToolset}`)
        }
        if (this.inputs.spectre) {
            vcvarsArgs.push('-vcvars_spectre_libs=spectre')
        }
    }

    /**
     * Executes vcvarsall.bat via cmd, captures the environment diff, and exports changed variables.
     *
     * @param vcvarsArgs - Complete argument list for vcvarsall.bat.
     * @throws {Error} When vcvarsall reports errors in its output.
     */
    private executeVcvarsAndApplyEnvironment(vcvarsArgs: string[]): void {
        const vcvars = `"${this.vcvarsallPath}" ${vcvarsArgs.join(' ')}`
        core.debug(`vcvars command-line: ${vcvars}`)

        const cmdOutputString = child_process.execSync(`set && cls && ${vcvars} && cls && set`, {shell: 'cmd'}).toString()
        const cmdOutputParts = cmdOutputString.split('\f')

        const oldEnvironment = cmdOutputParts[0].split('\r\n')
        const vcvarsOutput = cmdOutputParts[1].split('\r\n')
        const newEnvironment = cmdOutputParts[2].split('\r\n')

        const errorMessages = vcvarsOutput.filter((line) => {
            if (line.match(/^\[ERROR.*\]/)) {
                if (!line.match(/Error in script usage. The correct usage is:$/)) {
                    return true
                }
            }
            return false
        })
        if (errorMessages.length > 0) {
            throw new Error('invalid parameters' + '\r\n' + errorMessages.join('\r\n'))
        }

        const oldEnvVars: Record<string, string> = {}
        for (const string of oldEnvironment) {
            const [name, value] = string.split('=')
            oldEnvVars[name] = value
        }
        core.endGroup()

        core.startGroup('📘 Environment Variables')
        for (const string of newEnvironment) {
            if (!string.includes('=')) {
                continue
            }
            const parts = string.split('=')
            const name = parts[0]
            let newValue = parts[1]
            const oldValue = oldEnvVars[name]
            if (newValue !== oldValue) {
                core.info(`Setting ${name}`)
                if (isPathVariable(name)) {
                    newValue = deduplicatePathValue(newValue)
                }
                core.exportVariable(name, newValue)
            }
        }

        core.info(`Configured Developer Command Prompt`)
        core.endGroup()
    }

    /**
     * Locates cl.exe on PATH and reads its version.
     *
     * @throws {Error} When cl.exe cannot be found after environment configuration.
     */
    private async findCompiler(): Promise<void> {
        this.compilerPath = await findMSVCCompilerExecutable()
        if (this.compilerPath === null) {
            throw new Error('Cannot find cl.exe after configuring the MSVC developer command prompt')
        }
        this.compilerVersion = await getMSVCCompilerVersion(this.compilerPath)
    }

    /**
     * Assembles the final action outputs from compiler metadata.
     *
     * @returns MainOutputs with compiler paths, version info, and environment changes.
     */
    private buildOutputs(): MainOutputs {
        const outputs = buildMSVCOutputs(this.compilerPath!, process.env, {compilerVersion: this.compilerVersion ?? undefined})
        return {
            ...outputs,
            version: outputs.release
        }
    }
}

/**
 * Sets up MSVC (Microsoft Visual C++) compiler on the runner.
 *
 * Configures the MSVC environment by locating Visual Studio installations,
 * setting up the appropriate toolset and SDK, and updating environment
 * variables for compilation.
 *
 * @param inputs - Action inputs containing version, arch, sdk, toolset, uwp, spectre, and vsversion.
 * @returns Object containing compiler paths, version info, and environment changes.
 * @throws {Error} When executed outside Windows or when vcvarsall cannot be located.
 */
export async function main(inputs: Inputs): Promise<MainOutputs> {
    return new SetupMsvcRunner(inputs).run()
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
    title: 'Setup MSVC',
    main: async (inputs: Inputs) => {
        return main(inputs)
    },
    callerModule: module
})
