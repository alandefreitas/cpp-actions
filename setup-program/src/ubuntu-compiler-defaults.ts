/**
 * Ubuntu compiler defaults types and data loader.
 *
 * Provides interfaces for representing which compiler versions are available
 * in each Ubuntu release's default repositories, and a loader for the
 * pre-generated data file.
 *
 * @module ubuntu-compiler-defaults
 */

import ubuntuCompilerDefaultsData from '../ubuntu-compiler-defaults.json';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A compiler version entry for a specific Ubuntu release.
 */
export interface CompilerVersionEntry {
    /** Major version number of the compiler (e.g., 11 for gcc-11). */
    major: number;
    /** Full package version string from the apt repository (e.g., "11.4.0-1ubuntu1~22.04"). */
    package_version: string;
    /** Whether this version is the build-essential / meta-package default. */
    is_default: boolean;
}

/**
 * Compiler information for a single compiler family (GCC or Clang) within a release.
 */
export interface CompilerInfo {
    /** The default major version resolved via the meta-package dependency chain. */
    default_version: string;
    /** All available versioned compiler packages in this release. */
    available_versions: CompilerVersionEntry[];
}

/**
 * Compiler data for a single Ubuntu release.
 */
export interface ReleaseCompilerData {
    /** Ubuntu release codename (e.g., "jammy"). */
    codename: string;
    /** GCC compiler information for this release. */
    gcc: CompilerInfo;
    /** Clang compiler information for this release. */
    clang: CompilerInfo;
}

/**
 * Top-level structure for the ubuntu-compiler-defaults.json data file.
 *
 * Keys under `releases` are Ubuntu version strings (e.g., "22.04").
 */
export interface UbuntuCompilerDefaults {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source (e.g., "archive.ubuntu.com apt metadata"). */
    source: string;
    /** Compiler data keyed by Ubuntu version string. */
    releases: Record<string, ReleaseCompilerData>;
}

// ── Data loader ─────────────────────────────────────────────────────────────

/**
 * Returns the bundled ubuntu-compiler-defaults data.
 *
 * The data is loaded from the pre-generated `ubuntu-compiler-defaults.json`
 * file that ships alongside this module. It is produced by
 * `utils/update-data` and describes which GCC/Clang versions are available
 * and which are the default in each Ubuntu release.
 *
 * @returns The ubuntu compiler defaults data, typed as {@link UbuntuCompilerDefaults}
 */
export function loadUbuntuCompilerDefaults(): UbuntuCompilerDefaults {
    return ubuntuCompilerDefaultsData as unknown as UbuntuCompilerDefaults;
}
