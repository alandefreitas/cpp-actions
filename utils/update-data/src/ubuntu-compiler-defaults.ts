/**
 * Fetches apt Packages.gz metadata from archive.ubuntu.com for each stable
 * Ubuntu release and writes setup-program/ubuntu-compiler-defaults.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as zlib from 'zlib';

import {
    type CompilerVersionEntry,
    parsePackagesFile,
    extractCompilerPackages,
    resolveDefaultGcc,
    resolveDefaultClang
} from './packages-parser';

/**
 * Compiler information for a single compiler family within a release.
 */
interface CompilerInfo {
    default_version: string;
    available_versions: CompilerVersionEntry[];
}

/**
 * Compiler data for a single Ubuntu release.
 */
interface ReleaseCompilerData {
    codename: string;
    gcc: CompilerInfo;
    clang: CompilerInfo;
}

/**
 * Top-level structure for the ubuntu-compiler-defaults.json data file.
 */
interface UbuntuCompilerDefaults {
    generated: string;
    source: string;
    releases: Record<string, ReleaseCompilerData>;
}

/**
 * Ubuntu version map type (version string to codename).
 */
type UbuntuVersionMap = Record<string, string>;

/**
 * APT archive components to fetch Packages.gz from.
 */
const APT_COMPONENTS = ['main', 'universe'] as const;

/**
 * Fetches a binary resource from an HTTPS URL.
 *
 * @param url - The HTTPS URL to fetch
 * @returns Promise resolving to the response body as a Buffer
 * @throws Error if the HTTP response status is not 200
 */
function fetchBuffer(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                // Consume the response to free resources
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
        }).on('error', reject);
    });
}

/**
 * Ubuntu archive hosts. Current releases are on archive.ubuntu.com;
 * EOL releases are moved to old-releases.ubuntu.com.
 */
const ARCHIVE_HOSTS = [
    'https://archive.ubuntu.com/ubuntu',
    'https://old-releases.ubuntu.com/ubuntu'
] as const;

/**
 * Fetches and decompresses a Packages.gz file from the Ubuntu archive for a
 * given release codename and component. Tries archive.ubuntu.com first, then
 * falls back to old-releases.ubuntu.com for EOL releases.
 *
 * @param codename - Ubuntu release codename (e.g., "jammy")
 * @param component - APT component ("main" or "universe")
 * @returns Promise resolving to the decompressed Packages file text, or null on failure
 */
async function fetchPackagesGz(codename: string, component: string): Promise<string | null> {
    for (const host of ARCHIVE_HOSTS) {
        const url = `${host}/dists/${codename}/${component}/binary-amd64/Packages.gz`;
        try {
            const compressed = await fetchBuffer(url);
            const decompressed = zlib.gunzipSync(compressed);
            return decompressed.toString('utf-8');
        } catch {
            // Try next host
        }
    }
    console.warn(`  Warning: failed to fetch ${component} Packages.gz for ${codename} from all archives`);
    return null;
}

/**
 * Marks the default version entry in a compiler version list by setting
 * `is_default: true` on the matching entry.
 *
 * @param versions - Array of compiler version entries to update in place
 * @param defaultMajor - The default major version string (e.g., "11"), or null
 */
function markDefault(versions: CompilerVersionEntry[], defaultMajor: string | null): void {
    if (defaultMajor === null) {
        return;
    }
    const majorNum = parseInt(defaultMajor, 10);
    for (const entry of versions) {
        if (entry.major === majorNum) {
            entry.is_default = true;
        }
    }
}

/**
 * Builds a {@link CompilerInfo} object from version entries and a resolved default.
 *
 * @param versions - Available compiler version entries
 * @param defaultMajor - Resolved default major version string, or null
 * @returns Compiler info with default_version and available_versions populated
 */
function buildCompilerInfo(versions: CompilerVersionEntry[], defaultMajor: string | null): CompilerInfo {
    markDefault(versions, defaultMajor);
    return {
        default_version: defaultMajor ?? '',
        available_versions: versions
    };
}

