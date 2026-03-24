jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

import * as path from 'node:path';
import * as exec from '@actions/exec';

import { captureGccCoverage, type GccCaptureOptions } from './gcc-pipeline';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;

beforeEach(() => {
    jest.clearAllMocks();
    mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

describe('captureGccCoverage', () => {
    const baseOptions: GccCaptureOptions = {
        lcovPath: '/usr/bin/lcov',
        gcovPath: '/usr/bin/gcov-14',
        buildDirs: ['/project/build'],
        outputDir: '/tmp/coverage'
    };

    it('captures coverage from a single build directory', async () => {
        const result = await captureGccCoverage(baseOptions);

        expect(result).toBe(path.join('/tmp/coverage', 'coverage-0.info'));
        expect(mockGetExecOutput).toHaveBeenCalledTimes(1);
        expect(mockGetExecOutput).toHaveBeenCalledWith('/usr/bin/lcov', [
            '--capture',
            '--gcov-tool', '/usr/bin/gcov-14',
            '--directory', '/project/build',
            '--output-file', path.join('/tmp/coverage', 'coverage-0.info'),
            '--rc', 'branch_coverage=0',
            '--rc', 'geninfo_unexecuted_blocks=1'
        ], { silent: true });
    });

    it('captures and merges coverage from multiple build directories', async () => {
        const options: GccCaptureOptions = {
            ...baseOptions,
            buildDirs: ['/project/build1', '/project/build2']
        };

        const result = await captureGccCoverage(options);

        expect(result).toBe(path.join('/tmp/coverage', 'merged.info'));
        expect(mockGetExecOutput).toHaveBeenCalledTimes(3);

        // First capture
        expect(mockGetExecOutput).toHaveBeenNthCalledWith(1, '/usr/bin/lcov', [
            '--capture',
            '--gcov-tool', '/usr/bin/gcov-14',
            '--directory', '/project/build1',
            '--output-file', path.join('/tmp/coverage', 'coverage-0.info'),
            '--rc', 'branch_coverage=0',
            '--rc', 'geninfo_unexecuted_blocks=1'
        ], { silent: true });

        // Second capture
        expect(mockGetExecOutput).toHaveBeenNthCalledWith(2, '/usr/bin/lcov', [
            '--capture',
            '--gcov-tool', '/usr/bin/gcov-14',
            '--directory', '/project/build2',
            '--output-file', path.join('/tmp/coverage', 'coverage-1.info'),
            '--rc', 'branch_coverage=0',
            '--rc', 'geninfo_unexecuted_blocks=1'
        ], { silent: true });

        // Merge
        expect(mockGetExecOutput).toHaveBeenNthCalledWith(3, '/usr/bin/lcov', [
            '--add-tracefile', path.join('/tmp/coverage', 'coverage-0.info'),
            '--add-tracefile', path.join('/tmp/coverage', 'coverage-1.info'),
            '-o', path.join('/tmp/coverage', 'merged.info')
        ], { silent: true });
    });

    it('throws when lcov capture fails', async () => {
        mockGetExecOutput.mockRejectedValueOnce(new Error('lcov failed'));

        await expect(captureGccCoverage(baseOptions)).rejects.toThrow('lcov failed');
    });

    it('throws when lcov merge fails', async () => {
        const options: GccCaptureOptions = {
            ...baseOptions,
            buildDirs: ['/project/build1', '/project/build2']
        };

        mockGetExecOutput
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
            .mockRejectedValueOnce(new Error('merge failed'));

        await expect(captureGccCoverage(options)).rejects.toThrow('merge failed');
    });

    it('throws when buildDirs is empty', async () => {
        const options: GccCaptureOptions = {
            ...baseOptions,
            buildDirs: []
        };

        await expect(captureGccCoverage(options)).rejects.toThrow(
            /No build directories specified/
        );
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('passes correct gcov-tool argument', async () => {
        const options: GccCaptureOptions = {
            ...baseOptions,
            gcovPath: '/usr/bin/gcov-13'
        };

        await captureGccCoverage(options);

        expect(mockGetExecOutput).toHaveBeenCalledWith(
            '/usr/bin/lcov',
            expect.arrayContaining(['--gcov-tool', '/usr/bin/gcov-13']),
            { silent: true }
        );
    });
});
