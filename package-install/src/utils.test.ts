import { semverGteLoose, formatTime, sha1sum, escapePath, isMSVCCompilerExecutable } from './utils';

describe('semverGteLoose', () => {
    it('handles four-part versions without throwing', () => {
        expect(semverGteLoose('0.96.24.20', '0.96.24.20')).toBe(true);
        expect(semverGteLoose('0.96.24.21', '0.96.24.20')).toBe(true);
        expect(semverGteLoose('0.96.24.19', '0.96.24.20')).toBe(false);
    });

    it('coerces distro-suffixed versions without throwing', () => {
        expect(() => semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).not.toThrow();
        expect(semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).toBe(false);
    });
});

describe('formatTime', () => {
    it('formats milliseconds', () => {
        expect(formatTime(500)).toBe('500ms');
    });

    it('formats seconds', () => {
        expect(formatTime(2500)).toBe('2.5s');
    });

    it('formats minutes', () => {
        expect(formatTime(90000)).toBe('1.5m');
    });
});

describe('sha1sum', () => {
    it('produces consistent hashes', () => {
        const hash1 = sha1sum('test');
        const hash2 = sha1sum('test');
        expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
        expect(sha1sum('a')).not.toBe(sha1sum('b'));
    });
});

describe('escapePath', () => {
    it('does not quote simple paths', () => {
        expect(escapePath('vcpkg')).toBe('vcpkg');
    });

    it('quotes paths with slashes', () => {
        expect(escapePath('/usr/bin/git')).toBe('"/usr/bin/git"');
    });

    it('quotes paths with spaces', () => {
        expect(escapePath('path with spaces')).toBe('"path with spaces"');
    });
});

describe('isMSVCCompilerExecutable', () => {
    it('returns true for cl.exe', () => {
        expect(isMSVCCompilerExecutable('C:/Program Files/MSVC/cl.exe')).toBe(true);
    });

    it('returns false for gcc', () => {
        expect(isMSVCCompilerExecutable('/usr/bin/gcc')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isMSVCCompilerExecutable('')).toBe(false);
    });
});
