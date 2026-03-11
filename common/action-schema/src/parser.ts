/**
 * Schema-based input parsing for GitHub Actions.
 *
 * This module provides functions to extract action inputs based on schema definitions,
 * replacing manual input extraction code with a single, type-safe function.
 *
 * @module parser
 */

import * as gh_inputs from 'gh-inputs';
import type { ActionInputsSchema, InferInputs, InputSchema, InputTypeToTS } from './types';

/**
 * Converts a snake_case or camelCase key to kebab-case for GitHub Actions.
 *
 * Schema keys use camelCase (TypeScript convention), while action.yml uses
 * kebab-case (GitHub Actions convention). This function bridges the two.
 * Also handles legacy snake_case keys for backwards compatibility.
 *
 * @param key - The camelCase or snake_case key (e.g., 'checkLatest' or 'checkLatest')
 * @returns The kebab-case name (e.g., 'check-latest')
 */
export function toKebabCase(key: string): string {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
}

/**
 * Extracts a single input value based on its schema definition.
 *
 * @param inputName - The kebab-case input name
 * @param schema - The schema definition for this input
 * @returns The extracted and optionally transformed value
 * @throws Error if the input schema type is unknown
 */
function extractInput<T extends InputSchema>(
    inputName: string,
    schema: T
): InputTypeToTS[T['type']] {
    // Convert Set defaults to arrays for gh-inputs
    let defaultValue: string | string[] | undefined;
    if (schema.default instanceof Set) {
        defaultValue = [...schema.default];
    } else {
        defaultValue = schema.default as string | string[] | undefined;
    }
    const options: gh_inputs.InputOptions = {
        required: schema.required,
        defaultValue,
        fallbackEnv: schema.fallbackEnv
    };

    let value: unknown;

    switch (schema.type) {
        case 'string':
            value = gh_inputs.getInput(inputName, options);
            break;

        case 'boolean':
            value = gh_inputs.getBoolean(inputName, options);
            break;

        case 'number':
            value = gh_inputs.getInt(inputName, options);
            break;

        case 'string[]':
            value = gh_inputs.getArray(
                inputName,
                schema.splitter,
                undefined,
                options
            );
            break;

        case 'path':
            value = gh_inputs.getNormalizedPath(inputName, options);
            break;

        case 'multiline':
            value = gh_inputs.getMultilineInput(inputName, options);
            break;

        case 'tribool':
            value = gh_inputs.getTribool(inputName, options);
            break;

        case 'map':
            value = gh_inputs.getMap(inputName, ':', options);
            break;

        case 'set':
            value = gh_inputs.getSet(inputName, schema.splitter, undefined, options);
            break;

        case 'multilineSet':
            value = new Set(gh_inputs.getMultilineInput(inputName, options));
            break;

        default: {
            // Exhaustive check - TypeScript will error if a type is missing
            const _exhaustive: never = schema.type;
            throw new Error(`Unknown input type: ${_exhaustive}`);
        }
    }

    // Validate against allowed values
    if (schema.validValues && value !== undefined) {
        const allowed = schema.validValues as readonly unknown[];
        if (!allowed.includes(value)) {
            value = schema.default;
        }
    }

    // Apply transform if defined
    if (schema.transform && value !== undefined) {
        value = schema.transform(value as InputTypeToTS[T['type']]);
    }

    return value as InputTypeToTS[T['type']];
}

/**
 * Extracts all inputs from a schema definition.
 *
 * This function replaces manual input extraction code like:
 * ```typescript
 * const inputs: Inputs = {
 *     version: gh_inputs.getInput('version', { defaultValue: '*' }),
 *     path: gh_inputs.getArray('path', /[:;]/),
 *     checkLatest: gh_inputs.getBoolean('check-latest'),
 *     // ... etc
 * };
 * ```
 *
 * With a single call:
 * ```typescript
 * const inputs = parseInputs(inputsSchema);
 * ```
 *
 * @param schema - The complete inputs schema definition
 * @returns An object with all input values, typed according to the schema
 *
 * @example
 * ```typescript
 * const schema = {
 *     version: { type: 'string' as const, default: '*', description: '...' },
 *     path: { type: 'string[]' as const, splitter: /[:;]/, description: '...' },
 *     checkLatest: { type: 'boolean' as const, default: false, description: '...' }
 * } satisfies ActionInputsSchema;
 *
 * const inputs = parseInputs(schema);
 * // inputs.version is string
 * // inputs.path is string[]
 * // inputs.checkLatest is boolean
 * ```
 */
export function parseInputs<S extends ActionInputsSchema>(schema: S): InferInputs<S> {
    const result: Record<string, unknown> = {};

    for (const [key, inputSchema] of Object.entries(schema)) {
        const inputName = toKebabCase(key);
        result[key] = extractInput(inputName, inputSchema);
    }

    return result as InferInputs<S>;
}

/**
 * Creates a function that parses inputs from a specific schema.
 *
 * Useful when you want to create a reusable parser for a specific action.
 *
 * @param schema - The inputs schema definition
 * @returns A function that parses inputs according to the schema
 *
 * @example
 * ```typescript
 * const parseGccInputs = createInputParser(gccInputsSchema);
 * // Later...
 * const inputs = parseGccInputs();
 * ```
 */
export function createInputParser<S extends ActionInputsSchema>(
    schema: S
): () => InferInputs<S> {
    return () => parseInputs(schema);
}
