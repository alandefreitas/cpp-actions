/**
 * Fetches runner-images toolset JSONs and VS channel manifests, discovers
 * MSVC toolset versions per Windows runner, and writes
 * setup-program/windows-msvc-defaults.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A single entry returned by the GitHub Contents API for a directory listing.
 */
interface GitHubContentsEntry {
    /** File or directory name (e.g., `"toolset-2025.json"`). */
    name: string;
    /** Direct download URL for raw content. */
    download_url: string | null;
}

/**
 * Visual Studio section of the runner-images toolset JSON.
 *
 * Note: this interface mirrors the runner-images toolset schema, which is not
 * guaranteed to be stable across runner-images releases.
 */
interface ToolsetVisualStudio {
    /** VS marketing year (e.g., `"2022"`). */
    version: string;
    /** VS IDE major version (e.g., `"17"`). */
    subversion: string;
    /** VS edition (e.g., `"Enterprise"`). */
    edition: string;
    /** Release channel (e.g., `"release"`). */
    channel: string;
    /** Workload component IDs installed on the runner. */
    workloads: string[];
}

/**
 * MinGW section of the runner-images toolset JSON.
 */
interface ToolsetMinGW {
    /** MinGW GCC version pattern (e.g., `"14.*"`). */
    version: string;
}

/**
 * LLVM section of the runner-images toolset JSON.
 */
interface ToolsetLLVM {
    /** LLVM major version string (e.g., `"20"`). */
    version: string;
}

/**
 * Partial runner-images toolset JSON (Visual Studio, MinGW, and LLVM sections).
 *
 * Note: this interface mirrors the runner-images toolset schema, which is not
 * guaranteed to be stable across runner-images releases.
 */
interface ToolsetJson {
    visualStudio: ToolsetVisualStudio;
    /** MinGW GCC configuration (optional — may be absent on older toolsets). */
    mingw?: ToolsetMinGW;
    /** LLVM configuration (optional — may be absent on older toolsets). */
    llvm?: ToolsetLLVM;
}

/**
 * An MSVC version discovered from a toolset file.
 */
interface DiscoveredMsvcVersion {
    /** MSVC major.minor version (e.g., `"14.44"`). */
    version: string;
    /** VS marketing year (e.g., `"2022"`). */
    vs_year: string;
    /** Whether this is the default/current toolset for the VS generation. */
    is_default: boolean;
}

/**
 * Info about a toolset file and its associated runner.
 */
interface ToolsetFileInfo {
    /** Runner version number (e.g., `"2025"`). */
    runnerVersion: string;
    /** Full runner name (e.g., `"windows-2025"` or `"windows-2025-vs2026"`). */
    runnerName: string;
    /** Whether this is the primary (non-suffix) toolset file. */
    isPrimary: boolean;
    /** Raw download URL. */
    downloadUrl: string;
}

/**
 * VS channel manifest structure (partial — only the fields we need).
 */
interface ChannelManifest {
    info?: {
        productDisplayVersion?: string;
    };
}

/**
 * Per-runner MSVC version data in the output JSON.
 */
interface OutputRunnerMsvcInfo {
    msvc_versions: OutputMsvcVersionEntry[];
    /** Pre-installed MinGW GCC major version (e.g., `"14"`), if present. */
    mingw_version?: string;
    /** Pre-installed LLVM major version (e.g., `"20"`), if present. */
    llvm_version?: string;
}

/**
 * A single MSVC version entry in the output JSON.
 */
interface OutputMsvcVersionEntry {
    /** MSVC major.minor version (e.g., `"14.44"`). */
    version: string;
    /** VS marketing year (e.g., `"2022"`). */
    vs_year: string;
    /** Whether this is the default MSVC version for the runner. */
    is_default: boolean;
}

/**
 * Top-level structure for windows-msvc-defaults.json.
 */
