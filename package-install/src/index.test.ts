import { main } from './index';
import type { Inputs } from './schema';
import { describePrettyErrors } from 'pretty-errors/test-helper';

// Mock @actions/core for pretty-errors test
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    addPath: jest.fn(),
    exportVariable: jest.fn(),
    getInput: jest.fn()
}));

jest.mock('./apt-install', () => ({
    aptGetMain: jest.fn()
}));

jest.mock('./vcpkg-install', () => ({
    vcpkgMain: jest.fn()
}));

import { aptGetMain } from './apt-install';
import { vcpkgMain } from './vcpkg-install';

const mockAptGetMain = aptGetMain as jest.MockedFunction<typeof aptGetMain>;
const mockVcpkgMain = vcpkgMain as jest.MockedFunction<typeof vcpkgMain>;

/**
 * Creates a default Inputs object for testing with optional overrides.
 *
 * @param overrides - Partial input values to override defaults
 * @returns Complete Inputs object
 */
function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        traceCommands: false,
        vcpkg: [],
        apt_get: [],
        cxx: '',
        cxxflags: '',
        cc: '',
        ccflags: '',
        vcpkgTriplet: '',
        vcpkgDir: '',
        vcpkgBranch: 'master',
        vcpkgCache: true,
        vcpkgForceInstall: false,
        aptGetRetries: 3,
        aptGetSources: [],
        aptGetSourceKeys: [],
        aptGetIgnoreMissing: false,
        aptGetAddArchitecture: [],
        aptGetBulkInstall: false,
        ...overrides
    };
}

describe('package-install', () => {
    const origPlatform = process.platform;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAptGetMain.mockResolvedValue(undefined);
        mockVcpkgMain.mockResolvedValue({ vcpkgExecutable: '/vcpkg/vcpkg', vcpkgToolchain: '/vcpkg/toolchain.cmake' });
        Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: origPlatform, writable: true });
    });

    it('main function is exported', () => {
        expect(main).toBeDefined();
        expect(typeof main).toBe('function');
    });

    it('calls aptGetMain when apt packages specified on Linux', async () => {
        const inputs = makeInputs({ apt_get: ['pkg1'] });
        await main(inputs);

        expect(mockAptGetMain).toHaveBeenCalledWith(
            expect.objectContaining({ apt_get: ['pkg1'] })
        );
    });

    it('does not call aptGetMain on non-Linux platforms', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ apt_get: ['pkg1'] });
        await main(inputs);

        expect(mockAptGetMain).not.toHaveBeenCalled();
    });

    it('does not call aptGetMain when no apt packages', async () => {
        const inputs = makeInputs({ apt_get: [] });
        await main(inputs);

        expect(mockAptGetMain).not.toHaveBeenCalled();
    });

    it('calls vcpkgMain when vcpkg packages specified', async () => {
        const inputs = makeInputs({ vcpkg: ['zlib'] });
        const result = await main(inputs);

        expect(mockVcpkgMain).toHaveBeenCalled();
        expect(result.vcpkgExecutable).toBeDefined();
    });

    it('calls vcpkgMain when vcpkgForceInstall is true', async () => {
        const inputs = makeInputs({ vcpkgForceInstall: true });
        await main(inputs);

        expect(mockVcpkgMain).toHaveBeenCalled();
    });

    it('returns empty object when no vcpkg packages and no force install', async () => {
        const inputs = makeInputs({ vcpkg: [], vcpkgForceInstall: false });
        const result = await main(inputs);

        expect(mockVcpkgMain).not.toHaveBeenCalled();
        expect(result).toEqual({});
    });

    it('adds vcpkg dependencies to apt_get on Linux when vcpkg packages specified', async () => {
        const inputs = makeInputs({ vcpkg: ['zlib'] });
        await main(inputs);

        // Should have added git, curl, zip, unzip, tar to apt_get
        expect(mockAptGetMain).toHaveBeenCalledWith(
            expect.objectContaining({
                apt_get: expect.arrayContaining(['git', 'curl', 'zip', 'unzip', 'tar'])
            })
        );
    });

    it('does not add vcpkg dependencies to apt_get on non-Linux', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ vcpkg: ['zlib'] });
        await main(inputs);

        // aptGetMain should not be called on non-linux
        expect(mockAptGetMain).not.toHaveBeenCalled();
    });

    it('does not duplicate existing vcpkg deps in apt_get', async () => {
        const inputs = makeInputs({ vcpkg: ['zlib'], apt_get: ['git', 'curl'] });
        await main(inputs);

        const calledInputs = mockAptGetMain.mock.calls[0][0];
        const gitCount = calledInputs.apt_get.filter((p: string) => p === 'git').length;
        expect(gitCount).toBe(1);
    });

    it('sets vcpkgForceInstall when "vcpkg" is in apt_get list', async () => {
        const inputs = makeInputs({ apt_get: ['vcpkg', 'build-essential'] });
        await main(inputs);

        // vcpkg should be removed from apt_get, vcpkgForceInstall should be set
        expect(mockVcpkgMain).toHaveBeenCalled();
        if (mockAptGetMain.mock.calls.length > 0) {
            const calledInputs = mockAptGetMain.mock.calls[0][0];
            expect(calledInputs.apt_get).not.toContain('vcpkg');
        }
    });

    it('sets vcpkgForceInstall when "true" is in vcpkg list', async () => {
        const inputs = makeInputs({ vcpkg: ['true'] });
        await main(inputs);

        // "true" should be removed from vcpkg list, vcpkgForceInstall should be set
        expect(mockVcpkgMain).toHaveBeenCalledWith(
            expect.objectContaining({
                vcpkg: expect.not.arrayContaining(['true']),
                vcpkgForceInstall: true
            })
        );
    });
});

describePrettyErrors('pkg boom', 'Package install failed');
