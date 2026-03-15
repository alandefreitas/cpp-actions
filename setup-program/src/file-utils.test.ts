jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { getAllSubdirectories, isSymlink, copySymlink } from './file-utils';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-utils-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getAllSubdirectories', () => {
    it('returns empty array for directory with no subdirectories', () => {
        fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
        const result = getAllSubdirectories(tmpDir);
        expect(result).toEqual([]);
    });

    it('finds direct subdirectories', () => {
        fs.mkdirSync(path.join(tmpDir, 'sub1'));
        fs.mkdirSync(path.join(tmpDir, 'sub2'));
        const result = getAllSubdirectories(tmpDir);
        expect(result).toHaveLength(2);
        expect(result).toContain(path.join(tmpDir, 'sub1'));
        expect(result).toContain(path.join(tmpDir, 'sub2'));
    });

    it('finds nested subdirectories recursively', () => {
        fs.mkdirSync(path.join(tmpDir, 'a'));
        fs.mkdirSync(path.join(tmpDir, 'a', 'b'));
        fs.mkdirSync(path.join(tmpDir, 'a', 'b', 'c'));
        const result = getAllSubdirectories(tmpDir);
        expect(result).toHaveLength(3);
        expect(result).toContain(path.join(tmpDir, 'a'));
        expect(result).toContain(path.join(tmpDir, 'a', 'b'));
        expect(result).toContain(path.join(tmpDir, 'a', 'b', 'c'));
    });

    it('returns empty array for empty directory', () => {
        const result = getAllSubdirectories(tmpDir);
        expect(result).toEqual([]);
    });

    it('ignores files and only returns directories', () => {
        fs.mkdirSync(path.join(tmpDir, 'dir'));
        fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
        fs.writeFileSync(path.join(tmpDir, 'dir', 'inner.txt'), 'content');
        const result = getAllSubdirectories(tmpDir);
        expect(result).toEqual([path.join(tmpDir, 'dir')]);
    });
});

describe('isSymlink', () => {
    it('returns true for a symbolic link', () => {
        const targetPath = path.join(tmpDir, 'target');
        const linkPath = path.join(tmpDir, 'link');
        fs.writeFileSync(targetPath, 'content');
        fs.symlinkSync(targetPath, linkPath);
        expect(isSymlink(linkPath)).toBe(true);
    });

    it('returns false for a regular file', () => {
        const filePath = path.join(tmpDir, 'file.txt');
        fs.writeFileSync(filePath, 'content');
        expect(isSymlink(filePath)).toBe(false);
    });

    it('returns false for a directory', () => {
        const dirPath = path.join(tmpDir, 'dir');
        fs.mkdirSync(dirPath);
        expect(isSymlink(dirPath)).toBe(false);
    });

    it('returns false for a nonexistent path', () => {
        expect(isSymlink(path.join(tmpDir, 'nonexistent'))).toBe(false);
    });
});

describe('copySymlink', () => {
    it('copies a symlink to a new location', () => {
        const targetPath = path.join(tmpDir, 'target');
        const sourcePath = path.join(tmpDir, 'source-link');
        const destPath = path.join(tmpDir, 'dest-link');
        fs.writeFileSync(targetPath, 'content');
        fs.symlinkSync(targetPath, sourcePath);

        copySymlink(sourcePath, destPath);

        expect(fs.lstatSync(destPath).isSymbolicLink()).toBe(true);
        expect(fs.readlinkSync(destPath)).toBe(targetPath);
    });

    it('accepts level parameter for indentation', () => {
        const targetPath = path.join(tmpDir, 'target');
        const sourcePath = path.join(tmpDir, 'source-link');
        const destPath = path.join(tmpDir, 'dest-link');
        fs.writeFileSync(targetPath, 'content');
        fs.symlinkSync(targetPath, sourcePath);

        copySymlink(sourcePath, destPath, 2);

        expect(fs.readlinkSync(destPath)).toBe(targetPath);
    });
});
