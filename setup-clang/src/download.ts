/**
 * Download utilities for setup-clang action.
 *
 * @module download
 */

import * as core from '@actions/core';
import * as semver from 'semver';
import * as traceCommands from 'trace-commands';
/**
 * Candidate versions and Ubuntu releases for Clang download attempts.
 */
export interface ClangDownloadCandidates {
    versionCandidates: string[];
    ubuntuVersions: string[];
}

/**
 * LLVM project URLs for downloading Clang releases.
 */
export interface ClangUrls {
    llvmProjectUrl: string;
    llvmReleasesUrl: string;
    oldLlvmReleasesUrl: string;
}

/**
 * Result of a program search operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}

import * as path from 'path';
import * as setup_program from 'setup-program';

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
 * @param checkLatest - If true, prefer latest matching version
 * @returns Object containing version candidates and Ubuntu version candidates
 * @throws Error if no version satisfies the requirement or version parsing fails
 */
export function clangDownloadCandidates(
    version: string,
    allVersions: string[],
    checkLatest: boolean
): ClangDownloadCandidates {
    core.info(`Fetching Clang ${version} from release binaries`);
    // Determine the release to install and version candidates to fall back to
    traceCommands.log('All Clang versions: ' + allVersions);
    const maxV = semver.maxSatisfying(allVersions, version);
    traceCommands.log(`Max version in requirement "${version}": ` + maxV);
    const minV = semver.minSatisfying(allVersions, version);
    traceCommands.log(`Min version in requirement "${version}": ` + minV);
    const release = checkLatest ? maxV : minV;
    traceCommands.log(`Target release ${release} (check latest: ${checkLatest})`);

    if (!release) {
        throw new Error(`No version satisfies requirement "${version}"`);
    }

    const srelease = semver.parse(release);
    if (!srelease) {
        throw new Error(`Failed to parse release version "${release}"`);
    }
    traceCommands.log(`Parsed release "${release}" is "${srelease.toString()}"`);

    // Determine version candidates we can fall back to by order of preference
    const major = srelease.major;
    const minor = srelease.minor;
    const patch = srelease.patch;
    const versionCandidates: string[] = [release];

    // Sort versions
    let sortedVersions: string[];
    if (checkLatest) {
        sortedVersions = [...allVersions].sort((a, b) => semver.compare(b, a));
    } else {
        sortedVersions = [...allVersions].sort(semver.compare);
    }

    // 1) Same major, minor, different patch
    for (const v of sortedVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor === minor && sv.patch !== patch) {
            versionCandidates.push(v);
        }
    }
    // 2) Same major, different minor
    for (const v of sortedVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor !== minor) {
            versionCandidates.push(v);
        }
    }
    traceCommands.log(`Version candidates: [${versionCandidates.join(', ')}]`);

    // Determine alternative ubuntu versions to try if the current one fails
    // to have a valid URL
    const curUbuntuVersion = setup_program.getCurrentUbuntuVersion() as string;
    traceCommands.log(`Ubuntu version: ${curUbuntuVersion}`);

    // Get list of all ubuntu version candidates in order of preference
    // based on distance from the current ubuntu version
    let ubuntuVersions = Object.keys(ubuntuVersionNames);
    // Some versions in the map include patch components. We want
    // to remove these to keep only the major and the minor.
    ubuntuVersions = ubuntuVersions.map((v) => v.split('.')[0] + '.' + v.split('.')[1]);

    // Sort the ubuntu versions based on the distance from the current ubuntu version
    ubuntuVersions = ubuntuVersions.sort((a, b) => {
        const aMajor = parseInt(a.split('.')[0]);
        const aMinor = parseInt(a.split('.')[1]);
        const bMajor = parseInt(b.split('.')[0]);
        const bMinor = parseInt(b.split('.')[1]);
        const curMajor = parseInt(curUbuntuVersion.split('.')[0]);
        const curMinor = parseInt(curUbuntuVersion.split('.')[1]);
        const distA = Math.abs(aMajor - curMajor) * 100 + Math.abs(aMinor - curMinor);
        const distB = Math.abs(bMajor - curMajor) * 100 + Math.abs(bMinor - curMinor);
        return distA - distB;
    });
    traceCommands.log(`Ubuntu version binaries: [${ubuntuVersions.join(', ')}]`);
    return { versionCandidates, ubuntuVersions };
}

