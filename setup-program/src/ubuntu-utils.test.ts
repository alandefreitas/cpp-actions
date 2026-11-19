jest.mock('@actions/core', () => ({
    debug: jest.fn()
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn())
}));

import * as fs from 'fs';
import * as core from '@actions/core';
import * as traceCommands from 'trace-commands';

import { getCurrentUbuntuVersion, getCurrentUbuntuName } from './ubuntu-utils';

const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>;
const mockLog = traceCommands.log as jest.MockedFunction<typeof traceCommands.log>;

describe('ubuntu-utils', () => {
    const readSpy = fs.readFileSync as jest.Mock;

    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('getCurrentUbuntuVersion', () => {
        it('reads VERSION_ID from /etc/os-release and strips quotes', () => {
            readSpy.mockReturnValue('NAME="Ubuntu"\nVERSION_ID="22.04"\nVERSION_CODENAME=jammy\n');
            expect(getCurrentUbuntuVersion()).toBe('22.04');
            expect(readSpy).toHaveBeenCalledWith('/etc/os-release', 'utf8');
        });

        it('returns null when VERSION_ID is missing', () => {
            readSpy.mockReturnValue('NAME="Ubuntu"\n');
            expect(getCurrentUbuntuVersion()).toBeNull();
            expect(mockDebug).toHaveBeenCalledWith('Ubuntu version not found');
        });

        it('returns null when /etc/os-release cannot be read', () => {
            readSpy.mockImplementation(() => {
                throw new Error('ENOENT');
            });
            expect(getCurrentUbuntuVersion()).toBeNull();
            expect(mockDebug).toHaveBeenCalledWith('Error reading /etc/os-release');
        });
    });

    describe('getCurrentUbuntuName', () => {
        it('maps a known version to its codename', () => {
            readSpy.mockReturnValue('VERSION_ID="22.04.5"\n');
            expect(getCurrentUbuntuName()).toBe('jammy');
        });

        it('maps a version that is a prefix of a known key to its codename', () => {
            readSpy.mockReturnValue('VERSION_ID="24.04"\n');
            expect(getCurrentUbuntuName()).toBe('noble');
        });

        it('maps a version that extends a known key to its codename', () => {
            readSpy.mockReturnValue('VERSION_ID="6.06.2"\n');
            expect(getCurrentUbuntuName()).toBe('dapper');
        });

        it('returns null for an unknown version', () => {
            readSpy.mockReturnValue('VERSION_ID="1.01"\n');
            expect(getCurrentUbuntuName()).toBeNull();
            expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Ubuntu name for version 1.01 not supported'));
        });

        it('returns null when the version cannot be determined', () => {
            readSpy.mockReturnValue('');
            expect(getCurrentUbuntuName()).toBeNull();
        });
    });
});
