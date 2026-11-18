/**
 * Fetches the runner-images toolset directory listings from the GitHub
 * Contents API and writes setup-program/runner-images.json.
 *
 * Discovers available runner images for Ubuntu, macOS, and Windows by
 * listing the toolset directories in the `actions/runner-images` repository.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A single entry returned by the GitHub Contents API for a directory listing.
 */
interface GitHubContentsEntry {
    /** File or directory name (e.g., `"toolset-14.json"`). */
    name: string;
    /** Direct download URL for raw content. */
    download_url: string | null;
}

/**
 * A runner image entry for the output JSON.
 */
interface RunnerEntry {
    /** Runner name as used in `runs-on` (e.g., `"macos-15"`). */
    name: string;
    /** Version identifier derived from the toolset filename. */
    version: string;
    /** Raw URL to the toolset JSON. */
    toolset_url: string | null;
}

/**
 * Output structure for runner-images.json.
 */
interface RunnerImagesJson {
    generated: string;
    source: string;
    /**
     * Runner labels GitHub Actions accepts in `runs-on`, from the GitHub Docs
     * table of hosted runners. Absent when that table could not be fetched.
     */
    supported_labels?: string[];
    runners: {
        ubuntu: RunnerEntry[];
        macos: RunnerEntry[];
        windows: RunnerEntry[];
    };
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * GitHub Contents API base URL for runner-images toolset directories.
 */
const GITHUB_API_BASE = 'https://api.github.com/repos/actions/runner-images/contents/images';

/**
 * Platform toolset directory paths within the runner-images repository.
 */
const PLATFORM_PATHS: Record<string, string> = {
    ubuntu: 'ubuntu/toolsets',
    macos: 'macos/toolsets',
    windows: 'windows/toolsets'
};

/**
 * Regex patterns to extract version from toolset filenames per platform.
 * Only matches simple `toolset-{version}.json` — files with extra suffixes
 * (e.g., `toolset-2025-vs2026.json`) are skipped.
 */
const TOOLSET_FILENAME_RE = /^toolset-(\d+)\.json$/;

/**
 * GitHub Contents API URL of the GitHub Docs table that lists the runner
 * labels GitHub Actions accepts in `runs-on`.
 *
 * `actions/runner-images` keeps the toolset of an image after GitHub Actions
 * retires it (Azure DevOps may still run it), so its listing alone is not
 * enough: `macos-14` kept its toolset after its retirement from GitHub
 * Actions on November 2, 2026, and every job sent to it was cancelled.
 */
const SUPPORTED_RUNNERS_DOC_URL = 'https://api.github.com/repos/github/docs/contents/data/reusables/actions/supported-github-runners.md';

// ── HTTP helper ─────────────────────────────────────────────────────────────

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

// ── Version derivation ──────────────────────────────────────────────────────

/**
 * Derives the runner name and version from a toolset filename for a given platform.
 *
 * @param platform - Platform name (`"ubuntu"`, `"macos"`, `"windows"`)
 * @param filename - Toolset filename (e.g., `"toolset-2204.json"`)
 * @returns Object with `name` and `version`, or null if the filename should be skipped
 */
export function deriveRunnerInfo(platform: string, filename: string): { name: string; version: string } | null {
    const match = filename.match(TOOLSET_FILENAME_RE);
    if (!match) {
        return null;
    }
    const rawVersion = match[1];

    if (platform === 'macos') {
        return {
            name: `macos-${rawVersion}`,
            version: rawVersion
        };
    }

    if (platform === 'windows') {
        return {
            name: `windows-${rawVersion}`,
            version: rawVersion
        };
    }

    if (platform === 'ubuntu') {
        if (rawVersion.length !== 4) {
            return null;
        }
        const version = `${rawVersion.substring(0, 2)}.${rawVersion.substring(2)}`;
        return {
            name: `ubuntu-${version}`,
            version
        };
    }

    return null;
}

// ── Supported runner labels ─────────────────────────────────────────────────

/**
 * Extracts the runner labels from the GitHub Docs table of supported
 * GitHub-hosted runners, where each label is a `<code>` element, optionally
 * wrapping a link to the image readme.
 *
 * @param markdown - Contents of `supported-github-runners.md`
 * @returns Set of runner labels (e.g., `"macos-15"`, `"ubuntu-24.04"`)
 */
export function parseSupportedRunnerLabels(markdown: string): Set<string> {
    const labels = new Set<string>();
    const re = /<code>(?:<a [^>]*>)?([a-z0-9][a-z0-9.-]*)(?:<\/a>)?<\/code>/g;
    for (const match of markdown.matchAll(re)) {
        labels.add(match[1]);
    }
    return labels;
}

/**
 * Fetches the runner labels GitHub Actions currently accepts.
 *
 * @param token - Optional GitHub token for authenticated requests
 * @returns Set of supported runner labels, or null if they could not be fetched
 */
async function fetchSupportedRunnerLabels(token?: string): Promise<Set<string> | null> {
    try {
        const file = await fetchGitHubJson(SUPPORTED_RUNNERS_DOC_URL, token) as { content?: string };
        const labels = parseSupportedRunnerLabels(Buffer.from(file.content ?? '', 'base64').toString('utf8'));
        if (labels.size === 0) {
            console.warn('  Warning: no runner labels found in the GitHub Docs runner table');
            return null;
        }
        return labels;
    } catch (err) {
        console.warn(`  Warning: failed to fetch the supported runner labels: ${err}`);
        return null;
    }
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetches toolset directory listings from the GitHub Contents API for all
 * platforms and writes the result to `setup-program/runner-images.json`.
 * Images whose runner label GitHub Actions no longer accepts are left out.
 *
 * Uses the `GITHUB_TOKEN` environment variable for authenticated requests
 * if available, which increases the rate limit from 60 to 5000 requests/hour.
 *
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if at least one platform was discovered successfully
 */
export async function updateRunnerImages(rootDir: string): Promise<boolean> {
    console.log('\n==== Updating runner images ====');

    const token = process.env.GITHUB_TOKEN || undefined;
    // Untested: setting GITHUB_TOKEN in tests would leak into other test
    // suites running in the same process.
    if (token) {
        console.log('  Using GITHUB_TOKEN for authenticated API requests');
    }

    console.log('  Fetching supported runner labels...');
    const supported = await fetchSupportedRunnerLabels(token);
    if (!supported) {
        console.warn('  Warning: keeping every runner image, including any retired from GitHub Actions');
    }

    const result: RunnerImagesJson = {
        generated: new Date().toISOString(),
        source: 'GitHub Contents API: actions/runner-images, github/docs',
        ...(supported ? { supported_labels: [...supported].sort() } : {}),
        runners: {
            ubuntu: [],
            macos: [],
            windows: []
        }
    };

    let successCount = 0;

    for (const [platform, dirPath] of Object.entries(PLATFORM_PATHS)) {
        const url = `${GITHUB_API_BASE}/${dirPath}`;
        console.log(`  Fetching ${platform} toolset listing...`);

        try {
            const entries = await fetchGitHubJson(url, token) as GitHubContentsEntry[];
            if (!Array.isArray(entries)) {
                console.warn(`  Warning: unexpected response for ${platform} (not an array)`);
                continue;
            }

            const runners: RunnerEntry[] = [];
            for (const entry of entries) {
                const info = deriveRunnerInfo(platform, entry.name);
                if (!info) {
                    continue;
                }
                if (supported && !supported.has(info.name)) {
                    console.log(`    Skipping ${info.name}: not a supported GitHub Actions runner`);
                    continue;
                }
                runners.push({
                    name: info.name,
                    version: info.version,
                    toolset_url: entry.download_url
                });
            }

            runners.sort((a, b) => a.name.localeCompare(b.name));
            result.runners[platform as keyof typeof result.runners] = runners;
            successCount++;
            console.log(`    Found ${runners.length} ${platform} runner images`);
        } catch (err) {
            console.warn(`  Warning: failed to fetch ${platform} toolset listing: ${err}`);
        }
    }

    if (successCount === 0) {
        console.error('Error: failed to discover any runner images');
        return false;
    }

    const outputPath = path.join(rootDir, 'setup-program/runner-images.json');
    const outputDir = path.dirname(outputPath);
    // Untested: the test helper always pre-creates setup-program/,
    // and in normal operation the directory already exists.
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    console.log(`Runner images saved to ${outputPath} (${successCount} platforms)`);

    return true;
}
