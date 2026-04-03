/**
 * Factor application functions for cpp-matrix action.
 *
 * @module factors
 */

import * as semver from 'semver';
import * as core from '@actions/core';

import { type MatrixEntry } from './types';
import { type Inputs } from './schema';

import * as setup_program from 'setup-program';

/**
 * Returns a collision-resistant LLVM_PROFILE_FILE pattern appropriate
 * for the given Clang major version.
 *
 * Without LLVM_PROFILE_FILE, all instrumented binaries write to
 * default.profraw, silently corrupting each other's data when multiple
 * test executables run. Rust fixed the same issue by defaulting to
 * %m_%p in rustc 1.65 (rust-lang/rust#100381).
 *
 * LLVM_PROFILE_FILE token reference by minimum Clang version:
 *   %p  (3.9)  — process ID
 *   %h  (3.9)  — hostname
 *   %m  (3.9)  — binary signature / merge pool
 *   %c  (10)   — continuous mode (Darwin-only in production)
 *   %t  (12)   — TMPDIR (silently falls back to default.profraw if unset)
 *   %b  (21)   — binary/build ID (resolves %m signature collision LLVM #52218)
 *
 * NOTE: Duplicated in cmake-workflow/src/process-entry.ts for use as a
 * standalone fallback. Keep both copies in sync.
 *
 * @param clangMajor - Clang major version, or undefined if unknown
 * @returns The LLVM_PROFILE_FILE pattern string
 */
export function llvmProfileFilePattern(clangMajor: number | undefined): string {
    if (clangMajor !== undefined && clangMajor >= 21) {
        // Clang 21+ supports %b (binary/build ID) which provides
        // stronger binary separation than %m alone, resolving the
        // known %m signature collision (LLVM #52218).
        return 'default-%b-%p-%m.profraw';
    }
    // Clang 9-20 (or unknown version): %p (PID) + %m (binary
    // signature / merge pool). Both available since Clang 3.9
    // and portable across Linux, macOS, and Windows.
    return 'default-%p-%m.profraw';
}

/**
 * Ensures every matrix entry has each factor key set, defaulting to `false`
 * for entries that don't already have the factor set to `true`.
 *
 * Called at the end of each factor-application function to guarantee that
 * downstream code (e.g. Handlebars templates, recommended-flag logic) can
 * always check `entry[factor]` without worrying about missing keys.
 *
 * @param matrix - Matrix array to update
 * @param factors - Factor strings (may contain composite `'A+B'` notation)
 */
function ensureFactorDefaults(matrix: MatrixEntry[], factors: string[]): void {
    for (const entry of matrix) {
        for (const factor of factors) {
            for (const part of factor.split('+')) {
                const key = part.toLowerCase();
                if (!(key in entry)) {
                    entry[key] = false;
                }
            }
        }
    }
}

/**
 * Applies main-entry factors to the matrix.
 *
 * The first factor listed for a compiler modifies the main entry in-place,
 * so it retains `is-main = true`. Any additional factors overflow to
 * latest-factors behavior — they create copies of the main entry with
 * `is-main = false`, just as {@link applyLatestFactors} would.
 *
 * Must be called AFTER {@link applyLatestFactors} so that latest-factor
 * copies are based on the clean (unmodified) main entry.
 *
 * @param matrix - Matrix array to update
 * @param inputs - Action inputs
 * @param latestIdx - Index of the latest (main) entry
 * @param compilerName - Compiler name
 */
