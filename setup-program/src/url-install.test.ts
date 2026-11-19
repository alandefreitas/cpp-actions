jest.mock('@actions/core', () => ({
    exportVariable: jest.fn(),
    addPath: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    cacheDir: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('./download-utils', () => ({
    downloadAndExtract: jest.fn(),
    stripSingleDirectoryFromPath: jest.fn()
}));

jest.mock('./file-utils', () => ({
    getAllSubdirectories: jest.fn()
}));

jest.mock('./system-utils', () => ({
    moveWithPermissions: jest.fn()
}));

jest.mock('package-install', () => ({
    findProgramInPaths: jest.fn()
}));

import * as path from 'path';
import * as fs from 'fs';
import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as traceCommands from 'trace-commands';
import * as packageInstall from 'package-install';

import { downloadAndExtract, stripSingleDirectoryFromPath } from './download-utils';
import { getAllSubdirectories } from './file-utils';
import { moveWithPermissions } from './system-utils';
import { installProgramFromUrl } from './url-install';

const mockExportVariable = core.exportVariable as jest.MockedFunction<typeof core.exportVariable>;
const mockAddPath = core.addPath as jest.MockedFunction<typeof core.addPath>;
const mockCacheDir = tc.cacheDir as jest.MockedFunction<typeof tc.cacheDir>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockDownloadAndExtract = downloadAndExtract as jest.MockedFunction<typeof downloadAndExtract>;
const mockStrip = stripSingleDirectoryFromPath as jest.MockedFunction<typeof stripSingleDirectoryFromPath>;
const mockGetAllSubdirectories = getAllSubdirectories as jest.MockedFunction<typeof getAllSubdirectories>;
const mockMoveWithPermissions = moveWithPermissions as jest.MockedFunction<typeof moveWithPermissions>;
const mockFindProgramInPaths = packageInstall.findProgramInPaths as jest.Mock;

const originalPlatform = process.platform;
const extPath = path.join('tmp', 'extracted');
const cachePath = path.join('toolcache', 'cmake', '3.27.1');

beforeEach(() => {
    jest.resetAllMocks();
    (traceCommands.scoped as jest.Mock).mockReturnValue(jest.fn());
    mockDownloadAndExtract.mockResolvedValue(extPath);
    mockStrip.mockResolvedValue(false);
    mockCacheDir.mockResolvedValue(cachePath);
    mockGetAllSubdirectories.mockReturnValue([]);
    mockExistsSync.mockReturnValue(false);
    mockFindProgramInPaths.mockResolvedValue({ outputVersion: null, outputPath: null });
});

afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('installProgramFromUrl', () => {
    it('renders every template placeholder before downloading', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const template = 'https://example.com/{{name}}/v{{version}}/{{name}}-{{major}}.{{minor}}.{{patch}}-{{os}}-{{platform}}-{{arch}}.tar.gz';

        await installProgramFromUrl(['cmake'], '3.27.1', false, template, false, null);

        expect(mockDownloadAndExtract).toHaveBeenCalledWith(
            `https://example.com/cmake/v3.27.1/cmake-3.27.1-linux-linux-${process.arch}.tar.gz`);
    });

    it('uses the macOS runner name for {{os}} on darwin', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        await installProgramFromUrl(['ninja'], '1.11', false, 'https://example.com/ninja-{{os}}.zip', false, null);

        expect(mockDownloadAndExtract).toHaveBeenCalledWith('https://example.com/ninja-macos.zip');
    });

    it('passes a URL without placeholders through unchanged', async () => {
        await installProgramFromUrl(['tool'], '*', false, 'https://example.com/tool.zip', false, null);

        expect(mockDownloadAndExtract).toHaveBeenCalledWith('https://example.com/tool.zip');
    });

    it('returns nulls without installing when the download fails', async () => {
        mockDownloadAndExtract.mockResolvedValue(undefined);

        const result = await installProgramFromUrl(['tool'], '1.0.0', false, 'https://example.com/tool.zip', true, null);

        expect(result).toEqual({ outputVersion: null, outputPath: null });
        expect(mockStrip).not.toHaveBeenCalled();
        expect(mockExportVariable).not.toHaveBeenCalled();
        expect(mockCacheDir).not.toHaveBeenCalled();
    });

    it('caches the extracted directory and searches the cache for the executable', async () => {
        mockStrip.mockResolvedValue(true);
        const subdirs = [path.join(cachePath, 'share'), path.join(cachePath, 'share', 'doc')];
        mockGetAllSubdirectories.mockReturnValue(subdirs);
        const exe = path.join(cachePath, 'bin', 'cmake');
        mockFindProgramInPaths.mockResolvedValue({ outputVersion: '3.27.1', outputPath: exe });

        const result = await installProgramFromUrl(['cmake', 'cmake3'], '3.27.1', true, 'https://example.com/cmake.tar.gz', false, null);

        expect(result).toEqual({ outputVersion: '3.27.1', outputPath: exe });
        expect(mockStrip).toHaveBeenCalledWith(extPath);
        expect(mockExportVariable).toHaveBeenCalledWith('CMAKE_ROOT', extPath);
        expect(mockExportVariable).toHaveBeenCalledWith('CMAKE3_ROOT', extPath);
        expect(mockCacheDir).toHaveBeenCalledWith(extPath, 'cmake', '3.27.1');
        expect(mockMoveWithPermissions).not.toHaveBeenCalled();
        expect(mockGetAllSubdirectories).toHaveBeenCalledWith(cachePath);
        expect(mockFindProgramInPaths).toHaveBeenCalledWith(
            [cachePath, path.join(cachePath, 'bin'), ...subdirs],
            ['cmake', 'cmake3'],
            '*',
            true,
            true);
        expect(mockAddPath).not.toHaveBeenCalled();
    });

    it('caches under version 0.0.0 when the version is not a semver', async () => {
        await installProgramFromUrl(['tool'], '*', false, 'https://example.com/tool.zip', false, null);

        expect(mockCacheDir).toHaveBeenCalledWith(extPath, 'tool', '0.0.0');
    });

    it('moves the files into the install prefix instead of the tool cache', async () => {
        const prefix = path.join('opt', 'tool');
        mockMoveWithPermissions.mockResolvedValue(true);

        await installProgramFromUrl(['tool'], '2.0.0', false, 'https://example.com/tool.zip', false, prefix);

        expect(mockMoveWithPermissions).toHaveBeenCalledWith(extPath, prefix);
        expect(mockCacheDir).not.toHaveBeenCalled();
        expect(mockFindProgramInPaths.mock.calls[0][0].slice(0, 2)).toEqual([prefix, path.join(prefix, 'bin')]);
    });

    it('aborts with nulls when moving into the install prefix fails', async () => {
        mockMoveWithPermissions.mockResolvedValue(false);

        const result = await installProgramFromUrl(['tool'], '2.0.0', false, 'https://example.com/tool.zip', true, path.join('opt', 'tool'));

        expect(result).toEqual({ outputVersion: null, outputPath: null });
        expect(mockAddPath).not.toHaveBeenCalled();
        expect(mockFindProgramInPaths).not.toHaveBeenCalled();
    });

    it('adds the install directory and its bin directory to PATH when bin exists', async () => {
        mockExistsSync.mockReturnValue(true);

        await installProgramFromUrl(['cmake'], '3.27.1', false, 'https://example.com/cmake.zip', true, null);

        expect(mockExistsSync).toHaveBeenCalledWith(path.join(cachePath, 'bin'));
        expect(mockAddPath.mock.calls).toEqual([[cachePath], [path.join(cachePath, 'bin')]]);
    });

    it('adds only the install directory to PATH when there is no bin directory', async () => {
        mockExistsSync.mockReturnValue(false);

        await installProgramFromUrl(['cmake'], '3.27.1', false, 'https://example.com/cmake.zip', true, null);

        expect(mockAddPath.mock.calls).toEqual([[cachePath]]);
    });
});
