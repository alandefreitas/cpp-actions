import { describePrettyErrors } from 'pretty-errors/test-helper';

describePrettyErrors('cmake boom', 'Setup CMake failed');

// --- Tests for main() / SetupCmakeRunner ---

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    error: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    findAllVersions: jest.fn().mockReturnValue([])
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn().mockReturnValue(jest.fn())
}));

jest.mock('setup-program', () => ({
    findCMakeVersions: jest.fn(),
    findProgramInPath: jest.fn(),
    findProgramInSystemPaths: jest.fn(),
    installProgramFromUrl: jest.fn(),
    isSudoRequired: jest.fn().mockReturnValue(false)
}));

jest.mock('package-install', () => ({
    findProgramWithApt: jest.fn()
}));

jest.mock('./system-utils', () => ({
    ensureGit: jest.fn().mockResolvedValue('/usr/bin/git')
}));

jest.mock('./version-resolve', () => ({
    updateCMakeVersionFromFile: jest.fn().mockImplementation((_file: string, version: string) => version)
}));

jest.mock('./url-generation', () => ({
    generateCMakeURL: jest.fn().mockReturnValue('https://cmake.org/files/v3.28/cmake-3.28.0-linux-x86_64.tar.gz')
}));

import * as path from 'path';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as setup_program from 'setup-program';
import * as package_install from 'package-install';
import { main, type Inputs } from './index';
import { ensureGit } from './system-utils';
import { updateCMakeVersionFromFile } from './version-resolve';
import { generateCMakeURL } from './url-generation';

const mockFindCMakeVersions = setup_program.findCMakeVersions as jest.Mock;
const mockFindInPath = setup_program.findProgramInPath as jest.Mock;
const mockFindInSystem = setup_program.findProgramInSystemPaths as jest.Mock;
const mockFindWithApt = package_install.findProgramWithApt as jest.Mock;
const mockInstallFromUrl = setup_program.installProgramFromUrl as jest.Mock;

const defaultVersions = ['3.18.0', '3.19.8', '3.20.0', '3.20.6', '3.21.7', '3.22.0', '3.23.5', '3.24.4', '3.25.3', '3.26.0', '3.27.0', '3.28.0'];

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        version: '>=3.20.0',
        architecture: '',
        cmakeFile: 'CMakeLists.txt',
        path: '',
        cmakePath: '',
        cache: true,
        checkLatest: false,
        updateEnvironment: true,
        traceCommands: false,
        ...overrides
    };
}

/** Set up default mocks so all searches fail */
function setupDefaultMocks(): void {
    mockFindCMakeVersions.mockResolvedValue(defaultVersions);
    mockFindInPath.mockResolvedValue({ outputVersion: null, outputPath: null });
    mockFindInSystem.mockResolvedValue({ outputVersion: null, outputPath: null });
    mockFindWithApt.mockResolvedValue({ outputVersion: null, outputPath: null });
    mockInstallFromUrl.mockResolvedValue({ outputVersion: null, outputPath: null });
}