export function applyMainEntryFactors(matrix: MatrixEntry[], inputs: Inputs, latestIdx: number, compilerName: string): void {
    if (!(compilerName in inputs.mainEntryFactors)) {
        return;
    }

    const factors = inputs.mainEntryFactors[compilerName];

    // First factor: apply directly to the main entry (keeps is-main = true)
    const [firstFactor, ...overflowFactors] = factors;
    for (const compositeFactor of firstFactor.split('+')) {
        matrix[latestIdx][compositeFactor.toLowerCase()] = true;
    }
    matrix[latestIdx]['has-factors'] = true;
    matrix[latestIdx]['name'] += ` (${firstFactor})`;

    // Remaining factors: overflow to latest-factors behavior (copies with is-main = false)
    for (const factor of overflowFactors) {
        core.info(
            `main-entry-factors: '${factor}' overflows to latest-factors behavior ` +
            `for ${compilerName} — only the first factor modifies the main entry`
        );
        const latestCopy = { ...matrix[latestIdx] };
        latestCopy['is-main'] = false;
        // Reset the first factor's properties on the copy so it only has its own factor
        for (const compositeFactor of firstFactor.split('+')) {
            latestCopy[compositeFactor.toLowerCase()] = false;
        }
        // Remove the first factor's name suffix and add this factor's
        latestCopy['name'] = latestCopy['name'].replace(` (${firstFactor})`, '');
        for (const compositeFactor of factor.split('+')) {
            latestCopy[compositeFactor.toLowerCase()] = true;
        }
        latestCopy['name'] += ` (${factor})`;
        matrix.push(latestCopy);
    }

    ensureFactorDefaults(matrix, factors);
}

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

        ensureFactorDefaults(matrix, inputs.latestFactors[compilerName]);
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
        ensureFactorDefaults(matrix, inputs.factors[compilerName]);
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
        ensureFactorDefaults(matrix, inputs.combinatorialFactors[compilerName]);
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
    const isMacOSCompiler = ['apple-clang', 'macos-gcc', 'macos-clang'].includes(entry['compiler']);
    const defaultArch = wantsX86 ? 'x86' : (isMacOSCompiler ? 'arm64' : 'x64');
    const normalizedArch = entryArch ? entryArch.toLowerCase() : defaultArch;
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
    let msanExtraFlags = '';
    if ('msan' in entry && entry['msan'] === true && supportsSanitizers) {
        sanitizers.push('memory');
        msanExtraFlags = ' -fsanitize-memory-track-origins';
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
        entry['cxxflags'] += sanitizerFlags + msanExtraFlags + lsanExtraFlags + cfiExtraFlags;
        entry['ccflags'] += sanitizerFlags + msanExtraFlags + lsanExtraFlags + cfiExtraFlags;
        entry['ldflags'] = (entry['ldflags'] || '') + sanitizerFlags + lsanExtraFlags + cfiExtraFlags;
        entry['build-type'] = inputs.sanitizerBuildType || 'Release';
    }

    // Flags for coverage
    if ('coverage' in entry && entry['coverage'] === true) {
        if (entry['compiler'] === 'gcc') {
            entry['cxxflags'] += ' --coverage -fprofile-arcs -ftest-coverage';
            entry['ccflags'] += ' --coverage -fprofile-arcs -ftest-coverage';
            entry['ldflags'] = (entry['ldflags'] || '') + ' --coverage';
            entry['install'] += ' lcov';
        } else if (entry['compiler'] === 'clang') {
            entry['cxxflags'] += ' -fprofile-instr-generate -fcoverage-mapping';
            entry['ccflags'] += ' -fprofile-instr-generate -fcoverage-mapping';
            entry['ldflags'] = (entry['ldflags'] || '') + ' -fprofile-instr-generate';
            const clangVersion = semver.coerce(entry['version']);
            const clangMajor = clangVersion ? clangVersion.major : '';
            if (clangMajor) {
                entry['install'] += ` llvm-${clangMajor}-tools elfutils`;
            }

            // Set LLVM_PROFILE_FILE to avoid profraw collisions.
            // See llvmProfileFilePattern() for token reference.
            entry['env'] = {
                ...entry['env'],
                'LLVM_PROFILE_FILE': llvmProfileFilePattern(
                    typeof clangMajor === 'number' ? clangMajor : undefined
                )
            };
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
    } else if (['apple-clang', 'macos-gcc', 'macos-clang'].includes(entry['compiler'])) {
        entry['triplet'] = `${archPrefix}-osx`;
    } else {
        entry['triplet'] = `${archPrefix}-linux`;
    }
}
