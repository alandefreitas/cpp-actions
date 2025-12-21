/**
 * Download utilities for setup-clang action.
 *
 * @module download
 */

import * as core from '@actions/core';
import * as semver from 'semver';
import * as trace_commands from 'trace-commands';
import { ClangDownloadCandidates, ClangUrls, ProgramResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

/**
 * Loads Ubuntu version name mappings from JSON file.
 *
 * Searches for the JSON file in multiple locations to support both
 * compiled and source execution contexts.
 *
 * @returns Record mapping Ubuntu version numbers to codenames
 * @throws Error if ubuntu-versions.json cannot be found
 */
export function loadUbuntuVersionNames(): Record<string, string> {
    const path = require('path');
    const paths = [
        path.join(__dirname, '../setup-program/ubuntu-versions.json'),  // from compiled index.js
        path.join(__dirname, '../../setup-program/ubuntu-versions.json') // from src/index.ts
    ];
    for (const p of paths) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            return require(p);
        } catch {
            continue;
        }
    }
    throw new Error('Could not find ubuntu-versions.json');
}

const ubuntuVersionNames: Record<string, string> = loadUbuntuVersionNames();

/**
 * Determines candidate Clang versions and Ubuntu releases for download.
 *
 * Creates ordered lists of version candidates (falling back to similar versions)
 * and Ubuntu version candidates (sorted by proximity to current version).
 *
 * @param version - Semver version constraint for Clang
 * @param allVersions - Array of all available Clang versions
 * @param check_latest - If true, prefer latest matching version
 * @returns Object containing version candidates and Ubuntu version candidates
 * @throws Error if no version satisfies the requirement or version parsing fails
 */
export function clangDownloadCandidates(
    version: string,
    allVersions: string[],
    check_latest: boolean
): ClangDownloadCandidates {
    core.info(`Fetching Clang ${version} from release binaries`);
    // Determine the release to install and version candidates to fall back to
    trace_commands.log('All Clang versions: ' + allVersions);
    const maxV = semver.maxSatisfying(allVersions, version);
    trace_commands.log(`Max version in requirement "${version}": ` + maxV);
    const minV = semver.minSatisfying(allVersions, version);
    trace_commands.log(`Min version in requirement "${version}": ` + minV);
    const release = check_latest ? maxV : minV;
    trace_commands.log(`Target release ${release} (check latest: ${check_latest})`);

    if (!release) {
        throw new Error(`No version satisfies requirement "${version}"`);
    }

    const srelease = semver.parse(release);
    if (!srelease) {
        throw new Error(`Failed to parse release version "${release}"`);
    }
    trace_commands.log(`Parsed release "${release}" is "${srelease.toString()}"`);

    // Determine version candidates we can fall back to by order of preference
    const major = srelease.major;
    const minor = srelease.minor;
    const patch = srelease.patch;
    const version_candidates: string[] = [release];

    // Sort versions
    let sortedVersions: string[];
    if (check_latest) {
        sortedVersions = [...allVersions].sort((a, b) => semver.compare(b, a));
    } else {
        sortedVersions = [...allVersions].sort(semver.compare);
    }

    // 1) Same major, minor, different patch
    for (const v of sortedVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor === minor && sv.patch !== patch) {
            version_candidates.push(v);
        }
    }
    // 2) Same major, different minor
    for (const v of sortedVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor !== minor) {
            version_candidates.push(v);
        }
    }
    trace_commands.log(`Version candidates: [${version_candidates.join(', ')}]`);

    // Determine alternative ubuntu versions to try if the current one fails
    // to have a valid URL
    const cur_ubuntu_version = setup_program.getCurrentUbuntuVersion() as string;
    trace_commands.log(`Ubuntu version: ${cur_ubuntu_version}`);

    // Get list of all ubuntu version candidates in order of preference
    // based on distance from the current ubuntu version
    let ubuntu_versions = Object.keys(ubuntuVersionNames);
    // Some versions in the map include patch components. We want
    // to remove these to keep only the major and the minor.
    ubuntu_versions = ubuntu_versions.map((v) => v.split('.')[0] + '.' + v.split('.')[1]);

    // Sort the ubuntu versions based on the distance from the current ubuntu version
    ubuntu_versions = ubuntu_versions.sort((a, b) => {
        const aMajor = parseInt(a.split('.')[0]);
        const aMinor = parseInt(a.split('.')[1]);
        const bMajor = parseInt(b.split('.')[0]);
        const bMinor = parseInt(b.split('.')[1]);
        const curMajor = parseInt(cur_ubuntu_version.split('.')[0]);
        const curMinor = parseInt(cur_ubuntu_version.split('.')[1]);
        const distA = Math.abs(aMajor - curMajor) * 100 + Math.abs(aMinor - curMinor);
        const distB = Math.abs(bMajor - curMajor) * 100 + Math.abs(bMinor - curMinor);
        return distA - distB;
    });
    trace_commands.log(`Ubuntu version binaries: [${ubuntu_versions.join(', ')}]`);
    return { version_candidates, ubuntu_versions };
}

