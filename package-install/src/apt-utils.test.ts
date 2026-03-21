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
    which: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
}));

jest.mock('./program-search', () => ({
    findProgramInSystemPaths: jest.fn().mockResolvedValue({ outputVersion: null, outputPath: null })
}));

import * as exec from '@actions/exec';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as programSearch from './program-search';
import {
    isSudoRequired,
    ensureKeyringsDir,
    importGpgKey,
    addAptSource,
    getPackagePreferenceTier,
    PackagePreferenceTier,
    searchAptPackages,
    installProgramWithApt,
    isAptAvailable,
    updateAptPackageLists,
    findProgramWithApt,
    ensureAddAptRepositoryIsAvailable
} from './apt-utils';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockDownloadTool = tc.downloadTool as jest.MockedFunction<typeof tc.downloadTool>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('isSudoRequired', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('returns false on non-linux platforms', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        expect(isSudoRequired()).toBe(false);
    });

    it('returns true on linux when not root', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        expect(isSudoRequired()).toBe(true);
    });

    it('returns false on linux when root', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        expect(isSudoRequired()).toBe(false);
    });

    it('returns false on windows', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        expect(isSudoRequired()).toBe(false);
    });
});

describe('ensureKeyringsDir', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('calls install with sudo when not root on linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        mockExec.mockResolvedValue(0);

        await ensureKeyringsDir();

        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'install', '-m', '0755', '-d', '/etc/apt/keyrings'],
            {}
        );
    });

    it('calls install without sudo when root', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await ensureKeyringsDir();

        expect(mockExec).toHaveBeenCalledWith(
            'install',
            ['-m', '0755', '-d', '/etc/apt/keyrings'],
            {}
        );
    });
});

describe('importGpgKey', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('downloads key, dearmors it, sets permissions, and returns path', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockDownloadTool.mockResolvedValue('/tmp/downloaded-key');
        mockExec.mockResolvedValue(0);

        const result = await importGpgKey('https://example.com/key.asc', 'my-key');

        expect(result).toBe('/etc/apt/keyrings/my-key.gpg');
        expect(mockDownloadTool).toHaveBeenCalledWith('https://example.com/key.asc');
        // ensureKeyringsDir
        expect(mockExec).toHaveBeenCalledWith(
            'install',
            ['-m', '0755', '-d', '/etc/apt/keyrings'],
            {}
        );
        // gpg --dearmor
        expect(mockExec).toHaveBeenCalledWith(
            'gpg',
            ['--dearmor', '-o', '/etc/apt/keyrings/my-key.gpg', '/tmp/downloaded-key'],
            {}
        );
        // chmod
        expect(mockExec).toHaveBeenCalledWith(
            'chmod',
            ['a+r', '/etc/apt/keyrings/my-key.gpg'],
            {}
        );
    });

    it('uses sudo for gpg and chmod when not root on linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        mockDownloadTool.mockResolvedValue('/tmp/downloaded-key');
        mockExec.mockResolvedValue(0);

        const result = await importGpgKey('https://example.com/key.asc', 'repo-key');

        expect(result).toBe('/etc/apt/keyrings/repo-key.gpg');
        // ensureKeyringsDir with sudo
        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'install', '-m', '0755', '-d', '/etc/apt/keyrings'],
            {}
        );
        // gpg --dearmor with sudo
        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'gpg', '--dearmor', '-o', '/etc/apt/keyrings/repo-key.gpg', '/tmp/downloaded-key'],
            {}
        );
        // chmod with sudo
        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'chmod', 'a+r', '/etc/apt/keyrings/repo-key.gpg'],
            {}
        );
    });

    it('returns correct key file path based on keyName', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockDownloadTool.mockResolvedValue('/tmp/key-file');
        mockExec.mockResolvedValue(0);

        const result = await importGpgKey('https://apt.llvm.org/llvm-snapshot.gpg.key', 'llvm-snapshot');

        expect(result).toBe('/etc/apt/keyrings/llvm-snapshot.gpg');
    });

    it('auto-installs gnupg when gpg is not available', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockDownloadTool.mockResolvedValue('/tmp/downloaded-key');
        mockExec.mockResolvedValue(0);

        // First call to io.which('gpg', true) throws — gpg not found
        // After apt-get install gnupg, second call succeeds (implicit from mockExec success)
        mockWhich.mockRejectedValueOnce(new Error('not found'));

        const result = await importGpgKey('https://example.com/key.asc', 'test-key');

        expect(result).toBe('/etc/apt/keyrings/test-key.gpg');
        // Should have called apt-get update + apt-get install gnupg
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get', ['update'], expect.objectContaining({ ignoreReturnCode: true })
        );
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get', ['install', '-y', 'gnupg'], expect.objectContaining({ ignoreReturnCode: true })
        );
        // Should still dearmor and store the key
        expect(mockExec).toHaveBeenCalledWith(
            'gpg', ['--dearmor', '-o', '/etc/apt/keyrings/test-key.gpg', '/tmp/downloaded-key'], {}
        );
    });

    it('falls back to apt-key when gpg install fails and apt-key is available', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockDownloadTool.mockResolvedValue('/tmp/downloaded-key');

        // gpg not found, gnupg install fails (non-zero exit)
        mockWhich
            .mockRejectedValueOnce(new Error('gpg not found'))
            .mockResolvedValueOnce('/usr/bin/apt-key');
        mockExec
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(1)  // apt-get install gnupg fails
            .mockResolvedValueOnce(0); // apt-key add succeeds

        const result = await importGpgKey('https://example.com/key.asc', 'test-key');

        expect(result).toBeNull();
        expect(mockExec).toHaveBeenCalledWith(
            'apt-key', ['add', '/tmp/downloaded-key'], {}
        );
    });

    it('throws when neither gpg nor apt-key is available', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockDownloadTool.mockResolvedValue('/tmp/downloaded-key');

        // gpg not found, gnupg install fails, apt-key not found
        mockWhich
            .mockRejectedValueOnce(new Error('gpg not found'))
            .mockRejectedValueOnce(new Error('apt-key not found'));
        mockExec
            .mockResolvedValueOnce(0)  // apt-get update
            .mockResolvedValueOnce(1); // apt-get install gnupg fails

        await expect(importGpgKey('https://example.com/key.asc', 'test-key'))
            .rejects.toThrow('Cannot import GPG key');
    });
});

