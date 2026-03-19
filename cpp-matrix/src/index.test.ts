jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    setOutput: jest.fn(),
    summary: {
        addHeading: jest.fn().mockReturnThis(),
        addTable: jest.fn().mockReturnThis(),
        write: jest.fn().mockResolvedValue({})
    }
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

test('generates entries for mingw and clang-cl with data-driven versions', async () => {
    // mingw and clang-cl now have known versions from windows-msvc-defaults.json
    const inputs = makeDefaultMatrixInputs({
        compilers: { 'mingw': '*', 'clang-cl': '*' },
        standards: normalizeCppVersionRequirement('>=14'),
        warnNoMatches: true // Should NOT warn because entries should be generated
    });
    const warnSpy = jest.spyOn(core, 'warning').mockImplementation(() => { });
    try {
        const matrix = await generateMatrix(inputs);

        const mingwEntries = matrix.filter(entry => entry.compiler === 'mingw');
        expect(mingwEntries.length).toBeGreaterThan(0);
        expect(mingwEntries[0]?.cxx).toBe('g++');
        expect(mingwEntries[0]?.cc).toBe('gcc');

        const clangClEntries = matrix.filter(entry => entry.compiler === 'clang-cl');
        expect(clangClEntries.length).toBeGreaterThan(0);
        expect(clangClEntries[0]?.cxx).toBe('clang++-cl');
        expect(clangClEntries[0]?.cc).toBe('clang-cl');

        // No warnings should have been emitted about missing entries
        const warningCalls = warnSpy.mock.calls.map(call => call[0]);
        const missingEntriesWarnings = warningCalls.filter(msg =>
            typeof msg === 'string' && msg.includes('No matrix entries were generated because no published')
        );
        expect(missingEntriesWarnings).toHaveLength(0);
    } finally {
        warnSpy.mockRestore();
    }
});

test('generates entries for apple-clang with data-driven versions', async () => {
    // apple-clang now has known versions from macos-xcode-defaults.json
    const inputs = makeDefaultMatrixInputs({
        compilers: { 'apple-clang': '*' },
        standards: normalizeCppVersionRequirement('>=14'),
        maxStandards: 1
    });
    const matrix = await generateMatrix(inputs);

    // Verify apple-clang entries were generated with version info
    const appleClangEntries = matrix.filter(entry => entry.compiler === 'apple-clang');
    expect(appleClangEntries.length).toBeGreaterThan(0);

    // All entries should have clang/clang++ executables
    for (const entry of appleClangEntries) {
        expect(entry.cxx).toBe('clang++');
        expect(entry.cc).toBe('clang');
        // Should be on a macOS runner
        expect(entry['runs-on']).toMatch(/^macos-/);
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

describe('injectExtraValues via generateMatrix', () => {
    test('extra values are injected using handlebars templates', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            extraValues: [{ key: 'custom-key', value: '{{compiler}}-custom' }]
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc');
        expect(entry).toBeDefined();
        expect(entry?.['custom-key']).toBe('gcc-custom');
    });

    test('extra values warn on existing key conflict', async () => {
        const warnSpy = jest.spyOn(core, 'warning').mockImplementation(() => { });
        try {
            const inputs = makeDefaultMatrixInputs({
                compilers: { gcc: '>=13' },
                standards: normalizeCppVersionRequirement('>=17'),
                maxStandards: 1,
                extraValues: [{ key: 'compiler', value: 'override' }]
            });
            await generateMatrix(inputs);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('compiler'));
        } finally {
            warnSpy.mockRestore();
        }
    });
});

describe('setOS via generateMatrix', () => {
    test('container entries get Linux OS', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            useContainers: true
        });
        const matrix = await generateMatrix(inputs);
        const containerEntry = matrix.find(e => e.container);
        if (containerEntry) {
            expect(containerEntry.os).toBe('Linux');
        }
    });

    test('windows runner gets Windows OS', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { msvc: '>=14.3' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1
        });
        const matrix = await generateMatrix(inputs);
        const msvcEntry = matrix.find(e => e.compiler === 'msvc');
        expect(msvcEntry?.os).toBe('Windows');
    });

    test('macos runner gets macOS OS', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { 'apple-clang': '*' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1
        });
        const matrix = await generateMatrix(inputs);
        const acEntry = matrix.find(e => e.compiler === 'apple-clang');
        expect(acEntry?.os).toBe('macOS');
    });

    test('unknown runner defaults to Linux OS', async () => {
        const compilerVersions = { gcc: '>=13' };
        const inputs = makeDefaultMatrixInputs({
            compilers: compilerVersions,
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            runsOn: parseCompilerSuggestions(['gcc: custom-runner'], Object.keys(compilerVersions))
        });
        const matrix = await generateMatrix(inputs);
        const entry = matrix.find(e => e.compiler === 'gcc');
        expect(entry?.os).toBe('Linux');
    });
});

