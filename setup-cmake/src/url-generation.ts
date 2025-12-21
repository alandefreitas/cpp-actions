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
    const system_os = (process.env['RUNNER_OS'] || process.platform).toLowerCase();
    let url_os = system_os;
    // Put it in the same format as the GitHub Actions runner
    if (url_os === 'darwin') {
        url_os = 'macos';
    } else if (url_os === 'win32') {
        url_os = 'windows';
    } else {
        url_os = 'linux';
    }

    let url_arch = (architecture || process.env['RUNNER_ARCH'] || process.arch).toLowerCase();
    // Put it in the same format as the GitHub Actions runner (X86, X64, ARM, or ARM64)
    if (url_arch === 'ia32') {
        url_arch = 'x86';
    }

    // CMake 3.19.0 and below use a different URL format for OS
    if (semver.lte(version, '3.19.0')) {
        if (url_os === 'windows') {
            if (url_arch === 'x86') {
                url_os = 'win32';
            } else {
                url_os = 'win64';
            }
        } else if (url_os === 'linux') {
            url_os = 'Linux';
        } else if (url_os === 'macos' && semver.lte(version, '3.18.2')) {
            url_os = 'Darwin';
        }
    }

    // Arch URL format depends on OS
    if (url_os === 'windows') {
        url_arch = url_arch.startsWith('arm') ? 'arm64' : 'x86_64';
    } else if (url_os === 'win32') {
        url_arch = 'x86';
    } else if (url_os === 'win64') {
        url_arch = 'x64';
    } else if (url_os.toLowerCase() === 'linux') {
        url_arch = url_arch.startsWith('arm') ? 'aarch64' : 'x86_64';
    } else if (url_os === 'macos') {
        url_arch = 'universal';
    }

    // Form complete URL
    const url_extension = (system_os === 'windows') ? 'zip' : 'tar.gz';
    const cmake_basename = `cmake-${version}-${url_os}-${url_arch}`;
    const cmake_filename = `${cmake_basename}.${url_extension}`;
    const cmake_url = `https://cmake.org/files/v${major}.${minor}/${cmake_filename}`;
    fnlog(`CMake URL: ${cmake_url}`);
    return cmake_url;
}
