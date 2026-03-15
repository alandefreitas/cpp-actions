import { getUbuntuVersionOrder, buildVersionCandidates, tryUbuntuBinaries, tryGenericLinuxBinaries, downloadGccFromUrl } from './gcc-download';

jest.mock('trace-commands', () => ({
    log: jest.fn()
}));

jest.mock('setup-program', () => ({
    installProgramFromUrl: jest.fn(),
    getCurrentUbuntuVersion: jest.fn()
}));

jest.mock('@actions/http-client', () => ({
    HttpClient: jest.fn()
}));

import * as setup_program from 'setup-program';
import * as httpm from '@actions/http-client';

const mockInstallProgramFromUrl = setup_program.installProgramFromUrl as jest.MockedFunction<typeof setup_program.installProgramFromUrl>;
const mockGetCurrentUbuntuVersion = setup_program.getCurrentUbuntuVersion as jest.MockedFunction<typeof setup_program.getCurrentUbuntuVersion>;

describe('getUbuntuVersionOrder', () => {
    it('returns 20.04 first when current version is 20.04', () => {
        const result = getUbuntuVersionOrder('20.04');
        expect(result[0]).toBe('20.04');
        expect(result).toHaveLength(7);
    });

    it('returns 18.04 first when current version is 18.04', () => {
        const result = getUbuntuVersionOrder('18.04');
        expect(result[0]).toBe('18.04');
    });

    it('returns 22.04 first when current version is unknown', () => {
        const result = getUbuntuVersionOrder(null);
        expect(result[0]).toBe('22.04');
    });

    it('returns 22.04 first when current version is 22.04', () => {
        const result = getUbuntuVersionOrder('22.04');
        expect(result[0]).toBe('22.04');
    });

    it('returns 16.04 first when current version is 16.04', () => {
        const result = getUbuntuVersionOrder('16.04');
        expect(result[0]).toBe('16.04');
    });

    it('returns 12.04 first when current version is 12.04', () => {
        const result = getUbuntuVersionOrder('12.04');
        expect(result[0]).toBe('12.04');
    });

    it('returns 10.04 first when current version is 10.04', () => {
        const result = getUbuntuVersionOrder('10.04');
        expect(result[0]).toBe('10.04');
    });
});

describe('buildVersionCandidates', () => {
    const allVersions = [
        '10.1.0', '10.2.0', '10.3.0',
        '11.1.0', '11.2.0', '11.3.0',
        '12.1.0', '12.2.0'
    ];

    it('returns the release version first', () => {
        const result = buildVersionCandidates('11.2.0', allVersions);
        expect(result[0]).toBe('11.2.0');
    });

    it('includes same-major-same-minor versions after the target', () => {
        const result = buildVersionCandidates('10.1.0', allVersions);
        expect(result).toContain('10.1.0');
    });

    it('includes same-major-different-minor versions', () => {
        const result = buildVersionCandidates('11.1.0', allVersions);
        expect(result).toContain('11.2.0');
        expect(result).toContain('11.3.0');
    });

    it('returns empty array for unparseable version', () => {
        const result = buildVersionCandidates('not-a-version', allVersions);
        expect(result).toEqual([]);
    });
});

describe('tryUbuntuBinaries', () => {
    let mockHttpClient: { head: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockHttpClient = { head: jest.fn() };
    });

    it('returns result when URL exists and install succeeds', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.2.0', outputPath: '/usr/local/bin/gcc-11' });

        const result = await tryUbuntuBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['22.04'], ['11.2.0'], '11', false, true
        );

        expect(result.outputVersion).toBe('11.2.0');
        expect(result.outputPath).toBe('/usr/local/bin/gcc-11');
        expect(mockInstallProgramFromUrl).toHaveBeenCalledWith(
            ['gcc'], '11', false,
            expect.stringContaining('gcc-11.2.0-x86_64-linux-gnu-ubuntu-22.04.tar.gz'),
            true, '/usr/local'
        );
    });

    it('skips URLs that return non-200 status', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 404 } });

        const result = await tryUbuntuBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['22.04'], ['11.2.0'], '11', false, true
        );

        expect(result).toEqual({ outputVersion: null, outputPath: null });
        expect(mockInstallProgramFromUrl).not.toHaveBeenCalled();
    });

    it('tries next candidate when install returns null version', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl
            .mockResolvedValueOnce({ outputVersion: null, outputPath: null })
            .mockResolvedValueOnce({ outputVersion: '11.3.0', outputPath: '/usr/local/bin/gcc-11' });

        const result = await tryUbuntuBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['22.04'], ['11.2.0', '11.3.0'], '11', false, true
        );

        expect(result.outputVersion).toBe('11.3.0');
    });

    it('tries next ubuntu version when all candidates fail', async () => {
        mockHttpClient.head
            .mockResolvedValueOnce({ message: { statusCode: 404 } })
            .mockResolvedValueOnce({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.2.0', outputPath: '/usr/local/bin/gcc' });

        const result = await tryUbuntuBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['22.04', '20.04'], ['11.2.0'], '11', false, true
        );

        expect(result.outputVersion).toBe('11.2.0');
        expect(mockHttpClient.head).toHaveBeenCalledTimes(2);
    });

    it('returns null result when all ubuntu versions and candidates exhausted', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 404 } });

        const result = await tryUbuntuBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['22.04', '20.04'], ['11.2.0', '11.3.0'], '11', false, true
        );

        expect(result).toEqual({ outputVersion: null, outputPath: null });
    });
});

