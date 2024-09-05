const main = require('./index')
Object.assign(global, main)

const process = require('process')
const cp = require('child_process')
const path = require('path')
const setup_program = require('setup-program')

const {
    generateMatrix,
    generateTable,
    parseCompilerRequirements,
    parseCompilerSuggestions,
    findMSVCVersions,
    splitRanges
} = require('./index')
const core = require('@actions/core')

test('parseCompilerRequirements', async () => {
    const input = `gcc >=4.8
      clang >=3.8      msvc >=14.2
      apple-clang *`

    const output = {
        gcc: '>=4.8.0',
        clang: '>=3.8.0',
        msvc: '>=14.2.0',
        'apple-clang': '*'
    }

    expect(parseCompilerRequirements(input)).toStrictEqual(output)
})

test('parseCompilerSuggestions', async () => {
    const output = [{
        'compiler': 'msvc',
        'range': '*',
        factor: undefined,
        'value': 'Ninja'
    }]

    // function parseCompilerSuggestions(inputLines, compilers) {
    expect(parseCompilerSuggestions(['msvc *: Ninja'], ['msvc'])).toStrictEqual(output)
    expect(parseCompilerSuggestions(['msvc: Ninja'], ['msvc'])).toStrictEqual(output)
})

test('normalizeCppVersionRequirement', async () => {
    expect(normalizeCppVersionRequirement('>=11')).toBe('>=2011')
    expect(normalizeCppVersionRequirement('  >= 11 ')).toBe('>= 2011')
    expect(normalizeCppVersionRequirement('>=2011')).toBe('>=2011')
    expect(normalizeCppVersionRequirement('>98')).toBe('>1998')
    expect(normalizeCppVersionRequirement('>=11 <=98')).toBe('>=2011 <=1998')
})

test('parseCompilerFactors', async () => {
    const compilers = ['gcc', 'clang', 'msvc', 'apple-clang']
    expect(parseCompilerFactors('gcc Coverage TSan UBSan', compilers)).toStrictEqual({gcc: ['Coverage', 'TSan', 'UBSan']})
    const input = `gcc Asan Shared
      msvc Shared`
    expect(parseCompilerFactors(input, compilers)).toStrictEqual({gcc: ['Asan', 'Shared'], msvc: ['Shared']})
})

describe('normalizeCompilerName', () => {
    test('should normalize gcc variants to "gcc"', () => {
        expect(normalizeCompilerName('g++')).toBe('gcc')
        expect(normalizeCompilerName('GCC')).toBe('gcc')
        expect(normalizeCompilerName('GCC-9.0')).toBe('gcc')
    })

    test('should normalize clang variants to "clang"', () => {
        expect(normalizeCompilerName('clang++')).toBe('clang')
        expect(normalizeCompilerName('CLANG')).toBe('clang')
        expect(normalizeCompilerName('LLVM')).toBe('clang')
    })

    test('should normalize MSVC variants to "msvc"', () => {
        expect(normalizeCompilerName('cl')).toBe('msvc')
        expect(normalizeCompilerName('msvc')).toBe('msvc')
        expect(normalizeCompilerName('MSVC-12.0')).toBe('msvc')
    })

    test('should not normalize other compiler names', () => {
        expect(normalizeCompilerName('Intel C++')).toBe('Intel C++')
        expect(normalizeCompilerName('xyz')).toBe('xyz')
    })
})

describe('setup_program.findGCCVersions', () => {
    test('contains valid versions', async () => {
        expect(await setup_program.findGCCVersions()).toContain('4.8.0')
        expect(await setup_program.findGCCVersions()).toContain('13.1.0')
    })
})

describe('findClangVersions', () => {
    test('Contains valid versions', async () => {
        expect(await setup_program.findClangVersions()).toContain('2.6.0')
        expect(await setup_program.findClangVersions()).toContain('16.0.0')
    })
})

describe('splitRanges', () => {
    test('should split ranges correctly', async () => {
        expect(splitRanges('9.2 - 11', await setup_program.findGCCVersions())).toStrictEqual(['^9.2', '10', '11'])
        expect(splitRanges('9.2 - 9.4 || 11', await setup_program.findGCCVersions())).toStrictEqual(['9.2 - 9.4', '11'])
        expect(splitRanges('>=8 <9.100', await setup_program.findGCCVersions())).toStrictEqual(['8', '9'])
        expect(splitRanges('>=14 <14.50', findMSVCVersions())).toStrictEqual(['14'])
        expect(splitRanges('<=9.2', ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0'], SubrangePolicies.ONE_PER_MAJOR)).toStrictEqual(['9 - 9.2'])
        expect(splitRanges('>14.29.4 <14.40', ['14.29.30139', '14.29.30140'])).toStrictEqual(['14'])
        expect(splitRanges('>14.29.30140 <14.40', ['14.29.30139', '14.29.30150'])).toStrictEqual(['^14.29.30150'])
        expect(splitRanges('>14.0.0 <14.29.30140', ['14.29.30139', '14.29.30150'])).toStrictEqual(['14 - 14.29.30139'])
    })
})

describe('generateMatrix', () => {
    test('should generate matrix correctly', async () => {
        const compilerVersions = {
            gcc: '>=4.8.0',
            clang: '>=3.8.0',
            msvc: '>=14.2.0',
            'apple-clang': '*'
        }
        const standards = normalizeCppVersionRequirement('>=11')
        const max_standards = 2
        const latest_factors = {gcc: ['Coverage', 'TSan', 'UBSan']}
        const factors = {gcc: ['Asan', 'Shared'], msvc: ['Shared', 'x86']}
        const inputs = {
            compiler_versions: compilerVersions,
            standards: standards,
            subrange_policy: {'': 'one-per-major'},
            max_standards: max_standards,
            latest_factors: latest_factors,
            factors: factors,
            combinatorial_factors: {},
            cxxflags: parseCompilerSuggestions(['gcc >=10 <12: -static'], Object.keys(compilerVersions))
        }
        const matrix = await generateMatrix(inputs)
        expect(matrix.length === 0).toBe(false)
        const table = await generateTable(matrix, inputs)
        expect(table.length === 0).toBe(false)
    })
})
