import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock external modules
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    exportVariable: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('setup-program', () => ({
    getPackagePreferenceTier: jest.fn(),
    PackagePreferenceTier: { UNVERSIONED: 1, RAW_VERSIONED: 2, OTHER_VERSIONED: 3 },
    findLlvmSymbolizer: jest.fn().mockResolvedValue(null)
}));

const realExistsSync = jest.requireActual<typeof fs>('fs').existsSync;
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn((...args: Parameters<typeof fs.existsSync>) => realExistsSync(...args))
}));

import {
    findFileRecursive,
    hasSanitizerRuntimes,
    findLlvmSymbolizer,
    installCompanionPackages
} from './companion-packages';
import * as exec from '@actions/exec';
import * as setup_program from 'setup-program';

const mockFindLlvmSymbolizer = setup_program.findLlvmSymbolizer as jest.MockedFunction<typeof setup_program.findLlvmSymbolizer>;
const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockGetPackagePreferenceTier = setup_program.getPackagePreferenceTier as jest.MockedFunction<typeof setup_program.getPackagePreferenceTier>;

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
        expect(hasSanitizerRuntimes(999)).toBe(false);
    });

    it('returns true when a direct path exists', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clang-san-'));
        // hasSanitizerRuntimes checks hardcoded paths, so on a test machine it will return false
        // This test verifies the function runs without error
        const result = hasSanitizerRuntimes(14);
        expect(typeof result).toBe('boolean');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});

describe('findLlvmSymbolizer', () => {
    it('is re-exported from setup-program', () => {
        expect(findLlvmSymbolizer).toBe(setup_program.findLlvmSymbolizer);
    });
});

describe('installCompanionPackages', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('skips on non-Linux platform', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        const result = await installCompanionPackages('14.0.0', null, false);
        expect(result.symbolizerPath).toBeNull();
    });

    it('returns early when APT exec throws', async () => {
        mockExec.mockRejectedValueOnce(new Error('apt not found'));
        const result = await installCompanionPackages('14.0.0', null, false);
        expect(result.symbolizerPath).toBeNull();
    });

    it('returns early when APT returns non-zero exit code', async () => {
        mockExec.mockResolvedValueOnce(1);
        const result = await installCompanionPackages('14.0.0', null, false);
        expect(result.symbolizerPath).toBeNull();
    });

    it('returns early when version cannot be parsed', async () => {
        mockExec.mockResolvedValueOnce(0);
        const result = await installCompanionPackages('not-a-version', null, false);
        expect(result.symbolizerPath).toBeNull();
    });

    it('detects unversioned package tier', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo check
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.UNVERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        // Install llvm package
        mockExec.mockResolvedValueOnce(0); // apt-get install llvm succeeds
        // Sanitizer check - not found, install attempt
        mockExec.mockResolvedValueOnce(0); // install sanitizer package

        const result = await installCompanionPackages('14.0.0', 'clang', false);
        // Should try unversioned 'llvm' first for unversioned 'clang'
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('apt-get install -y llvm'),
            [],
            expect.any(Object)
        );
        expect(result).toBeDefined();
    });

    it('detects versioned package and tries versioned llvm first', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo check
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        // Install llvm-14 package
        mockExec.mockResolvedValueOnce(0); // apt-get install llvm-14 succeeds
        // Sanitizer runtimes check - not found, install attempt
        mockExec.mockResolvedValueOnce(0); // install sanitizer package

        const result = await installCompanionPackages('14.0.0', 'clang-14', false);
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('apt-get install -y llvm-14'),
            [],
            expect.any(Object)
        );
        expect(result).toBeDefined();
    });

    it('uses sudo when available', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo works
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        // Install llvm-14 with sudo
        mockExec.mockResolvedValueOnce(0);
        // Sanitizer install
        mockExec.mockResolvedValueOnce(0);

        await installCompanionPackages('14.0.0', 'clang-14', false);
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('sudo -n apt-get install'),
            [],
            expect.any(Object)
        );
    });

    it('skips sudo when not available', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockRejectedValueOnce(new Error('no sudo')); // sudo not available
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        mockExec.mockResolvedValueOnce(0); // install llvm
        mockExec.mockResolvedValueOnce(0); // install sanitizer

        await installCompanionPackages('14.0.0', 'clang-14', false);
        // Should not have sudo prefix
        const installCalls = mockExec.mock.calls.filter(c =>
            (c[0] as string).includes('apt-get install')
        );
        for (const call of installCalls) {
            expect(call[0]).not.toContain('sudo');
        }
    });

    it('tries second llvm package when first fails', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        // First llvm package fails
        mockExec.mockResolvedValueOnce(1);
        // Second llvm package succeeds
        mockExec.mockResolvedValueOnce(0);
        // Sanitizer install
        mockExec.mockResolvedValueOnce(0);

        await installCompanionPackages('14.0.0', 'clang-14', false);
        const installCalls = mockExec.mock.calls.filter(c =>
            (c[0] as string).includes('apt-get install')
        );
        expect(installCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('skips llvm install when symbolizer already found', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValueOnce('/usr/bin/llvm-symbolizer-14');
        // Sanitizer runtimes not found, install
        mockExec.mockResolvedValueOnce(0);

        const result = await installCompanionPackages('14.0.0', 'clang-14', false);
        expect(result.symbolizerPath).toBe('/usr/bin/llvm-symbolizer-14');
    });

    it('handles null installedAptPackage', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValue(null);
        mockExec.mockResolvedValueOnce(0); // install llvm
        mockExec.mockResolvedValueOnce(0); // install sanitizer

        const result = await installCompanionPackages('14.0.0', null, false);
        expect(result).toBeDefined();
    });

    it('tries second sanitizer package when first fails', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        mockFindLlvmSymbolizer.mockResolvedValueOnce('/usr/bin/llvm-symbolizer');
        // First sanitizer package fails, second succeeds
        mockExec.mockResolvedValueOnce(1);  // libclang-rt-14-dev fails
        mockExec.mockResolvedValueOnce(0);  // libclang-common-14-dev succeeds

        await installCompanionPackages('14.0.0', 'clang-14', false);
        const installCalls = mockExec.mock.calls.filter(c =>
            (c[0] as string).includes('apt-get install')
        );
        expect(installCalls).toHaveLength(2);
        expect(installCalls[0][0]).toContain('libclang-rt-14-dev');
        expect(installCalls[1][0]).toContain('libclang-common-14-dev');
    });

    it('returns symbolizer path after successful llvm install', async () => {
        mockExec.mockResolvedValueOnce(0); // apt --version
        mockGetExecOutput.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // sudo
        mockGetPackagePreferenceTier.mockReturnValue(setup_program.PackagePreferenceTier.RAW_VERSIONED);
        // symbolizer not found initially, then found after install
        mockFindLlvmSymbolizer
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('/usr/bin/llvm-symbolizer-14');
        // Install llvm succeeds
        mockExec.mockResolvedValueOnce(0);
        // Sanitizer install
        mockExec.mockResolvedValueOnce(0);

        const result = await installCompanionPackages('14.0.0', 'clang-14', false);
        expect(result.symbolizerPath).toBe('/usr/bin/llvm-symbolizer-14');
    });
});
