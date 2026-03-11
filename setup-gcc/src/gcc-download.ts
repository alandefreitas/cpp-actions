/**
 * GCC binary download logic for the setup-gcc action.
 *
 * Provides functions for downloading pre-built GCC binaries from GitHub
 * releases, with support for Ubuntu-versioned and generic Linux builds.
 *
 * @module gcc-download
 */

import * as semver from 'semver';
import * as httpm from '@actions/http-client';
import * as traceCommands from 'trace-commands';
import * as setup_program from 'setup-program';

/**
 * Result of a program search or download operation.
 */
export interface ProgramResult {
    outputVersion: string | null;
    outputPath: string | null;
}

/**
 * Parameters for downloading GCC binaries from release URLs.
 */
export interface DownloadGccParams {
    /** Requested GCC version range (semver) */
    version: string;
    /** Whether to prefer the latest matching version */
    checkLatest: boolean;
    /** Whether to update PATH and other environment variables */
    updateEnvironment: boolean;
    /** All known GCC versions from version data */
    allVersions: string[];
}

/**
 * Returns Ubuntu versions ordered by proximity to the current version.
 *
 * Versions closer to the current one are preferred since they are more
 * likely to have compatible system libraries.
 *
 * @param curUbuntuVersion - Current Ubuntu version string (e.g., "22.04"), or null if unknown
 * @returns Array of Ubuntu version strings ordered by preference
 */
export function getUbuntuVersionOrder(curUbuntuVersion: string | null): string[] {
    if (curUbuntuVersion === '20.04') {
        return ['20.04', '22.04', '18.04', '16.04', '14.04', '12.04', '10.04'];
    } else if (curUbuntuVersion === '18.04') {
        return ['18.04', '20.04', '16.04', '22.04', '14.04', '12.04', '10.04'];
    } else if (curUbuntuVersion === '16.04') {
        return ['16.04', '18.04', '14.04', '20.04', '12.04', '22.04', '10.04'];
    } else if (curUbuntuVersion === '12.04') {
        return ['12.04', '14.04', '10.04', '16.04', '18.04', '20.04', '22.04'];
    } else if (curUbuntuVersion === '10.04') {
        return ['10.04', '12.04', '14.04', '16.04', '18.04', '20.04', '22.04'];
    } else {
        return ['22.04', '20.04', '18.04', '16.04', '14.04', '12.04', '10.04'];
    }
}

/**
 * Builds the list of GCC version candidates to try downloading, ordered by
 * preference (same minor first, then same major).
 *
 * @param release - Target release version string
 * @param allVersions - All known GCC versions
 * @returns Ordered list of version strings to attempt
 */
export function buildVersionCandidates(release: string, allVersions: string[]): string[] {
    const semverRelease = semver.parse(release);
    if (!semverRelease) {
        return [];
    }
    const major = semverRelease.major;
    const minor = semverRelease.minor;
    const patch = semverRelease.patch;
    const candidates: string[] = [release];
    for (const v of allVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor === minor && sv.patch !== patch) {
            candidates.push(v);
        }
    }
    for (const v of allVersions) {
        const sv = semver.parse(v);
        if (sv && sv.major === major && sv.minor !== minor) {
            candidates.push(v);
        }
    }
    return candidates;
}

/**
 * Tries to download Ubuntu-versioned GCC binaries from GitHub releases.
 *
 * Iterates over Ubuntu versions and GCC version candidates, checking each
 * URL for availability before attempting installation.
 *
 * @param httpClient - HTTP client for checking URL availability
 * @param ubuntuVersions - Ubuntu versions to try, in preference order
 * @param versionCandidates - GCC version candidates to try
 * @param version - Requested GCC version range
 * @param checkLatest - Whether to prefer the latest matching version
 * @param updateEnvironment - Whether to update PATH and other environment variables
 * @returns Download result with resolved path and version, or nulls if not found
 */
