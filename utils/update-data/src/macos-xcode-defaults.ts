/**
 * Fetches runner-images toolset JSONs and xcodereleases.com data, joins them
 * on Xcode build ID, and writes setup-program/macos-xcode-defaults.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A single Xcode version entry in the toolset JSON `xcode.arm64.versions[]`.
 *
 * Note: this interface mirrors the runner-images toolset schema, which is not
 * guaranteed to be stable across runner-images releases. If the upstream schema
 * changes, this interface and the corresponding processing logic must be updated.
 */
interface ToolsetXcodeVersion {
    /** Version string in format `"15.4.0+15F31d"`. */
    version: string;
    /** Symlink path (e.g., `"/Applications/Xcode_15.4.app"`). */
    link: string;
}

/**
 * Xcode section of the runner-images toolset JSON.
 *
 * Note: this interface mirrors the runner-images toolset schema, which is not
 * guaranteed to be stable across runner-images releases.
 */
interface ToolsetXcode {
    /** Default Xcode symlink path. */
    default: string;
    /** x86_64 Xcode versions (may be absent on newer runners). */
    x86_64?: { versions: ToolsetXcodeVersion[] };
    /** ARM64 Xcode versions. */
    arm64: { versions: ToolsetXcodeVersion[] };
}

/**
 * Partial runner-images toolset JSON (only the Xcode section).
 *
 * Note: this interface mirrors the runner-images toolset schema, which is not
 * guaranteed to be stable across runner-images releases.
 */
interface ToolsetJson {
    xcode: ToolsetXcode;
}

/**
 * A single entry from xcodereleases.com/data.json.
 */
interface XcodeRelease {
    version: {
        number: string;
        build: string;
        release: {
            beta?: number;
            rc?: number;
            gm?: boolean;
            gmSeed?: number;
            release?: boolean;
            dp?: number;
        };
    };
    compilers?: {
        clang?: Array<{
            number: string;
            build: string;
        }>;
    };
}

/**
 * A single Xcode version entry in the output JSON.
 */
interface OutputXcodeVersionEntry {
    /** Xcode version string (e.g., `"15.4"`). */
    xcode: string;
    /** Xcode build identifier (e.g., `"15F31d"`). */
    build: string;
    /** Apple Clang version (e.g., `"15.0.0"`). */
    apple_clang: string;
    /** Apple Clang internal build string (e.g., `"1500.3.9.4"`). */
    clang_build: string;
    /** Whether this is the runner's default Xcode. */
    is_default: boolean;
}

/**
 * Per-runner Xcode information in the output JSON.
 */
interface OutputRunnerXcodeInfo {
    /** Default Xcode version string. */
    default_xcode: string;
    /** Available Xcode version entries. */
    xcode_versions: OutputXcodeVersionEntry[];
}

/**
 * Top-level structure for macos-xcode-defaults.json.
 */
interface MacOSXcodeDefaults {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source. */
    source: string;
    /** Runner data keyed by runner name (e.g., `"macos-14"`). */
    runners: Record<string, OutputRunnerXcodeInfo>;
}

/**
 * A single runner image entry from runner-images.json.
 */
interface RunnerImageEntry {
    name: string;
    version: string;
    toolset_url: string | null;
}

/**
 * Structure of runner-images.json (partial — only the fields we need).
 */
interface RunnerImagesJson {
    runners: {
        macos: RunnerImageEntry[];
    };
}

/**
 * URL for the xcodereleases.com data JSON.
 */
const XCODE_RELEASES_URL = 'https://xcodereleases.com/data.json';

// ── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * Fetches JSON data from an HTTPS URL.
 *
 * @param url - The HTTPS URL to fetch
 * @returns Promise resolving to the parsed JSON
 * @throws Error if the HTTP response status is not 200 or JSON parsing fails
 */
function fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
                } catch (err) {
                    reject(new Error(`JSON parse error for ${url}: ${err}`));
                }
            });
        }).on('error', reject);
    });
}

// ── Data processing ─────────────────────────────────────────────────────────

