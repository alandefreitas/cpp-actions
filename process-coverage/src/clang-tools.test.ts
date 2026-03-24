jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('node:fs/promises', () => ({
    access: jest.fn(),
    constants: { X_OK: 1 }
}));

jest.mock('setup-program', () => ({
    execWithSudo: jest.fn()
}));

import * as io from '@actions/io';
import * as core from '@actions/core';
import { access } from 'node:fs/promises';
import { execWithSudo } from 'setup-program';

import { findLlvmProfdata, findLlvmCov, installLlvmTools } from './clang-tools';

const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockAccess = access as jest.MockedFunction<typeof access>;
const mockExecWithSudo = execWithSudo as jest.MockedFunction<typeof execWithSudo>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('findLlvmProfdata', () => {
    it('returns versioned llvm-profdata path when found on PATH', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/llvm-profdata-18');

        const result = await findLlvmProfdata('18');

        expect(result).toBe('/usr/bin/llvm-profdata-18');
        expect(mockWhich).toHaveBeenCalledWith('llvm-profdata-18', true);
        expect(core.warning).not.toHaveBeenCalled();
    });

    it('finds llvm-profdata in /usr/lib/llvm-N/bin/ when not on PATH', async () => {
        mockWhich.mockRejectedValueOnce(new Error('not found'));
        mockAccess.mockResolvedValueOnce(undefined);

        const result = await findLlvmProfdata('18');

        expect(result).toBe('/usr/lib/llvm-18/bin/llvm-profdata');
        expect(mockAccess).toHaveBeenCalledWith('/usr/lib/llvm-18/bin/llvm-profdata', 1);
    });

    it('finds llvm-profdata in /usr/bin/ versioned path when llvm dir not found', async () => {
        mockWhich.mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce(undefined);

        const result = await findLlvmProfdata('18');

        expect(result).toBe('/usr/bin/llvm-profdata-18');
        expect(mockAccess).toHaveBeenCalledWith('/usr/bin/llvm-profdata-18', 1);
    });

    it('falls back to unversioned llvm-profdata with warning', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/llvm-profdata');
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));

        const result = await findLlvmProfdata('18');

        expect(result).toBe('/usr/bin/llvm-profdata');
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('version mismatch')
        );
    });

    it('auto-installs llvm tools when not found and retries successfully', async () => {
        // First search: all not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        // installLlvmTools: apt-get update + install
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install
        // Second search after install: versioned found on PATH
        mockWhich.mockResolvedValueOnce('/usr/bin/llvm-profdata-18');

        const result = await findLlvmProfdata('18');

        expect(result).toBe('/usr/bin/llvm-profdata-18');
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'llvm-18-tools']);
    });

    it('throws when not found even after auto-install', async () => {
        // First search: all not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        // installLlvmTools: apt-get update + install
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install
        // Second search after install: still not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));

        await expect(findLlvmProfdata('18')).rejects.toThrow(
            /No llvm-profdata binary found after installing llvm-18-tools/
        );
    });

    it('throws when auto-install itself fails', async () => {
        // First search: all not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        // installLlvmTools: apt-get update succeeds, install fails
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockRejectedValueOnce(new Error('apt-get failed')); // apt-get install

        await expect(findLlvmProfdata('18')).rejects.toThrow('apt-get failed');
    });

    it('uses the provided major version in binary name', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/llvm-profdata-15');

        await findLlvmProfdata('15');

        expect(mockWhich).toHaveBeenCalledWith('llvm-profdata-15', true);
    });
});

describe('findLlvmCov', () => {
    it('returns versioned llvm-cov path when found on PATH', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/llvm-cov-18');

        const result = await findLlvmCov('18');

        expect(result).toBe('/usr/bin/llvm-cov-18');
        expect(mockWhich).toHaveBeenCalledWith('llvm-cov-18', true);
        expect(core.warning).not.toHaveBeenCalled();
    });

    it('finds llvm-cov in /usr/lib/llvm-N/bin/ when not on PATH', async () => {
        mockWhich.mockRejectedValueOnce(new Error('not found'));
        mockAccess.mockResolvedValueOnce(undefined);

        const result = await findLlvmCov('18');

        expect(result).toBe('/usr/lib/llvm-18/bin/llvm-cov');
        expect(mockAccess).toHaveBeenCalledWith('/usr/lib/llvm-18/bin/llvm-cov', 1);
    });

    it('falls back to unversioned llvm-cov with warning', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/llvm-cov');
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));

        const result = await findLlvmCov('18');

        expect(result).toBe('/usr/bin/llvm-cov');
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('version mismatch')
        );
    });

    it('auto-installs llvm tools when not found and retries successfully', async () => {
        // First search: all not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        // installLlvmTools: apt-get update + install
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install
        // Second search after install: found in llvm dir
        mockWhich.mockRejectedValueOnce(new Error('not found'));
        mockAccess.mockResolvedValueOnce(undefined);

        const result = await findLlvmCov('18');

        expect(result).toBe('/usr/lib/llvm-18/bin/llvm-cov');
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'llvm-18-tools']);
    });

    it('throws when not found even after auto-install', async () => {
        // First search: all not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        // installLlvmTools: apt-get update + install
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install
        // Second search after install: still not found
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockAccess
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));

        await expect(findLlvmCov('18')).rejects.toThrow(
            /No llvm-cov binary found after installing llvm-18-tools/
        );
    });
});

describe('installLlvmTools', () => {
    it('installs the versioned LLVM tools package via apt-get', async () => {
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        await installLlvmTools('18');

        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'llvm-18-tools']);
    });

    it('throws when apt-get installation fails', async () => {
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockRejectedValueOnce(new Error('permission denied')); // apt-get install

        await expect(installLlvmTools('18')).rejects.toThrow('permission denied');
    });

    it('uses the provided major version in package name', async () => {
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        await installLlvmTools('15');

        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'llvm-15-tools']);
    });
});
