import {uploadToCodecov, type CodecovUploadOptions} from './upload-codecov';

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
    overrides: Partial<CodecovUploadOptions> = {}
): CodecovUploadOptions {
    return {
        token: 'test-token',
        lcovFile: '/tmp/coverage.info',
        flags: '',
        extraArgs: '',
        failOnError: false,
        ...overrides
    };
}

describe('uploadToCodecov', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDownloadTool.mockResolvedValue('/tmp/codecov');
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: ''
        });
    });

    it('downloads the Codecov CLI binary', async () => {
        await uploadToCodecov(makeOptions());

        expect(mockDownloadTool).toHaveBeenCalledWith(
            expect.stringMatching(/^https:\/\/cli\.codecov\.io\/latest\/(linux|macos|windows)\/codecov/)
        );
    });

    it('makes the downloaded binary executable', async () => {
        await uploadToCodecov(makeOptions());

        expect(mockChmod).toHaveBeenCalledWith('/tmp/codecov', 0o755);
    });

    it('invokes codecov upload-process with correct arguments', async () => {
        await uploadToCodecov(makeOptions());

        expect(mockGetExecOutput).toHaveBeenCalledWith('/tmp/codecov', [
            'upload-process',
            '--git-service',
            'github',
            '--file',
            '/tmp/coverage.info',
            '--token',
            'test-token'
        ]);
    });

    it('includes --flag when flags are provided', async () => {
        await uploadToCodecov(makeOptions({flags: 'unittests'}));

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            '/tmp/codecov',
            expect.arrayContaining(['--flag', 'unittests'])
        );
    });

    it('appends extra arguments when provided', async () => {
        await uploadToCodecov(
            makeOptions({extraArgs: '--verbose --dry-run'})
        );

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            '/tmp/codecov',
            expect.arrayContaining(['--verbose', '--dry-run'])
        );
    });

    it('ignores extra whitespace in extraArgs', async () => {
        await uploadToCodecov(makeOptions({extraArgs: '  --verbose  '}));

        const args = mockGetExecOutput.mock.calls[0][1] as string[];
        expect(args).toContain('--verbose');
        expect(args.filter((a) => a === '')).toHaveLength(0);
    });

    it('warns on failure when failOnError is false', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('upload failed'));

        await uploadToCodecov(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Codecov upload failed')
        );
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('upload failed')
        );
    });

    it('throws on failure when failOnError is true', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('upload failed'));

        await expect(
            uploadToCodecov(makeOptions({failOnError: true}))
        ).rejects.toThrow('Codecov upload failed');
    });

    it('handles non-Error throw values', async () => {
        mockGetExecOutput.mockRejectedValue('string error');

        await uploadToCodecov(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('string error')
        );
    });

    it('handles download failure when failOnError is false', async () => {
        mockDownloadTool.mockRejectedValue(new Error('download failed'));

        await uploadToCodecov(makeOptions({failOnError: false}));

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('download failed')
        );
    });

    it('handles download failure when failOnError is true', async () => {
        mockDownloadTool.mockRejectedValue(new Error('download failed'));

        await expect(
            uploadToCodecov(makeOptions({failOnError: true}))
        ).rejects.toThrow('Codecov upload failed');
    });

    it('wraps operation in core.startGroup/endGroup', async () => {
        await uploadToCodecov(makeOptions());

        expect(core.startGroup).toHaveBeenCalledWith('☁️ Upload to Codecov');
        expect(core.endGroup).toHaveBeenCalled();
    });

    it('closes the group even on failure', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('fail'));

        await uploadToCodecov(makeOptions({failOnError: false}));

        expect(core.endGroup).toHaveBeenCalled();
    });

    it('closes the group even when throwing', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('fail'));

        try {
            await uploadToCodecov(makeOptions({failOnError: true}));
        } catch {
            // expected
        }

        expect(core.endGroup).toHaveBeenCalled();
    });

    it('logs success message on successful upload', async () => {
        await uploadToCodecov(makeOptions());

        expect(core.info).toHaveBeenCalledWith(
            'Coverage uploaded to Codecov successfully.'
        );
    });
});
