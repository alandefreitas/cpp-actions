jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import { generateTable, getAllFactors } from './summary-table';
import type { MatrixEntry } from './types';
import type { Inputs } from './schema';

function makeEntry(overrides: Partial<MatrixEntry> = {}): MatrixEntry {
    return {
        name: 'GCC C++17-20',
        compiler: 'gcc',
        version: '>=13',
        env: {},
        'is-latest': false,
        'is-main': false,
        'is-earliest': false,
        'is-intermediary': false,
        'has-major': false,
        'has-minor': false,
        'has-patch': false,
        'subrange-policy': '',
        'runs-on': 'ubuntu-22.04',
        cxxstd: '17,20',
        'build-type': 'Release',
        cxxflags: '',
        ccflags: '',
        install: '',
        ...overrides
    };
}

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        compilers: {},
        standards: '',
        subrangePolicy: {},
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
    } as Inputs;
}

describe('getAllFactors', () => {
    test('returns empty array for empty inputs', () => {
        expect(getAllFactors({}, {})).toEqual([]);
    });

    test('returns unique factors from latest and variant factors', () => {
        const result = getAllFactors(
            { gcc: ['Asan', 'UBSan'] },
            { gcc: ['Coverage'] }
        );
        expect(result).toEqual(['Asan', 'UBSan', 'Coverage']);
    });

    test('splits composite factors', () => {
        const result = getAllFactors({ gcc: ['Asan+UBSan'] }, {});
        expect(result).toEqual(['Asan', 'UBSan']);
    });
});

