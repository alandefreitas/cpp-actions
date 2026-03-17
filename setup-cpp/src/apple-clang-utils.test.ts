jest.mock('@actions/core', () => ({
    info: jest.fn(),
    warning: jest.fn()
}));

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}));

jest.mock('fs', () => ({
    readdirSync: jest.fn()
}));

import * as fs from 'fs';
import * as exec from '@actions/exec';
import * as core from '@actions/core';
import { scanInstalledXcodes } from './apple-clang-utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReaddirSync = fs.readdirSync as jest.MockedFunction<any>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;

beforeEach(() => {
    jest.clearAllMocks();
});

describe('scanInstalledXcodes', () => {
    it('scans multiple Xcode installations and returns sorted results', async () => {
        mockReaddirSync.mockReturnValue(['Xcode_15.4.app', 'Xcode_16.0.app', 'Xcode.app', 'Safari.app']);

        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Apple clang version 15.0.0 (clang-1500.3.9.4)\nTarget: arm64-apple-darwin23.5.0\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Apple clang version 16.0.0 (clang-1600.0.26.3)\nTarget: arm64-apple-darwin24.0.0\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Apple clang version 17.0.0 (clang-1700.0.13.3)\nTarget: arm64-apple-darwin24.0.0\n',
                stderr: ''
            });

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(3);
        // Sorted by Apple Clang version descending
        expect(results[0].appleClangVersion).toBe('17.0.0');
        expect(results[0].xcodePath).toBe('/Applications/Xcode.app');
        expect(results[0].xcodeVersion).toBe('default');

        expect(results[1].appleClangVersion).toBe('16.0.0');
        expect(results[1].xcodePath).toBe('/Applications/Xcode_16.0.app');
        expect(results[1].xcodeVersion).toBe('16.0');

        expect(results[2].appleClangVersion).toBe('15.0.0');
        expect(results[2].xcodePath).toBe('/Applications/Xcode_15.4.app');
        expect(results[2].xcodeVersion).toBe('15.4');

        // Verify DEVELOPER_DIR was set correctly for each call
        expect(mockGetExecOutput).toHaveBeenCalledWith(
            'xcrun',
            ['clang', '--version'],
            expect.objectContaining({
                env: expect.objectContaining({
                    DEVELOPER_DIR: '/Applications/Xcode_15.4.app/Contents/Developer'
                })
            })
        );
    });

    it('skips broken Xcode installations with a warning', async () => {
        mockReaddirSync.mockReturnValue(['Xcode_15.4.app', 'Xcode_16.0.app']);

        mockGetExecOutput
            .mockResolvedValueOnce({
                exitCode: 0,
                stdout: 'Apple clang version 15.0.0 (clang-1500.3.9.4)\n',
                stderr: ''
            })
            .mockResolvedValueOnce({
                exitCode: 1,
                stdout: '',
                stderr: 'error: invalid developer directory'
            });

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(1);
        expect(results[0].appleClangVersion).toBe('15.0.0');
        expect(mockWarning).toHaveBeenCalledWith(
            expect.stringContaining('Xcode_16.0.app')
        );
    });

    it('skips Xcode when xcrun throws an error', async () => {
        mockReaddirSync.mockReturnValue(['Xcode_15.4.app']);

        mockGetExecOutput.mockRejectedValueOnce(new Error('spawn xcrun ENOENT'));

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(0);
        expect(mockWarning).toHaveBeenCalledWith(
            expect.stringContaining('spawn xcrun ENOENT')
        );
    });

    it('skips Xcode when clang version cannot be parsed', async () => {
        mockReaddirSync.mockReturnValue(['Xcode_15.4.app']);

        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'some unexpected output\n',
            stderr: ''
        });

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(0);
        expect(mockWarning).toHaveBeenCalledWith(
            expect.stringContaining('Could not parse Apple Clang version')
        );
    });

    it('returns empty array when /Applications cannot be read', async () => {
        mockReaddirSync.mockImplementation(() => {
            throw new Error('ENOENT');
        });

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(0);
        expect(mockWarning).toHaveBeenCalledWith(
            expect.stringContaining('Cannot read /Applications')
        );
    });

    it('returns empty array when no Xcode apps found', async () => {
        mockReaddirSync.mockReturnValue(['Safari.app', 'TextEdit.app']);

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(0);
        expect(mockGetExecOutput).not.toHaveBeenCalled();
    });

    it('parses Xcode version from hyphenated directory name', async () => {
        mockReaddirSync.mockReturnValue(['Xcode-16.1.app']);

        mockGetExecOutput.mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'Apple clang version 16.0.0 (clang-1600.0.26.3)\n',
            stderr: ''
        });

        const results = await scanInstalledXcodes();

        expect(results).toHaveLength(1);
        expect(results[0].xcodeVersion).toBe('16.1');
    });
});