/**
 * Builds a lookup map from Xcode build ID to Apple Clang version info,
 * excluding beta releases.
 *
 * @param releases - Array of Xcode release entries from xcodereleases.com
 * @returns Map from Xcode build ID to `{ xcodeVersion, appleClang, clangBuild }`
 */
function buildClangLookup(releases: XcodeRelease[]): Map<string, {
    xcodeVersion: string;
    appleClang: string;
    clangBuild: string;
}> {
    const lookup = new Map<string, { xcodeVersion: string; appleClang: string; clangBuild: string }>();

    for (const release of releases) {
        // Skip beta releases
        const rel = release.version.release;
        if (rel.beta !== undefined || rel.dp !== undefined || rel.rc !== undefined || rel.gmSeed !== undefined) {
            continue;
        }

        const clangInfo = release.compilers?.clang?.[0];
        if (!clangInfo) {
            continue;
        }

        lookup.set(release.version.build, {
            xcodeVersion: release.version.number,
            appleClang: clangInfo.number,
            clangBuild: clangInfo.build
        });
    }

    return lookup;
}

/**
 * Determines whether a toolset Xcode entry is a beta version.
 *
 * Beta entries have `beta` in their symlink path (e.g., `"/Applications/Xcode_16.0-beta.app"`).
 *
 * @param entry - A toolset Xcode version entry
 * @returns True if the entry is a beta
 */
function isToolsetBeta(entry: ToolsetXcodeVersion): boolean {
    return entry.link.toLowerCase().includes('beta');
}

/**
 * Extracts the Xcode build ID from the toolset version string.
 *
 * The version field has format `"15.4.0+15F31d"` — the build ID is after the `+`.
 *
 * @param version - Toolset version string
 * @returns The build ID, or null if format is unexpected
 */
function extractBuildId(version: string): string | null {
    const plusIndex = version.indexOf('+');
    if (plusIndex === -1) {
        return null;
    }
    return version.substring(plusIndex + 1);
}

/**
 * Extracts the Xcode display version from the toolset version string.
 *
 * The version field has format `"15.4.0+15F31d"` — the display version is before the `+`.
 *
 * @param version - Toolset version string
 * @returns The display version (e.g., `"15.4.0"`)
 */
function extractXcodeVersion(version: string): string {
    const plusIndex = version.indexOf('+');
    if (plusIndex === -1) {
        return version;
    }
    return version.substring(0, plusIndex);
}

/**
 * Extracts the default Xcode version string from the toolset's default symlink path.
 *
 * Parses paths like `"/Applications/Xcode_15.4.app"` to extract `"15.4"`.
 *
 * @param defaultLink - The default Xcode symlink path from the toolset JSON
 * @returns The default Xcode version string, or an empty string if parsing fails
 */
function extractDefaultVersion(defaultLink: string): string {
    const match = defaultLink.match(/Xcode[_-]?([\d.]+)/);
    return match ? match[1] : '';
}

/**
 * Processes a single runner's toolset JSON against the xcodereleases lookup,
 * producing the output data for that runner.
 *
 * @param toolset - The parsed toolset JSON
 * @param clangLookup - Build ID to Apple Clang info lookup
 * @returns The runner's Xcode info, or null if no versions matched
 */
