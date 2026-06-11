/**
 * Matrix entry construction utilities for cpp-matrix action.
 *
 * @module entry-builder
 */

import * as semver from 'semver';

import { type CompilerSuggestion, type MatrixEntry } from './types';
import { type Inputs } from './schema';
import { getVisualCppYear, findMacOSGccVersions, findMacOSClangVersions } from './versions';
import { humanizeCompilerName } from './compiler-support';
import { loadUbuntuCompilerDefaults, loadMacOSXcodeDefaults, loadWindowsMsvcDefaults } from 'setup-program';

/**
 * Sets the semver components (major, minor, patch) on a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param minSubrangeVersion - Minimum version in the subrange
 * @param maxSubrangeVersion - Maximum version in the subrange
 */
export function setEntrySemverComponents(entry: MatrixEntry, minSubrangeVersion: semver.SemVer | null, maxSubrangeVersion: semver.SemVer | null): void {
    // Extract major, minor, and patch versions from the subrange
    if (minSubrangeVersion !== null && maxSubrangeVersion !== null) {
        if (minSubrangeVersion.major === maxSubrangeVersion.major) {
            entry['major'] = minSubrangeVersion.major;
            if (minSubrangeVersion.minor === maxSubrangeVersion.minor) {
                entry['minor'] = minSubrangeVersion.minor;
                if (minSubrangeVersion.patch === maxSubrangeVersion.patch) {
                    entry['patch'] = minSubrangeVersion.patch;
                } else {
                    entry['patch'] = `*`;
                }
            } else {
                entry['minor'] = `*`;
                entry['patch'] = `*`;
            }
        } else {
            entry['major'] = `*`;
            entry['minor'] = `*`;
            entry['patch'] = `*`;
        }
    }
}

/**
 * Sets the compiler executable names (cc, cxx) on a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param compilerName - Compiler name
 * @param minSubrangeVersion - Minimum version in the subrange
 */
export function setCompilerExecutableNames(entry: MatrixEntry, compilerName: string, minSubrangeVersion: semver.SemVer): void {
    // Usual cxx/cc names (no name usually needed for msvc)
    if (compilerName === 'gcc') {
        if (semver.satisfies(minSubrangeVersion, '>=5')) {
            entry['cxx'] = `g++-${minSubrangeVersion.major}`;
            entry['cc'] = `gcc-${minSubrangeVersion.major}`;
        } else {
            entry['cxx'] = `g++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`;
            entry['cc'] = `gcc-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`;
        }
    } else if (compilerName === 'clang') {
        if (semver.satisfies(minSubrangeVersion, '>=7')) {
            entry['cxx'] = `clang++-${minSubrangeVersion.major}`;
            entry['cc'] = `clang-${minSubrangeVersion.major}`;
        } else {
            entry['cxx'] = `clang++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`;
            entry['cc'] = `clang-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`;
        }
    } else if (compilerName === 'apple-clang') {
        entry['cxx'] = `clang++`;
        entry['cc'] = `clang`;
    } else if (compilerName === 'clang-cl') {
        entry['cxx'] = `clang++-cl`;
        entry['cc'] = `clang-cl`;
    } else if (compilerName === 'mingw') {
        entry['cxx'] = `g++`;
        entry['cc'] = `gcc`;
    } else if (compilerName === 'macos-gcc') {
        entry['cxx'] = `g++-${minSubrangeVersion.major}`;
        entry['cc'] = `gcc-${minSubrangeVersion.major}`;
    } else if (compilerName === 'macos-clang') {
        entry['cxx'] = `clang++-${minSubrangeVersion.major}`;
        entry['cc'] = `clang-${minSubrangeVersion.major}`;
    }
}

/**
 * Sets default compiler executable names when version is unknown.
 *
 * @param entry - Matrix entry to update
 * @param compilerName - Compiler name
 */
export function setCompilerExecutableNamesNoVersion(entry: MatrixEntry, compilerName: string): void {
    // Set cxx/cc names for compilers without known version information.
    // These compilers use the system-installed version.
    if (compilerName === 'apple-clang') {
        entry['cxx'] = `clang++`;
        entry['cc'] = `clang`;
    } else if (compilerName === 'clang-cl') {
        entry['cxx'] = `clang++-cl`;
        entry['cc'] = `clang-cl`;
    } else if (compilerName === 'mingw') {
        entry['cxx'] = `g++`;
        entry['cc'] = `gcc`;
    } else if (compilerName === 'macos-gcc') {
        const versions = findMacOSGccVersions();
        const latest = versions.length > 0 ? semver.major(versions[versions.length - 1]) : 15;
        entry['cxx'] = `g++-${latest}`;
        entry['cc'] = `gcc-${latest}`;
    } else if (compilerName === 'macos-clang') {
        const versions = findMacOSClangVersions();
        const latest = versions.length > 0 ? semver.major(versions[versions.length - 1]) : 18;
        entry['cxx'] = `clang++-${latest}`;
        entry['cc'] = `clang-${latest}`;
    }
    // For gcc, clang, and msvc we expect to have version information,
    // so we don't set defaults here.
}

