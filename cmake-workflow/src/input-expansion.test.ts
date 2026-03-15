import * as gh_inputs from 'gh-inputs';
import {
    normalizePath,
    sanitizeKey,
    generateFactorSuffix,
    parseExtraArgs,
    expandInputs,
    validateUniquePaths,
    makeFactorPath,
    applyPresetMacros
} from './input-expansion';
import { type Inputs } from './schema';
import { type ResolvedInputs } from './types';

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    enabled: jest.fn(() => false)
}));

jest.mock('setup-program', () => ({
    normalizeArchitectureInput: jest.fn((v: string) => v),
    downloadAndExtract: jest.fn(),
    stripSingleDirectoryFromPath: jest.fn(),
    cloneGitRepo: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

describe('parseBashArguments (used by parseExtraArgs)', () => {
    it('splits quoted arguments correctly', () => {
        expect(gh_inputs.parseBashArguments(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master']);
    });
});

describe('normalizePath', () => {
    it('returns path unchanged on non-Windows', () => {
        if (process.platform !== 'win32') {
            expect(normalizePath('/usr/local/bin')).toBe('/usr/local/bin');
        }
    });

    it('is defined and callable', () => {
        expect(typeof normalizePath).toBe('function');
    });
});

describe('sanitizeKey', () => {
    it('replaces invalid characters with underscores', () => {
        expect(sanitizeKey('foo bar/baz')).toBe('foo_bar_baz');
    });

    it('collapses consecutive underscores', () => {
        expect(sanitizeKey('foo///bar')).toBe('foo_bar');
    });

    it('trims leading and trailing underscores', () => {
        expect(sanitizeKey('!hello!')).toBe('hello');
    });

    it('preserves valid characters', () => {
        expect(sanitizeKey('foo-bar_baz123')).toBe('foo-bar_baz123');
    });
});

describe('generateFactorSuffix', () => {
    it('returns empty string for main entry', () => {
        expect(generateFactorSuffix(undefined, '20', '20', true)).toBe('');
    });

    it('returns cxxstd suffix when not main standard', () => {
        expect(generateFactorSuffix(undefined, '23', '20', true)).toBe('-cxx23');
    });

    it('returns extraArgs key suffix for non-first key', () => {
        expect(generateFactorSuffix('asan', '20', '20', false)).toBe('-asan');
    });

    it('combines extraArgs key and cxxstd suffixes', () => {
        expect(generateFactorSuffix('asan', '23', '20', false)).toBe('-asan-cxx23');
    });

    it('returns empty string when extraArgs key is first and cxxstd matches main', () => {
        expect(generateFactorSuffix('default', '20', '20', true)).toBe('');
    });
});

// =====================================================
// parseExtraArgs
// =====================================================
describe('parseExtraArgs', () => {
    it('returns empty array for empty input', () => {
        expect(parseExtraArgs([])).toEqual([]);
    });

    it('parses single-line arguments as flat list', () => {
        const result = parseExtraArgs(['-DFOO=bar -DBAZ=1']);
        expect(result).toEqual(['-DFOO=bar', '-DBAZ=1']);
    });

    it('parses key-value pairs into a map', () => {
        const result = parseExtraArgs(['debug: -DCMAKE_BUILD_TYPE=Debug', 'release: -DCMAKE_BUILD_TYPE=Release']);
        expect(result).toEqual({
            debug: ['-DCMAKE_BUILD_TYPE=Debug'],
            release: ['-DCMAKE_BUILD_TYPE=Release']
        });
    });

    it('handles continuation lines for key-value maps', () => {
        const result = parseExtraArgs([
            'asan: -DCMAKE_CXX_FLAGS=-fsanitize=address',
            '  -DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address',
            'tsan: -DCMAKE_CXX_FLAGS=-fsanitize=thread'
        ]);
        expect(result).toEqual({
            asan: ['-DCMAKE_CXX_FLAGS=-fsanitize=address', '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address'],
            tsan: ['-DCMAKE_CXX_FLAGS=-fsanitize=thread']
        });
    });

    it('handles quoted keys in key-value pairs', () => {
        const result = parseExtraArgs(['"my key": -DFOO=bar']);
        expect(result).toEqual({ 'my key': ['-DFOO=bar'] });
    });

    it('treats lines with spaces in key as non-key-value', () => {
        // A line like "-D FOO=bar" has a space in the "key" part before the colon
        // so it won't parse as key-value and falls back to flat args
        const result = parseExtraArgs(['-D FOO=bar']);
        expect(Array.isArray(result)).toBe(true);
    });

    it('treats first line with spaces in unquoted key as flat args', () => {
        // "space key: value" has a colon but the key contains spaces and is not quoted
        const result = parseExtraArgs(['space key: -DFOO=bar']);
        expect(Array.isArray(result)).toBe(true);
    });

    it('treats continuation line with space-key as continuation of previous key', () => {
        // First line is valid key-value, second has spaces in key before colon
        const result = parseExtraArgs([
            'valid: -DFOO=bar',
            'space key: -DBAR=baz'
        ]);
        // "space key: -DBAR=baz" fails getLineKeyValue (space in key),
        // so it becomes a continuation of 'valid', then parseBashArguments splits it
        expect(result).toEqual({
            valid: ['-DFOO=bar', 'space', 'key:', '-DBAR=baz']
        });
    });
});

// =====================================================
// makeFactorPath
// =====================================================
describe('makeFactorPath', () => {
    it('returns base path when suffix is empty', () => {
        expect(makeFactorPath('/build', '')).toBe('/build');
    });

    it('appends suffix to base path', () => {
        expect(makeFactorPath('/build', '-asan-cxx20')).toBe('/build-asan-cxx20');
    });
});

// =====================================================
// expandInputs
// =====================================================

/**
 * Creates minimal Inputs for expandInputs tests.
 *
 * @param overrides - Fields to override
 * @returns Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        preset: '',
        buildType: 'Release',
        buildDir: 'build',
        cmakePath: 'cmake',
        generator: 'Ninja',
        generatorToolset: '',
        generatorArchitecture: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        cxxstd: ['17'],
        exportCompileCommands: undefined,
        runTests: undefined,
        configureTestsFlag: '',
        ctestTimeout: undefined,
        shared: undefined,
        toolchain: '',
        sourceDir: '/src',
        installPrefix: 'install',
        packageDir: '',
        packageName: '',
        packageVendor: '',
        packageGenerators: [],
        extraArgs: [],
        cmakeVersion: '',
        url: '',
        gitRepository: '',
        gitTag: '',
        downloadDir: '',
        patches: [],
        arch: '',
        buildTarget: [],
        jobs: 4,
        testAllCxxstd: false,
        install: undefined,
        installAllCxxstd: false,
        package: undefined,
        packageAllCxxstd: false,
        packageArtifact: undefined,
        packageRetentionDays: 10,
        createAnnotations: undefined,
        refSourceDir: '',
        traceCommands: false,
        ...overrides
    };
}

describe('expandInputs', () => {
    it('produces single entry for one cxxstd and array extraArgs', () => {
        const inputs = makeInputs({ cxxstd: ['17'], extraArgs: ['-DFOO=1'] });
        const result = expandInputs(inputs);
        expect(result).toHaveLength(1);
        expect(result[0].cxxstd).toBe('17');
        expect(result[0].extraArgs).toEqual(['-DFOO=1']);
        expect(result[0].is_main_entry).toBe(true);
    });

    it('produces multiple entries for multiple cxxstd values', () => {
        const inputs = makeInputs({ cxxstd: ['17', '20', '23'] });
        const result = expandInputs(inputs);
        expect(result).toHaveLength(3);
        expect(result[0].cxxstd).toBe('17');
        expect(result[0].is_main_entry).toBe(true);
        expect(result[1].cxxstd).toBe('20');
        expect(result[1].is_main_entry).toBe(false);
        expect(result[2].cxxstd).toBe('23');
        expect(result[2].is_main_entry).toBe(false);
    });

    it('produces cross product when extraArgs is a map', () => {
        const inputs = makeInputs({
            cxxstd: ['17', '20'],
            extraArgs: { debug: ['-DCMAKE_BUILD_TYPE=Debug'], release: ['-DCMAKE_BUILD_TYPE=Release'] } as unknown as string[]
        });
        const result = expandInputs(inputs);
        // 2 keys × 2 cxxstd = 4 entries
        expect(result).toHaveLength(4);
        expect(result[0].extra_args_key).toBe('debug');
        expect(result[0].cxxstd).toBe('17');
        expect(result[0].is_main_entry).toBe(true);
    });

    it('applies factor suffixes to build and install dirs', () => {
        const inputs = makeInputs({ cxxstd: ['17', '20'], buildDir: 'build', installPrefix: 'install' });
        const result = expandInputs(inputs);
        expect(result[0].buildDir).toBe('build');
        expect(result[1].buildDir).toBe('build-cxx20');
        expect(result[0].installPrefix).toBe('install');
        expect(result[1].installPrefix).toBe('install-cxx20');
    });

    it('handles null cxxstd entries', () => {
        const inputs = makeInputs({ cxxstd: [null] });
        const result = expandInputs(inputs);
        expect(result).toHaveLength(1);
        expect(result[0].cxxstd).toBeNull();
        expect(result[0].is_main_entry).toBe(true);
    });
});

// =====================================================
// validateUniquePaths
// =====================================================
describe('validateUniquePaths', () => {
    it('does not throw when all build dirs are unique', () => {
        const entries: ResolvedInputs[] = [
            { buildDir: '/build' } as ResolvedInputs,
            { buildDir: '/build-cxx20' } as ResolvedInputs,
        ];
        expect(() => validateUniquePaths(entries)).not.toThrow();
    });

    it('throws when duplicate build dirs are found', () => {
        const entries: ResolvedInputs[] = [
            { buildDir: '/build', cxxstd: '17' } as ResolvedInputs,
            { buildDir: '/build', cxxstd: '20' } as ResolvedInputs,
        ];
        expect(() => validateUniquePaths(entries)).toThrow('Duplicate build directory');
    });

    it('includes extra_args_key in error message when set', () => {
        const entries: ResolvedInputs[] = [
            { buildDir: '/build', extra_args_key: 'asan', cxxstd: '17' } as ResolvedInputs,
            { buildDir: '/build', extra_args_key: 'asan', cxxstd: '20' } as ResolvedInputs,
        ];
        expect(() => validateUniquePaths(entries)).toThrow('extra_args_key="asan"');
    });
});

// =====================================================
// applyPresetMacros
// =====================================================
describe('applyPresetMacros', () => {
    const baseInputs = makeInputs({
        sourceDir: '/home/user/project',
        preset: 'my-preset',
        generator: 'Ninja'
    });

    it('expands ${sourceDir} macro in strings', () => {
        expect(applyPresetMacros('${sourceDir}/build', baseInputs)).toBe('/home/user/project/build');
    });

    it('expands ${sourceParentDir} macro', () => {
        expect(applyPresetMacros('${sourceParentDir}/output', baseInputs)).toBe('/home/user/output');
    });

    it('expands ${sourceDirName} macro', () => {
        expect(applyPresetMacros('${sourceDirName}-build', baseInputs)).toBe('project-build');
    });

    it('expands ${presetName} macro', () => {
        expect(applyPresetMacros('${presetName}-config', baseInputs)).toBe('my-preset-config');
    });

    it('expands ${generator} macro', () => {
        expect(applyPresetMacros('${generator}', baseInputs)).toBe('Ninja');
    });

    it('expands ${hostSystemName} macro', () => {
        const result = applyPresetMacros('${hostSystemName}', baseInputs);
        expect(['Linux', 'Windows', 'Darwin']).toContain(result);
    });

    it('expands ${dollar} macro', () => {
        expect(applyPresetMacros('${dollar}{FOO}', baseInputs)).toBe('${FOO}');
    });

    it('expands ${pathListSep} macro', () => {
        const result = applyPresetMacros('a${pathListSep}b', baseInputs);
        expect(result === 'a:b' || result === 'a;b').toBe(true);
    });

    it('expands $env{} macros from environment', () => {
        const oldVal = process.env['TEST_MACRO_VAR'];
        process.env['TEST_MACRO_VAR'] = 'hello';
        expect(applyPresetMacros('$env{TEST_MACRO_VAR}', baseInputs)).toBe('hello');
        if (oldVal === undefined) {
            delete process.env['TEST_MACRO_VAR'];
        } else {
            process.env['TEST_MACRO_VAR'] = oldVal;
        }
    });

    it('expands $penv{} macros from environment', () => {
        const oldVal = process.env['TEST_PENV_VAR'];
        process.env['TEST_PENV_VAR'] = 'world';
        expect(applyPresetMacros('$penv{TEST_PENV_VAR}', baseInputs)).toBe('world');
        if (oldVal === undefined) {
            delete process.env['TEST_PENV_VAR'];
        } else {
            process.env['TEST_PENV_VAR'] = oldVal;
        }
    });

    it('processes arrays recursively', () => {
        const result = applyPresetMacros(['${sourceDir}', '${presetName}'], baseInputs);
        expect(result).toEqual(['/home/user/project', 'my-preset']);
    });

    it('processes objects recursively', () => {
        const result = applyPresetMacros({ dir: '${sourceDir}', name: '${presetName}' }, baseInputs);
        expect(result).toEqual({ dir: '/home/user/project', name: 'my-preset' });
    });

    it('returns non-string/array/object values unchanged', () => {
        expect(applyPresetMacros(42, baseInputs)).toBe(42);
        expect(applyPresetMacros(true, baseInputs)).toBe(true);
        expect(applyPresetMacros(null, baseInputs)).toBeNull();
    });
});
