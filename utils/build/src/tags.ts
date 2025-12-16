/**
 * Git tag fetching utilities for compiler version discovery.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runCommand } from './runner';

/**
 * Configuration for a tag source.
 */
interface TagSource {
    /** Repository URL */
    url: string;
    /** Output file path (relative to root) */
    outputFile: string;
}

/**
 * Tag sources for compiler versions.
 */
const TAG_SOURCES: TagSource[] = [
    {
        url: 'git://gcc.gnu.org/git/gcc.git',
        outputFile: 'setup-program/gcc-tags.json'
    },
    {
        url: 'https://github.com/llvm/llvm-project',
        outputFile: 'setup-program/clang-tags.json'
    },
    {
        url: 'https://github.com/Kitware/CMake.git',
        outputFile: 'setup-program/cmake-tags.json'
    }
];

/**
 * Fetches tags from a remote Git repository and saves them as JSON.
 * @param repoUrl - The URL of the remote Git repository
 * @param outputFile - The path to the output JSON file
 * @returns Promise resolving to true if successful
 */
export async function fetchTags(repoUrl: string, outputFile: string): Promise<boolean> {
    console.log(`Fetching tags from ${repoUrl}...`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Fetch tags using git ls-remote
    const result = await runCommand('git', ['ls-remote', '--tags', repoUrl], {
        timeout: 60000 // 1 minute timeout
    });

    if (!result.success) {
        console.error(`Failed to fetch tags from ${repoUrl}: ${result.stderr}`);
        return false;
    }

    // Parse tags from output
    const tags: string[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        // Format: <sha>\trefs/tags/<tagname>
        const match = line.match(/refs\/tags\/(.+)$/);
        if (match) {
            // Skip ^{} dereferenced tags
            if (!match[1].endsWith('^{}')) {
                tags.push(match[1]);
            }
        }
    }

    // Write to JSON file
    fs.writeFileSync(outputFile, JSON.stringify(tags, null, 2));
    console.log(`Tags saved to ${outputFile} (${tags.length} tags)`);

    return true;
}

/**
 * Fetches all configured tag sources.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if all fetches succeeded
 */
export async function fetchAllTags(rootDir: string): Promise<boolean> {
    console.log('\n==== Fetching remote tags ====');

    let allSuccess = true;
    for (const source of TAG_SOURCES) {
        const outputPath = path.join(rootDir, source.outputFile);
        const success = await fetchTags(source.url, outputPath);
        if (!success) {
            allSuccess = false;
        }
    }

    return allSuccess;
}
