/**
 * Visual Studio installation discovery utilities.
 *
 * @module discovery
 */

import * as core from '@actions/core'
import * as child_process from 'child_process'
import * as fs from 'fs'
import * as process from 'process'

import { releaseYearToProductVersion, productVersionToReleaseYear, YEARS } from './version-utils'

const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)']
const PROGRAM_FILES = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']]
const EDITIONS = ['Enterprise', 'Professional', 'Community']

/** Standard path to the vswhere utility used for Visual Studio discovery. */
export const VSWHERE_PATH = `${PROGRAM_FILES_X86}\\Microsoft Visual Studio\\Installer`

/**
 * Locates a Visual Studio installation path matching the provided constraints via vswhere.
 *
 * @param pattern - Relative path to append to the vswhere installation root.
 * @param versionPattern - vswhere version range selector.
 * @returns Absolute path if found, otherwise null.
 *
 * @example
 * // Retrieves the latest vcvarsall location or null when vswhere is missing
 * findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', '-latest')
 *
 * @remarks
 * vswhere is not guaranteed to exist on self-hosted agents. In that case the
 * function logs a warning and returns null so callers can fall back to manual probes.
 */
export function findWithVswhere(pattern: string, versionPattern: string): string | null {
    try {
        const installationPath = child_process.execSync(`vswhere -products * ${versionPattern} -prerelease -property installationPath`).toString().trim()
        return installationPath + '\\' + pattern
    } catch (e) {
        core.warning(`vswhere failed: ${e}`)
    }
    return null
}

/**
 * Searches for the vcvarsall.bat script using vswhere first and then conventional install paths.
 *
 * @param vsversion - Visual Studio version/year constraint.
 * @returns Absolute path to vcvarsall.bat.
 * @throws When no suitable installation is detected.
 *
 * @example
 * const vcvarsPath = findVcvarsall('2022')
 *
 * @remarks
 * The probing logic iterates multiple well-known directories; installations in
 * custom locations may still evade detection. Consumers should catch the error
 * to provide actionable diagnostics.
 */
export function findVcvarsall(vsversion: string): string {
    const vsversionNumber = releaseYearToProductVersion(vsversion)
    let versionPattern: string
    if (vsversionNumber) {
        const upperBound = vsversionNumber.split('.')[0] + '.9'
        versionPattern = `-version "${vsversionNumber},${upperBound}"`
    } else {
        versionPattern = '-latest'
    }

    // If vswhere is available, ask it about the location of the latest Visual Studio.
    let path = findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', versionPattern)
    if (path && fs.existsSync(path)) {
        core.info(`Found with vswhere: ${path}`)
        return path
    }
    core.info('Not found with vswhere')

    // If that does not work, try the standard installation locations,
    // starting with the latest and moving to the oldest.
    const years = vsversion ? [productVersionToReleaseYear(vsversion)] : YEARS
    for (const progFiles of PROGRAM_FILES) {
        for (const ver of years) {
            for (const ed of EDITIONS) {
                path = `${progFiles}\\Microsoft Visual Studio\\${ver}\\${ed}\\VC\\Auxiliary\\Build\\vcvarsall.bat`
                core.info(`Trying standard location: ${path}`)
                if (fs.existsSync(path)) {
                    core.info(`Found standard location: ${path}`)
                    return path
                }
            }
        }
    }
    core.info('Not found in standard locations')

    // Special case for Visual Studio 2015 (and maybe earlier), try it out too.
    path = `${PROGRAM_FILES_X86}\\Microsoft Visual C++ Build Tools\\vcbuildtools.bat`
    if (fs.existsSync(path)) {
        core.info(`Found VS 2015: ${path}`)
        return path
    }
    core.info(`Not found in VS 2015 location: ${path}`)

    throw new Error('Microsoft Visual Studio not found')
}
