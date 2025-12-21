/**
 * Output formatting and logging utilities for GitHub Actions.
 *
 * @module output-utils
 */

import * as core from '@actions/core';
import type { StringRecord } from './types';

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