describe('CppMatrixRunner features', () => {
    test('logMatrix outputs individual entries when enabled', async () => {
        const infoSpy = jest.spyOn(core, 'info').mockImplementation(() => { });
        try {
            const inputs = makeDefaultMatrixInputs({
                compilers: { gcc: '>=13' },
                standards: normalizeCppVersionRequirement('>=17'),
                maxStandards: 1,
                logMatrix: true
            });
            const matrix = await generateMatrix(inputs);
            expect(matrix.length).toBeGreaterThan(0);
            const infoCalls = infoSpy.mock.calls.map(c => c[0]);
            expect(infoCalls.some(msg => typeof msg === 'string' && msg.startsWith('- {'))).toBe(true);
        } finally {
            infoSpy.mockRestore();
        }
    });

    test('generateSummary produces summary table', async () => {
        // The mock already sets up core.summary with addHeading/addTable/write chain
        const mockSummary = jest.mocked(core.summary);
        const addHeadingSpy = mockSummary.addHeading as jest.Mock;
        addHeadingSpy.mockClear();
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            generateSummary: true
        });
        const matrix = await generateMatrix(inputs);
        expect(matrix.length).toBeGreaterThan(0);
        expect(addHeadingSpy).toHaveBeenCalled();
    });

    test('outputFile writes matrix to file', async () => {
        const fs = await import('fs');
        const os = await import('os');
        const tmpFile = path.join(os.tmpdir(), 'cpp-matrix-test-output.json');
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            outputFile: tmpFile
        });
        const matrix = await generateMatrix(inputs);
        expect(matrix.length).toBeGreaterThan(0);
        expect(fs.existsSync(tmpFile)).toBe(true);
        const content = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
        expect(content.length).toBe(matrix.length);
        fs.unlinkSync(tmpFile);
    });

    test('sortByFailureRate fetches rates when enabled', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            sortByFailureRate: true,
            failureRateRuns: 5,
            githubToken: ''
        });
        // This will attempt to fetch failure rates (and likely fail gracefully)
        const matrix = await generateMatrix(inputs);
        expect(matrix.length).toBeGreaterThan(0);
    });

    test('combinatorial factors duplicate entries', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=13' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            combinatorialFactors: { gcc: ['Shared'] }
        });
        const matrix = await generateMatrix(inputs);
        const sharedEntries = matrix.filter(e => e.compiler === 'gcc' && e.shared === true);
        const nonSharedEntries = matrix.filter(e => e.compiler === 'gcc' && e.shared === false);
        expect(sharedEntries.length).toBeGreaterThan(0);
        expect(nonSharedEntries.length).toBeGreaterThan(0);
    });

    test('variant factors apply to intermediary entries', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=10' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            factors: { gcc: ['Shared'] }
        });
        const matrix = await generateMatrix(inputs);
        const sharedEntries = matrix.filter(e => e.compiler === 'gcc' && e.shared === true);
        expect(sharedEntries.length).toBeGreaterThan(0);
    });

    test('variant factors work with many factors', async () => {
        const inputs = makeDefaultMatrixInputs({
            compilers: { gcc: '>=10' },
            standards: normalizeCppVersionRequirement('>=17'),
            maxStandards: 1,
            factors: { gcc: ['Shared', 'x86', 'Coverage'] }
        });
        const matrix = await generateMatrix(inputs);
        expect(matrix.length).toBeGreaterThan(3);
        const factorEntries = matrix.filter(e => e.compiler === 'gcc' && e['has-factors'] === true);
        expect(factorEntries.length).toBeGreaterThan(0);
    });
});
