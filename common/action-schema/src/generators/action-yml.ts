/**
 * GitHub Actions action.yml generator/updater.
 *
 * This module provides functions to generate and update action.yml files
 * from schema definitions. It updates only the `inputs` and `outputs` sections,
 * preserving all other fields (name, description, runs, branding).
 *
 * @module generators/action-yml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type {
    ActionInputsSchema,
    ActionOutputsSchema,
    ActionYmlInput,
    ActionYmlOutput,
    InputSchema
} from '../types';
import { toKebabCase } from '../parser';

/**
 * Converts an InputSchema default value to a string for action.yml.
 *
 * @param schema - The input schema
 * @returns The default value as a string, or undefined if no default
 */
function defaultToString(schema: InputSchema): string | undefined {
    if (schema.default === undefined) {
        return undefined;
    }

    switch (schema.type) {
        case 'boolean':
        case 'tribool':
            return schema.default === true ? 'true' : 'false';

        case 'number':
            return String(schema.default);

        case 'string':
        case 'path':
            return schema.default as string;

        case 'string[]':
        case 'multiline': {
            const arr = schema.default as string[];
            return arr.length > 0 ? arr.join('\n') : '';
        }

        case 'set':
        case 'multilineSet': {
            const set = schema.default as Set<string>;
            return set.size > 0 ? [...set].join('\n') : '';
        }

        case 'map': {
            const map = schema.default as Record<string, string>;
            return Object.entries(map)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
        }

        case 'regex':
            return (schema.default as RegExp).source;

        default:
            return String(schema.default);
    }
}

/**
 * Generates the inputs section for action.yml from a schema.
 *
 * @param schema - The inputs schema
 * @returns Record of input definitions for action.yml
 *
 * @example
 * ```typescript
 * const inputs = generateInputsSection({
 *     version: { type: 'string', default: '*', description: 'Version to use.' }
 * });
 * // { version: { description: 'Version to use.', required: false, default: '*' } }
 * ```
 */
export function generateInputsSection(
    schema: ActionInputsSchema
): Record<string, ActionYmlInput> {
    const inputs: Record<string, ActionYmlInput> = {};

    for (const [key, inputSchema] of Object.entries(schema)) {
        const inputName = toKebabCase(key);
        const input: ActionYmlInput = {
            description: inputSchema.description
        };

        // Only add required if explicitly true
        if (inputSchema.required === true) {
            input.required = true;
        } else {
            input.required = false;
        }

        // Add default if defined
        const defaultValue = defaultToString(inputSchema);
        if (defaultValue !== undefined) {
            input.default = defaultValue;
        }

        inputs[inputName] = input;
    }

    return inputs;
}

/**
 * Generates the outputs section for action.yml from a schema.
 *
 * @param schema - The outputs schema
 * @returns Record of output definitions for action.yml
 */
export function generateOutputsSection(
    schema: ActionOutputsSchema
): Record<string, ActionYmlOutput> {
    const outputs: Record<string, ActionYmlOutput> = {};

    for (const [key, outputSchema] of Object.entries(schema)) {
        const outputName = toKebabCase(key);
        outputs[outputName] = {
            description: outputSchema.description
        };
    }

    return outputs;
}

/**
 * Options for updating an action.yml file.
 */
export interface UpdateActionYmlOptions {
    /** Path to the action.yml file */
    actionYmlPath: string;

    /** Schema for inputs (will replace existing inputs section) */
    inputsSchema?: ActionInputsSchema;

    /** Schema for outputs (will replace existing outputs section) */
    outputsSchema?: ActionOutputsSchema;

    /** If true, performs a dry run without writing changes */
    dryRun?: boolean;
}

/**
 * Result of an action.yml update operation.
 */
export interface UpdateActionYmlResult {
    /** Whether the file was modified */
    modified: boolean;

    /** The updated YAML content */
    content: string;

    /** Path to the file */
    path: string;

    /** Number of inputs updated */
    inputsCount: number;

    /** Number of outputs updated */
    outputsCount: number;
}

/**
 * Updates an existing action.yml file with inputs/outputs from schemas.
 *
 * This function:
 * 1. Reads the existing action.yml file
 * 2. Replaces the `inputs` section if inputsSchema is provided
 * 3. Replaces the `outputs` section if outputsSchema is provided
 * 4. Preserves all other fields (name, description, runs, branding)
 * 5. Writes the updated file back
 *
 * @param options - Update options including paths and schemas
 * @returns Result object with update information
 * @throws Error if the action.yml file doesn't exist
 *
 * @example
 * ```typescript
 * await updateActionYml({
 *     actionYmlPath: './setup-gcc/action.yml',
 *     inputsSchema: gccInputsSchema,
 *     outputsSchema: gccOutputsSchema
 * });
 * ```
 */
export async function updateActionYml(
    options: UpdateActionYmlOptions
): Promise<UpdateActionYmlResult> {
    const { actionYmlPath, inputsSchema, outputsSchema, dryRun = false } = options;

    // Resolve to absolute path
    const absolutePath = path.resolve(actionYmlPath);

    // Read existing file
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`action.yml not found: ${absolutePath}`);
    }

    const existingContent = fs.readFileSync(absolutePath, 'utf8');

    // Parse YAML while preserving comments and formatting as much as possible
    const doc = YAML.parseDocument(existingContent);

    let inputsCount = 0;
    let outputsCount = 0;

    // Update inputs if schema provided
    if (inputsSchema) {
        const newInputs = generateInputsSection(inputsSchema);
        inputsCount = Object.keys(newInputs).length;

        // Replace the inputs section in the document
        doc.set('inputs', newInputs);
    }

    // Update outputs if schema provided
    if (outputsSchema) {
        const newOutputs = generateOutputsSection(outputsSchema);
        outputsCount = Object.keys(newOutputs).length;

        // Replace the outputs section in the document
        doc.set('outputs', newOutputs);
    }

    // Generate new YAML content
    const newContent = doc.toString({
        lineWidth: 0, // Don't wrap lines
        minContentWidth: 0,
        singleQuote: true
    });

    // Check if content changed
    const modified = newContent !== existingContent;

    // Write if not dry run and content changed
    if (!dryRun && modified) {
        fs.writeFileSync(absolutePath, newContent, 'utf8');
    }

    return {
        modified,
        content: newContent,
        path: absolutePath,
        inputsCount,
        outputsCount
    };
}

/**
 * Updates multiple action.yml files from their respective schemas.
 *
 * @param actions - Array of action configurations with paths and schemas
 * @param dryRun - If true, performs dry run without writing
 * @returns Array of results for each action
 */
export async function updateMultipleActionYmls(
    actions: Array<{
        actionYmlPath: string;
        inputsSchema?: ActionInputsSchema;
        outputsSchema?: ActionOutputsSchema;
    }>,
    dryRun = false
): Promise<UpdateActionYmlResult[]> {
    const results: UpdateActionYmlResult[] = [];

    for (const action of actions) {
        const result = await updateActionYml({
            ...action,
            dryRun
        });
        results.push(result);
    }

    return results;
}
