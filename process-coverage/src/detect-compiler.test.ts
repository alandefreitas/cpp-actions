jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

jest.mock('@actions/glob', () => ({
    create: jest.fn()
}));

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
    detectFromCxx,
    detectFromCoverageFiles,
    resolveCompilerInfo,
    discoverExecutables
} from './detect-compiler';

const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockGlobCreate = glob.create as jest.MockedFunction<typeof glob.create>;

function mockGlobber(files: string[]) {
    return { glob: jest.fn().mockResolvedValue(files) };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('detectFromCxx', () => {
    it('detects Clang from --version output', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'Ubuntu clang version 18.1.3 (1ubuntu1)\nTarget: x86_64-pc-linux-gnu\n',
            stderr: ''
        });

        const result = await detectFromCxx('/usr/bin/clang++');

        expect(result).toEqual({ compiler: 'clang', majorVersion: '18' });
    });

    it('detects GCC from --version output', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0\nCopyright (C) 2024 Free Software Foundation\n',
            stderr: ''
        });

        const result = await detectFromCxx('/usr/bin/g++');

        expect(result).toEqual({ compiler: 'gcc', majorVersion: '14' });
    });

    it('returns null for empty path', async () => {
        const result = await detectFromCxx('');

        expect(result).toBeNull();
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('returns null when command fails', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'not found'
        });

        const result = await detectFromCxx('/usr/bin/nonexistent');

        expect(result).toBeNull();
    });

    it('returns null when output is unrecognized', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'some unknown compiler v1.0',
            stderr: ''
        });

        const result = await detectFromCxx('/usr/bin/cc');

        expect(result).toBeNull();
    });

    it('returns null when exec throws', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('spawn error'));

        const result = await detectFromCxx('/usr/bin/clang++');

        expect(result).toBeNull();
    });

    it('does not misdetect Apple Clang as GCC', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'Apple clang version 15.0.0 (clang-1500.3.9.4)\nTarget: arm64-apple-darwin23.6.0\n',
            stderr: ''
        });

        const result = await detectFromCxx('/usr/bin/c++');

        expect(result).toEqual({ compiler: 'clang', majorVersion: '15' });
    });
});

describe('detectFromCoverageFiles', () => {
    it('detects Clang from .profraw files', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(
                mockGlobber(['/build/default-123.profraw']) as never
            );

        const result = await detectFromCoverageFiles(['/build'], 'default-*.profraw');

        expect(result).toBe('clang');
    });

    it('detects GCC from .gcda files', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(mockGlobber([]) as never)  // no profraw
            .mockResolvedValueOnce(
                mockGlobber(['/build/main.gcda']) as never
            );

        const result = await detectFromCoverageFiles(['/build'], 'default-*.profraw');

        expect(result).toBe('gcc');
    });

    it('returns null when no coverage files found', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(mockGlobber([]) as never)  // no profraw
            .mockResolvedValueOnce(mockGlobber([]) as never);  // no gcda

        const result = await detectFromCoverageFiles(['/build'], 'default-*.profraw');

        expect(result).toBeNull();
    });

    it('prefers Clang when both profraw and gcda exist', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(
                mockGlobber(['/build/default-123.profraw']) as never
            );
        // gcda glob never called because profraw found first

        const result = await detectFromCoverageFiles(['/build'], 'default-*.profraw');

        expect(result).toBe('clang');
    });
});

