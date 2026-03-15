jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn(),
    exec: jest.fn()
}));

jest.mock('setup-program', () => ({
    findGit: jest.fn(),
    cloneGitRepo: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as setup_program from 'setup-program';
import { findGitFeatures, cloneRepo, cloneBoostSuperproject, getRepoName, applyPatches } from './git-utils';
import type { Inputs } from './schema';

/**
 * Builds a complete Inputs object with defaults for testing.
 *
 * @param overrides - Fields to override
 * @returns A populated Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        boostDir: '/tmp/boost',
        branch: 'master',
        modules: new Set<string>(),
        patches: new Set<string>(),
        scanModulesDir: new Set<string>(),
        modulesScanPaths: new Set<string>(),
        modulesExcludePaths: new Set<string>(),
        scanModulesIgnore: new Set<string>(),
        cache: true,
        optimisticCaching: false,
        traceCommands: false,
        cloneStrategy: 'auto' as const,
        archiveThreshold: 25,
        ...overrides
    };
}

describe('findGitFeatures', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('throws when git is not found', async () => {
        (setup_program.findGit as jest.Mock).mockResolvedValue(null);
        await expect(findGitFeatures(makeInputs())).rejects.toThrow('Git not found');
    });

    it('returns features for a modern git', async () => {
        (setup_program.findGit as jest.Mock).mockResolvedValue('/usr/bin/git');
        (exec.getExecOutput as jest.Mock).mockResolvedValue({
            exitCode: 0,
            stdout: 'git version 2.30.0'
        });

        const result = await findGitFeatures(makeInputs());

        expect(result.gitPath).toBe('/usr/bin/git');
        expect(result.supportsJobs).toBe(true);
        expect(result.supportsDepth).toBe(true);
        expect(result.supportsScanScripts).toBe(false);
    });

    it('detects older git without jobs/depth support', async () => {
        (setup_program.findGit as jest.Mock).mockResolvedValue('/usr/bin/git');
        (exec.getExecOutput as jest.Mock).mockResolvedValue({
            exitCode: 0,
            stdout: 'git version 2.16.0'
        });

        const result = await findGitFeatures(makeInputs());

        expect(result.supportsJobs).toBe(false);
        expect(result.supportsDepth).toBe(false);
    });

    it('detects git 3.5+ with scan scripts support', async () => {
        (setup_program.findGit as jest.Mock).mockResolvedValue('/usr/bin/git');
        (exec.getExecOutput as jest.Mock).mockResolvedValue({
            exitCode: 0,
            stdout: 'git version 3.5.1'
        });

        const result = await findGitFeatures(makeInputs());

        expect(result.supportsScanScripts).toBe(true);
    });
});

describe('cloneRepo', () => {
    it('delegates to setup_program.cloneGitRepo', async () => {
        await cloneRepo('https://example.com/repo.git', '/tmp/dest', 'main');
        expect(setup_program.cloneGitRepo).toHaveBeenCalledWith(
            'https://example.com/repo.git', '/tmp/dest', 'main'
        );
    });
});

describe('cloneBoostSuperproject', () => {
    it('clones the boost super-project repo', async () => {
        const inputs = makeInputs({ boostDir: '/tmp/boost', branch: 'develop' });
        await cloneBoostSuperproject(inputs);
        expect(setup_program.cloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/boostorg/boost.git', '/tmp/boost', 'develop'
        );
    });
});

describe('getRepoName', () => {
    it('extracts name from HTTPS URL', () => {
        expect(getRepoName('https://github.com/boostorg/filesystem.git')).toBe('filesystem');
    });

    it('extracts name from URL without .git suffix', () => {
        expect(getRepoName('https://github.com/boostorg/filesystem')).toBe('filesystem');
    });

    it('strips trailing slash', () => {
        expect(getRepoName('https://github.com/boostorg/filesystem/')).toBe('filesystem');
    });

    it('strips query parameters', () => {
        expect(getRepoName('https://github.com/boostorg/filesystem.git?token=abc')).toBe('filesystem');
    });

    it('strips fragment identifiers', () => {
        expect(getRepoName('https://github.com/boostorg/filesystem.git#branch')).toBe('filesystem');
    });
});

describe('applyPatches', () => {
    let tmpDir: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'git-utils-test-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('clones a patch into libs directory', async () => {
        const inputs = makeInputs({
            boostDir: tmpDir,
            patches: new Set(['https://github.com/cppalliance/buffers.git'])
        });
        await fsp.mkdir(path.join(tmpDir, 'libs'), { recursive: true });

        await applyPatches(inputs);

        expect(setup_program.cloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/cppalliance/buffers.git',
            path.join(tmpDir, 'libs', 'buffers'),
            'master'
        );
    });

    it('removes existing directory before cloning', async () => {
        const patchDir = path.join(tmpDir, 'libs', 'buffers');
        await fsp.mkdir(patchDir, { recursive: true });
        await fsp.writeFile(path.join(patchDir, 'test.txt'), 'existing');

        const inputs = makeInputs({
            boostDir: tmpDir,
            patches: new Set(['https://github.com/cppalliance/buffers.git'])
        });

        await applyPatches(inputs);

        // The existing directory should have been removed and clone called
        expect(setup_program.cloneGitRepo).toHaveBeenCalled();
    });

    it('reuses pre-scanned directory when available via rename', async () => {
        const preScannedDir = path.join(tmpDir, 'prescanned-buffers');
        await fsp.mkdir(preScannedDir, { recursive: true });
        await fsp.writeFile(path.join(preScannedDir, 'marker.txt'), 'prescanned');

        await fsp.mkdir(path.join(tmpDir, 'libs'), { recursive: true });

        const inputs = makeInputs({
            boostDir: tmpDir,
            patches: new Set(['https://github.com/cppalliance/buffers.git'])
        });
        const preScannedDirs = new Map([['buffers', preScannedDir]]);

        await applyPatches(inputs, preScannedDirs);

        // Should NOT have called cloneGitRepo since rename succeeded
        expect(setup_program.cloneGitRepo).not.toHaveBeenCalled();

        // The renamed directory should contain our marker
        const patchDir = path.join(tmpDir, 'libs', 'buffers');
        const marker = await fsp.readFile(path.join(patchDir, 'marker.txt'), 'utf8');
        expect(marker).toBe('prescanned');

        // preScannedDirs should have the entry deleted
        expect(preScannedDirs.has('buffers')).toBe(false);
    });

    it('falls back to clone when rename fails (cross-filesystem)', async () => {
        // Create a pre-scanned dir that will fail on rename
        // Use a path that doesn't exist to cause rename to fail
        const fakePath = '/nonexistent-mount/prescanned-buffers';

        await fsp.mkdir(path.join(tmpDir, 'libs'), { recursive: true });

        const inputs = makeInputs({
            boostDir: tmpDir,
            patches: new Set(['https://github.com/cppalliance/buffers.git'])
        });
        const preScannedDirs = new Map([['buffers', fakePath]]);

        await applyPatches(inputs, preScannedDirs);

        // Should have fallen back to cloneGitRepo
        expect(setup_program.cloneGitRepo).toHaveBeenCalledWith(
            'https://github.com/cppalliance/buffers.git',
            path.join(tmpDir, 'libs', 'buffers'),
            'master'
        );
    });

    it('handles multiple patches in parallel', async () => {
        await fsp.mkdir(path.join(tmpDir, 'libs'), { recursive: true });

        const inputs = makeInputs({
            boostDir: tmpDir,
            patches: new Set([
                'https://github.com/cppalliance/buffers.git',
                'https://github.com/cppalliance/http-proto.git'
            ])
        });

        await applyPatches(inputs);

        expect(setup_program.cloneGitRepo).toHaveBeenCalledTimes(2);
    });
});
