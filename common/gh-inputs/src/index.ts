/**
 * Enhanced GitHub Actions input handling utilities.
 *
 * Provides functions for retrieving and parsing GitHub Actions inputs with
 * support for multiple name aliases, environment variable fallbacks, type
 * conversions, and various parsing formats.
 *
 * @module gh-inputs
 */

import * as core from '@actions/core';
import * as nodePath from 'path';
import type { InputOptions, KeyValue, Tribool, FilterFn, SplitterArg, StringRecord } from './types';

export type { InputOptions, KeyValue, Tribool, FilterFn, SplitterArg, StringRecord };

// Re-export utilities from modules
export { parseBashArguments, getBashArguments } from './bash-parser';
export { parseKeyValues, parseMap } from './key-value-parser';
export { makeValueString, makeKebabName, printInputObject, setOutputObject } from './output-utils';

/** Default options for input retrieval. */
const defaultOptions: InputOptions = {
    required: false,
    trimWhitespace: true,
    fallbackEnv: undefined,
    defaultValue: '',
    filterComments: true,
    commentPrefix: '#',
    filterBlankLines: true
};

/** Default regex pattern for splitting array inputs. */
const defaultSplitRegex = /[,; ]/;

/** Filter function that returns true for non-empty strings. */
const isNonEmptyStr: FilterFn = (s: string): boolean => s !== '';

/**
 * Checks whether the GitHub Actions runner set the INPUT_ env var for a given input.
 *
 * When running in GitHub Actions, the runner always sets INPUT_<NAME> for
 * every input defined in action.yml — even if the user didn't provide a
 * value (in which case the action.yml default is used). If the user
 * explicitly provides an empty string, the env var exists but is empty.
 *
 * When running locally or in tests, these env vars typically don't exist,
 * so the function returns false and programmatic defaults apply as before.
 *
 * @param name - The input name as passed to core.getInput (spaces to underscores, uppercased)
 * @returns true if the INPUT_ env var is defined in the process environment
 */
function isInputEnvSet(name: string): boolean {
    const envKey = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
    return envKey in process.env;
}

/**
 * Retrieves a GitHub Actions input value with enhanced features.
 *
 * This function extends @actions/core getInput with support for:
 * - Multiple input name aliases (tries each in order until one returns a value)
 * - Environment variable fallbacks when no input is found
 * - Default values when neither input nor environment variable is set
 * - Automatic whitespace trimming
 *
 * @param name - The input name or array of name aliases to retrieve. If an array,
 *               tries each name in order and returns the first non-empty value.
 * @param options - Configuration options for input retrieval including required flag,
 *                  trimWhitespace setting, fallbackEnv names, and defaultValue
 * @returns The input value, or defaultValue/empty string if not found
 * @throws {Error} When input is marked as required but no value is available
 */
export function getInput(name: string | string[], options: InputOptions = {}): string {
    const opts = { ...defaultOptions, ...options };
    const nameArr = Array.isArray(name) ? name : [name];

    for (const n of nameArr) {
        const coreOptions = { ...opts, required: false };
        const str = core.getInput(n, coreOptions);
        if (str || isInputEnvSet(n)) {
            return str;
        }
    }

    if (opts.fallbackEnv) {
        const envArray = Array.isArray(opts.fallbackEnv) ? opts.fallbackEnv : [opts.fallbackEnv];
        for (const env of envArray) {
            const envVal = process.env[env];
            if (envVal) {
                if (opts.trimWhitespace) {
                    const trimmed = envVal.trim();
                    if (trimmed) {
                        return trimmed;
                    }
                } else {
                    return envVal;
                }
            }
        }
    }

    if (opts.required) {
        throw new Error(`Input required and not supplied: ${name}`);
    }

    return String(opts.defaultValue ?? '');
}

/**
 * Retrieves a GitHub Actions input and converts it to a RegExp pattern.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns A RegExp constructed from the input value
 * @throws {Error} When input is required but not supplied, or if the pattern is invalid
 */