describe('addAptSource', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('injects signed-by when not present in deb line', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await addAptSource('deb http://example.com/repo stable main', '/etc/apt/keyrings/foo.gpg', 'example');

        expect(mockExec).toHaveBeenCalledWith(
            'bash',
            ['-c', "echo 'deb [signed-by=/etc/apt/keyrings/foo.gpg] http://example.com/repo stable main' | tee /etc/apt/sources.list.d/example.list > /dev/null"],
            {}
        );
    });

    it('injects signed-by into existing brackets', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await addAptSource('deb [arch=amd64] http://example.com/repo stable main', '/etc/apt/keyrings/foo.gpg', 'example');

        expect(mockExec).toHaveBeenCalledWith(
            'bash',
            ['-c', "echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/foo.gpg] http://example.com/repo stable main' | tee /etc/apt/sources.list.d/example.list > /dev/null"],
            {}
        );
    });

    it('preserves existing signed-by unchanged', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await addAptSource('deb [signed-by=/existing/path.gpg] http://example.com/repo stable main', '/etc/apt/keyrings/foo.gpg', 'example');

        expect(mockExec).toHaveBeenCalledWith(
            'bash',
            ['-c', "echo 'deb [signed-by=/existing/path.gpg] http://example.com/repo stable main' | tee /etc/apt/sources.list.d/example.list > /dev/null"],
            {}
        );
    });

    it('handles deb-src prefix', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
        mockExec.mockResolvedValue(0);

        await addAptSource('deb-src http://example.com/repo stable main', '/etc/apt/keyrings/foo.gpg', 'example-src');

        expect(mockExec).toHaveBeenCalledWith(
            'bash',
            ['-c', "echo 'deb-src [signed-by=/etc/apt/keyrings/foo.gpg] http://example.com/repo stable main' | tee /etc/apt/sources.list.d/example-src.list > /dev/null"],
            {}
        );
    });

    it('writes to sources.list.d via sudo when not root', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
        mockExec.mockResolvedValue(0);

        await addAptSource('deb http://example.com/repo stable main', '/etc/apt/keyrings/foo.gpg', 'my-repo');

        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'bash', '-c', "echo 'deb [signed-by=/etc/apt/keyrings/foo.gpg] http://example.com/repo stable main' | tee /etc/apt/sources.list.d/my-repo.list > /dev/null"],
            {}
        );
    });
});