describe('resolveCompilerInfo', () => {
    const baseInputs = {
        compiler: '',
        compilerVersion: '',
        cxx: '',
        buildDir: ['/build'],
        profrawPattern: 'default-*.profraw'
    };

    it('returns explicit compiler and version when both provided', async () => {
        const result = await resolveCompilerInfo({
            ...baseInputs,
            compiler: 'gcc',
            compilerVersion: '14'
        });

        expect(result).toEqual({ compiler: 'gcc', majorVersion: '14' });
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('uses cxx to fill in missing compiler and version', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0\n',
            stderr: ''
        });

        const result = await resolveCompilerInfo({
            ...baseInputs,
            cxx: '/usr/bin/g++'
        });

        expect(result).toEqual({ compiler: 'gcc', majorVersion: '14' });
    });

    it('uses cxx to fill in only the missing version', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: 'g++ (Ubuntu 14.2.0-4ubuntu2) 14.2.0\n',
            stderr: ''
        });

        const result = await resolveCompilerInfo({
            ...baseInputs,
            compiler: 'gcc',
            cxx: '/usr/bin/g++'
        });

        expect(result).toEqual({ compiler: 'gcc', majorVersion: '14' });
    });

    it('falls back to coverage files when cxx not provided', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(
                mockGlobber(['/build/default-1.profraw']) as never
            );

        const result = await resolveCompilerInfo(baseInputs);

        expect(result).toEqual({ compiler: 'clang', majorVersion: '' });
    });

    it('throws when nothing can determine the compiler', async () => {
        mockGlobCreate
            .mockResolvedValueOnce(mockGlobber([]) as never)  // no profraw
            .mockResolvedValueOnce(mockGlobber([]) as never);  // no gcda

        await expect(resolveCompilerInfo(baseInputs)).rejects.toThrow(
            /Cannot determine the compiler family/
        );
    });

    it('throws for unsupported compiler value', async () => {
        await expect(resolveCompilerInfo({
            ...baseInputs,
            compiler: 'msvc',
            compilerVersion: '19'
        })).rejects.toThrow(/Unsupported compiler 'msvc'/);
    });

    it('falls back to coverage files when cxx detection fails', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1, stdout: '', stderr: 'error'
        });
        mockGlobCreate
            .mockResolvedValueOnce(mockGlobber([]) as never)  // no profraw
            .mockResolvedValueOnce(
                mockGlobber(['/build/main.gcda']) as never
            );

        const result = await resolveCompilerInfo({
            ...baseInputs,
            cxx: '/usr/bin/broken-compiler'
        });

        expect(result).toEqual({ compiler: 'gcc', majorVersion: '' });
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Could not detect compiler')
        );
    });
});

describe('discoverExecutables', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-exec-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds ELF executables', async () => {
        // Write a fake ELF file (magic: 0x7f ELF)
        const elfPath = path.join(tmpDir, 'test_binary');
        const buf = Buffer.alloc(16);
        buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46;
        fs.writeFileSync(elfPath, buf);

        const result = await discoverExecutables([tmpDir]);

        expect(result).toEqual([elfPath]);
    });

    it('skips non-executable files', async () => {
        // Write a plain text file
        fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
        // Write a .o file (skipped by extension)
        const objBuf = Buffer.alloc(16);
        objBuf[0] = 0x7f; objBuf[1] = 0x45; objBuf[2] = 0x4c; objBuf[3] = 0x46;
        fs.writeFileSync(path.join(tmpDir, 'main.o'), objBuf);

        const result = await discoverExecutables([tmpDir]);

        expect(result).toEqual([]);
    });

    it('skips CMakeFiles directories', async () => {
        const cmakeDir = path.join(tmpDir, 'CMakeFiles');
        fs.mkdirSync(cmakeDir);
        const elfPath = path.join(cmakeDir, 'test_binary');
        const buf = Buffer.alloc(16);
        buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46;
        fs.writeFileSync(elfPath, buf);

        const result = await discoverExecutables([tmpDir]);

        expect(result).toEqual([]);
    });

    it('searches recursively into subdirectories', async () => {
        const binDir = path.join(tmpDir, 'bin');
        fs.mkdirSync(binDir);
        const elfPath = path.join(binDir, 'my_test');
        const buf = Buffer.alloc(16);
        buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46;
        fs.writeFileSync(elfPath, buf);

        const result = await discoverExecutables([tmpDir]);

        expect(result).toEqual([elfPath]);
    });

    it('returns empty array for empty directory', async () => {
        const result = await discoverExecutables([tmpDir]);

        expect(result).toEqual([]);
    });

    it('handles non-existent directories gracefully', async () => {
        const result = await discoverExecutables(['/nonexistent/path']);

        expect(result).toEqual([]);
    });
});
