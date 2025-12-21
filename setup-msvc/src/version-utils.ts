/**
 * Version mapping utilities for Visual Studio and MSVC toolsets.
 *
 * @module version-utils
 */

import * as fs from 'fs'
import * as path from 'path'
import * as semver from 'semver'

/**
 * Mapping from Visual Studio release years to product versions.
 *
 * Visual Studio exposes multiple overlapping identifiers:
 * - Release year (e.g., 2022)
 * - Product version (e.g., 17.0)
 * - MSVC toolset version (e.g., 14.42)
 * - MSVC compiler front-end version (e.g., 19.44)
 *
 * This map keeps release-year/product-version relationships explicit so callers can be precise.
 */
export const RELEASE_YEAR_TO_PRODUCT_VERSION: Record<string, string> = {
    '2026': '18.0',
    '2022': '17.0',
    '2019': '16.0',
    '2017': '15.0',
    '2015': '14.0',
    '2013': '12.0'
}

/** Array of Visual Studio release years sorted from newest to oldest. */
export const YEARS = Object.keys(RELEASE_YEAR_TO_PRODUCT_VERSION)

/**
 * Converts a Visual Studio release year into the product-version form (e.g., 2022 → 17.0).
 *
 * @param releaseYearOrProduct - Visual Studio release year (e.g. 2022) or product version (e.g. 17.0).
 * @returns The Visual Studio product version string (e.g. 17.0).
 *
 * @example
 * // Returns '17.0' for the 2022 release line
 * releaseYearToProductVersion('2022')
 *
 * @example
 * // Returns '17.5' when the calling code already supplied the number
 * releaseYearToProductVersion('17.5')
 *
 * @remarks
 * The lookup table in {@link RELEASE_YEAR_TO_PRODUCT_VERSION} must be updated when new Visual Studio
 * releases become available; otherwise newer year inputs will fall through and be
 * returned as-is. Callers should be prepared for that pass-through behavior.
 */
export function releaseYearToProductVersion(releaseYearOrProduct: string): string {
    if (Object.values(RELEASE_YEAR_TO_PRODUCT_VERSION).includes(releaseYearOrProduct)) {
        return releaseYearOrProduct
    }
    if (releaseYearOrProduct in RELEASE_YEAR_TO_PRODUCT_VERSION) {
        return RELEASE_YEAR_TO_PRODUCT_VERSION[releaseYearOrProduct]
    }
    return releaseYearOrProduct
}

/**
 * Converts a Visual Studio product version into the release-year form (e.g., 17.0 → 2022).
 *
 * @param productVersionOrYear - Visual Studio product version (e.g., 17.0) or release year.
 * @returns The release year string when available, otherwise the original input.
 *
 * @example
 * // Returns '2022'
 * productVersionToReleaseYear('17.0')
 *
 * @example
 * // Returns '16.9' unchanged because the table does not contain that patch release
 * productVersionToReleaseYear('16.9')
 *
 * @remarks
 * When {@link RELEASE_YEAR_TO_PRODUCT_VERSION} grows stale the function simply returns the input value,
 * so downstream code should tolerate non-year strings.
 */
export function productVersionToReleaseYear(productVersionOrYear: string): string {
    if (Object.keys(RELEASE_YEAR_TO_PRODUCT_VERSION).includes(productVersionOrYear)) {
        return productVersionOrYear
    }
    const normalizedProduct = semver.coerce(productVersionOrYear)
    if (normalizedProduct) {
        for (const [year, version] of Object.entries(RELEASE_YEAR_TO_PRODUCT_VERSION)) {
            const normalizedMapVersion = semver.coerce(version)
            if (normalizedMapVersion && normalizedMapVersion.major === normalizedProduct.major) {
                return year
            }
        }
    }
    for (const [year, version] of Object.entries(RELEASE_YEAR_TO_PRODUCT_VERSION)) {
        if (version === productVersionOrYear) {
            return year
        }
    }
    return productVersionOrYear
}

/**
 * Lists all installed MSVC toolset versions from the Visual Studio installation.
 *
 * @param vcvarsallPath - Path to vcvarsall.bat
 * @returns Array of installed toolset version strings
 */
export function listInstalledToolsets(vcvarsallPath: string | null): string[] {
    if (!vcvarsallPath) {
        return []
    }
    const vcRoot = path.dirname(path.dirname(path.dirname(vcvarsallPath)))
    const toolsetRoot = path.join(vcRoot, 'Tools', 'MSVC')
    if (!fs.existsSync(toolsetRoot)) {
        return []
    }
    return fs.readdirSync(toolsetRoot, {withFileTypes: true})
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
}

/**
 * Selects the best matching toolset version from installed versions.
 *
 * @param requestedVersion - Semver range or specific version requested
 * @param installedVersions - Array of installed toolset versions
 * @returns Matching toolset version string or null if none found
 */
export function selectToolsetVersion(requestedVersion: string, installedVersions: string[]): string | null {
    if (!requestedVersion || requestedVersion === '*') {
        return null
    }
    const normalizedInstalled = installedVersions
        .map((version) => ({version, semver: semver.coerce(version)}))
        .filter(({semver: s}) => s !== null)
        .sort((a, b) => semver.rcompare(a.semver!, b.semver!))

    const satisfying = normalizedInstalled.find(({semver: s}) => semver.satisfies(s!, requestedVersion, {includePrerelease: true}))
    return satisfying ? satisfying.version : null
}

/**
 * Extracts the MSVC toolset version from the compiler path as a fallback when the environment omits it.
 * @param compilerPath - Absolute path to cl.exe.
 * @returns Toolset version string such as 14.44.35207 when detected.
 */
export function inferToolsetVersionFromPath(compilerPath: string): string | null {
    if (!compilerPath) {
        return null
    }
    const normalized = compilerPath.replace(/\\/g, '/').toLowerCase()
    const match = normalized.match(/msvc\/(\d+\.\d+\.\d+)/)
    if (match) {
        return match[1]
    }
    return null
}
