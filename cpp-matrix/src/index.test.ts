import * as path from 'path';
import * as process from 'process';

const cacheDir = path.join(__dirname, '..', 'test-data', 'cache');
process.env.CPP_MATRIX_CACHE_DIR = cacheDir;

import * as setup_program from 'setup-program';
setup_program.setVersionsCacheDir(cacheDir);

import {
    generateMatrix,
    generateTable,
    parseCompilerRequirements,
    parseCompilerSuggestions,
    findMSVCVersions,
    splitRanges,
    normalizeCompilerName,
    normalizeCppVersionRequirement,
    SubrangePolicies,
    registerHelpers
} from './index';
import type { Inputs } from './types';
import * as Handlebars from 'handlebars';
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
        compiler_versions: {},
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

test('parseCompilerRequirements', async () => {
    const input = `gcc >=4.8
      clang >=3.8      msvc >=14.2
      apple-clang *`;

    const output = {
        gcc: '>=4.8.0',
        clang: '>=3.8.0',
        msvc: '>=14.2.0',
        'apple-clang': '*'
    };

    expect(parseCompilerRequirements(input)).toStrictEqual(output);
});

test('parseCompilerSuggestions', async () => {
    const output = [{
        'compiler': 'msvc',
        'range': '*',
        factor: undefined,
        'value': 'Ninja'
    }];

    // function parseCompilerSuggestions(inputLines, compilers) {
    expect(parseCompilerSuggestions(['msvc *: Ninja'], ['msvc'])).toStrictEqual(output);
    expect(parseCompilerSuggestions(['msvc: Ninja'], ['msvc'])).toStrictEqual(output);
});

test('normalizeCppVersionRequirement', async () => {
    expect(normalizeCppVersionRequirement('>=11')).toBe('>=2011');
    expect(normalizeCppVersionRequirement('  >= 11 ')).toBe('>= 2011');
    expect(normalizeCppVersionRequirement('>=2011')).toBe('>=2011');
    expect(normalizeCppVersionRequirement('>98')).toBe('>1998');
    expect(normalizeCppVersionRequirement('>=11 <=98')).toBe('>=2011 <=1998');
});

test('parseCompilerFactors', async () => {
    const { parseCompilerFactors } = await import('./index');
    const compilers = ['gcc', 'clang', 'msvc', 'apple-clang'];
    expect(parseCompilerFactors('gcc Coverage TSan UBSan', compilers)).toStrictEqual({ gcc: ['Coverage', 'TSan', 'UBSan'] });
    const input = `gcc Asan Shared
      msvc Shared`;
    expect(parseCompilerFactors(input, compilers)).toStrictEqual({ gcc: ['Asan', 'Shared'], msvc: ['Shared'] });
});

describe('normalizeCompilerName', () => {
    test('should normalize gcc variants to "gcc"', () => {
        expect(normalizeCompilerName('g++')).toBe('gcc');
        expect(normalizeCompilerName('GCC')).toBe('gcc');
        expect(normalizeCompilerName('GCC-9.0')).toBe('gcc');
    });

    test('should normalize clang variants to "clang"', () => {
        expect(normalizeCompilerName('clang++')).toBe('clang');
        expect(normalizeCompilerName('CLANG')).toBe('clang');
        expect(normalizeCompilerName('LLVM')).toBe('clang');
    });

    test('should normalize MSVC variants to "msvc"', () => {
        expect(normalizeCompilerName('cl')).toBe('msvc');
        expect(normalizeCompilerName('msvc')).toBe('msvc');
        expect(normalizeCompilerName('MSVC-12.0')).toBe('msvc');
    });

    test('should not normalize other compiler names', () => {
        expect(normalizeCompilerName('Intel C++')).toBe('Intel C++');
        expect(normalizeCompilerName('xyz')).toBe('xyz');
    });
});

describe('setup_program.findGCCVersions', () => {
    test('contains valid versions', async () => {
        expect(await setup_program.findGCCVersions()).toContain('4.8.0');
        expect(await setup_program.findGCCVersions()).toContain('13.1.0');
    });
});