/**
 * Generates download URLs for a specific Clang version and Ubuntu release.
 *
 * @param version_candidate - Clang version to generate URLs for
 * @param ubuntu_version - Ubuntu version to target
 * @returns Object containing LLVM project, releases, and old-format release URLs
 */
export function generateClangUrlsFor(version_candidate: string, ubuntu_version: string): ClangUrls {
    trace_commands.log(`Trying to fetch Clang ${version_candidate} for Ubuntu ${ubuntu_version}`);
    const ubuntu_image = `ubuntu-${ubuntu_version}`;
    trace_commands.log(`Ubuntu image: ${ubuntu_image}`);
    const clang_basename = `clang+llvm-${version_candidate}-x86_64-linux-gnu-${ubuntu_image}`;
    trace_commands.log(`Clang basename: ${clang_basename}`);
    const clang_filename = `${clang_basename}.tar.xz`;
    trace_commands.log(`Clang filename: ${clang_filename}`);

    const llvm_project_url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version_candidate}/${clang_filename}`;
    const llvm_releases_url = `https://releases.llvm.org/${version_candidate}/${clang_filename}`;

    const old_clang_basename = `clang+llvm-${version_candidate}-linux-x86_64-ubuntu${ubuntu_version}`;
    const old_clang_filename = `${old_clang_basename}.tar.xz`;
    const old_llvm_releases_url = `https://releases.llvm.org/${version_candidate}/${old_clang_filename}`;

    return { llvm_project_url, llvm_releases_url, old_llvm_releases_url };
}

/**
 * Attempts to install Clang from various URL candidates.
 *
 * Tries each combination of Ubuntu version and Clang version candidate
 * until a successful download and installation is achieved.
 *
 * @param ubuntu_versions - Array of Ubuntu versions to try
 * @param version_candidates - Array of Clang versions to try
 * @param _version - Original version constraint (unused)
 * @param check_latest - If true, prefer latest matching version
 * @param update_environment - If true, update PATH environment variable
 * @param output_version - Previously found version (if any)
 * @param output_path - Previously found path (if any)
 * @returns Object containing the installed version and path
 */
export async function install_program_from_clang_urls(
    ubuntu_versions: string[],
    version_candidates: string[],
    _version: string,
    check_latest: boolean,
    update_environment: boolean,
    output_version: string | null,
    output_path: string | null
): Promise<ProgramResult> {
    // Assemble valid URLs in the order of preference in the LLVM project format
    for (const ubuntu_version of ubuntu_versions) {
        for (const version_candidate of version_candidates) {
            const { llvm_project_url, llvm_releases_url, old_llvm_releases_url } =
                generateClangUrlsFor(version_candidate, ubuntu_version);
            for (const clang_url of [llvm_project_url, llvm_releases_url, old_llvm_releases_url]) {
                if (!(await setup_program.urlExists(clang_url))) {
                    trace_commands.log(`Skipping ${clang_url} because it does not exist`);
                } else {
                    const result = await setup_program.install_program_from_url(
                        ['clang'],
                        version_candidate,
                        check_latest,
                        clang_url,
                        update_environment,
                        '/usr/local'
                    );
                    output_version = result.output_version;
                    output_path = result.output_path;
                    if (output_version !== null) {
                        return { output_version, output_path };
                    }
                }
            }
        }
    }
    return { output_version, output_path };
}
