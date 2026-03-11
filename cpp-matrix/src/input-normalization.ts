/**
 * Input normalization utilities for cpp-matrix action.
 *
 * Provides compiler name normalization and key-value parsing helpers
 * used by schema transforms.
 *
 * @module input-normalization
 */

import {
    type CompilerSuggestion,
    type KeyValue
} from './types';

import {
    normalizeCompilerName
} from './parsing';

/**
 * Normalizes compiler names in object keys.
 *
 * Mutates the object in place, replacing any non-canonical compiler name keys
 * with their normalized equivalents.
 *
 * @param obj - Object with compiler name keys to normalize
 */
export function normalizeCompilerNameKeys(obj: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(obj)) {
        const newName = normalizeCompilerName(name);
        if (newName !== name) {
            obj[newName] = value;
            delete obj[name];
        }
    }
}

/**
 * Normalizes compiler names in suggestion arrays.
 *
 * Mutates each suggestion's compiler field in place, replacing any
 * non-canonical compiler names with their normalized equivalents.
 *
 * @param suggestions - Array of suggestions to normalize
 */
export function normalizeCompilerNameSuggestions(suggestions: CompilerSuggestion[]): void {
    for (const s of suggestions) {
        s.compiler = normalizeCompilerName(s.compiler);
    }
}

/**
 * Parses key-value pairs from an array of strings.
 *
 * @param lines - Array of strings in format "key: value"
 * @returns Array of KeyValue objects, or undefined if no valid pairs found
 */
export function parseKeyValues(lines: string[]): KeyValue[] | undefined {
    const result: KeyValue[] = [];
    for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            result.push({
                key: line.slice(0, colonIndex).trim(),
                value: line.slice(colonIndex + 1).trim()
            });
        }
    }
    return result.length > 0 ? result : undefined;
}
