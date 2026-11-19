jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    setOutput: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest.fn()
}));

jest.mock('action-schema', () => ({
    ...jest.requireActual('action-schema'),
    runAction: jest.fn()
}));

jest.mock('trace-commands', () => ({
    ...jest.requireActual('trace-commands'),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('package-install', () => ({
    findProgramInPath: jest.fn(),
    findProgramInSystemPaths: jest.fn(),
    findProgramWithApt: jest.fn()
}));

jest.mock('./url-install', () => ({
    installProgramFromUrl: jest.fn()
}));

import * as path from 'path';
import * as core from '@actions/core';
import { runAction } from 'action-schema';
import * as traceCommands from 'trace-commands';
import * as packageInstall from 'package-install';
import { ExpectedError } from 'pretty-errors';

import { installProgramFromUrl } from './url-install';
import * as index from './index';
import { inputsSchema, outputsSchema } from './index';
import * as utils from './utils';
import * as versionCache from './version-cache';
import * as downloadUtils from './download-utils';
import * as systemUtils from './system-utils';
import * as gitUtils from './git-utils';
import * as ubuntuUtils from './ubuntu-utils';
import * as ubuntuCompilerDefaults from './ubuntu-compiler-defaults';
import * as macosXcodeDefaults from './macos-xcode-defaults';
import * as windowsMsvcDefaults from './windows-msvc-defaults';
import * as runnerImages from './runner-images';
import * as symbolizerUtils from './symbolizer-utils';
import type { SetupProgramInputs } from './types';

const mockRunAction = runAction as jest.Mock;
const runOptions = mockRunAction.mock.calls[0][0];
const main = runOptions.main as (inputs: SetupProgramInputs) => Promise<Record<string, unknown>>;

const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockFindInPath = packageInstall.findProgramInPath as jest.Mock;
const mockFindInSystemPaths = packageInstall.findProgramInSystemPaths as jest.Mock;
const mockFindWithApt = packageInstall.findProgramWithApt as jest.Mock;
const mockInstallFromUrl = installProgramFromUrl as jest.MockedFunction<typeof installProgramFromUrl>;

const NOT_FOUND = { outputVersion: null, outputPath: null };
const originalPlatform = process.platform;
const originalEnv = { ...process.env };

/**
 * Builds action inputs with defaults that find nothing.
 *
 * @param overrides - Input values to override
 * @returns Complete inputs object for the setup-program action
 */
function makeInputs(overrides: Partial<Record<string, unknown>> = {}): SetupProgramInputs {
    return {
        name: ['cmake'],
        version: '*',
        path: [],
        checkLatest: false,
        url: '',
        installPrefix: '',
        updateEnvironment: true,
        failOnError: false,
        traceCommands: false,
        ...overrides
    } as unknown as SetupProgramInputs;
}

/**
 * Overrides `process.platform` for the current test.
 *
 * @param platform - Platform value to report
 */
function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
}

beforeEach(() => {
    jest.clearAllMocks();
    (traceCommands.scoped as jest.Mock).mockReturnValue(jest.fn());
    mockFindInPath.mockResolvedValue(NOT_FOUND);
    mockFindInSystemPaths.mockResolvedValue(NOT_FOUND);
    mockFindWithApt.mockResolvedValue(NOT_FOUND);
    mockInstallFromUrl.mockResolvedValue(NOT_FOUND);
    setPlatform('win32');
    delete process.env.AGENT_TOOLSDIRECTORY;
    delete process.env.RUNNER_TOOL_CACHE;
});

afterEach(() => {
    setPlatform(originalPlatform);
    process.env = { ...originalEnv };
});

describe('setup-program entry point', () => {
    it('registers the action with runAction', () => {
        expect(runOptions.title).toBe('Setup Program');
        expect(runOptions.inputsSchema).toBe(inputsSchema);
        expect(runOptions.outputsSchema).toBe(outputsSchema);
        expect(runOptions.callerModule).toBeDefined();
    });

    it('returns outputs for a program found in the user paths without searching further', async () => {
        const exe = path.join('opt', 'cmake', 'bin', 'cmake');
        mockFindInPath.mockResolvedValue({ outputVersion: '3.27.1', outputPath: exe });

        const outputs = await main(makeInputs({ path: [path.join('opt', 'cmake', 'bin')], version: '>=3.20', checkLatest: true }));

        expect(mockFindInPath).toHaveBeenCalledWith([path.join('opt', 'cmake', 'bin')], '>=3.20', true);
        expect(mockFindInSystemPaths).not.toHaveBeenCalled();
        expect(mockFindWithApt).not.toHaveBeenCalled();
        expect(mockInstallFromUrl).not.toHaveBeenCalled();
        expect(outputs).toEqual({
            path: exe,
            dir: path.dirname(exe),
            version: '3.27.1',
            versionMajor: 3,
            versionMinor: 27,
            versionPatch: 1,
            found: true
        });
    });

    it('skips the user paths step when no paths are given and searches the system PATH', async () => {
        mockFindInSystemPaths.mockResolvedValue({ outputVersion: 'cmake version 3.28', outputPath: '/usr/bin/cmake' });

        const outputs = await main(makeInputs({ name: ['cmake', 'cmake3'], version: '3.x' }));

        expect(mockFindInPath).not.toHaveBeenCalled();
        expect(mockFindInSystemPaths).toHaveBeenCalledWith([], ['cmake', 'cmake3'], '3.x', false);
        expect(outputs).toMatchObject({ path: '/usr/bin/cmake', version: '3.28.0', versionMajor: 3, versionMinor: 28, versionPatch: 0, found: true });
    });

    it('searches the system PATH when the user paths found nothing', async () => {
        await main(makeInputs({ path: ['/custom'] }));

        expect(mockFindInPath).toHaveBeenCalled();
        expect(mockFindInSystemPaths).toHaveBeenCalledWith(['/custom'], ['cmake'], '*', false);
    });

    it('installs with APT on Linux when the program was not found', async () => {
        setPlatform('linux');
        mockFindWithApt.mockResolvedValue({ outputVersion: '3.22.1', outputPath: '/usr/bin/cmake' });

        const outputs = await main(makeInputs({ url: 'https://example.com/cmake.zip' }));

        expect(mockFindWithApt).toHaveBeenCalledWith(['cmake'], '*', false);
        expect(mockInstallFromUrl).not.toHaveBeenCalled();
        expect(outputs).toMatchObject({ path: '/usr/bin/cmake', version: '3.22.1', found: true });
    });

    it('still tries APT on Linux when a path was found without a version', async () => {
        setPlatform('linux');
        mockFindInSystemPaths.mockResolvedValue({ outputVersion: null, outputPath: '/usr/bin/tool' });
        mockFindWithApt.mockResolvedValue({ outputVersion: null, outputPath: '/usr/bin/tool' });

        const outputs = await main(makeInputs({ name: ['tool'] }));

        expect(mockFindWithApt).toHaveBeenCalled();
        expect(outputs).toMatchObject({ path: '/usr/bin/tool', version: '0.0.0', versionMajor: 0, found: true });
    });

    it('skips APT outside Linux', async () => {
        setPlatform('win32');

        await main(makeInputs());

        expect(mockFindWithApt).not.toHaveBeenCalled();
    });

    it('downloads from the URL when nothing else found the program', async () => {
        const exe = path.join('toolcache', 'cmake', 'bin', 'cmake');
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.27.1', outputPath: exe });

        const outputs = await main(makeInputs({
            version: '3.27.1',
            checkLatest: true,
            url: 'https://example.com/cmake-{{version}}.zip',
            updateEnvironment: false,
            installPrefix: path.join('opt', 'cmake')
        }));

        expect(mockInstallFromUrl).toHaveBeenCalledWith(
            ['cmake'], '3.27.1', true, 'https://example.com/cmake-{{version}}.zip', false, path.join('opt', 'cmake'));
        expect(outputs).toMatchObject({ path: exe, version: '3.27.1', found: true });
    });

    it('passes a null install prefix when none is given', async () => {
        await main(makeInputs({ url: 'https://example.com/cmake.zip' }));

        expect(mockInstallFromUrl.mock.calls[0][5]).toBeNull();
    });

    it('reports found=false without throwing when failOnError is false', async () => {
        const outputs = await main(makeInputs());

        expect(outputs).toEqual({ found: false });
        expect(mockInstallFromUrl).not.toHaveBeenCalled();
        expect(mockSetOutput).toHaveBeenCalledWith('found', false);
        expect(mockInfo).toHaveBeenCalledWith('Cannot find program');
    });

    it('throws an ExpectedError when failOnError is true and nothing was found', async () => {
        const promise = main(makeInputs({ failOnError: true }));

        await expect(promise).rejects.toBeInstanceOf(ExpectedError);
        expect(mockSetOutput).toHaveBeenCalledWith('found', false);
    });

    it('reports found=false when the version found cannot be parsed', async () => {
        mockFindInSystemPaths.mockResolvedValue({ outputVersion: 'unknown', outputPath: '/usr/bin/tool' });

        await expect(main(makeInputs())).resolves.toEqual({ found: false });
    });

    it('points the tool cache at the hosted tool cache on macOS', async () => {
        setPlatform('darwin');

        await main(makeInputs());

        expect(process.env.AGENT_TOOLSDIRECTORY).toBe('/Users/runner/hostedtoolcache');
        expect(process.env.RUNNER_TOOL_CACHE).toBe('/Users/runner/hostedtoolcache');
    });

    it('copies a non-blank AGENT_TOOLSDIRECTORY into RUNNER_TOOL_CACHE', async () => {
        process.env.AGENT_TOOLSDIRECTORY = path.join('agent', 'tools');

        await main(makeInputs());

        expect(process.env.RUNNER_TOOL_CACHE).toBe(path.join('agent', 'tools'));
    });

    it('leaves RUNNER_TOOL_CACHE alone when AGENT_TOOLSDIRECTORY is blank', async () => {
        process.env.AGENT_TOOLSDIRECTORY = '   ';

        await main(makeInputs());

        expect(process.env.RUNNER_TOOL_CACHE).toBeUndefined();
    });
});

describe('setup-program public API', () => {
    it.each([
        ['normalizeArchitectureInput', utils.normalizeArchitectureInput],
        ['setVersionsCacheDir', versionCache.setVersionsCacheDir],
        ['resolveVersionsCachePath', versionCache.resolveVersionsCachePath],
        ['readVersionsFromFile', versionCache.readVersionsFromFile],
        ['saveVersionsToFile', versionCache.saveVersionsToFile],
        ['downloadAndExtract', downloadUtils.downloadAndExtract],
        ['stripSingleDirectoryFromPath', downloadUtils.stripSingleDirectoryFromPath],
        ['findProgramInPath', packageInstall.findProgramInPath],
        ['findProgramInSystemPaths', packageInstall.findProgramInSystemPaths],
        ['isSudoRequired', systemUtils.isSudoRequired],
        ['execWithSudo', systemUtils.execWithSudo],
        ['getExecOutputWithSudo', systemUtils.getExecOutputWithSudo],
        ['urlExists', systemUtils.urlExists],
        ['ensureSudoIsAvailable', systemUtils.ensureSudoIsAvailable],
        ['moveWithPermissions', systemUtils.moveWithPermissions],
        ['findGit', gitUtils.findGit],
        ['fetchGitTags', gitUtils.fetchGitTags],
        ['findVersionsFromTags', gitUtils.findVersionsFromTags],
        ['findGCCVersions', gitUtils.findGCCVersions],
        ['findClangVersions', gitUtils.findClangVersions],
        ['findCMakeVersions', gitUtils.findCMakeVersions],
        ['cloneGitRepo', gitUtils.cloneGitRepo],
        ['getCurrentUbuntuVersion', ubuntuUtils.getCurrentUbuntuVersion],
        ['getCurrentUbuntuName', ubuntuUtils.getCurrentUbuntuName],
        ['loadUbuntuCompilerDefaults', ubuntuCompilerDefaults.loadUbuntuCompilerDefaults],
        ['loadMacOSXcodeDefaults', macosXcodeDefaults.loadMacOSXcodeDefaults],
        ['loadWindowsMsvcDefaults', windowsMsvcDefaults.loadWindowsMsvcDefaults],
        ['loadRunnerImages', runnerImages.loadRunnerImages],
        ['installProgramFromUrl', installProgramFromUrl],
        ['findLlvmSymbolizer', symbolizerUtils.findLlvmSymbolizer],
        ['exportSymbolizerEnvVars', symbolizerUtils.exportSymbolizerEnvVars],
        ['buildSymbolizerCandidatePaths', symbolizerUtils.buildSymbolizerCandidatePaths]
    ])('re-exports %s from its implementation module', (name, implementation) => {
        expect((index as Record<string, unknown>)[name]).toBe(implementation);
        expect(typeof implementation).toBe('function');
    });
});