describe('findClangVersions', () => {
    test('Contains valid versions', async () => {
        expect(await setup_program.findClangVersions()).toContain('2.6.0');
        expect(await setup_program.findClangVersions()).toContain('16.0.0');
    });
});

describe('splitRanges', () => {
    test('should split ranges correctly', async () => {
        expect(splitRanges('9.2 - 11', await setup_program.findGCCVersions())).toStrictEqual(['^9.2', '10', '11']);
        expect(splitRanges('9.2 - 9.4 || 11', await setup_program.findGCCVersions())).toStrictEqual(['9.2 - 9.4', '11']);
        expect(splitRanges('>=8 <9.100', await setup_program.findGCCVersions())).toStrictEqual(['8', '9']);
        expect(splitRanges('>=14 <14.50', findMSVCVersions())).toStrictEqual(['14']);
        expect(splitRanges('<=9.2', ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0'], SubrangePolicies.ONE_PER_MAJOR)).toStrictEqual(['9 - 9.2']);
        expect(splitRanges('>14.29.4 <14.40', ['14.29.30139', '14.29.30140'])).toStrictEqual(['14']);
        expect(splitRanges('>14.29.30140 <14.40', ['14.29.30139', '14.29.30150'])).toStrictEqual(['^14.29.30150']);
        expect(splitRanges('>14.0.0 <14.29.30140', ['14.29.30139', '14.29.30150'])).toStrictEqual(['14 - 14.29.30139']);
    });
});

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
            compiler_versions: compilerVersions,
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
            compiler_versions: { msvc: '>=14.0.0' },
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
        compiler_versions: { msvc: '>=14.0.0' },
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
        compiler_versions: { gcc: '>=10' },
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
        compiler_versions: { 'apple-clang': '*', 'mingw': '*', 'clang-cl': '*' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { msvc: '>=14' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { clang: '>=16' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: { gcc: '>=13' },
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
            compiler_versions: compilerVersions,
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
            compiler_versions: compilerVersions,
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
            compiler_versions: compilerVersions,
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
            compiler_versions: compilerVersions,
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
            compiler_versions: compilerVersions,
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

describe('Handlebars helpers', () => {
    beforeAll(() => {
        registerHelpers();
    });

    describe('string helpers', () => {
        test('lowercase converts to lowercase', () => {
            const template = Handlebars.compile('{{lowercase str}}');
            expect(template({ str: 'HELLO' })).toBe('hello');
        });

        test('uppercase converts to uppercase', () => {
            const template = Handlebars.compile('{{uppercase str}}');
            expect(template({ str: 'hello' })).toBe('HELLO');
        });

        test('contains checks substring presence', () => {
            const template = Handlebars.compile('{{#if (contains str "world")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'hello' })).toBe('no');
        });

        test('startsWith checks string prefix', () => {
            const template = Handlebars.compile('{{#if (startsWith str "hello")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'world hello' })).toBe('no');
        });

        test('endsWith checks string suffix', () => {
            const template = Handlebars.compile('{{#if (endsWith str "world")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
            expect(template({ str: 'world hello' })).toBe('no');
        });

        test('substr extracts substring', () => {
            const template = Handlebars.compile('{{{substr str 0 5}}}');
            expect(template({ str: 'hello world' })).toBe('hello');
        });

        test('replace replaces all occurrences', () => {
            const template = Handlebars.compile('{{{replace str ":" "-"}}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('ubuntu-24.04');
            expect(template({ str: 'a:b:c' })).toBe('a-b-c');
        });

        test('replaceFirst replaces first occurrence only', () => {
            const template = Handlebars.compile('{{{replaceFirst str ":" "-"}}}');
            expect(template({ str: 'a:b:c' })).toBe('a-b:c');
        });

        test('indexOf returns substring index', () => {
            const template = Handlebars.compile('{{indexOf str ":"}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('6');
            expect(template({ str: 'ubuntu' })).toBe('-1');
        });

        test('lastIndexOf returns last substring index', () => {
            const template = Handlebars.compile('{{lastIndexOf str "."}}');
            expect(template({ str: '1.2.3' })).toBe('3');
        });

        test('split splits string into array', () => {
            const template = Handlebars.compile('{{#each (split str ".")}}{{this}},{{/each}}');
            expect(template({ str: '1.2.3' })).toBe('1,2,3,');
        });

        test('trim removes whitespace', () => {
            const template = Handlebars.compile('{{{trim str}}}');
            expect(template({ str: '  hello  ' })).toBe('hello');
        });

        test('trimLeft removes leading whitespace', () => {
            const template = Handlebars.compile('{{{trimLeft str}}}');
            expect(template({ str: '  hello  ' })).toBe('hello  ');
        });

        test('trimRight removes trailing whitespace', () => {
            const template = Handlebars.compile('{{{trimRight str}}}');
            expect(template({ str: '  hello  ' })).toBe('  hello');
        });

        test('capitalize capitalizes first character', () => {
            const template = Handlebars.compile('{{{capitalize str}}}');
            expect(template({ str: 'hello world' })).toBe('Hello world');
        });

        test('titlecase capitalizes each word', () => {
            const template = Handlebars.compile('{{{titlecase str}}}');
            expect(template({ str: 'hello world' })).toBe('Hello World');
        });

        test('camelcase converts to camelCase', () => {
            const template = Handlebars.compile('{{{camelcase str}}}');
            expect(template({ str: 'hello-world' })).toBe('helloWorld');
            expect(template({ str: 'hello_world' })).toBe('helloWorld');
        });

        test('pascalcase converts to PascalCase', () => {
            const template = Handlebars.compile('{{{pascalcase str}}}');
            expect(template({ str: 'hello-world' })).toBe('HelloWorld');
        });

        test('snakecase converts to snake_case', () => {
            const template = Handlebars.compile('{{{snakecase str}}}');
            expect(template({ str: 'helloWorld' })).toBe('hello_world');
            expect(template({ str: 'hello-world' })).toBe('hello_world');
        });

        test('kebabcase converts to kebab-case', () => {
            const template = Handlebars.compile('{{{kebabcase str}}}');
            expect(template({ str: 'helloWorld' })).toBe('hello-world');
            expect(template({ str: 'hello_world' })).toBe('hello-world');
        });

        test('reverse reverses string', () => {
            const template = Handlebars.compile('{{{reverse str}}}');
            expect(template({ str: 'hello' })).toBe('olleh');
        });
    });

    describe('case-insensitive string helpers', () => {
        test('icontains checks case-insensitive substring', () => {
            const template = Handlebars.compile('{{#if (icontains str "WORLD")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });

        test('istartsWith checks case-insensitive prefix', () => {
            const template = Handlebars.compile('{{#if (istartsWith str "HELLO")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });

        test('iendsWith checks case-insensitive suffix', () => {
            const template = Handlebars.compile('{{#if (iendsWith str "WORLD")}}yes{{else}}no{{/if}}');
            expect(template({ str: 'hello world' })).toBe('yes');
        });
    });

    describe('logical helpers', () => {
        test('and performs logical AND', () => {
            const template = Handlebars.compile('{{#if (and a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: true, b: true })).toBe('yes');
            expect(template({ a: true, b: false })).toBe('no');
        });

        test('or performs logical OR', () => {
            const template = Handlebars.compile('{{#if (or a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: false, b: true })).toBe('yes');
            expect(template({ a: false, b: false })).toBe('no');
        });

        test('not performs logical NOT', () => {
            const template = Handlebars.compile('{{#if (not a)}}yes{{else}}no{{/if}}');
            expect(template({ a: false })).toBe('yes');
            expect(template({ a: true })).toBe('no');
        });

        test('select returns value based on condition', () => {
            const template = Handlebars.compile('{{{select cond "yes" "no"}}}');
            expect(template({ cond: true })).toBe('yes');
            expect(template({ cond: false })).toBe('no');
        });
    });

    describe('comparison helpers', () => {
        test('eq checks equality', () => {
            const template = Handlebars.compile('{{#if (eq a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'x', b: 'x' })).toBe('yes');
            expect(template({ a: 'x', b: 'y' })).toBe('no');
        });

        test('ieq checks case-insensitive equality', () => {
            const template = Handlebars.compile('{{#if (ieq a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'Hello', b: 'hello' })).toBe('yes');
        });

        test('ne checks inequality', () => {
            const template = Handlebars.compile('{{#if (ne a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 'x', b: 'y' })).toBe('yes');
        });

        test('lt checks less than', () => {
            const template = Handlebars.compile('{{#if (lt a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 2 })).toBe('yes');
            expect(template({ a: 2, b: 1 })).toBe('no');
        });

        test('le checks less than or equal', () => {
            const template = Handlebars.compile('{{#if (le a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 1 })).toBe('yes');
        });

        test('gt checks greater than', () => {
            const template = Handlebars.compile('{{#if (gt a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 2, b: 1 })).toBe('yes');
        });

        test('ge checks greater than or equal', () => {
            const template = Handlebars.compile('{{#if (ge a b)}}yes{{else}}no{{/if}}');
            expect(template({ a: 1, b: 1 })).toBe('yes');
        });
    });

    describe('conversion helpers', () => {
        test('toNumber converts string to number', () => {
            const template = Handlebars.compile('{{#if (gt (toNumber str) 5)}}yes{{else}}no{{/if}}');
            expect(template({ str: '10' })).toBe('yes');
            expect(template({ str: '3' })).toBe('no');
        });

        test('toJSON converts value to JSON string', () => {
            const template = Handlebars.compile('{{{toJSON obj}}}');
            expect(template({ obj: { a: 1 } })).toBe('{"a":1}');
        });

        test('fromJSON parses JSON string', () => {
            const template = Handlebars.compile('{{#with (fromJSON str)}}{{a}}{{/with}}');
            expect(template({ str: '{"a":"hello"}' })).toBe('hello');
        });
    });

    describe('math helpers', () => {
        test('add performs addition', () => {
            const template = Handlebars.compile('{{add a b}}');
            expect(template({ a: 5, b: 3 })).toBe('8');
        });

        test('sub performs subtraction', () => {
            const template = Handlebars.compile('{{sub a b}}');
            expect(template({ a: 5, b: 3 })).toBe('2');
        });

        test('mul performs multiplication', () => {
            const template = Handlebars.compile('{{mul a b}}');
            expect(template({ a: 5, b: 3 })).toBe('15');
        });

        test('div performs division', () => {
            const template = Handlebars.compile('{{div a b}}');
            expect(template({ a: 6, b: 2 })).toBe('3');
        });

        test('mod performs modulo', () => {
            const template = Handlebars.compile('{{mod a b}}');
            expect(template({ a: 7, b: 3 })).toBe('1');
        });

        test('abs returns absolute value', () => {
            const template = Handlebars.compile('{{abs n}}');
            expect(template({ n: -5 })).toBe('5');
        });

        test('floor rounds down', () => {
            const template = Handlebars.compile('{{floor n}}');
            expect(template({ n: 3.7 })).toBe('3');
        });

        test('ceil rounds up', () => {
            const template = Handlebars.compile('{{ceil n}}');
            expect(template({ n: 3.2 })).toBe('4');
        });

        test('round rounds to nearest integer', () => {
            const template = Handlebars.compile('{{round n}}');
            expect(template({ n: 3.5 })).toBe('4');
            expect(template({ n: 3.4 })).toBe('3');
        });

        test('min returns minimum value', () => {
            const template = Handlebars.compile('{{min a b c}}');
            expect(template({ a: 5, b: 2, c: 8 })).toBe('2');
        });

        test('max returns maximum value', () => {
            const template = Handlebars.compile('{{max a b c}}');
            expect(template({ a: 5, b: 2, c: 8 })).toBe('8');
        });

        test('pow computes power', () => {
            const template = Handlebars.compile('{{pow base exp}}');
            expect(template({ base: 2, exp: 3 })).toBe('8');
        });
    });

    describe('array helpers', () => {
        test('join joins array elements', () => {
            const template = Handlebars.compile('{{{join arr "-"}}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('a-b-c');
        });

        test('first returns first element', () => {
            const template = Handlebars.compile('{{first arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('a');
        });

        test('last returns last element', () => {
            const template = Handlebars.compile('{{last arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('c');
        });

        test('nth returns nth element', () => {
            const template = Handlebars.compile('{{nth arr 1}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('b');
        });

        test('length returns array length', () => {
            const template = Handlebars.compile('{{length arr}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('3');
        });

        test('length returns string length', () => {
            const template = Handlebars.compile('{{length str}}');
            expect(template({ str: 'hello' })).toBe('5');
        });

        test('slice extracts portion of array', () => {
            const template = Handlebars.compile('{{#each (slice arr 1 3)}}{{this}},{{/each}}');
            expect(template({ arr: ['a', 'b', 'c', 'd'] })).toBe('b,c,');
        });

        test('sort sorts array', () => {
            const template = Handlebars.compile('{{#each (sort arr)}}{{this}},{{/each}}');
            expect(template({ arr: ['c', 'a', 'b'] })).toBe('a,b,c,');
        });

        test('includes checks array membership', () => {
            const template = Handlebars.compile('{{#if (includes arr "b")}}yes{{else}}no{{/if}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('yes');
            expect(template({ arr: ['a', 'c'] })).toBe('no');
        });

        test('reverse reverses array', () => {
            const template = Handlebars.compile('{{#each (reverse arr)}}{{this}},{{/each}}');
            expect(template({ arr: ['a', 'b', 'c'] })).toBe('c,b,a,');
        });
    });

    describe('type checking helpers', () => {
        test('isString checks for string type', () => {
            const template = Handlebars.compile('{{#if (isString val)}}yes{{else}}no{{/if}}');
            expect(template({ val: 'hello' })).toBe('yes');
            expect(template({ val: 123 })).toBe('no');
        });

        test('isNumber checks for number type', () => {
            const template = Handlebars.compile('{{#if (isNumber val)}}yes{{else}}no{{/if}}');
            expect(template({ val: 123 })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
        });

        test('isArray checks for array type', () => {
            const template = Handlebars.compile('{{#if (isArray val)}}yes{{else}}no{{/if}}');
            expect(template({ val: [1, 2, 3] })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
        });

        test('isEmpty checks for empty values', () => {
            const template = Handlebars.compile('{{#if (isEmpty val)}}yes{{else}}no{{/if}}');
            expect(template({ val: '' })).toBe('yes');
            expect(template({ val: [] })).toBe('yes');
            expect(template({ val: 'hello' })).toBe('no');
            expect(template({ val: [1] })).toBe('no');
        });
    });

    describe('utility helpers', () => {
        test('default provides fallback for falsy values', () => {
            const template = Handlebars.compile('{{{default val "fallback"}}}');
            expect(template({ val: '' })).toBe('fallback');
            expect(template({ val: 'value' })).toBe('value');
        });

        test('coalesce returns first non-null value', () => {
            const template = Handlebars.compile('{{{coalesce a b c}}}');
            expect(template({ a: null, b: undefined, c: 'value' })).toBe('value');
            expect(template({ a: 'first', b: 'second', c: 'third' })).toBe('first');
        });

        test('format substitutes placeholders', () => {
            const template = Handlebars.compile('{{{format "Hello {0} {1}" first last}}}');
            expect(template({ first: 'John', last: 'Doe' })).toBe('Hello John Doe');
        });
    });

    describe('combined usage', () => {
        test('replace container colon for cache key', () => {
            const template = Handlebars.compile('cache-{{{replace container ":" "-"}}}');
            expect(template({ container: 'ubuntu:24.04' })).toBe('cache-ubuntu-24.04');
        });

        test('extract major version with split and first', () => {
            const template = Handlebars.compile('{{first (split version ".")}}');
            expect(template({ version: '14.0.3' })).toBe('14');
        });

        test('dynamic substring with indexOf', () => {
            const template = Handlebars.compile('{{{substr str 0 (indexOf str ":")}}}');
            expect(template({ str: 'ubuntu:24.04' })).toBe('ubuntu');
        });

        test('conditional with math comparison', () => {
            const template = Handlebars.compile('{{#if (ge (toNumber major) 14)}}new{{else}}old{{/if}}');
            expect(template({ major: '14' })).toBe('new');
            expect(template({ major: '12' })).toBe('old');
        });
    });
});