export function getRegex(name: string | string[], options: InputOptions = {}): RegExp {
    return new RegExp(getInput(name, options));
}

/**
 * Filters an array of lines based on comment and blank line options.
 *
 * Only full-line comments are filtered (lines where the first non-whitespace
 * character is the comment prefix). Inline comments are intentionally not
 * supported to avoid the complexity of escape sequences and quoted strings.
 *
 * @param lines - Array of lines to filter
 * @param opts - Options containing filterComments, commentPrefix, and filterBlankLines
 * @returns Filtered array of lines
 */
function filterLines(lines: string[], opts: InputOptions): string[] {
    return lines.filter(line => {
        const trimmed = line.trim();
        if (opts.filterBlankLines && trimmed === '') {
            return false;
        }
        if (opts.filterComments && opts.commentPrefix && trimmed.startsWith(opts.commentPrefix)) {
            return false;
        }
        return true;
    });
}

/**
 * Retrieves a multiline GitHub Actions input as an array of strings.
 *
 * Each line of the input becomes a separate element in the returned array.
 * Supports multiple input name aliases and environment variable fallbacks.
 * By default, filters out comment lines (starting with '#') and blank lines.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options including required flag, trimWhitespace,
 *                  fallbackEnv, defaultValue, filterComments, commentPrefix, and filterBlankLines
 * @returns Array of strings, one per line of input, or defaultValue if not found
 * @throws {Error} When input is marked as required but no value is available
 */
export function getMultilineInput(name: string | string[], options: InputOptions = {}): string[] {
    const opts = { ...defaultOptions, ...options };
    const nameArr = Array.isArray(name) ? name : [name];

    for (const n of nameArr) {
        const coreOptions = { ...opts, required: false };
        const lines = core.getMultilineInput(n, coreOptions);
        if (isInputEnvSet(n)) {
            return filterLines(lines, opts);
        }
        if (lines.length > 0) {
            const filtered = filterLines(lines, opts);
            if (filtered.length > 0) {
                return filtered;
            }
        }
    }

    if (opts.fallbackEnv) {
        const envArray = Array.isArray(opts.fallbackEnv) ? opts.fallbackEnv : [opts.fallbackEnv];
        for (const env of envArray) {
            const envVal = process.env[env];
            if (envVal) {
                const envLines = envVal.split('\n');
                const filtered = filterLines(
                    opts.trimWhitespace ? envLines.map(l => l.trim()) : envLines,
                    opts
                );
                if (filtered.length > 0) {
                    return filtered;
                }
            }
        }
    }

    if (opts.required) {
        throw new Error(`Input required and not supplied: ${name}`);
    }

    if (Array.isArray(opts.defaultValue)) {
        return opts.defaultValue;
    }
    if (opts.defaultValue === undefined || opts.defaultValue === '') {
        return [];
    }
    return [String(opts.defaultValue)];
}

/**
 * Retrieves a GitHub Actions input and converts it to lowercase.
 *
 * Useful for case-insensitive string comparisons of input values.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns The input value converted to lowercase
 * @throws {Error} When input is marked as required but no value is available
 */
export function getLowerCaseInput(name: string | string[], options: InputOptions = {}): string {
    return getInput(name, options).toLowerCase();
}

/**
 * Normalizes a file path for cross-platform compatibility.
 *
 * On Windows, converts backslashes to forward slashes. On other platforms,
 * returns the path unchanged. This ensures consistent path handling across
 * different operating systems.
 *
 * @param inputPath - The file path to normalize
 * @returns The normalized path with forward slashes
 */
export function normalizePath(inputPath: string): string {
    if (process.platform === 'win32') {
        return inputPath.replace(/\\/g, '/');
    }
    return inputPath;
}

/**
 * Retrieves a GitHub Actions input as a normalized file path.
 *
 * Combines input retrieval with path normalization for cross-platform compatibility.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns The normalized path with forward slashes
 * @throws {Error} When input is marked as required but no value is available
 */
