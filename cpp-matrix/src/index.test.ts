jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as path from 'path';
import * as process from 'process';

const cacheDir = path.join(__dirname, '..', 'test-data', 'cache');
process.env.CPP_MATRIX_CACHE_DIR = cacheDir;

import * as setup_program from 'setup-program';
setup_program.setVersionsCacheDir(cacheDir);

import {
    generateMatrix,
    generateTable,
    parseCompilerSuggestions,
    normalizeCppVersionRequirement
} from './index';
import type { Inputs } from './schema';
import * as core from '@actions/core';
import { describePrettyErrors } from 'pretty-errors/test-helper';

/**
 * Creates a matrix inputs object with sensible defaults, overriding only specified fields.
 *
 * @param overrides - Fields to override in the default inputs
 * @returns Complete matrix inputs object
 */
function makeDefaultMatrixInputs(overrides: Partial<Inputs> = {}): Inputs {
    return ({
        compilers: {},
        standards: '',
        subrangePolicy: { '': 'one-per-major' },
        maxStandards: 2,
        latestFactors: {},
        factors: {},
        combinatorialFactors: {},
        forceFactors: [],
        extraValues: [],
        runsOn: [],
        containers: [],
        generators: [],
        generatorToolsets: [],
        b2Toolsets: [],
        ccflags: [],
        cxxflags: [],
        install: [],
        appendCcflags: [],
        appendCxxflags: [],
        appendInstall: [],
        triplets: [],
        buildTypes: [],
        defaultBuildType: 'Release',
        sanitizerBuildType: 'Release',
        x86BuildType: 'Release',
        useContainers: false,
        warnNoMatches: false,
        outputFile: undefined,
        logMatrix: false,
        generateSummary: false,
        traceCommands: false,
        sortByFailureRate: false,
        failureRateRuns: 20,
        githubToken: '',
        ...overrides
    }) as Inputs;
}

describePrettyErrors('matrix boom', 'CPP matrix failed');

describe('generateMatrix', () => {
    test('should generate matrix correctly', async () => {
        const compilerVersions = {
            gcc: '>=4.8.0',
            clang: '>=3.8.0',
            msvc: '>=14.2.0',
            'apple-clang': '*'
        };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=11'),
            latestFactors: { gcc: ['Coverage', 'TSan', 'UBSan'] },
            factors: { gcc: ['Asan', 'Shared'], msvc: ['Shared', 'x86'] },
            cxxflags: parseCompilerSuggestions(['gcc >=10 <12: -static'], Object.keys(compilerVersions))
        });
        const matrix = await generateMatrix(inputs);
        expect(matrix.length === 0).toBe(false);
        const table = await generateTable(matrix, inputs);
        expect(table.length === 0).toBe(false);
    });

    test('warns when compiler has no compatible entries', async () => {
        const warnSpy = jest.spyOn(core, 'warning').mockImplementation(() => { });
        const inputs = makeDefaultMatrixInputs({
            compilers: { msvc: '>=14.0.0' },
            standards: normalizeCppVersionRequirement('>=26'),
            warnNoMatches: true
        });
        try {
            await generateMatrix(inputs);
            expect(warnSpy).toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });
});

test('msvc x86 entries prefer arch metadata over /m32 flags', async () => {
    const inputs = makeDefaultMatrixInputs({
        compilers: { msvc: '>=14.0.0' },
        standards: normalizeCppVersionRequirement('>=11'),
        maxStandards: 1,
        factors: { msvc: ['x86'] }
    });
    const matrix = await generateMatrix(inputs);
    const msvcX86Entry = matrix.find(entry => entry.compiler === 'msvc' && entry.x86 === true);
    expect(msvcX86Entry).toBeDefined();
    expect(msvcX86Entry?.cxxflags).not.toMatch(/\/m32/);
    expect(msvcX86Entry?.ccflags).not.toMatch(/\/m32/);
    expect(msvcX86Entry?.arch).toBe('x86');
});

test('non-x86 entries default arch to x64 unless overridden', async () => {
    const inputs = makeDefaultMatrixInputs({
        compilers: { gcc: '>=10' },
        standards: normalizeCppVersionRequirement('>=17'),
        maxStandards: 1
    });
    const matrix = await generateMatrix(inputs);
    const gccEntry = matrix.find(entry => entry.compiler === 'gcc');
    expect(gccEntry?.arch).toBe('x64');
});