/**
 * Fetches apt metadata for a single Ubuntu release and returns structured
 * compiler data.
 *
 * Fetches Packages.gz from both `main` and `universe` components, merges the
 * package lists, extracts compiler packages, and resolves default versions.
 *
 * @param codename - Ubuntu release codename (e.g., "jammy")
 * @returns Promise resolving to the release compiler data, or null on failure
 */
async function fetchReleaseData(codename: string): Promise<ReleaseCompilerData | null> {
    console.log(`  Fetching packages for ${codename}...`);

    const allPackagesTexts: string[] = [];
    for (const component of APT_COMPONENTS) {
        const text = await fetchPackagesGz(codename, component);
        if (text !== null) {
            allPackagesTexts.push(text);
        }
    }

    if (allPackagesTexts.length === 0) {
        console.warn(`  Warning: no package data available for ${codename}, skipping`);
        return null;
    }

    const mergedText = allPackagesTexts.join('\n\n');
    const packages = parsePackagesFile(mergedText);
    const compilers = extractCompilerPackages(packages);
    const defaultGcc = resolveDefaultGcc(packages);
    const defaultClang = resolveDefaultClang(packages);

    return {
        codename,
        gcc: buildCompilerInfo(compilers.gcc, defaultGcc),
        clang: buildCompilerInfo(compilers.clang, defaultClang)
    };
}

/**
 * Filters the full Ubuntu version map to only include releases >= 16.04
 * (Xenial). Older releases predate modern GCC/Clang apt packaging patterns.
 * EOL releases whose archives have moved to old-releases.ubuntu.com are
 * still included — the fetcher falls back to that host automatically.
 *
 * @param versions - Full Ubuntu version-to-codename map
 * @returns Filtered map containing only relevant releases
 */
function filterRelevantReleases(versions: UbuntuVersionMap): UbuntuVersionMap {
    const MIN_VERSION = 16.04;
    const filtered: UbuntuVersionMap = {};
    for (const [version, codename] of Object.entries(versions)) {
        const majorMinor = parseFloat(version);
        if (majorMinor >= MIN_VERSION) {
            filtered[version] = codename;
        }
    }
    return filtered;
}

/**
 * Fetches apt metadata from archive.ubuntu.com for each stable Ubuntu release
 * and writes the ubuntu-compiler-defaults.json data file.
 *
 * Reads ubuntu-versions.json for version-to-codename mappings, fetches
 * Packages.gz for each release, extracts compiler information, and writes the
 * result to setup-program/ubuntu-compiler-defaults.json.
 *
 * If a release's archive URL is unreachable, a warning is logged and the
 * release is skipped.
 *
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if at least one release was processed successfully
 */
export async function updateUbuntuCompilerDefaults(rootDir: string): Promise<boolean> {
    console.log('\n==== Updating Ubuntu compiler defaults ====');

    // Read ubuntu-versions.json for version-to-codename mappings
    const versionsPath = path.join(rootDir, 'setup-program/ubuntu-versions.json');
    if (!fs.existsSync(versionsPath)) {
        console.error('Error: ubuntu-versions.json not found. Run ubuntu-versions update first.');
        return false;
    }

    const allVersions: UbuntuVersionMap = JSON.parse(fs.readFileSync(versionsPath, 'utf-8'));
    const relevantVersions = filterRelevantReleases(allVersions);

    const releases: Record<string, ReleaseCompilerData> = {};
    let successCount = 0;

    // Sort versions for deterministic output
    const sortedEntries = Object.entries(relevantVersions).sort(
        ([a], [b]) => parseFloat(a) - parseFloat(b)
    );

    for (const [version, codename] of sortedEntries) {
        const data = await fetchReleaseData(codename);
        if (data !== null) {
            releases[version] = data;
            successCount++;
        }
    }

    if (successCount === 0) {
        console.error('Error: failed to fetch compiler data for any Ubuntu release');
        return false;
    }

    const result: UbuntuCompilerDefaults = {
        generated: new Date().toISOString(),
        source: 'archive.ubuntu.com apt metadata',
        releases
    };

    const outputPath = path.join(rootDir, 'setup-program/ubuntu-compiler-defaults.json');
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`Ubuntu compiler defaults saved to ${outputPath} (${successCount} releases)`);

    return true;
}
