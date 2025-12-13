jest.mock('@actions/core', () => ({
    info: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    error: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn().mockResolvedValue(0)
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        readFileSync: jest.fn()
    };
});

import * as core from '@actions/core';
import * as io from '@actions/io';
import * as exec from '@actions/exec';
import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const setup_program = require('setup-program');

import { ensureGit } from './index';

describe('ensureGit', () => {
    const runnerOS = process.env.RUNNER_OS;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.RUNNER_OS = 'Linux';
    });

    afterEach(() => {
        process.env.RUNNER_OS = runnerOS;
    });

    test('returns existing git path without installing', async () => {
        (io.which as jest.Mock).mockResolvedValue('/usr/bin/git');

        const gitPath = await ensureGit({ subgroups: false });

        expect(gitPath).toBe('/usr/bin/git');
        expect(exec.exec).not.toHaveBeenCalled();
    });

    test('installs git on Debian-like runners when missing', async () => {
        (io.which as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        const gitPath = await ensureGit({ subgroups: false });

        expect(gitPath).toBe('/usr/bin/git');
        expect(exec.exec).toHaveBeenCalledTimes(2);
        expect(exec.exec).toHaveBeenNthCalledWith(1, 'apt-get', ['update'], expect.objectContaining({ ignoreReturnCode: true }));
        expect(exec.exec).toHaveBeenNthCalledWith(2, 'apt-get', ['install', '-y', 'git'], expect.objectContaining({ ignoreReturnCode: true }));
    });

    test('skips install on non-debian linux', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=alpine\n');

        const gitPath = await ensureGit({ subgroups: false });

        expect(gitPath).toBeNull();
        expect(core.info).toHaveBeenCalledWith('git is missing but runner is not Debian/Ubuntu; skipping automatic installation.');
        expect(exec.exec).not.toHaveBeenCalled();
    });
});

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>;
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                };
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message);
                        mockCore.setFailed(error.message);
                    },
                    __mockCore: mockCore
                };
            });
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors');

            runPromise = prettyErrors.reportAndSetFailed(new Error('cmake boom'), { title: 'Setup CMake failed', includeStackInSetFailed: true }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1);
                const failedArg = prettyErrors.__mockCore.setFailed.mock.calls[0][0];
                expect(failedArg).toContain('cmake boom');
            });
        });

        await runPromise!;
    });
});