test('generates entries for compilers with no known versions', async () => {
    // This test verifies that apple-clang, mingw, and clang-cl (which have no
    // version tracking) still generate matrix entries with version "*"
    const inputs = makeDefaultMatrixInputs({
        compilers: { 'apple-clang': '*', 'mingw': '*', 'clang-cl': '*' },
        standards: normalizeCppVersionRequirement('>=14'),
        warnNoMatches: true // Should NOT warn because entries should be generated
    });
    const warnSpy = jest.spyOn(core, 'warning').mockImplementation(() => { });
    try {
        const matrix = await generateMatrix(inputs);

        // Verify entries were generated for each compiler
        const appleClangEntry = matrix.find(entry => entry.compiler === 'apple-clang');
        expect(appleClangEntry).toBeDefined();
        expect(appleClangEntry?.version).toBe('*');
        expect(appleClangEntry?.cxx).toBe('clang++');
        expect(appleClangEntry?.cc).toBe('clang');
        expect(appleClangEntry?.['runs-on']).toBe('macos-14');

        const mingwEntry = matrix.find(entry => entry.compiler === 'mingw');
        expect(mingwEntry).toBeDefined();
        expect(mingwEntry?.version).toBe('*');
        expect(mingwEntry?.cxx).toBe('g++');
        expect(mingwEntry?.cc).toBe('gcc');
        expect(mingwEntry?.['runs-on']).toBe('windows-2022');

        const clangClEntry = matrix.find(entry => entry.compiler === 'clang-cl');
        expect(clangClEntry).toBeDefined();
        expect(clangClEntry?.version).toBe('*');
        expect(clangClEntry?.cxx).toBe('clang++-cl');
        expect(clangClEntry?.cc).toBe('clang-cl');
        expect(clangClEntry?.['runs-on']).toBe('windows-2022');

        // No warnings should have been emitted about missing entries
        // (warnings about no known versions should not appear)
        const warningCalls = warnSpy.mock.calls.map(call => call[0]);
        const missingEntriesWarnings = warningCalls.filter(msg =>
            typeof msg === 'string' && msg.includes('No matrix entries were generated because no published')
        );
        expect(missingEntriesWarnings).toHaveLength(0);
    } finally {
        warnSpy.mockRestore();
    }
});