describe('execWithSudo (via installProgramWithApt on linux)', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('prepends sudo -n when running as non-root on linux', async () => {
        mockExec.mockResolvedValue(0);
        await installProgramWithApt('pkg');
        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            expect.arrayContaining(['-n', 'apt-get']),
            expect.any(Object)
        );
    });
});

describe('ensureSudoIsAvailable (via ensureAddAptRepositoryIsAvailable on linux)', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('installs sudo when not found (empty string)', async () => {
        mockWhich
            .mockResolvedValueOnce('') // add-apt-repository not found
            .mockResolvedValueOnce('') // sudo which returns empty (not found)
            .mockResolvedValueOnce('/usr/bin/sudo') // sudo which after install
            .mockResolvedValueOnce('/usr/bin/add-apt-repository'); // final which
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get update', [], { ignoreReturnCode: true });
        expect(mockExec).toHaveBeenCalledWith('apt-get install -y sudo', [], { ignoreReturnCode: true });
    });

    it('installs sudo when which throws', async () => {
        mockWhich
            .mockResolvedValueOnce('') // add-apt-repository not found
            .mockRejectedValueOnce(new Error('not found')) // sudo which throws
            .mockResolvedValueOnce('/usr/bin/sudo') // sudo which after install
            .mockResolvedValueOnce('/usr/bin/add-apt-repository'); // final which
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get update', [], { ignoreReturnCode: true });
        expect(mockExec).toHaveBeenCalledWith('apt-get install -y sudo', [], { ignoreReturnCode: true });
    });

    it('skips sudo install when sudo is found', async () => {
        mockWhich
            .mockResolvedValueOnce('') // add-apt-repository not found
            .mockResolvedValueOnce('/usr/bin/sudo') // sudo found
            .mockResolvedValueOnce('/usr/bin/add-apt-repository'); // final which
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).not.toHaveBeenCalledWith('apt-get install -y sudo', [], expect.any(Object));
    });
});

describe('updateAptPackageLists (with sudo on linux)', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 1000;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('runs apt-get update with sudo on linux as non-root', async () => {
        mockExec.mockResolvedValue(0);
        await updateAptPackageLists();
        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'apt-get', 'update'],
            { ignoreReturnCode: true }
        );
    });
});

