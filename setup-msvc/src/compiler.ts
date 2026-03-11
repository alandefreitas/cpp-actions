/**
 * MSVC compiler detection and version retrieval utilities.
 *
 * @module compiler
 */

import * as core from '@actions/core'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as semver from 'semver'

import { type Outputs, type BuildOutputsMetadata } from './types'
import { productVersionToReleaseYear, inferToolsetVersionFromPath } from './version-utils'

/**
 * Searches the PATH for cl.exe, accounting for different executable spellings.
 *
 * @returns Absolute path to the compiler executable when found.
 *
 * @example
 * const clPath = await findMSVCCompilerExecutable()
 *
 * @remarks
 * The lookup simply walks PATH via {@link io.which}; if users override PATH
 * afterwards the helper may surface stale entries, so call it only after
 * configuring the Developer Command Prompt.
 */
export async function findMSVCCompilerExecutable(): Promise<string | null> {
    const candidates = ['cl.exe', 'cl']
    for (const candidate of candidates) {
        try {
            const resolved = await io.which(candidate)
            if (resolved) {
                core.debug(`Found ${candidate} at ${resolved}`)
                return resolved
            }
        } catch (error) {
            core.debug(`Could not locate ${candidate}: ${error}`)
        }
    }
    return null
}

/**
 * Reads the MSVC front-end compiler version (e.g., 19.44.35219) using `cl /Bv`.
 * @param compilerPath - Absolute path to cl.exe.
 * @returns Version string when it can be parsed, otherwise null.
 */
export async function getMSVCCompilerVersion(compilerPath: string): Promise<string | null> {
    if (!compilerPath) {
        return null
    }
    try {
        const {stdout} = await exec.getExecOutput(compilerPath, ['/Bv'], {ignoreReturnCode: true})
        const match = stdout.match(/Compiler Version ([0-9.]+)/i)
        if (match) {
            return match[1]
        }
    } catch (error) {
        core.debug(`Failed to detect MSVC compiler version: ${error}`)
    }
    return null
}

/**
 * Builds the output structure expected by setup-cpp consumers based on MSVC metadata.
 *
 * @param compilerPath - Absolute path to cl.exe.
 * @param env - Environment variables containing Visual Studio metadata.
 * @param metadata - Additional metadata such as the parsed compilerVersion.
 * @returns Compiler and version output fields.
 * @throws {Error} When compilerPath is empty or not provided
 *
 * @example
 * const outputs = buildMSVCOutputs('C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe', process.env)
 *
 * @remarks
 * When {@link env.VisualStudioVersion} is missing the helper falls back to
 * `0.0.0`, which keeps the action functional for older setups that do not expose
 * that variable.
 */
export function buildMSVCOutputs(compilerPath: string, env: NodeJS.ProcessEnv = process.env, metadata: BuildOutputsMetadata = {}): Outputs {
    if (!compilerPath) {
        throw new Error('compilerPath is required to compute MSVC outputs')
    }

    const windowsPath = path.win32
    const normalizedCompilerPath = windowsPath.normalize(compilerPath)
    const bindir = windowsPath.dirname(normalizedCompilerPath)

    let dir = env.VCINSTALLDIR ? windowsPath.normalize(env.VCINSTALLDIR) : windowsPath.dirname(bindir)
    if (!dir || dir === '.' || dir === '') {
        dir = windowsPath.dirname(bindir)
    }

    const toolsetVersion = env.VCToolsVersion || inferToolsetVersionFromPath(normalizedCompilerPath)
    const toolsetSemver = toolsetVersion ? semver.coerce(toolsetVersion) : null
    const releaseString = toolsetSemver ? toolsetSemver.toString() : (toolsetVersion || '0.0.0')
    const versionMajor = toolsetSemver ? toolsetSemver.major : 0
    const versionMinor = toolsetSemver ? toolsetSemver.minor : 0
    const versionPatch = toolsetSemver ? toolsetSemver.patch : 0
    const productVersion = env.VisualStudioVersion || ''
    const releaseYear = productVersionToReleaseYear(productVersion)
    const compilerVersion = metadata.compilerVersion || ''

    return {
        cc: normalizedCompilerPath,
        cxx: normalizedCompilerPath,
        bindir,
        dir,
        release: releaseString,
        versionMajor,
        versionMinor,
        versionPatch,
        msvcToolsetVersion: toolsetVersion || '',
        msvcProductVersion: productVersion,
        msvcReleaseYear: releaseYear,
        msvcCompilerVersion: compilerVersion
    }
}
