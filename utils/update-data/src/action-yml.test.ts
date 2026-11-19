const mockUpdateActionYml = jest.fn();
jest.mock('action-schema', () => ({ updateActionYml: mockUpdateActionYml }));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type * as ActionYml from './action-yml';

type ActionYmlModule = typeof ActionYml;

/** Root directory that the CLI entry computes from its own location. */
const REAL_ROOT = path.resolve(__dirname, '../../..');

let tmpDir: string;
let exitSpy: jest.SpyInstance;
let originalArgv: string[];

/**
 * Lets the CLI entry's floating promise chain run to completion.
 */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

/**
 * Loads a fresh copy of action-yml, whose CLI entry runs at import, with its
 * root directory redirected from the repository root to `cliRoot`.
 *
 * @param cliRoot - Directory the CLI entry should scan instead of the repository root
 * @returns The freshly loaded module
 */
async function loadModule(cliRoot: string): Promise<ActionYmlModule> {
    // The raw module object: the `import * as path` namespace has non-configurable getters.
    const rawPath: typeof path = require('path');
    const originalResolve = rawPath.resolve;
    const resolveSpy = jest.spyOn(rawPath, 'resolve').mockImplementation((...segments: string[]) => {
        const resolved = originalResolve(...segments);
        return resolved === REAL_ROOT ? cliRoot : resolved;
    });
    let mod: ActionYmlModule | undefined;
    jest.isolateModules(() => {
            mod = require('./action-yml');
    });
    await flush();
    resolveSpy.mockRestore();
    return mod as ActionYmlModule;
}

/**
 * Creates an action directory in the temporary root.
 *
 * @param name - Action directory name
 * @param options - Which files to create
 * @param options.schema - JavaScript source for lib/schema.js, or undefined for none
 * @param options.actionYml - Whether to create action.yml
 */
function createAction(name: string, options: { schema?: string; actionYml?: boolean }): void {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    if (options.schema !== undefined) {
        fs.writeFileSync(path.join(dir, 'lib', 'schema.js'), options.schema);
    }
    if (options.actionYml) {
        fs.writeFileSync(path.join(dir, 'action.yml'), 'name: test\n');
    }
}

const INPUTS_SCHEMA = 'module.exports = { inputsSchema: { kind: "inputs" } };';

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-yml-'));
    originalArgv = process.argv;
    process.argv = ['node', 'action-yml'];
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockUpdateActionYml.mockReset();
    mockUpdateActionYml.mockResolvedValue({ modified: false, inputsCount: 0, outputsCount: 0 });
});