interface WindowsMsvcDefaults {
    /** ISO 8601 timestamp when this data was generated. */
    generated: string;
    /** Description of the data source. */
    source: string;
    /** Runner data keyed by runner name (e.g., `"windows-2022"`). */
    runners: Record<string, OutputRunnerMsvcInfo>;
    /** All Chocolatey-installable MinGW GCC versions (semver strings). */
    installable_mingw: string[];
    /** All Chocolatey-installable LLVM versions (semver strings). */
    installable_llvm: string[];
}

/**
 * Structure of runner-images.json (partial — only the fields we need).
 */
interface RunnerImagesJson {
    runners: {
        windows: Array<{
            name: string;
            version: string;
            toolset_url: string | null;
        }>;
    };
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * GitHub Contents API URL for the Windows toolset directory.
 */
const WINDOWS_TOOLSETS_API_URL =
    'https://api.github.com/repos/actions/runner-images/contents/images/windows/toolsets';

/**
 * Regex to match toolset filenames and extract runner version + optional suffix.
 * Group 1: numeric runner version (e.g., `"2025"`)
 * Group 2: optional suffix (e.g., `"-vs2026"`)
 * Examples: `toolset-2025.json` → ("2025", undefined), `toolset-2025-vs2026.json` → ("2025", "-vs2026")
 */
const TOOLSET_FILE_RE = /^toolset-(\d+)(-[a-z0-9-]+)?\.json$/;

/**
 * Regex to extract explicit MSVC version pins from workload component IDs.
 * Matches `VC.14.44.17.14.x86.x64` and captures `14.44`.
 */
const EXPLICIT_PIN_RE = /\.VC\.(14\.\d+)\.\d+\.\d+\./;

/**
 * Regex to extract MSVC generation from component group IDs.
 * Matches `VC.Tools.142.x86.x64` and captures `142`.
 */
const GENERATION_GROUP_RE = /\.VC\.Tools\.(14\d)\./;

/**
 * Frozen MSVC versions for older VS generations that no longer receive updates.
 * Maps generation string (e.g., `"142"`) to the final MSVC major.minor.
 */
const FROZEN_GENERATIONS: Record<string, string> = {
    '142': '14.29'
};

/**
 * Maps VS IDE major version to the offset used for MSVC minor version derivation.
 * Formula: MSVC minor = VS minor + offset.
 */
const VS_TO_MSVC_OFFSET: Record<number, number> = {
    16: 20,
    17: 30,
    18: 50
};

/**
 * Expected hostname for valid VS channel manifest redirects.
 */
const VS_MANIFEST_HOST = 'download.visualstudio.microsoft.com';

// ── HTTP helpers ────────────────────────────────────────────────────────────

/**
 * Fetches JSON data from a GitHub API URL using HTTPS.
 *
 * Includes a `User-Agent` header as required by GitHub's API and
 * optionally an `Authorization` header if a token is provided.
 *
 * @param url - The HTTPS URL to fetch
 * @param token - Optional GitHub token for authenticated requests
 * @returns Promise resolving to the parsed JSON
 * @throws Error if the HTTP response status is not 200 or JSON parsing fails
 */
function fetchGitHubJson(url: string, token?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            'User-Agent': 'cpp-actions-update-data',
            'Accept': 'application/vnd.github.v3+json'
        };
        // Untested: requires a real GITHUB_TOKEN env var, which is not
        // available in the unit-test environment.
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }

        const parsedUrl = new URL(url);
        const options: https.RequestOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers
        };

        https.get(options, (res) => {
            // Untested: requires a non-200 response from the GitHub API,
            // which the mocked https.get never produces.
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
                    // Untested: requires the GitHub API to return a 200
                    // with non-JSON body, which cannot happen in practice.
                    reject(new Error(`JSON parse error for ${url}: ${err}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Fetches JSON from an HTTPS URL, following one level of 301/302 redirects.
 *
 * Node.js `https.get` does not auto-follow redirects, so this function
 * manually handles a single redirect hop. It validates that the redirect
 * target is on the expected VS manifest CDN host.
 *
 * @param url - The HTTPS URL to fetch
 * @returns Promise resolving to the parsed JSON, or null if the redirect
 *   target is not on the expected VS manifest host
 * @throws Error if the HTTP response is not 200/301/302 or JSON parsing fails
 */
function fetchWithRedirect(url: string): Promise<unknown | null> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const location = res.headers.location;
                res.resume();
                // Untested: requires a real 301/302 with no Location header,
                // which the mocked redirects always include.
                if (!location) {
                    reject(new Error(`Redirect with no Location header for ${url}`));
                    return;
                }
                // Check that the redirect target is on the expected host
                try {
                    const redirectHost = new URL(location).hostname;
                    if (redirectHost !== VS_MANIFEST_HOST) {
                        // Redirect to unexpected host (e.g., bing.com for
                        // unreleased VS versions) — fall through to formula
                        resolve(null);
                        return;
                    }
                } catch {
                    // Untested: requires an unparseable URL in the Location header.
                    reject(new Error(`Invalid redirect URL: ${location}`));
                    return;
                }
                // Follow the redirect
                https.get(location, (redirectRes) => {
                    // Untested: requires the VS CDN to return non-200 after redirect,
                    // which the mocked responses never produce.
                    if (redirectRes.statusCode !== 200) {
                        redirectRes.resume();
                        reject(new Error(`HTTP ${redirectRes.statusCode} for ${location}`));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    redirectRes.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    });
                    redirectRes.on('end', () => {
                        try {
                            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
                        } catch (err) {
                            // Untested: requires the VS CDN to return non-JSON
                            // on a 200 response, which cannot happen in practice.
                            reject(new Error(`JSON parse error for ${location}: ${err}`));
                        }
                    });
                }).on('error', reject);
                return;
            }

            // Untested: requires a non-redirect, non-200 response from
            // aka.ms, which the mocked responses never produce.
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
                    // Untested: requires the VS CDN to return non-JSON
                    // on a 200 response.
                    reject(new Error(`JSON parse error for ${url}: ${err}`));
                }
            });
        }).on('error', reject);
    });
}

// ── Chocolatey version discovery ────────────────────────────────────────────

/**
 * Chocolatey OData API base URL for package searches.
 */
const CHOCOLATEY_API_BASE = 'https://community.chocolatey.org/api/v2';

/**
 * Fetches raw text from an HTTPS URL.
 *
 * @param url - The HTTPS URL to fetch
 * @returns Promise resolving to the response body as a string
 * @throws Error if the HTTP response status is not 200
 */
function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            // Untested: requires the Chocolatey API to return non-200,
            // which the mocked https.get never produces for text fetches.
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
                resolve(Buffer.concat(chunks).toString('utf-8'));
            });
        }).on('error', reject);
    });
}

/**
 * Parses Chocolatey OData Atom XML to extract approved, non-prerelease package versions.
 *
 * The Atom XML contains `<entry>` elements with `<m:properties>` children holding
 * `<d:Version>`, `<d:IsApproved>`, and `<d:IsPrerelease>` elements.
 * This function uses simple regex extraction rather than a full XML parser
 * since the structure is well-known and stable.
 *
 * @param xml - Raw Atom XML response body from the Chocolatey OData API
 * @returns Array of approved, non-prerelease version strings
 */
export function parseChocolateyVersions(xml: string): string[] {
    const versions: string[] = [];

    // Split by <entry> to process each package entry individually
    const entries = xml.split(/<entry[\s>]/);
    for (const entry of entries) {
        // Extract version
        const versionMatch = entry.match(/<d:Version>(.*?)<\/d:Version>/);
        if (!versionMatch) {
            continue;
        }

        // Check IsApproved (must be true)
        const approvedMatch = entry.match(/<d:IsApproved[^>]*>(true|false)<\/d:IsApproved>/i);
        if (!approvedMatch || approvedMatch[1].toLowerCase() !== 'true') {
            continue;
        }

        // Check IsPrerelease (must be false)
        const prereleaseMatch = entry.match(/<d:IsPrerelease[^>]*>(true|false)<\/d:IsPrerelease>/i);
        if (!prereleaseMatch || prereleaseMatch[1].toLowerCase() !== 'false') {
            continue;
        }

        versions.push(versionMatch[1]);
    }

    return versions;
}

/**
 * Fetches all installable versions of a Chocolatey package.
 *
 * Queries the Chocolatey OData API `FindPackagesById()` endpoint and parses
 * the Atom XML response to collect approved, non-prerelease versions.
 *
 * Does NOT add `$orderby` or other OData `$` operators to the URL, as these
 * return HTTP 406 since March 2024.
 *
 * @param packageId - The Chocolatey package ID (e.g., `"mingw"` or `"llvm"`)
 * @returns Promise resolving to an array of version strings, or empty array on failure
 */
export async function fetchChocolateyVersions(packageId: string): Promise<string[]> {
    const url = `${CHOCOLATEY_API_BASE}/FindPackagesById()?id='${packageId}'`;
    try {
        console.log(`    Fetching Chocolatey versions for '${packageId}'...`);
        const xml = await fetchText(url);
        const versions = parseChocolateyVersions(xml);
        console.log(`      Found ${versions.length} approved version(s)`);
        return versions;
    } catch (err) {
        // Untested: requires the Chocolatey API to be unreachable,
        // which cannot happen in the mocked test environment.
        console.warn(`    Warning: failed to fetch Chocolatey versions for '${packageId}': ${err}`);
        return [];
    }
}

/**
 * Extracts the MinGW GCC major version string from a toolset JSON.
 *
 * The toolset `mingw.version` field contains a pattern like `"14.*"`.
 * This function extracts just the major number before `.*`.
 *
 * @param toolset - Parsed toolset JSON
 * @returns The MinGW GCC major version string (e.g., `"14"`), or null if not present
 */
export function extractMingwVersion(toolset: ToolsetJson): string | null {
    const version = toolset.mingw?.version;
    if (!version) {
        return null;
    }
    // Extract major number before ".*" pattern (e.g., "14.*" → "14")
    const match = version.match(/^(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extracts the LLVM major version string from a toolset JSON.
 *
 * The toolset `llvm.version` field contains a plain major version string
 * like `"20"`, used as-is.
 *
 * @param toolset - Parsed toolset JSON
 * @returns The LLVM major version string (e.g., `"20"`), or null if not present
 */
export function extractLlvmVersion(toolset: ToolsetJson): string | null {
    const version = toolset.llvm?.version;
    if (!version) {
        return null;
    }
    return version;
}

// ── MSVC version discovery ──────────────────────────────────────────────────

/**
 * Extracts explicit MSVC version pins from workload component IDs.
 *
 * Scans for component IDs like `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64`
 * and extracts the MSVC major.minor version (e.g., `14.44`).
 *
 * @param workloads - Array of workload component ID strings
 * @returns Array of explicit MSVC version strings found
 */
export function extractExplicitPins(workloads: string[]): string[] {
    const versions: string[] = [];
    for (const wl of workloads) {
        const match = wl.match(EXPLICIT_PIN_RE);
        if (match) {
            versions.push(match[1]);
        }
    }
    return versions;
}

/**
 * Extracts MSVC generation identifiers from workload component group IDs.
 *
 * Scans for component IDs like `Microsoft.VisualStudio.ComponentGroup.VC.Tools.142.x86.x64`
 * and extracts the generation string (e.g., `"142"`).
 *
 * @param workloads - Array of workload component ID strings
 * @returns Array of generation strings found (e.g., `["142"]`)
 */
export function extractGenerationGroups(workloads: string[]): string[] {
    const generations: string[] = [];
    for (const wl of workloads) {
        const match = wl.match(GENERATION_GROUP_RE);
        if (match) {
            generations.push(match[1]);
        }
    }
    return generations;
}

/**
 * Derives the default MSVC version from a VS channel manifest.
 *
 * Fetches the VS channel manifest for the given IDE major version,
 * parses `productDisplayVersion` (e.g., `"17.14.29 (March 2026)"`),
 * extracts the VS minor version, and computes the MSVC minor using
 * the VS-to-MSVC offset formula.
 *
 * @param subversion - VS IDE major version string (e.g., `"17"`)
 * @returns Promise resolving to the MSVC version string (e.g., `"14.44"`),
 *   or null if the manifest is unavailable or redirect goes to unexpected host
 */
export async function deriveMsvcFromChannelManifest(subversion: string): Promise<string | null> {
    const url = `https://aka.ms/vs/${subversion}/release/channel`;
    try {
        const manifest = await fetchWithRedirect(url) as ChannelManifest | null;
        if (!manifest) {
            return null;
        }

        const displayVersion = manifest.info?.productDisplayVersion;
        if (!displayVersion) {
            return null;
        }

        // Parse "17.14.29 (March 2026)" → extract minor 14
        const versionMatch = displayVersion.match(/^(\d+)\.(\d+)/);
        // Untested: requires a channel manifest with a non-numeric
        // productDisplayVersion, which real manifests never have.
        if (!versionMatch) {
            return null;
        }

        const vsMajor = parseInt(versionMatch[1], 10);
        const vsMinor = parseInt(versionMatch[2], 10);

        const offset = VS_TO_MSVC_OFFSET[vsMajor];
        // Untested: requires a VS major version not in the offset map
        // (currently 16, 17, 18), which only happens for future VS releases.
        if (offset === undefined) {
            return null;
        }

        const msvcMinor = vsMinor + offset;
        return `14.${msvcMinor}`;
    } catch {
        // Channel manifest unavailable — fall through to formula
        return null;
    }
}

/**
 * Derives the MSVC version from VS subversion using the formula.
 *
 * Uses the offset mapping: VS 16 → +20, VS 17 → +30, VS 18 → +50.
 * The MSVC version is always `14.(vsMinor + offset)`.
 *
 * @param subversion - VS IDE major version string (e.g., `"17"`)
 * @returns The MSVC version string (e.g., `"14.40"` for VS 17.10),
 *   or null if the VS major version is unknown
 */
/**
 * Returns the next-higher MSVC offset boundary for a given VS major version.
 *
 * Used to scope explicit-pin filtering to the correct VS generation so that
 * pins from a different generation are not misattributed. For example, VS 17
 * has offset 30, and the next boundary is 50 (VS 18), so only pins with
 * minor in [30, 50) are considered for VS 17.
 *
 * @param vsMajor - VS IDE major version number
 * @returns The next offset boundary, or Infinity if no higher generation exists
 */
function getNextOffsetBoundary(vsMajor: number): number {
    const allOffsets = Object.entries(VS_TO_MSVC_OFFSET)
        .map(([k, v]) => ({ major: parseInt(k, 10), offset: v }))
        .sort((a, b) => a.offset - b.offset);
    const idx = allOffsets.findIndex(e => e.major === vsMajor);
    if (idx === -1 || idx === allOffsets.length - 1) {
        return Infinity;
    }
    return allOffsets[idx + 1].offset;
}

/**
 * Discovers MSVC versions from a single toolset JSON using a cascade:
 * (1) explicit component IDs, (2) VS channel manifest for the default
 * toolset, (3) formula derivation, (4) hardcoded fallback for frozen
 * generations.
 *
 * @param toolset - Parsed toolset JSON
 * @param isPrimary - Whether this is the primary (non-suffix) toolset file
 * @returns Promise resolving to array of discovered MSVC versions
 */
export async function discoverMsvcVersions(
    toolset: ToolsetJson,
    isPrimary: boolean
): Promise<DiscoveredMsvcVersion[]> {
    const vs = toolset.visualStudio;
    const versions: DiscoveredMsvcVersion[] = [];
    const seenVersions = new Set<string>();

    // (1) Extract explicit version pins from workloads
    const explicitPins = extractExplicitPins(vs.workloads);
    for (const pin of explicitPins) {
        if (!seenVersions.has(pin)) {
            seenVersions.add(pin);
            versions.push({
                version: pin,
                vs_year: vs.version,
                is_default: false // Will be updated later
            });
        }
    }

    // (2) Try VS channel manifest for the default/current toolset
    let defaultMsvcVersion: string | null = null;
    if (isPrimary) {
        defaultMsvcVersion = await deriveMsvcFromChannelManifest(vs.subversion);

        // (3) Formula derivation fallback
        if (!defaultMsvcVersion) {
            const vsMajor = parseInt(vs.subversion, 10);
            const offset = VS_TO_MSVC_OFFSET[vsMajor];
            if (offset !== undefined) {
                const nextOffset = getNextOffsetBoundary(vsMajor);
                // Find the highest explicit pin scoped to this VS generation
                const highestPin = explicitPins
                    .map(v => parseInt(v.split('.')[1], 10))
                    .filter(n => !isNaN(n) && n >= offset && n < nextOffset)
                    .sort((a, b) => b - a)[0];

                if (highestPin !== undefined) {
                    defaultMsvcVersion = `14.${highestPin}`;
                }
            }
        }

        // Mark the default version
        if (defaultMsvcVersion) {
            // Untested: requires channel manifest to return a version not
            // already found via explicit pins, which current toolsets don't.
            if (!seenVersions.has(defaultMsvcVersion)) {
                seenVersions.add(defaultMsvcVersion);
                versions.push({
                    version: defaultMsvcVersion,
                    vs_year: vs.version,
                    is_default: true
                });
            } else {
                // Update the existing entry to mark it as default
                const existing = versions.find(v => v.version === defaultMsvcVersion);
                if (existing) {
                    existing.is_default = true;
                }
            }
        }
    }

    // (4) Handle frozen generations from component groups
    const generations = extractGenerationGroups(vs.workloads);
    for (const gen of generations) {
        const frozenVersion = FROZEN_GENERATIONS[gen];
        if (frozenVersion && !seenVersions.has(frozenVersion)) {
            seenVersions.add(frozenVersion);
            versions.push({
                version: frozenVersion,
                vs_year: getVsYearForGeneration(gen),
                is_default: false
            });
        }
    }

    return versions;
}

/**
 * Maps a VS toolset generation string to the corresponding VS marketing year.
 *
 * @param generation - Generation string (e.g., `"142"`)
 * @returns VS year string (e.g., `"2019"`)
 */
function getVsYearForGeneration(generation: string): string {
    const yearMap: Record<string, string> = {
        '140': '2015',
        '141': '2017',
        '142': '2019',
        '143': '2022'
    };
    return yearMap[generation] || 'unknown';
}

// ── Toolset directory discovery ─────────────────────────────────────────────

/**
 * Fetches the Windows toolset directory listing from the GitHub Contents API
 * and groups toolset files by runner version.
 *
 * Discovers both primary toolset files (e.g., `toolset-2025.json`) and
 * multi-suffix files (e.g., `toolset-2025-vs2026.json`) that
 * `runner-images.json` skips.
 *
 * @param token - Optional GitHub token for authenticated requests
 * @returns Promise resolving to a map of runner version to toolset file info array
 * @throws Error if the API request fails
 */
export async function fetchToolsetDirectory(
    token?: string
): Promise<Map<string, ToolsetFileInfo[]>> {
    const entries = await fetchGitHubJson(WINDOWS_TOOLSETS_API_URL, token) as GitHubContentsEntry[];
    if (!Array.isArray(entries)) {
        throw new Error('Unexpected response from GitHub Contents API (not an array)');
    }

    const grouped = new Map<string, ToolsetFileInfo[]>();

    for (const entry of entries) {
        const match = entry.name.match(TOOLSET_FILE_RE);
        if (!match || !entry.download_url) {
            continue;
        }

        const runnerVersion = match[1];
        const suffix = match[2] || '';
        const isPrimary = suffix === '';
        const runnerName = `windows-${runnerVersion}${suffix}`;

        if (!grouped.has(runnerName)) {
            grouped.set(runnerName, []);
        }
        grouped.get(runnerName)!.push({
            runnerVersion,
            runnerName,
            isPrimary,
            downloadUrl: entry.download_url
        });
    }

    return grouped;
}

/**
 * Fetches JSON from a raw content URL.
 *
 * @param url - The raw content URL to fetch
 * @returns Promise resolving to the parsed JSON
 * @throws Error if the HTTP response status is not 200 or JSON parsing fails
 */
function fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            // Untested: requires a non-200 response from a raw content URL,
            // which the mocked https.get never produces.
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
                    // Untested: requires a 200 response with non-JSON body.
                    reject(new Error(`JSON parse error for ${url}: ${err}`));
                }
            });
        }).on('error', reject);
    });
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetches runner-images toolset JSONs and VS channel manifests, discovers
 * MSVC toolset versions per Windows runner, and writes
 * windows-msvc-defaults.json.
 *
 * The discovery uses a cascade per toolset file:
 * 1. Explicit component IDs (e.g., `VC.14.44.17.14.x86.x64`)
 * 2. VS channel manifest for the default toolset
 * 3. Formula derivation (VS subversion → MSVC minor)
 * 4. Hardcoded fallback for frozen generations (e.g., v142 → 14.29)
 *
 * MSVC versions from all toolset files for the same runner are merged and
 * deduplicated. The default MSVC version is the one from the primary
 * (non-suffix) toolset's current VS generation.
 *
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if at least one runner was processed successfully
 */
