import { clangDownloadCandidates, generateClangUrlsFor, loadUbuntuVersionNames } from './download';

// Mock setup-program to provide controlled ubuntu version
jest.mock('setup-program', () => ({
    getCurrentUbuntuVersion: jest.fn(() => '22.04'),
    findClangVersions: jest.fn()
}));

// Mock trace-commands to suppress log output
jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

// Mock @actions/core
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

describe('loadUbuntuVersionNames', () => {
    it('returns a non-empty record of ubuntu version names', () => {
        const names = loadUbuntuVersionNames();
        expect(typeof names).toBe('object');
        expect(Object.keys(names).length).toBeGreaterThan(0);
    });

    it('maps version numbers to codenames', () => {
        const names = loadUbuntuVersionNames();
        // At least one well-known Ubuntu version should be present
        const values = Object.values(names);
        expect(values.some((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    });
});

describe('generateClangUrlsFor', () => {
    it('generates LLVM project URL with correct format', () => {
        const urls = generateClangUrlsFor('15.0.0', '22.04');
        expect(urls.llvmProjectUrl).toBe(
            'https://github.com/llvm/llvm-project/releases/download/llvmorg-15.0.0/clang+llvm-15.0.0-x86_64-linux-gnu-ubuntu-22.04.tar.xz'
        );
    });

    it('generates LLVM releases URL with correct format', () => {
        const urls = generateClangUrlsFor('14.0.0', '20.04');
        expect(urls.llvmReleasesUrl).toBe(
            'https://releases.llvm.org/14.0.0/clang+llvm-14.0.0-x86_64-linux-gnu-ubuntu-20.04.tar.xz'
        );
    });

    it('generates old-format releases URL with correct format', () => {
        const urls = generateClangUrlsFor('14.0.0', '20.04');
        expect(urls.oldLlvmReleasesUrl).toBe(
            'https://releases.llvm.org/14.0.0/clang+llvm-14.0.0-linux-x86_64-ubuntu20.04.tar.xz'
        );
    });
});

describe('clangDownloadCandidates', () => {
    const allVersions = [
        '14.0.0', '14.0.1', '14.0.6',
        '15.0.0', '15.0.1', '15.0.7',
        '16.0.0', '16.0.1', '16.0.6'
    ];

    it('returns the matching release version first in candidates', () => {
        const result = clangDownloadCandidates('>=15.0.0 <16.0.0', allVersions, true);
        expect(result.versionCandidates[0]).toBe('15.0.7');
    });

    it('returns min version first when checkLatest is false', () => {
        const result = clangDownloadCandidates('>=15.0.0 <16.0.0', allVersions, false);
        expect(result.versionCandidates[0]).toBe('15.0.0');
    });

    it('includes fallback versions from same major', () => {
        const result = clangDownloadCandidates('>=15.0.0 <16.0.0', allVersions, true);
        expect(result.versionCandidates).toContain('15.0.0');
        expect(result.versionCandidates).toContain('15.0.1');
    });

    it('returns ubuntu versions sorted by distance from current', () => {
        const result = clangDownloadCandidates('>=15.0.0 <16.0.0', allVersions, true);
        expect(result.ubuntuVersions.length).toBeGreaterThan(0);
        // Current mock returns 22.04 — it should be first or near first
        expect(result.ubuntuVersions[0]).toBe('22.04');
    });

    it('throws for unsatisfiable version constraint', () => {
        expect(() => clangDownloadCandidates('>=99.0.0', allVersions, true)).toThrow(
            'No version satisfies requirement'
        );
    });
});