describe('main (SetupCmakeRunner)', () => {
    const origPlatform = process.platform;
    const savedEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        setupDefaultMocks();
        process.env = { ...savedEnv };
        Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    afterEach(() => {
        process.env = savedEnv;
        Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('calls ensureGit at startup', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(ensureGit).toHaveBeenCalled();
    });

    test('discovers versions from setup_program', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(setup_program.findCMakeVersions).toHaveBeenCalled();
    });

    test('searches user paths when path is set', async () => {
        mockFindInPath.mockResolvedValue({ outputVersion: '3.25.0', outputPath: '/custom/bin/cmake' });
        const outputs = await main(makeInputs({ path: '/custom/bin' }));
        expect(setup_program.findProgramInPath).toHaveBeenCalled();
        expect(outputs.path).toBe('/custom/bin/cmake');
        expect(outputs.version).toBe('3.25.0');
    });

    test('applies cmakePath alias to path', async () => {
        mockFindInPath.mockResolvedValue({ outputVersion: '3.24.0', outputPath: '/alias/bin/cmake' });
        const outputs = await main(makeInputs({ cmakePath: '/alias/bin', path: '' }));
        expect(setup_program.findProgramInPath).toHaveBeenCalled();
        expect(outputs.path).toBe('/alias/bin/cmake');
    });

    test('skips user path search when path is empty', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs({ path: '' }));
        expect(setup_program.findProgramInPath).not.toHaveBeenCalled();
    });

    test('searches system paths when user path finds nothing', async () => {
        mockFindInSystem.mockResolvedValue({ outputVersion: '3.22.0', outputPath: '/usr/bin/cmake' });
        const outputs = await main(makeInputs());
        expect(setup_program.findProgramInSystemPaths).toHaveBeenCalled();
        expect(outputs.version).toBe('3.22.0');
    });

    test('adds CMAKE_ROOT to extra system paths', async () => {
        process.env['CMAKE_ROOT'] = '/opt/cmake';
        mockFindInSystem.mockResolvedValue({ outputVersion: '3.26.0', outputPath: '/opt/cmake/bin/cmake' });
        await main(makeInputs());
        const call = mockFindInSystem.mock.calls[0];
        expect(call[0]).toContain('/opt/cmake');
        expect(call[0]).toContain(path.join('/opt/cmake', 'bin'));
    });

    test('adds tool cache paths to extra system paths', async () => {
        (tc.findAllVersions as jest.Mock).mockReturnValue(['/hostedtoolcache/CMake/3.27.0']);
        mockFindInSystem.mockResolvedValue({ outputVersion: '3.27.0', outputPath: '/hostedtoolcache/CMake/3.27.0/cmake' });
        await main(makeInputs());
        const call = mockFindInSystem.mock.calls[0];
        expect(call[0]).toContain('/hostedtoolcache/CMake/3.27.0');
    });

    test('searches APT on linux when system paths find nothing', async () => {
        mockFindWithApt.mockResolvedValue({ outputVersion: '3.22.0', outputPath: '/usr/bin/cmake' });
        const outputs = await main(makeInputs());
        expect(package_install.findProgramWithApt).toHaveBeenCalled();
        expect(outputs.version).toBe('3.22.0');
    });

    test('skips APT search on non-linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(package_install.findProgramWithApt).not.toHaveBeenCalled();
    });

    test('downloads from URL when all searches fail', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.20.0', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs());
        expect(setup_program.installProgramFromUrl).toHaveBeenCalled();
        expect(generateCMakeURL).toHaveBeenCalled();
        expect(outputs.version).toBe('3.20.0');
    });

    test('uses checkLatest to pick maxSatisfying version for download', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs({ checkLatest: true }));
        expect(setup_program.installProgramFromUrl).toHaveBeenCalled();
    });

    test('throws on invalid version during download', async () => {
        mockFindCMakeVersions.mockResolvedValue([]);
        await expect(main(makeInputs({ version: 'not-semver' }))).rejects.toThrow('Invalid version');
    });

    test('buildOutputs returns correct capability flags for 3.28.0', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs());
        expect(outputs.versionMajor).toBe(3);
        expect(outputs.versionMinor).toBe(28);
        expect(outputs.versionPatch).toBe(0);
        expect(outputs.supportsPathToBuild).toBe(true);
        expect(outputs.supportsParallelBuild).toBe(true);
        expect(outputs.supportsBuildMultipleTargets).toBe(true);
        expect(outputs.supportsCmakeInstall).toBe(true);
        expect(outputs.supportedPresetsVersion).toBe(6);
        expect(outputs.cacheHit).toBe(false);
    });

    test('buildOutputs returns presets version 0 for old cmake', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.18.0']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.18.0', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.18.0' }));
        expect(outputs.supportedPresetsVersion).toBe(0);
    });

    test('buildOutputs returns empty object when no path found', async () => {
        const outputs = await main(makeInputs());
        expect(outputs).toEqual({});
        expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Could not find or install'));
    });

    test('throws when outputPath exists but outputVersion is null', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: null, outputPath: '/usr/bin/cmake' });
        await expect(main(makeInputs())).rejects.toThrow('No version found');
    });

    test('uses subgroups=true by default for log grouping', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(core.startGroup).toHaveBeenCalled();
        expect(core.endGroup).toHaveBeenCalled();
    });

    test('skips subgroups when subgroups=false', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs(), false);
        expect(core.startGroup).not.toHaveBeenCalled();
    });

    test('calls updateCMakeVersionFromFile with cmakeFile input', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs({ cmakeFile: 'path/to/CMakeLists.txt' }));
        expect(updateCMakeVersionFromFile).toHaveBeenCalledWith(
            'path/to/CMakeLists.txt',
            expect.any(String),
            expect.any(Array)
        );
    });

    test('configures cache directory on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(process.env['AGENT_TOOLSDIRECTORY']).toBe('/Users/runner/hostedtoolcache');
    });

    test('sets RUNNER_TOOL_CACHE from AGENT_TOOLSDIRECTORY', async () => {
        process.env['AGENT_TOOLSDIRECTORY'] = '/custom/tools';
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.28.0', outputPath: '/usr/local/bin/cmake' });
        await main(makeInputs());
        expect(process.env['RUNNER_TOOL_CACHE']).toBe('/custom/tools');
    });

    test('skips system search when user path found cmake', async () => {
        mockFindInPath.mockResolvedValue({ outputVersion: '3.25.0', outputPath: '/custom/cmake' });
        await main(makeInputs({ path: '/custom' }));
        expect(setup_program.findProgramInSystemPaths).not.toHaveBeenCalled();
    });

    test('presets version 5 for cmake 3.24.4', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.24.4']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.24.4', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.24.4' }));
        expect(outputs.supportedPresetsVersion).toBe(5);
    });

    test('presets version 4 for cmake 3.23.5', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.23.5']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.23.5', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.23.5' }));
        expect(outputs.supportedPresetsVersion).toBe(4);
    });

    test('presets version 3 for cmake 3.21.7', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.21.7']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.21.7', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.21.7' }));
        expect(outputs.supportedPresetsVersion).toBe(3);
    });

    test('presets version 2 for cmake 3.20.6', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.20.6']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.20.6', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.20.6' }));
        expect(outputs.supportedPresetsVersion).toBe(2);
    });

    test('presets version 1 for cmake 3.19.8', async () => {
        mockFindCMakeVersions.mockResolvedValue(['3.19.8']);
        mockInstallFromUrl.mockResolvedValue({ outputVersion: '3.19.8', outputPath: '/usr/local/bin/cmake' });
        const outputs = await main(makeInputs({ version: '3.19.8' }));
        expect(outputs.supportedPresetsVersion).toBe(1);
    });

    test('throws when outputVersion is not semver-coercible', async () => {
        mockInstallFromUrl.mockResolvedValue({ outputVersion: 'not-a-version', outputPath: '/usr/local/bin/cmake' });
        await expect(main(makeInputs())).rejects.toThrow('Invalid version: not-a-version');
    });
});
