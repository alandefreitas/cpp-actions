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

describePrettyErrors('b2 boom', 'B2 workflow failed');
