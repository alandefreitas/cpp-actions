/**
 * Runner images types and data loader.
 *
 * Provides interfaces for representing which GitHub Actions runner images
 * are available for each platform, and a loader for the pre-generated
 * data file.
 *
 * @module runner-images
 */

import runnerImagesData from '../runner-images.json';

// ── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A single runner image entry for a platform.
 */
export interface RunnerImageEntry {
    /** Runner name as used in `runs-on` (e.g., `"macos-14"`, `"ubuntu-22.04"`). */
    name: string;
    /** Version identifier derived from the toolset filename (e.g., `"14"`, `"22.04"`, `"2022"`). */
    version: string;
    /** Raw URL to the runner-images toolset JSON, or null if unavailable. */
    toolset_url: string | null;
}

/**
 * Top-level structure for the runner-images.json data file.
 *
 * Keys under `runners` are platform names (`"ubuntu"`, `"macos"`, `"windows"`).
 */
export interface RunnerImagesData {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source. */
    source: string;
    /** Runner entries keyed by platform. */
    runners: {
        ubuntu: RunnerImageEntry[];
        macos: RunnerImageEntry[];
        windows: RunnerImageEntry[];
    };
}

// ── Data loader ─────────────────────────────────────────────────────────────

/**
 * Returns the bundled runner-images data.
 *
 * The data is loaded from the pre-generated `runner-images.json`
 * file that ships alongside this module. It is produced by
 * `utils/update-data` and describes which runner images are available
 * for each platform along with their toolset URLs.
 *
 * @returns The runner images data, typed as {@link RunnerImagesData}
 */
export function loadRunnerImages(): RunnerImagesData {
    return runnerImagesData as unknown as RunnerImagesData;
}
