/**
 * Archive download utilities for boost-clone action.
 *
 * @module archive
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as fs from 'fs';

/**
 * Gets the CMake release archive URL for a Boost release tag.
 *
 * @param releaseTag - The release tag (e.g., boost-1.87.0)
 * @returns The archive URL
 */
export function getArchiveUrl(releaseTag: string): string {
    // CMake release format: boost-1.87.0-cmake.tar.xz
    return `https://github.com/boostorg/boost/releases/download/${releaseTag}/${releaseTag}-cmake.tar.xz`;
}

/**
 * Downloads and extracts a Boost release archive.
 *
 * @param archiveUrl - URL of the archive to download
 * @param targetDir - Directory to extract to
 */
export async function downloadAndExtractArchive(archiveUrl: string, targetDir: string): Promise<void> {
    core.info(`Downloading archive from ${archiveUrl}...`);

    // Download the archive
    const archivePath = await tc.downloadTool(archiveUrl);
    core.info(`Downloaded to ${archivePath}`);

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true });

    // Extract the archive (tar.xz format)
    core.info(`Extracting to ${targetDir}...`);

    // Use tar to extract, stripping the first component (the boost-X.Y.Z-cmake directory)
    await exec.exec('tar', [
        '-xf', archivePath,
        '-C', targetDir,
        '--strip-components=1'
    ]);

    core.info('Archive extracted successfully');
}
