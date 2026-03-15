jest.mock('@actions/exec', () => ({
    exec: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('gh-inputs', () => ({
    makeValueString: jest.fn((s: Set<string>) => [...s].join(', '))
}));

jest.mock('./header-scan', () => ({
    scanBoostDependencies: jest.fn()
}));

import * as exec from '@actions/exec';
import type { Inputs } from './schema';
import type { GitFeatures } from './git-utils';
import { numberOfCpus, initializeSubmodules, initializeAllSubmodules } from './submodules';
import { scanBoostDependencies } from './header-scan';

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

/**
 * Builds a GitFeatures object with defaults.
 *
 * @param overrides - Fields to override
 * @returns A populated GitFeatures object
 */
function makeGitFeatures(overrides: Partial<GitFeatures> = {}): GitFeatures {
    return {
        gitPath: '/usr/bin/git',
        version: { major: 2, minor: 30, patch: 0 } as GitFeatures['version'],
        supportsJobs: true,
        supportsScanScripts: false,
        supportsDepth: true,
        ...overrides
    };
}

describe('numberOfCpus', () => {
    it('returns cpu count >= 1', () => {
        const result = numberOfCpus();
        expect(result).toBeGreaterThanOrEqual(1);
    });

    it('returns 1 when os reports 0 cpus', () => {
        const osModule = require('os');
        const origCpus = osModule.cpus;
        const origParallelism = osModule.availableParallelism;
        osModule.cpus = () => [];
        osModule.availableParallelism = () => 0;
        try {
            expect(numberOfCpus()).toBe(1);
        } finally {
            osModule.cpus = origCpus;
            osModule.availableParallelism = origParallelism;
        }
    });
});

describe('initializeSubmodules', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('initializes requested modules plus essentials', async () => {
        const mockScan = scanBoostDependencies as jest.Mock;
        mockScan.mockResolvedValue(new Set<string>());

        const inputs = makeInputs();
        const modules = new Set(['filesystem', 'system']);
        const gitFeatures = makeGitFeatures();
        const exceptions = {};
        const submodulePaths = new Set(['libs/filesystem', 'libs/system', 'libs/config', 'libs/headers']);

        const result = await initializeSubmodules(inputs, modules, gitFeatures, exceptions, submodulePaths);

        expect(exec.exec).toHaveBeenCalledTimes(1);
        const args = (exec.exec as jest.Mock).mock.calls[0][1];
        expect(args).toContain('--init');
        expect(args).toContain('libs/filesystem');
        expect(args).toContain('libs/system');
        expect(args).toContain('libs/config');
        expect(args).toContain('libs/headers');
        expect(result.initialized).toContain('filesystem');
        expect(result.initialized).toContain('system');
        expect(result.initialized).toContain('config');
    });

    it('discovers transitive dependencies and initializes them', async () => {
        const mockScan = scanBoostDependencies as jest.Mock;
        // First layer: filesystem depends on system
        mockScan.mockImplementation(async (modulePath: string) => {
            if (modulePath.includes('filesystem')) {
                return new Set(['system', 'core']);
            }
            return new Set<string>();
        });

        const inputs = makeInputs();
        const modules = new Set(['filesystem']);
        const gitFeatures = makeGitFeatures();
        const exceptions = {};
        const submodulePaths = new Set(['libs/filesystem', 'libs/system', 'libs/core', 'libs/config', 'libs/headers']);

        const result = await initializeSubmodules(inputs, modules, gitFeatures, exceptions, submodulePaths);

        // Should have called exec twice: once for initial modules, once for discovered deps
        expect(exec.exec).toHaveBeenCalledTimes(2);
        // Second call should init the newly discovered deps (core - system is already essential via config)
        const secondArgs = (exec.exec as jest.Mock).mock.calls[1][1];
        expect(secondArgs).toContain('--init');

        // All modules should be in the result
        expect(result.initialized).toContain('filesystem');
        expect(result.initialized).toContain('core');
        expect(result.discoveredDeps.get('filesystem')).toEqual(['core', 'system']);
    });

    it('skips patch modules from git submodule init but includes them in scan', async () => {
        const mockScan = scanBoostDependencies as jest.Mock;
        mockScan.mockResolvedValue(new Set<string>());

        const inputs = makeInputs();
        const modules = new Set(['filesystem', 'mypatch']);
        const gitFeatures = makeGitFeatures();
        const patchNames = new Set(['mypatch']);

        const result = await initializeSubmodules(
            inputs, modules, gitFeatures, {}, new Set(), patchNames
        );

        // mypatch should NOT appear in git submodule update args
        const args = (exec.exec as jest.Mock).mock.calls[0][1];
        expect(args).not.toContain('libs/mypatch');

        // But mypatch should be in initialized set (seeded for scanning)
        expect(result.initialized).toContain('mypatch');
    });

    it('uses preScannedDeps to skip scanning already-known modules', async () => {
        const mockScan = scanBoostDependencies as jest.Mock;
        mockScan.mockResolvedValue(new Set<string>());

        const inputs = makeInputs();
        const modules = new Set(['filesystem', 'system']);
        const gitFeatures = makeGitFeatures();
        const preScannedDeps = new Map([
            ['filesystem', ['core', 'system']]
        ]);

        const result = await initializeSubmodules(
            inputs, modules, gitFeatures, {}, new Set(), new Set(), preScannedDeps
        );

        // filesystem should NOT be scanned (it's in preScannedDeps)
        // Only system and essential modules should be scanned
        const pathMod = require('path');
        const scannedModules = mockScan.mock.calls.map(
            (call: unknown[]) => pathMod.basename(call[0] as string)
        );
        expect(scannedModules).not.toContain('filesystem');

        // The preScannedDeps should be in the result
        expect(result.discoveredDeps.get('filesystem')).toEqual(['core', 'system']);
    });

    it('handles multi-layer transitive dependency discovery', async () => {
        const path = require('path');
        const mockScan = scanBoostDependencies as jest.Mock;
        // Layer 1: a depends on b (new)
        // Layer 2: b depends on c (new)
        // Layer 3: c has no new deps
        mockScan.mockImplementation(async (modulePath: string) => {
            const mod = path.basename(modulePath);
            if (mod === 'a') return new Set(['b']);
            if (mod === 'b') return new Set(['c']);
            return new Set<string>();
        });

        const inputs = makeInputs();
        const modules = new Set(['a']);
        const gitFeatures = makeGitFeatures();

        const result = await initializeSubmodules(
            inputs, modules, gitFeatures, {}, new Set(), new Set()
        );

        // Should discover a -> b -> c
        expect(result.initialized).toContain('a');
        expect(result.initialized).toContain('b');
        expect(result.initialized).toContain('c');
        // 3 exec calls: initial (a + essentials), layer 2 (b), layer 3 (c)
        expect(exec.exec).toHaveBeenCalledTimes(3);
    });
});

describe('initializeAllSubmodules', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('calls git submodule update --init --recursive', async () => {
        const inputs = makeInputs();
        const gitFeatures = makeGitFeatures();

        await initializeAllSubmodules(inputs, gitFeatures);

        expect(exec.exec).toHaveBeenCalledTimes(1);
        const args = (exec.exec as jest.Mock).mock.calls[0][1];
        expect(args).toContain('submodule');
        expect(args).toContain('update');
        expect(args).toContain('--init');
        expect(args).toContain('--recursive');
    });

    it('includes --jobs and --depth args when supported', async () => {
        const inputs = makeInputs();
        const gitFeatures = makeGitFeatures({ supportsJobs: true, supportsDepth: true });

        await initializeAllSubmodules(inputs, gitFeatures);

        const args = (exec.exec as jest.Mock).mock.calls[0][1];
        expect(args).toContain('--jobs');
        expect(args).toContain('--depth');
    });

    it('omits --jobs and --depth when not supported', async () => {
        const inputs = makeInputs();
        const gitFeatures = makeGitFeatures({ supportsJobs: false, supportsDepth: false });

        await initializeAllSubmodules(inputs, gitFeatures);

        const args = (exec.exec as jest.Mock).mock.calls[0][1];
        expect(args).not.toContain('--jobs');
        expect(args).not.toContain('--depth');
    });

    it('runs in boostDir', async () => {
        const inputs = makeInputs({ boostDir: '/custom/boost' });
        const gitFeatures = makeGitFeatures();

        await initializeAllSubmodules(inputs, gitFeatures);

        const opts = (exec.exec as jest.Mock).mock.calls[0][2];
        expect(opts.cwd).toBe('/custom/boost');
    });
});