export async function tryUbuntuBinaries(
    httpClient: httpm.HttpClient,
    ubuntuVersions: string[],
    versionCandidates: string[],
    version: string,
    checkLatest: boolean,
    updateEnvironment: boolean
): Promise<ProgramResult> {
    for (const ubuntuVersion of ubuntuVersions) {
        for (const versionCandidate of versionCandidates) {
            traceCommands.log(`Trying to fetch GCC ${versionCandidate} for Ubuntu ${ubuntuVersion}`);
            const ubuntuImage = `ubuntu-${ubuntuVersion}`;
            traceCommands.log(`Ubuntu image: ${ubuntuImage}`);
            const gccBasename = `gcc-${versionCandidate}-x86_64-linux-gnu-${ubuntuImage}`;
            traceCommands.log(`GCC basename: ${gccBasename}`);
            const gccFilename = `${gccBasename}.tar.gz`;
            traceCommands.log(`GCC filename: ${gccFilename}`);
            const gccUrl = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gccFilename}`;
            const res = await httpClient.head(gccUrl);
            if (res.message.statusCode !== 200) {
                traceCommands.log(`Skipping ${gccUrl} because it does not exist`);
                continue;
            }
            const urlResult: ProgramResult = await setup_program.installProgramFromUrl(
                ['gcc'], version, checkLatest,
                gccUrl, updateEnvironment, '/usr/local'
            );
            if (urlResult.outputVersion !== null) {
                return urlResult;
            }
        }
    }
    return { outputVersion: null, outputPath: null };
}

/**
 * Tries to download generic Linux GCC binaries (no Ubuntu version suffix)
 * from GitHub releases.
 *
 * @param httpClient - HTTP client for checking URL availability
 * @param versionCandidates - GCC version candidates to try
 * @param version - Requested GCC version range
 * @param checkLatest - Whether to prefer the latest matching version
 * @param updateEnvironment - Whether to update PATH and other environment variables
 * @returns Download result with resolved path and version, or nulls if not found
 */
export async function tryGenericLinuxBinaries(
    httpClient: httpm.HttpClient,
    versionCandidates: string[],
    version: string,
    checkLatest: boolean,
    updateEnvironment: boolean
): Promise<ProgramResult> {
    for (const versionCandidate of versionCandidates) {
        traceCommands.log(`Trying to fetch GCC ${versionCandidate} for Linux`);
        const gccBasename = `gcc-${versionCandidate}-Linux-x86_64`;
        traceCommands.log(`GCC basename: ${gccBasename}`);
        const gccFilename = `${gccBasename}.tar.gz`;
        traceCommands.log(`GCC filename: ${gccFilename}`);
        const gccUrl = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gccFilename}`;
        const res = await httpClient.head(gccUrl);
        if (res.message.statusCode !== 200) {
            traceCommands.log(`Skipping ${gccUrl} because it does not exist`);
            continue;
        }
        const urlResult: ProgramResult = await setup_program.installProgramFromUrl(
            ['gcc'], version, checkLatest,
            gccUrl, updateEnvironment, '/usr/local'
        );
        if (urlResult.outputVersion !== null) {
            return urlResult;
        }
    }
    return { outputVersion: null, outputPath: null };
}

/**
 * Downloads GCC from release binaries as a last resort.
 *
 * Tries Ubuntu-versioned binaries first (matched to the current OS), then
 * falls back to generic Linux binaries. Iterates through version candidates
 * in order of preference.
 *
 * @param params - Download parameters including version, allVersions, and flags
 * @returns Download result with resolved path and version, or nulls if not found
 */
export async function downloadGccFromUrl(params: DownloadGccParams): Promise<ProgramResult> {
    const { version, checkLatest, updateEnvironment, allVersions } = params;

    traceCommands.log('All GCC versions: ' + allVersions);
    const maxV = semver.maxSatisfying(allVersions, version);
    traceCommands.log(`Max version in requirement "${version}": ` + maxV);
    const minV = semver.minSatisfying(allVersions, version);
    traceCommands.log(`Min version in requirement "${version}": ` + minV);
    const release = checkLatest ? maxV : minV;
    traceCommands.log(`Target release ${release} (check latest: ${checkLatest})`);

    if (!release) {
        return { outputVersion: null, outputPath: null };
    }

    const versionCandidates = buildVersionCandidates(release, allVersions);
    traceCommands.log(`Version candidates: [${versionCandidates.join(', ')}]`);

    // Determine ubuntu version
    const curUbuntuVersion = setup_program.getCurrentUbuntuVersion();
    traceCommands.log(`Ubuntu version: ${curUbuntuVersion}`);
    const ubuntuVersions = getUbuntuVersionOrder(curUbuntuVersion);
    traceCommands.log(`Ubuntu version binaries: [${ubuntuVersions.join(', ')}]`);

    // Try URLs considering ubuntu versions
    const httpClient = new httpm.HttpClient('setup-gcc', [], {
        allowRetries: true, maxRetries: 3
    });

    const ubuntuResult = await tryUbuntuBinaries(
        httpClient, ubuntuVersions, versionCandidates,
        version, checkLatest, updateEnvironment
    );
    if (ubuntuResult.outputVersion !== null) {
        return ubuntuResult;
    }

    return tryGenericLinuxBinaries(
        httpClient, versionCandidates,
        version, checkLatest, updateEnvironment
    );
}
