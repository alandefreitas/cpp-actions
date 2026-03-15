import * as path from 'path';
import * as os from 'os';
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
    readdirSync: jest.fn(),
    promises: {
        mkdtemp: jest.fn()
    }
}));

jest.mock('setup-program', () => ({
    downloadAndExtract: jest.fn(),
    stripSingleDirectoryFromPath: jest.fn(),
    cloneGitRepo: jest.fn()
}));

import * as fs from 'fs';
import * as setup_program from 'setup-program';
import { applyPatches, downloadUrlSourceCode, cloneGitRepository, downloadSourceCode } from './source-download';
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

    it('skips empty and whitespace-only patch entries', async () => {
        const inputs = makeInputs({
            patches: ['', '  ', '/patches/real.txt'],
            sourceDir: '/project/src'
        });
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

        await applyPatches(inputs);

        // Only the real patch should be processed
        expect(mockIoCp).toHaveBeenCalledTimes(1);
    });
});

describe('downloadUrlSourceCode', () => {
    const mockDownloadAndExtract = setup_program.downloadAndExtract as jest.MockedFunction<typeof setup_program.downloadAndExtract>;
    const mockStripSingleDir = setup_program.stripSingleDirectoryFromPath as jest.MockedFunction<typeof setup_program.stripSingleDirectoryFromPath>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('downloads to specified downloadDir when provided', async () => {
        mockDownloadAndExtract.mockResolvedValue('/specified/dir');
        mockStripSingleDir.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.url = 'https://example.com/source.tar.gz';
        inputs.downloadDir = '/specified/dir';

        await downloadUrlSourceCode(inputs);

        expect(mockDownloadAndExtract).toHaveBeenCalledWith('https://example.com/source.tar.gz', '/specified/dir');
        expect(mockStripSingleDir).toHaveBeenCalledWith('/specified/dir');
    });

    it('throws when download fails with specified downloadDir', async () => {
        mockDownloadAndExtract.mockResolvedValue(undefined);

        const inputs = makeInputs();
        inputs.url = 'https://example.com/source.tar.gz';
        inputs.downloadDir = '/specified/dir';

        await expect(downloadUrlSourceCode(inputs)).rejects.toThrow('Failed to download source code');
    });

    it('auto-assigns downloadDir when not specified', async () => {
        mockDownloadAndExtract.mockResolvedValue('/auto/dir');
        mockStripSingleDir.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.url = 'https://example.com/source.tar.gz';
        inputs.downloadDir = '';

        await downloadUrlSourceCode(inputs);

        expect(mockDownloadAndExtract).toHaveBeenCalledWith('https://example.com/source.tar.gz');
        expect(inputs.downloadDir).toBe('/auto/dir');
        expect(mockStripSingleDir).toHaveBeenCalledWith('/auto/dir');
    });

    it('throws when download fails without specified downloadDir', async () => {
        mockDownloadAndExtract.mockResolvedValue(undefined);

        const inputs = makeInputs();
        inputs.url = 'https://example.com/source.tar.gz';
        inputs.downloadDir = '';

        await expect(downloadUrlSourceCode(inputs)).rejects.toThrow('Failed to download source code');
    });
});

describe('cloneGitRepository', () => {
    const mockCloneGitRepo = setup_program.cloneGitRepo as jest.MockedFunction<typeof setup_program.cloneGitRepo>;
    const mockMkdtemp = fs.promises.mkdtemp as jest.MockedFunction<typeof fs.promises.mkdtemp>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('creates temp dir when downloadDir is empty', async () => {
        mockMkdtemp.mockResolvedValue('/tmp/source-abc');
        mockCloneGitRepo.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.gitRepository = 'https://github.com/org/repo';
        inputs.downloadDir = '';

        await cloneGitRepository(inputs);

        expect(mockMkdtemp).toHaveBeenCalledWith(path.join(os.tmpdir(), 'source-'));
        expect(inputs.downloadDir).toBe(path.resolve('/tmp/source-abc'));
    });

    it('uses existing downloadDir when provided', async () => {
        mockCloneGitRepo.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.gitRepository = 'https://github.com/org/repo';
        inputs.downloadDir = '/existing/dir';

        await cloneGitRepository(inputs);

        expect(mockMkdtemp).not.toHaveBeenCalled();
        expect(mockCloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/org/repo',
            path.resolve('/existing/dir'),
            undefined,
            { shallow: true }
        );
    });

    it('passes gitTag when specified', async () => {
        mockCloneGitRepo.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.gitRepository = 'https://github.com/org/repo';
        inputs.gitTag = 'v1.0.0';
        inputs.downloadDir = '/dir';

        await cloneGitRepository(inputs);

        expect(mockCloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/org/repo',
            path.resolve('/dir'),
            'v1.0.0',
            { shallow: true }
        );
    });

    it('passes undefined tag when gitTag is empty', async () => {
        mockCloneGitRepo.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.gitRepository = 'https://github.com/org/repo';
        inputs.gitTag = '';
        inputs.downloadDir = '/dir';

        await cloneGitRepository(inputs);

        expect(mockCloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/org/repo',
            path.resolve('/dir'),
            undefined,
            { shallow: true }
        );
    });
});

describe('downloadSourceCode', () => {
    const mockDownloadAndExtract = setup_program.downloadAndExtract as jest.MockedFunction<typeof setup_program.downloadAndExtract>;
    const mockStripSingleDir = setup_program.stripSingleDirectoryFromPath as jest.MockedFunction<typeof setup_program.stripSingleDirectoryFromPath>;
    const mockCloneGitRepo = setup_program.cloneGitRepo as jest.MockedFunction<typeof setup_program.cloneGitRepo>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('defaults downloadDir to sourceDir when not specified', async () => {
        mockDownloadAndExtract.mockResolvedValue('/source');
        mockStripSingleDir.mockResolvedValue(undefined as never);

        const inputs = makeInputs({ sourceDir: '/source' });
        inputs.url = 'https://example.com/src.tar.gz';
        inputs.downloadDir = '';

        await downloadSourceCode(inputs);

        expect(inputs.downloadDir).not.toBe('');
    });

    it('delegates to downloadUrlSourceCode when url is set', async () => {
        mockDownloadAndExtract.mockResolvedValue('/dl');
        mockStripSingleDir.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.url = 'https://example.com/src.tar.gz';
        inputs.downloadDir = '/dl';

        await downloadSourceCode(inputs);

        expect(mockDownloadAndExtract).toHaveBeenCalled();
        expect(mockCloneGitRepo).not.toHaveBeenCalled();
    });

    it('delegates to cloneGitRepository when url is empty', async () => {
        mockCloneGitRepo.mockResolvedValue(undefined as never);

        const inputs = makeInputs();
        inputs.url = '';
        inputs.gitRepository = 'https://github.com/org/repo';
        inputs.downloadDir = '/dl';

        await downloadSourceCode(inputs);

        expect(mockCloneGitRepo).toHaveBeenCalled();
        expect(mockDownloadAndExtract).not.toHaveBeenCalled();
    });
});
