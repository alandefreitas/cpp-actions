/**
 * Ubuntu version information fetching and generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

/**
 * Ubuntu version mapping (version number to distribution name).
 */
export type UbuntuVersionMap = Record<string, string>;

/**
 * Fetches content from a URL.
 * @param url - The URL to fetch
 * @returns Promise resolving to the response body
 */
function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', reject);
    });
}

/**
 * Fetches Ubuntu version information from the changelogs server.
 * @returns Promise resolving to the version map
 */
export async function fetchUbuntuVersions(): Promise<UbuntuVersionMap> {
    const url = 'http://changelogs.ubuntu.com/meta-release';
    console.log('Fetching Ubuntu versions from changelogs...');

    const content = await fetchUrl(url);
    const versions: UbuntuVersionMap = {};

    let currentVersion = '';
    let currentDist = '';

    for (const line of content.split('\n')) {
        if (line.startsWith('Version:')) {
            // Extract version and strip "LTS" and beyond
            currentVersion = line.substring(8).trim().replace(/ *LTS.*/, '');
        } else if (line.startsWith('Dist:')) {
            currentDist = line.substring(5).trim();
        } else if (line.trim() === '') {
            // End of block
            if (currentVersion && currentDist) {
                versions[currentVersion] = currentDist;
            }
            currentVersion = '';
            currentDist = '';
        }
    }

    // Handle final block if no trailing newline
    if (currentVersion && currentDist) {
        versions[currentVersion] = currentDist;
    }

    return versions;
}

/**
 * Generates the Ubuntu versions JSON file.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
export async function generateUbuntuVersionsJson(rootDir: string): Promise<boolean> {
    console.log('\n==== Generating Ubuntu versions JSON ====');

    try {
        const versions = await fetchUbuntuVersions();
        const outputPath = path.join(rootDir, 'setup-program/ubuntu-versions.json');

        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, JSON.stringify(versions, null, 2));
        console.log(`Ubuntu versions saved to ${outputPath}`);
        return true;
    } catch (err) {
        console.error('Failed to generate Ubuntu versions:', err);
        return false;
    }
}
