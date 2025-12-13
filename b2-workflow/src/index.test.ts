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
    set_trace_commands: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const exec = require('@actions/exec');
import { main } from './index';

interface InputOverrides {
    modules?: string[];
    module_target?: string[];
    arch?: string;
    [key: string]: unknown;
}

// Helper to build the minimum set of inputs that exercise the module targeting logic without touching the filesystem.
function createInputs(overrides: InputOverrides = {}): {
    source_dir: string;
    build_dir: string;
    cxx: string;
    ccflags: string;
    cxxflags: string;
    cxxstd: string;
    shared: undefined;
    toolset: string;
    arch: string;
    build_type: string;
    modules: string[];
    module_target: string[];
    extra_args: string[];
    warnings_as_errors: undefined;
    address_model: undefined;
    asan: undefined;
    ubsan: undefined;
    msan: undefined;
    tsan: undefined;
    coverage: undefined;
    linkflags: undefined;
    threading: undefined;
    rtti: undefined;
    clean: undefined;
    clean_all: undefined;
    abbreviate_paths: undefined;
    hash: undefined;
    rebuild_all: undefined;
    dry_run: undefined;
    stop_on_error: undefined;
    config: string;
    site_config: string;
    user_config: string;
    project_config: string;
    debug_configuration: undefined;
    debug_building: undefined;
    debug_generators: undefined;
    include: string;
    define: undefined;
    runtime_link: undefined;
    jobs: number;
    trace_commands: boolean;
} {
    return {
        source_dir: '/tmp/boost',
        build_dir: '',
        cxx: '',
        ccflags: '',
        cxxflags: '',
        cxxstd: '',
        shared: undefined,
        toolset: '',
        arch: '',
        build_type: '',
        modules: ['filesystem'],
        module_target: [],
        extra_args: [],
        warnings_as_errors: undefined,
        address_model: undefined,
        asan: undefined,
        ubsan: undefined,
        msan: undefined,
        tsan: undefined,
        coverage: undefined,
        linkflags: undefined,
        threading: undefined,
        rtti: undefined,
        clean: undefined,
        clean_all: undefined,
        abbreviate_paths: undefined,
        hash: undefined,
        rebuild_all: undefined,
        dry_run: undefined,
        stop_on_error: undefined,
        config: '',
        site_config: '',
        user_config: '',
        project_config: '',
        debug_configuration: undefined,
        debug_building: undefined,
        debug_generators: undefined,
        include: '',
        define: undefined,
        runtime_link: undefined,
        jobs: 2,
        trace_commands: false,
        ...overrides
    };
}

beforeEach(() => {
    exec.getExecOutput.mockReset();
    exec.getExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

// Ensures the default maps modules to libs/<module>/test when module-target is omitted.
test('uses default module target when none is specified', async () => {
    const inputs = createInputs();
    await main(inputs);
    const buildArgs = exec.getExecOutput.mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
});

// Setting a single module-target should replace the suffix for every module.
test('supports overriding the module target suffix', async () => {
    const inputs = createInputs({ module_target: ['example'] });
    await main(inputs);
    const buildArgs = exec.getExecOutput.mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/example');
});

// When the modules array already specifies a path, the action leaves it untouched.
test('passes through explicit module paths untouched', async () => {
    const inputs = createInputs({
        modules: ['libs/math/example'],
        module_target: ['example']
    });
    await main(inputs);
    const buildArgs = exec.getExecOutput.mock.calls[2][1];
    expect(buildArgs).toContain('libs/math/example');
});

// Multiple targets should map positionally to the module list with the last reused as needed.
test('applies per-module targets when multiple values are provided', async () => {
    const inputs = createInputs({
        modules: ['filesystem', 'chrono'],
        module_target: ['test', 'example']
    });
    await main(inputs);
    const buildArgs = exec.getExecOutput.mock.calls[2][1];
    expect(buildArgs).toContain('libs/filesystem/test');
    expect(buildArgs).toContain('libs/chrono/example');
});

test('derives address model and architecture from arch input when unspecified', async () => {
    const inputs = createInputs({
        arch: 'arm64'
    });
    await main(inputs);
    const buildArgs = exec.getExecOutput.mock.calls[2][1];
    expect(buildArgs).toContain('address-model=64');
    expect(buildArgs).toContain('architecture=arm');
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

            runPromise = prettyErrors.reportAndSetFailed(new Error('b2 boom'), { title: 'B2 workflow failed', includeStackInSetFailed: true }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('b2 boom');
            });
        });

        await runPromise!;
    });
});