/**
 * Generates download URLs for a specific Clang version and Ubuntu release.
 *
 * @param versionCandidate - Clang version to generate URLs for
 * @param ubuntuVersion - Ubuntu version to target
 * @returns Object containing LLVM project, releases, and old-format release URLs
 */
export function generateClangUrlsFor(versionCandidate: string, ubuntuVersion: string): ClangUrls {
    traceCommands.log(`Trying to fetch Clang ${versionCandidate} for Ubuntu ${ubuntuVersion}`);
    const ubuntuImage = `ubuntu-${ubuntuVersion}`;
    traceCommands.log(`Ubuntu image: ${ubuntuImage}`);
    const clangBasename = `clang+llvm-${versionCandidate}-x86_64-linux-gnu-${ubuntuImage}`;
    traceCommands.log(`Clang basename: ${clangBasename}`);
    const clangFilename = `${clangBasename}.tar.xz`;
    traceCommands.log(`Clang filename: ${clangFilename}`);

    const llvmProjectUrl = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${versionCandidate}/${clangFilename}`;
    const llvmReleasesUrl = `https://releases.llvm.org/${versionCandidate}/${clangFilename}`;

    const oldClangBasename = `clang+llvm-${versionCandidate}-linux-x86_64-ubuntu${ubuntuVersion}`;
    const oldClangFilename = `${oldClangBasename}.tar.xz`;
    const oldLlvmReleasesUrl = `https://releases.llvm.org/${versionCandidate}/${oldClangFilename}`;

    return { llvmProjectUrl, llvmReleasesUrl, oldLlvmReleasesUrl };
}

/**
 * Attempts to install Clang from various URL candidates.
 *
 * Tries each combination of Ubuntu version and Clang version candidate
 * until a successful download and installation is achieved.
 *
 * @param ubuntuVersions - Array of Ubuntu versions to try
 * @param versionCandidates - Array of Clang versions to try
 * @param _version - Original version constraint (unused)
 * @param checkLatest - If true, prefer latest matching version
 * @param updateEnvironment - If true, update PATH environment variable
 * @param outputVersion - Previously found version (if any)
 * @param outputPath - Previously found path (if any)
 * @returns Object containing the installed version and path
 */
export async function installProgramFromClangUrls(
    ubuntuVersions: string[],
    versionCandidates: string[],
    _version: string,
    checkLatest: boolean,
    updateEnvironment: boolean,
    outputVersion: string | null,
    outputPath: string | null
): Promise<ProgramResult> {
    // Assemble valid URLs in the order of preference in the LLVM project format
    for (const ubuntuVersion of ubuntuVersions) {
        for (const versionCandidate of versionCandidates) {
            const { llvmProjectUrl, llvmReleasesUrl, oldLlvmReleasesUrl } =
                generateClangUrlsFor(versionCandidate, ubuntuVersion);
            for (const clangUrl of [llvmProjectUrl, llvmReleasesUrl, oldLlvmReleasesUrl]) {
                if (!(await setup_program.urlExists(clangUrl))) {
                    traceCommands.log(`Skipping ${clangUrl} because it does not exist`);
                } else {
                    const result = await setup_program.installProgramFromUrl(
                        ['clang'],
                        versionCandidate,
                        checkLatest,
                        clangUrl,
                        updateEnvironment,
                        '/usr/local'
                    );
                    outputVersion = result.outputVersion;
                    outputPath = result.outputPath;
                    if (outputVersion !== null) {
                        return { outputVersion, outputPath };
                    }
                }
            }
        }
    }
    return { outputVersion, outputPath };
}
