/**
 * Matrix entry construction utilities for cpp-matrix action.
 *
 * @module entry-builder
 */

import * as semver from 'semver';

import { CompilerSuggestion, Inputs, MatrixEntry } from './types';
import { getVisualCppYear } from './versions';
import { humanizeCompilerName } from './compiler-support';

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
    if (compilerName === 'apple-clang') {
        entry['runs-on'] = 'macos-14';
    } else if (['mingw', 'clang-cl'].includes(compilerName)) {
        entry['runs-on'] = 'windows-2022';
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
                const factor_key = userSuggestion.factor.toLowerCase();
                if (entry[factor_key]) {
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
                const factor_key = userSuggestion.factor.toLowerCase();
                if (entry[factor_key]) {
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
                const factor_key = userSuggestion.factor.toLowerCase();
                if (entry[factor_key]) {
                    const forced_factor = userSuggestion.value;
                    const lc_forced_factor = forced_factor.toLowerCase();
                    entry[lc_forced_factor] = true;
                    return true;
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    const forced_factor = userSuggestion.value;
                    const lc_forced_factor = forced_factor.toLowerCase();
                    entry[lc_forced_factor] = true;
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Sets the container and runs-on configuration for a matrix entry.
 *
 * @param entry - Matrix entry to update
 * @param inputs - Action inputs
 * @param compilerName - Compiler name
 * @param minSubrangeVersion - Minimum version in the subrange
 * @param _subrange - Version subrange string
 */
export function setCompilerContainer(entry: MatrixEntry, inputs: Inputs, compilerName: string, minSubrangeVersion: semver.SemVer, _subrange: string): void {
    // runs-on / container
    if (compilerName === 'gcc') {
        if (semver.satisfies(minSubrangeVersion, '>=15')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:25.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=14')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:24.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=13')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:24.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=9')) {
            entry['runs-on'] = 'ubuntu-22.04';
            if (inputs.use_containers) {
                entry['container'] = 'ubuntu:22.04';
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=7')) {
            if (!inputs.use_containers) {
                entry['runs-on'] = 'ubuntu-20.04';
            } else {
                entry['runs-on'] = 'ubuntu-22.04';
                entry['container'] = 'ubuntu:20.04';
            }
        } else {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:18.04';
        }
    } else if (compilerName === 'clang') {
        if (semver.satisfies(minSubrangeVersion, '>=17')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:24.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=16')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:24.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=15')) {
            entry['runs-on'] = 'ubuntu-22.04';
            if (inputs.use_containers) {
                entry['container'] = 'ubuntu:22.04';
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=12')) {
            // Clang >=12 <15 require a container to isolate
            // incompatible libstdc++ versions
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:22.04';
        } else if (semver.satisfies(minSubrangeVersion, '>=6')) {
            if (!inputs.use_containers) {
                entry['runs-on'] = 'ubuntu-20.04';
            } else {
                entry['runs-on'] = 'ubuntu-22.04';
                entry['container'] = 'ubuntu:20.04';
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=3.9')) {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:18.04';
        } else {
            entry['runs-on'] = 'ubuntu-22.04';
            entry['container'] = 'ubuntu:16.04';
        }
    } else if (compilerName === 'msvc') {
        if (semver.satisfies(minSubrangeVersion, '>=14.42')) {
            entry['runs-on'] = 'windows-2025';
        } else {
            // v142 (14.29) toolset is available on windows-2022 via
            // Microsoft.VisualStudio.ComponentGroup.VC.Tools.142.x86.x64
            entry['runs-on'] = 'windows-2022';
        }
    } else if (compilerName === 'apple-clang') {
        entry['runs-on'] = 'macos-14';
    } else if (['mingw', 'clang-cl'].includes(compilerName)) {
        entry['runs-on'] = 'windows-2022';
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
                    volumes: ['/node20217:/node20217:rw,rshared', '/node20217:/__e/node20:ro,rshared']
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
    if (['mingw', 'gcc'].includes(compilerName)) {
        entry['b2-toolset'] = `gcc`;
    } else if (['clang', 'apple-clang'].includes(compilerName)) {
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
        const generatorFromRunsOn = inferVisualStudioGeneratorFromRunsOn(entry);
        if (generatorFromRunsOn) {
            entry['generator'] = generatorFromRunsOn;
            return;
        }

        const year = getVisualCppYear(minSubrangeVersion);
        if (minSubrangeVersion === maxSubrangeVersion || year === getVisualCppYear(maxSubrangeVersion)) {
            if (year === '2022') {
                entry['generator'] = `Visual Studio 17 ${year}`;
            } else if (year === '2019') {
                entry['generator'] = `Visual Studio 16 ${year}`;
            } else if (year === '2017') {
                entry['generator'] = `Visual Studio 15 ${year}`;
            } else if (year === '2015') {
                entry['generator'] = `Visual Studio 14 ${year}`;
            } else if (year === '2013') {
                entry['generator'] = `Visual Studio 12 ${year}`;
            } else if (year === '2012') {
                entry['generator'] = `Visual Studio 11 ${year}`;
            } else if (year === '2010') {
                entry['generator'] = `Visual Studio 10 ${year}`;
            } else if (year === '2008') {
                entry['generator'] = `Visual Studio 9 ${year}`;
            } else if (year === '2005') {
                entry['generator'] = `Visual Studio 8 ${year}`;
            }
        }
    } else if (compilerName === 'mingw') {
        entry['generator'] = `MinGW Makefiles`;
    } else if (compilerName === 'clang-cl') {
        entry['generator-toolset'] = `ClangCL`;
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
 * @param compiler_cxxs - Array of supported C++ standards
 */
export function setEntryName(entry: MatrixEntry, compilerName: string, subrange: string, compiler_cxxs: string[]): void {
    // Come up with a name for this entry
    let name = `${humanizeCompilerName(compilerName)}`;
    if (subrange !== '*') {
        name += ` ${subrange}`;
    }
    if (compiler_cxxs.length !== 0) {
        if (compiler_cxxs.length > 1) {
            name += `: C++${compiler_cxxs[0]}-${compiler_cxxs[compiler_cxxs.length - 1]}`;
        } else {
            name += `: C++${compiler_cxxs[0]}`;
        }
    }
    entry['name'] = name;
}
