import * as path from 'path';
import * as io from '@actions/io';

jest.mock('@actions/io');
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    getInput: jest.fn(),
    getBooleanInput: jest.fn(),
    getMultilineInput: jest.fn(),
    setOutput: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn()
}));

import * as fs from 'fs';
import { applyPatches } from './source-download';
import { type Inputs } from './schema';

/**
 * Creates a minimal Inputs object with only the fields needed for applyPatches.
 *
 * @param overrides - Fields to override in the default inputs
 * @returns Inputs object for testing
 */
function makeInputs(overrides: { patches?: string[]; sourceDir?: string } = {}): Inputs {
    return {
        preset: '',
        buildType: '',
        buildDir: 'build',
        cmakePath: 'cmake',
        generator: '',
        generatorToolset: '',
        generatorArchitecture: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        cxxstd: [],
        exportCompileCommands: undefined,
        runTests: undefined,
        configureTestsFlag: '',
        ctestTimeout: undefined,
        shared: undefined,
        toolchain: '',
        sourceDir: overrides.sourceDir ?? '/test/source',
        installPrefix: '',
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
        patches: overrides.patches ?? [],
        arch: '',
        buildTarget: [],
        jobs: 1,
        testAllCxxstd: false,
        install: undefined,
        installAllCxxstd: false,
        package: undefined,
        packageAllCxxstd: false,
        packageArtifact: undefined,
        packageRetentionDays: 10,
        createAnnotations: undefined,
        refSourceDir: '',
        traceCommands: false
    };
}

describe('applyPatches', () => {
    const mockIoCp = io.cp as jest.MockedFunction<typeof io.cp>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does nothing when patches array is empty', async () => {
        const inputs = makeInputs({ patches: [] });
        await applyPatches(inputs);
        expect(mockIoCp).not.toHaveBeenCalled();
    });

    it('copies a single file patch to source directory root', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

        const inputs = makeInputs({
            patches: ['/patches/CMakePresets.json'],
            sourceDir: '/project/src'
        });

        await applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(1);
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches/CMakePresets.json'),
            path.resolve('/project/src', 'CMakePresets.json'),
            { force: true }
        );
    });

    it('copies directory contents preserving structure with force option', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
        (fs.readdirSync as jest.Mock).mockReturnValue(['file.txt', 'subdir']);

        const inputs = makeInputs({
            patches: ['/patches'],
            sourceDir: '/project/src'
        });

        await applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(2);
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches', 'file.txt'),
            path.resolve('/project/src', 'file.txt'),
            { recursive: true, force: true }
        );
        expect(mockIoCp).toHaveBeenCalledWith(
            path.resolve('/patches', 'subdir'),
            path.resolve('/project/src', 'subdir'),
            { recursive: true, force: true }
        );
    });

    it('skips non-existent patch files', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const inputs = makeInputs({
            patches: ['/patches/missing.txt'],
            sourceDir: '/project/src'
        });

        await applyPatches(inputs);

        expect(mockIoCp).not.toHaveBeenCalled();
    });

    it('processes multiple patches in order', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

        const inputs = makeInputs({
            patches: ['/patches/first.txt', '/patches/second.txt'],
            sourceDir: '/project/src'
        });

        await applyPatches(inputs);

        expect(mockIoCp).toHaveBeenCalledTimes(2);
        // Verify order
        expect(mockIoCp.mock.calls[0][0]).toBe(path.resolve('/patches/first.txt'));
        expect(mockIoCp.mock.calls[1][0]).toBe(path.resolve('/patches/second.txt'));
    });
});
