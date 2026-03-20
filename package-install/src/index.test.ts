import { main } from './index';
import type { Inputs } from './schema';
import { describePrettyErrors } from 'pretty-errors/test-helper';

// Mock @actions/core for pretty-errors test
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
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

jest.mock('./brew-install', () => ({
    brewMain: jest.fn()
}));

jest.mock('./choco-install', () => ({
    chocoMain: jest.fn()
}));

jest.mock('./vcpkg-install', () => ({
    vcpkgMain: jest.fn()
}));

import { aptGetMain } from './apt-install';
import { brewMain } from './brew-install';
import { chocoMain } from './choco-install';
import { vcpkgMain } from './vcpkg-install';

const mockAptGetMain = aptGetMain as jest.MockedFunction<typeof aptGetMain>;
const mockBrewMain = brewMain as jest.MockedFunction<typeof brewMain>;
const mockChocoMain = chocoMain as jest.MockedFunction<typeof chocoMain>;
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
        brew: [],
        brewCask: [],
        choco: [],
        packages: [],
        retries: 5,
        brewRetries: 0,
        chocoRetries: 0,
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
        mockBrewMain.mockResolvedValue(undefined);
        mockChocoMain.mockResolvedValue(undefined);
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

    // Brew wiring tests (US-027)
    it('calls brewMain when brew packages specified on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ brew: ['cmake'] });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brew: ['cmake'] })
        );
    });

    it('calls brewMain when brew packages specified on Linux', async () => {
        const inputs = makeInputs({ brew: ['cmake'] });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brew: ['cmake'] })
        );
    });

    it('calls brewMain when brewCask packages specified on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ brewCask: ['firefox'] });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brewCask: ['firefox'] })
        );
    });

    it('does not call brewMain on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ brew: ['cmake'] });
        await main(inputs);

        expect(mockBrewMain).not.toHaveBeenCalled();
    });

    it('does not call brewMain when brew and brewCask are both empty', async () => {
        const inputs = makeInputs({ brew: [], brewCask: [] });
        await main(inputs);

        expect(mockBrewMain).not.toHaveBeenCalled();
    });

    // Choco wiring tests (US-028)
    it('calls chocoMain when choco packages specified on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ choco: ['cmake'] });
        await main(inputs);

        expect(mockChocoMain).toHaveBeenCalledWith(
            expect.objectContaining({ choco: ['cmake'] })
        );
    });

    it('does not call chocoMain on Linux', async () => {
        const inputs = makeInputs({ choco: ['cmake'] });
        await main(inputs);

        expect(mockChocoMain).not.toHaveBeenCalled();
    });

    it('does not call chocoMain on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ choco: ['cmake'] });
        await main(inputs);

        expect(mockChocoMain).not.toHaveBeenCalled();
    });

    it('does not call chocoMain when choco is empty', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ choco: [] });
        await main(inputs);

        expect(mockChocoMain).not.toHaveBeenCalled();
    });

    // Packages routing tests (US-029/US-032)
    it('routes packages to apt-get on Linux', async () => {
        const inputs = makeInputs({ packages: ['cmake', 'gcc'] });
        await main(inputs);

        expect(mockAptGetMain).toHaveBeenCalledWith(
            expect.objectContaining({ apt_get: ['cmake', 'gcc'] })
        );
    });

    it('routes packages to brew on macOS', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ packages: ['cmake', 'gcc'] });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brew: ['cmake', 'gcc'] })
        );
    });

    it('routes packages to choco on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ packages: ['cmake', 'gcc'] });
        await main(inputs);

        expect(mockChocoMain).toHaveBeenCalledWith(
            expect.objectContaining({
                choco: expect.arrayContaining(['cmake', 'gcc'])
            })
        );
    });

    it('merges packages with PM-specific inputs and deduplicates', async () => {
        const inputs = makeInputs({ packages: ['cmake', 'gcc'], apt_get: ['cmake', 'build-essential'] });
        await main(inputs);

        const calledInputs = mockAptGetMain.mock.calls[0][0];
        // cmake should appear only once (deduplicated), gcc and build-essential should both be present
        const cmakeCount = calledInputs.apt_get.filter((p: string) => p === 'cmake').length;
        expect(cmakeCount).toBe(1);
        expect(calledInputs.apt_get).toContain('gcc');
        expect(calledInputs.apt_get).toContain('build-essential');
    });

    it('does not route when packages is empty', async () => {
        const inputs = makeInputs({ packages: [] });
        await main(inputs);

        expect(mockAptGetMain).not.toHaveBeenCalled();
        expect(mockBrewMain).not.toHaveBeenCalled();
        expect(mockChocoMain).not.toHaveBeenCalled();
    });

    // Shared retries tests (US-030/US-032)
    it('flows shared retries to apt when aptGetRetries is not set', async () => {
        const inputs = makeInputs({ apt_get: ['pkg1'], retries: 7, aptGetRetries: 0 });
        await main(inputs);

        expect(mockAptGetMain).toHaveBeenCalledWith(
            expect.objectContaining({ aptGetRetries: 7 })
        );
    });

    it('PM-specific aptGetRetries overrides shared retries', async () => {
        const inputs = makeInputs({ apt_get: ['pkg1'], retries: 7, aptGetRetries: 3 });
        await main(inputs);

        expect(mockAptGetMain).toHaveBeenCalledWith(
            expect.objectContaining({ aptGetRetries: 3 })
        );
    });

    it('flows shared retries to brew when brewRetries is not set', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ brew: ['cmake'], retries: 7, brewRetries: 0 });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brewRetries: 7 })
        );
    });

    it('PM-specific brewRetries overrides shared retries', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
        const inputs = makeInputs({ brew: ['cmake'], retries: 7, brewRetries: 3 });
        await main(inputs);

        expect(mockBrewMain).toHaveBeenCalledWith(
            expect.objectContaining({ brewRetries: 3 })
        );
    });

    it('flows shared retries to choco when chocoRetries is not set', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ choco: ['cmake'], retries: 7, chocoRetries: 0 });
        await main(inputs);

        expect(mockChocoMain).toHaveBeenCalledWith(
            expect.objectContaining({ chocoRetries: 7 })
        );
    });

    it('PM-specific chocoRetries overrides shared retries', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
        const inputs = makeInputs({ choco: ['cmake'], retries: 7, chocoRetries: 3 });
        await main(inputs);

        expect(mockChocoMain).toHaveBeenCalledWith(
            expect.objectContaining({ chocoRetries: 3 })
        );
    });

    // Deprecation warning tests (US-031/US-032)
    it('emits deprecation warning when "vcpkg" is in apt_get list', async () => {
        const core = await import('@actions/core');
        const inputs = makeInputs({ apt_get: ['vcpkg', 'build-essential'] });
        await main(inputs);

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Passing "vcpkg" in the apt-get package list')
        );
    });

    it('emits deprecation warning when "true" is in vcpkg list', async () => {
        const core = await import('@actions/core');
        const inputs = makeInputs({ vcpkg: ['true'] });
        await main(inputs);

        expect(core.warning).toHaveBeenCalledWith(
            expect.stringContaining('Passing "true" in the vcpkg package list')
        );
    });

    it('sets vcpkgForceInstall when "vcpkg" is in apt_get list', async () => {
        const inputs = makeInputs({ apt_get: ['vcpkg', 'build-essential'] });
        await main(inputs);

        // vcpkg should be removed from apt_get, vcpkgForceInstall should be set
        expect(mockVcpkgMain).toHaveBeenCalled();
        expect(mockAptGetMain).toHaveBeenCalled();
        const calledInputs = mockAptGetMain.mock.calls[0][0];
        expect(calledInputs.apt_get).not.toContain('vcpkg');
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