export function getNormalizedPath(name: string | string[], options: InputOptions = {}): string {
    return normalizePath(getInput(name, options));
}

/**
 * Retrieves a GitHub Actions input as an absolute resolved file path.
 *
 * Combines input retrieval with path normalization and resolution to an absolute path.
 * Relative paths are resolved against the current working directory.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns The absolute resolved path
 * @throws {Error} When input is marked as required but no value is available
 */
export function getResolvedPath(name: string | string[], options: InputOptions = {}): string {
    return nodePath.resolve(normalizePath(getInput(name, options)));
}

/**
 * Converts an unknown input value to a Tribool (true, false, or undefined).
 *
 * Handles various input types and string representations:
 * - Boolean values are returned directly
 * - Numbers: 0 → false, non-zero → true
 * - Strings: 'true'/'1'/'on'/'yes'/'y' → true, 'false'/'0'/'off'/'no'/'n' → false
 * - Other values or unrecognized strings → undefined
 *
 * @param input - The value to convert (boolean, number, string, or other)
 * @returns true, false, or undefined based on the input interpretation
 */
export function toTriboolInput(input: unknown): Tribool {
    if (typeof input === 'boolean') {
        return input;
    }
    if (typeof input === 'number') {
        return input !== 0;
    }
    if (typeof input !== 'string') {
        return undefined;
    }
    if (['true', '1', 'on', 'yes', 'y'].includes(input.toLowerCase())) {
        return true;
    } else if (['false', '0', 'off', 'no', 'n'].includes(input.toLowerCase())) {
        return false;
    } else {
        return undefined;
    }
}

/**
 * Retrieves a GitHub Actions input as a Tribool (true, false, or undefined).
 *
 * Parses the input value using tribool interpretation rules, allowing for
 * flexible boolean-like input handling where empty or unrecognized values
 * return undefined instead of defaulting to false.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns true, false, or undefined based on the input interpretation
 * @throws {Error} When input is marked as required but no value is available
 */
export function getTribool(name: string | string[], options: InputOptions = {}): Tribool {
    return toTriboolInput(getInput(name, options));
}

/**
 * Retrieves a GitHub Actions input as either a boolean or the raw string value.
 *
 * If the input can be interpreted as a boolean (true/false/yes/no/etc.), returns
 * that boolean. Otherwise, returns the raw string value. This is useful for inputs
 * that can accept both boolean flags and string values.
 *
 * @param input - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns A boolean if the input is boolean-like, otherwise the string value
 * @throws {Error} When input is marked as required but no value is available
 */
export function getBoolOrString(input: string | string[], options: InputOptions = {}): boolean | string {
    const asBool = getTribool(input, options);
    if (typeof asBool !== 'boolean') {
        return getInput(input, options);
    }
    return asBool;
}

/**
 * Retrieves a GitHub Actions input and splits it into an array of strings.
 *
 * The input value is split using the provided splitter pattern and filtered
 * using the filter function. By default, splits on commas, semicolons, and
 * spaces, and filters out empty strings.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param splitter - A RegExp, string pattern, or undefined to use the default
 *                   split pattern (comma, semicolon, or space)
 * @param filterFn - A function to filter array elements. Defaults to filtering
 *                   out empty strings
 * @param options - Configuration options for input retrieval
 * @returns Array of strings after splitting and filtering
 * @throws {Error} When input is marked as required but no value is available
 */
export function getArray(
    name: string | string[],
    splitter: SplitterArg = defaultSplitRegex,
    filterFn: FilterFn = isNonEmptyStr,
    options: InputOptions = {}
): string[] {
    let actualSplitter: RegExp;
    if (splitter === undefined) {
        actualSplitter = defaultSplitRegex;
    } else if (typeof splitter === 'string') {
        actualSplitter = new RegExp(splitter);
    } else {
        actualSplitter = splitter;
    }

    const actualFilterFn = filterFn ?? isNonEmptyStr;
    return getInput(name, options).split(actualSplitter).filter(actualFilterFn);
}

