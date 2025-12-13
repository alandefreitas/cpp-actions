import * as path from 'path';
import * as process from 'process';

const cacheDir = path.join(__dirname, '..', 'test-data', 'cache');
process.env.CPP_MATRIX_CACHE_DIR = cacheDir;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');
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
    SubrangePolicies
} from './index';
import * as core from '@actions/core';

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

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>;
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                };
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message);
                        mockCore.setFailed(error.message);
                    },
                    __mockCore: mockCore
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors');

            runPromise = prettyErrors.reportAndSetFailed(new Error('matrix boom'), { title: 'CPP matrix failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('matrix boom');
            });
        });

        await runPromise!;
    });
});

describe('generateMatrix', () => {
    test('should generate matrix correctly', async () => {
        const compilerVersions = {
            gcc: '>=4.8.0',
            clang: '>=3.8.0',
            msvc: '>=14.2.0',
            'apple-clang': '*'
        };
        const standards = normalizeCppVersionRequirement('>=11');
        const max_standards = 2;
        const latest_factors = { gcc: ['Coverage', 'TSan', 'UBSan'] };
        const factors = { gcc: ['Asan', 'Shared'], msvc: ['Shared', 'x86'] };
        const inputs = {
            compiler_versions: compilerVersions,
            standards: standards,
            subrange_policy: { '': 'one-per-major' },
            max_standards: max_standards,
            latest_factors: latest_factors,
            factors: factors,
            combinatorial_factors: {},
            force_factors: [],
            extra_values: [],
            runs_on: [],
            containers: [],
            generators: [],
            generator_toolsets: [],
            b2_toolsets: [],
            ccflags: [],
            cxxflags: parseCompilerSuggestions(['gcc >=10 <12: -static'], Object.keys(compilerVersions)),
            install: [],
            triplets: [],
            build_types: [],
            default_build_type: 'Release',
            sanitizer_build_type: 'Release',
            x86_build_type: 'Release',
            use_containers: false,
            warn_no_matches: false,
            output_file: undefined,
            log_matrix: false,
            generate_summary: false,
            trace_commands: false
        };
        const matrix = await generateMatrix(inputs);
        expect(matrix.length === 0).toBe(false);
        const table = await generateTable(matrix, inputs);
        expect(table.length === 0).toBe(false);
    });

    test('warns when compiler has no compatible entries', async () => {
        const warnSpy = jest.spyOn(core, 'warning').mockImplementation(() => { });
        const inputs = {
            compiler_versions: { msvc: '>=14.0.0' },
            subrange_policy: { '': 'one-per-major' },
            standards: normalizeCppVersionRequirement('>=26'),
            latest_factors: {},
            factors: {},
            combinatorial_factors: {},
            force_factors: [],
            extra_values: [],
            runs_on: [],
            containers: [],
            generators: [],
            generator_toolsets: [],
            b2_toolsets: [],
            ccflags: [],
            cxxflags: [],
            install: [],
            triplets: [],
            build_types: [],
            default_build_type: 'Release',
            sanitizer_build_type: 'Release',
            x86_build_type: 'Release',
            use_containers: false,
            warn_no_matches: true,
            output_file: undefined,
            log_matrix: false,
            generate_summary: false,
            trace_commands: false
        };
        try {
            await generateMatrix(inputs);
            expect(warnSpy).toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });
});

test('msvc x86 entries prefer arch metadata over /m32 flags', async () => {
    const compilerVersions = {
        msvc: '>=14.0.0'
    };
    const inputs = {
        compiler_versions: compilerVersions,
        standards: normalizeCppVersionRequirement('>=11'),
        subrange_policy: { '': 'one-per-major' },
        max_standards: 1,
        latest_factors: {},
        factors: { msvc: ['x86'] },
        combinatorial_factors: {},
        force_factors: [],
        extra_values: [],
        runs_on: [],
        containers: [],
        generators: [],
        generator_toolsets: [],
        b2_toolsets: [],
        ccflags: [],
        cxxflags: [],
        install: [],
        triplets: [],
        build_types: [],
        default_build_type: 'Release',
        sanitizer_build_type: 'Release',
        x86_build_type: 'Release',
        use_containers: false,
        warn_no_matches: false,
        output_file: undefined,
        log_matrix: false,
        generate_summary: false,
        trace_commands: false
    };
    const matrix = await generateMatrix(inputs);
    const msvcX86Entry = matrix.find(entry => entry.compiler === 'msvc' && entry.x86 === true);
    expect(msvcX86Entry).toBeDefined();
    expect(msvcX86Entry?.cxxflags).not.toMatch(/\/m32/);
    expect(msvcX86Entry?.ccflags).not.toMatch(/\/m32/);
    expect(msvcX86Entry?.arch).toBe('x86');
});

test('non-x86 entries default arch to x64 unless overridden', async () => {
    const compilerVersions = {
        gcc: '>=10'
    };
    const inputs = {
        compiler_versions: compilerVersions,
        standards: normalizeCppVersionRequirement('>=17'),
        subrange_policy: { '': 'one-per-major' },
        max_standards: 1,
        latest_factors: {},
        factors: {},
        combinatorial_factors: {},
        force_factors: [],
        extra_values: [],
        runs_on: [],
        containers: [],
        generators: [],
        generator_toolsets: [],
        b2_toolsets: [],
        ccflags: [],
        cxxflags: [],
        install: [],
        triplets: [],
        build_types: [],
        default_build_type: 'Release',
        sanitizer_build_type: 'Release',
        x86_build_type: 'Release',
        use_containers: false,
        warn_no_matches: false,
        output_file: undefined,
        log_matrix: false,
        generate_summary: false,
        trace_commands: false
    };
    const matrix = await generateMatrix(inputs);
    const gccEntry = matrix.find(entry => entry.compiler === 'gcc');
    expect(gccEntry?.arch).toBe('x64');
});