/**
 * Sets default runs-on for compilers without version info.
 *
 * @param entry - Matrix entry to update
 * @param compilerName - Compiler name
 */
export function setCompilerContainerNoVersion(entry: MatrixEntry, compilerName: string): void {
    // Set runs-on for compilers without known version information.
    // These compilers use the system-installed version on the runner.
    if (['apple-clang', 'macos-gcc', 'macos-clang'].includes(compilerName)) {
        entry['runs-on'] = findNewestMacOSRunner();
    } else if (['mingw', 'clang-cl'].includes(compilerName)) {
        entry['runs-on'] = findNewestWindowsRunner();
    }
    // For gcc, clang, and msvc we expect to have version information,
    // so we don't set defaults here.
}

/**
 * Type guard for checking if a value is an array of CompilerSuggestion.
 *
 * @param val - Value to check
 * @returns True if val is CompilerSuggestion array
 */
export function isArrayOfObjects(val: unknown): val is CompilerSuggestion[] {
    return Array.isArray(val) && val.length > 0 && typeof val[0] === 'object';
}

/**
 * Applies a suggestion to a matrix entry based on matching criteria.
 *
 * @param entry - Matrix entry to update
 * @param key - Key to set on the entry
 * @param suggestionMap - Array of suggestions to match against
 * @param subrange - Version subrange for matching
 * @returns True if a suggestion was applied
 */
