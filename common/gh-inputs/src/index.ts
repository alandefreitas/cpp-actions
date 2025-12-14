import * as core from '@actions/core';
import * as nodePath from 'path';
import type { InputOptions, KeyValue, Tribool, FilterFn, SplitterArg, StringRecord } from './types';

export type { InputOptions, KeyValue, Tribool, FilterFn, SplitterArg, StringRecord };

const defaultOptions: InputOptions = {
    required: false,
    trimWhitespace: true,
    fallbackEnv: undefined,
    defaultValue: ''
};

const defaultSplitRegex = /[,; ]/;
const isNonEmptyStr: FilterFn = (s: string): boolean => s !== '';

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
        if (str) {
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
 * Retrieves a multiline GitHub Actions input as an array of strings.
 *
 * Each line of the input becomes a separate element in the returned array.
 * Supports multiple input name aliases and environment variable fallbacks.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options including required flag, trimWhitespace,
 *                  fallbackEnv, and defaultValue (can be string or string[])
 * @returns Array of strings, one per line of input, or defaultValue if not found
 * @throws {Error} When input is marked as required but no value is available
 */
export function getMultilineInput(name: string | string[], options: InputOptions = {}): string[] {
    const opts = { ...defaultOptions, ...options };
    const nameArr = Array.isArray(name) ? name : [name];

    for (const n of nameArr) {
        const coreOptions = { ...opts, required: false };
        const str = core.getMultilineInput(n, coreOptions);
        if (str && str.length > 0) {
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
                        return [trimmed];
                    }
                } else {
                    return [envVal];
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

/**
 * Result of extracting an environment variable identifier from a string.
 */
interface ExtractIdentifierResult {
    i: number;
    curArg: string;
}

/**
 * Extracts and expands an environment variable identifier from a string position.
 *
 * @param i - Current position in the line
 * @param line - The line being parsed
 * @param char - Current character being processed
 * @param curArg - Current argument being built
 * @returns Updated position and argument with expanded variable
 */
function extractIdentifier(
    i: number,
    line: string,
    char: string,
    curArg: string
): ExtractIdentifierResult {
    const nextChar = i < line.length - 1 ? line[i + 1] : undefined;
    if (nextChar && /^[a-zA-Z_]/.test(nextChar)) {
        let identifier = nextChar;
        let j = i + 2;
        for (; j < line.length; j++) {
            const idChar = line[j];
            if (/^[a-zA-Z0-9_]/.test(idChar)) {
                identifier += idChar;
            } else {
                break;
            }
        }
        const envValue = process.env[identifier];
        if (envValue) {
            curArg += envValue;
        }
        i = j - 1;
    } else {
        curArg += char;
    }
    return { i, curArg };
}

/**
 * Parses a bash-style argument string into an array of individual arguments.
 *
 * Handles:
 * - Single and double quoted strings (preserving spaces within)
 * - Escaped characters with backslash
 * - Environment variable expansion ($VAR syntax)
 * - Proper quote nesting rules (single quotes are literal, double quotes allow escapes)
 *
 * @param extra_args - A string or array of strings containing bash-style arguments
 * @returns Array of parsed individual arguments
 */
export function parseBashArguments(extra_args: string | string[]): string[] {
    const argsArray = Array.isArray(extra_args) ? extra_args : [extra_args];

    const args: string[] = [];
    for (const line of argsArray) {
        let curQuote: string | undefined = undefined;
        let curArg = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const inQuote = curQuote !== undefined;
            const curIsQuote = ['"', "'"].includes(char);
            const curIsEscaped = i > 0 && line[i - 1] === '\\';

            if (!inQuote) {
                if (!curIsEscaped) {
                    if (curIsQuote) {
                        curQuote = char;
                    } else if (char === ' ') {
                        if (curArg !== '') {
                            args.push(curArg);
                            curArg = '';
                        }
                    } else if (char === '$') {
                        const result = extractIdentifier(i, line, char, curArg);
                        i = result.i;
                        curArg = result.curArg;
                    } else if (char !== '\\') {
                        curArg += char;
                    }
                } else {
                    curArg += char;
                }
            } else if (curQuote === '"') {
                if (!curIsEscaped) {
                    if (char === curQuote) {
                        curQuote = undefined;
                    } else if (char === '$') {
                        const result = extractIdentifier(i, line, char, curArg);
                        i = result.i;
                        curArg = result.curArg;
                    } else if (char !== '\\') {
                        curArg += char;
                    }
                } else {
                    if (!['$', '`', '"', '\\'].includes(char)) {
                        curArg += '\\';
                    }
                    curArg += char;
                }
            } else if (curQuote === "'") {
                if (char !== curQuote) {
                    curArg += char;
                } else {
                    curQuote = undefined;
                }
            }
        }

        if (curArg !== '') {
            args.push(curArg);
        }
    }
    return args;
}

/**
 * Retrieves a multiline GitHub Actions input and parses it as bash-style arguments.
 *
 * Combines getMultilineInput with parseBashArguments to retrieve and parse
 * command-line style arguments from a GitHub Actions input.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns Array of parsed individual arguments
 */
export function getBashArguments(name: string | string[], options: InputOptions = {}): string[] {
    return parseBashArguments(core.getMultilineInput(Array.isArray(name) ? name[0] : name, options));
}

/**
 * Parses an array of strings into key-value pairs using a delimiter.
 *
 * Each line is split at the first occurrence of the delimiter. Lines without
 * a delimiter are treated as values with an empty key. Empty lines are skipped.
 *
 * @param lines - Array of strings to parse
 * @param delimiter - The character(s) separating keys from values. Defaults to ':'
 * @returns Array of KeyValue objects with key and value properties
 */
export function parseKeyValues(lines: string[], delimiter: string = ':'): KeyValue[] {
    const keyValues: KeyValue[] = [];
    for (const line of lines) {
        const delimiterIndex = line.indexOf(delimiter);
        const key = delimiterIndex !== -1 ? line.substring(0, delimiterIndex) : '';
        const value = delimiterIndex !== -1 ? line.substring(delimiterIndex + delimiter.length) : line;

        if (key && value) {
            keyValues.push({ key: key.trim(), value: value.trim() });
        } else if (key) {
            keyValues.push({ key: '', value: key.trim() });
        }
    }
    return keyValues;
}

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
 * Parses an array of strings into a Record (object) mapping keys to values.
 *
 * Similar to parseKeyValues but returns a plain object instead of an array.
 * Note: If duplicate keys exist, later values will overwrite earlier ones.
 *
 * @param lines - Array of strings to parse
 * @param delimiter - The character(s) separating keys from values. Defaults to ':'
 * @returns Record object mapping keys to their corresponding values
 */
export function parseMap(lines: string[], delimiter: string = ':'): Record<string, string> {
    return Object.fromEntries(
        parseKeyValues(lines, delimiter).map(({ key, value }) => [key, value])
    );
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

/**
 * Converts an unknown value to a human-readable string representation.
 *
 * Handles various types with special formatting:
 * - Set: Converted to JSON array with braces (e.g., {1, 2, 3})
 * - Map: Converted to JSON object
 * - Boolean: Returns 'true' or 'false'
 * - Falsy values: Returns '<empty>'
 * - Other values: Returns JSON stringified representation
 *
 * @param value - The value to convert to a string
 * @returns A human-readable string representation of the value
 */
export function makeValueString(value: unknown): string {
    if (value instanceof Set) {
        return JSON.stringify(Array.from(value)).replace(/^\[/, '{').replace(/]$/, '}');
    }
    if (value instanceof Map) {
        return JSON.stringify(Object.fromEntries(value));
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (!value) {
        return '<empty>';
    }
    return JSON.stringify(value);
}

/**
 * Converts a name from snake_case to kebab-case.
 *
 * Replaces all underscores with hyphens. This is commonly used to convert
 * JavaScript property names to GitHub Actions input/output names.
 *
 * @param name - The snake_case name to convert
 * @returns The name in kebab-case
 */
export function makeKebabName(name: string): string {
    return name.replaceAll('_', '-');
}

/**
 * Prints all properties of an input object to the GitHub Actions log.
 *
 * Each property is logged with its name converted to kebab-case and its
 * value formatted using makeValueString. Useful for debugging action inputs.
 *
 * @param inputObject - An object whose properties will be logged
 */
export function printInputObject(inputObject: StringRecord): void {
    for (const [name, value] of Object.entries(inputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`);
    }
}

/**
 * Sets GitHub Actions outputs from all properties of an object.
 *
 * Each property is set as an output with its name converted to kebab-case.
 * Also logs each output to the GitHub Actions log for visibility. Useful for
 * setting multiple related outputs at once.
 *
 * @param outputObject - An object whose properties will be set as outputs
 */
export function setOutputObject(outputObject: StringRecord): void {
    for (const [name, value] of Object.entries(outputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`);
        core.setOutput(makeKebabName(name), value);
    }
}
