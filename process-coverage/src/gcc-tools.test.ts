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

jest.mock('setup-program', () => ({
    execWithSudo: jest.fn()
}));

import * as io from '@actions/io';
import * as core from '@actions/core';
import { execWithSudo } from 'setup-program';

import { findGcov, findLcov, findGenhtml } from './gcc-tools';

const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockExecWithSudo = execWithSudo as jest.MockedFunction<typeof execWithSudo>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('findGcov', () => {
    it('returns versioned gcov path when found', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/gcov-14');

        const result = await findGcov('14');

        expect(result).toBe('/usr/bin/gcov-14');
        expect(mockWhich).toHaveBeenCalledWith('gcov-14', true);
        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('gcov-14')
        );
        expect(core.warning).not.toHaveBeenCalled();
    });

    it('falls back to unversioned gcov with warning', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/gcov');

        const result = await findGcov('14');

        expect(result).toBe('/usr/bin/gcov');
        expect(mockWhich).toHaveBeenCalledWith('gcov-14', true);
        expect(mockWhich).toHaveBeenCalledWith('gcov', true);
        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('version mismatch')
        );
    });

    it('throws when no gcov binary is found', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));

        await expect(findGcov('14')).rejects.toThrow(
            /No gcov binary found on PATH.*gcov-14/
        );
    });

    it('uses the provided major version in binary name', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/gcov-13');

        await findGcov('13');

        expect(mockWhich).toHaveBeenCalledWith('gcov-13', true);
    });
});

describe('findLcov', () => {
    it('returns lcov path when found on PATH', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/lcov');

        const result = await findLcov();

        expect(result).toBe('/usr/bin/lcov');
        expect(mockWhich).toHaveBeenCalledWith('lcov', true);
        expect(mockExecWithSudo).not.toHaveBeenCalled();
    });

    it('installs lcov via apt-get when not found on PATH', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/lcov');
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        const result = await findLcov();

        expect(result).toBe('/usr/bin/lcov');
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'lcov']);
        expect(core.debug).toHaveBeenCalledWith(
            expect.stringContaining('installing lcov via apt-get')
        );
    });

    it('throws when lcov not found after installation', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        await expect(findLcov()).rejects.toThrow(
            /lcov not found on PATH after installing/
        );
    });

    it('throws when apt-get install fails', async () => {
        mockWhich.mockRejectedValueOnce(new Error('not found'));
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockRejectedValueOnce(new Error('apt-get failed')); // apt-get install

        await expect(findLcov()).rejects.toThrow('apt-get failed');
    });
});

describe('findGenhtml', () => {
    it('returns genhtml path when found on PATH', async () => {
        mockWhich.mockResolvedValueOnce('/usr/bin/genhtml');

        const result = await findGenhtml();

        expect(result).toBe('/usr/bin/genhtml');
        expect(mockWhich).toHaveBeenCalledWith('genhtml', true);
        expect(mockExecWithSudo).not.toHaveBeenCalled();
    });

    it('installs lcov via apt-get when genhtml not found', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/genhtml');
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        const result = await findGenhtml();

        expect(result).toBe('/usr/bin/genhtml');
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['update', '-qq']);
        expect(mockExecWithSudo).toHaveBeenCalledWith('apt-get', ['install', '-y', 'lcov']);
    });

    it('throws when genhtml not found after installation', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockRejectedValueOnce(new Error('not found'));
        mockExecWithSudo
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(0); // apt-get install

        await expect(findGenhtml()).rejects.toThrow(
            /genhtml not found on PATH after installing/
        );
    });
});
