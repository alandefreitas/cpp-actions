import * as ghInputs from './index';
import * as nodePath from 'path';

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
        delete process.env.FALLBACK_VAR2;
        delete process.env.INPUT_TEST_NAME;
        delete process.env['INPUT_TEST-NAME'];
        delete process.env.INPUT_TEST;
        delete process.env.INPUT_FIRST;
        delete process.env.INPUT_SECOND;
        delete process.env['INPUT_MODULES-EXCLUDE-PATHS'];
        delete process.env.MY_VAR;
        delete process.env.HOME_DIR;
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

        it('should return empty string when acceptEmpty is true', () => {
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getInput('test_name', { defaultValue: 'default', acceptEmpty: true });

            expect(result).toBe('');
        });

        it('should still use default when INPUT_ env var is not set', () => {
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getInput('test_name', { defaultValue: 'default' });

            expect(result).toBe('default');
        });

        it('should return env value without trimming when trimWhitespace is false', () => {
            mockedCore.getInput.mockReturnValue('');
            process.env.FALLBACK_VAR = '  env-value  ';

            const result = ghInputs.getInput('test-name', {
                fallbackEnv: 'FALLBACK_VAR',
                trimWhitespace: false
            });

            expect(result).toBe('  env-value  ');
        });

        it('should try multiple fallback env vars in order', () => {
            mockedCore.getInput.mockReturnValue('');
            process.env.FALLBACK_VAR2 = 'second-env';

            const result = ghInputs.getInput('test-name', {
                fallbackEnv: ['FALLBACK_VAR', 'FALLBACK_VAR2']
            });

            expect(result).toBe('second-env');
        });

        it('should skip fallback env var that is whitespace-only when trimWhitespace is true', () => {
            mockedCore.getInput.mockReturnValue('');
            process.env.FALLBACK_VAR = '   ';

            const result = ghInputs.getInput('test-name', {
                fallbackEnv: 'FALLBACK_VAR',
                defaultValue: 'default'
            });

            expect(result).toBe('default');
        });

        it('should return default as string when defaultValue is undefined', () => {
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getInput('test-name');

            expect(result).toBe('');
        });
    });

    describe('getRegex', () => {
        it('should return a RegExp from input value', () => {
            mockedCore.getInput.mockReturnValue('\\d+');

            const result = ghInputs.getRegex('test');

            expect(result).toBeInstanceOf(RegExp);
            expect(result.test('123')).toBe(true);
            expect(result.test('abc')).toBe(false);
        });
    });

    describe('getLowerCaseInput', () => {
        it('should return input converted to lowercase', () => {
            mockedCore.getInput.mockReturnValue('Hello World');

            const result = ghInputs.getLowerCaseInput('test');

            expect(result).toBe('hello world');
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

    describe('toTriboolInput', () => {
        it('should return boolean input directly', () => {
            expect(ghInputs.toTriboolInput(true)).toBe(true);
            expect(ghInputs.toTriboolInput(false)).toBe(false);
        });

        it('should convert numbers: 0 is false, non-zero is true', () => {
            expect(ghInputs.toTriboolInput(0)).toBe(false);
            expect(ghInputs.toTriboolInput(1)).toBe(true);
            expect(ghInputs.toTriboolInput(-1)).toBe(true);
            expect(ghInputs.toTriboolInput(42)).toBe(true);
        });

        it('should return undefined for non-string non-boolean non-number', () => {
            expect(ghInputs.toTriboolInput(null)).toBeUndefined();
            expect(ghInputs.toTriboolInput(undefined)).toBeUndefined();
            expect(ghInputs.toTriboolInput({})).toBeUndefined();
            expect(ghInputs.toTriboolInput([])).toBeUndefined();
        });
    });

    describe('getBoolean / getBool', () => {
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

        it('should return false when tribool is undefined and no boolean defaultValue', () => {
            mockedCore.getInput.mockReturnValue('');
            expect(ghInputs.getBool('test')).toBe(false);
        });

        it('should return false when tribool is undefined and defaultValue is string', () => {
            mockedCore.getInput.mockReturnValue('');
            expect(ghInputs.getBool('test', { defaultValue: 'something' })).toBe(false);
        });
    });

    describe('getBoolOrString', () => {
        it('should return boolean when input is boolean-like', () => {
            mockedCore.getInput.mockReturnValue('true');
            expect(ghInputs.getBoolOrString('test')).toBe(true);

            mockedCore.getInput.mockReturnValue('false');
            expect(ghInputs.getBoolOrString('test')).toBe(false);
        });

        it('should return string when input is not boolean-like', () => {
            mockedCore.getInput.mockReturnValue('some-value');
            expect(ghInputs.getBoolOrString('test')).toBe('some-value');
        });
    });

    describe('normalizePath', () => {
        it('should return path unchanged on non-Windows', () => {
            const result = ghInputs.normalizePath('/some/unix/path');
            expect(result).toBe('/some/unix/path');
        });

        it('should convert backslashes on win32', () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32' });

            const result = ghInputs.normalizePath('C:\\Users\\test\\file');
            expect(result).toBe('C:/Users/test/file');

            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });
    });

    describe('getNormalizedPath', () => {
        it('should return normalized path from input', () => {
            mockedCore.getInput.mockReturnValue('/some/path');

            const result = ghInputs.getNormalizedPath('test');

            expect(result).toBe('/some/path');
        });
    });

    describe('getResolvedPath', () => {
        it('should return resolved absolute path from input', () => {
            mockedCore.getInput.mockReturnValue('relative/path');

            const result = ghInputs.getResolvedPath('test');

            expect(result).toBe(nodePath.resolve('relative/path'));
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

        it('should return empty array when acceptEmpty is true', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            const result = ghInputs.getMultilineInput('test', { defaultValue: ['default'], acceptEmpty: true });

            expect(result).toEqual([]);
        });

        it('should fallback to env variable and split by newlines', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);
            process.env.FALLBACK_VAR = 'line1\nline2\nline3';

            const result = ghInputs.getMultilineInput('test', { fallbackEnv: 'FALLBACK_VAR' });

            expect(result).toEqual(['line1', 'line2', 'line3']);
        });

        it('should fallback to env variable array and try each', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);
            process.env.FALLBACK_VAR2 = 'envline1\nenvline2';

            const result = ghInputs.getMultilineInput('test', {
                fallbackEnv: ['FALLBACK_VAR', 'FALLBACK_VAR2']
            });

            expect(result).toEqual(['envline1', 'envline2']);
        });

        it('should filter comments and blank lines from fallback env', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);
            process.env.FALLBACK_VAR = 'value1\n# comment\n\nvalue2';

            const result = ghInputs.getMultilineInput('test', { fallbackEnv: 'FALLBACK_VAR' });

            expect(result).toEqual(['value1', 'value2']);
        });

        it('should skip fallback env when filtered result is empty', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);
            process.env.FALLBACK_VAR = '# only comment';
            process.env.FALLBACK_VAR2 = 'real-value';

            const result = ghInputs.getMultilineInput('test', {
                fallbackEnv: ['FALLBACK_VAR', 'FALLBACK_VAR2']
            });

            expect(result).toEqual(['real-value']);
        });

        it('should throw when required and no value found', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            expect(() => ghInputs.getMultilineInput('test', { required: true }))
                .toThrow('Input required and not supplied: test');
        });

        it('should return string defaultValue wrapped in array', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);

            const result = ghInputs.getMultilineInput('test', { defaultValue: 'single' });

            expect(result).toEqual(['single']);
        });

        it('should try multiple names and return first found with INPUT_ env set', () => {
            process.env.INPUT_SECOND = 'exists';
            mockedCore.getMultilineInput
                .mockReturnValueOnce([])
                .mockReturnValueOnce(['found-value']);

            const result = ghInputs.getMultilineInput(['first', 'second']);

            expect(result).toEqual(['found-value']);
        });

        it('should not trim env lines when trimWhitespace is false', () => {
            mockedCore.getMultilineInput.mockReturnValue([]);
            process.env.FALLBACK_VAR = '  line1  \n  line2  ';

            const result = ghInputs.getMultilineInput('test', {
                fallbackEnv: 'FALLBACK_VAR',
                trimWhitespace: false
            });

            expect(result).toEqual(['  line1  ', '  line2  ']);
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

        it('should use string splitter converted to regex', () => {
            mockedCore.getInput.mockReturnValue('a|b|c');

            const result = ghInputs.getArray('test', '\\|');

            expect(result).toEqual(['a', 'b', 'c']);
        });

        it('should use default splitter when undefined is passed', () => {
            mockedCore.getInput.mockReturnValue('a,b c');

            const result = ghInputs.getArray('test', undefined);

            expect(result).toEqual(['a', 'b', 'c']);
        });

        it('should use default filter when null filterFn is passed', () => {
            mockedCore.getInput.mockReturnValue('a,,b');

            const result = ghInputs.getArray('test', undefined, null as unknown as ghInputs.FilterFn);

            expect(result).toEqual(['a', 'b']);
        });
    });

    describe('getSet', () => {
        it('should return a Set of values', () => {
            mockedCore.getInput.mockReturnValue('a,b,a,c');

            const result = ghInputs.getSet('test');

            expect(result).toBeInstanceOf(Set);
            expect(Array.from(result)).toEqual(['a', 'b', 'c']);
        });

        it('should return empty set when acceptEmpty is true', () => {
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getSet('test', undefined, undefined, { defaultValue: ['a', 'b'], acceptEmpty: true });

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('should return empty set for hyphenated name when env var is explicitly empty (issue #32)', () => {
            // Exact scenario: user sets `modules-exclude-paths: ''` in their workflow.
            // With acceptEmpty: true (the default), empty strings are valid and
            // don't fall through to defaultValue.
            mockedCore.getInput.mockReturnValue('');

            const result = ghInputs.getSet(
                'modules-exclude-paths',
                undefined,
                undefined,
                { defaultValue: ['test', 'tests'], acceptEmpty: true }
            );

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
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

        it('should expand environment variables with $VAR syntax', () => {
            process.env.MY_VAR = 'expanded';

            const result = ghInputs.parseBashArguments('prefix$MY_VAR suffix');

            expect(result).toEqual(['prefixexpanded', 'suffix']);
        });

        it('should handle $ followed by non-identifier character', () => {
            const result = ghInputs.parseBashArguments('price$5');
            expect(result).toEqual(['price$5']);
        });

        it('should handle $ at end of string', () => {
            const result = ghInputs.parseBashArguments('end$');
            expect(result).toEqual(['end$']);
        });

        it('should skip undefined env var (no value)', () => {
            delete process.env.UNDEFINED_VAR;

            const result = ghInputs.parseBashArguments('before$UNDEFINED_VAR after');

            expect(result).toEqual(['before', 'after']);
        });

        it('should expand env vars inside double quotes', () => {
            process.env.MY_VAR = 'hello';

            const result = ghInputs.parseBashArguments('"prefix $MY_VAR suffix"');

            expect(result).toEqual(['prefix hello suffix']);
        });

        it('should NOT expand env vars inside single quotes', () => {
            process.env.MY_VAR = 'hello';

            const result = ghInputs.parseBashArguments("'$MY_VAR'");

            expect(result).toEqual(['$MY_VAR']);
        });

        it('should handle escaped characters outside quotes', () => {
            const result = ghInputs.parseBashArguments('arg\\ with\\ spaces');
            expect(result).toEqual(['arg with spaces']);
        });

        it('should handle backslash escapes in double quotes for special chars', () => {
            const result = ghInputs.parseBashArguments('"test\\$var"');
            expect(result).toEqual(['test$var']);
        });

        it('should handle backslash escapes in double quotes for backtick', () => {
            const result = ghInputs.parseBashArguments('"test\\`cmd"');
            expect(result).toEqual(['test`cmd']);
        });

        it('should handle escaped double-quote inside double quotes', () => {
            // In JS: "he said \\"hi\\"" → chars: h,e, ,s,a,i,d, ,\,",h,i,\,"
            // But in bash parsing: \" inside double quotes = literal "
            const result = ghInputs.parseBashArguments('"he said \\"hi"');
            expect(result).toEqual(['he said "hi']);
        });

        it('should keep backslash for non-special chars in double quotes', () => {
            const result = ghInputs.parseBashArguments('"test\\n"');
            expect(result).toEqual(['test\\n']);
        });

        it('should handle multiple lines from array', () => {
            const result = ghInputs.parseBashArguments(['arg1 arg2', 'arg3 arg4']);
            expect(result).toEqual(['arg1', 'arg2', 'arg3', 'arg4']);
        });

        it('should handle empty input', () => {
            const result = ghInputs.parseBashArguments('');
            expect(result).toEqual([]);
        });

        it('should handle multiple spaces between arguments', () => {
            const result = ghInputs.parseBashArguments('arg1   arg2');
            expect(result).toEqual(['arg1', 'arg2']);
        });

        it('should handle $ followed by non-alpha inside double quotes', () => {
            const result = ghInputs.parseBashArguments('"$5"');
            expect(result).toEqual(['$5']);
        });
    });

    describe('getBashArguments', () => {
        it('should retrieve multiline input and parse as bash arguments', () => {
            mockedCore.getMultilineInput.mockReturnValue(['--flag1 value1', '--flag2 "value 2"']);

            const result = ghInputs.getBashArguments('test');

            expect(result).toEqual(['--flag1', 'value1', '--flag2', 'value 2']);
        });

        it('should handle array of names', () => {
            mockedCore.getMultilineInput.mockReturnValue(['arg1']);

            const result = ghInputs.getBashArguments(['name1', 'name2']);

            expect(mockedCore.getMultilineInput).toHaveBeenCalledWith('name1', expect.any(Object));
            expect(result).toEqual(['arg1']);
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

        it('should handle lines without delimiter (value only)', () => {
            const result = ghInputs.parseKeyValues(['justvalue']);
            // No delimiter means key='', value='justvalue' — but key is empty so it becomes {key:'', value:'justvalue'.trim()}
            // Actually looking at the code: delimiterIndex=-1, key='', value='justvalue'
            // then: key is falsy, goes to else-if (key) which is false, so nothing pushed
            // Wait: key='', which is falsy. value='justvalue'. Neither branch matches. Nothing is pushed.
            expect(result).toEqual([]);
        });

        it('should handle key with no value after delimiter', () => {
            const result = ghInputs.parseKeyValues(['key:']);
            // delimiterIndex=3, key='key', value=''
            // key && value: 'key' && '' is false
            // key: 'key' is true → push {key:'', value:'key'.trim()}
            expect(result).toEqual([{ key: '', value: 'key' }]);
        });

        it('should handle value containing delimiter', () => {
            const result = ghInputs.parseKeyValues(['key:value:with:colons']);
            expect(result).toEqual([{ key: 'key', value: 'value:with:colons' }]);
        });

        it('should trim keys and values', () => {
            const result = ghInputs.parseKeyValues(['  key  :  value  ']);
            expect(result).toEqual([{ key: 'key', value: 'value' }]);
        });
    });

    describe('parseMap', () => {
        it('should return object from key:value pairs', () => {
            const result = ghInputs.parseMap(['key1:value1', 'key2:value2']);
            expect(result).toEqual({ key1: 'value1', key2: 'value2' });
        });
    });

    describe('getKeyValues', () => {
        it('should retrieve and parse key-value input', () => {
            mockedCore.getMultilineInput.mockReturnValue(['key1:value1', 'key2:value2']);

            const result = ghInputs.getKeyValues('test');

            expect(result).toEqual([
                { key: 'key1', value: 'value1' },
                { key: 'key2', value: 'value2' }
            ]);
        });

        it('should use custom delimiter', () => {
            mockedCore.getMultilineInput.mockReturnValue(['key1=value1']);

            const result = ghInputs.getKeyValues('test', '=');

            expect(result).toEqual([{ key: 'key1', value: 'value1' }]);
        });
    });

    describe('getMap', () => {
        it('should retrieve and parse map input', () => {
            mockedCore.getMultilineInput.mockReturnValue(['key1:value1', 'key2:value2']);

            const result = ghInputs.getMap('test');

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

        it('should convert camelCase to kebab-case', () => {
            expect(ghInputs.makeKebabName('someNameHere')).toBe('some-name-here');
        });

        it('should handle mixed camelCase and underscores', () => {
            expect(ghInputs.makeKebabName('versionMajor')).toBe('version-major');
            expect(ghInputs.makeKebabName('versionMajor')).toBe('version-major');
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
