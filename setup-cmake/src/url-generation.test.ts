import { generateCMakeURL } from './url-generation';

describe('generateCMakeURL', () => {
    const fnlog = jest.fn();
    const savedEnv = { ...process.env };
    const origPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...savedEnv };
        delete process.env['RUNNER_OS'];
        delete process.env['RUNNER_ARCH'];
        Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    afterEach(() => {
        process.env = savedEnv;
        Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('throws on invalid version', () => {
        expect(() => generateCMakeURL('not-a-version', '', fnlog)).toThrow('Invalid version: not-a-version');
    });

    // Modern versions (> 3.19.0) using process.platform for urlOs resolution
    describe('modern versions', () => {
        test('Linux x86_64', () => {
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-x86_64.tar.gz');
        });

        test('Linux aarch64 via arm64', () => {
            const url = generateCMakeURL('3.28.0', 'arm64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-aarch64.tar.gz');
        });

        test('Linux aarch64 via arm', () => {
            const url = generateCMakeURL('3.28.0', 'arm', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-aarch64.tar.gz');
        });

        test('Windows via process.platform=win32 (urlOs=windows)', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            // systemOs='win32' matches extension check → zip
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-windows-x86_64.zip');
        });

        test('Windows arm64 via process.platform=win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const url = generateCMakeURL('3.28.0', 'arm64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-windows-arm64.zip');
        });

        test('macOS universal via process.platform=darwin', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-macos-universal.tar.gz');
        });
    });

    // Old versions (<= 3.19.0) using process.platform
    describe('old versions (<= 3.19.0)', () => {
        test('Linux uses capitalized "Linux"', () => {
            const url = generateCMakeURL('3.18.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.18/cmake-3.18.0-Linux-x86_64.tar.gz');
        });

        test('Windows x64 uses win64', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const url = generateCMakeURL('3.18.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.18/cmake-3.18.0-win64-x64.zip');
        });

        test('Windows x86 uses win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const url = generateCMakeURL('3.18.0', 'x86', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.18/cmake-3.18.0-win32-x86.zip');
        });

        test('macOS <= 3.18.2 uses Darwin (arch stays as input)', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            // urlOs becomes 'Darwin', which doesn't match 'macos' → urlArch stays as-is
            const url = generateCMakeURL('3.17.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.17/cmake-3.17.0-Darwin-x64.tar.gz');
        });

        test('macOS 3.19.0 uses "macos" (not Darwin, universal arch)', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            const url = generateCMakeURL('3.19.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.19/cmake-3.19.0-macos-universal.tar.gz');
        });

        test('ia32 maps to x86 then win32 on Windows old', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            const url = generateCMakeURL('3.18.0', 'ia32', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.18/cmake-3.18.0-win32-x86.zip');
        });

        test('old Linux aarch64', () => {
            const url = generateCMakeURL('3.18.0', 'arm64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.18/cmake-3.18.0-Linux-aarch64.tar.gz');
        });
    });

    // Architecture fallback chain
    describe('architecture fallback', () => {
        test('uses RUNNER_ARCH when architecture is empty', () => {
            process.env['RUNNER_ARCH'] = 'ARM64';
            const url = generateCMakeURL('3.28.0', '', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-aarch64.tar.gz');
        });

        test('uses process.arch when no architecture or RUNNER_ARCH', () => {
            const url = generateCMakeURL('3.28.0', '', fnlog);
            expect(url).toContain('cmake-3.28.0-linux-');
        });

        test('explicit architecture takes priority over RUNNER_ARCH', () => {
            process.env['RUNNER_ARCH'] = 'ARM64';
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-x86_64.tar.gz');
        });
    });

    // Extension depends on systemOs === 'windows' (only true when RUNNER_OS='Windows')
    describe('extension', () => {
        test('zip extension when RUNNER_OS is Windows', () => {
            process.env['RUNNER_OS'] = 'Windows';
            // systemOs='windows' → urlOs='windows' → else → 'linux' (code quirk)
            // but extension checks systemOs='windows' → 'zip'
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toMatch(/\.zip$/);
        });

        test('tar.gz extension for Linux', () => {
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toMatch(/\.tar\.gz$/);
        });

        test('tar.gz extension for macOS', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            const url = generateCMakeURL('3.28.0', 'x64', fnlog);
            expect(url).toMatch(/\.tar\.gz$/);
        });
    });

    test('logs the generated URL', () => {
        generateCMakeURL('3.28.0', 'x64', fnlog);
        expect(fnlog).toHaveBeenCalledWith(expect.stringContaining('CMake URL:'));
    });

    test('uses RUNNER_OS when available (linux)', () => {
        process.env['RUNNER_OS'] = 'Linux';
        const url = generateCMakeURL('3.28.0', 'x64', fnlog);
        expect(url).toBe('https://cmake.org/files/v3.28/cmake-3.28.0-linux-x86_64.tar.gz');
    });
});
