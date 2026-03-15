/**
 * CMake download URL generation.
 *
 * @module url-generation
 */

import * as semver from 'semver';

/**
 * Generates the download URL for a specific CMake version.
 *
 * @param version - CMake version to download
 * @param architecture - Target architecture (x86, x64, arm, arm64)
 * @param fnlog - Logging function for trace output
 * @returns URL to download the CMake archive
 * @throws Error if version is invalid
 */
export function generateCMakeURL(version: string, architecture: string, fnlog: (msg: string) => void): string {
    const versionSV = semver.parse(version);
    if (!versionSV) {
        throw new Error(`Invalid version: ${version}`);
    }
    const { major, minor } = versionSV;

    // Determine path to download
    const systemOs = (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    let urlOs = systemOs;
    // Put it in the same format as the GitHub Actions runner
    if (urlOs === 'darwin' || urlOs === 'macos') {
        urlOs = 'macos';
    } else if (urlOs === 'win32' || urlOs === 'windows') {
        urlOs = 'windows';
    } else {
        urlOs = 'linux';
    }

    let urlArch = (architecture || process.env['RUNNER_ARCH'] || process.arch).toLowerCase();
    // Put it in the same format as the GitHub Actions runner (X86, X64, ARM, or ARM64)
    if (urlArch === 'ia32') {
        urlArch = 'x86';
    }

    // CMake 3.19.0 and below use a different URL format for OS
    if (semver.lte(version, '3.19.0')) {
        if (urlOs === 'windows') {
            if (urlArch === 'x86') {
                urlOs = 'win32';
            } else {
                urlOs = 'win64';
            }
        } else if (urlOs === 'linux') {
            urlOs = 'Linux';
        } else if (urlOs === 'macos' && semver.lte(version, '3.18.2')) {
            urlOs = 'Darwin';
        }
    }

    // Arch URL format depends on OS
    if (urlOs === 'windows') {
        urlArch = urlArch.startsWith('arm') ? 'arm64' : 'x86_64';
    } else if (urlOs === 'win32') {
        urlArch = 'x86';
    } else if (urlOs === 'win64') {
        urlArch = 'x64';
    } else if (urlOs.toLowerCase() === 'linux') {
        urlArch = urlArch.startsWith('arm') ? 'aarch64' : 'x86_64';
    } else if (urlOs === 'macos') {
        urlArch = 'universal';
    }

    // Form complete URL
    const urlExtension = (systemOs === 'windows' || systemOs === 'win32') ? 'zip' : 'tar.gz';
    const cmakeBasename = `cmake-${version}-${urlOs}-${urlArch}`;
    const cmakeFilename = `${cmakeBasename}.${urlExtension}`;
    const cmakeUrl = `https://cmake.org/files/v${major}.${minor}/${cmakeFilename}`;
    fnlog(`CMake URL: ${cmakeUrl}`);
    return cmakeUrl;
}
