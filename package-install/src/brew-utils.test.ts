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

import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as core from '@actions/core';
import {
    isBrewAvailable,
    getBrewPrefix,
    findProgramWithBrew,
    installProgramWithBrew,
    parseVersionFromOutput
} from './brew-utils';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockAddPath = core.addPath as jest.MockedFunction<typeof core.addPath>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('isBrewAvailable', () => {
    it('returns true when brew is on PATH', async () => {
        mockWhich.mockResolvedValue('/opt/homebrew/bin/brew');
        expect(await isBrewAvailable()).toBe(true);
    });

    it('returns false when brew is not on PATH', async () => {
        mockWhich.mockResolvedValue('');
        expect(await isBrewAvailable()).toBe(false);
    });

    it('returns false when io.which throws', async () => {
        mockWhich.mockRejectedValue(new Error('not found'));
        expect(await isBrewAvailable()).toBe(false);
    });
});

describe('getBrewPrefix', () => {
    it('returns prefix path for installed formula', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/gcc@14\n',
            stderr: ''
        });
        const prefix = await getBrewPrefix('gcc@14');
        expect(prefix).toBe('/opt/homebrew/opt/gcc@14');
        expect(mockGetExecOutput).toHaveBeenCalledWith('brew', ['--prefix', 'gcc@14'], { silent: true });
    });

    it('returns null when brew --prefix fails', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'Error: No available formula with the name "gcc@99"'
        });
        const prefix = await getBrewPrefix('gcc@99');
        expect(prefix).toBeNull();
    });

    it('returns null when getExecOutput throws', async () => {
        mockGetExecOutput.mockRejectedValue(new Error('command not found'));
        const prefix = await getBrewPrefix('gcc@14');
        expect(prefix).toBeNull();
    });
});

describe('findProgramWithBrew', () => {
    it('finds a program installed via Homebrew', async () => {
        // First call: brew --prefix
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/gcc@14\n',
            stderr: ''
        });
        // Second call: binary --version
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'gcc-14 (Homebrew GCC 14.2.0) 14.2.0\nCopyright ...\n',
            stderr: ''
        });

        const result = await findProgramWithBrew('gcc@14', 'gcc-14');
        expect(result).toEqual({
            path: '/opt/homebrew/opt/gcc@14/bin/gcc-14',
            version: '14.2.0'
        });
    });

    it('finds clang installed via Homebrew', async () => {
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/llvm@18\n',
            stderr: ''
        });
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'Homebrew clang version 18.1.8\nTarget: arm64-apple-darwin23.0.0\n',
            stderr: ''
        });

        const result = await findProgramWithBrew('llvm@18', 'clang');
        expect(result).toEqual({
            path: '/opt/homebrew/opt/llvm@18/bin/clang',
            version: '18.1.8'
        });
    });

    it('returns null when formula is not installed', async () => {
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'Error: No available formula'
        });

        const result = await findProgramWithBrew('gcc@99', 'gcc-99');
        expect(result).toBeNull();
    });

    it('returns null when binary --version fails', async () => {
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/gcc@14\n',
            stderr: ''
        });
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });

        const result = await findProgramWithBrew('gcc@14', 'gcc-14');
        expect(result).toBeNull();
    });

    it('returns null when binary execution throws', async () => {
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/gcc@14\n',
            stderr: ''
        });
        mockGetExecOutput.mockRejectedValueOnce(new Error('ENOENT'));

        const result = await findProgramWithBrew('gcc@14', 'gcc-14');
        expect(result).toBeNull();
    });
});

describe('installProgramWithBrew', () => {
    it('installs a formula and returns prefix path', async () => {
        mockExec.mockResolvedValue(0);
        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: '/opt/homebrew/opt/gcc@14\n',
            stderr: ''
        });

        const prefix = await installProgramWithBrew('gcc@14');
        expect(prefix).toBe('/opt/homebrew/opt/gcc@14');
        expect(mockExec).toHaveBeenCalledWith('brew', ['install', 'gcc@14'], { ignoreReturnCode: true });
        expect(mockAddPath).toHaveBeenCalledWith('/opt/homebrew/opt/gcc@14/bin');
    });

    it('returns null when brew install fails', async () => {
        mockExec.mockResolvedValue(1);

        const prefix = await installProgramWithBrew('gcc@99');
        expect(prefix).toBeNull();
        expect(mockAddPath).not.toHaveBeenCalled();
    });

    it('returns null when brew install throws', async () => {
        mockExec.mockRejectedValue(new Error('command not found'));

        const prefix = await installProgramWithBrew('gcc@14');
        expect(prefix).toBeNull();
    });
});

describe('parseVersionFromOutput', () => {
    it('parses GCC version output', () => {
        const output = 'gcc-14 (Homebrew GCC 14.2.0) 14.2.0\nCopyright (C) 2024 Free Software Foundation, Inc.';
        expect(parseVersionFromOutput(output)).toBe('14.2.0');
    });

    it('parses Clang version output', () => {
        const output = 'Homebrew clang version 18.1.8\nTarget: arm64-apple-darwin23.0.0';
        expect(parseVersionFromOutput(output)).toBe('18.1.8');
    });

    it('parses generic version output', () => {
        expect(parseVersionFromOutput('some-tool 3.24.1')).toBe('3.24.1');
    });

    it('returns null for output without version', () => {
        expect(parseVersionFromOutput('no version here')).toBeNull();
    });
});
