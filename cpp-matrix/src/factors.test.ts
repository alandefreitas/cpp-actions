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

jest.mock('setup-program', () => ({
    findClangVersions: jest.fn().mockResolvedValue(['16.0.0', '17.0.0', '18.0.0'])
}));

import type { MatrixEntry } from './types';
import type { Inputs } from './schema';
import {
    applyMainEntryFactors,
    applyLatestFactors,
    applyVariantFactors,
    applyCombinatorialFactors,
    setRecommendedFlags,
    llvmProfileFilePattern
} from './factors';

/**
 * Creates a minimal matrix entry for testing.
 *
 * @param overrides - Fields to override
 * @returns A MatrixEntry
 */
function makeEntry(overrides: Partial<MatrixEntry> = {}): MatrixEntry {
    return {
        name: 'GCC',
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
        cxxstd: '17,20',
        'latest-cxxstd': '20',
        cxxflags: '',
        ccflags: '',
        install: '',
        'runs-on': 'ubuntu-22.04',
        ...overrides
    };
}

/**
 * Creates minimal inputs for testing.
 *
 * @param overrides - Fields to override
 * @returns Inputs
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        mainEntryFactors: {},
        latestFactors: {},
        factors: {},
        combinatorialFactors: {},
        sanitizerBuildType: 'Release',
        x86BuildType: 'Release',
        ...overrides
    } as Inputs;
}

describe('llvmProfileFilePattern', () => {
    test('returns %p-%m for clang < 21', () => {
        const pattern = llvmProfileFilePattern(16);
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).not.toContain('%b');
        expect(pattern).toMatch(/\.profraw$/);
    });

    test('returns %b-%p-%m for clang >= 21', () => {
        const pattern = llvmProfileFilePattern(21);
        expect(pattern).toContain('%b');
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).toMatch(/\.profraw$/);
    });

    test('returns %p-%m for undefined version', () => {
        const pattern = llvmProfileFilePattern(undefined);
        expect(pattern).toContain('%p');
        expect(pattern).toContain('%m');
        expect(pattern).not.toContain('%b');
    });
});

describe('applyCombinatorialFactors', () => {
    test('duplicates entries for each combinatorial factor', () => {
        const matrix = [makeEntry({ name: 'GCC-A' }), makeEntry({ name: 'GCC-B' })];
        const inputs = makeInputs({ combinatorialFactors: { gcc: ['Shared'] } });
        applyCombinatorialFactors(matrix, inputs, 1, 0, 'gcc');
        // Original 2 entries + 2 copies (one per entry per factor)
        expect(matrix.length).toBe(4);
        expect(matrix[2]['shared']).toBe(true);
        expect(matrix[3]['shared']).toBe(true);
        expect(matrix[2]['has-factors']).toBe(true);
        // Originals should have shared=false
        expect(matrix[0]['shared']).toBe(false);
        expect(matrix[1]['shared']).toBe(false);
    });

    test('handles composite combinatorial factors', () => {
        const matrix = [makeEntry()];
        const inputs = makeInputs({ combinatorialFactors: { gcc: ['Asan+UBSan'] } });
        applyCombinatorialFactors(matrix, inputs, 0, 0, 'gcc');
        expect(matrix.length).toBe(2);
        expect(matrix[1]['asan']).toBe(true);
        expect(matrix[1]['ubsan']).toBe(true);
    });

    test('does nothing when compiler not in combinatorialFactors', () => {
        const matrix = [makeEntry()];
        const inputs = makeInputs({ combinatorialFactors: { clang: ['Asan'] } });
        applyCombinatorialFactors(matrix, inputs, 0, 0, 'gcc');
        expect(matrix.length).toBe(1);
    });
});

describe('applyMainEntryFactors', () => {
    test('applies first factor directly to the main entry', () => {
        const matrix = [
            makeEntry({ name: 'Earliest' }),
            makeEntry({ name: 'Latest', 'is-main': true, 'is-latest': true })
        ];
        const inputs = makeInputs({ mainEntryFactors: { gcc: ['Coverage'] } });
        applyMainEntryFactors(matrix, inputs, 1, 'gcc');
        expect(matrix[1]['coverage']).toBe(true);
        expect(matrix[1]['is-main']).toBe(true);
        expect(matrix[1]['has-factors']).toBe(true);
        expect(matrix[1]['name']).toBe('Latest (Coverage)');
        expect(matrix.length).toBe(2);
        expect(matrix[0]['coverage']).toBe(false);
    });

    test('handles composite factor on main entry', () => {
        const matrix = [makeEntry({ name: 'Main', 'is-main': true })];
        const inputs = makeInputs({ mainEntryFactors: { gcc: ['ASan+UBSan'] } });
        applyMainEntryFactors(matrix, inputs, 0, 'gcc');
        expect(matrix[0]['asan']).toBe(true);
        expect(matrix[0]['ubsan']).toBe(true);
        expect(matrix[0]['name']).toBe('Main (ASan+UBSan)');
        expect(matrix.length).toBe(1);
    });

    test('overflows extra factors to latest-factors behavior', () => {
        const matrix = [makeEntry({ name: 'Main', 'is-main': true })];
        const inputs = makeInputs({ mainEntryFactors: { gcc: ['Coverage', 'UBSan'] } });
        applyMainEntryFactors(matrix, inputs, 0, 'gcc');
        // First factor applied to main entry
        expect(matrix[0]['coverage']).toBe(true);
        expect(matrix[0]['ubsan']).toBe(false);
        expect(matrix[0]['is-main']).toBe(true);
        expect(matrix[0]['name']).toBe('Main (Coverage)');
        // Second factor creates a copy (latest-factors behavior)
        expect(matrix.length).toBe(2);
        expect(matrix[1]['ubsan']).toBe(true);
        expect(matrix[1]['coverage']).toBe(false);
        expect(matrix[1]['is-main']).toBe(false);
        expect(matrix[1]['name']).toBe('Main (UBSan)');
    });

    test('overflow copies do not carry the first factor', () => {
        const matrix = [makeEntry({ name: 'Main', 'is-main': true })];
        const inputs = makeInputs({ mainEntryFactors: { gcc: ['Coverage', 'TSan', 'UBSan'] } });
        applyMainEntryFactors(matrix, inputs, 0, 'gcc');
        // Main entry: Coverage only
        expect(matrix[0]['coverage']).toBe(true);
        expect(matrix[0]['tsan']).toBe(false);
        expect(matrix[0]['ubsan']).toBe(false);
        expect(matrix[0]['is-main']).toBe(true);
        // Two overflow copies
        expect(matrix.length).toBe(3);
        expect(matrix[1]['tsan']).toBe(true);
        expect(matrix[1]['coverage']).toBe(false);
        expect(matrix[1]['is-main']).toBe(false);
        expect(matrix[2]['ubsan']).toBe(true);
        expect(matrix[2]['coverage']).toBe(false);
        expect(matrix[2]['is-main']).toBe(false);
    });

    test('does nothing when compiler not in mainEntryFactors', () => {
        const matrix = [makeEntry({ name: 'Main', 'is-main': true })];
        const inputs = makeInputs({ mainEntryFactors: { clang: ['Coverage'] } });
        applyMainEntryFactors(matrix, inputs, 0, 'gcc');
        expect(matrix[0]['coverage']).toBeUndefined();
        expect(matrix.length).toBe(1);
    });

    test('does not affect latest-factor copies created before it', () => {
        const matrix = [
            makeEntry({ name: 'Earliest' }),
            makeEntry({ name: 'Latest', 'is-main': true, 'is-latest': true })
        ];
        const inputs = makeInputs({
            latestFactors: { gcc: ['TSan'] },
            mainEntryFactors: { gcc: ['Coverage'] }
        });
        applyLatestFactors(matrix, inputs, 1, 0, 'gcc');
        expect(matrix.length).toBe(3);
        applyMainEntryFactors(matrix, inputs, 1, 'gcc');
        expect(matrix[1]['coverage']).toBe(true);
        expect(matrix[1]['is-main']).toBe(true);
        expect(matrix[2]['tsan']).toBe(true);
        expect(matrix[2]['coverage']).toBe(false);
        expect(matrix[2]['is-main']).toBe(false);
    });
});

describe('applyLatestFactors', () => {
    test('duplicates latest entry for each factor', () => {
        const matrix = [makeEntry({ name: 'A' }), makeEntry({ name: 'B' })];
        const inputs = makeInputs({ latestFactors: { gcc: ['Asan', 'TSan'] } });
        applyLatestFactors(matrix, inputs, 1, 0, 'gcc');
        expect(matrix.length).toBe(4);
        expect(matrix[2]['asan']).toBe(true);
        expect(matrix[3]['tsan']).toBe(true);
    });
});

describe('applyVariantFactors', () => {
    test('applies to intermediary entries', () => {
        const matrix = [
            makeEntry({ name: 'Earliest' }),
            makeEntry({ name: 'Middle' }),
            makeEntry({ name: 'Latest' })
        ];
        const inputs = makeInputs({ factors: { gcc: ['Shared'] } });
        applyVariantFactors(matrix, inputs, 2, 0, 'gcc');
        expect(matrix[1]['shared']).toBe(true);
    });

    test('duplicates latest when all intermediaries consumed', () => {
        const matrix = [makeEntry({ name: 'Earliest' }), makeEntry({ name: 'Latest' })];
        const inputs = makeInputs({ factors: { gcc: ['Shared', 'x86'] } });
        applyVariantFactors(matrix, inputs, 1, 0, 'gcc');
        expect(matrix.length).toBeGreaterThanOrEqual(3);
    });
});

describe('setRecommendedFlags', () => {
    test('clang coverage produces -fprofile-instr-generate', async () => {
        const entry = makeEntry({ compiler: 'clang', coverage: true });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.cxxflags).toContain('-fprofile-instr-generate');
        expect(entry.cxxflags).toContain('-fcoverage-mapping');
        expect(entry['build-type']).toBe('Debug');
    });

    test('clang x86 produces -m32 flag', async () => {
        const entry = makeEntry({ compiler: 'clang', x86: true });
        await setRecommendedFlags(entry, makeInputs({ x86BuildType: 'Debug' }));
        expect(entry.cxxflags).toContain('-m32');
        expect(entry.ccflags).toContain('-m32');
        expect(entry['build-type']).toBe('Debug');
    });

    test('time-trace on clang adds -ftime-trace when version >= 9', async () => {
        const entry = makeEntry({
            compiler: 'clang',
            version: '>=16',
            'time-trace': true,
            cxxstd: '17,20',
            'latest-cxxstd': '20',
            name: 'Clang C++17-20'
        });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.cxxflags).toContain('-ftime-trace');
        expect(entry.install).toContain('wget');
        expect(entry.cxxstd).toBe('20');
    });

    test('time-trace with empty cxxstd does not modify cxxstd', async () => {
        const entry = makeEntry({
            compiler: 'clang',
            version: '>=16',
            'time-trace': true,
            cxxstd: '',
            'latest-cxxstd': '20',
            name: 'Clang'
        });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.cxxstd).toBe('');
    });

    test('ubuntu container string adds build-essential', async () => {
        const entry = makeEntry({ container: 'ubuntu:22.04' });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.install).toContain('build-essential');
    });

    test('ubuntu container object adds build-essential', async () => {
        const entry = makeEntry({ container: { image: 'ubuntu:24.04' } });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.install).toContain('build-essential');
    });

    test('non-ubuntu container does not add build-essential', async () => {
        const entry = makeEntry({ container: 'fedora:38' });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.install).not.toContain('build-essential');
    });

    test('vcpkg triplets for different compilers', async () => {
        const msvcEntry = makeEntry({ compiler: 'msvc' });
        await setRecommendedFlags(msvcEntry, makeInputs());
        expect(msvcEntry.triplet).toBe('x64-windows');

        const mingwEntry = makeEntry({ compiler: 'mingw' });
        await setRecommendedFlags(mingwEntry, makeInputs());
        expect(mingwEntry.triplet).toBe('x64-mingw-static');

        const appleEntry = makeEntry({ compiler: 'apple-clang' });
        await setRecommendedFlags(appleEntry, makeInputs());
        expect(appleEntry.triplet).toBe('arm64-osx');

        const gccEntry = makeEntry({ compiler: 'gcc' });
        await setRecommendedFlags(gccEntry, makeInputs());
        expect(gccEntry.triplet).toBe('x64-linux');
    });

    test('arch from entry takes priority over x86 default', async () => {
        const entry = makeEntry({ arch: 'ARM64' });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.arch).toBe('arm64');
        expect(entry.triplet).toBe('arm64-linux');
    });

    test('clang-cl gets windows triplet', async () => {
        const entry = makeEntry({ compiler: 'clang-cl' });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.triplet).toBe('x64-windows');
    });

    test('clang 9-20 coverage sets LLVM_PROFILE_FILE with %p and %m', async () => {
        const entry = makeEntry({ compiler: 'clang', version: '>=16', coverage: true });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.env['LLVM_PROFILE_FILE']).toBeDefined();
        expect(entry.env['LLVM_PROFILE_FILE']).toContain('%p');
        expect(entry.env['LLVM_PROFILE_FILE']).toContain('%m');
        expect(entry.env['LLVM_PROFILE_FILE']).not.toContain('%b');
        expect(entry.env['LLVM_PROFILE_FILE']).toMatch(/\.profraw$/);
    });

    test('clang 21+ coverage sets LLVM_PROFILE_FILE with %b, %p, and %m', async () => {
        const entry = makeEntry({ compiler: 'clang', version: '>=21', coverage: true });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.env['LLVM_PROFILE_FILE']).toBeDefined();
        expect(entry.env['LLVM_PROFILE_FILE']).toContain('%b');
        expect(entry.env['LLVM_PROFILE_FILE']).toContain('%p');
        expect(entry.env['LLVM_PROFILE_FILE']).toContain('%m');
        expect(entry.env['LLVM_PROFILE_FILE']).toMatch(/\.profraw$/);
    });

    test('gcc coverage does not set LLVM_PROFILE_FILE', async () => {
        const entry = makeEntry({ compiler: 'gcc', version: '>=13', coverage: true });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.env['LLVM_PROFILE_FILE']).toBeUndefined();
    });

    test('LLVM_PROFILE_FILE preserves existing env vars', async () => {
        const entry = makeEntry({
            compiler: 'clang',
            version: '>=16',
            coverage: true,
            env: { 'EXISTING_VAR': 'value' }
        });
        await setRecommendedFlags(entry, makeInputs());
        expect(entry.env['EXISTING_VAR']).toBe('value');
        expect(entry.env['LLVM_PROFILE_FILE']).toBeDefined();
    });
});