describe('getPackagePreferenceTier', () => {
    it('returns UNVERSIONED tier for exact base name match', () => {
        expect(getPackagePreferenceTier('clang', ['clang'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('cmake', ['cmake'])).toBe(PackagePreferenceTier.UNVERSIONED);
    });

    it('returns RAW_VERSIONED tier for base name with version suffix', () => {
        expect(getPackagePreferenceTier('clang-14', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('cmake-3.24', ['cmake'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('clang-14.0', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });

    it('returns OTHER_VERSIONED tier for packages with additional suffixes', () => {
        expect(getPackagePreferenceTier('clang-14-tools', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-format-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-tidy-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('libclang-14-dev', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
    });

    it('handles multiple base names correctly', () => {
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });
});

describe('searchAptPackages', () => {
    it('returns null when no packages match the search', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: ''
        });

        const result = await searchAptPackages(['clang'], '>=14', true);
        expect(result).toBeNull();
    });

    it('throws when apt-cache search fails', async () => {
        mockGetExecOutput.mockResolvedValue({
            exitCode: 1,
            stdout: '',
            stderr: 'error'
        });

        await expect(searchAptPackages(['clang'], '*', true)).rejects.toThrow('Failed to run apt-cache search');
    });

    it('finds the best matching package with version', async () => {
        // apt-cache search returns matching packages
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'clang-14 - C language family frontend for LLVM\nclang-15 - C language family frontend for LLVM\n',
                stderr: ''
            })
            // apt-cache showpkg for clang-14
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: clang-14\nVersions:\n\nDependencies:\n1:14.0.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            })
            // apt-cache showpkg for clang-15
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: clang-15\nVersions:\n\nDependencies:\n1:15.0.7-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['clang'], '>=14', true);

        expect(result).not.toBeNull();
        expect(result!.packageName).toBe('clang-15');
        expect(result!.semverVersion).toBe('15.0.7');
    });

    it('prefers earliest version when checkLatest is false', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\ngcc-13 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-13\nVersions:\n\nDependencies:\n13.2.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['gcc'], '>=12', false);

        expect(result).not.toBeNull();
        expect(result!.packageName).toBe('gcc-12');
        expect(result!.semverVersion).toBe('12.3.0');
    });

    it('skips packages with empty showpkg output', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'clang-14 - C language frontend\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: '',
                stderr: ''
            });

        const result = await searchAptPackages(['clang'], '*', true);
        expect(result).toBeNull();
    });

    it('throws when apt-cache showpkg fails', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'clang-14 - C language frontend\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 1,
                stdout: '',
                stderr: 'error'
            });

        await expect(searchAptPackages(['clang'], '*', true)).rejects.toThrow('Failed to run "apt-cache showpkg');
    });

    it('skips packages without Dependencies section', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'clang-14 - C language frontend\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: clang-14\nVersions:\n1:14.0.0-1ubuntu1\n',
                stderr: ''
            });

        const result = await searchAptPackages(['clang'], '*', true);
        expect(result).toBeNull();
    });

    it('prefers higher-tier (lower number) packages', async () => {
        // Search returns both "gcc" (unversioned) and "gcc-12" (raw versioned)
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc - GNU C compiler\ngcc-12 - GNU C compiler\n',
                stderr: ''
            })
            // showpkg for gcc (unversioned, tier 1)
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            })
            // showpkg for gcc-12 (raw versioned, tier 2)
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['gcc'], '*', true);
        expect(result).not.toBeNull();
        expect(result!.packageName).toBe('gcc');
        expect(result!.tier).toBe(PackagePreferenceTier.UNVERSIONED);
    });

    it('skips versions that do not satisfy the constraint', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-11 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-11\nVersions:\n\nDependencies:\n11.4.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['gcc'], '>=12', true);
        expect(result).toBeNull();
    });

    it('handles epoch-prefixed versions (e.g., 1:14.0-1)', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'clang-14 - C language frontend\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: clang-14\nVersions:\n\nDependencies:\n1:14.0-1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['clang'], '>=14', true);
        expect(result).not.toBeNull();
        expect(result!.semverVersion).toBe('14.0.0');
    });

    it('handles multiple names by searching each', async () => {
        mockGetExecOutput
            // search for gcc
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            // search for g++
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'g++-12 - GNU C++ compiler\n',
                stderr: ''
            })
            // showpkg for gcc-12
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            })
            // showpkg for g++-12
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: g++-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await searchAptPackages(['gcc', 'g++'], '*', true);
        expect(result).not.toBeNull();
        expect(result!.alternatives.length).toBeGreaterThanOrEqual(2);
    });

    it('handles showpkg without Provides section', async () => {
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \n',
                stderr: ''
            });

        const result = await searchAptPackages(['gcc'], '*', true);
        expect(result).not.toBeNull();
        expect(result!.packageName).toBe('gcc-12');
    });
});

