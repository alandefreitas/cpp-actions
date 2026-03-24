import * as core from '@actions/core';

import { runUploads, type UploadOptions } from './upload';
import { uploadToCodecov } from './upload-codecov';
import { uploadToCoveralls } from './upload-coveralls';

jest.mock('@actions/core', () => ({
    warning: jest.fn()
}));

jest.mock('./upload-codecov', () => ({
    uploadToCodecov: jest.fn()
}));

jest.mock('./upload-coveralls', () => ({
    uploadToCoveralls: jest.fn()
}));

const mockUploadToCodecov = uploadToCodecov as jest.MockedFunction<
    typeof uploadToCodecov
>;
const mockUploadToCoveralls = uploadToCoveralls as jest.MockedFunction<
    typeof uploadToCoveralls
>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;

function makeOptions(
    overrides: Partial<UploadOptions> = {}
): UploadOptions {
    return {
        lcovFile: '/tmp/coverage.info',
        failOnUploadError: false,
        codecovToken: '',
        codecovFlags: '',
        codecovArgs: '',
        coverallsToken: '',
        coverallsArgs: '',
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUploadToCodecov.mockResolvedValue(undefined);
    mockUploadToCoveralls.mockResolvedValue(undefined);
});

describe('runUploads', () => {
    it('skips both uploads when tokens are empty', async () => {
        await runUploads(makeOptions());

        expect(mockUploadToCodecov).not.toHaveBeenCalled();
        expect(mockUploadToCoveralls).not.toHaveBeenCalled();
    });

    it('runs only Codecov when only codecov token is set', async () => {
        await runUploads(
            makeOptions({ codecovToken: 'cc-token' })
        );

        expect(mockUploadToCodecov).toHaveBeenCalledWith({
            token: 'cc-token',
            lcovFile: '/tmp/coverage.info',
            flags: '',
            extraArgs: '',
            failOnError: true
        });
        expect(mockUploadToCoveralls).not.toHaveBeenCalled();
    });

    it('runs only Coveralls when only coveralls token is set', async () => {
        await runUploads(
            makeOptions({ coverallsToken: 'cv-token' })
        );

        expect(mockUploadToCoveralls).toHaveBeenCalledWith({
            token: 'cv-token',
            lcovFile: '/tmp/coverage.info',
            extraArgs: '',
            failOnError: true
        });
        expect(mockUploadToCodecov).not.toHaveBeenCalled();
    });

    it('runs both uploads when both tokens are set', async () => {
        await runUploads(
            makeOptions({
                codecovToken: 'cc-token',
                coverallsToken: 'cv-token'
            })
        );

        expect(mockUploadToCodecov).toHaveBeenCalledTimes(1);
        expect(mockUploadToCoveralls).toHaveBeenCalledTimes(1);
    });

    it('passes flags and args to Codecov', async () => {
        await runUploads(
            makeOptions({
                codecovToken: 'cc-token',
                codecovFlags: 'unit',
                codecovArgs: '--verbose'
            })
        );

        expect(mockUploadToCodecov).toHaveBeenCalledWith(
            expect.objectContaining({
                flags: 'unit',
                extraArgs: '--verbose'
            })
        );
    });

    it('passes args to Coveralls', async () => {
        await runUploads(
            makeOptions({
                coverallsToken: 'cv-token',
                coverallsArgs: '--parallel'
            })
        );

        expect(mockUploadToCoveralls).toHaveBeenCalledWith(
            expect.objectContaining({
                extraArgs: '--parallel'
            })
        );
    });

    it('runs Coveralls even when Codecov fails', async () => {
        mockUploadToCodecov.mockRejectedValue(
            new Error('Codecov upload failed: network error')
        );

        await runUploads(
            makeOptions({
                codecovToken: 'cc-token',
                coverallsToken: 'cv-token'
            })
        );

        expect(mockUploadToCodecov).toHaveBeenCalledTimes(1);
        expect(mockUploadToCoveralls).toHaveBeenCalledTimes(1);
        expect(mockWarning).toHaveBeenCalledWith(
            'Codecov upload failed: network error'
        );
    });

    it('runs Codecov even when Coveralls fails', async () => {
        mockUploadToCoveralls.mockRejectedValue(
            new Error('Coveralls upload failed: auth error')
        );

        await runUploads(
            makeOptions({
                codecovToken: 'cc-token',
                coverallsToken: 'cv-token'
            })
        );

        expect(mockUploadToCodecov).toHaveBeenCalledTimes(1);
        expect(mockUploadToCoveralls).toHaveBeenCalledTimes(1);
        expect(mockWarning).toHaveBeenCalledWith(
            'Coveralls upload failed: auth error'
        );
    });

    it('does not throw when uploads fail and failOnUploadError is false', async () => {
        mockUploadToCodecov.mockRejectedValue(new Error('cc fail'));
        mockUploadToCoveralls.mockRejectedValue(new Error('cv fail'));

        await expect(
            runUploads(
                makeOptions({
                    codecovToken: 'cc-token',
                    coverallsToken: 'cv-token',
                    failOnUploadError: false
                })
            )
        ).resolves.toBeUndefined();

        expect(mockWarning).toHaveBeenCalledTimes(2);
    });

    it('throws combined error when both fail and failOnUploadError is true', async () => {
        mockUploadToCodecov.mockRejectedValue(new Error('cc fail'));
        mockUploadToCoveralls.mockRejectedValue(new Error('cv fail'));

        await expect(
            runUploads(
                makeOptions({
                    codecovToken: 'cc-token',
                    coverallsToken: 'cv-token',
                    failOnUploadError: true
                })
            )
        ).rejects.toThrow('Coverage upload failed:');

        await expect(
            runUploads(
                makeOptions({
                    codecovToken: 'cc-token',
                    coverallsToken: 'cv-token',
                    failOnUploadError: true
                })
            )
        ).rejects.toThrow('cc fail');
    });

    it('throws when only Codecov fails and failOnUploadError is true', async () => {
        mockUploadToCodecov.mockRejectedValue(new Error('cc fail'));

        await expect(
            runUploads(
                makeOptions({
                    codecovToken: 'cc-token',
                    coverallsToken: 'cv-token',
                    failOnUploadError: true
                })
            )
        ).rejects.toThrow('cc fail');

        // Coveralls still ran
        expect(mockUploadToCoveralls).toHaveBeenCalledTimes(1);
    });

    it('throws when only Coveralls fails and failOnUploadError is true', async () => {
        mockUploadToCoveralls.mockRejectedValue(new Error('cv fail'));

        await expect(
            runUploads(
                makeOptions({
                    codecovToken: 'cc-token',
                    coverallsToken: 'cv-token',
                    failOnUploadError: true
                })
            )
        ).rejects.toThrow('cv fail');

        // Codecov still ran
        expect(mockUploadToCodecov).toHaveBeenCalledTimes(1);
    });

    it('handles non-Error thrown values', async () => {
        mockUploadToCodecov.mockRejectedValue('string error');

        await runUploads(
            makeOptions({
                codecovToken: 'cc-token',
                failOnUploadError: false
            })
        );

        expect(mockWarning).toHaveBeenCalledWith('string error');
    });

    it('does not throw when no tokens are set even with failOnUploadError true', async () => {
        await expect(
            runUploads(makeOptions({ failOnUploadError: true }))
        ).resolves.toBeUndefined();
    });
});
