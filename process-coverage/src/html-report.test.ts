import * as path from 'node:path';

import {generateHtmlReport, uploadHtmlArtifact} from './html-report';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

const mockUploadArtifact = jest.fn().mockResolvedValue({id: 1, size: 1024});
jest.mock('@actions/artifact', () => ({
    DefaultArtifactClient: jest.fn().mockImplementation(() => ({
        uploadArtifact: mockUploadArtifact
    }))
}));

const mockGlob = jest.fn();
jest.mock('@actions/glob', () => ({
    create: jest.fn().mockImplementation(() =>
        Promise.resolve({glob: mockGlob})
    )
}));

jest.mock('node:fs', () => ({
    lstatSync: jest.fn().mockReturnValue({isFile: () => true}),
    existsSync: jest.fn().mockReturnValue(true)
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
>;

describe('generateHtmlReport', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: ''
        });
    });

    it('runs genhtml with correct arguments', async () => {
        await generateHtmlReport('/tmp/lcov.info', '/tmp/html-report');

        expect(mockGetExecOutput).toHaveBeenCalledWith('genhtml', [
            '/tmp/lcov.info',
            '--output-directory',
            path.resolve('/tmp/html-report'),
            '--keep-going'
        ], {ignoreReturnCode: true});
    });

    it('returns the resolved output directory on success', async () => {
        const result = await generateHtmlReport(
            '/tmp/lcov.info',
            '/tmp/html-report'
        );
        expect(result).toBe(path.resolve('/tmp/html-report'));
    });

    it('uses provided genhtmlPath when specified', async () => {
        await generateHtmlReport(
            '/tmp/lcov.info',
            '/tmp/html-report',
            '/usr/bin/genhtml'
        );

        expect(mockGetExecOutput).toHaveBeenCalledWith('/usr/bin/genhtml', [
            '/tmp/lcov.info',
            '--output-directory',
            path.resolve('/tmp/html-report'),
            '--keep-going'
        ], {ignoreReturnCode: true});
    });

    it('defaults to "genhtml" when genhtmlPath is not provided', async () => {
        await generateHtmlReport('/tmp/lcov.info', '/tmp/html-report');

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            'genhtml',
            expect.any(Array),
            expect.any(Object)
        );
    });

    it('succeeds even when genhtml exits non-zero (--keep-going)', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'genhtml: ERROR: inconsistent data'
        });
        // existsSync returns true — genhtml produced output despite errors
        const fs = require('node:fs');
        fs.existsSync.mockReturnValue(true);

        const result = await generateHtmlReport('/tmp/lcov.info', '/tmp/html-report');

        expect(result).toBe(path.resolve('/tmp/html-report'));
    });

    it('returns empty string when genhtml produces no output', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'fatal error'
        });
        const fs = require('node:fs');
        fs.existsSync.mockReturnValue(false);

        const result = await generateHtmlReport(
            '/tmp/lcov.info',
            '/tmp/html-report'
        );

        expect(result).toBe('');
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Failed to generate HTML coverage report')
        );
    });

    it('handles exec throwing (genhtml not found)', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('genhtml not found'));

        const result = await generateHtmlReport(
            '/tmp/lcov.info',
            '/tmp/html-report'
        );

        expect(result).toBe('');
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Failed to generate HTML coverage report')
        );
    });

});

describe('uploadHtmlArtifact', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGlob.mockResolvedValue([
            '/tmp/report/index.html',
            '/tmp/report/style.css'
        ]);
        mockUploadArtifact.mockResolvedValue({id: 1, size: 1024});
    });

    it('uploads files from the report directory', async () => {
        await uploadHtmlArtifact('/tmp/report', 'coverage-report', 30);

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            'coverage-report',
            ['/tmp/report/index.html', '/tmp/report/style.css'],
            '/tmp/report',
            {retentionDays: 30}
        );
    });

    it('uses the provided artifact name and retention days', async () => {
        await uploadHtmlArtifact('/tmp/report', 'my-report', 7);

        expect(mockUploadArtifact).toHaveBeenCalledWith(
            'my-report',
            expect.any(Array),
            '/tmp/report',
            {retentionDays: 7}
        );
    });

    it('skips upload when reportDir is empty string', async () => {
        await uploadHtmlArtifact('', 'coverage-report', 30);

        expect(mockUploadArtifact).not.toHaveBeenCalled();
        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Skipping')
        );
    });

    it('warns and skips when report directory is empty', async () => {
        mockGlob.mockResolvedValue([]);

        await uploadHtmlArtifact('/tmp/report', 'coverage-report', 30);

        expect(mockUploadArtifact).not.toHaveBeenCalled();
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('empty')
        );
    });

    it('logs the number of uploaded files', async () => {
        await uploadHtmlArtifact('/tmp/report', 'coverage-report', 30);

        expect(core.info).toHaveBeenCalledWith(
            expect.stringContaining('2 files')
        );
    });
});
