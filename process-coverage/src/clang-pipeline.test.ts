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

jest.mock('@actions/glob', () => ({
    create: jest.fn()
}));

import * as path from 'node:path';
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import * as glob from '@actions/glob';

jest.mock('node:fs/promises', () => ({
    writeFile: jest.fn().mockResolvedValue(undefined)
}));

import { writeFile } from 'node:fs/promises';
import { mergeProfrawFiles, exportClangCoverage, type MergeProfrawOptions, type ExportClangCoverageOptions } from './clang-pipeline';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockGlobCreate = glob.create as jest.MockedFunction<typeof glob.create>;

beforeEach(() => {
    jest.clearAllMocks();
    mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

/**
 * Creates a mock globber that returns the specified files.
 *
 * @param files - Array of file paths to return from glob
 * @returns Mock globber object
 */
function mockGlobber(files: string[]) {
    return { glob: jest.fn().mockResolvedValue(files) };
}

describe('mergeProfrawFiles', () => {
    const baseOptions: MergeProfrawOptions = {
        llvmProfdataPath: '/usr/bin/llvm-profdata-18',
        buildDirs: ['/project/build'],
        profrawPattern: 'default-*.profraw',
        outputDir: '/tmp/coverage'
    };

    it('discovers and merges profraw files from a single build directory', async () => {
        const profrawFiles = [
            '/project/build/default-123.profraw',
            '/project/build/default-456.profraw'
        ];
        mockGlobCreate.mockResolvedValue(mockGlobber(profrawFiles) as never);

        const result = await mergeProfrawFiles(baseOptions);

        expect(result).toBe(path.join('/tmp/coverage', 'merged.profdata'));
        expect(mockGlobCreate).toHaveBeenCalledWith(
            path.join('/project/build', '**', 'default-*.profraw')
        );
        expect(mockGetExecOutput).toHaveBeenCalledWith('/usr/bin/llvm-profdata-18', [
            'merge',
            '-sparse',
            ...profrawFiles,
            '-o', path.join('/tmp/coverage', 'merged.profdata')
        ], { silent: true });
    });

    it('discovers profraw files from multiple build directories', async () => {
        const options: MergeProfrawOptions = {
            ...baseOptions,
            buildDirs: ['/project/build1', '/project/build2']
        };
        const profrawFiles = [
            '/project/build1/default-123.profraw',
            '/project/build2/default-456.profraw'
        ];
        mockGlobCreate.mockResolvedValue(mockGlobber(profrawFiles) as never);

        const result = await mergeProfrawFiles(options);

        expect(result).toBe(path.join('/tmp/coverage', 'merged.profdata'));
        expect(mockGlobCreate).toHaveBeenCalledWith(
            [
                path.join('/project/build1', '**', 'default-*.profraw'),
                path.join('/project/build2', '**', 'default-*.profraw')
            ].join('\n')
        );
        expect(mockGetExecOutput).toHaveBeenCalledWith('/usr/bin/llvm-profdata-18', [
            'merge',
            '-sparse',
            ...profrawFiles,
            '-o', path.join('/tmp/coverage', 'merged.profdata')
        ], { silent: true });
    });

    it('throws when no profraw files are found', async () => {
        mockGlobCreate.mockResolvedValue(mockGlobber([]) as never);

        await expect(mergeProfrawFiles(baseOptions)).rejects.toThrow(
            /No \.profraw files found/
        );
        await expect(mergeProfrawFiles(baseOptions)).rejects.toThrow(
            /LLVM_PROFILE_FILE/
        );
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('includes build directory paths in the error message when no files found', async () => {
        const options: MergeProfrawOptions = {
            ...baseOptions,
            buildDirs: ['/project/build1', '/project/build2']
        };
        mockGlobCreate.mockResolvedValue(mockGlobber([]) as never);

        await expect(mergeProfrawFiles(options)).rejects.toThrow(
            '/project/build1, /project/build2'
        );
    });

    it('throws when no profraw files found', async () => {
        mockGlobCreate.mockResolvedValue(mockGlobber([]) as never);

        await expect(mergeProfrawFiles(baseOptions)).rejects.toThrow(/No .profraw files found/);
    });

    it('throws when llvm-profdata merge fails', async () => {
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/default-1.profraw']) as never
        );
        mockGetExecOutput.mockRejectedValueOnce(new Error('profdata merge failed'));

        await expect(mergeProfrawFiles(baseOptions)).rejects.toThrow('profdata merge failed');
    });

    it('uses the specified profraw pattern for globbing', async () => {
        const options: MergeProfrawOptions = {
            ...baseOptions,
            profrawPattern: 'custom-%b-%p-%m.profraw'
        };
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/custom-a-1-2.profraw']) as never
        );

        await mergeProfrawFiles(options);

        expect(mockGlobCreate).toHaveBeenCalledWith(
            path.join('/project/build', '**', 'custom-%b-%p-%m.profraw')
        );
    });

    it('logs the number of discovered profraw files', async () => {
        const profrawFiles = [
            '/project/build/default-1.profraw',
            '/project/build/default-2.profraw',
            '/project/build/default-3.profraw'
        ];
        mockGlobCreate.mockResolvedValue(mockGlobber(profrawFiles) as never);

        await mergeProfrawFiles(baseOptions);

        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Found 3 profraw file(s)')
        );
    });
});

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe('exportClangCoverage', () => {
    const baseOptions: ExportClangCoverageOptions = {
        llvmCovPath: '/usr/bin/llvm-cov-18',
        profdataPath: '/tmp/coverage/merged.profdata',
        binaries: ['/project/build/bin/my_tests'],
        outputDir: '/tmp/coverage'
    };

    it('exports coverage for a single binary', async () => {
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/my_tests']) as never
        );
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'SF:/src/foo.cpp\nDA:1,1\nend_of_record\n',
            stderr: ''
        });

        const result = await exportClangCoverage(baseOptions);

        expect(result).toBe(path.join('/tmp/coverage', 'clang-coverage.info'));
        expect(mockGetExecOutput).toHaveBeenCalledWith('/usr/bin/llvm-cov-18', [
            'export',
            '-format=lcov',
            '-instr-profile=/tmp/coverage/merged.profdata',
            '/project/build/bin/my_tests'
        ], { silent: true, ignoreReturnCode: true });
        expect(mockWriteFile).toHaveBeenCalledWith(
            path.join('/tmp/coverage', 'clang-coverage.info'),
            'SF:/src/foo.cpp\nDA:1,1\nend_of_record\n',
            'utf-8'
        );
    });

    it('exports and concatenates coverage from multiple binaries', async () => {
        const options: ExportClangCoverageOptions = {
            ...baseOptions,
            binaries: ['/project/build/bin/test_a', '/project/build/bin/test_b']
        };
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/test_a', '/project/build/bin/test_b']) as never
        );
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'SF:/src/a.cpp\nDA:1,1\nend_of_record\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'SF:/src/b.cpp\nDA:2,0\nend_of_record\n',
                stderr: ''
            });

        const result = await exportClangCoverage(options);

        expect(result).toBe(path.join('/tmp/coverage', 'clang-coverage.info'));
        expect(mockGetExecOutput).toHaveBeenCalledTimes(2);
        expect(mockWriteFile).toHaveBeenCalledWith(
            path.join('/tmp/coverage', 'clang-coverage.info'),
            'SF:/src/a.cpp\nDA:1,1\nend_of_record\nSF:/src/b.cpp\nDA:2,0\nend_of_record\n',
            'utf-8'
        );
    });

    it('throws when no binaries are specified', async () => {
        const options: ExportClangCoverageOptions = {
            ...baseOptions,
            binaries: []
        };

        await expect(exportClangCoverage(options)).rejects.toThrow(
            /No binaries resolved/
        );
        await expect(exportClangCoverage(options)).rejects.toThrow(
            /instrumented test executable/
        );
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('throws when glob resolves no binaries', async () => {
        mockGlobCreate.mockResolvedValue(mockGlobber([]) as never);

        await expect(exportClangCoverage(baseOptions)).rejects.toThrow(
            /No binaries found matching patterns/
        );
    });

    it('supports glob patterns in binary paths', async () => {
        const options: ExportClangCoverageOptions = {
            ...baseOptions,
            binaries: ['/project/build/bin/test_*']
        };
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/test_unit', '/project/build/bin/test_integration']) as never
        );
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'SF:/src/test.cpp\nDA:1,1\nend_of_record\n',
            stderr: ''
        });

        await exportClangCoverage(options);

        expect(mockGlobCreate).toHaveBeenCalledWith('/project/build/bin/test_*');
        expect(mockGetExecOutput).toHaveBeenCalledTimes(2);
        expect(mockWriteFile).toHaveBeenCalledWith(
            path.join('/tmp/coverage', 'clang-coverage.info'),
            expect.any(String),
            'utf-8'
        );
    });

    it('wraps operation in core.startGroup/endGroup', async () => {
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/my_tests']) as never
        );
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'SF:/src/foo.cpp\nDA:1,1\nend_of_record\n',
            stderr: ''
        });

        await exportClangCoverage(baseOptions);

        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Exporting coverage for 1 binary')
        );
    });

    it('throws when all binaries produce no coverage data', async () => {
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/my_tests']) as never
        );
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

        await expect(exportClangCoverage(baseOptions)).rejects.toThrow(/No coverage data exported/);
    });

    it('logs the number of binaries being processed', async () => {
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/test_a', '/project/build/bin/test_b']) as never
        );
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'SF:/src/test.cpp\nDA:1,1\nend_of_record\n',
            stderr: ''
        });

        const options: ExportClangCoverageOptions = {
            ...baseOptions,
            binaries: ['/project/build/bin/test_*']
        };
        await exportClangCoverage(options);

        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Exporting coverage for 2 binary(ies)')
        );
    });

    it('skips binaries with no coverage data and continues', async () => {
        const options: ExportClangCoverageOptions = {
            ...baseOptions,
            binaries: ['/project/build/bin/test_a', '/project/build/bin/helper']
        };
        mockGlobCreate.mockResolvedValue(
            mockGlobber(['/project/build/bin/test_a', '/project/build/bin/helper']) as never
        );
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'SF:/src/a.cpp\nDA:1,1\nend_of_record\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 1, stdout: '', stderr: 'no coverage data'
            });

        const result = await exportClangCoverage(options);

        expect(result).toBe(path.join('/tmp/coverage', 'clang-coverage.info'));
        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('Skipping /project/build/bin/helper')
        );
    });
});
