/**
 * Type definitions for setup-msvc action.
 *
 * @module types
 */

/**
 * Configuration inputs for the setup-msvc action.
 */
export interface Inputs {
    version: string
    arch: string
    sdk: string
    toolset: string
    vsversion: string
    uwp: boolean
    spectre: boolean
    trace_commands: boolean
}

/**
 * Output values produced by MSVC configuration.
 */
export interface Outputs {
    cc: string
    cxx: string
    bindir: string
    dir: string
    release: string
    version_major: number
    version_minor: number
    version_patch: number
    msvc_toolset_version: string
    msvc_product_version: string
    msvc_release_year: string
    msvc_compiler_version: string
}

/**
 * Extended output values including the version string.
 */
export interface MainOutputs extends Outputs {
    version: string
}

/**
 * Metadata used when building MSVC output values.
 */
export interface BuildOutputsMetadata {
    compilerVersion?: string
}
