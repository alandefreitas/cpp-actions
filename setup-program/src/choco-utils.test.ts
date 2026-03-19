jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    addPath: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn()
}));

import * as path from 'path';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as core from '@actions/core';
import * as fs from 'fs';
import {
    isChocoAvailable,
    findProgramWithChoco,
    installProgramWithChoco,
    parseVersionFromOutput
} from './choco-utils';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockAddPath = core.addPath as jest.MockedFunction<typeof core.addPath>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('isChocoAvailable', () => {
    it('returns true when choco is on PATH', async () => {
        mockWhich.mockResolvedValue('C:\\ProgramData\\chocolatey\\bin\\choco.exe');
        expect(await isChocoAvailable()).toBe(true);
    });

    it('returns false when choco is not on PATH', async () => {
        mockWhich.mockResolvedValue('');
        expect(await isChocoAvailable()).toBe(false);
    });

    it('returns false when io.which throws', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        expect(await isChocoAvailable()).toBe(false);
    });
});

describe('findProgramWithChoco', () => {
    const mingwPaths = ['C:\\mingw64\\bin', 'C:\\ProgramData\\mingw64\\bin'];

    it('finds gcc.exe in runner pre-installed path', async () => {
        const expectedPath = path.join('C:\\mingw64\\bin', 'gcc.exe');
        mockExistsSync.mockImplementation((p) => p === expectedPath);
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'gcc.exe (x86_64-posix-seh-rev0, Built by MinGW-W64 project) 14.2.0\n',
            stderr: ''
        });

        const result = await findProgramWithChoco('mingw', 'gcc.exe', mingwPaths);
        expect(result).toEqual({
            path: expectedPath,
            version: '14.2.0'
        });
        expect(mockGetExecOutput).toHaveBeenCalledWith(expectedPath, ['--version'], { silent: true });
    });

    it('finds clang-cl.exe in LLVM path', async () => {
        const llvmPaths = ['C:\\Program Files\\LLVM\\bin'];
        const expectedPath = path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe');
        mockExistsSync.mockImplementation((p) => p === expectedPath);
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'clang version 20.1.8\nTarget: x86_64-pc-windows-msvc\n',
            stderr: ''
        });

        const result = await findProgramWithChoco('llvm', 'clang-cl.exe', llvmPaths);
        expect(result).toEqual({
            path: expectedPath,
            version: '20.1.8'
        });
    });

    it('searches second path when first does not have binary', async () => {
        const expectedPath = path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe');
        mockExistsSync.mockImplementation((p) => p === expectedPath);
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'gcc.exe (x86_64-posix-seh-rev0, Built by MinGW-W64 project) 15.2.0\n',
            stderr: ''
        });

        const result = await findProgramWithChoco('mingw', 'gcc.exe', mingwPaths);
        expect(result).toEqual({
            path: expectedPath,
            version: '15.2.0'
        });
    });

    it('returns null when binary not found in any path', async () => {
        mockExistsSync.mockReturnValue(false);

        const result = await findProgramWithChoco('mingw', 'gcc.exe', mingwPaths);
        expect(result).toBeNull();
    });

    it('returns null when --version fails for all paths', async () => {
        mockExistsSync.mockReturnValue(true);
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });

        const result = await findProgramWithChoco('mingw', 'gcc.exe', mingwPaths);
        expect(result).toBeNull();
    });

    it('skips binary when execution throws and continues searching', async () => {
        mockExistsSync.mockReturnValue(true);
        // First path throws
        mockGetExecOutput.mockRejectedValueOnce(new Error('ENOENT'));
        // Second path succeeds
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'gcc.exe (MinGW-W64) 14.2.0\n',
            stderr: ''
        });

        const result = await findProgramWithChoco('mingw', 'gcc.exe', mingwPaths);
        expect(result).toEqual({
            path: path.join('C:\\ProgramData\\mingw64\\bin', 'gcc.exe'),
            version: '14.2.0'
        });
    });

    it('returns null when search paths array is empty', async () => {
        const result = await findProgramWithChoco('mingw', 'gcc.exe', []);
        expect(result).toBeNull();
    });

    it('uses stderr for version when stdout is empty', async () => {
        const llvmPaths = ['C:\\Program Files\\LLVM\\bin'];
        const expectedPath = path.join('C:\\Program Files\\LLVM\\bin', 'clang-cl.exe');
        mockExistsSync.mockImplementation((p) => p === expectedPath);
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: 'clang version 20.1.8\n'
        });

        const result = await findProgramWithChoco('llvm', 'clang-cl.exe', llvmPaths);
        expect(result).toEqual({
            path: expectedPath,
            version: '20.1.8'
        });
    });
});

describe('installProgramWithChoco', () => {
    it('installs a package without version and adds to PATH', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithChoco('mingw', undefined, 'C:\\ProgramData\\mingw64\\bin');
        expect(result).toBe('C:\\ProgramData\\mingw64\\bin');
        expect(mockExec).toHaveBeenCalledWith('choco', ['install', 'mingw', '-y', '--no-progress'], { ignoreReturnCode: true });
        expect(mockAddPath).toHaveBeenCalledWith('C:\\ProgramData\\mingw64\\bin');
    });

    it('installs a package with specific version', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithChoco('mingw', '14.2.0', 'C:\\ProgramData\\mingw64\\bin');
        expect(result).toBe('C:\\ProgramData\\mingw64\\bin');
        expect(mockExec).toHaveBeenCalledWith(
            'choco',
            ['install', 'mingw', '-y', '--no-progress', '--version', '14.2.0'],
            { ignoreReturnCode: true }
        );
    });

    it('returns null when choco install fails', async () => {
        mockExec.mockResolvedValue(1);

        const result = await installProgramWithChoco('mingw', undefined, 'C:\\ProgramData\\mingw64\\bin');
        expect(result).toBeNull();
        expect(mockAddPath).not.toHaveBeenCalled();
    });

    it('returns null when choco install throws', async () => {
        mockExec.mockRejectedValue(new Error('command not found'));

        const result = await installProgramWithChoco('mingw');
        expect(result).toBeNull();
    });

    it('returns null when no installDir provided', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithChoco('mingw');
        expect(result).toBeNull();
        expect(mockAddPath).not.toHaveBeenCalled();
    });

    it('installs LLVM with version and adds to PATH', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithChoco('llvm', '20.1.8', 'C:\\Program Files\\LLVM\\bin');
        expect(result).toBe('C:\\Program Files\\LLVM\\bin');
        expect(mockExec).toHaveBeenCalledWith(
            'choco',
            ['install', 'llvm', '-y', '--no-progress', '--version', '20.1.8'],
            { ignoreReturnCode: true }
        );
        expect(mockAddPath).toHaveBeenCalledWith('C:\\Program Files\\LLVM\\bin');
    });
});

describe('parseVersionFromOutput', () => {
    it('parses MinGW GCC version output', () => {
        const output = 'gcc.exe (x86_64-posix-seh-rev0, Built by MinGW-W64 project) 14.2.0';
        expect(parseVersionFromOutput(output)).toBe('14.2.0');
    });

    it('parses clang-cl version output', () => {
        const output = 'clang version 20.1.8\nTarget: x86_64-pc-windows-msvc';
        expect(parseVersionFromOutput(output)).toBe('20.1.8');
    });

    it('parses generic version output', () => {
        expect(parseVersionFromOutput('some-tool 3.24.1')).toBe('3.24.1');
    });

    it('returns null for output without version', () => {
        expect(parseVersionFromOutput('no version here')).toBeNull();
    });
});
