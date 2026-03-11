/**
 * Factor application functions for cpp-matrix action.
 *
 * @module factors
 */

import * as semver from 'semver';

import { type MatrixEntry } from './types';
import { type Inputs } from './schema';

import * as setup_program from 'setup-program';

/**
 * Applies latest factors to the matrix by duplicating latest entry.
 *
 * @param matrix - Matrix array to update
 * @param inputs - Action inputs
 * @param latestIdx - Index of the latest entry
 * @param _earliestIdx - Index of the earliest entry (unused)
 * @param compilerName - Compiler name
 */
export function applyLatestFactors(matrix: MatrixEntry[], inputs: Inputs, latestIdx: number, _earliestIdx: number, compilerName: string): void {
    // Apply latest factors for this compiler.
    // We duplicate the latest entry for each latest factor and set the
    // property to true for each duplicated entry.
    if (compilerName in inputs.latestFactors) {
        // Duplicate latest entry for each latest factor and set properties
        for (const factor of inputs.latestFactors[compilerName]) {
            const latestCopy = { ...matrix[latestIdx] };
            latestCopy['is-main'] = false;
            for (const compositeFactor of factor.split('+')) {
                latestCopy[compositeFactor.toLowerCase()] = true;
            }
            latestCopy['has-factors'] = true;
            latestCopy['name'] += ` (${factor})`;
            matrix.push(latestCopy);
        }

        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.latestFactors[compilerName]) {
                for (const compositeFactor of factor.split('+')) {
                    if (!(compositeFactor.toLowerCase() in matrix[i])) {
                        matrix[i][compositeFactor.toLowerCase()] = false;
                    }
                }
            }
        }
    }
}

/**
 * Applies variant factors to intermediary matrix entries.
 *
 * @param matrix - Matrix array to update
 * @param inputs - Action inputs
 * @param latestIdx - Index of the latest entry
 * @param earliestIdx - Index of the earliest entry
 * @param compilerName - Compiler name
 */
export function applyVariantFactors(matrix: MatrixEntry[], inputs: Inputs, latestIdx: number, earliestIdx: number, compilerName: string): void {
    // Apply variant factors for this compiler
    // We skip the latest entry and apply the variant factors to the
    // intermediary entries.
    let variantIdx = latestIdx;
    if (variantIdx !== earliestIdx) {
        variantIdx--;
    }
    if (compilerName in inputs.factors) {
        // Apply each variant factor to the intermediary entries
        for (const factor of inputs.factors[compilerName]) {
            if (variantIdx !== earliestIdx) {
                for (const compositeFactor of factor.split('+')) {
                    matrix[variantIdx][compositeFactor.toLowerCase()] = true;
                }
                matrix[variantIdx]['name'] += ` (${factor})`;
                matrix[variantIdx]['has-factors'] = true;
                variantIdx--;
            } else {
                // If we reached the earliest entry by doing that,
                // we need to duplicate the latest entry to apply new
                // factors
                const latestCopy = { ...matrix[latestIdx] };
                latestCopy['is-main'] = false;
                for (const compositeFactor of factor.split('+')) {
                    latestCopy[compositeFactor.toLowerCase()] = true;
                }
                latestCopy['name'] += ` (${factor})`;
                latestCopy['has-factors'] = true;
                matrix.push(latestCopy);
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.factors[compilerName]) {
                for (const compositeFactor of factor.split('+')) {
                    if (!(compositeFactor.toLowerCase() in matrix[i])) {
                        matrix[i][compositeFactor.toLowerCase()] = false;
                    }
                }
            }
        }
    }
}

/**
 * Applies combinatorial factors by duplicating entries with all combinations.
 *
 * @param matrix - Matrix array to update
 * @param inputs - Action inputs
 * @param latestIdx - Index of the latest entry
 * @param earliestIdx - Index of the earliest entry
 * @param compilerName - Compiler name
 */
