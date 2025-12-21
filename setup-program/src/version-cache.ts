/**
 * Version caching utilities for setup-program action.
 *
 * @module version-cache
 */

import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';

let versionsCacheDir: string | null = null;

/**
 * Returns the default directory path for caching version information.
 *
 * @returns Absolute path to the default cache directory
 */
function defaultVersionsCacheDir(): string {
    // Keep caches near the action code, not the caller's CWD
    return path.join(__dirname, '..', 'var', 'cache', 'setup-program');
}

/**
 * Sets the directory used for caching version information files.
 *
 * @param dir - Absolute path to the cache directory
 */
export function setVersionsCacheDir(dir: string): void {
    versionsCacheDir = dir;
}

/**
 * Resolves a filename to a full path within the versions cache directory.
 *
 * If the filename is already absolute, returns it unchanged. Otherwise,
 * prepends the cache directory path.
 *
 * @param filename - Filename or path to resolve
 * @returns Absolute path to the file within the cache directory
 */
export function resolveVersionsCachePath(filename: string): string {
    if (path.isAbsolute(filename)) {
        return filename;
    }
    const baseDir = versionsCacheDir || process.env.SETUP_PROGRAM_CACHE_DIR || defaultVersionsCacheDir();
    return path.join(baseDir, filename);
}

/**
 * Reads cached version information from a JSON file.
 *
 * @param filename - Filename or path to the cache file
 * @returns Array of version strings if file exists and is valid, null otherwise
 */
export function readVersionsFromFile(filename: string): string[] | null {
    const resolvedFilename = resolveVersionsCachePath(filename);
    try {
        const fileContents = fs.readFileSync(resolvedFilename, 'utf8');
        const versions = JSON.parse(fileContents);
        if (Array.isArray(versions)) {
            return versions;
        }
    } catch (error) {
        // File reading failed or versions couldn't be parsed
    }
    return null;
}

/**
 * Saves version information to a JSON cache file.
 *
 * Creates the parent directory if it doesn't exist.
 *
 * @param versions - Array of version strings to cache
 * @param filename - Filename or path to the cache file
 */
export function saveVersionsToFile(versions: string[], filename: string): void {
    const resolvedFilename = resolveVersionsCachePath(filename);
    try {
        const fileContents = JSON.stringify(versions);
        fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true });
        fs.writeFileSync(resolvedFilename, fileContents, 'utf8');
        trace_commands.log('Versions saved to file.');
    } catch (error) {
        trace_commands.log('Error saving versions to file: ' + String(error));
    }
}