describe('installProgramWithApt', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('installs package with apt-get on success', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithApt('clang-14', '1:14.0.0-1ubuntu1');
        expect(result).toBe('clang-14');
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get',
            ['install', '-f', '-y', '--allow-downgrades', 'clang-14=1:14.0.0-1ubuntu1'],
            expect.any(Object)
        );
    });

    it('installs package without version when version is null', async () => {
        mockExec.mockResolvedValue(0);

        const result = await installProgramWithApt('build-essential');
        expect(result).toBe('build-essential');
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get',
            ['install', '-f', '-y', '--allow-downgrades', 'build-essential'],
            expect.any(Object)
        );
    });

    it('falls back to aptitude when apt-get fails', async () => {
        mockExec
            .mockResolvedValueOnce(100) // apt-get fails
            .mockResolvedValueOnce(0);  // aptitude succeeds
        mockWhich.mockResolvedValue('/usr/bin/aptitude');

        const result = await installProgramWithApt('clang-14', null);
        expect(result).toBe('clang-14');
        expect(mockExec).toHaveBeenCalledTimes(2);
        expect(mockExec).toHaveBeenNthCalledWith(2,
            'aptitude',
            ['install', '-f', '-y', 'clang-14'],
            expect.any(Object)
        );
    });

    it('skips aptitude when tryAptitude is false', async () => {
        mockExec.mockResolvedValue(100);

        const result = await installProgramWithApt('pkg', null, [], { tryAptitude: false });
        expect(result).toBeNull();
        expect(mockWhich).not.toHaveBeenCalled();
    });

    it('skips aptitude when aptitude is not found', async () => {
        mockExec.mockResolvedValue(100);
        mockWhich.mockRejectedValue(new Error('not found'));

        const result = await installProgramWithApt('pkg', null, []);
        expect(result).toBeNull();
    });

    it('handles aptitude which returning empty string', async () => {
        mockExec.mockResolvedValue(100);
        mockWhich.mockResolvedValue('');

        const result = await installProgramWithApt('pkg', null, []);
        expect(result).toBeNull();
    });

    it('tries alternative packages when primary fails', async () => {
        mockExec
            .mockResolvedValueOnce(100) // apt-get primary fails
            .mockResolvedValueOnce(100) // aptitude fails
            .mockResolvedValueOnce(100) // first alternative fails
            .mockResolvedValueOnce(0);  // second alternative succeeds
        mockWhich.mockResolvedValue('/usr/bin/aptitude');

        const result = await installProgramWithApt('pkg', '1.0', ['pkg=1.1', 'pkg=1.2']);
        expect(result).toBe('pkg');
    });

    it('skips alternatives when tryAlternatives is false', async () => {
        mockExec.mockResolvedValue(100);
        mockWhich.mockResolvedValue('');

        const result = await installProgramWithApt('pkg', null, ['alt=1.0'], { tryAlternatives: false });
        expect(result).toBeNull();
    });

    it('returns null when all install attempts fail', async () => {
        mockExec.mockResolvedValue(100);
        mockWhich.mockResolvedValue('');

        const result = await installProgramWithApt('pkg', null, ['alt=1.0']);
        expect(result).toBeNull();
    });

    it('returns alternative package name from "package=version" format', async () => {
        mockExec
            .mockResolvedValueOnce(100) // primary fails
            .mockResolvedValueOnce(0);  // alternative succeeds
        mockWhich.mockResolvedValue(''); // no aptitude

        const result = await installProgramWithApt('pkg', null, ['other-pkg=2.0']);
        expect(result).toBe('other-pkg');
    });
});

describe('isAptAvailable', () => {
    it('returns true when apt --version succeeds', async () => {
        mockExec.mockResolvedValue(0);
        const result = await isAptAvailable();
        expect(result).toBe(true);
        expect(mockExec).toHaveBeenCalledWith('apt', ['--version'], { silent: true });
    });

    it('returns false when apt --version fails', async () => {
        mockExec.mockResolvedValue(1);
        const result = await isAptAvailable();
        expect(result).toBe(false);
    });

    it('returns false when apt exec throws', async () => {
        mockExec.mockRejectedValue(new Error('command not found'));
        const result = await isAptAvailable();
        expect(result).toBe(false);
    });
});

describe('updateAptPackageLists (as root)', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('runs apt-get update without sudo when root', async () => {
        mockExec.mockResolvedValue(0);
        await updateAptPackageLists();
        expect(mockExec).toHaveBeenCalledWith('apt-get', ['update'], { ignoreReturnCode: true });
    });
});

