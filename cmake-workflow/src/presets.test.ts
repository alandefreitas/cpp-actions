import * as core from '@actions/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import {
    readAndValidatePresetFile,
    mergeCMakePresetObject,
    mergeCMakeConfigurePresetObject,
    cacheVariableValueToArgsString,
    makeCacheVariablesArgsArray,
    resolvePreset
} from './presets';
import { type SetupCMakeOutputs } from './types';

// Inline type to avoid importing schema.ts which pulls in setup-program
// and its heavy fs-dependent transitive deps that conflict with jest.mock('fs')
type Inputs = Parameters<typeof resolvePreset>[0];

jest.mock('@actions/core', () => ({
    info: jest.fn(), debug: jest.fn(), warning: jest.fn(), error: jest.fn(),
    setFailed: jest.fn(), startGroup: jest.fn(), endGroup: jest.fn(),
    getInput: jest.fn(), getBooleanInput: jest.fn(), getMultilineInput: jest.fn(), setOutput: jest.fn()
}));

jest.mock('trace-commands', () => ({ log: jest.fn(), scoped: jest.fn(() => jest.fn()) }));
jest.mock('setup-program', () => ({ normalizeArchitectureInput: jest.fn((v: string) => v) }));
jest.mock('@actions/exec', () => ({ exec: jest.fn(), getExecOutput: jest.fn() }));

const mockedCore = core as jest.Mocked<typeof core>;
const mockedTrace = traceCommands as jest.Mocked<typeof traceCommands>;
let tmpDir: string;

beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-test-')); });
afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
afterEach(() => { jest.clearAllMocks(); });

describe('readAndValidatePresetFile', () => {
    it('returns not found when file does not exist', () => {
        const r = readAndValidatePresetFile(path.join(tmpDir, 'x.json'), 6);
        expect(r.exists).toBe(false);
        expect(mockedCore.info).toHaveBeenCalled();
    });

    it('returns not found when path is a directory', () => {
        const r = readAndValidatePresetFile(tmpDir, 6);
        expect(r.exists).toBe(false);
    });

    it('returns not supported for invalid JSON', () => {
        const f = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(f, '{{{');
        const r = readAndValidatePresetFile(f, 6);
        expect(r.exists).toBe(true);
        expect(r.supported).toBe(false);
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
        fs.unlinkSync(f);
    });

    it('returns not supported when no version field', () => {
        const f = path.join(tmpDir, 'nv.json');
        fs.writeFileSync(f, JSON.stringify({ a: 1 }));
        const r = readAndValidatePresetFile(f, 6);
        expect(r.supported).toBe(false);
        fs.unlinkSync(f);
    });

    it('returns not supported when version is not a number', () => {
        const f = path.join(tmpDir, 'sv.json');
        fs.writeFileSync(f, JSON.stringify({ version: 'x' }));
        const r = readAndValidatePresetFile(f, 6);
        expect(r.supported).toBe(false);
        fs.unlinkSync(f);
    });

    it('returns not supported when version exceeds maximum', () => {
        const f = path.join(tmpDir, 'hv.json');
        fs.writeFileSync(f, JSON.stringify({ version: 10 }));
        const r = readAndValidatePresetFile(f, 6);
        expect(r.supported).toBe(false);
        fs.unlinkSync(f);
    });

    it('returns supported for valid preset file', () => {
        const f = path.join(tmpDir, 'ok.json');
        fs.writeFileSync(f, JSON.stringify({ version: 3 }));
        const r = readAndValidatePresetFile(f, 6);
        expect(r.exists).toBe(true);
        expect(r.supported).toBe(true);
        fs.unlinkSync(f);
    });
});

describe('mergeCMakePresetObject', () => {
    it('returns base when user is undefined', () => {
        expect(mergeCMakePresetObject({ v: 3 }, undefined)).toEqual({ v: 3 });
    });

    it('adds new keys from user', () => {
        expect(mergeCMakePresetObject({ v: 3 }, { x: 1 })).toEqual({ v: 3, x: 1 });
    });

    it('takes max for numbers', () => {
        expect(mergeCMakePresetObject({ v: 3 }, { v: 5 }).v).toBe(5);
    });

    it('concatenates arrays', () => {
        expect(mergeCMakePresetObject({ a: [1] }, { a: [2] }).a).toEqual([1, 2]);
    });

    it('recursively merges objects', () => {
        expect(mergeCMakePresetObject({ o: { a: 1 } }, { o: { b: 2 } }).o).toEqual({ a: 1, b: 2 });
    });

    it('overrides primitives with user value', () => {
        expect(mergeCMakePresetObject({ n: 'a' }, { n: 'b' }).n).toBe('b');
    });

    it('uses base when user value is undefined', () => {
        expect(mergeCMakePresetObject({ n: 'a' }, { n: undefined }).n).toBe('a');
    });
});

