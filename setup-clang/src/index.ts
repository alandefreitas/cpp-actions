import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as semver from 'semver';
import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

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
function loadUbuntuVersionNames(): Record<string, string> {
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
 * Candidate versions and Ubuntu releases for Clang download attempts.
 */
interface ClangDownloadCandidates {
    version_candidates: string[];
    ubuntu_versions: string[];
}

/**
 * LLVM project URLs for downloading Clang releases.
 */
interface ClangUrls {
    llvm_project_url: string;
    llvm_releases_url: string;
    old_llvm_releases_url: string;
}

/**
 * Result of a program search operation.
 */
interface ProgramResult {
    output_version: string | null;
    output_path: string | null;
}

/**
 * Output values produced by Clang setup.
 */
interface MainOutputs {
    output_path: string | null;
    cc: string | null;
    cxx: string | null;
    bindir: string;
    dir: string;
    version: string;
    version_major: number;
    version_minor: number;
    version_patch: number;
    symbolizer_path: string | null;
}

/**
 * Configuration inputs for the setup-clang action.
 */
interface Inputs {
    version: string;
    path: string[];
    check_latest: boolean;
    update_environment: boolean;
    trace_commands: boolean;
}

/**
 * Removes "clang-" or "clang++-" prefixes from a version string.
 *
 * @param version - Version string potentially prefixed with clang- or clang++-
 * @returns Cleaned version string without the prefix
 */
function removeClangPrefix(version: string): string {
    // Remove "clang-" or "clang++-" prefix
    if (version.startsWith('clang-') || version.startsWith('clang++-')) {
        version = version.replace('clang-', '').replace('clang++-', '');
    }

    // Remove "clang " or "clang++ " prefix
    if (version.startsWith('clang ') || version.startsWith('clang++ ')) {
        version = version.replace('clang ', '').replace('clang++ ', '');
    }

    return version;
}

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
function clangDownloadCandidates(
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
function generateClangUrlsFor(version_candidate: string, ubuntu_version: string): ClangUrls {
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
async function install_program_from_clang_urls(
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

/**
 * Finds llvm-symbolizer in the system and returns its path.
 *
 * @param majorVersion - The major version of Clang installed
 * @returns Path to llvm-symbolizer if found, null otherwise
 */
async function findLlvmSymbolizer(majorVersion: number): Promise<string | null> {
    // Check common absolute paths for llvm-symbolizer
    const absolutePaths = [
        `/usr/lib/llvm-${majorVersion}/bin/llvm-symbolizer`,
        `/usr/bin/llvm-symbolizer-${majorVersion}`,
        '/usr/bin/llvm-symbolizer'
    ];

    for (const p of absolutePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    // Check if llvm-symbolizer is in PATH using io.which
    const pathNames = [`llvm-symbolizer-${majorVersion}`, 'llvm-symbolizer'];
    for (const name of pathNames) {
        try {
            const found = await io.which(name, false);
            if (found) {
                return found;
            }
        } catch {
            // Continue checking other candidates
        }
    }

    return null;
}

/**
 * Recursively searches for a file matching the given name in a directory.
 *
 * @param dir - Directory to search in
 * @param filename - Filename to search for
 * @param maxDepth - Maximum recursion depth
 * @returns True if file is found
 */
function findFileRecursive(dir: string, filename: string, maxDepth: number): boolean {
    if (maxDepth <= 0 || !fs.existsSync(dir)) {
        return false;
    }

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) {
                return true;
            }
            if (entry.isDirectory()) {
                if (findFileRecursive(fullPath, filename, maxDepth - 1)) {
                    return true;
                }
            }
        }
    } catch {
        // Permission denied or other error, skip this directory
    }

    return false;
}

/**
 * Checks if sanitizer runtime libraries are available.
 *
 * @param majorVersion - The major version of Clang installed
 * @returns True if ASan runtime library is found (used as proxy for all sanitizer runtimes)
 */
function hasSanitizerRuntimes(majorVersion: number): boolean {
    // Check common locations for sanitizer runtime libraries
    // We check for ASan as a proxy for all sanitizer runtimes
    const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
    const asanFilename = `libclang_rt.asan-${arch}.a`;

    // Direct paths to check first (most common locations)
    const directPaths = [
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}/lib/linux/${asanFilename}`,
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}.0.0/lib/linux/${asanFilename}`,
        `/usr/lib/llvm-${majorVersion}/lib/clang/${majorVersion}.0.1/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}.0.0/lib/linux/${asanFilename}`,
        `/usr/lib/clang/${majorVersion}.0.1/lib/linux/${asanFilename}`
    ];

    for (const p of directPaths) {
        if (fs.existsSync(p)) {
            return true;
        }
    }

    // Search in base directories with limited recursion depth
    const baseDirs = [
        `/usr/lib/llvm-${majorVersion}/lib/clang`,
        '/usr/lib/clang'
    ];

    for (const baseDir of baseDirs) {
        if (findFileRecursive(baseDir, asanFilename, 5)) {
            return true;
        }
    }

    return false;
}

/**
 * Result of companion package installation.
 */
interface CompanionPackageResult {
    /** Path to llvm-symbolizer if found, null otherwise */
    symbolizerPath: string | null;
}

/**
 * Installs companion packages for Clang to ensure tool parity.
 *
 * Different Clang installation sources provide different tools. This function
 * checks if required tools are present and installs them if missing:
 * - llvm-symbolizer: Required for readable sanitizer stack traces
 * - Sanitizer runtimes: Required for ASan, UBSan, TSan, MSan
 *
 * @param installedVersion - The version of Clang that was installed (e.g., "14.0.0")
 * @param installedAptPackage - The APT package name that was installed (e.g., "clang" or "clang-14"), or null if not from APT
 * @param installedFromUrl - True if Clang was installed from URL download
 * @returns Object containing the symbolizer path if found
 */
async function installCompanionPackages(installedVersion: string, installedAptPackage: string | null, installedFromUrl: boolean): Promise<CompanionPackageResult> {
    function fnlog(msg: string): void {
        trace_commands.log('installCompanionPackages: ' + msg);
    }

    let symbolizerPath: string | null = null;

    // Only install companion packages on Linux with APT
    if (process.platform !== 'linux') {
        fnlog('Skipping companion packages: not on Linux');
        return { symbolizerPath };
    }

    // Check if APT is available
    try {
        const exitCode = await exec.exec('apt', ['--version'], { silent: true });
        if (exitCode !== 0) {
            fnlog('APT not available');
            return { symbolizerPath };
        }
    } catch {
        fnlog('APT not available');
        return { symbolizerPath };
    }

    const version = semver.coerce(installedVersion);
    if (!version) {
        fnlog(`Could not parse version: ${installedVersion}`);
        return { symbolizerPath };
    }
    const majorVersion = version.major;

    // Determine if the installed package is unversioned (e.g., "clang" vs "clang-14")
    const isUnversionedPackage = installedAptPackage !== null &&
        setup_program.getPackagePreferenceTier(installedAptPackage, ['clang']) === setup_program.PackagePreferenceTier.UNVERSIONED;

    fnlog(`Installed APT package: ${installedAptPackage ?? 'none'}, isUnversioned: ${isUnversionedPackage}, fromUrl: ${installedFromUrl}`);

    const opts = {
        env: {
            DEBIAN_FRONTEND: 'noninteractive',
            TZ: 'Etc/UTC',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        },
        ignoreReturnCode: true,
        silent: true
    };

    // Determine sudo prefix
    let sudoPrefix = '';
    try {
        const { exitCode } = await exec.getExecOutput('sudo', ['-n', 'true'], { silent: true, ignoreReturnCode: true });
        if (exitCode === 0) {
            sudoPrefix = 'sudo -n ';
        }
    } catch {
        // sudo not available
    }

    // Check if llvm-symbolizer is already available
    symbolizerPath = await findLlvmSymbolizer(majorVersion);
    if (symbolizerPath) {
        fnlog(`llvm-symbolizer already available at ${symbolizerPath}`);
        core.info(`✅ llvm-symbolizer already available at ${symbolizerPath}`);
    } else {
        fnlog('llvm-symbolizer not found, attempting to install');
        // For unversioned clang, prefer unversioned llvm; for versioned, prefer versioned llvm
        const llvmPackages = isUnversionedPackage
            ? ['llvm', `llvm-${majorVersion}`]
            : [`llvm-${majorVersion}`, 'llvm'];
        for (const pkg of llvmPackages) {
            fnlog(`Trying to install ${pkg}`);
            const exitCode = await exec.exec(`${sudoPrefix}apt-get install -y ${pkg}`, [], opts);
            if (exitCode === 0) {
                core.info(`✅ Installed ${pkg} for llvm-symbolizer`);
                // Find the symbolizer path after installation
                symbolizerPath = await findLlvmSymbolizer(majorVersion);
                if (symbolizerPath) {
                    fnlog(`llvm-symbolizer found at ${symbolizerPath}`);
                }
                break;
            }
        }
    }

    // Check if sanitizer runtimes are already available
    if (hasSanitizerRuntimes(majorVersion)) {
        fnlog('Sanitizer runtimes already available, skipping installation');
        core.info('✅ Sanitizer runtimes already available');
    } else {
        fnlog('Sanitizer runtimes not found, attempting to install');
        const rtPackages = [
            `libclang-rt-${majorVersion}-dev`,
            `libclang-common-${majorVersion}-dev`
        ];
        for (const pkg of rtPackages) {
            fnlog(`Trying to install ${pkg}`);
            const exitCode = await exec.exec(`${sudoPrefix}apt-get install -y ${pkg}`, [], opts);
            if (exitCode === 0) {
                core.info(`✅ Installed ${pkg} for sanitizer runtimes`);
                break;
            }
        }
    }

    return { symbolizerPath };
}

/**
 * Sets up Clang compiler on the runner with the specified version.
 *
 * This function locates or installs Clang with the requested version, searching
 * the provided paths first, then falling back to apt-get installation on Linux.
 * On macOS, it uses the system-provided Clang. It can optionally update
 * environment variables to make the compiler available.
 *
 * @param version - The Clang version to set up (e.g., "14", "14.0", ">=14"). Supports
 *                  semver ranges for flexible version matching.
 * @param paths - Array of paths to search for existing Clang installations before
 *                attempting installation
 * @param check_latest - If true, checks for the latest available version matching
 *                       the version constraint
 * @param update_environment - If true, updates PATH and environment variables to
 *                             make the compiler available for subsequent steps
 * @returns Object containing paths to clang/clang++, version info, and environment changes
 */
export async function main(
    version: string,
    paths: string[],
    check_latest: boolean,
    update_environment: boolean
): Promise<MainOutputs> {
    core.startGroup('🌍 Find clang versions');
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache';
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY'];
    }
    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux');
    }

    const allVersions: string[] = await setup_program.findClangVersions();
    core.endGroup();

    // Path program version
    let output_path: string | null = null;
    let output_version: string | null = null;
    let installed_apt_package: string | null = null;

    // Setup path program
    if (paths.length > 0) {
        core.startGroup('📂 Find clang in specified paths');
        core.info(`Searching for Clang ${version} in paths [${paths.join(',')}]`);
        const result = await setup_program.find_program_in_path(paths, version, check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup system program
    if (!output_path) {
        core.startGroup('💻 Find clang in system paths');
        core.info(`Searching for Clang ${version} in PATH`);
        trace_commands.log(`Arguments: ${paths}, ['clang++'], ${version}, ${check_latest}`);
        const result = await setup_program.find_program_in_system_paths(
            paths,
            ['clang++'],
            version,
            check_latest
        );
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    }

    // Setup APT program
    if (!output_version && process.platform === 'linux') {
        core.startGroup('📦 Find clang with APT');
        core.info(`Searching for Clang ${version} with APT`);

        // Add repositories for major clang versions
        const allVersionMajors = allVersions
            .filter((v) => semver.satisfies(v, version))
            .map((v) => semver.parse(v)?.major)
            .filter((value): value is number => value !== undefined && value >= 10)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort((a, b) => b - a);
        trace_commands.log(`All version major candidates: [${allVersionMajors.join(', ')}]`);

        const ubuntuName = setup_program.getCurrentUbuntuName() as string | null;
        trace_commands.log(`Ubuntu version name: ${ubuntuName}`);
        trace_commands.log(`allVersionMajors.length: ${allVersionMajors.length}`);
        if (ubuntuName !== null && allVersionMajors.length !== 0) {
            core.info(
                `Adding APT repositories for Clang ${version} major versions [${allVersionMajors.join(', ')}]`
            );

            // Adding a key requires gnupg
            await setup_program.find_program_with_apt(['gnupg'], '*', true);

            // Download repo key
            const gpg_key_url = 'https://apt.llvm.org/llvm-snapshot.gpg.key';
            const keyPath = await tc.downloadTool(gpg_key_url);
            if (setup_program.isSudoRequired()) {
                await setup_program.ensureSudoIsAvailable();
                await exec.exec(`sudo -n sudo apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            } else {
                await exec.exec(`apt-key add "${keyPath}"`, [], { ignoreReturnCode: true });
            }

            // add-apt-repository requires installing software-properties-common
            await setup_program.find_program_with_apt(['software-properties-common'], '*', true);
            let add_apt_repository_path: string | null = null;
            try {
                add_apt_repository_path = await io.which('add-apt-repository');
                trace_commands.log(`add-apt-repository found at ${add_apt_repository_path}`);
            } catch {
                add_apt_repository_path = null;
            }

            // Add APT repositories
            if (add_apt_repository_path !== null && add_apt_repository_path !== '') {
                for (const major of allVersionMajors) {
                    const ReleaseFileURL = `https://apt.llvm.org/${ubuntuName}/dists/llvm-toolchain-${ubuntuName}-${major}/Release`;
                    trace_commands.log(`Checking if ${ReleaseFileURL} exists`);
                    if (!(await setup_program.urlExists(ReleaseFileURL))) {
                        trace_commands.log(
                            `Skipping repository for major version ${major} because ${ReleaseFileURL} does not exist`
                        );
                        continue;
                    }
                    await setup_program.ensureAddAptRepositoryIsAvailable();
                    const repo = `deb https://apt.llvm.org/${ubuntuName}/ llvm-toolchain-${ubuntuName}-${major} main`;
                    trace_commands.log(`Adding repository "${repo}"`);
                    if (setup_program.isSudoRequired()) {
                        await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], {
                            ignoreReturnCode: true
                        });
                    } else {
                        await exec.exec(`add-apt-repository -y "${repo}"`, [], { ignoreReturnCode: true });
                    }
                }
            }
        }

        core.info(`Searching for Clang ${version} with APT`);
        const result = await setup_program.find_program_with_apt(['clang'], version, check_latest);
        output_version = result.output_version;
        output_path = result.output_path;
        installed_apt_package = result.installed_package ?? null;
        core.endGroup();
    } else {
        if (output_version !== null) {
            trace_commands.log(
                `Skipping APT step because Clang ${output_version} was already found in ${output_path}`
            );
        } else if (process.platform !== 'linux') {
            trace_commands.log(`Skipping APT step because platform is ${process.platform}`);
        }
    }

    // If output_version === null, and it gets installed at all, it will be installed from a URL
    const will_install_from_url = output_version === null;
    if (output_version === null) {
        core.startGroup('⬇️ Download clang');
        const { version_candidates, ubuntu_versions } = clangDownloadCandidates(
            version,
            allVersions,
            check_latest
        );
        const result = await install_program_from_clang_urls(
            ubuntu_versions,
            version_candidates,
            version,
            check_latest,
            update_environment,
            output_version,
            output_path
        );
        output_version = result.output_version;
        output_path = result.output_path;
        core.endGroup();
    } else {
        trace_commands.log(
            `Skipping download step because Clang ${output_version} was already found in ${output_path}`
        );
    }

    // Install companion packages for tool parity (llvm-symbolizer, sanitizer runtimes)
    let symbolizer_path: string | null = null;
    if (output_version) {
        core.startGroup('📦 Install companion packages');
        const companionResult = await installCompanionPackages(output_version, installed_apt_package, will_install_from_url);
        symbolizer_path = companionResult.symbolizerPath;
        core.endGroup();

        // Set sanitizer symbolizer environment variables if symbolizer was found
        if (symbolizer_path && update_environment) {
            core.info(`Setting sanitizer symbolizer path to ${symbolizer_path}`);
            core.exportVariable('ASAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('MSAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('TSAN_SYMBOLIZER_PATH', symbolizer_path);
            core.exportVariable('UBSAN_SYMBOLIZER_PATH', symbolizer_path);
        }
    }

    // Create outputs
    let cc: string | null = output_path;
    let cxx: string | null = output_path;
    let bindir = '';
    let dir = '';
    let release = '0.0.0';
    let version_major = 0;
    let version_minor = 0;
    let version_patch = 0;

    if (output_path) {
        const path_basename = path.basename(output_path);
        if (path_basename.startsWith('clang++')) {
            cc = path.join(path.dirname(output_path), path_basename.replace('clang++', 'clang'));
        } else if (path_basename.startsWith('clang')) {
            cxx = path.join(path.dirname(output_path), path_basename.replace('clang', 'clang++'));
        }

        if (cc && !fs.existsSync(cc)) {
            trace_commands.log(`Could not find ${cc}, using ${output_path} as cc instead`);
            cc = output_path;
        }

        if (cxx && !fs.existsSync(cxx)) {
            trace_commands.log(`Could not find ${cxx}, using ${output_path} as cxx instead`);
            cxx = output_path;
        }

        const semverV =
            output_version !== null
                ? semver.parse(output_version, { loose: true })
                : semver.parse('0.0.0', { loose: true });

        if (semverV) {
            release = semverV.toString();
            version_major = semverV.major;
            version_minor = semverV.minor;
            version_patch = semverV.patch;
        }

        bindir = path.dirname(output_path);
        if (update_environment) {
            core.addPath(bindir);
        }
        dir = path.dirname(bindir);

        if (will_install_from_url) {
            // If it's installed from the url, we need to add the lib dirs to LD_LIBRARY_PATH,
            // or it won't be able to find the default shared libraries
            let LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH;
            let LD_LIBRARY_PATHS: string[] = [];
            if (LD_LIBRARY_PATH !== null && LD_LIBRARY_PATH !== undefined) {
                LD_LIBRARY_PATHS = LD_LIBRARY_PATH.split(':').filter((x) => x !== '');
            }
            const lib_dirs = [path.join(dir, 'lib')];
            for (const lib_dir of lib_dirs) {
                if (fs.existsSync(lib_dir)) {
                    if (!LD_LIBRARY_PATHS.includes(lib_dir)) {
                        trace_commands.log(`Adding ${lib_dir} to LD_LIBRARY_PATH`);
                        LD_LIBRARY_PATHS.push(lib_dir);
                    } else {
                        trace_commands.log(`Skipping ${lib_dir} because it is already in LD_LIBRARY_PATH`);
                    }
                } else {
                    trace_commands.log(`Skipping ${lib_dir} because it does not exist`);
                }
            }
            LD_LIBRARY_PATH = LD_LIBRARY_PATHS.join(':');
            if (LD_LIBRARY_PATH !== process.env.LD_LIBRARY_PATH) {
                trace_commands.log(`Setting LD_LIBRARY_PATH to ${LD_LIBRARY_PATH}`);
                core.exportVariable('LD_LIBRARY_PATH', LD_LIBRARY_PATH);
            }
        }
    }
    return {
        output_path,
        cc,
        cxx,
        bindir,
        dir,
        version: release,
        version_major,
        version_minor,
        version_patch,
        symbolizer_path
    };
}

let lastInputsForErrors: Inputs | undefined = undefined;

/**
 * Main entry point for the setup-clang GitHub Action.
 *
 * Parses inputs and sets up the Clang compiler environment.
 */
async function run(): Promise<void> {
    const inputs: Inputs = {
        version: removeClangPrefix(gh_inputs.getInput('version', { defaultValue: '*' })),
        path: gh_inputs.getArray('path', /[:;]/),
        check_latest: gh_inputs.getBoolean('check-latest'),
        update_environment: gh_inputs.getBoolean('update-environment'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    };

    lastInputsForErrors = inputs;

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    const outputs = await main(inputs.version, inputs.path, inputs.check_latest, inputs.update_environment);

    // Parse Final program / Setup version / Outputs
    if (outputs.output_path) {
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    } else {
        core.setFailed('Cannot setup Clang');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            const capturedInputs = lastInputsForErrors as Inputs | undefined;
            const hint = capturedInputs?.trace_commands
                ? 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
                : 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. ';
            await reportAndSetFailed(error as Error, {
                title: 'Setup Clang failed',
                hint,
                locals: () => ({ inputs: capturedInputs })
            });
        }
    })();
}
