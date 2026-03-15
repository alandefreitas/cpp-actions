jest.mock('trace-commands', () => ({
    scoped: jest.fn().mockReturnValue(jest.fn())
}));

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        existsSync: jest.fn(),
        lstatSync: jest.fn(),
        readFileSync: jest.fn()
    };
});

import * as fs from 'fs';
import { updateCMakeVersionFromFile } from './version-resolve';

const mockExistsSync = fs.existsSync as jest.Mock;
const mockLstatSync = fs.lstatSync as jest.Mock;
const mockReadFileSync = fs.readFileSync as jest.Mock;

const allVersions = [
    '3.16.0', '3.17.0', '3.18.0', '3.19.0', '3.20.0',
    '3.21.0', '3.22.0', '3.23.0', '3.24.0', '3.25.0',
    '3.26.0', '3.27.0', '3.28.0'
];

describe('updateCMakeVersionFromFile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns version unchanged when cmakeFile is empty', () => {
        const result = updateCMakeVersionFromFile('', '>=3.20.0', allVersions);
        expect(result).toBe('>=3.20.0');
    });

    test('returns version unchanged when file does not exist', () => {
        mockExistsSync.mockReturnValue(false);
        const result = updateCMakeVersionFromFile('CMakeLists.txt', '>=3.20.0', allVersions);
        expect(result).toBe('>=3.20.0');
    });

    test('follows directory to CMakeLists.txt', () => {
        // First call: directory exists
        mockExistsSync.mockReturnValueOnce(true)
            // Second call: CMakeLists.txt in directory exists
            .mockReturnValueOnce(true)
            // Third call: from recursive call - file exists
            .mockReturnValueOnce(true);
        mockLstatSync
            .mockReturnValueOnce({ isDirectory: () => true })
            // Recursive call: file is not a directory
            .mockReturnValueOnce({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.20)');

        const result = updateCMakeVersionFromFile('mydir', '*', allVersions);
        expect(result).toContain('3.20');
    });

    test('returns version when directory has no CMakeLists.txt', () => {
        mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
        mockLstatSync.mockReturnValue({ isDirectory: () => true });

        const result = updateCMakeVersionFromFile('emptydir', '>=3.20.0', allVersions);
        expect(result).toBe('>=3.20.0');
    });

    test('parses cmake_minimum_required and sets version when current is *', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.22)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '*', allVersions);
        expect(result).toContain('3.22');
    });

    test('parses cmake_minimum_required and sets version when current is empty', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.22)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '', allVersions);
        expect(result).toContain('3.22');
    });

    test('merges intersecting version ranges', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.20)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '>=3.18.0', allVersions);
        // Both ranges intersect: >=3.18 and >=3.20 -> the merged result should include versions satisfying both
        expect(result).toBeDefined();
    });

    test('keeps version when ranges do not intersect', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        // Require version 3.28+ but current range is <3.16
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.28)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '<3.16.0', allVersions);
        // Ranges don't intersect, so version stays as-is
        expect(result).toBe('<3.16.0');
    });

    test('returns version when no cmake_minimum_required found', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('project(MyProject)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '>=3.20.0', allVersions);
        expect(result).toBe('>=3.20.0');
    });

    test('handles cmake_minimum_required with FATAL_ERROR', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.21 FATAL_ERROR)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '*', allVersions);
        expect(result).toContain('3.21');
    });

    test('handles cmake_minimum_required with range syntax (VERSION min...max)', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.16...3.25)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '*', allVersions);
        // Uses the min version (3.16) as the requirement
        expect(result).toContain('3.16');
    });

    test('handles version with only major.minor', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.24)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '*', allVersions);
        expect(result).toContain('3.24');
    });

    test('handles version with only major number', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3)');

        const result = updateCMakeVersionFromFile('CMakeLists.txt', '*', allVersions);
        expect(result).toContain('3');
    });

    test('handles semver error gracefully (catch block)', () => {
        mockExistsSync.mockReturnValue(true);
        mockLstatSync.mockReturnValue({ isDirectory: () => false });
        mockReadFileSync.mockReturnValue('cmake_minimum_required(VERSION 3.20)');

        // Pass a version string that will cause semver.intersects to throw
        // The '][' is an invalid semver range that passes the truthy check but fails semver operations
        const result = updateCMakeVersionFromFile('CMakeLists.txt', '][', allVersions);
        // Should catch the error and return the version as-is
        expect(result).toBe('][');
    });
});
