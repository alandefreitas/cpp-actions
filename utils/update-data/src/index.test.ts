const mockSteps = {
    updateRunnerImages: jest.fn(),
    fetchAllTags: jest.fn(),
    generateUbuntuVersionsJson: jest.fn(),
    updateUbuntuCompilerDefaults: jest.fn(),
    updateMacOSXcodeDefaults: jest.fn(),
    updateWindowsMsvcDefaults: jest.fn(),
    generateBoostDeps: jest.fn()
};

jest.mock('./runner-images', () => ({ updateRunnerImages: mockSteps.updateRunnerImages }));
jest.mock('./tags', () => ({ fetchAllTags: mockSteps.fetchAllTags }));
jest.mock('./ubuntu-versions', () => ({ generateUbuntuVersionsJson: mockSteps.generateUbuntuVersionsJson }));
jest.mock('./ubuntu-compiler-defaults', () => ({ updateUbuntuCompilerDefaults: mockSteps.updateUbuntuCompilerDefaults }));
jest.mock('./macos-xcode-defaults', () => ({ updateMacOSXcodeDefaults: mockSteps.updateMacOSXcodeDefaults }));
jest.mock('./windows-msvc-defaults', () => ({ updateWindowsMsvcDefaults: mockSteps.updateWindowsMsvcDefaults }));
jest.mock('./boost-deps', () => ({ generateBoostDeps: mockSteps.generateBoostDeps }));

import * as path from 'path';
import type * as IndexModule from './index';

type StepName = keyof typeof mockSteps;

/** Order in which the CLI entry runs the steps. */
const STEP_ORDER: StepName[] = [
    'updateRunnerImages',
    'fetchAllTags',
    'generateUbuntuVersionsJson',
    'updateUbuntuCompilerDefaults',
    'updateMacOSXcodeDefaults',
    'updateWindowsMsvcDefaults',
    'generateBoostDeps'
];

let exitSpy: jest.SpyInstance;

/**
 * Loads a fresh copy of index.ts, whose `main()` runs at import, and waits
 * for its promise chain to settle.
 *
 * @returns The loaded module
 */
async function runMain(): Promise<typeof IndexModule> {
    let mod: typeof IndexModule | undefined;
    jest.isolateModules(() => {
        mod = require('./index');
    });
    for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    return mod as typeof IndexModule;
}

beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const step of Object.values(mockSteps)) {
        step.mockReset();
        step.mockResolvedValue(true);
    }
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('update-data CLI entry', () => {
    it('runs every step in order against the repository root and succeeds', async () => {
        const order: string[] = [];
        for (const name of STEP_ORDER) {
            mockSteps[name].mockImplementation(async () => {
                order.push(name);
                return true;
            });
        }

        await runMain();

        const repoRoot = path.resolve(__dirname, '../../..');
        expect(order).toEqual(STEP_ORDER);
        for (const name of STEP_ORDER) {
            expect(mockSteps[name]).toHaveBeenCalledWith(repoRoot);
        }
        expect(exitSpy).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('External data updated successfully'));
    });

    it.each([
        ['updateRunnerImages', 'Runner images discovery failed'],
        ['fetchAllTags', 'Some tag fetches failed'],
        ['generateUbuntuVersionsJson', 'Ubuntu versions generation failed'],
        ['updateUbuntuCompilerDefaults', 'Ubuntu compiler defaults generation failed'],
        ['updateMacOSXcodeDefaults', 'macOS Xcode defaults generation failed'],
        ['updateWindowsMsvcDefaults', 'Windows MSVC defaults generation failed'],
        ['generateBoostDeps', 'Boost deps generation failed']
    ] as Array<[StepName, string]>)('when %s fails, still runs the rest, warns and exits with 1', async (step, warning) => {
        mockSteps[step].mockResolvedValue(false);

        await runMain();

        for (const name of STEP_ORDER) {
            expect(mockSteps[name]).toHaveBeenCalledTimes(1);
        }
        expect(console.error).toHaveBeenCalledWith(`Warning: ${warning}`);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with 1 when a step throws', async () => {
        mockSteps.fetchAllTags.mockRejectedValue(new Error('boom'));

        await runMain();

        expect(mockSteps.generateUbuntuVersionsJson).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('update-data failed:', expect.objectContaining({ message: 'boom' }));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('re-exports runCommand from the runner module', async () => {
        const mod = await runMain();
        expect(typeof mod.runCommand).toBe('function');
    });
});