export async function updateWindowsMsvcDefaults(rootDir: string): Promise<boolean> {
    console.log('\n==== Updating Windows MSVC defaults ====');

    // Read runner-images.json for the list of Windows runners
    const runnerImagesPath = path.join(rootDir, 'setup-program/runner-images.json');
    if (!fs.existsSync(runnerImagesPath)) {
        console.error('Error: runner-images.json not found. Run runner-images update first.');
        return false;
    }

    const runnerImagesData: RunnerImagesJson = JSON.parse(fs.readFileSync(runnerImagesPath, 'utf-8'));
    const windowsRunners = runnerImagesData.runners.windows || [];
    if (windowsRunners.length === 0) {
        console.error('Error: no Windows runners found in runner-images.json');
        return false;
    }

    const token = process.env.GITHUB_TOKEN || undefined;

    // Fetch toolset directory to discover multi-suffix files
    let toolsetDir: Map<string, ToolsetFileInfo[]>;
    try {
        console.log('  Fetching Windows toolset directory listing...');
        toolsetDir = await fetchToolsetDirectory(token);
        console.log(`    Found ${toolsetDir.size} runner versions with toolset files`);
    } catch (err) {
        // Untested: requires the GitHub Contents API to fail, which the
        // mocked responses never produce in the main integration test.
        console.warn(`  Warning: failed to fetch toolset directory: ${err}`);
        // Fall back to runner-images.json URLs only
        toolsetDir = new Map();
    }

    // Build a map of runner name → toolset files.
    // Primary runners come from runner-images.json (e.g., "windows-2025").
    // Multi-suffix runners come from the directory listing (e.g., "windows-2025-vs2026").
    const runnerToolsets = new Map<string, ToolsetFileInfo[]>();

    for (const runner of windowsRunners) {
        const version = runner.version;
        const runnerName = `windows-${version}`;

        if (runner.toolset_url) {
            runnerToolsets.set(runnerName, [{
                runnerVersion: version,
                runnerName,
                isPrimary: true,
                downloadUrl: runner.toolset_url
            }]);
        }
    }

    // Add multi-suffix runners from directory listing as separate entries
    for (const [dirRunnerName, dirFiles] of toolsetDir.entries()) {
        if (!runnerToolsets.has(dirRunnerName)) {
            // This is a new runner not in runner-images.json (e.g., windows-2025-vs2026)
            runnerToolsets.set(dirRunnerName, dirFiles);
        }
    }

    // Process each runner
    const runners: Record<string, OutputRunnerMsvcInfo> = {};
    let successCount = 0;

    const sortedRunnerNames = [...runnerToolsets.keys()].sort();

    for (const runnerName of sortedRunnerNames) {
        const files = runnerToolsets.get(runnerName)!;
        console.log(`  Processing ${runnerName} (${files.length} toolset file(s))...`);

        const allVersions: DiscoveredMsvcVersion[] = [];
        let mingwVersion: string | null = null;
        let llvmVersion: string | null = null;

        for (const file of files) {
            try {
                const toolset = await fetchJson(file.downloadUrl) as ToolsetJson;
                const discovered = await discoverMsvcVersions(toolset, file.isPrimary);
                allVersions.push(...discovered);
                console.log(`    ${file.isPrimary ? 'Primary' : 'Extra'}: found ${discovered.length} MSVC version(s)`);

                // Extract MinGW and LLVM versions from the primary toolset
                if (file.isPrimary) {
                    mingwVersion = extractMingwVersion(toolset);
                    llvmVersion = extractLlvmVersion(toolset);
                    if (mingwVersion) {
                        console.log(`    MinGW GCC major: ${mingwVersion}`);
                    }
                    if (llvmVersion) {
                        console.log(`    LLVM major: ${llvmVersion}`);
                    }
                }
            } catch (err) {
                // Untested: requires a toolset fetch to fail, which the
                // mocked responses never produce.
                console.warn(`    Warning: failed to process ${file.downloadUrl}: ${err}`);
            }
        }

        // Untested: requires all toolset fetches for a runner to fail
        // or return no MSVC components.
        if (allVersions.length === 0) {
            console.warn(`    Warning: no MSVC versions discovered for ${runnerName}`);
            continue;
        }

        // Merge and deduplicate versions
        const mergedVersions = mergeVersions(allVersions);
        const runnerInfo: OutputRunnerMsvcInfo = { msvc_versions: mergedVersions };
        if (mingwVersion) {
            runnerInfo.mingw_version = mingwVersion;
        }
        if (llvmVersion) {
            runnerInfo.llvm_version = llvmVersion;
        }
        runners[runnerName] = runnerInfo;
        successCount++;
        console.log(`    ${mergedVersions.length} unique MSVC version(s) for ${runnerName}`);
    }

    // Untested: requires all runners to have zero MSVC versions,
    // which cannot happen with the mocked toolset data.
    if (successCount === 0) {
        console.error('Error: failed to process any Windows runner toolsets');
        return false;
    }

    // Fetch Chocolatey installable versions for MinGW and LLVM
    const [installableMingw, installableLlvm] = await Promise.all([
        fetchChocolateyVersions('mingw'),
        fetchChocolateyVersions('llvm')
    ]);

    const result: WindowsMsvcDefaults = {
        generated: new Date().toISOString(),
        source: 'actions/runner-images toolsets + VS channel manifests',
        runners,
        installable_mingw: installableMingw,
        installable_llvm: installableLlvm
    };

    const outputPath = path.join(rootDir, 'setup-program/windows-msvc-defaults.json');
    const outputDir = path.dirname(outputPath);
    // Untested: the test helper always pre-creates setup-program/,
    // and in normal operation the directory already exists.
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    console.log(`Windows MSVC defaults saved to ${outputPath} (${successCount} runners)`);

    return true;
}

/**
 * Merges and deduplicates MSVC version entries by version string.
 *
 * When the same MSVC version appears in multiple toolset files,
 * `is_default: true` wins over `false`.
 *
 * @param versions - Array of discovered MSVC version entries to merge
 * @returns Deduplicated array sorted by version descending
 */
function mergeVersions(versions: DiscoveredMsvcVersion[]): OutputMsvcVersionEntry[] {
    const map = new Map<string, OutputMsvcVersionEntry>();

    for (const v of versions) {
        const existing = map.get(v.version);
        if (existing) {
            // is_default: true wins
            if (v.is_default) {
                existing.is_default = true;
            }
        } else {
            map.set(v.version, {
                version: v.version,
                vs_year: v.vs_year,
                is_default: v.is_default
            });
        }
    }

    // Sort by version descending (higher MSVC minor first)
    return [...map.values()].sort((a, b) => {
        const aMinor = parseInt(a.version.split('.')[1], 10);
        const bMinor = parseInt(b.version.split('.')[1], 10);
        return bMinor - aMinor;
    });
}
