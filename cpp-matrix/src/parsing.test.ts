import {
    parseCompilerRequirements,
    parseCompilerFactors,
    parseCompilerSuggestions,
    normalizeCppVersionRequirement,
    normalizeCompilerName
} from './parsing';

describe('parseCompilerRequirements', () => {
    test('parses multi-line compiler requirements', () => {
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
});

describe('parseCompilerSuggestions', () => {
    test('parses suggestion with explicit and implicit wildcard range', () => {
        const output = [{
            'compiler': 'msvc',
            'range': '*',
            factor: undefined,
            'value': 'Ninja'
        }];

        expect(parseCompilerSuggestions(['msvc *: Ninja'], ['msvc'])).toStrictEqual(output);
        expect(parseCompilerSuggestions(['msvc: Ninja'], ['msvc'])).toStrictEqual(output);
    });
});

describe('normalizeCppVersionRequirement', () => {
    test('normalizes short C++ version numbers to 4-digit form', () => {
        expect(normalizeCppVersionRequirement('>=11')).toBe('>=2011');
        expect(normalizeCppVersionRequirement('  >= 11 ')).toBe('>= 2011');
        expect(normalizeCppVersionRequirement('>=2011')).toBe('>=2011');
        expect(normalizeCppVersionRequirement('>98')).toBe('>1998');
        expect(normalizeCppVersionRequirement('>=11 <=98')).toBe('>=2011 <=1998');
    });
});

describe('parseCompilerFactors', () => {
    test('parses single-line and multi-line factor inputs', async () => {
        const compilers = ['gcc', 'clang', 'msvc', 'apple-clang'];
        expect(parseCompilerFactors('gcc Coverage TSan UBSan', compilers)).toStrictEqual({ gcc: ['Coverage', 'TSan', 'UBSan'] });
        const input = `gcc Asan Shared
      msvc Shared`;
        expect(parseCompilerFactors(input, compilers)).toStrictEqual({ gcc: ['Asan', 'Shared'], msvc: ['Shared'] });
    });
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

    test('should normalize macos-gcc variants to "macos-gcc"', () => {
        expect(normalizeCompilerName('macos-gcc')).toBe('macos-gcc');
        expect(normalizeCompilerName('macosgcc')).toBe('macos-gcc');
        expect(normalizeCompilerName('brew-gcc')).toBe('macos-gcc');
        expect(normalizeCompilerName('brewgcc')).toBe('macos-gcc');
        expect(normalizeCompilerName('MACOS-GCC')).toBe('macos-gcc');
    });

    test('should normalize macos-clang variants to "macos-clang"', () => {
        expect(normalizeCompilerName('macos-clang')).toBe('macos-clang');
        expect(normalizeCompilerName('macosclang')).toBe('macos-clang');
        expect(normalizeCompilerName('brew-clang')).toBe('macos-clang');
        expect(normalizeCompilerName('brewclang')).toBe('macos-clang');
        expect(normalizeCompilerName('macos-llvm')).toBe('macos-clang');
        expect(normalizeCompilerName('MACOS-CLANG')).toBe('macos-clang');
    });

    test('should not normalize other compiler names', () => {
        expect(normalizeCompilerName('Intel C++')).toBe('Intel C++');
        expect(normalizeCompilerName('xyz')).toBe('xyz');
    });
});
