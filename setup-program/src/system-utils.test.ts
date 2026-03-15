jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn(),
    mv: jest.fn(),
    cp: jest.fn()
}));

jest.mock('@actions/http-client', () => ({
    HttpClient: jest.fn().mockImplementation(() => ({
        head: jest.fn()
    }))
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('./file-utils', () => ({
    isSymlink: jest.fn(),
    copySymlink: jest.fn()
}));

import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as httpm from '@actions/http-client';

import {
    isSudoRequired,
    execWithSudo,
    getExecOutputWithSudo,
    urlExists,
    ensureSudoIsAvailable,
    moveWithPermissions
} from './system-utils';
import { isSymlink, copySymlink } from './file-utils';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockMv = io.mv as jest.MockedFunction<typeof io.mv>;
const mockCp = io.cp as jest.MockedFunction<typeof io.cp>;
const mockIsSymlink = isSymlink as jest.MockedFunction<typeof isSymlink>;
const mockCopySymlink = copySymlink as jest.MockedFunction<typeof copySymlink>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('isSudoRequired', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('returns false on non-linux platforms', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        expect(isSudoRequired()).toBe(false);
    });

    it('returns false on linux when running as root', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const originalGetuid = process.getuid;
        process.getuid = () => 0;
        expect(isSudoRequired()).toBe(false);
        process.getuid = originalGetuid;
    });

    it('returns true on linux when not root', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const originalGetuid = process.getuid;
        process.getuid = () => 1000;
        expect(isSudoRequired()).toBe(true);
        process.getuid = originalGetuid;
    });
});

describe('execWithSudo', () => {
    const originalPlatform = process.platform;
    const originalGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.getuid = originalGetuid;
    });

    it('prepends sudo when required', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        mockExec.mockResolvedValue(0);

        await execWithSudo('apt-get', ['update']);
        expect(mockExec).toHaveBeenCalledWith('sudo', ['-n', 'apt-get', 'update'], {});
    });

    it('runs directly without sudo when not required', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await execWithSudo('apt-get', ['update']);
        expect(mockExec).toHaveBeenCalledWith('apt-get', ['update'], {});
    });
});

describe('getExecOutputWithSudo', () => {
    const originalPlatform = process.platform;
    const originalGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        process.getuid = originalGetuid;
    });

    it('prepends sudo when required', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

        await getExecOutputWithSudo('dpkg', ['-l']);
        expect(mockGetExecOutput).toHaveBeenCalledWith('sudo', ['-n', 'dpkg', '-l'], {});
    });

    it('runs directly without sudo when not required', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

        await getExecOutputWithSudo('dpkg', ['-l']);
        expect(mockGetExecOutput).toHaveBeenCalledWith('dpkg', ['-l'], {});
    });
});

describe('urlExists', () => {
    it('returns true when HEAD request returns 200', async () => {
        const mockHead = jest.fn().mockResolvedValue({ message: { statusCode: 200 } });
        (httpm.HttpClient as jest.Mock).mockImplementation(() => ({ head: mockHead }));

        expect(await urlExists('https://example.com')).toBe(true);
    });

    it('returns false when HEAD request returns non-200', async () => {
        const mockHead = jest.fn().mockResolvedValue({ message: { statusCode: 404 } });
        (httpm.HttpClient as jest.Mock).mockImplementation(() => ({ head: mockHead }));

        expect(await urlExists('https://example.com/404')).toBe(false);
    });

    it('returns false when HEAD request throws', async () => {
        const mockHead = jest.fn().mockRejectedValue(new Error('network error'));
        (httpm.HttpClient as jest.Mock).mockImplementation(() => ({ head: mockHead }));

        expect(await urlExists('https://unreachable')).toBe(false);
    });
});

describe('ensureSudoIsAvailable', () => {
    it('does nothing when sudo is already available', async () => {
        mockWhich.mockResolvedValue('/usr/bin/sudo');
        await ensureSudoIsAvailable();
        expect(mockExec).not.toHaveBeenCalled();
    });

    it('installs sudo when which throws', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found'))
            .mockResolvedValueOnce('/usr/bin/sudo');
        mockExec.mockResolvedValue(0);

        await ensureSudoIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get update', [], { ignoreReturnCode: true });
        expect(mockExec).toHaveBeenCalledWith('apt-get install -y sudo', [], { ignoreReturnCode: true });
    });

    it('installs sudo when which returns empty string', async () => {
        mockWhich
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('/usr/bin/sudo');
        mockExec.mockResolvedValue(0);

        await ensureSudoIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get update', [], { ignoreReturnCode: true });
    });
});

describe('moveWithPermissions', () => {
    let tmpDir: string;
    let srcDir: string;
    let destDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-test-'));
        srcDir = path.join(tmpDir, 'src');
        destDir = path.join(tmpDir, 'dest');
        fs.mkdirSync(srcDir);
        fs.mkdirSync(destDir);
        mockIsSymlink.mockReturnValue(false);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('moves regular files from source to destination', async () => {
        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        mockMv.mockResolvedValue(undefined);

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);
        expect(mockMv).toHaveBeenCalled();
    });

    it('copies files when copyInstead is true', async () => {
        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        mockCp.mockResolvedValue(undefined);

        const result = await moveWithPermissions(srcDir, destDir, true);
        expect(result).toBe(true);
        expect(mockCp).toHaveBeenCalled();
    });

    it('recreates symlinks at destination', async () => {
        const target = path.join(tmpDir, 'target');
        fs.writeFileSync(target, 'content');
        fs.symlinkSync(target, path.join(srcDir, 'link'));
        mockIsSymlink.mockReturnValue(true);

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);
        expect(mockCopySymlink).toHaveBeenCalled();
    });

    it('recursively merges directories that exist at destination', async () => {
        const subSrc = path.join(srcDir, 'sub');
        const subDest = path.join(destDir, 'sub');
        fs.mkdirSync(subSrc);
        fs.mkdirSync(subDest);

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);
    });

    it('retries as copy on EXDEV error', async () => {
        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        const exdevError = new Error('EXDEV') as NodeJS.ErrnoException;
        exdevError.code = 'EXDEV';
        mockMv.mockRejectedValueOnce(exdevError);
        mockCp.mockResolvedValue(undefined);

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);
        expect(mockCp).toHaveBeenCalled();
    });

    it('returns false on non-recoverable error on non-linux', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        mockMv.mockRejectedValueOnce(err);

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(false);

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('falls back to sudo move on EACCES on linux', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });

        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        mockMv.mockRejectedValueOnce(err);
        // ensureSudoIsAvailable
        mockWhich.mockResolvedValue('/usr/bin/sudo');
        // moveWithSudo: getExecOutput for sudo mv
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('falls back to sudo on ENOENT on linux', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });

        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        mockMv.mockRejectedValueOnce(err);
        mockWhich.mockResolvedValue('/usr/bin/sudo');
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('falls back to sudo on undefined error code on linux', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });

        fs.writeFileSync(path.join(srcDir, 'file.txt'), 'content');
        const err = new Error('unknown error');
        mockMv.mockRejectedValueOnce(err);
        mockWhich.mockResolvedValue('/usr/bin/sudo');
        mockGetExecOutput.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

        const result = await moveWithPermissions(srcDir, destDir);
        expect(result).toBe(true);

        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
});
