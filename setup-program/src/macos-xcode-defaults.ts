/**
 * macOS Xcode defaults types and data loader.
 *
 * Provides interfaces for representing which Xcode versions (and their
 * corresponding Apple Clang versions) are available on each macOS runner
 * image, and a loader for the pre-generated data file.
 *
 * @module macos-xcode-defaults
 */

import macosXcodeDefaultsData from '../macos-xcode-defaults.json';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A single Xcode version entry with its associated Apple Clang version.
 */
export interface XcodeVersionEntry {
    /** Xcode version string (e.g., `"15.4"`). */
    xcode: string;
    /** Xcode build identifier (e.g., `"15F31d"`). */
    build: string;
    /** Apple Clang semantic version (e.g., `"15.0.0"`). */
    apple_clang: string;
    /** Apple Clang internal build string (e.g., `"1500.3.9.4"`). */
    clang_build: string;
    /** Whether this is the runner's default Xcode. */
    is_default: boolean;
}

/**
 * Xcode information for a single macOS runner image.
 */
export interface RunnerXcodeInfo {
    /** Default Xcode version string for this runner. */
    default_xcode: string;
    /** All available Xcode version entries on this runner. */
    xcode_versions: XcodeVersionEntry[];
    /** Pre-installed GCC major versions (e.g., `["13", "14", "15"]`), if present. */
    gcc_versions?: string[];
    /** Pre-installed LLVM major version (e.g., `"15"`), if present. */
    llvm_version?: string;
}

/**
 * A Homebrew-installable compiler version with major and exact version.
 */
export interface InstallableVersion {
    /** Major version number (e.g., `14`). */
    major: number;
    /** Full semantic version string (e.g., `"14.3.0"`). */
    version: string;
}

/**
 * Top-level structure for the macos-xcode-defaults.json data file.
 *
 * Keys under `runners` are macOS runner names (e.g., `"macos-14"`, `"macos-15"`).
 */
export interface MacOSXcodeDefaults {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source. */
    source: string;
    /** Runner data keyed by runner name. */
    runners: Record<string, RunnerXcodeInfo>;
    /** All GCC versions installable via Homebrew. */
    installable_gcc?: InstallableVersion[];
    /** All LLVM versions installable via Homebrew. */
    installable_llvm?: InstallableVersion[];
}

// ── Data loader ─────────────────────────────────────────────────────────────

/**
 * Returns the bundled macos-xcode-defaults data.
 *
 * The data is loaded from the pre-generated `macos-xcode-defaults.json`
 * file that ships alongside this module. It is produced by
 * `utils/update-data` and describes which Xcode and Apple Clang versions
 * are available on each macOS runner image.
 *
 * @returns The macOS Xcode defaults data, typed as {@link MacOSXcodeDefaults}
 */
export function loadMacOSXcodeDefaults(): MacOSXcodeDefaults {
    return macosXcodeDefaultsData as unknown as MacOSXcodeDefaults;
}
