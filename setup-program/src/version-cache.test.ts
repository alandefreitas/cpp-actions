jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import {
    setVersionsCacheDir,
    resolveVersionsCachePath,
    readVersionsFromFile,
    saveVersionsToFile
} from './version-cache';

const mockLog = traceCommands.log as jest.MockedFunction<typeof traceCommands.log>;

describe('version-cache', () => {
    let tmpDir: string;
    const originalEnv = process.env.SETUP_PROGRAM_CACHE_DIR;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-cache-test-'));
        setVersionsCacheDir(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (originalEnv === undefined) {
            delete process.env.SETUP_PROGRAM_CACHE_DIR;
        } else {
            process.env.SETUP_PROGRAM_CACHE_DIR = originalEnv;
        }
    });

    describe('resolveVersionsCachePath', () => {
        it('returns absolute paths unchanged', () => {
            const absolute = path.join(tmpDir, 'other', 'gcc-versions.txt');
            expect(resolveVersionsCachePath(absolute)).toBe(absolute);
        });

        it('joins relative filenames with the configured cache directory', () => {
            expect(resolveVersionsCachePath('gcc-versions.txt')).toBe(path.join(tmpDir, 'gcc-versions.txt'));
        });

        it('falls back to SETUP_PROGRAM_CACHE_DIR when no directory is configured', () => {
            setVersionsCacheDir('');
            const envDir = path.join(tmpDir, 'from-env');
            process.env.SETUP_PROGRAM_CACHE_DIR = envDir;
            expect(resolveVersionsCachePath('clang-versions.txt')).toBe(path.join(envDir, 'clang-versions.txt'));
        });

        it('falls back to var/cache/setup-program next to the module when nothing is configured', () => {
            setVersionsCacheDir('');
            delete process.env.SETUP_PROGRAM_CACHE_DIR;
            const expected = path.join(__dirname, '..', 'var', 'cache', 'setup-program', 'cmake-versions.txt');
            expect(resolveVersionsCachePath('cmake-versions.txt')).toBe(expected);
        });
    });

    describe('saveVersionsToFile and readVersionsFromFile', () => {
        it('round-trips a list of versions through a JSON file, creating parent directories', () => {
            const file = path.join('nested', 'dir', 'gcc-versions.txt');
            saveVersionsToFile(['11.4.0', '12.3.0'], file);

            const written = fs.readFileSync(path.join(tmpDir, file), 'utf8');
            expect(written).toBe('["11.4.0","12.3.0"]');
            expect(readVersionsFromFile(file)).toEqual(['11.4.0', '12.3.0']);
            expect(mockLog).toHaveBeenCalledWith('Versions saved to file.');
        });

        it('returns null when the file does not exist', () => {
            expect(readVersionsFromFile('missing.txt')).toBeNull();
        });

        it('returns null when the file is not valid JSON', () => {
            fs.writeFileSync(path.join(tmpDir, 'bad.txt'), 'not json', 'utf8');
            expect(readVersionsFromFile('bad.txt')).toBeNull();
        });

        it('returns null when the JSON is not an array', () => {
            fs.writeFileSync(path.join(tmpDir, 'obj.txt'), '{"a":1}', 'utf8');
            expect(readVersionsFromFile('obj.txt')).toBeNull();
        });

        it('logs instead of throwing when the file cannot be written', () => {
            const blocker = path.join(tmpDir, 'blocker');
            fs.writeFileSync(blocker, 'a file, not a directory', 'utf8');

            expect(() => saveVersionsToFile(['1.0.0'], path.join(blocker, 'versions.txt'))).not.toThrow();
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Error saving versions to file: '));
        });
    });
});
