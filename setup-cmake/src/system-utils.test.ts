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

import * as setup_program from 'setup-program';

import { ensureGit, isDebianLike } from './system-utils';

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

    test('handles io.which throwing for initial check', async () => {
        (io.which as jest.Mock)
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        const gitPath = await ensureGit({ subgroups: false });
        expect(gitPath).toBe('/usr/bin/git');
    });

    test('returns null on non-linux platform', async () => {
        process.env.RUNNER_OS = 'macOS';
        (io.which as jest.Mock).mockResolvedValue(null);

        const gitPath = await ensureGit({ subgroups: false });
        expect(gitPath).toBeNull();
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('automatic installation is only attempted on Debian/Ubuntu'));
    });

    test('uses subgroups when subgroups=true', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        process.env.RUNNER_OS = 'macOS';

        await ensureGit({ subgroups: true });
        expect(core.startGroup).toHaveBeenCalledWith(expect.stringContaining('Ensure git'));
        expect(core.endGroup).toHaveBeenCalled();
    });

    test('returns null when /etc/os-release is unreadable', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });

        const gitPath = await ensureGit({ subgroups: false });
        expect(gitPath).toBeNull();
    });

    test('uses sudo when isSudoRequired returns true', async () => {
        (io.which as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(true);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        await ensureGit({ subgroups: false });
        expect(exec.exec).toHaveBeenNthCalledWith(1, 'sudo', ['-n', 'apt-get', 'update'], expect.any(Object));
        expect(exec.exec).toHaveBeenNthCalledWith(2, 'sudo', ['-n', 'apt-get', 'install', '-y', 'git'], expect.any(Object));
    });

    test('logs info when apt-get update returns non-zero', async () => {
        (io.which as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');
        (exec.exec as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

        await ensureGit({ subgroups: false });
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('apt-get update returned exit code 1'));
    });

    test('logs info when apt-get install returns non-zero', async () => {
        (io.which as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');
        (exec.exec as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

        await ensureGit({ subgroups: false });
        expect(core.info).toHaveBeenCalledWith(expect.stringContaining('apt-get install git returned exit code 1'));
    });

    test('throws when git not found after install attempt', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        await expect(ensureGit({ subgroups: false })).rejects.toThrow('git is required');
    });

    test('handles io.which throwing after install', async () => {
        (io.which as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('still not found'));
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        await expect(ensureGit({ subgroups: false })).rejects.toThrow('git is required');
    });

    test('uses default options when called with no args', async () => {
        (io.which as jest.Mock).mockResolvedValue('/usr/bin/git');
        const gitPath = await ensureGit();
        expect(gitPath).toBe('/usr/bin/git');
    });

    test('uses subgroups for non-linux with endGroup', async () => {
        process.env.RUNNER_OS = 'Windows';
        (io.which as jest.Mock).mockResolvedValue(null);

        await ensureGit({ subgroups: true });
        expect(core.startGroup).toHaveBeenCalled();
        expect(core.endGroup).toHaveBeenCalled();
    });

    test('uses subgroups for unreadable os-release', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });

        await ensureGit({ subgroups: true });
        expect(core.startGroup).toHaveBeenCalled();
        expect(core.endGroup).toHaveBeenCalled();
    });

    test('uses subgroups for non-debian linux', async () => {
        (io.which as jest.Mock).mockResolvedValue(null);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=alpine\n');

        await ensureGit({ subgroups: true });
        expect(core.endGroup).toHaveBeenCalled();
    });

    test('uses subgroups for successful install', async () => {
        (io.which as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git');
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false);
        (fs.readFileSync as jest.Mock).mockReturnValue('ID=ubuntu\nID_LIKE=debian\n');

        await ensureGit({ subgroups: true });
        expect(core.startGroup).toHaveBeenCalled();
        expect(core.endGroup).toHaveBeenCalled();
    });
});

describe('isDebianLike', () => {
    it('detects Ubuntu', () => {
        expect(isDebianLike('ID=ubuntu\nID_LIKE=debian\n')).toBe(true);
    });

    it('detects Debian', () => {
        expect(isDebianLike('ID=debian\n')).toBe(true);
    });

    it('rejects Alpine', () => {
        expect(isDebianLike('ID=alpine\n')).toBe(false);
    });

    it('handles quoted values', () => {
        expect(isDebianLike('ID="ubuntu"\nID_LIKE="debian"\n')).toBe(true);
    });
});