describe('mergeCMakeConfigurePresetObject', () => {
    it('returns preset when base is undefined', () => {
        expect(mergeCMakeConfigurePresetObject({ n: 'test' }, undefined)).toEqual({ n: 'test' });
    });

    it('does not inherit hidden field', () => {
        const m = mergeCMakeConfigurePresetObject({ n: 'test' }, { hidden: true, g: 'Ninja' });
        expect(m).not.toHaveProperty('hidden');
        expect(m.g).toBe('Ninja');
    });

    it('inherits fields not in preset', () => {
        const m = mergeCMakeConfigurePresetObject({ n: 'test' }, { g: 'Ninja', d: '/b' });
        expect(m.g).toBe('Ninja');
        expect(m.d).toBe('/b');
    });

    it('concatenates array+array', () => {
        expect(mergeCMakeConfigurePresetObject({ n: 't', a: ['A'] }, { a: ['B'] }).a).toEqual(['A', 'B']);
    });

    it('concatenates array+string', () => {
        expect(mergeCMakeConfigurePresetObject({ n: 't', a: ['a'] }, { a: 'b' }).a).toEqual(['a', 'b']);
    });

    it('concatenates string+array', () => {
        expect(mergeCMakeConfigurePresetObject({ n: 't', a: 'a' }, { a: ['b'] }).a).toEqual(['a', 'b']);
    });

    it('merges objects giving priority to preset', () => {
        const m = mergeCMakeConfigurePresetObject({ n: 't', o: { a: '1', b: '2' } }, { o: { b: '3', c: '4' } });
        expect(m.o).toEqual({ a: '1', b: '2', c: '4' });
    });

    it('keeps preset value for primitives', () => {
        expect(mergeCMakeConfigurePresetObject({ n: 't', g: 'Ninja' }, { g: 'Make' }).g).toBe('Ninja');
    });
});

describe('cacheVariableValueToArgsString', () => {
    it('converts booleans', () => {
        expect(cacheVariableValueToArgsString(true)).toBe('TRUE');
        expect(cacheVariableValueToArgsString(false)).toBe('FALSE');
    });

    it('returns strings as-is', () => {
        expect(cacheVariableValueToArgsString('/usr/local')).toBe('/usr/local');
    });

    it('handles typed objects', () => {
        expect(cacheVariableValueToArgsString({ type: 'F', value: '/g' })).toBe('/g');
        expect(cacheVariableValueToArgsString({ type: 'B', value: true })).toBe('TRUE');
    });

    it('returns undefined for invalid inputs', () => {
        expect(cacheVariableValueToArgsString({ type: 'S' })).toBeUndefined();
        expect(cacheVariableValueToArgsString(null)).toBeUndefined();
        expect(cacheVariableValueToArgsString(42)).toBeUndefined();
    });
});

describe('makeCacheVariablesArgsArray', () => {
    it('generates -D args and skips invalid', () => {
        expect(makeCacheVariablesArgsArray({})).toEqual([]);
        expect(makeCacheVariablesArgsArray({ A: 'R', B: true })).toEqual(['-D', 'A=R', '-D', 'B=TRUE']);
        expect(makeCacheVariablesArgsArray({ V: 'y', I: 42 })).toEqual(['-D', 'V=y']);
    });
});

/**
 * Creates a minimal Inputs object for preset tests.
 *
 * @param overrides - Partial overrides for default inputs
 * @returns Inputs object with sensible defaults
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        cmakePath: 'cmake', cmakeVersion: '*', sourceDir: tmpDir, url: '', gitRepository: '',
        gitTag: '', downloadDir: '', patches: [], buildDir: 'build', preset: '', cc: '', ccflags: '',
        cxx: '', cxxflags: '', cxxstd: [], shared: undefined, toolchain: '', generator: '',
        generatorToolset: '', generatorArchitecture: '', arch: '', buildType: 'Release',
        buildTarget: [], extraArgs: [], exportCompileCommands: undefined, jobs: 4,
        runTests: undefined, configureTestsFlag: 'BUILD_TESTING', ctestTimeout: undefined,
        install: undefined, installPrefix: '', package: undefined, packageName: '', packageDir: '',
        packageVendor: '', packageGenerators: [], packageArtifact: undefined, packageRetentionDays: 10,
        createAnnotations: true, refSourceDir: tmpDir, traceCommands: false,
        packageAllCxxstd: false, testAllCxxstd: false, installAllCxxstd: false,
        ...overrides
    } as Inputs;
}

/**
 * Creates a minimal SetupCMakeOutputs object.
 *
 * @param overrides - Partial overrides
 * @returns SetupCMakeOutputs with sensible defaults
 */