describe('findProgramWithApt', () => {
    it('returns nulls when APT is not available', async () => {
        mockExec.mockResolvedValue(1);

        const result = await findProgramWithApt(['clang'], '*', true);
        expect(result).toEqual({
            outputVersion: null,
            outputPath: null,
            installedPackage: null
        });
    });

    it('returns nulls when no matching package is found', async () => {
        mockExec.mockResolvedValue(0); // apt available + apt-get update
        mockGetExecOutput.mockResolvedValue({
            exitCode: 0,
            stdout: '',
            stderr: ''
        });

        const result = await findProgramWithApt(['nonexistent'], '*', true);
        expect(result.outputPath).toBeNull();
        expect(result.installedPackage).toBeNull();
    });

    it('installs and locates program when package is found', async () => {
        mockExec.mockResolvedValue(0); // apt available + apt-get update + apt-get install
        mockGetExecOutput
            // apt-cache search
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            // apt-cache showpkg
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });
        (programSearch.findProgramInSystemPaths as jest.Mock).mockResolvedValueOnce({
            outputVersion: '12.3.0',
            outputPath: '/usr/bin/gcc-12'
        });

        const result = await findProgramWithApt(['gcc'], '*', true);
        expect(result.outputPath).toBe('/usr/bin/gcc-12');
        expect(result.outputVersion).toBe('12.3.0');
        expect(result.installedPackage).toBe('gcc-12');
    });

    it('returns null path when install succeeds but program not found in paths', async () => {
        mockExec.mockResolvedValue(0);
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });
        (programSearch.findProgramInSystemPaths as jest.Mock).mockResolvedValueOnce({
            outputVersion: null,
            outputPath: null
        });

        const result = await findProgramWithApt(['gcc'], '*', true);
        expect(result.outputPath).toBeNull();
        expect(result.installedPackage).toBe('gcc-12');
    });

    it('returns null outputVersion/outputPath when program not found in system paths', async () => {
        mockExec.mockResolvedValue(0);
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });

        const result = await findProgramWithApt(['gcc'], '*', true);
        expect(result.outputPath).toBeNull();
        expect(result.outputVersion).toBeNull();
        expect(result.installedPackage).toBe('gcc-12');
    });

    it('catches and logs errors during search/install', async () => {
        mockExec.mockResolvedValue(0); // apt available
        mockGetExecOutput.mockRejectedValue(new Error('apt-cache failed'));

        const result = await findProgramWithApt(['gcc'], '*', true);
        expect(result.outputPath).toBeNull();
        expect(result.installedPackage).toBeNull();
    });

    it('returns null installedPackage when install fails', async () => {
        mockExec
            .mockResolvedValueOnce(0) // apt available
            .mockResolvedValueOnce(0) // apt-get update
            .mockResolvedValue(100);  // all apt-get install attempts fail
        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'gcc-12 - GNU C compiler\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Package: gcc-12\nVersions:\n\nDependencies:\n12.3.0-1ubuntu1 - \nProvides:\n',
                stderr: ''
            });
        mockWhich.mockResolvedValue(''); // no aptitude

        const result = await findProgramWithApt(['gcc'], '*', true);
        expect(result.installedPackage).toBeNull();
        expect(result.outputPath).toBeNull();
    });
});

describe('ensureAddAptRepositoryIsAvailable', () => {
    const origPlatform = process.platform;
    const origGetuid = process.getuid;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.getuid = () => 0;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('does nothing when add-apt-repository is found', async () => {
        mockWhich.mockResolvedValue('/usr/bin/add-apt-repository');

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).not.toHaveBeenCalled();
    });

    it('installs software-properties-common when add-apt-repository not found', async () => {
        mockWhich
            .mockRejectedValueOnce(new Error('not found')) // first which fails
            .mockResolvedValueOnce('/usr/bin/add-apt-repository'); // final which succeeds
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get', ['update'], { ignoreReturnCode: true });
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get',
            ['install', '-f', '-y', '--allow-downgrades', 'software-properties-common'],
            expect.any(Object)
        );
    });

    it('ensures sudo is available when required on linux', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const origGetuid = process.getuid;
        process.getuid = () => 1000;

        mockWhich
            .mockResolvedValueOnce('') // add-apt-repository not found (empty)
            .mockResolvedValueOnce('/usr/bin/sudo') // sudo which in ensureSudoIsAvailable
            .mockResolvedValueOnce('/usr/bin/add-apt-repository'); // final which
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();

        Object.defineProperty(process, 'platform', { value: origPlatform });
        process.getuid = origGetuid;
    });

    it('does not call ensureSudoIsAvailable when sudo not required', async () => {
        mockWhich
            .mockResolvedValueOnce('') // not found
            .mockResolvedValueOnce('/usr/bin/add-apt-repository');
        mockExec.mockResolvedValue(0);

        await ensureAddAptRepositoryIsAvailable();
        expect(mockExec).toHaveBeenCalledWith('apt-get', ['update'], { ignoreReturnCode: true });
    });
});