describe('setRecommendedFlags sanitizer factors', () => {
    test('asan on gcc produces -fsanitize=address', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=address');
        expect(entry?.cxxflags).toContain('-fno-sanitize-recover=address');
        expect(entry?.cxxflags).toContain('-fno-omit-frame-pointer');
        expect(entry?.ccflags).toContain('-fsanitize=address');
    });

    test('asan on msvc produces /fsanitize=address', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { msvc: '>=14' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { msvc: ['Asan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'msvc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('/fsanitize=address');
    });

    test('ubsan on gcc produces -fsanitize=undefined and UBSAN_OPTIONS', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['UBSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.ubsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=undefined');
        expect(entry?.env).toHaveProperty('UBSAN_OPTIONS', 'print_stacktrace=1');
    });

    test('tsan on clang produces -fsanitize=thread', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['TSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.tsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=thread');
    });

    test('msan on clang produces -fsanitize=memory', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['MSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.msan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=memory');
    });

    test('intsan on clang produces -fsanitize=integer', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['IntSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.intsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=integer');
        expect(entry?.cxxflags).toContain('-fno-sanitize-recover=integer');
        expect(entry?.env).toHaveProperty('UBSAN_OPTIONS', 'print_stacktrace=1');
    });

    test('intsan on gcc produces individual integer checks', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['IntSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.intsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('signed-integer-overflow');
        expect(entry?.cxxflags).toContain('integer-divide-by-zero');
        expect(entry?.cxxflags).toContain('shift');
        expect(entry?.cxxflags).not.toContain('-fsanitize=integer');
        expect(entry?.env).toHaveProperty('UBSAN_OPTIONS', 'print_stacktrace=1');
    });

    test('boundsan on clang produces -fsanitize=bounds', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['BoundSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.boundsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=bounds');
        expect(entry?.env).toHaveProperty('UBSAN_OPTIONS', 'print_stacktrace=1');
    });

    test('boundsan on gcc produces -fsanitize=bounds', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['BoundSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.boundsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=bounds');
    });

    test('lsan on clang produces -fsanitize=leak with LSAN_OPTIONS', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['LSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.lsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=leak');
        expect(entry?.cxxflags).toContain('-fno-sanitize-recover=leak');
        expect(entry?.env).toHaveProperty('LSAN_OPTIONS');
    });

    test('lsan on gcc produces -fsanitize=leak without -fno-sanitize-recover=leak', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['LSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.lsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=leak');
        expect(entry?.cxxflags).not.toContain('-fno-sanitize-recover=leak');
        expect(entry?.env).toHaveProperty('LSAN_OPTIONS');
    });

    test('cfi on clang produces -fsanitize=cfi with LTO and visibility flags', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['CFI'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.cfi === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=cfi');
        expect(entry?.cxxflags).toContain('-flto');
        expect(entry?.cxxflags).toContain('-fvisibility=hidden');
        expect(entry?.cxxflags).toContain('-fno-sanitize-trap=cfi');
        expect(entry?.env).toHaveProperty('UBSAN_OPTIONS', 'print_stacktrace=1');
    });

    test('composite factor ASan+UBSan produces combined flags', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { clang: '>=16' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { clang: ['ASan+UBSan'] }
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'clang' && e.asan === true && e.ubsan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('address');
        expect(entry?.cxxflags).toContain('undefined');
    });

    test('sanitizer entries use sanitizerBuildType', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] },
            sanitizerBuildType: 'RelWithDebInfo'
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.['build-type']).toBe('RelWithDebInfo');
    });

    test('non-sanitizer entries have false for sanitizer factor booleans', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] }
        });
        const matrix = await generateMatrix(inputs);
        const nonAsanEntries = matrix.filter(e => e.compiler === 'gcc' && e.asan !== true);
        expect(nonAsanEntries.length).toBeGreaterThan(0);
        for (const entry of nonAsanEntries) {
            expect(entry.asan).toBe(false);
        }
    });
});

describe('append suggestions', () => {
    test('append-install adds packages without replacing generated values', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Coverage'] },
            appendInstall: parseCompilerSuggestions(
                ['gcc Coverage: extra-pkg'],
                Object.keys(compilerVersions)
            )
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.coverage === true);
        expect(entry).toBeDefined();
        expect(entry?.install).toContain('lcov');
        expect(entry?.install).toContain('extra-pkg');
    });

    test('append-cxxflags adds flags without replacing sanitizer flags', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] },
            appendCxxflags: parseCompilerSuggestions(
                ['gcc Asan: -Wextra'],
                Object.keys(compilerVersions)
            )
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.cxxflags).toContain('-fsanitize=address');
        expect(entry?.cxxflags).toContain('-Wextra');
    });

    test('append-ccflags adds flags without replacing sanitizer flags', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] },
            appendCcflags: parseCompilerSuggestions(
                ['gcc Asan: -Wextra'],
                Object.keys(compilerVersions)
            )
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.ccflags).toContain('-fsanitize=address');
        expect(entry?.ccflags).toContain('-Wextra');
    });

    test('multiple append rules stack on the same entry', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] },
            appendInstall: parseCompilerSuggestions(
                ['gcc Asan: pkg-a', 'gcc >=13: pkg-b'],
                Object.keys(compilerVersions)
            )
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.install).toContain('pkg-a');
        expect(entry?.install).toContain('pkg-b');
    });

    test('replace install followed by append works correctly', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            latestFactors: { gcc: ['Asan'] },
            install: parseCompilerSuggestions(
                ['gcc Asan: replaced-pkg'],
                Object.keys(compilerVersions)
            ),
            appendInstall: parseCompilerSuggestions(
                ['gcc Asan: appended-pkg'],
                Object.keys(compilerVersions)
            )
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc' && e.asan === true);
        expect(entry).toBeDefined();
        expect(entry?.install).toContain('replaced-pkg');
        expect(entry?.install).toContain('appended-pkg');
        expect(entry?.install).not.toContain('lcov');
    });
});