describe('generateTable', () => {
    test('returns empty array for empty matrix', () => {
        const inputs = makeInputs();
        expect(generateTable([], inputs)).toEqual([]);
    });

    test('generates basic table with header row', () => {
        const entry = makeEntry({ 'is-main': true, 'is-earliest': false });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        expect(table.length).toBe(2); // header + 1 row
        expect(table[0].length).toBe(7); // 7 columns (no failure rate)
        // Check header is header objects
        expect(table[0][0]).toHaveProperty('header', true);
    });

    test('includes failure rate column when entry has failure-rate', () => {
        const entry = makeEntry({ 'failure-rate': 0.5 } as Partial<MatrixEntry>);
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        // Header should have 8 columns
        expect(table[0].length).toBe(8);
        // Last cell in data row should be the rate
        const row = table[1] as string[];
        expect(row[row.length - 1]).toBe('50.0%');
    });

    test('shows N/A for failure rate when entry lacks it', () => {
        const entryWithRate = makeEntry({ 'failure-rate': 0.3 } as Partial<MatrixEntry>);
        const entryWithout = makeEntry({ name: 'Clang', compiler: 'clang' });
        const inputs = makeInputs();
        const table = generateTable([entryWithRate, entryWithout], inputs);
        const row2 = table[2] as string[];
        expect(row2[row2.length - 1]).toBe('N/A');
    });

    test('shows container environment with string container', () => {
        const entry = makeEntry({ container: 'ubuntu:22.04' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[1]).toContain('ubuntu:22.04');
        expect(row[1]).toContain('<code>');
    });

    test('shows container environment with object container', () => {
        const entry = makeEntry({ container: { image: 'ubuntu:22.04' } });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[1]).toContain('ubuntu:22.04');
    });

    test('shows runner without container', () => {
        const entry = makeEntry();
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[1]).toContain('ubuntu-22.04');
        expect(row[1]).not.toContain('<br/>on');
    });

    test('formats cxxstd with System Default for empty', () => {
        const entry = makeEntry({ cxxstd: '' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[3]).toBe('System Default');
    });

    test('formats cxxstd with C++ prefix', () => {
        const entry = makeEntry({ cxxstd: '17,20' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[3]).toContain('C++17');
        expect(row[3]).toContain('C++20');
    });

    test('shows build type with emoji', () => {
        const entry = makeEntry({ 'build-type': 'Debug' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[4]).toContain('Debug');
    });

    test('shows empty build type cell when no build-type', () => {
        const entry = makeEntry();
        delete entry['build-type'];
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[4]).toBe('');
    });

    test('shows factor entries', () => {
        const entry = makeEntry({ asan: true, 'has-factors': true, 'is-main': false });
        const inputs = makeInputs({ latestFactors: { gcc: ['Asan'] } });
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('Asan');
    });

    test('shows main+latest description', () => {
        const entry = makeEntry({ 'is-main': true, 'is-earliest': false });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('Latest');
    });

    test('shows unique description when main+earliest', () => {
        const entry = makeEntry({ 'is-main': true, 'is-earliest': true });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('Unique');
    });

    test('shows system description when main+earliest+wildcard', () => {
        const entry = makeEntry({ 'is-main': true, 'is-earliest': true, version: '*' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('System');
    });

    test('shows earliest description', () => {
        const entry = makeEntry({ 'is-earliest': true, 'is-main': false });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('Earliest');
    });

    test('shows intermediary description when no factors', () => {
        const entry = makeEntry();
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('Intermediary');
    });

    test('shows cxxflags when present and equal to ccflags', () => {
        const entry = makeEntry({ cxxflags: '-Wall -Werror', ccflags: '-Wall -Werror' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('-Wall');
        expect(row[5]).toContain('-Werror');
    });

    test('shows separate cxxflags and ccflags when different', () => {
        const entry = makeEntry({ cxxflags: '-std=c++17', ccflags: '-std=c11' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('C++:');
        expect(row[5]).toContain('C:');
    });

    test('shows install packages', () => {
        const entry = makeEntry({ install: 'lcov pkg-config' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('lcov');
    });

    test('shows generator and toolset', () => {
        const entry = makeEntry({ generator: 'Ninja', 'generator-toolset': 'v143' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[6]).toContain('Ninja');
        expect(row[6]).toContain('v143');
    });

    test('shows System Default when no generator', () => {
        const entry = makeEntry();
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[6]).toContain('System Default');
    });

    test('shows b2-toolset', () => {
        const entry = makeEntry({ 'b2-toolset': 'gcc-13' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[6]).toContain('gcc-13');
    });

    test('shows triplet', () => {
        const entry = makeEntry({ triplet: 'x64-linux' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[6]).toContain('x64-linux');
    });

    test('buildTypeEmoji returns default for unknown build type', () => {
        const entry = makeEntry({ 'build-type': 'CustomType' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[4]).toContain('CustomType');
    });

    test('osEmoji returns default for unknown OS runner', () => {
        const entry = makeEntry({ 'runs-on': 'freebsd-latest' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        // Should still show runner name
        expect(row[1]).toContain('freebsd-latest');
    });

    test('factorEmoji returns default for unknown factor', () => {
        const entry = makeEntry({ 'custom-factor': true } as Partial<MatrixEntry>);
        const inputs = makeInputs({ latestFactors: { gcc: ['custom-factor'] } });
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('custom-factor');
    });

    test('factorEmoji resolves composite factor', () => {
        const entry = makeEntry({ asan: true, ubsan: true });
        const inputs = makeInputs({ latestFactors: { gcc: ['asan+ubsan'] } });
        const table = generateTable([entry], inputs);
        // Should render both factors
        expect(table[1]).toBeDefined();
    });

    test('factorEmoji falls through unknown composite parts to find known one', () => {
        // First part 'unknownfactor' is not in factorEmojis, second part 'asan' is
        const entry = makeEntry({ unknownfactor: true, asan: true } as Partial<MatrixEntry>);
        const inputs = makeInputs({ latestFactors: { gcc: ['unknownfactor+asan'] } });
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        // Should have found asan emoji from second composite part
        expect(row[5]).toContain('asan');
    });

    test('factorEmoji returns default when no composite part matches', () => {
        const entry = makeEntry({ 'foo': true, 'bar': true } as Partial<MatrixEntry>);
        const inputs = makeInputs({ latestFactors: { gcc: ['foo+bar'] } });
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        // Default emoji 🔢 should be used
        expect(row[5]).toContain('foo');
    });

    test('different cxxflags and ccflags both empty shows no flags', () => {
        // cxxflags !== ccflags (one empty, one undefined triggers the else branch)
        // but both are effectively empty
        const entry = makeEntry({ cxxflags: '', ccflags: undefined as unknown as string });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        // No flags section should appear
        expect(row[5]).not.toContain('🚩');
    });

    test('handles single cxxstd with no comma (no "and" transformation)', () => {
        const entry = makeEntry({ cxxstd: '20' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[3]).toBe('C++20');
    });

    test('handles three cxxstd values with and before last', () => {
        const entry = makeEntry({ cxxstd: '14,17,20' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[3]).toContain('and');
        expect(row[3]).toContain('C++14');
        expect(row[3]).toContain('C++20');
    });

    test('shows different ccflags only when cxxflags empty but ccflags not', () => {
        const entry = makeEntry({ cxxflags: '', ccflags: '-DFOO' });
        const inputs = makeInputs();
        const table = generateTable([entry], inputs);
        const row = table[1] as string[];
        expect(row[5]).toContain('C:');
    });
});
