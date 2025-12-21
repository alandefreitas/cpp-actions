/**
 * Factor application functions for cpp-matrix action.
 *
 * @module factors
 */

import * as semver from 'semver';

import { Inputs, MatrixEntry } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

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
    if (compilerName in inputs.latest_factors) {
        // Duplicate latest entry for each latest factor and set properties
        for (const factor of inputs.latest_factors[compilerName]) {
            let latest_copy = { ...matrix[latestIdx] };
            latest_copy['is-main'] = false;
            for (const composite_factor of factor.split('+')) {
                latest_copy[composite_factor.toLowerCase()] = true;
            }
            latest_copy['has-factors'] = true;
            latest_copy['name'] += ` (${factor})`;
            matrix.push(latest_copy);
        }

        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.latest_factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false;
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
                for (const composite_factor of factor.split('+')) {
                    matrix[variantIdx][composite_factor.toLowerCase()] = true;
                }
                matrix[variantIdx]['name'] += ` (${factor})`;
                matrix[variantIdx]['has-factors'] = true;
                variantIdx--;
            } else {
                // If we reached the earliest entry by doing that,
                // we need to duplicate the latest entry to apply new
                // factors
                let latest_copy = { ...matrix[latestIdx] };
                latest_copy['is-main'] = false;
                for (const composite_factor of factor.split('+')) {
                    latest_copy[composite_factor.toLowerCase()] = true;
                }
                latest_copy['name'] += ` (${factor})`;
                latest_copy['has-factors'] = true;
                matrix.push(latest_copy);
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false;
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
    if (compilerName in inputs.combinatorial_factors) {
        // Apply each combinatorial factor to each entry
        for (const factor of inputs.combinatorial_factors[compilerName]) {
            for (let i = earliestIdx; i < latestIdx + 1; i++) {
                let entry_copy = { ...matrix[i] };
                for (const composite_factor of factor.split('+')) {
                    entry_copy[composite_factor.toLowerCase()] = true;
                }
                entry_copy['name'] += ` (${factor})`;
                entry_copy['has-factors'] = true;
                matrix.push(entry_copy);
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.combinatorial_factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false;
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
    let sanitizers: string[] = [];
    let supportsAsan = ['gcc', 'clang', 'msvc'].includes(entry['compiler']);
    if ('asan' in entry && entry['asan'] === true && supportsAsan) {
        sanitizers.push('address');
    }

    // Flags for ubsan
    let supportsSanitizers = ['gcc', 'clang'].includes(entry['compiler']);
    if ('ubsan' in entry && entry['ubsan'] === true && supportsSanitizers) {
        sanitizers.push('undefined');
        // https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html#stack-traces-and-report-symbolization
        entry['env'] = { 'UBSAN_OPTIONS': 'print_stacktrace=1' };
    }

    // Flags for msan
    if ('msan' in entry && entry['msan'] === true && supportsSanitizers) {
        sanitizers.push('memory');
    }

    // Flags for tsan
    if ('tsan' in entry && entry['tsan'] === true && supportsSanitizers) {
        sanitizers.push('thread');
    }

    if (sanitizers.length !== 0) {
        const sanitizers_str = sanitizers.join(',');
        const sanitizer_flags = entry['compiler'] === 'msvc' ?
            ` /fsanitize=${sanitizers_str}` :
            ` -fsanitize=${sanitizers_str} -fno-sanitize-recover=${sanitizers_str} -fno-omit-frame-pointer`;
        entry['cxxflags'] += sanitizer_flags;
        entry['ccflags'] += sanitizer_flags;
        entry['build-type'] = inputs.sanitizer_build_type || 'Release';
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
        entry['build-type'] = inputs.x86_build_type || 'Release';
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
    const arch_prefix = entry['arch'] || 'x64';
    if (['msvc', 'clang-cl'].includes(entry['compiler'])) {
        entry['triplet'] = `${arch_prefix}-windows`;
    } else if (entry['compiler'] === 'mingw') {
        entry['triplet'] = `${arch_prefix}-mingw-static`;
    } else if (entry['compiler'] === 'apple-clang') {
        entry['triplet'] = `${arch_prefix}-osx`;
    } else {
        entry['triplet'] = `${arch_prefix}-linux`;
    }
}