export function setSuggestion(entry: MatrixEntry, key: string, suggestionMap: CompilerSuggestion[], subrange: string): boolean {
    if (isArrayOfObjects(suggestionMap)) {
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.factor !== undefined && userSuggestion.compiler === entry.compiler) {
                const factorKey = userSuggestion.factor.toLowerCase();
                if (entry[factorKey]) {
                    entry[key] = userSuggestion.value;
                    return true;
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    entry[key] = userSuggestion.value;
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Appends a suggestion value to an existing matrix entry field.
 *
 * Unlike {@link setSuggestion} which replaces the value, this function
 * appends the suggestion value to the existing value with a space separator.
 * This is useful for accumulative fields like `install`, `ccflags`, and
 * `cxxflags` where `setRecommendedFlags` already builds up values from
 * factors.
 *
 * @param entry - Matrix entry to update
 * @param key - Key to append to on the entry
 * @param suggestionMap - Array of suggestions to match against
 * @param subrange - Version subrange for matching
 * @returns True if a suggestion was appended
 */
export function appendSuggestion(entry: MatrixEntry, key: string, suggestionMap: CompilerSuggestion[], subrange: string): boolean {
    if (isArrayOfObjects(suggestionMap)) {
        let appended = false;
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.factor !== undefined && userSuggestion.compiler === entry.compiler) {
                const factorKey = userSuggestion.factor.toLowerCase();
                if (entry[factorKey]) {
                    const existing = typeof entry[key] === 'string' ? entry[key].trim() : '';
                    entry[key] = existing ? `${existing} ${userSuggestion.value}` : userSuggestion.value;
                    appended = true;
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    const existing = typeof entry[key] === 'string' ? entry[key].trim() : '';
                    entry[key] = existing ? `${existing} ${userSuggestion.value}` : userSuggestion.value;
                    appended = true;
                }
            }
        }
        return appended;
    }
    return false;
}

/**
 * Applies forced factors from suggestions to a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param suggestionMap - Array of force factor suggestions
 * @param subrange - Version subrange for matching
 * @returns True if a factor was applied
 */
export function applyForcedFactors(entry: MatrixEntry, suggestionMap: CompilerSuggestion[], subrange: string): boolean {
    if (isArrayOfObjects(suggestionMap)) {
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.factor !== undefined && userSuggestion.compiler === entry.compiler) {
                const factorKey = userSuggestion.factor.toLowerCase();
                if (entry[factorKey]) {
                    const forcedFactor = userSuggestion.value;
                    const lcForcedFactor = forcedFactor.toLowerCase();
                    entry[lcForcedFactor] = true;
                    return true;
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    const forcedFactor = userSuggestion.value;
                    const lcForcedFactor = forcedFactor.toLowerCase();
                    entry[lcForcedFactor] = true;
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Finds the best Ubuntu release for a given compiler major version using
 * ubuntu-compiler-defaults.json data.
 *
 * Selection priority:
 * 1. The release where the version is the build-essential / meta-package default
 *    (is_default: true). If multiple releases have it as default, the newest is chosen.
 * 2. The newest stable LTS release that has the version available in its default repos.
 *
 * @param compilerName - Compiler family name ('gcc' or 'clang')
 * @param majorVersion - Major version number to look up
 * @returns Ubuntu version string (e.g., "22.04") or null if no release provides this version
 */
export function findBestUbuntuRelease(compilerName: string, majorVersion: number): string {
    const compilerKey = compilerName === 'gcc' || compilerName === 'clang' ? compilerName : null;
    const defaults = loadUbuntuCompilerDefaults();

    let ltsDefault: number = 0;
    let ltsAvailable: number = 0;
    let newestLts: number = 0;
    let newestRelease: number = 0;

    // First pass: find newest LTS and newest release overall
    for (const version of Object.keys(defaults.releases)) {
        const releaseNum = parseFloat(version);
        const isLts = Math.round((releaseNum % 1) * 100) === 4 && Math.floor(releaseNum) % 2 === 0;
        if (isLts && releaseNum > newestLts) {
            newestLts = releaseNum;
        }
        if (releaseNum > newestRelease) {
            newestRelease = releaseNum;
        }
    }

    // Only the newest non-LTS release is usable — older ones are EOL
    // with their apt repos removed from archive.ubuntu.com.
    let currentDefault: number = 0;
    let currentAvailable: number = 0;

    for (const [version, release] of Object.entries(defaults.releases)) {
        const releaseNum = parseFloat(version);
        const isLts = Math.round((releaseNum % 1) * 100) === 4 && Math.floor(releaseNum) % 2 === 0;

        if (!compilerKey) {
            continue;
        }

        const info = release[compilerKey];
        if (!info) {
            continue;
        }

        const hasVersion = info.available_versions.some(v => v.major === majorVersion);
        if (!hasVersion) {
            continue;
        }

        const isDefault = info.available_versions.some(v => v.major === majorVersion && v.is_default);

        if (isLts) {
            if (isDefault && releaseNum > ltsDefault) {
                ltsDefault = releaseNum;
            }
            if (releaseNum > ltsAvailable) {
                ltsAvailable = releaseNum;
            }
        } else if (releaseNum === newestRelease) {
            // Only use the newest non-LTS release (the only one guaranteed active)
            if (isDefault) {
                currentDefault = releaseNum;
            }
            currentAvailable = releaseNum;
        }
    }

    // Priority:
    // 1. LTS where it's the build-essential default (stable + no PPA needed)
    // 2. LTS where it's available (stable + apt install gcc-N works)
    // 3. Current (newest) non-LTS where it's the default
    // 4. Current (newest) non-LTS where it's available
    // 5. Newest LTS (fallback for versions not in any release — PPA needed)
    const best = ltsDefault || ltsAvailable || currentDefault || currentAvailable || newestLts || 24.04;
    return best.toFixed(2);
}

/**
 * Finds the best macOS runner for a given Apple Clang major version using
 * macos-xcode-defaults.json data.
 *
 * Selection priority:
 * 1. The runner where the matching Xcode is the default (is_default: true).
 *    If multiple runners have it as default, the newest runner is chosen.
 * 2. The newest runner that has a matching Xcode version.
 * 3. The newest available runner (fallback when no runner has the version).
 *
 * @param majorVersion - Apple Clang major version number to look up
 * @returns macOS runner string (e.g., "macos-15") or "macos-14" if data is unavailable
 */
export function findBestMacOSRunner(majorVersion: number): string {
    try {
        const defaults = loadMacOSXcodeDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'macos-14';
        }

        // Parse runner number for sorting (e.g., "macos-15" → 15)
        const runnerNum = (r: string): number => {
            const m = r.match(/macos-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        let bestDefault = '';
        let bestAvailable = '';
        let newestRunner = '';

        for (const runner of runners) {
            const num = runnerNum(runner);

            // Track newest runner overall
            if (!newestRunner || num > runnerNum(newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            for (const entry of info.xcode_versions) {
                const clangMajor = parseInt(entry.apple_clang.split('.')[0], 10);
                if (clangMajor !== majorVersion) {
                    continue;
                }

                // Track runner where matching Xcode is the default
                if (entry.is_default && (!bestDefault || num > runnerNum(bestDefault))) {
                    bestDefault = runner;
                }

                // Track newest runner that has a matching version
                if (!bestAvailable || num > runnerNum(bestAvailable)) {
                    bestAvailable = runner;
                }
            }
        }

        return bestDefault || bestAvailable || newestRunner;
    } catch {
        return 'macos-14';
    }
}

/**
 * Finds the best Windows runner for a given MSVC minor version using windows-msvc-defaults.json.
 *
 * Selection priority: (1) runner where the matching version has `is_default: true`,
 * (2) newest runner that has the version available, (3) newest runner overall (fallback).
 *
 * @param msvcMinor - The MSVC minor version number (e.g., 44 for MSVC 14.44)
 * @returns The best Windows runner string (e.g., "windows-2025") or "windows-2022" if data is unavailable
 */
export function findBestWindowsRunner(msvcMinor: number): string {
    try {
        const defaults = loadWindowsMsvcDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'windows-2022';
        }

        // Parse runner year for sorting (e.g., "windows-2025" → 2025)
        const runnerYear = (r: string): number => {
            const m = r.match(/windows-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        let bestDefault = '';
        let bestAvailable = '';
        let newestRunner = '';

        /**
         * Compares two runners by year then by name length (standard runner preferred over suffixed variants).
         *
         * @param a - First runner string
         * @param b - Second runner string
         * @returns True if a ranks higher than b
         */
        const isNewerRunner = (a: string, b: string): boolean => {
            const yearA = runnerYear(a);
            const yearB = runnerYear(b);
            if (yearA !== yearB) return yearA > yearB;
            return a.length < b.length;
        };

        for (const runner of runners) {
            // Track newest runner overall
            if (!newestRunner || isNewerRunner(runner, newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            for (const entry of info.msvc_versions) {
                const entryMinor = parseInt(entry.version.split('.')[1], 10);
                if (entryMinor !== msvcMinor) {
                    continue;
                }

                // Track runner where matching version is the default
                if (entry.is_default && (!bestDefault || isNewerRunner(runner, bestDefault))) {
                    bestDefault = runner;
                }

                // Track newest runner that has a matching version
                if (!bestAvailable || isNewerRunner(runner, bestAvailable)) {
                    bestAvailable = runner;
                }
            }
        }

        return bestDefault || bestAvailable || newestRunner;
    } catch {
        return 'windows-2022';
    }
}

/**
 * Finds the newest macOS runner from macos-xcode-defaults.json data.
 *
 * @returns The newest macOS runner string (e.g., "macos-15") or "macos-14" if data is unavailable
 */
export function findNewestMacOSRunner(): string {
    try {
        const defaults = loadMacOSXcodeDefaults();
        const runners = Object.keys(defaults.runners);
        if (runners.length === 0) {
            return 'macos-14';
        }
        const runnerNum = (r: string): number => {
            const m = r.match(/macos-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };
        return runners.reduce((best, r) => runnerNum(r) > runnerNum(best) ? r : best);
    } catch {
        return 'macos-14';
    }
}

/**
 * Finds the newest Windows runner from windows-msvc-defaults.json data.
 *
 * @returns The newest Windows runner string (e.g., "windows-2025") or "windows-2022" if data is unavailable
 */
export function findNewestWindowsRunner(): string {
    try {
        const defaults = loadWindowsMsvcDefaults();
        const runners = Object.keys(defaults.runners);
        if (runners.length === 0) {
            return 'windows-2022';
        }
        const runnerYear = (r: string): number => {
            const m = r.match(/windows-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };
        return runners.reduce((best, r) => {
            const yearR = runnerYear(r);
            const yearBest = runnerYear(best);
            if (yearR !== yearBest) return yearR > yearBest ? r : best;
            return r.length < best.length ? r : best;
        });
    } catch {
        // Untested: requires data file to be missing/corrupt
        return 'windows-2022';
    }
}

/**
 * Finds the best Windows runner for a given MinGW GCC major version.
 *
 * Selection priority: (1) newest runner where the pre-installed MinGW major matches,
 * (2) newest runner overall (fallback).
 *
 * @param majorVersion - MinGW GCC major version number to look up
 * @returns The best Windows runner string (e.g., "windows-2025") or "windows-2022" if data is unavailable
 */
export function findBestWindowsRunnerForMingw(majorVersion: number): string {
    try {
        const defaults = loadWindowsMsvcDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'windows-2022';
        }

        const runnerYear = (r: string): number => {
            const m = r.match(/windows-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        /**
         * Compares two runners by year then by name length (standard runner preferred over suffixed variants).
         *
         * @param a - First runner string
         * @param b - Second runner string
         * @returns True if a ranks higher than b
         */
        const isNewerRunner = (a: string, b: string): boolean => {
            const yearA = runnerYear(a);
            const yearB = runnerYear(b);
            if (yearA !== yearB) return yearA > yearB;
            return a.length < b.length;
        };

        let bestMatch = '';
        let newestRunner = '';

        for (const runner of runners) {
            if (!newestRunner || isNewerRunner(runner, newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            if (info.mingw_version && parseInt(info.mingw_version, 10) === majorVersion) {
                if (!bestMatch || isNewerRunner(runner, bestMatch)) {
                    bestMatch = runner;
                }
            }
        }

        return bestMatch || newestRunner;
    } catch {
        // Untested: requires data file to be missing/corrupt
        return 'windows-2022';
    }
}

/**
 * Finds the best Windows runner for a given LLVM major version.
 *
 * Selection priority: (1) newest runner where the pre-installed LLVM major matches,
 * (2) newest runner overall (fallback).
 *
 * @param majorVersion - LLVM major version number to look up
 * @returns The best Windows runner string (e.g., "windows-2025") or "windows-2022" if data is unavailable
 */
export function findBestWindowsRunnerForLlvm(majorVersion: number): string {
    try {
        const defaults = loadWindowsMsvcDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'windows-2022';
        }

        const runnerYear = (r: string): number => {
            const m = r.match(/windows-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        /**
         * Compares two runners by year then by name length (standard runner preferred over suffixed variants).
         *
         * @param a - First runner string
         * @param b - Second runner string
         * @returns True if a ranks higher than b
         */
        const isNewerRunner = (a: string, b: string): boolean => {
            const yearA = runnerYear(a);
            const yearB = runnerYear(b);
            if (yearA !== yearB) return yearA > yearB;
            return a.length < b.length;
        };

        let bestMatch = '';
        let newestRunner = '';

        for (const runner of runners) {
            if (!newestRunner || isNewerRunner(runner, newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            if (info.llvm_version && parseInt(info.llvm_version, 10) === majorVersion) {
                if (!bestMatch || isNewerRunner(runner, bestMatch)) {
                    bestMatch = runner;
                }
            }
        }

        return bestMatch || newestRunner;
    } catch {
        // Untested: requires data file to be missing/corrupt
        return 'windows-2022';
    }
}

/**
 * Finds the best macOS runner for a given GCC major version using
 * macos-xcode-defaults.json data.
 *
 * Selection priority: (1) newest runner where the requested GCC major is in
 * `gcc_versions`, (2) newest runner overall (fallback).
 *
 * @param majorVersion - GCC major version number to look up
 * @returns The best macOS runner string (e.g., "macos-15") or "macos-14" if data is unavailable
 */
export function findBestMacOSRunnerForGcc(majorVersion: number): string {
    try {
        const defaults = loadMacOSXcodeDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'macos-14';
        }

        const runnerNum = (r: string): number => {
            const m = r.match(/macos-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        let bestMatch = '';
        let newestRunner = '';

        for (const runner of runners) {
            const num = runnerNum(runner);

            if (!newestRunner || num > runnerNum(newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            if (info.gcc_versions && info.gcc_versions.some(v => parseInt(v, 10) === majorVersion)) {
                if (!bestMatch || num > runnerNum(bestMatch)) {
                    bestMatch = runner;
                }
            }
        }

        return bestMatch || newestRunner;
    } catch {
        // Untested: requires data file to be missing/corrupt
        return 'macos-14';
    }
}

/**
 * Finds the best macOS runner for a given LLVM major version using
 * macos-xcode-defaults.json data.
 *
 * Selection priority: (1) newest runner where the pre-installed LLVM major matches,
 * (2) newest runner overall (fallback).
 *
 * @param majorVersion - LLVM major version number to look up
 * @returns The best macOS runner string (e.g., "macos-15") or "macos-14" if data is unavailable
 */
export function findBestMacOSRunnerForLlvm(majorVersion: number): string {
    try {
        const defaults = loadMacOSXcodeDefaults();
        const runners = Object.keys(defaults.runners);

        if (runners.length === 0) {
            return 'macos-14';
        }

        const runnerNum = (r: string): number => {
            const m = r.match(/macos-(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };

        let bestMatch = '';
        let newestRunner = '';

        for (const runner of runners) {
            const num = runnerNum(runner);

            if (!newestRunner || num > runnerNum(newestRunner)) {
                newestRunner = runner;
            }

            const info = defaults.runners[runner];
            if (info.llvm_version && parseInt(info.llvm_version, 10) === majorVersion) {
                if (!bestMatch || num > runnerNum(bestMatch)) {
                    bestMatch = runner;
                }
            }
        }

        return bestMatch || newestRunner;
    } catch {
        // Untested: requires data file to be missing/corrupt
        return 'macos-14';
    }
}

/**
 * Applies data-driven Ubuntu container/runner selection for GCC and Clang compilers.
 *
 * Uses ubuntu-compiler-defaults.json to find the best Ubuntu release for the
 * requested compiler version. For releases newer than the default runner (22.04),
 * a container is always used. For 22.04, a container is used only when
 * {@link Inputs.useContainers} is enabled. For older releases, the matching
 * runner is used directly or a container on the 22.04 runner.
 *
 * @param entry - Matrix entry to update
 * @param inputs - Action inputs
 * @param compilerName - Compiler name ('gcc' or 'clang')
 * @param minSubrangeVersion - Minimum version in the subrange
 * @returns True if a data-driven selection was made, false to fall back to hardcoded logic
 */
function applyUbuntuAutoSelect(entry: MatrixEntry, inputs: Inputs, compilerName: string, minSubrangeVersion: semver.SemVer): void {
    const bestRelease = findBestUbuntuRelease(compilerName, minSubrangeVersion.major);

    // Clang 12–14 on ubuntu-22.04 runners require container isolation due to
    // incompatible libstdc++ versions shipped on the runner image.
    if (compilerName === 'clang'
        && minSubrangeVersion.major >= 12
        && minSubrangeVersion.major < 15
        && bestRelease === '22.04') {
        entry['runs-on'] = 'ubuntu-22.04';
        entry['container'] = 'ubuntu:22.04';
        return;
    }

    const releaseNum = parseFloat(bestRelease);
    if (releaseNum > 22.04) {
        // Newer than the default runner — always use a container
        entry['runs-on'] = 'ubuntu-22.04';
        entry['container'] = `ubuntu:${bestRelease}`;
    } else if (releaseNum === 22.04) {
        entry['runs-on'] = 'ubuntu-22.04';
        if (inputs.useContainers) {
            entry['container'] = `ubuntu:${bestRelease}`;
        }
    } else {
        // Older than default runner
        if (!inputs.useContainers) {
            entry['runs-on'] = `ubuntu-${bestRelease}`;
        } else {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = `ubuntu:${bestRelease}`;
        }
    }
}


/**
 * Sets the container and runs-on configuration for a matrix entry.
 *
 * For GCC and Clang, this first consults ubuntu-compiler-defaults.json to find
 * which Ubuntu release provides the requested compiler version natively. If the
 * data has a match, the container/runner is set based on that release. Otherwise,
 * hardcoded fallback rules are used for versions not covered by the data.
 *
 * @param entry - Matrix entry to update
 * @param inputs - Action inputs
 * @param compilerName - Compiler name
 * @param minSubrangeVersion - Minimum version in the subrange
 * @param _subrange - Version subrange string
 */
export function setCompilerContainer(entry: MatrixEntry, inputs: Inputs, compilerName: string, minSubrangeVersion: semver.SemVer, _subrange: string): void {
    // runs-on / container
    if (compilerName === 'gcc' || compilerName === 'clang') {
        applyUbuntuAutoSelect(entry, inputs, compilerName, minSubrangeVersion);
    } else if (compilerName === 'msvc') {
        entry['runs-on'] = findBestWindowsRunner(minSubrangeVersion.minor);
    } else if (compilerName === 'apple-clang') {
        entry['runs-on'] = findBestMacOSRunner(minSubrangeVersion.major);
    } else if (compilerName === 'mingw') {
        entry['runs-on'] = findBestWindowsRunnerForMingw(minSubrangeVersion.major);
    } else if (compilerName === 'clang-cl') {
        entry['runs-on'] = findBestWindowsRunnerForLlvm(minSubrangeVersion.major);
    } else if (compilerName === 'macos-gcc') {
        entry['runs-on'] = findBestMacOSRunnerForGcc(minSubrangeVersion.major);
    } else if (compilerName === 'macos-clang') {
        entry['runs-on'] = findBestMacOSRunnerForLlvm(minSubrangeVersion.major);
    }

    // Set the volumes for the compiler
    if (entry.container) {
        const image = typeof entry.container === 'string' ? entry.container : entry.container.image;
        if (image.startsWith('ubuntu')) {
            const version = image.split(':')[1];
            const versionNumbers = version.split('.').map(s => parseInt(s));
            const versionMajor = versionNumbers[0];
            if (versionMajor < 20) {
                entry.container = {
                    image: image,
                    volumes: [
                        '/node20217:/node20217:rw,rshared', '/node20217:/__e/node20:ro,rshared',
                        '/node24:/node24:rw,rshared', '/node24:/__e/node24:ro,rshared'
                    ]
                };
            }
        }
    }
}

/**
 * Sets the B2 toolset for a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param _inputs - Action inputs (unused)
 * @param compilerName - Compiler name
 * @param _subrange - Version subrange string (unused)
 */
export function setCompilerB2Toolset(entry: MatrixEntry, _inputs: Inputs, compilerName: string, _subrange: string): void {
    // Recommended b2-toolset
    // The b2 toolset never includes the version number
    if (['mingw', 'gcc', 'macos-gcc'].includes(compilerName)) {
        entry['b2-toolset'] = `gcc`;
    } else if (['clang', 'apple-clang', 'macos-clang'].includes(compilerName)) {
        entry['b2-toolset'] = `clang`;
    } else if (compilerName === 'msvc') {
        entry['b2-toolset'] = `msvc`;
    } else if (compilerName === 'clang-cl') {
        entry['b2-toolset'] = `clang-win`;
    }
}

/**
 * Gets the runs-on labels for a matrix entry as an array.
 *
 * @param entry - Matrix entry
 * @returns Array of lowercase runs-on labels
 */
export function runsOnLabels(entry: MatrixEntry): string[] {
    let runsOn = entry['runs-on'];
    if (!runsOn) {
        return [];
    }
    if (!Array.isArray(runsOn)) {
        runsOn = [runsOn];
    }
    return runsOn
        .filter((label): label is string => typeof label === 'string')
        .map((label) => label.toLowerCase());
}

/**
 * Infers the Visual Studio generator from the runs-on labels.
 *
 * @param entry - Matrix entry
 * @returns Visual Studio generator string or null
 */
export function inferVisualStudioGeneratorFromRunsOn(entry: MatrixEntry): string | null {
    const labels = runsOnLabels(entry);
    const hasLabel = (needle: string): boolean => labels.some((label) => label.includes(needle));

    if (hasLabel('windows-2025') || hasLabel('windows-2022')) {
        return 'Visual Studio 17 2022';
    }
    if (hasLabel('windows-2019')) {
        return 'Visual Studio 16 2019';
    }
    if (hasLabel('windows-2016') || hasLabel('windows-2017')) {
        return 'Visual Studio 15 2017';
    }
    return null;
}

/**
 * Sets the CMake generator for a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param _inputs - Action inputs (unused)
 * @param compilerName - Compiler name
 * @param minSubrangeVersion - Minimum version in the subrange
 * @param maxSubrangeVersion - Maximum version in the subrange
 * @param _subrange - Version subrange string (unused)
 */
export function setCompilerCMakeGenerator(entry: MatrixEntry, _inputs: Inputs, compilerName: string, minSubrangeVersion: semver.SemVer, maxSubrangeVersion: semver.SemVer, _subrange: string): void {
    // Recommended cmake generator
    if (compilerName === 'msvc') {
        // The windows-2025 runner images (both `windows-2025` and the
        // `windows-2025-vs2026` variant) now ship Visual Studio 2026, including for
        // older compat toolsets like v14.44 — there is no standalone VS 2022 install
        // to back a "Visual Studio 17 2022" generator, and CMake's
        // "Visual Studio 18 2026" generator needs CMake 4.0+ (which setup-cmake may
        // not install). Use Ninja with the explicit cl.exe (the MSVC environment,
        // including arch, is activated by setup-cpp) for any windows-2025 runner,
        // regardless of toolset version. This is immune to future image VS bumps.
        const onWindows2025 = runsOnLabels(entry).some((label) => label.includes('windows-2025'));
        if (onWindows2025) {
            entry['generator'] = 'Ninja';
            return;
        }

        // Start with runner-based inference (matches the runner's primary VS)
        const generatorFromRunsOn = inferVisualStudioGeneratorFromRunsOn(entry);
        if (generatorFromRunsOn) {
            entry['generator'] = generatorFromRunsOn;
        }

        // Override with version-based generator when the MSVC version's VS
        // year is newer than the runner's primary VS. This handles runners
        // with multiple VS editions (e.g., windows-2025 has VS 2022 as
        // primary but also VS 2026). For older compat toolsets (e.g., v142
        // on windows-2025), the runner's primary VS generator is correct
        // since the compat toolset runs under the newer VS installation.
        const year = getVisualCppYear(minSubrangeVersion);
        if (year && (minSubrangeVersion === maxSubrangeVersion || year === getVisualCppYear(maxSubrangeVersion))) {
            const yearToGenerator: Record<string, string> = {
                // VS 2026 uses Ninja because CMake's "Visual Studio 18 2026" generator
                // requires CMake 4.0+, but setup-cmake may install CMake 3.x.
                // Revisit when cmake-workflow supports CMake 4.x version selection.
                '2026': 'Ninja',
                '2022': 'Visual Studio 17 2022',
                '2019': 'Visual Studio 16 2019',
                '2017': 'Visual Studio 15 2017',
                '2015': 'Visual Studio 14 2015',
                '2013': 'Visual Studio 12 2013',
                '2012': 'Visual Studio 11 2012',
                '2010': 'Visual Studio 10 2010',
                '2008': 'Visual Studio 9 2008',
                '2005': 'Visual Studio 8 2005'
            };
            const versionGenerator = yearToGenerator[year];
            if (versionGenerator && parseInt(year, 10) > parseInt(generatorFromRunsOn?.match(/\d{4}/)?.[0] || '0', 10)) {
                entry['generator'] = versionGenerator;
            }
        }
    } else if (compilerName === 'mingw') {
        entry['generator'] = `MinGW Makefiles`;
    } else if (compilerName === 'clang-cl') {
        entry['generator'] = 'Ninja';
    }
}

/**
 * Sets version-related flags on a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param i - Current index in the subranges array
 * @param subranges - Array of version subranges
 * @param minSubrangeVersion - Minimum version in the subrange
 * @param maxSubrangeVersion - Maximum version in the subrange
 */
export function setEntryVersionFlags(entry: MatrixEntry, i: number, subranges: string[], minSubrangeVersion: semver.SemVer | null, maxSubrangeVersion: semver.SemVer | null): void {
    // Latest/earliest/has-major/has-minor/has-patch/subrange-policy flags
    // subranges are ordered so the latest flag is the last entry
    // in the matrix for this compiler
    entry['is-latest'] = i === subranges.length - 1;
    entry['is-main'] = i === subranges.length - 1;

    // Earliest flag
    entry['is-earliest'] = i === 0;

    // Intermediary flags
    entry['is-intermediary'] = !entry['is-latest'] && !entry['is-earliest'];

    // Indicate if major, minor, or patch are not specified
    entry['has-major'] = entry['major'] !== '*';
    entry['has-minor'] = entry['minor'] !== '*';
    entry['has-patch'] = entry['patch'] !== '*';

    // Flag with the subrange policy used
    if (entry['has-major'] === false) {
        entry['subrange-policy'] = 'system-version';
    } else if (!minSubrangeVersion || !maxSubrangeVersion || subranges.length === 1 || minSubrangeVersion.major !== maxSubrangeVersion.major) {
        entry['subrange-policy'] = 'one-per-major';
    } else {
        entry['subrange-policy'] = 'one-per-minor';
    }
}

/**
 * Sets the display name for a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param compilerName - Compiler name
 * @param subrange - Version subrange string
 * @param compilerCxxs - Array of supported C++ standards
 */
export function setEntryName(entry: MatrixEntry, compilerName: string, subrange: string, compilerCxxs: string[]): void {
    // Come up with a name for this entry
    let name = `${humanizeCompilerName(compilerName)}`;
    if (subrange !== '*') {
        name += ` ${subrange}`;
    }
    if (compilerCxxs.length !== 0) {
        if (compilerCxxs.length > 1) {
            name += `: C++${compilerCxxs[0]}-${compilerCxxs[compilerCxxs.length - 1]}`;
        } else {
            name += `: C++${compilerCxxs[0]}`;
        }
    }
    entry['name'] = name;
}
