import {
    uploadToCoveralls,
    type CoverallsUploadOptions
} from './upload-coveralls';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setSecret: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
}));

jest.mock('node:fs/promises', () => ({
    chmod: jest.fn().mockResolvedValue(undefined)
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as fs from 'node:fs/promises';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
>;
const mockDownloadTool = tc.downloadTool as jest.MockedFunction<
    typeof tc.downloadTool
>;
const mockChmod = fs.chmod as jest.MockedFunction<typeof fs.chmod>;

function makeOptions(
    overrides: Partial<CoverallsUploadOptions> = {}
): CoverallsUploadOptions {
    return {
        token: 'test-token',
        lcovFile: '/tmp/coverage.info',
        extraArgs: '',
        failOnError: false,
        ...overrides
    };
}

describe('uploadToCoveralls', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDownloadTool.mockResolvedValue('/tmp/coveralls');
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: ''
        });
    });

    it('downloads the Coveralls coverage-reporter binary', async () => {
        await uploadToCoveralls(makeOptions());

        expect(mockDownloadTool).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/github\.com\/coverallsapp\/coverage-reporter\/releases\/latest\/download\/coveralls-(linux|macos|windows)/)
        );
    });

    it('makes the downloaded binary executable', async () => {
        await uploadToCoveralls(makeOptions());

        expect(mockChmod).toHaveBeenCalledWith('/tmp/coveralls', 0o755);
    });

    it('invokes coverage-reporter with correct arguments', async () => {
        await uploadToCoveralls(makeOptions());

        expect(mockGetExecOutput).toHaveBeenCalledWith('/tmp/coveralls', [
            '--repo-token',
            'test-token',
            '--file',
            '/tmp/coverage.info'
        ]);
    });

    it('appends extra arguments when provided', async () => {
        await uploadToCoveralls(
            makeOptions({extraArgs: '--verbose --dry-run'})
        );

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            '/tmp/coveralls',
            expect.arrayContaining(['--verbose', '--dry-run'])
        );
    });

    it('ignores extra whitespace in extraArgs', async () => {
        await uploadToCoveralls(makeOptions({extraArgs: '  --verbose  '}));

        const args = mockGetExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('--verbose');
        expect(args.filter((a) => a === '')).toHaveLength(0);
    });

    it('warns on failure when failOnError is false', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('upload failed'));

        await uploadToCoveralls(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Coveralls upload failed')
        );
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('upload failed')
        );
    });

    it('throws on failure when failOnError is true', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('upload failed'));

        await expect(
            uploadToCoveralls(makeOptions({failOnError: true}))
        ).rejects.toThrow('Coveralls upload failed');
    });

    it('handles non-Error throw values', async () => {
        mockGetExecOutput.mockRejectedValue('string error');

        await uploadToCoveralls(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('string error')
        );
    });

    it('handles download failure when failOnError is false', async () => {
        mockDownloadTool.mockRejectedValue(new Error('download failed'));

        await uploadToCoveralls(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('download failed')
        );
    });

    it('handles download failure when failOnError is true', async () => {
        mockDownloadTool.mockRejectedValue(new Error('download failed'));

        await expect(
            uploadToCoveralls(makeOptions({failOnError: true}))
        ).rejects.toThrow('Coveralls upload failed');
    });

    it('wraps operation in core.startGroup/endGroup', async () => {
        await uploadToCoveralls(makeOptions());

        expect(core.startGroup).toHaveBeenCalledWith('☁️ Upload to Coveralls');
        expect(core.endGroup).toHaveBeenCalled();
    });

    it('closes the group even on failure', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('fail'));

        await uploadToCoveralls(makeOptions({failOnError: false}));

        expect(core.endGroup).toHaveBeenCalled();
    });

    it('closes the group even when throwing', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('fail'));

        try {
            await uploadToCoveralls(makeOptions({failOnError: true}));
        } catch {
            // expected
        }

        expect(core.endGroup).toHaveBeenCalled();
    });

    it('logs success message on successful upload', async () => {
        await uploadToCoveralls(makeOptions());

        expect(core.info).toHaveBeenCalledWith(
            'Coverage uploaded to Coveralls successfully.'
        );
    });
});
