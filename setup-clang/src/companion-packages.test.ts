import { findFileRecursive, hasSanitizerRuntimes } from './companion-packages';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('findFileRecursive', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clang-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('finds a file in the root directory', () => {
        fs.writeFileSync(path.join(tmpDir, 'target.txt'), '');
        expect(findFileRecursive(tmpDir, 'target.txt', 3)).toBe(true);
    });

    it('finds a file in a nested directory', () => {
        const nested = path.join(tmpDir, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, 'target.txt'), '');
        expect(findFileRecursive(tmpDir, 'target.txt', 3)).toBe(true);
    });

    it('returns false when file does not exist', () => {
        expect(findFileRecursive(tmpDir, 'nonexistent.txt', 3)).toBe(false);
    });

    it('respects max depth limit', () => {
        const deep = path.join(tmpDir, 'a', 'b', 'c');
        fs.mkdirSync(deep, { recursive: true });
        fs.writeFileSync(path.join(deep, 'target.txt'), '');
        // depth 2 can't reach 3 levels deep
        expect(findFileRecursive(tmpDir, 'target.txt', 2)).toBe(false);
    });

    it('returns false for nonexistent directory', () => {
        expect(findFileRecursive('/nonexistent/path', 'target.txt', 3)).toBe(false);
    });

    it('returns false when maxDepth is 0', () => {
        fs.writeFileSync(path.join(tmpDir, 'target.txt'), '');
        expect(findFileRecursive(tmpDir, 'target.txt', 0)).toBe(false);
    });
});

describe('hasSanitizerRuntimes', () => {
    it('returns false when runtime files do not exist', () => {
        // On non-CI machines, sanitizer runtimes typically aren't installed
        // at the checked paths for version 999
        expect(hasSanitizerRuntimes(999)).toBe(false);
    });
});
