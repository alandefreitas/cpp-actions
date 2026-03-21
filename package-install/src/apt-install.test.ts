import { aptGetMain } from './apt-install';
import { type Inputs } from './schema';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import { importGpgKey, addAptSource } from './apt-utils';

jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    setFailed: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    exec: jest.fn(),
    getExecOutput: jest.fn()
}));

jest.mock('@actions/io', () => ({
    which: jest.fn()
}));

jest.mock('trace-commands', () => ({
    scoped: jest.fn(() => jest.fn())
}));

jest.mock('./apt-utils', () => ({
    isSudoRequired: jest.fn(() => false),
    importGpgKey: jest.fn(async (_url: string, keyName: string) => `/etc/apt/keyrings/${keyName}.gpg`),
    addAptSource: jest.fn()
}));

import * as core from '@actions/core';

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWhich = io.which as jest.MockedFunction<typeof io.which>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockImportGpgKey = importGpgKey as jest.MockedFunction<typeof importGpgKey>;
const mockAddAptSource = addAptSource as jest.MockedFunction<typeof addAptSource>;

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

describe('aptGetMain', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        mockWhich.mockResolvedValue('/usr/bin/apt-get');
        mockExec.mockResolvedValue(0);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('finds apt-get and runs update with no packages', async () => {
        const inputs = makeInputs();
        await aptGetMain(inputs);

        expect(mockWhich).toHaveBeenCalledWith('apt-get', true);
        // Should call apt-get update
        expect(mockExec).toHaveBeenCalledWith(
            'apt-get',
            ['-o', 'Acquire::Retries=3', 'update']
        );
    });

    it('uses sudo prefix when sudo is required', async () => {
        const setup_program = require('./apt-utils');
        setup_program.isSudoRequired.mockReturnValueOnce(true);

        const inputs = makeInputs();
        await aptGetMain(inputs);

        expect(mockExec).toHaveBeenCalledWith(
            'sudo',
            ['-n', 'apt-get', '-o', 'Acquire::Retries=3', 'update']
        );
    });

    describe('source keys', () => {
        it('imports source keys via importGpgKey', async () => {
            const inputs = makeInputs({
                aptGetSourceKeys: ['https://example.com/key.gpg'],
                aptGetRetries: 3
            });
            await aptGetMain(inputs);

            expect(mockImportGpgKey).toHaveBeenCalledWith('https://example.com/key.gpg', 'source-key-0');
        });

        it('retries on key import failure then succeeds', async () => {
            mockImportGpgKey
                .mockRejectedValueOnce(new Error('download failed'))
                .mockResolvedValue('/etc/apt/keyrings/source-key-0.gpg');

            const inputs = makeInputs({
                aptGetSourceKeys: ['https://example.com/key.gpg'],
                aptGetRetries: 2
            });
            const promise = aptGetMain(inputs);
            await jest.advanceTimersByTimeAsync(10000);
            await promise;

            expect(mockImportGpgKey).toHaveBeenCalledTimes(2);
        });

        it('throws on last retry failure', async () => {
            mockImportGpgKey.mockRejectedValue(new Error('download failed'));

            const inputs = makeInputs({
                aptGetSourceKeys: ['https://example.com/key.gpg'],
                aptGetRetries: 1
            });

            await expect(aptGetMain(inputs)).rejects.toThrow('download failed');
        });

        it('calls addAptSource for sources paired with keys', async () => {
            mockImportGpgKey.mockResolvedValue('/etc/apt/keyrings/source-key-0.gpg');
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: '0.99.0',
                stderr: ''
            });

            const inputs = makeInputs({
                aptGetSourceKeys: ['https://example.com/key.gpg'],
                aptGetSources: ['deb http://example.com/repo stable main'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            expect(mockAddAptSource).toHaveBeenCalledWith(
                'deb http://example.com/repo stable main',
                '/etc/apt/keyrings/source-key-0.gpg',
                'source-0'
            );
        });

        it('uses apt-add-repository for sources without paired keys', async () => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: '0.99.0',
                stderr: ''
            });

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            expect(mockAddAptSource).not.toHaveBeenCalled();
            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                ['-y', '-n', '-P', 'ppa:test/ppa'],
                expect.anything()
            );
        });
    });

    describe('apt-get sources', () => {
        beforeEach(() => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: '0.99.0',
                stderr: ''
            });
        });

        it('warns if software-properties-common is not installed for unpaired sources', async () => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 1,
                stdout: '',
                stderr: 'error'
            });
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa']
            });

            await aptGetMain(inputs);
            expect(mockWarning).toHaveBeenCalledWith(
                expect.stringContaining('software-properties-common is not installed')
            );
        });

        it('adds ppa source with -P flag for new software-properties-common', async () => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: '0.99.0',
                stderr: ''
            });
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            // Version 0.99.0 >= 0.98.10, so -P flag should be used
            // Version 0.99.0 >= 0.96.24.20, so -n flag should be used
            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                ['-y', '-n', '-P', 'ppa:test/ppa'],
                expect.anything()
            );
        });

        it('adds deb source with -S flag', async () => {
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['deb http://example.com/repo stable main'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                ['-y', '-n', '-S', 'deb http://example.com/repo stable main'],
                expect.anything()
            );
        });

        it('adds URI source with -U flag', async () => {
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['https://example.com/repo'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                ['-y', '-n', '-U', 'https://example.com/repo'],
                expect.anything()
            );
        });

        it('omits -n and source flags for old software-properties-common', async () => {
            mockGetExecOutput.mockResolvedValue({
                exitCode: 0,
                stdout: '0.92.0',
                stderr: ''
            });
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            // Version 0.92.0 < 0.96.24.20 — no -n flag
            // Version 0.92.0 < 0.98.10 — no -P/-S/-U flags
            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                ['-y', 'ppa:test/ppa'],
                expect.anything()
            );
        });

        it('omits -E flag when running as root (no sudo)', async () => {
            const setup_program = require('./apt-utils');
            setup_program.isSudoRequired.mockReturnValueOnce(false);
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            // When not using sudo, tool should be apt-add-repository directly
            expect(mockExec).toHaveBeenCalledWith(
                'apt-add-repository',
                expect.arrayContaining(['-y', '-n', '-P', 'ppa:test/ppa']),
                expect.anything()
            );
            // Should NOT have been called via sudo
            const sudoAddRepoCalls = mockExec.mock.calls.filter(
                c => c[0] === 'sudo' && Array.isArray(c[1]) && c[1].includes('apt-add-repository')
            );
            expect(sudoAddRepoCalls.length).toBe(0);
        });

        it('includes sudo -E prefix when sudo is required', async () => {
            const setup_program = require('./apt-utils');
            setup_program.isSudoRequired.mockReturnValueOnce(true);
            mockExec.mockResolvedValue(0);

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 1
            });
            await aptGetMain(inputs);

            // When sudo is required, tool should be 'sudo' with -n -E and apt-add-repository in args
            expect(mockExec).toHaveBeenCalledWith(
                'sudo',
                ['-n', '-E', 'apt-add-repository', '-y', '-n', '-P', 'ppa:test/ppa'],
                expect.anything()
            );
        });

        it('retries source add on non-zero exit code', async () => {
            mockExec
                .mockResolvedValueOnce(1) // source add fail
                .mockResolvedValue(0);    // source add success, then update

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 2
            });
            const promise = aptGetMain(inputs);
            await jest.advanceTimersByTimeAsync(10000);
            await promise;

            // apt-add-repository called twice (tool is 'apt-add-repository' without sudo)
            const addRepoCalls = mockExec.mock.calls.filter(
                c => c[0] === 'apt-add-repository'
            );
            expect(addRepoCalls.length).toBe(2);
        });

        it('retries source add on exception', async () => {
            // First exec call for apt-add-repository throws, second succeeds
            let callCount = 0;
            mockExec.mockImplementation(async (cmd) => {
                if (cmd === 'apt-add-repository') {
                    callCount++;
                    if (callCount === 1) {
                        throw new Error('network error');
                    }
                }
                return 0;
            });

            const inputs = makeInputs({
                aptGetSources: ['ppa:test/ppa'],
                aptGetRetries: 2
            });
            const promise = aptGetMain(inputs);
            await jest.advanceTimersByTimeAsync(10000);
            await promise;

            expect(callCount).toBe(2);
        });
    });

    describe('architectures', () => {
        it('adds architectures with dpkg', async () => {
            const inputs = makeInputs({
                aptGetAddArchitecture: ['i386', 'arm64']
            });
            await aptGetMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                'dpkg',
                ['--add-architecture', 'i386']
            );
            expect(mockExec).toHaveBeenCalledWith(
                'dpkg',
                ['--add-architecture', 'arm64']
            );
        });
    });

    describe('package installation', () => {
        it('installs packages individually when aptGetBulkInstall is false', async () => {
            const inputs = makeInputs({
                apt_get: ['pkg1', 'pkg2'],
                aptGetBulkInstall: false
            });
            await aptGetMain(inputs);

            // Each package installed separately
            const installCalls = mockExec.mock.calls.filter(
                c => c[0] === 'apt-get' && Array.isArray(c[1]) && c[1].includes('install')
            );
            expect(installCalls.length).toBe(2);
        });

        it('installs packages in bulk when aptGetBulkInstall is true and ignoreMissing is false', async () => {
            const inputs = makeInputs({
                apt_get: ['pkg1', 'pkg2'],
                aptGetBulkInstall: true,
                aptGetIgnoreMissing: false
            });
            await aptGetMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                'apt-get',
                ['-o', 'Acquire::Retries=3', 'install', '-y', 'pkg1', 'pkg2'],
                expect.anything()
            );
        });

        it('uses --ignore-missing when aptGetIgnoreMissing is true', async () => {
            const inputs = makeInputs({
                apt_get: ['pkg1'],
                aptGetIgnoreMissing: true
            });
            await aptGetMain(inputs);

            expect(mockExec).toHaveBeenCalledWith(
                'apt-get',
                ['-o', 'Acquire::Retries=3', '--ignore-missing', 'install', '-y', 'pkg1'],
                expect.anything()
            );
        });

        it('throws on failed install when ignoreMissing is false', async () => {
            mockExec.mockImplementation(async (_cmd, args) => {
                if (Array.isArray(args) && args.includes('install')) {
                    return 1;
                }
                return 0;
            });

            const inputs = makeInputs({
                apt_get: ['bad-pkg'],
                aptGetIgnoreMissing: false,
                aptGetBulkInstall: false,
                aptGetRetries: 1
            });

            await expect(aptGetMain(inputs)).rejects.toThrow(
                'Failed to install package bad-pkg'
            );
        });

        it('does not throw on failed install when ignoreMissing is true', async () => {
            mockExec.mockImplementation(async (_cmd, args) => {
                if (Array.isArray(args) && args.includes('install')) {
                    return 1;
                }
                return 0;
            });

            const inputs = makeInputs({
                apt_get: ['bad-pkg'],
                aptGetIgnoreMissing: true,
                aptGetRetries: 1
            });

            // Should not throw
            await aptGetMain(inputs);
        });

        it('installs individually when ignoreMissing is true even with bulk flag', async () => {
            const inputs = makeInputs({
                apt_get: ['pkg1', 'pkg2'],
                aptGetIgnoreMissing: true,
                aptGetBulkInstall: true
            });
            await aptGetMain(inputs);

            // ignoreMissing takes precedence: installs individually
            const installCalls = mockExec.mock.calls.filter(
                c => c[0] === 'apt-get' && Array.isArray(c[1]) && c[1].includes('install')
            );
            expect(installCalls.length).toBe(2);
        });

        it('sets DEBIAN_FRONTEND=noninteractive for individual installs', async () => {
            const inputs = makeInputs({
                apt_get: ['pkg1']
            });
            await aptGetMain(inputs);

            const installCall = mockExec.mock.calls.find(
                c => c[0] === 'apt-get' && Array.isArray(c[1]) && c[1].includes('install')
            );
            expect(installCall).toBeDefined();
            expect(installCall![2]).toEqual(expect.objectContaining({
                env: expect.objectContaining({
                    DEBIAN_FRONTEND: 'noninteractive'
                })
            }));
        });
    });
});