function processRunner(
    toolset: ToolsetJson,
    clangLookup: Map<string, { xcodeVersion: string; appleClang: string; clangBuild: string }>
): OutputRunnerXcodeInfo | null {
    const defaultXcode = extractDefaultVersion(toolset.xcode.default);

    // Prefer arm64 versions, fall back to x86_64
    const toolsetVersions = toolset.xcode.arm64?.versions ?? toolset.xcode.x86_64?.versions ?? [];

    const entries: OutputXcodeVersionEntry[] = [];

    for (const tv of toolsetVersions) {
        // Skip betas in toolset
        if (isToolsetBeta(tv)) {
            continue;
        }

        const buildId = extractBuildId(tv.version);
        if (!buildId) {
            console.warn(`  Warning: unexpected version format "${tv.version}", skipping`);
            continue;
        }

        const clangInfo = clangLookup.get(buildId);
        if (!clangInfo) {
            // No matching xcodereleases entry — may be too new or unlisted
            console.warn(`  Warning: no xcodereleases data for build ${buildId} (Xcode ${extractXcodeVersion(tv.version)}), skipping`);
            continue;
        }

        const xcodeVer = extractXcodeVersion(tv.version);
        entries.push({
            xcode: clangInfo.xcodeVersion,
            build: buildId,
            apple_clang: clangInfo.appleClang,
            clang_build: clangInfo.clangBuild,
            is_default: defaultXcode !== '' && (xcodeVer === defaultXcode || xcodeVer.startsWith(defaultXcode + '.'))
        });
    }

    if (entries.length === 0) {
        return null;
    }

    return {
        default_xcode: defaultXcode,
        xcode_versions: entries
    };
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetches runner-images toolset JSONs and xcodereleases.com data, joins them
 * on Xcode build ID, and writes macos-xcode-defaults.json.
 *
 * The output data file maps each macOS runner to its available Xcode versions
 * and corresponding Apple Clang versions. Beta Xcode versions are excluded.
 *
 * If a fetch fails, a warning is logged and processing continues with the
 * remaining data sources.
 *
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if at least one runner was processed successfully
 */
export async function updateMacOSXcodeDefaults(rootDir: string): Promise<boolean> {
    console.log('\n==== Updating macOS Xcode defaults ====');

    // Read runner-images.json for macOS runner-to-toolset URL mappings
    const runnerImagesPath = path.join(rootDir, 'setup-program/runner-images.json');
    if (!fs.existsSync(runnerImagesPath)) {
        console.error('Error: runner-images.json not found. Run runner-images update first.');
        return false;
    }

    const runnerImagesData: RunnerImagesJson = JSON.parse(fs.readFileSync(runnerImagesPath, 'utf-8'));
    const macosRunners = runnerImagesData.runners.macos || [];
    if (macosRunners.length === 0) {
        console.error('Error: no macOS runners found in runner-images.json');
        return false;
    }

    // Fetch xcodereleases.com data
    let xcodeReleases: XcodeRelease[];
    try {
        console.log('  Fetching xcodereleases.com data...');
        xcodeReleases = await fetchJson(XCODE_RELEASES_URL) as XcodeRelease[];
    } catch (err) {
        console.warn(`  Warning: failed to fetch xcodereleases.com data: ${err}`);
        return false;
    }

    const clangLookup = buildClangLookup(xcodeReleases);
    console.log(`  Built lookup with ${clangLookup.size} non-beta Xcode releases`);

    // Fetch and process each runner's toolset
    const runners: Record<string, OutputRunnerXcodeInfo> = {};
    let successCount = 0;

    // Sort runner names for deterministic output
    const sortedRunners = [...macosRunners].sort(
        (a, b) => a.name.localeCompare(b.name)
    );

    for (const runner of sortedRunners) {
        if (!runner.toolset_url) {
            console.warn(`  Warning: no toolset URL for ${runner.name}, skipping`);
            continue;
        }
        console.log(`  Fetching toolset for ${runner.name}...`);
        try {
            const toolset = await fetchJson(runner.toolset_url) as ToolsetJson;
            const result = processRunner(toolset, clangLookup);
            if (result) {
                runners[runner.name] = result;
                successCount++;
                console.log(`    ${result.xcode_versions.length} Xcode versions matched`);
            } else {
                console.warn(`    Warning: no Xcode versions matched for ${runner.name}`);
            }
        } catch (err) {
            console.warn(`  Warning: failed to fetch toolset for ${runner.name}: ${err}`);
        }
    }

    if (successCount === 0) {
        console.error('Error: failed to process any macOS runner toolsets');
        return false;
    }

    const result: MacOSXcodeDefaults = {
        generated: new Date().toISOString(),
        source: 'actions/runner-images toolsets + xcodereleases.com',
        runners
    };

    const outputPath = path.join(rootDir, 'setup-program/macos-xcode-defaults.json');
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    console.log(`macOS Xcode defaults saved to ${outputPath} (${successCount} runners)`);

    return true;
}