export function applyCombinatorialFactors(matrix: MatrixEntry[], inputs: Inputs, latestIdx: number, earliestIdx: number, compilerName: string): void {
    // Apply combinatorial factors for this compiler
    // For each entry, we create a copy that set that factor to true
    // Here we go:
    if (compilerName in inputs.combinatorialFactors) {
        // Apply each combinatorial factor to each entry
        for (const factor of inputs.combinatorialFactors[compilerName]) {
            for (let i = earliestIdx; i < latestIdx + 1; i++) {
                const entryCopy = { ...matrix[i] };
                for (const compositeFactor of factor.split('+')) {
                    entryCopy[compositeFactor.toLowerCase()] = true;
                }
                entryCopy['name'] += ` (${factor})`;
                entryCopy['has-factors'] = true;
                matrix.push(entryCopy);
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.combinatorialFactors[compilerName]) {
                for (const compositeFactor of factor.split('+')) {
                    if (!(compositeFactor.toLowerCase() in matrix[i])) {
                        matrix[i][compositeFactor.toLowerCase()] = false;
                    }
                }
            }
        }
    }
}

/**
 * Sets recommended compiler flags for factors like sanitizers and coverage.
 *
 * @param entry - Matrix entry to update
 * @param inputs - Action inputs
 */
export async function setRecommendedFlags(entry: MatrixEntry, inputs: Inputs): Promise<void> {
    entry['build-type'] = 'Release';
    entry['cxxflags'] = '';
    entry['ccflags'] = '';
    entry['install'] = '';
    const wantsX86 = entry['x86'] === true;
    const entryArch = typeof entry['arch'] === 'string' && entry['arch'].trim() !== '' ? entry['arch'].trim() : null;
    const normalizedArch = entryArch ? entryArch.toLowerCase() : (wantsX86 ? 'x86' : 'x64');
    entry['arch'] = normalizedArch;

    // Flags for asan
    const sanitizers: string[] = [];
    const supportsAsan = ['gcc', 'clang', 'msvc'].includes(entry['compiler']);
    if ('asan' in entry && entry['asan'] === true && supportsAsan) {
        sanitizers.push('address');
    }

    // Flags for ubsan
    const supportsSanitizers = ['gcc', 'clang'].includes(entry['compiler']);
    let needsUbsanOptions = false;
    if ('ubsan' in entry && entry['ubsan'] === true && supportsSanitizers) {
        sanitizers.push('undefined');
        needsUbsanOptions = true;
    }

    // Flags for msan
    if ('msan' in entry && entry['msan'] === true && supportsSanitizers) {
        sanitizers.push('memory');
    }

    // Flags for tsan
    if ('tsan' in entry && entry['tsan'] === true && supportsSanitizers) {
        sanitizers.push('thread');
    }

    // Flags for intsan (integer sanitizer)
    // Clang supports -fsanitize=integer as a group; GCC only supports
    // the individual checks that overlap with that group.
    if ('intsan' in entry && entry['intsan'] === true && supportsSanitizers) {
        if (entry['compiler'] === 'clang') {
            sanitizers.push('integer');
        } else {
            sanitizers.push('signed-integer-overflow', 'integer-divide-by-zero', 'shift');
        }
        needsUbsanOptions = true;
    }

    // Flags for boundsan (bounds sanitizer)
    // Both Clang and GCC support -fsanitize=bounds.
    if ('boundsan' in entry && entry['boundsan'] === true && supportsSanitizers) {
        sanitizers.push('bounds');
        needsUbsanOptions = true;
    }

    // Flags for lsan (leak sanitizer)
    // GCC does not support -fno-sanitize-recover=leak, so leak is added
    // separately outside the sanitizers array for GCC.
    let lsanExtraFlags = '';
    if ('lsan' in entry && entry['lsan'] === true && supportsSanitizers) {
        if (entry['compiler'] === 'clang') {
            sanitizers.push('leak');
        } else {
            lsanExtraFlags = ' -fsanitize=leak';
        }
        entry['env'] = {
            ...entry['env'],
            'LSAN_OPTIONS': 'detect_leaks=1:print_suppressions=0:report_objects=1:exitcode=1'
        };
    }

    // Flags for cfi (control flow integrity) — Clang only, requires full
    // LTO and visibility flags for virtual call / cast checks to work.
    // Full LTO (-flto) is used instead of thin LTO (-flto=thin) because
    // thin LTO produces relocations incompatible with PIE on some versions.
    // -fno-sanitize-trap=cfi is needed to get diagnostic output instead
    // of silent traps.
    let cfiExtraFlags = '';
    if ('cfi' in entry && entry['cfi'] === true && entry['compiler'] === 'clang') {
        sanitizers.push('cfi');
        cfiExtraFlags = ' -flto -fvisibility=hidden -fno-sanitize-trap=cfi';
        needsUbsanOptions = true;
    }

    // Set UBSAN_OPTIONS for any UBSan-family sanitizer (ubsan, intsan,
    // boundsan, cfi in diagnostic mode)
    // https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html#stack-traces-and-report-symbolization
    if (needsUbsanOptions) {
        entry['env'] = { ...entry['env'], 'UBSAN_OPTIONS': 'print_stacktrace=1' };
    }

    if (sanitizers.length !== 0 || lsanExtraFlags !== '') {
        const hasSanitizers = sanitizers.length !== 0;
        let sanitizerFlags = '';
        if (hasSanitizers) {
            const sanitizersStr = sanitizers.join(',');
            sanitizerFlags = entry['compiler'] === 'msvc' ?
                ` /fsanitize=${sanitizersStr}` :
                ` -fsanitize=${sanitizersStr} -fno-sanitize-recover=${sanitizersStr} -fno-omit-frame-pointer`;
        }
        entry['cxxflags'] += sanitizerFlags + lsanExtraFlags + cfiExtraFlags;
        entry['ccflags'] += sanitizerFlags + lsanExtraFlags + cfiExtraFlags;
        entry['build-type'] = inputs.sanitizerBuildType || 'Release';
    }

    // Flags for coverage
    if ('coverage' in entry && entry['coverage'] === true) {
        if (entry['compiler'] === 'gcc') {
            entry['cxxflags'] += ' --coverage -fprofile-arcs -ftest-coverage';
            entry['ccflags'] += ' --coverage -fprofile-arcs -ftest-coverage';
            entry['install'] += ' lcov';
        } else if (entry['compiler'] === 'clang') {
            entry['cxxflags'] += ' -fprofile-instr-generate -fcoverage-mapping';
            entry['ccflags'] += ' -fprofile-instr-generate -fcoverage-mapping';
        }
        entry['build-type'] = 'Debug';
    }

    // Flags for x86
    if (wantsX86) {
        if (entry['compiler'] === 'clang') {
            entry['cxxflags'] += ' -m32';
            entry['ccflags'] += ' -m32';
        }
        entry['build-type'] = inputs.x86BuildType || 'Release';
    }

    // Flags for time-trace
    if ('time-trace' in entry && entry['time-trace'] === true) {
        if (entry['compiler'] === 'clang') {
            const v = semver.minSatisfying(await setup_program.findClangVersions(), entry['version']);
            if (v && semver.satisfies(v, '>=9')) {
                entry['cxxflags'] += ' -ftime-trace';
                entry['ccflags'] += ' -ftime-trace';
                entry['install'] += ' wget unzip';
            }
        }
        if (entry['cxxstd'] !== '') {
            entry['cxxstd'] = entry['latest-cxxstd'] || '';
            entry['name'] = entry['name'].replace(/C\+\+\d+-\d+/g, `C++${entry['latest-cxxstd']}`);
        }
    }

    // Install build-essential for Ubuntu containers
    if ('container' in entry) {
        // Check if it's a string
        if (typeof entry['container'] === 'string') {
            if (entry['container'].startsWith('ubuntu')) {
                entry['install'] += ' build-essential pkg-config git curl';
            }
        }
        // Check if it's an object with the "image" key
        if (typeof entry['container'] === 'object' && entry['container'] !== null && 'image' in entry['container']) {
            if (entry['container']['image'].startsWith('ubuntu')) {
                entry['install'] += ' build-essential pkg-config git curl';
            }
        }
    }

    // Trim flags
    entry['install'] = entry['install'].trim();
    entry['cxxflags'] = entry['cxxflags'].trim();
    entry['ccflags'] = entry['ccflags'].trim();

    // Include vcpkg triplet recommendations (vcpkg help triplet)
    const archPrefix = entry['arch'] || 'x64';
    if (['msvc', 'clang-cl'].includes(entry['compiler'])) {
        entry['triplet'] = `${archPrefix}-windows`;
    } else if (entry['compiler'] === 'mingw') {
        entry['triplet'] = `${archPrefix}-mingw-static`;
    } else if (entry['compiler'] === 'apple-clang') {
        entry['triplet'] = `${archPrefix}-osx`;
    } else {
        entry['triplet'] = `${archPrefix}-linux`;
    }
}
