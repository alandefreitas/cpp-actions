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

export function getRegex(name: string | string[], options: InputOptions = {}): RegExp {
    return new RegExp(getInput(name, options));
}

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

export function getLowerCaseInput(name: string | string[], options: InputOptions = {}): string {
    return getInput(name, options).toLowerCase();
}

export function normalizePath(inputPath: string): string {
    if (process.platform === 'win32') {
        return inputPath.replace(/\\/g, '/');
    }
    return inputPath;
}

export function getNormalizedPath(name: string | string[], options: InputOptions = {}): string {
    return normalizePath(getInput(name, options));
}

export function getResolvedPath(name: string | string[], options: InputOptions = {}): string {
    return nodePath.resolve(normalizePath(getInput(name, options)));
}

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

export function getTribool(name: string | string[], options: InputOptions = {}): Tribool {
    return toTriboolInput(getInput(name, options));
}

export function getBoolOrString(input: string | string[], options: InputOptions = {}): boolean | string {
    const asBool = getTribool(input, options);
    if (typeof asBool !== 'boolean') {
        return getInput(input, options);
    }
    return asBool;
}

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

export function getSet(
    name: string | string[],
    splitter: SplitterArg = defaultSplitRegex,
    filterFn: FilterFn = isNonEmptyStr,
    options: InputOptions = {}
): Set<string> {
    return new Set(getArray(name, splitter, filterFn, options));
}

export function toIntegerInput(input: string): number | undefined {
    const parsedInt = parseInt(input, 10);
    if (isNaN(parsedInt)) {
        return undefined;
    }
    return parsedInt;
}

export function getInt(name: string | string[], options: InputOptions = {}): number | undefined {
    return toIntegerInput(getInput(name, options));
}

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

// Alias for backward compatibility
export const getBoolean = getBool;

interface ExtractIdentifierResult {
    i: number;
    curArg: string;
}

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

export function getBashArguments(name: string | string[], options: InputOptions = {}): string[] {
    return parseBashArguments(core.getMultilineInput(Array.isArray(name) ? name[0] : name, options));
}

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

export function getKeyValues(
    name: string | string[],
    delimiter: string = ':',
    options: InputOptions = {}
): KeyValue[] {
    return parseKeyValues(getMultilineInput(name, options), delimiter);
}

export function parseMap(lines: string[], delimiter: string = ':'): Record<string, string> {
    return Object.fromEntries(
        parseKeyValues(lines, delimiter).map(({ key, value }) => [key, value])
    );
}

export function getMap(
    name: string | string[],
    delimiter: string = ':',
    options: InputOptions = {}
): Record<string, string> {
    return parseMap(getMultilineInput(name, options), delimiter);
}

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

export function makeKebabName(name: string): string {
    return name.replaceAll('_', '-');
}

export function printInputObject(inputObject: StringRecord): void {
    for (const [name, value] of Object.entries(inputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`);
    }
}

export function setOutputObject(outputObject: StringRecord): void {
    for (const [name, value] of Object.entries(outputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`);
        core.setOutput(makeKebabName(name), value);
    }
}
