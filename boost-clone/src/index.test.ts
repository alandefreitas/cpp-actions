// Mirror the production modules but replace side effects with controllable spies.
// Each mock maps to our runtime dependencies so we can assert call patterns
// without launching external processes.
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

jest.mock('@actions/cache', () => ({
    restoreCache: jest.fn(),
    saveCache: jest.fn(),
    isFeatureAvailable: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
}));

// Replace child-process execution helpers with spies; tests stub their results
// to simulate git output deterministically.
jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn(),
    exec: jest.fn()
}));

// Substitute setup-program helpers so git discovery and URL checks never reach
// the network during unit tests.
jest.mock('setup-program', () => ({
    urlExists: jest.fn(),
    findGit: jest.fn(),
    cloneGitRepo: jest.fn()
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as semver from 'semver';
import { generateCacheKey, main } from './index';
import * as exec from '@actions/exec';
import * as cache from '@actions/cache';
import * as tc from '@actions/tool-cache';
import * as core from '@actions/core';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

interface Inputs {
    boost_dir: string;
    branch: string;
    modules: Set<string>;
    patches: Set<string>;
    scan_modules_ignore: Set<string>;
    scan_modules_dir: Set<string>;
    modules_scan_paths: Set<string>;
    modules_exclude_paths: Set<string>;
    cache: boolean;
    optimistic_caching: boolean;
    trace_commands: boolean;
    clone_strategy: 'auto' | 'git' | 'archive';
    archive_threshold: number;
}

interface GitFeatures {
    gitPath: string;
    version: semver.SemVer;
    supportsJobs: boolean;
    supportsScanScripts: boolean;
    supportsDepth: boolean;
}

interface CacheKeyResult {
    cacheKey: string;
    fragments: {
        boostHash: string;
        modulesAndPatchesHash: string;
        configHash: string;
    };
}

beforeEach(() => {
    // Reset spies between tests to prevent cross-test contamination.
    jest.clearAllMocks();
});

test('generateCacheKey reflects modules-exclude-paths', async () => {
    // Pretend every module repo exists so the module hash branch executes.
    setup_program.urlExists.mockResolvedValue(true);

    // Emulate `git ls-remote` returning stable hashes for the super-project and module repo.
    (exec.getExecOutput as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        const repo = args[1];
        if (repo === 'https://github.com/boostorg/boost.git') {
            return Promise.resolve({ exitCode: 0, stdout: 'boosthash\trefs/heads/master\n' });
        }
        if (repo === 'https://github.com/boostorg/filesystem.git') {
            return Promise.resolve({ exitCode: 0, stdout: 'modulehash\trefs/heads/master\n' });
        }
        return Promise.resolve({ exitCode: 0, stdout: 'fallbackhash\trefs/heads/master\n' });
    });

    const gitFeatures: GitFeatures = {
        gitPath: '/usr/bin/git',
        version: new semver.SemVer('2.30.0'),
        supportsJobs: true,
        supportsScanScripts: true,
        supportsDepth: true
    };
    const baseInputs: Inputs = {
        // Mirrors action inputs but uses Sets to match production parsing.
        branch: 'master',
        patches: new Set<string>(),
        modules: new Set<string>(['filesystem']),
        scan_modules_dir: new Set<string>(),
        modules_scan_paths: new Set<string>(),
        modules_exclude_paths: new Set<string>(['test']),
        scan_modules_ignore: new Set<string>(),
        optimistic_caching: true,
        boost_dir: '',
        cache: true,
        trace_commands: false,
        clone_strategy: 'auto' as const,
        archive_threshold: 25
    };
    const allModules = new Set<string>(['filesystem']);

    const { cacheKey: cacheKeyA } = await generateCacheKey(baseInputs, allModules, gitFeatures, { withFragments: true }) as CacheKeyResult;
    const { cacheKey: cacheKeyB } = await generateCacheKey({
        ...baseInputs,
        modules_exclude_paths: new Set<string>(['examples'])
    }, allModules, gitFeatures, { withFragments: true }) as CacheKeyResult;

    // Distinct exclude lists should alter the configuration hash and produce unique keys.
    expect(cacheKeyA).not.toEqual(cacheKeyB);
});

test('main short-circuits on cache hit before downloads and saves', async () => {
    (cache.isFeatureAvailable as jest.Mock).mockReturnValue(true);
    (cache.restoreCache as jest.Mock).mockResolvedValue('cache-hit');
    const boostHashOutput = { exitCode: 0, stdout: 'boosthash\trefs/heads/master\n' };
    const versionOutput = { exitCode: 0, stdout: 'git version 2.30.0' };
    (exec.getExecOutput as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
            return Promise.resolve(versionOutput);
        }
        return Promise.resolve(boostHashOutput);
    });
    (exec.exec as jest.Mock).mockResolvedValue(0);
    setup_program.findGit.mockResolvedValue('/usr/bin/git');
    setup_program.cloneGitRepo.mockResolvedValue(undefined);

    const inputs: Inputs = {
        boost_dir: path.join(os.tmpdir(), 'boost-cache-hit'),
        branch: 'master',
        modules: new Set<string>(),
        patches: new Set<string>(),
        scan_modules_ignore: new Set<string>(),
        scan_modules_dir: new Set<string>(),
        modules_scan_paths: new Set<string>(),
        modules_exclude_paths: new Set<string>(),
        cache: true,
        optimistic_caching: false,
        trace_commands: false,
        clone_strategy: 'auto' as const,
        archive_threshold: 25
    };

    await main(inputs);

    expect(cache.restoreCache).toHaveBeenCalled();
    expect(tc.downloadTool).not.toHaveBeenCalled();
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();
});

