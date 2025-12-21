/**
 * Key-value parsing utilities for GitHub Actions inputs.
 *
 * @module key-value-parser
 */

import type { KeyValue } from './types';

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