describe('tryGenericLinuxBinaries', () => {
    let mockHttpClient: { head: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockHttpClient = { head: jest.fn() };
    });

    it('returns result when URL exists and install succeeds', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '12.1.0', outputPath: '/usr/local/bin/gcc-12' });

        const result = await tryGenericLinuxBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['12.1.0'], '12', false, true
        );

        expect(result.outputVersion).toBe('12.1.0');
        expect(mockInstallProgramFromUrl).toHaveBeenCalledWith(
            ['gcc'], '12', false,
            expect.stringContaining('gcc-12.1.0-Linux-x86_64.tar.gz'),
            true, '/usr/local'
        );
    });

    it('skips non-200 URLs', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 404 } });

        const result = await tryGenericLinuxBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['12.1.0'], '12', false, true
        );

        expect(result).toEqual({ outputVersion: null, outputPath: null });
    });

    it('tries next candidate when install returns null', async () => {
        mockHttpClient.head.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl
            .mockResolvedValueOnce({ outputVersion: null, outputPath: null })
            .mockResolvedValueOnce({ outputVersion: '12.2.0', outputPath: '/usr/local/bin/gcc-12' });

        const result = await tryGenericLinuxBinaries(
            mockHttpClient as unknown as httpm.HttpClient,
            ['12.1.0', '12.2.0'], '12', false, true
        );

        expect(result.outputVersion).toBe('12.2.0');
    });
});

describe('downloadGccFromUrl', () => {
    let MockHttpClient: jest.Mock;
    let mockHead: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockHead = jest.fn();
        MockHttpClient = httpm.HttpClient as unknown as jest.Mock;
        MockHttpClient.mockImplementation(() => ({ head: mockHead }));
        mockGetCurrentUbuntuVersion.mockReturnValue('22.04');
    });

    it('returns null result when no version satisfies range', async () => {
        const result = await downloadGccFromUrl({
            version: '>=99',
            checkLatest: false,
            updateEnvironment: true,
            allVersions: ['11.2.0', '12.1.0']
        });

        expect(result).toEqual({ outputVersion: null, outputPath: null });
    });

    it('uses maxSatisfying when checkLatest is true', async () => {
        mockHead.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.3.0', outputPath: '/usr/local/bin/gcc-11' });

        const result = await downloadGccFromUrl({
            version: '>=11.0.0 <12.0.0',
            checkLatest: true,
            updateEnvironment: true,
            allVersions: ['11.1.0', '11.2.0', '11.3.0']
        });

        expect(result.outputVersion).toBe('11.3.0');
    });

    it('uses minSatisfying when checkLatest is false', async () => {
        mockHead.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.1.0', outputPath: '/usr/local/bin/gcc-11' });

        const result = await downloadGccFromUrl({
            version: '>=11.0.0 <12.0.0',
            checkLatest: false,
            updateEnvironment: true,
            allVersions: ['11.1.0', '11.2.0', '11.3.0']
        });

        expect(result.outputVersion).toBe('11.1.0');
    });

    it('falls back to generic Linux binaries when Ubuntu binaries fail', async () => {
        // All Ubuntu URLs fail (404), then generic succeeds
        let callCount = 0;
        mockHead.mockImplementation(async () => {
            callCount++;
            // The last call (generic) succeeds, all Ubuntu ones fail
            // Ubuntu tries: ubuntuVersions.length * versionCandidates.length URLs
            // For a single version with 7 ubuntu versions = 7 calls
            // Then generic tries: 1 call
            if (callCount <= 7) {
                return { message: { statusCode: 404 } };
            }
            return { message: { statusCode: 200 } };
        });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.2.0', outputPath: '/usr/local/bin/gcc' });

        const result = await downloadGccFromUrl({
            version: '11.2.0',
            checkLatest: false,
            updateEnvironment: true,
            allVersions: ['11.2.0']
        });

        expect(result.outputVersion).toBe('11.2.0');
    });

    it('returns ubuntu result early when found', async () => {
        mockHead.mockResolvedValue({ message: { statusCode: 200 } });
        mockInstallProgramFromUrl.mockResolvedValue({ outputVersion: '11.2.0', outputPath: '/usr/local/bin/gcc-11' });

        const result = await downloadGccFromUrl({
            version: '11.2.0',
            checkLatest: false,
            updateEnvironment: true,
            allVersions: ['11.2.0']
        });

        expect(result.outputVersion).toBe('11.2.0');
    });
});
