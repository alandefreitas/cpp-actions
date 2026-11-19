jest.mock('./runner');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runCommand } from './runner';
import { fetchTags, fetchAllTags } from './tags';

const mockedRun = runCommand as jest.MockedFunction<typeof runCommand>;

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    mockedRun.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const LS_REMOTE = [
    'a1b2c3\trefs/tags/releases/gcc-13.1.0',
    'd4e5f6\trefs/tags/releases/gcc-13.1.0^{}',
    '',
    '0a0b0c\trefs/tags/v3.28.0',
    'ffffff\trefs/heads/main'
].join('\n');

describe('fetchTags', () => {
    it('writes tag names, skipping dereferenced tags and non-tag refs', async () => {
        mockedRun.mockResolvedValue({ exitCode: 0, stdout: LS_REMOTE, stderr: '', success: true });
        const outputFile = path.join(tmpDir, 'nested', 'tags.json');

        await expect(fetchTags('https://example.com/repo.git', outputFile)).resolves.toBe(true);

        expect(mockedRun).toHaveBeenCalledWith('git', ['ls-remote', '--tags', 'https://example.com/repo.git'], { timeout: 60000 });
        expect(JSON.parse(fs.readFileSync(outputFile, 'utf-8'))).toEqual(['releases/gcc-13.1.0', 'v3.28.0']);
    });

    it('returns false and writes nothing when git fails', async () => {
        mockedRun.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'fatal: unable to access', success: false });
        const outputFile = path.join(tmpDir, 'tags.json');

        await expect(fetchTags('https://example.com/repo.git', outputFile)).resolves.toBe(false);
        expect(fs.existsSync(outputFile)).toBe(false);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fatal: unable to access'));
    });
});

describe('fetchAllTags', () => {
    it('writes the gcc, clang and cmake tag files under setup-program', async () => {
        mockedRun.mockImplementation(async (_cmd, args) => ({
            exitCode: 0,
            stdout: `abc\trefs/tags/tag-of-${args[2].split('/').pop()}`,
            stderr: '',
            success: true
        }));

        await expect(fetchAllTags(tmpDir)).resolves.toBe(true);

        const read = (name: string): unknown =>
            JSON.parse(fs.readFileSync(path.join(tmpDir, 'setup-program', name), 'utf-8'));
        expect(read('gcc-tags.json')).toEqual(['tag-of-gcc.git']);
        expect(read('clang-tags.json')).toEqual(['tag-of-llvm-project']);
        expect(read('cmake-tags.json')).toEqual(['tag-of-CMake.git']);
    });

    it('keeps going after a failure but reports it', async () => {
        mockedRun
            .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'timeout', success: false })
            .mockResolvedValue({ exitCode: 0, stdout: 'abc\trefs/tags/v1', stderr: '', success: true });

        await expect(fetchAllTags(tmpDir)).resolves.toBe(false);

        expect(mockedRun).toHaveBeenCalledTimes(3);
        expect(fs.existsSync(path.join(tmpDir, 'setup-program', 'gcc-tags.json'))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, 'setup-program', 'cmake-tags.json'))).toBe(true);
    });
});