function makeSetupOutputs(overrides: Partial<SetupCMakeOutputs> = {}): SetupCMakeOutputs {
    return { path: '/usr/bin/cmake', dir: '/usr/bin', supportedPresetsVersion: 6, ...overrides };
}

/**
 * Writes a CMakePresets.json in tmpDir.
 *
 * @param content - JSON object to serialize
 */
function writePresetFile(content: Record<string, unknown>): void {
    fs.writeFileSync(path.join(tmpDir, 'CMakePresets.json'), JSON.stringify(content));
}

/**
 * Writes a CMakeUserPresets.json in tmpDir.
 *
 * @param content - JSON object to serialize
 */
function writeUserPresetFile(content: Record<string, unknown>): void {
    fs.writeFileSync(path.join(tmpDir, 'CMakeUserPresets.json'), JSON.stringify(content));
}

/**
 * Removes preset files from tmpDir.
 */
function cleanPresetFiles(): void {
    try { fs.unlinkSync(path.join(tmpDir, 'CMakePresets.json')); } catch { /* ignore */ }
    try { fs.unlinkSync(path.join(tmpDir, 'CMakeUserPresets.json')); } catch { /* ignore */ }
}

describe('resolvePreset', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        cleanPresetFiles();
        process.env = { ...originalEnv };
    });

    it('returns immediately when inputs.preset is empty', () => {
        const inputs = makeInputs({ preset: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(mockedCore.info).not.toHaveBeenCalled();
    });

    it('returns early when both preset files are supported', () => {
        writePresetFile({ version: 3, configurePresets: [] });
        const inputs = makeInputs({ preset: 'default' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.preset).toBe('default');
    });

    it('returns early when main preset does not exist', () => {
        const inputs = makeInputs({ preset: 'default' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('applies preset manually when version is unsupported', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', generator: 'Ninja', binaryDir: '/build/out' }]
        });
        const inputs = makeInputs({ preset: 'default', generator: '', buildDir: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.preset).toBe('');
        expect(inputs.generator).toBe('Ninja');
        expect(inputs.buildDir).toBe('/build/out');
    });

    it('returns when preset name not found', () => {
        writePresetFile({ version: 10, configurePresets: [{ name: 'other' }] });
        const inputs = makeInputs({ preset: 'missing' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('returns when inherits field is invalid', () => {
        writePresetFile({ version: 10, configurePresets: [{ name: 'default', inherits: 123 }] });
        const inputs = makeInputs({ preset: 'default' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('invalid inherits'));
    });

    it('converts string inherits to array and resolves', () => {
        writePresetFile({
            version: 10,
            configurePresets: [
                { name: 'default', inherits: 'base' },
                { name: 'base', generator: 'Ninja' }
            ]
        });
        const inputs = makeInputs({ preset: 'default', generator: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Ninja');
    });

    it('resolves multi-level inheritance', () => {
        writePresetFile({
            version: 10,
            configurePresets: [
                { name: 'default', inherits: ['mid'], generator: 'Ninja' },
                { name: 'mid', inherits: ['base'], binaryDir: '/mid' },
                { name: 'base', toolchainFile: '/tc.cmake' }
            ]
        });
        const inputs = makeInputs({ preset: 'default', generator: '', buildDir: '', toolchain: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Ninja');
        expect(inputs.buildDir).toBe('/mid');
        expect(inputs.toolchain).toBe('/tc.cmake');
    });

    it('handles circular inheritance gracefully', () => {
        writePresetFile({
            version: 10,
            configurePresets: [
                { name: 'a', inherits: ['b'], generator: 'Ninja' },
                { name: 'b', inherits: ['a'] }
            ]
        });
        const inputs = makeInputs({ preset: 'a', generator: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Ninja');
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('already inherited'));
    });

    it('logs when inherited preset not found', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', inherits: ['nonexistent'] }]
        });
        const inputs = makeInputs({ preset: 'default' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(mockedTrace.log).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('applies cacheVariables as extra args', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default',
                cacheVariables: { CMAKE_BUILD_TYPE: 'Release', BUILD_SHARED_LIBS: true }
            }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('-D');
        expect(inputs.extraArgs).toContain('CMAKE_BUILD_TYPE=Release');
        expect(inputs.extraArgs).toContain('BUILD_SHARED_LIBS=TRUE');
    });

    it('applies environment variables and skips null', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default',
                environment: { PRESETS_TEST_VAR: 'hello', NULL_VAR: null }
            }]
        });
        const inputs = makeInputs({ preset: 'default' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(process.env['PRESETS_TEST_VAR']).toBe('hello');
    });

    it('applies warnings flags', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default',
                warnings: { dev: true, deprecated: false, uninitialized: true, unusedCli: false, systemVars: true }
            }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('-Wdev');
        expect(inputs.extraArgs).toContain('-Wno-deprecated');
        expect(inputs.extraArgs).toContain('--warn-uninitialized');
        expect(inputs.extraArgs).toContain('--no-warn-unused-cli');
        expect(inputs.extraArgs).toContain('--check-system-vars');
    });

    it('applies inverted warnings flags', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default',
                warnings: { dev: false, deprecated: true, uninitialized: false, unusedCli: true, systemVars: false }
            }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('-Wno-dev');
        expect(inputs.extraArgs).toContain('-Wdeprecated');
        expect(inputs.extraArgs).not.toContain('--warn-uninitialized');
        expect(inputs.extraArgs).not.toContain('--no-warn-unused-cli');
        expect(inputs.extraArgs).not.toContain('--check-system-vars');
    });

    it('skips non-boolean warning values', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', warnings: { dev: 'yes' } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toHaveLength(0);
    });

    it('applies errors flags', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', errors: { dev: true, deprecated: false } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('-Werror=dev');
        expect(inputs.extraArgs).toContain('-Wno-error=deprecated');
    });

    it('applies inverted errors flags', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', errors: { dev: false, deprecated: true } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('-Wno-error=dev');
        expect(inputs.extraArgs).toContain('-Werror=deprecated');
    });

    it('skips non-boolean error values', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', errors: { dev: 'yes' } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toHaveLength(0);
    });

    it('applies debug flags', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', debug: { output: true, tryCompile: true, find: true } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('--debug-output');
        expect(inputs.extraArgs).toContain('--debug-trycompile');
        expect(inputs.extraArgs).toContain('--debug-find');
    });

    it('does not add debug flags when false', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', debug: { output: false, tryCompile: false, find: false } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toHaveLength(0);
    });

    it('skips non-boolean debug values', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', debug: { output: 'yes' } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toHaveLength(0);
    });

    it('applies trace output on and expand', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', trace: { output: 'on' } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('--trace');

        cleanPresetFiles();
        jest.clearAllMocks();

        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', trace: { output: 'expand' } }]
        });
        const inputs2 = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs2, makeSetupOutputs());
        expect(inputs2.extraArgs).toContain('--trace-expand');
    });

    it('applies trace format, source array, source string, and redirect', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default',
                trace: { format: 'json-v1', source: ['a.cmake', 'b.cmake'], redirect: 'trace.log' }
            }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('--trace-format=json-v1');
        expect(inputs.extraArgs).toContain('--trace-source="a.cmake"');
        expect(inputs.extraArgs).toContain('--trace-source="b.cmake"');
        expect(inputs.extraArgs).toContain('--trace-redirect="trace.log"');
    });

    it('applies trace source as string', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', trace: { source: 'CMakeLists.txt' } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toContain('--trace-source="CMakeLists.txt"');
    });

    it('skips trace keys with wrong types', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', trace: { output: 123, format: 123, source: 123, redirect: 123 } }]
        });
        const inputs = makeInputs({ preset: 'default', extraArgs: [] });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.extraArgs).toHaveLength(0);
    });

    it('applies toolset, architecture, installDir, cmakeExecutable from preset', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{
                name: 'default', toolset: 'v143', architecture: 'x64',
                installDir: '/opt/install', cmakeExecutable: '/custom/cmake'
            }]
        });
        const inputs = makeInputs({
            preset: 'default', generatorToolset: '', generatorArchitecture: '',
            installPrefix: '', cmakePath: ''
        });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generatorToolset).toBe('v143');
        expect(inputs.generatorArchitecture).toBe('x64');
        expect(inputs.installPrefix).toBe('/opt/install');
        expect(inputs.cmakePath).toBe('/custom/cmake');
    });

    it('does not override user inputs with preset values', () => {
        writePresetFile({
            version: 10,
            configurePresets: [{ name: 'default', generator: 'Ninja', binaryDir: '/preset/build' }]
        });
        const inputs = makeInputs({ preset: 'default', generator: 'Unix Makefiles', buildDir: '/my/build' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Unix Makefiles');
        expect(inputs.buildDir).toBe('/my/build');
    });

    it('merges user preset with main preset when user exists but unsupported', () => {
        writePresetFile({ version: 10, configurePresets: [{ name: 'default', generator: 'Ninja' }] });
        writeUserPresetFile({ version: 10, configurePresets: [{ name: 'extra' }] });
        const inputs = makeInputs({ preset: 'default', generator: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Ninja');
    });

    it('applies preset when main supported but user unsupported', () => {
        writePresetFile({ version: 3, configurePresets: [{ name: 'default', generator: 'Ninja' }] });
        writeUserPresetFile({ version: 10, configurePresets: [] });
        const inputs = makeInputs({ preset: 'default', generator: '' });
        resolvePreset(inputs, makeSetupOutputs());
        expect(inputs.generator).toBe('Ninja');
        expect(inputs.preset).toBe('');
    });
});
