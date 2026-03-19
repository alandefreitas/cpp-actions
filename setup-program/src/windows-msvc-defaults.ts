/**
 * Windows MSVC defaults types and data loader.
 *
 * Provides interfaces for representing which MSVC toolset versions are
 * available on each Windows runner image, and a loader for the
 * pre-generated data file.
 *
 * @module windows-msvc-defaults
 */

import windowsMsvcDefaultsData from '../windows-msvc-defaults.json';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A single MSVC version entry with its associated Visual Studio year.
 */
export interface MsvcVersionEntry {
    /** MSVC major.minor version (e.g., `"14.44"`). */
    version: string;
    /** VS marketing year (e.g., `"2022"`). */
    vs_year: string;
    /** Whether this is the default MSVC version for the runner. */
    is_default: boolean;
}

/**
 * MSVC information for a single Windows runner image.
 */
export interface RunnerMsvcInfo {
    /** All available MSVC version entries on this runner. */
    msvc_versions: MsvcVersionEntry[];
    /** Pre-installed MinGW GCC major version (e.g., `"14"`), if present. */
    mingw_version?: string;
    /** Pre-installed LLVM major version (e.g., `"20"`), if present. */
    llvm_version?: string;
}

/**
 * Top-level structure for the windows-msvc-defaults.json data file.
 *
 * Keys under `runners` are Windows runner names (e.g., `"windows-2022"`, `"windows-2025"`).
 */
export interface WindowsMsvcDefaults {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source. */
    source: string;
    /** Runner data keyed by runner name. */
    runners: Record<string, RunnerMsvcInfo>;
    /** All MinGW GCC versions installable via Chocolatey. */
    installable_mingw?: string[];
    /** All LLVM versions installable via Chocolatey. */
    installable_llvm?: string[];
}

// ── Data loader ─────────────────────────────────────────────────────────────

/**
 * Returns the bundled windows-msvc-defaults data.
 *
 * The data is loaded from the pre-generated `windows-msvc-defaults.json`
 * file that ships alongside this module. It is produced by
 * `utils/update-data` and describes which MSVC toolset versions are
 * available on each Windows runner image.
 *
 * @returns The Windows MSVC defaults data, typed as {@link WindowsMsvcDefaults}
 */
export function loadWindowsMsvcDefaults(): WindowsMsvcDefaults {
    return windowsMsvcDefaultsData as unknown as WindowsMsvcDefaults;
}