/**
 * Retrieves a GitHub Actions input and returns it as a Set of unique strings.
 *
 * Similar to getArray, but returns a Set which automatically deduplicates values.
 * Useful when the input may contain duplicate values that should be treated as one.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param splitter - A RegExp, string pattern, or undefined to use the default
 *                   split pattern (comma, semicolon, or space)
 * @param filterFn - A function to filter elements. Defaults to filtering out empty strings
 * @param options - Configuration options for input retrieval
 * @returns Set of unique strings after splitting and filtering
 * @throws {Error} When input is marked as required but no value is available
 */
export function getSet(
    name: string | string[],
    splitter: SplitterArg = defaultSplitRegex,
    filterFn: FilterFn = isNonEmptyStr,
    options: InputOptions = {}
): Set<string> {
    return new Set(getArray(name, splitter, filterFn, options));
}

/**
 * Converts a string input to an integer value.
 *
 * Parses the input string as a base-10 integer. Returns undefined if the
 * string cannot be parsed as a valid integer.
 *
 * @param input - The string to parse as an integer
 * @returns The parsed integer, or undefined if parsing fails
 */
export function toIntegerInput(input: string): number | undefined {
    const parsedInt = parseInt(input, 10);
    if (isNaN(parsedInt)) {
        return undefined;
    }
    return parsedInt;
}

/**
 * Retrieves a GitHub Actions input as an integer.
 *
 * Parses the input value as a base-10 integer. Returns undefined if the
 * input is empty or cannot be parsed as a valid integer.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns The parsed integer, or undefined if parsing fails
 * @throws {Error} When input is marked as required but no value is available
 */
export function getInt(name: string | string[], options: InputOptions = {}): number | undefined {
    return toIntegerInput(getInput(name, options));
}

/**
 * Retrieves a GitHub Actions input as a boolean value.
 *
 * Unlike getTribool, this function always returns a boolean. If the input
 * cannot be interpreted as a boolean, returns the defaultValue from options
 * (if it's a boolean) or false.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options including an optional boolean defaultValue
 * @returns A boolean value representing the input
 * @throws {Error} When input is marked as required but no value is available
 */
export function getBool(name: string | string[], options: InputOptions = {}): boolean {
    const tribool = getTribool(name, options);
    if (typeof tribool === 'boolean') {
        return tribool;
    }
    if (typeof options.defaultValue === 'boolean') {
        return options.defaultValue;
    }
    return false;
}

/**
 * Alias for getBool, provided for backward compatibility.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns A boolean value representing the input
 */
export const getBoolean = getBool;

// Import parseKeyValues and parseMap for use in getKeyValues and getMap
import { parseKeyValues, parseMap } from './key-value-parser';

/**
 * Retrieves a multiline GitHub Actions input as an array of key-value pairs.
 *
 * Combines getMultilineInput with parseKeyValues to retrieve and parse
 * key-value data from a GitHub Actions input.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param delimiter - The character(s) separating keys from values. Defaults to ':'
 * @param options - Configuration options for input retrieval
 * @returns Array of KeyValue objects with key and value properties
 * @throws {Error} When input is marked as required but no value is available
 */
export function getKeyValues(
    name: string | string[],
    delimiter: string = ':',
    options: InputOptions = {}
): KeyValue[] {
    return parseKeyValues(getMultilineInput(name, options), delimiter);
}

/**
 * Retrieves a multiline GitHub Actions input as a Record (object) mapping keys to values.
 *
 * Combines getMultilineInput with parseMap to retrieve and parse
 * key-value data from a GitHub Actions input into an object.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param delimiter - The character(s) separating keys from values. Defaults to ':'
 * @param options - Configuration options for input retrieval
 * @returns Record object mapping keys to their corresponding values
 * @throws {Error} When input is marked as required but no value is available
 */
export function getMap(
    name: string | string[],
    delimiter: string = ':',
    options: InputOptions = {}
): Record<string, string> {
    return parseMap(getMultilineInput(name, options), delimiter);
}
