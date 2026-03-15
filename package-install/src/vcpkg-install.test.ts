import * as path from 'path';
import type { Inputs } from './schema';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    exportVariable: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    find: jest.fn(),
    cacheDir: jest.fn(),
    downloadTool: jest.fn()
}));

jest.mock('@actions/cache', () => ({
    restoreCache: jest.fn(),
    saveCache: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn(),
    mkdirP: jest.fn()
}));

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn()
}));

jest.mock('./utils', () => ({
    uuidV4: jest.fn(() => 'test-uuid'),
    sha1sum: jest.fn((s: string) => `sha1-${s.substring(0, 8)}`),
    escapePath: jest.fn((p: string) => p),
    readCompilerVersion: jest.fn()
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as cache from '@actions/cache';
import * as io from '@actions/io';
import * as fs from 'fs';
import { readCompilerVersion } from './utils';
import { vcpkgMain } from './vcpkg-install';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockFind = tc.find as jest.MockedFunction<typeof tc.find>;
const mockCacheDir = tc.cacheDir as jest.MockedFunction<typeof tc.cacheDir>;
const mockRestoreCache = cache.restoreCache as jest.MockedFunction<typeof cache.restoreCache>;
const mockSaveCache = cache.saveCache as jest.MockedFunction<typeof cache.saveCache>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockMkdirP = io.mkdirP as jest.MockedFunction<typeof io.mkdirP>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockReadCompilerVersion = readCompilerVersion as jest.MockedFunction<typeof readCompilerVersion>;
const mockExportVariable = core.exportVariable as jest.MockedFunction<typeof core.exportVariable>;

/**
 * Creates a default Inputs object for testing with optional overrides.
 *
 * @param overrides - Partial input values to override defaults
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        vcpkg: [],
        apt_get: [],
        cxx: '',
        cxxflags: '',
        cc: '',
        ccflags: '',
        vcpkgTriplet: '',
        vcpkgDir: '',
        vcpkgBranch: 'master',
        vcpkgCache: false,
        vcpkgForceInstall: false,
        aptGetRetries: 3,
        aptGetSources: [],
        aptGetSourceKeys: [],
        aptGetIgnoreMissing: false,
        aptGetAddArchitecture: [],
        aptGetBulkInstall: false,
        ...overrides
    };
}

describe('vcpkgMain', () => {
    const origPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWhich.mockResolvedValue('/usr/bin/git');
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'abc123 refs/heads/master',
            stderr: ''
        });
        mockExec.mockResolvedValue(0);
        mockFind.mockReturnValue('');
        mockCacheDir.mockResolvedValue('/cache/vcpkg/master');
        mockMkdirP.mockResolvedValue(undefined);
        mockExistsSync.mockReturnValue(false);
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
        process.env['RUNNER_TEMP'] = '/tmp/runner';
        delete process.env['RUNNER_TOOL_CACHE'];
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
    });

    it('clones and bootstraps vcpkg with no packages', async () => {
        const inputs = makeInputs();
        const result = await vcpkgMain(inputs);

        expect(mockWhich).toHaveBeenCalledWith('git', true);
        // Should clone vcpkg
        expect(mockExec).toHaveBeenCalledWith(
            '/usr/bin/git',
            expect.arrayContaining(['clone', 'https://github.com/microsoft/vcpkg.git']),
            {}
        );
        // Should bootstrap
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('bootstrap-vcpkg.sh'),
            [],
            expect.objectContaining({ cwd: expect.any(String) })
        );
        expect(result.vcpkgExecutable).toBeDefined();
        expect(result.vcpkgToolchain).toBeDefined();
    });

    it('uses existing vcpkgDir when specified', async () => {
        const inputs = makeInputs({ vcpkgDir: '/custom/vcpkg' });
        const result = await vcpkgMain(inputs);

        const expectedDir = path.join('/custom/vcpkg');
        expect(result.vcpkgToolchain).toContain(expectedDir);
        expect(result.vcpkgExecutable).toContain(expectedDir);
    });

    it('finds vcpkg in tool cache', async () => {
        mockFind.mockReturnValue('/cached/vcpkg');
        const inputs = makeInputs();
        const result = await vcpkgMain(inputs);

        expect(mockFind).toHaveBeenCalledWith('vcpkg', 'master');
        expect(result.vcpkgToolchain).toContain(path.join('/cached/vcpkg'));
    });

    it('finds vcpkg in RUNNER_TOOL_CACHE directory', async () => {
        mockFind.mockReturnValue('');
        process.env['RUNNER_TOOL_CACHE'] = '/tools';
        const toolCacheDir = path.join('/tools', 'vcpkg', 'master');
        mockExistsSync.mockImplementation((p) => {
            return String(p) === toolCacheDir;
        });
        const inputs = makeInputs();
        const result = await vcpkgMain(inputs);

        expect(result.vcpkgToolchain).toContain(toolCacheDir);
    });

    it('creates temp folder and caches when no vcpkg dir found', async () => {
        mockFind.mockReturnValue('');
        const inputs = makeInputs();
        await vcpkgMain(inputs);

        expect(mockMkdirP).toHaveBeenCalled();
        expect(mockCacheDir).toHaveBeenCalledWith(
            expect.any(String),
            'vcpkg',
            'master'
        );
    });

    it('resolves relative vcpkgDir to absolute', async () => {
        const inputs = makeInputs({ vcpkgDir: 'relative/path' });
        const result = await vcpkgMain(inputs);

        // Should be joined with cwd
        expect(result.vcpkgExecutable).toContain(process.cwd());
    });

    describe('triplet handling', () => {
        it('uses default linux triplet', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            const inputs = makeInputs();
            await vcpkgMain(inputs);

            // The cache key should contain x64-linux
            expect(core.info).toHaveBeenCalledWith(expect.stringContaining('x64-linux'));
        });

        it('uses default windows triplet', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
            const inputs = makeInputs();
            await vcpkgMain(inputs);

            expect(core.info).toHaveBeenCalledWith(expect.stringContaining('x64-windows'));
        });

        it('uses default macOS triplet', async () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
            const inputs = makeInputs();
            await vcpkgMain(inputs);

            expect(core.info).toHaveBeenCalledWith(expect.stringContaining('x64-osx'));
        });

        it('uses custom triplet when specified', async () => {
            const inputs = makeInputs({ vcpkgTriplet: 'arm64-linux' });
            await vcpkgMain(inputs);

            expect(core.info).toHaveBeenCalledWith(expect.stringContaining('arm64-linux'));
        });
    });

    describe('compiler detection', () => {
        it('detects C++ compiler version', async () => {
            mockReadCompilerVersion.mockResolvedValue('g++ (Ubuntu) 11.4.0');
            const inputs = makeInputs({ cxx: 'g++' });
            // When cxx is a basename, it resolves via io.which
            mockWhich.mockImplementation(async (cmd) => {
                if (cmd === 'g++') return '/usr/bin/g++';
                return `/usr/bin/${cmd}`;
            });
            await vcpkgMain(inputs);

            expect(mockReadCompilerVersion).toHaveBeenCalled();
        });

        it('detects C compiler version', async () => {
            mockReadCompilerVersion.mockResolvedValue('gcc (Ubuntu) 11.4.0');
            const inputs = makeInputs({ cc: '/usr/bin/gcc' });
            await vcpkgMain(inputs);

            expect(mockReadCompilerVersion).toHaveBeenCalledWith('/usr/bin/gcc');
        });

        it('resolves cc basename via io.which', async () => {
            mockReadCompilerVersion.mockResolvedValue('gcc (Ubuntu) 11.4.0');
            mockWhich.mockImplementation(async (cmd) => {
                if (cmd === 'gcc') return '/usr/bin/gcc';
                return `/usr/bin/${cmd}`;
            });
            const inputs = makeInputs({ cc: 'gcc' });
            await vcpkgMain(inputs);

            expect(mockWhich).toHaveBeenCalledWith('gcc', true);
            expect(mockReadCompilerVersion).toHaveBeenCalledWith('/usr/bin/gcc');
        });

        it('skips CC in hash when version and flags match CXX', async () => {
            mockReadCompilerVersion.mockResolvedValue('compiler 11.4.0');
            const inputs = makeInputs({
                cxx: '/usr/bin/g++',
                cc: '/usr/bin/gcc',
                cxxflags: '-O2',
                ccflags: '-O2'
            });
            await vcpkgMain(inputs);

            // compiler-hash-str should only contain cxx, not cc
            const hashCalls = (core.info as jest.Mock).mock.calls
                .filter((c: string[]) => c[0].includes('compiler-hash-str:'));
            expect(hashCalls.length).toBe(1);
            expect(hashCalls[0][0]).toContain('cxx:');
            expect(hashCalls[0][0]).not.toContain('cc:');
        });

        it('includes both CXX and CC in compiler hash when versions differ', async () => {
            mockReadCompilerVersion
                .mockResolvedValueOnce('g++ (Ubuntu) 11.4.0')
                .mockResolvedValueOnce('gcc (Ubuntu) 10.3.0');
            const inputs = makeInputs({
                cxx: '/usr/bin/g++',
                cc: '/usr/bin/gcc'
            });
            await vcpkgMain(inputs);

            // compiler-hash-str should contain both
            expect(core.info).toHaveBeenCalledWith(
                expect.stringContaining('compiler-hash-str: cxx:')
            );
        });
    });

    describe('caching', () => {
        it('restores from cache and returns early on cache hit', async () => {
            mockRestoreCache.mockResolvedValue('cache-key-123');
            const inputs = makeInputs({ vcpkgCache: true });
            const result = await vcpkgMain(inputs);

            expect(mockRestoreCache).toHaveBeenCalled();
            // Should return without cloning
            expect(mockExec).not.toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining(['clone']),
                expect.any(Object)
            );
            expect(result.vcpkgExecutable).toBeDefined();
        });

        it('clones and saves cache on cache miss', async () => {
            mockRestoreCache.mockResolvedValue(undefined);
            const inputs = makeInputs({ vcpkgCache: true });
            await vcpkgMain(inputs);

            // Should clone
            expect(mockExec).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining(['clone']),
                {}
            );
            // Should save cache
            expect(mockSaveCache).toHaveBeenCalled();
        });

        it('skips cache when vcpkgCache is false', async () => {
            const inputs = makeInputs({ vcpkgCache: false });
            await vcpkgMain(inputs);

            expect(mockRestoreCache).not.toHaveBeenCalled();
            expect(mockSaveCache).not.toHaveBeenCalled();
        });
    });

    describe('package installation', () => {
        it('installs packages with triplet suffix', async () => {
            const inputs = makeInputs({ vcpkg: ['zlib', 'boost'] });
            await vcpkgMain(inputs);

            // Should call vcpkg install for each package
            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('vcpkg'),
                expect.arrayContaining(['install', 'zlib']),
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('does not append triplet when package has its own', async () => {
            const inputs = makeInputs({ vcpkg: ['zlib:x86-windows'] });
            await vcpkgMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('vcpkg'),
                ['install', 'zlib:x86-windows', 'zlib:x86-windows'],
                expect.objectContaining({ ignoreReturnCode: true })
            );
        });

        it('exports CXX/CC environment variables when set', async () => {
            mockReadCompilerVersion.mockResolvedValue('g++ 11.4.0');
            const inputs = makeInputs({
                vcpkg: ['zlib'],
                cxx: '/usr/bin/g++',
                cxxflags: '-O2',
                cc: '/usr/bin/gcc',
                ccflags: '-O2'
            });
            await vcpkgMain(inputs);

            expect(mockExportVariable).toHaveBeenCalledWith('CXX', '/usr/bin/g++');
            expect(mockExportVariable).toHaveBeenCalledWith('CXXFLAGS', '-O2');
            expect(mockExportVariable).toHaveBeenCalledWith('CC', '/usr/bin/gcc');
            expect(mockExportVariable).toHaveBeenCalledWith('CFLAGS', '-O2');
        });

        it('does not export empty compiler variables', async () => {
            const inputs = makeInputs({ vcpkg: ['zlib'] });
            await vcpkgMain(inputs);

            expect(mockExportVariable).not.toHaveBeenCalledWith('CXX', expect.anything());
            expect(mockExportVariable).not.toHaveBeenCalledWith('CC', expect.anything());
        });

        it('throws when package installation fails', async () => {
            mockExec.mockImplementation(async (_cmd, args) => {
                if (Array.isArray(args) && args.includes('install')) {
                    return 1;
                }
                return 0;
            });
            const inputs = makeInputs({ vcpkg: ['badpkg'] });
            await expect(vcpkgMain(inputs)).rejects.toThrow('Failed to install package badpkg');
        });

        it('prints log files when package installation fails', async () => {
            mockExec.mockImplementation(async (_cmd, args) => {
                if (Array.isArray(args) && args.includes('install')) {
                    return 1;
                }
                return 0;
            });
            mockExistsSync.mockReturnValue(true);
            mockReadFileSync.mockReturnValue('build error log contents');
            const inputs = makeInputs({ vcpkg: ['badpkg'] });

            await expect(vcpkgMain(inputs)).rejects.toThrow();
            expect(mockReadFileSync).toHaveBeenCalled();
            expect(core.info).toHaveBeenCalledWith('build error log contents');
        });
    });

    describe('bootstrap', () => {
        it('uses bootstrap-vcpkg.bat on Windows', async () => {
            Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
            const inputs = makeInputs();
            await vcpkgMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('bootstrap-vcpkg.bat'),
                [],
                expect.any(Object)
            );
        });

        it('uses bootstrap-vcpkg.sh on Linux', async () => {
            Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
            const inputs = makeInputs();
            await vcpkgMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                expect.stringContaining('bootstrap-vcpkg.sh'),
                [],
                expect.any(Object)
            );
        });
    });
});