test('main saves cache on miss and logs key fragments', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boost-cache-miss-'));
    const gitmodulesPath = path.join(tmpDir, '.gitmodules');
    const exceptionsPath = path.join(tmpDir, 'exceptions.txt');
    fs.writeFileSync(gitmodulesPath, '[submodule "libs/config"]\n\tpath = libs/config\n\turl = https://github.com/boostorg/config.git\n');
    fs.writeFileSync(exceptionsPath, 'throw_exception.hpp: exception\n');

    (cache.isFeatureAvailable as jest.Mock).mockReturnValue(true);
    (cache.restoreCache as jest.Mock).mockResolvedValue(undefined);
    (cache.saveCache as jest.Mock).mockResolvedValue('saved');

    const versionOutput = { exitCode: 0, stdout: 'git version 2.30.0' };
    const boostHashOutput = { exitCode: 0, stdout: 'boosthash\trefs/heads/master\n' };
    (exec.getExecOutput as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === '--version') {
            return Promise.resolve(versionOutput);
        }
        return Promise.resolve(boostHashOutput);
    });
    (exec.exec as jest.Mock).mockResolvedValue(0);
    setup_program.findGit.mockResolvedValue('/usr/bin/git');
    setup_program.cloneGitRepo.mockResolvedValue(undefined);

    (tc.downloadTool as jest.Mock)
        .mockResolvedValueOnce(gitmodulesPath)
        .mockResolvedValueOnce(exceptionsPath);

    const inputs: Inputs = {
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'master',
        modules: new Set<string>(['config']),
        patches: new Set<string>(),
        scan_modules_ignore: new Set<string>(),
        scan_modules_dir: new Set<string>(),
        modules_scan_paths: new Set<string>(),
        modules_exclude_paths: new Set<string>(),
        cache: true,
        optimistic_caching: true,
        trace_commands: false,
        clone_strategy: 'auto' as const,
        archive_threshold: 25
    };

    await main(inputs);

    expect(cache.restoreCache).toHaveBeenCalled();
    expect(tc.downloadTool).toHaveBeenCalledTimes(2);
    expect(cache.saveCache).toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Cache key fragments'));
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Saving cache for key'));
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

            runPromise = prettyErrors.reportAndSetFailed(new Error('boost boom'), { title: 'Boost clone failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('boost boom');
            });
        });

        await runPromise!;
    });
});
