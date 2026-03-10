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

// Type imports and re-exports
import { Inputs, Outputs, MainOutputs, BuildOutputsMetadata } from './types'
export type { Inputs, Outputs, MainOutputs, BuildOutputsMetadata }

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
 * Configures the MSVC developer command prompt and returns compiler metadata for action outputs.
 *
 * @param arch - Target architecture (x86, x64, arm64, etc.).
 * @param sdk - Optional SDK version requested by the caller.
 * @param toolset - MSVC toolset version (vcvars_ver) override.
 * @param uwp - Whether to configure the UWP SDK ("true" to enable).
 * @param spectre - Whether to enable Spectre mitigated libraries ("true" to enable).
 * @param vsversion - Visual Studio version/year selector for discovery.
 * @returns Paths and version fields suitable for action outputs.
 * @throws Error when executed outside Windows or when vcvarsall cannot be located
 *
 * @example
 * const outputs = await configureMSVCEnvironment('x64', '', '', '', '', '2022')
 * core.info(outputs.cc)
 *
 * @remarks
 * The function throws when executed outside Windows or when vcvarsall cannot be
 * located. If the environment contains multiple Visual Studio versions the
 * `vsversion` filter keeps the selection deterministic.
 */
async function configureMSVCEnvironment(arch: string, sdk: string, toolset: string, uwp: string, spectre: string, vsversion: string): Promise<Outputs> {
    if (!arch) {
        arch = getDefaultArch()
    }
    if (process.platform !== 'win32') {
        throw new Error('MSVC compiler setup is only supported on Windows environments')
    }

    // Add standard location of "vswhere" to PATH, in case it's not there.
    process.env.PATH += path.delimiter + VSWHERE_PATH

    // There are all sorts of way the architectures are called. In addition to
    // values supported by Microsoft Visual C++, recognize some common aliases.
    let arch_aliases: Record<string, string> = {
        'win32': 'x86',
        'win64': 'x64',
        'x86_64': 'x64',
        'x86-64': 'x64'
    }
    // Ignore case when matching as that's what humans expect.
    if (arch.toLowerCase() in arch_aliases) {
        arch = arch_aliases[arch.toLowerCase()]
    }

    // Due to the way Microsoft Visual C++ is configured, we have to resort to the following hack:
    // Call the configuration batch file and then output *all* the environment variables.

    const args: string[] = [arch]
    if (uwp == 'true') {
        args.push('uwp')
    }
    if (sdk) {
        args.push(sdk)
    }

    core.startGroup('🔍 Find vcvarsall.bat')
    const vcvarsallPath = findVcvarsall(vsversion)
    const installedToolsets = listInstalledToolsets(vcvarsallPath)
    core.startGroup('📦 Installed MSVC toolsets')
    if (installedToolsets.length > 0) {
        core.info(`Available toolsets: [${installedToolsets.join(', ')}]`)
    } else {
        core.info(`No MSVC toolset folders were detected under ${path.join(path.dirname(path.dirname(path.dirname(vcvarsallPath))), 'Tools', 'MSVC')}`)
    }
    core.endGroup()
    const resolvedToolset = selectToolsetVersion(toolset, installedToolsets)
    if (toolset && !resolvedToolset) {
        core.startGroup('⚠️ Toolset warning')
        core.warning(`Requested toolset version '${toolset}' not found. Available versions: [${installedToolsets.join(', ')}]. Falling back to Visual Studio default.`)
        core.endGroup()
    }
    if (resolvedToolset) {
        args.push(`-vcvars_ver=${resolvedToolset}`)
    }
    if (spectre == 'true') {
        args.push('-vcvars_spectre_libs=spectre')
    }
    const vcvars = `"${vcvarsallPath}" ${args.join(' ')}`
    core.debug(`vcvars command-line: ${vcvars}`)

    const cmd_output_string = child_process.execSync(`set && cls && ${vcvars} && cls && set`, {shell: 'cmd'}).toString()
    const cmd_output_parts = cmd_output_string.split('\f')

    const old_environment = cmd_output_parts[0].split('\r\n')
    const vcvars_output = cmd_output_parts[1].split('\r\n')
    const new_environment = cmd_output_parts[2].split('\r\n')

    // If vsvars.bat is given an incorrect command line, it will print out
    // an error and *still* exit successfully. Parse out errors from output
    // which don't look like environment variables, and fail if appropriate.
    const error_messages = vcvars_output.filter((line) => {
        if (line.match(/^\[ERROR.*\]/)) {
            // Don't print this particular line which will be confusing in output.
            if (!line.match(/Error in script usage. The correct usage is:$/)) {
                return true
            }
        }
        return false
    })
    if (error_messages.length > 0) {
        throw new Error('invalid parameters' + '\r\n' + error_messages.join('\r\n'))
    }

    // Convert old environment lines into a dictionary for easier lookup.
    let old_env_vars: Record<string, string> = {}
    for (let string of old_environment) {
        const [name, value] = string.split('=')
        old_env_vars[name] = value
    }
    core.endGroup()

    // Now look at the new environment and export everything that changed.
    // These are the variables set by vsvars.bat. Also export everything
    // that was not there during the first sweep: those are new variables.
    core.startGroup('📘 Environment Variables')
    for (let string of new_environment) {
        // vsvars.bat likes to print some fluff at the beginning.
        // Skip lines that don't look like environment variables.
        if (!string.includes('=')) {
            continue
        }
        let [name, new_value] = string.split('=')
        let old_value = old_env_vars[name]
        // For new variables "old_value === undefined".
        if (new_value !== old_value) {
            core.info(`Setting ${name}`)
            // Special case for a bunch of PATH-like variables: vcvarsall.bat
            // just prepends its stuff without checking if its already there.
            // This makes repeated invocations of this action fail after some
            // point, when the environment variable overflows. Avoid that.
            if (isPathVariable(name)) {
                new_value = deduplicatePathValue(new_value)
            }
            core.exportVariable(name, new_value)
        }
    }

    core.info(`Configured Developer Command Prompt`)
    core.endGroup()

    const compilerPath = await findMSVCCompilerExecutable()
    if (compilerPath === null) {
        throw new Error('Cannot find cl.exe after configuring the MSVC developer command prompt')
    }

    const compilerVersion = await getMSVCCompilerVersion(compilerPath)

    return buildMSVCOutputs(compilerPath, process.env, {compilerVersion: compilerVersion ?? undefined})
}