afterEach(() => {
    process.argv = originalArgv;
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateActionYmls', () => {
    let emptyRoot: string;
    let mod: ActionYmlModule;

    beforeEach(async () => {
        emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'action-yml-empty-'));
        mod = await loadModule(emptyRoot);
        mockUpdateActionYml.mockClear();
    });

    afterEach(() => {
        fs.rmSync(emptyRoot, { recursive: true, force: true });
    });

    it('processes only top-level action directories with a compiled schema, sorted', async () => {
        createAction('setup-gcc', { schema: INPUTS_SCHEMA, actionYml: true });
        createAction('boost-clone', { schema: INPUTS_SCHEMA, actionYml: true });
        createAction('no-schema', { actionYml: true });
        createAction('common', { schema: INPUTS_SCHEMA, actionYml: true });
        createAction('utils', { schema: INPUTS_SCHEMA, actionYml: true });
        createAction('.hidden', { schema: INPUTS_SCHEMA, actionYml: true });
        fs.writeFileSync(path.join(tmpDir, 'README.md'), '');

        const result = await mod.generateActionYmls(tmpDir);

        expect(result.details.map(d => d.name)).toEqual(['boost-clone', 'setup-gcc']);
        expect(result.total).toBe(2);
        expect(mockUpdateActionYml).toHaveBeenCalledWith({
            actionYmlPath: path.join(tmpDir, 'boost-clone', 'action.yml'),
            inputsSchema: { kind: 'inputs' },
            outputsSchema: undefined,
            dryRun: false
        });
    });

    it('counts modified files and passes dryRun through', async () => {
        createAction('a', { schema: INPUTS_SCHEMA, actionYml: true });
        createAction('b', { schema: 'module.exports = { outputsSchema: { kind: "outputs" } };', actionYml: true });
        mockUpdateActionYml
            .mockResolvedValueOnce({ modified: true, inputsCount: 3, outputsCount: 1 })
            .mockResolvedValueOnce({ modified: false, inputsCount: 0, outputsCount: 2 });

        const result = await mod.generateActionYmls(tmpDir, true);

        expect(result).toMatchObject({ total: 2, modified: 1, skipped: 0 });
        expect(result.details).toEqual([
            { name: 'a', result: { modified: true, inputsCount: 3, outputsCount: 1 } },
            { name: 'b', result: { modified: false, inputsCount: 0, outputsCount: 2 } }
        ]);
        expect(mockUpdateActionYml.mock.calls.every(c => c[0].dryRun === true)).toBe(true);
        expect(mockUpdateActionYml.mock.calls[1][0].outputsSchema).toEqual({ kind: 'outputs' });
    });

    it('skips an action that has a schema but no action.yml', async () => {
        createAction('orphan', { schema: INPUTS_SCHEMA, actionYml: false });

        const result = await mod.generateActionYmls(tmpDir);

        expect(result).toMatchObject({ total: 1, skipped: 1, modified: 0 });
        expect(result.details).toEqual([{ name: 'orphan', skipped: true, error: 'No action.yml found' }]);
        expect(mockUpdateActionYml).not.toHaveBeenCalled();
    });

    it('records an error for a schema that exports neither inputs nor outputs', async () => {
        createAction('empty', { schema: 'module.exports = {};', actionYml: true });

        const result = await mod.generateActionYmls(tmpDir);

        expect(result.details).toEqual([
            { name: 'empty', error: 'Schema module must export inputsSchema or outputsSchema' }
        ]);
        expect(mockUpdateActionYml).not.toHaveBeenCalled();
    });

    it('records non-Error rejections from updateActionYml as strings', async () => {
        createAction('bad', { schema: INPUTS_SCHEMA, actionYml: true });
        mockUpdateActionYml.mockRejectedValueOnce('yaml parse failure');

        const result = await mod.generateActionYmls(tmpDir);

        expect(result.details).toEqual([{ name: 'bad', error: 'yaml parse failure' }]);
    });
});

describe('CLI entry', () => {
    it('scans the repository root and does not exit when every action is up to date', async () => {
        createAction('a', { schema: INPUTS_SCHEMA, actionYml: true });

        await loadModule(tmpDir);

        expect(mockUpdateActionYml).toHaveBeenCalledWith(expect.objectContaining({
            actionYmlPath: path.join(tmpDir, 'a', 'action.yml'),
            dryRun: false
        }));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reports updated files when not in dry-run mode', async () => {
        createAction('a', { schema: INPUTS_SCHEMA, actionYml: true });
        mockUpdateActionYml.mockResolvedValue({ modified: true, inputsCount: 1, outputsCount: 0 });

        await loadModule(tmpDir);

        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 action.yml file(s) were updated'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('honors --dry-run and does not report updated files', async () => {
        createAction('a', { schema: INPUTS_SCHEMA, actionYml: true });
        mockUpdateActionYml.mockResolvedValue({ modified: true, inputsCount: 1, outputsCount: 0 });
        process.argv = ['node', 'action-yml', '--dry-run'];

        await loadModule(tmpDir);

        expect(mockUpdateActionYml.mock.calls[0][0].dryRun).toBe(true);
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('were updated'));
    });

    it('exits with 1 when an action fails to generate', async () => {
        createAction('a', { schema: 'module.exports = {};', actionYml: true });

        await loadModule(tmpDir);

        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('1 action(s) failed to generate'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not count skipped actions as failures', async () => {
        createAction('a', { schema: INPUTS_SCHEMA, actionYml: false });

        await loadModule(tmpDir);

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits with 1 when the scan itself throws', async () => {
        await loadModule(path.join(tmpDir, 'does-not-exist'));

        expect(console.error).toHaveBeenCalledWith('action-yml generation failed:', expect.objectContaining({ code: 'ENOENT' }));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
