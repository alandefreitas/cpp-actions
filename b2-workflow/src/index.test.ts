// Mocks core logging hooks; the tests assert argument wiring, not logging side effects.
jest.mock('@actions/core', () => ({
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    info: jest.fn(),
    setFailed: jest.fn()
}));

// Stubs exec so we can inspect the arguments passed to B2 without running it.
jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

// Resolve tool lookups deterministically for user-config.jam preparation.
jest.mock('@actions/io', () => ({
    which: jest.fn(async (tool: string) => `/usr/bin/${tool}`)
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as exec from '@actions/exec';
import { main } from './index';
import { describePrettyErrors } from 'pretty-errors/test-helper';

interface InputOverrides {
    modules?: string[];
    moduleTarget?: string[];
    arch?: string;
    [key: string]: unknown;
}

// Helper to build the minimum set of inputs (matching Inputs schema shape)
// that exercise the module targeting logic without touching the filesystem.
function createInputs(overrides: InputOverrides = {}) {
    return {
        sourceDir: '/tmp/boost',
        buildDir: '',
        cxx: '',
        ccflags: '',
        cxxflags: '',
        cxxstd: '',
        shared: undefined as boolean | undefined,
        toolset: '',
        arch: '',
        buildVariant: '',
        buildType: '',
        modules: ['filesystem'],
        moduleTarget: ['test'],
        extraArgs: [] as string[],
        warningsAsErrors: '',
        addressModel: '',
        asan: '',
        ubsan: '',
        msan: '',
        tsan: '',
        coverage: '',
        linkflags: '',
        threading: '',
        rtti: '',
        clean: false,
        cleanAll: false,
        abbreviatePaths: true,
        hash: false,
        rebuildAll: false,
        dryRun: false,
        stopOnError: false,
        config: '',
        siteConfig: '',
        userConfig: '',
        projectConfig: '',
        debugConfiguration: undefined as boolean | undefined,
        debugBuilding: undefined as boolean | undefined,
        debugGenerators: undefined as boolean | undefined,
        include: '',
        define: '',
        runtimeLink: '',
        jobs: 2,
        traceCommands: false,
        ...overrides
    };
}

beforeEach(() => {
    (exec.getExecOutput as jest.Mock).mockReset();
    (exec.getExecOutput as jest.Mock).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

// Ensures the default maps modules to libs/<module>/test when module-target is omitted.
test('uses default module target when none is specified', async () => {
    const inputs = createInputs();
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
});

// Setting a single module-target should replace the suffix for every module.
test('supports overriding the module target suffix', async () => {
    const inputs = createInputs({ moduleTarget: ['example'] });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/example');
});

// When the modules array already specifies a path, the action leaves it untouched.
test('passes through explicit module paths untouched', async () => {
    const inputs = createInputs({
        modules: ['libs/math/example'],
        moduleTarget: ['example']
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/math/example');
});

// Multiple targets should be broadcast to every module.
test('applies per-module targets when multiple values are provided', async () => {
    const inputs = createInputs({
        modules: ['filesystem', 'chrono'],
        moduleTarget: ['test', 'example']
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
    expect(buildArgs).toContain('libs/filesystem/example');
    expect(buildArgs).toContain('libs/chrono/test');
    expect(buildArgs).toContain('libs/chrono/example');
});

// Multiple targets for a single module should all appear in the B2 arguments.
test('broadcasts all targets to a single module', async () => {
    const inputs = createInputs({
        modules: ['beast2'],
        moduleTarget: ['test', 'example']
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/beast2/test');
    expect(buildArgs).toContain('libs/beast2/example');
});

test('derives address model and architecture from arch input when unspecified', async () => {
    const inputs = createInputs({
        arch: 'arm64'
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('address-model=64');
    expect(buildArgs).toContain('architecture=arm');
});

// ==========================================
// createUserConfig tests
// ==========================================

test('creates user-config.jam when cxx and toolset are set (basename cxx)', async () => {
    const fs = require('fs');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const inputs = createInputs({ cxx: 'g++', toolset: 'gcc-13' });
    await main(inputs);
    expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('user-config.jam'),
        expect.stringContaining('using gcc : : "/usr/bin/g++" ;')
    );
    writeSpy.mockRestore();
});

test('creates user-config.jam with full path cxx (no which lookup)', async () => {
    const fs = require('fs');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const inputs = createInputs({ cxx: '/opt/gcc/bin/g++', toolset: 'gcc' });
    await main(inputs);
    expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('user-config.jam'),
        expect.stringContaining('using gcc : : "/opt/gcc/bin/g++" ;')
    );
    writeSpy.mockRestore();
});

test('skips user-config.jam when userConfig is set', async () => {
    const fs = require('fs');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const inputs = createInputs({ cxx: 'g++', toolset: 'gcc', userConfig: '/custom/config.jam' });
    await main(inputs);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
});

test('skips user-config.jam when toolset is clang-win', async () => {
    const fs = require('fs');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const inputs = createInputs({ cxx: 'clang-cl', toolset: 'clang-win' });
    await main(inputs);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
});

test('handles io.which failure gracefully in createUserConfig', async () => {
    const io = require('@actions/io');
    const fs = require('fs');
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    (io.which as jest.Mock).mockRejectedValueOnce(new Error('not found'));
    const inputs = createInputs({ cxx: 'nonexistent-compiler', toolset: 'gcc' });
    await main(inputs);
    // Should still write user-config.jam with the original cxx name
    expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining('user-config.jam'),
        expect.stringContaining('nonexistent-compiler')
    );
    writeSpy.mockRestore();
});

// ==========================================
// Error path tests
// ==========================================

test('throws when B2 bootstrap fails', async () => {
    (exec.getExecOutput as jest.Mock)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'bootstrap failed' });
    const inputs = createInputs();
    await expect(main(inputs)).rejects.toThrow('B2 bootstrap failed with exit code 1');
});

test('throws when B2 headers fails', async () => {
    (exec.getExecOutput as jest.Mock)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // bootstrap
        .mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: '' }); // headers
    const inputs = createInputs();
    await expect(main(inputs)).rejects.toThrow('B2 headers failed with exit code 2');
});

test('throws when B2 build fails', async () => {
    (exec.getExecOutput as jest.Mock)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // bootstrap
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })  // headers
        .mockResolvedValueOnce({ exitCode: 3, stdout: '', stderr: '' }); // build
    const inputs = createInputs();
    await expect(main(inputs)).rejects.toThrow('B2 build failed with exit code 3');
});

// ==========================================
// buildBasicArgs tests
// ==========================================

test('includes buildDir when specified', async () => {
    const inputs = createInputs({ buildDir: '/tmp/build' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--build-dir=/tmp/build');
});

test('includes toolset when specified', async () => {
    const fs = require('fs');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const inputs = createInputs({ toolset: 'gcc-13', cxx: 'g++' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--toolset=gcc-13');
    jest.restoreAllMocks();
});

test('includes cxxstd when specified', async () => {
    const inputs = createInputs({ cxxstd: '14,17,20' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('cxxstd=14,17,20');
});

test('maps relwithdebinfo to variant=release with debug-symbols=on', async () => {
    const inputs = createInputs({ buildType: 'relwithdebinfo' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('variant=release');
    expect(buildArgs).toContain('debug-symbols=on');
});

test('maps other build types to variant directly', async () => {
    const inputs = createInputs({ buildType: 'debug' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('variant=debug');
});

test('includes extra args when specified', async () => {
    const inputs = createInputs({ extraArgs: ['--verbose', '-d2'] });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--verbose');
    expect(buildArgs).toContain('-d2');
});

// ==========================================
// buildFlagArgs tests
// ==========================================

test('includes cxxflags when specified', async () => {
    const inputs = createInputs({ cxxflags: '-Wall -Wextra' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('cxxflags=-Wall -Wextra');
});

test('includes ccflags when specified', async () => {
    const inputs = createInputs({ ccflags: '-O2' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('cflags=-O2');
});

test('includes linkflags when specified', async () => {
    const inputs = createInputs({ linkflags: '-lstdc++' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('linkflags=-lstdc++');
});

// ==========================================
// buildB2SpecificArgs tests
// ==========================================

test('includes threading when specified', async () => {
    const inputs = createInputs({ threading: 'multi' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('threading=multi');
});

test('includes link=shared when shared is true', async () => {
    const inputs = createInputs({ shared: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('link=shared');
});

test('includes link=static when shared is false', async () => {
    const inputs = createInputs({ shared: false });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('link=static');
});

test('handles boolOrString option with true value', async () => {
    const inputs = createInputs({ warningsAsErrors: 'true' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('warnings-as-errors=on');
});

test('handles boolOrString option with false value (with falseValue)', async () => {
    const inputs = createInputs({ warningsAsErrors: 'false' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('warnings-as-errors=off');
});

test('handles boolOrString option with custom string value', async () => {
    const inputs = createInputs({ warningsAsErrors: 'custom-val' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('warnings-as-errors=custom-val');
});

test('handles sanitizer option with true value (no falseValue)', async () => {
    const inputs = createInputs({ asan: 'true' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('address-sanitizer=norecover');
});

test('handles sanitizer option with false value (no falseValue - omitted)', async () => {
    const inputs = createInputs({ asan: 'false' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).not.toContain(expect.stringContaining('address-sanitizer'));
});

test('handles rtti option', async () => {
    const inputs = createInputs({ rtti: 'on' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('rtti=on');
});

test('handles runtimeLink option with true', async () => {
    const inputs = createInputs({ runtimeLink: 'true' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('runtime-link=shared');
});

test('handles runtimeLink option with false', async () => {
    const inputs = createInputs({ runtimeLink: 'false' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('runtime-link=static');
});

test('includes coverage=on when coverage is set', async () => {
    const inputs = createInputs({ coverage: 'true' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('coverage=on');
});

test('includes embed-manifest-via=linker for clang-win toolset', async () => {
    const inputs = createInputs({ toolset: 'clang-win' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('embed-manifest-via=linker');
});

test('includes --clean-all when cleanAll is true', async () => {
    const inputs = createInputs({ cleanAll: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--clean-all');
});

test('includes --clean when clean is true (and cleanAll is false)', async () => {
    const inputs = createInputs({ clean: true, cleanAll: false });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--clean');
    expect(buildArgs).not.toContain('--clean-all');
});

test('uses --hash when abbreviatePaths is false and hash is true', async () => {
    const inputs = createInputs({ abbreviatePaths: false, hash: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--hash');
    expect(buildArgs).not.toContain('--abbreviate-paths');
});

test('includes -a for rebuildAll', async () => {
    const inputs = createInputs({ rebuildAll: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('-a');
});

test('includes -n for dryRun', async () => {
    const inputs = createInputs({ dryRun: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('-n');
});

test('includes -q for stopOnError', async () => {
    const inputs = createInputs({ stopOnError: true });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('-q');
});

test('includes config options when specified', async () => {
    const inputs = createInputs({
        config: '/path/to/config.jam',
        siteConfig: '/path/to/site.jam',
        projectConfig: '/path/to/project.jam'
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--config=/path/to/config.jam');
    expect(buildArgs).toContain('--site-config=/path/to/site.jam');
    expect(buildArgs).toContain('--project-config=/path/to/project.jam');
});

test('includes debug flags when enabled', async () => {
    const inputs = createInputs({
        debugConfiguration: true,
        debugBuilding: true,
        debugGenerators: true
    });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--debug-configuration');
    expect(buildArgs).toContain('--debug-building');
    expect(buildArgs).toContain('--debug-generators');
});

test('includes include and define when specified', async () => {
    const inputs = createInputs({ include: '/usr/local/include', define: 'NDEBUG=1' });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('--include=/usr/local/include');
    expect(buildArgs).toContain('--define=NDEBUG=1');
});

// ==========================================
// buildModuleArgs edge cases
// ==========================================

test('uses default test target when moduleTarget is empty', async () => {
    const inputs = createInputs({ moduleTarget: [] });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
});

test('skips empty module entries', async () => {
    const inputs = createInputs({ modules: ['filesystem', '', '  '] });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
    // Empty entries should not produce libs//test
    const moduleArgs = buildArgs.filter((a: string) => a.startsWith('libs/'));
    expect(moduleArgs).toHaveLength(1);
});

test('passes through modules with colon separator', async () => {
    const inputs = createInputs({ modules: ['libs/filesystem//unit_tests'] });
    await main(inputs);
    const buildArgs = (exec.getExecOutput as jest.Mock).mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem//unit_tests');
});

// ==========================================
// Schema transform tests
// ==========================================

test('schema sourceDir transform resolves path', () => {
    const path = require('path');
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.sourceDir.transform('some/relative/path');
    const expected = path.resolve('some/relative/path');
    expect(result).toBe(expected);
});

test('schema arch transform normalizes architecture', () => {
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.arch.transform('amd64');
    expect(result).toBe('x64');
});

test('schema buildType crossTransform prefers buildVariant', () => {
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.buildType.crossTransform('Release', { buildVariant: 'Debug' });
    expect(result).toBe('debug');
});

test('schema buildType crossTransform falls back to buildType', () => {
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.buildType.crossTransform('Release', { buildVariant: '' });
    expect(result).toBe('release');
});

test('schema jobs transform uses provided value when nonzero', () => {
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.jobs.transform(4);
    expect(result).toBe(4);
});

test('schema jobs transform uses numberOfCpus when 0', () => {
    const { inputsSchema } = require('./schema');
    const result = inputsSchema.jobs.transform(0);
    expect(result).toBeGreaterThanOrEqual(1);
});

describePrettyErrors('b2 boom', 'B2 workflow failed');
