import * as ghInputs from './index';

// Mock @actions/core
jest.mock('@actions/core', () => ({
    getInput: jest.fn(),
    getMultilineInput: jest.fn(),
    info: jest.fn(),
    setOutput: jest.fn()
}));

import * as core from '@actions/core';

const mockedCore = core as jest.Mocked<typeof core>;

describe('gh-inputs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear environment variables
        delete process.env.TEST_VAR;
        delete process.env.FALLBACK_VAR;
    });

    describe('getInput', () => {
        it('should return input from core.getInput', () => {
            mockedCore.getInput.mockReturnValue('test-value');

            const result = ghInputs.getInput('test-name');

            expect(result).toBe('test-value');
            expect(mockedCore.getInput).toHaveBeenCalledWith('test-name', expect.any(Object));
        });

        it('should fallback to environment variable', () => {
            mockedCore.getInput.mockReturnValue('');
            process.env.FALLBACK_VAR = 'env-value';

            const result = ghInputs.getInput('test-name', { fallbackEnv: 'FALLBACK_VAR' });

            expect(result).toBe('env-value');
        });

        it('should return default value when input not found', () => {
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getInput('test-name', { defaultValue: 'default' });

            expect(result).toBe('default');
        });

        it('should throw when required input is missing', () => {
            mockedCore.getInput.mockReturnValue('');

            expect(() => ghInputs.getInput('test-name', { required: true }))
                .toThrow('Input required and not supplied: test-name');
        });

        it('should accept array of names', () => {
            mockedCore.getInput
                .mockReturnValueOnce('')
                .mockReturnValueOnce('second-value');

            const result = ghInputs.getInput(['first', 'second']);

            expect(result).toBe('second-value');
        });
    });

    describe('getTribool', () => {
        it('should return true for truthy strings', () => {
            for (const value of ['true', '1', 'on', 'yes', 'y', 'TRUE', 'Yes']) {
                mockedCore.getInput.mockReturnValue(value);
                expect(ghInputs.getTribool('test')).toBe(true);
            }
        });

        it('should return false for falsy strings', () => {
            for (const value of ['false', '0', 'off', 'no', 'n', 'FALSE', 'No']) {
                mockedCore.getInput.mockReturnValue(value);
                expect(ghInputs.getTribool('test')).toBe(false);
            }
        });

        it('should return undefined for non-boolean strings', () => {
            mockedCore.getInput.mockReturnValue('maybe');
            expect(ghInputs.getTribool('test')).toBeUndefined();
        });
    });

    describe('getBoolean', () => {
        it('should return boolean value', () => {
            mockedCore.getInput.mockReturnValue('true');
            expect(ghInputs.getBoolean('test')).toBe(true);

            mockedCore.getInput.mockReturnValue('false');
            expect(ghInputs.getBoolean('test')).toBe(false);
        });

        it('should return default value for non-boolean', () => {
            mockedCore.getInput.mockReturnValue('');
            expect(ghInputs.getBoolean('test', { defaultValue: true })).toBe(true);
        });
    });

    describe('getMultilineInput', () => {
        it('should return array from core.getMultilineInput', () => {
            mockedCore.getMultilineInput.mockReturnValue(['line1', 'line2']);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual(['line1', 'line2']);
        });

        it('should return empty array when input not found and no default', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual([]);
        });

        it('should return empty array when default is empty string', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            const result = ghInputs.getMultilineInput('test', { defaultValue: '' });

            expect(result).toEqual([]);
        });

        it('should return array default value', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            const result = ghInputs.getMultilineInput('test', { defaultValue: ['default'] });

            expect(result).toEqual(['default']);
        });

        it('should filter comment lines by default', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                'value1',
                '# this is a comment',
                'value2',
                '  # indented comment',
                'value3'
            ]);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual(['value1', 'value2', 'value3']);
        });

        it('should filter blank lines by default', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                'value1',
                '',
                'value2',
                '   ',
                'value3'
            ]);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual(['value1', 'value2', 'value3']);
        });

        it('should filter both comments and blank lines', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                '# Header comment',
                '',
                'key1:value1',
                '  ',
                '# Section divider',
                'key2:value2',
                '# Trailing comment'
            ]);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual(['key1:value1', 'key2:value2']);
        });

        it('should preserve comments when filterComments is false', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                'value1',
                '# comment',
                'value2'
            ]);

            const result = ghInputs.getMultilineInput('test', { filterComments: false });

            expect(result).toEqual(['value1', '# comment', 'value2']);
        });

        it('should preserve blank lines when filterBlankLines is false', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                'value1',
                '',
                'value2'
            ]);

            const result = ghInputs.getMultilineInput('test', { filterBlankLines: false });

            expect(result).toEqual(['value1', '', 'value2']);
        });

        it('should use custom comment prefix', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                'value1',
                '// js comment',
                '# not a comment',
                'value2'
            ]);

            const result = ghInputs.getMultilineInput('test', { commentPrefix: '//' });

            expect(result).toEqual(['value1', '# not a comment', 'value2']);
        });

        it('should return empty array when all lines are comments or blank', () => {
            mockedCore.getMultilineInput.mockReturnValue([
                '# comment only',
                '',
                '  # another comment',
                '   '
            ]);

            const result = ghInputs.getMultilineInput('test');

            expect(result).toEqual([]);
        });
    });

    describe('getArray', () => {
        it('should split input by default regex', () => {
            mockedCore.getInput.mockReturnValue('a,b;c d');

            const result = ghInputs.getArray('test');

            expect(result).toEqual(['a', 'b', 'c', 'd']);
        });

        it('should filter empty strings by default', () => {
            mockedCore.getInput.mockReturnValue('a,,b');

            const result = ghInputs.getArray('test');

            expect(result).toEqual(['a', 'b']);
        });

        it('should use custom splitter', () => {
            mockedCore.getInput.mockReturnValue('a|b|c');

            const result = ghInputs.getArray('test', /\|/);

            expect(result).toEqual(['a', 'b', 'c']);
        });
    });

    describe('getSet', () => {
        it('should return a Set of values', () => {
            mockedCore.getInput.mockReturnValue('a,b,a,c');

            const result = ghInputs.getSet('test');

            expect(result).toBeInstanceOf(Set);
            expect(Array.from(result)).toEqual(['a', 'b', 'c']);
        });
    });

    describe('getInt', () => {
        it('should parse integer from input', () => {
            mockedCore.getInput.mockReturnValue('42');
            expect(ghInputs.getInt('test')).toBe(42);
        });

        it('should return undefined for non-integer', () => {
            mockedCore.getInput.mockReturnValue('not-a-number');
            expect(ghInputs.getInt('test')).toBeUndefined();
        });
    });

    describe('parseBashArguments', () => {
        it('should parse simple arguments', () => {
            const result = ghInputs.parseBashArguments('arg1 arg2 arg3');
            expect(result).toEqual(['arg1', 'arg2', 'arg3']);
        });

        it('should handle quoted arguments', () => {
            const result = ghInputs.parseBashArguments('"arg with spaces" arg2');
            expect(result).toEqual(['arg with spaces', 'arg2']);
        });

        it('should handle single quotes', () => {
            const result = ghInputs.parseBashArguments("'single quoted' arg2");
            expect(result).toEqual(['single quoted', 'arg2']);
        });

        it('should handle array input', () => {
            const result = ghInputs.parseBashArguments(['arg1', 'arg2']);
            expect(result).toEqual(['arg1', 'arg2']);
        });
    });

    describe('parseKeyValues', () => {
        it('should parse key:value pairs', () => {
            const result = ghInputs.parseKeyValues(['key1:value1', 'key2:value2']);
            expect(result).toEqual([
                { key: 'key1', value: 'value1' },
                { key: 'key2', value: 'value2' }
            ]);
        });

        it('should handle custom delimiter', () => {
            const result = ghInputs.parseKeyValues(['key1=value1'], '=');
            expect(result).toEqual([{ key: 'key1', value: 'value1' }]);
        });
    });

    describe('parseMap', () => {
        it('should return object from key:value pairs', () => {
            const result = ghInputs.parseMap(['key1:value1', 'key2:value2']);
            expect(result).toEqual({ key1: 'value1', key2: 'value2' });
        });
    });

    describe('makeValueString', () => {
        it('should format Set as object-like string', () => {
            const result = ghInputs.makeValueString(new Set(['a', 'b']));
            expect(result).toBe('{"a","b"}');
        });

        it('should format Map as JSON', () => {
            const map = new Map([['key', 'value']]);
            const result = ghInputs.makeValueString(map);
            expect(result).toBe('{"key":"value"}');
        });

        it('should format boolean', () => {
            expect(ghInputs.makeValueString(true)).toBe('true');
            expect(ghInputs.makeValueString(false)).toBe('false');
        });

        it('should format empty as <empty>', () => {
            expect(ghInputs.makeValueString('')).toBe('<empty>');
            expect(ghInputs.makeValueString(null)).toBe('<empty>');
            expect(ghInputs.makeValueString(undefined)).toBe('<empty>');
        });
    });

    describe('makeKebabName', () => {
        it('should convert underscores to hyphens', () => {
            expect(ghInputs.makeKebabName('some_name_here')).toBe('some-name-here');
        });
    });

    describe('printInputObject', () => {
        it('should log each key-value pair', () => {
            ghInputs.printInputObject({ test_key: 'test_value' });

            expect(mockedCore.info).toHaveBeenCalledWith('🧩 test-key: "test_value"');
        });
    });

    describe('setOutputObject', () => {
        it('should log and set output for each key-value pair', () => {
            ghInputs.setOutputObject({ test_key: 'test_value' });

            expect(mockedCore.info).toHaveBeenCalledWith('🧩 test-key: "test_value"');
            expect(mockedCore.setOutput).toHaveBeenCalledWith('test-key', 'test_value');
        });
    });
});
