jest.mock('@actions/core', () => ({
    info: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn().mockResolvedValue(0)
}));

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
}));

jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined)
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as fsp from 'fs/promises';
import { getArchiveUrl, downloadAndExtractArchive } from './archive';

describe('getArchiveUrl', () => {
    test('generates correct URL for a release tag', () => {
        const url = getArchiveUrl('boost-1.87.0');
        expect(url).toBe(
            'https://github.com/boostorg/boost/releases/download/boost-1.87.0/boost-1.87.0-cmake.tar.xz'
        );
    });

    test('generates correct URL for a different release tag', () => {
        const url = getArchiveUrl('boost-1.84.0');
        expect(url).toBe(
            'https://github.com/boostorg/boost/releases/download/boost-1.84.0/boost-1.84.0-cmake.tar.xz'
        );
    });
});

describe('downloadAndExtractArchive', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (tc.downloadTool as jest.Mock).mockResolvedValue('/tmp/archive.tar.xz');
    });

    test('downloads archive using tool-cache', async () => {
        await downloadAndExtractArchive('https://example.com/archive.tar.xz', '/target');
        expect(tc.downloadTool).toHaveBeenCalledWith('https://example.com/archive.tar.xz');
    });

    test('creates target directory recursively', async () => {
        await downloadAndExtractArchive('https://example.com/archive.tar.xz', '/target/dir');
        expect(fsp.mkdir).toHaveBeenCalledWith('/target/dir', { recursive: true });
    });

    test('extracts archive with tar stripping first component', async () => {
        await downloadAndExtractArchive('https://example.com/archive.tar.xz', '/target');
        expect(exec.exec).toHaveBeenCalledWith('tar', [
            '-xf', '/tmp/archive.tar.xz',
            '-C', '/target',
            '--strip-components=1'
        ]);
    });

    test('logs download and extraction info', async () => {
        await downloadAndExtractArchive('https://example.com/archive.tar.xz', '/target');
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloading'));
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Downloaded to'));
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Extracting'));
        expect(core.info).toHaveBeenCalledWith('Archive extracted successfully');
    });
});