/**
 * Sets up MSVC (Microsoft Visual C++) compiler on the runner.
 *
 * This function configures the MSVC environment by locating Visual Studio
 * installations, setting up the appropriate toolset and SDK, and updating
 * environment variables for compilation.
 *
 * @param version - The MSVC toolset version (e.g., "14.3", "14.29"). Use "*" for default.
 * @param arch - Target architecture: 'x86', 'x64', 'arm', or 'arm64'
 * @param sdk - Windows SDK version (e.g., "10.0.19041.0"). Empty string for default.
 * @param toolset - Explicit toolset version. If empty, derived from version parameter.
 * @param uwp - If true, configure for Universal Windows Platform development
 * @param spectre - If true, use Spectre-mitigated libraries
 * @param vsversion - Visual Studio version (e.g., "2022", "2019"). Empty for auto-detect.
 * @returns Object containing compiler paths, version info, and environment changes
 */
export async function main(version: string, arch: string, sdk: string, toolset: string, uwp: boolean, spectre: boolean, vsversion: string): Promise<MainOutputs> {
    const resolvedArch = arch || getDefaultArch()
    const resolvedToolset = toolset || (version && version !== '*' ? version : '')
    const normalizedUwp = uwp ? 'true' : 'false'
    const normalizedSpectre = spectre ? 'true' : 'false'

    const outputs = await configureMSVCEnvironment(
        resolvedArch,
        sdk || '',
        resolvedToolset,
        normalizedUwp,
        normalizedSpectre,
        vsversion || ''
    )

    return {
        ...outputs,
        version: outputs.release
    }
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
        const outputs = await main(
            inputs.version,
            inputs.arch,
            inputs.sdk,
            inputs.toolset,
            inputs.uwp,
            inputs.spectre,
            inputs.visual_studio_version
        )

        return outputs
    },
    callerModule: module
})
