/**
 * Type definitions for schema-driven GitHub Actions.
 *
 * This module provides the core type system for defining action inputs and outputs
 * in a platform-agnostic way. Schemas defined using these types serve as the single
 * source of truth for:
 * - TypeScript type inference
 * - Runtime input extraction
 * - action.yml generation
 * - Future: CLI argument parsing, other CI configs
 *
 * @module types
 */

/**
 * Supported input types and their corresponding extraction methods.
 *
 * | Type | gh-inputs function | TypeScript type |
 * |------|-------------------|-----------------|
 * | `'string'` | `getInput()` | `string` |
 * | `'boolean'` | `getBoolean()` | `boolean` |
 * | `'number'` | `getInt()` | `number` |
 * | `'string[]'` | `getArray()` | `string[]` |
 * | `'path'` | `getNormalizedPath()` | `string` |
 * | `'multiline'` | `getMultilineInput()` | `string[]` |
 * | `'tribool'` | `getTribool()` | `boolean \| undefined` |
 * | `'map'` | `getMap()` | `Record<string, string>` |
 * | `'set'` | `getSet()` | `Set<string>` |
 * | `'multilineSet'` | `new Set(getMultilineInput())` | `Set<string>` |
 * | `'regex'` | `new RegExp(getInput())` | `RegExp` |
 */
export type InputType =
    | 'string'
    | 'boolean'
    | 'number'
    | 'string[]'
    | 'path'
    | 'multiline'
    | 'tribool'
    | 'map'
    | 'set'
    | 'multilineSet'
    | 'regex';

/**
 * Maps InputType to its corresponding TypeScript type.
 *
 * Note: number always has a value because parseInputs provides a fallback of 0.
 * tribool retains undefined as it represents a three-state value.
 */
export type InputTypeToTS = {
    string: string;
    boolean: boolean;
    number: number;
    'string[]': string[];
    path: string;
    multiline: string[];
    tribool: boolean | undefined;
    map: Record<string, string>;
    set: Set<string>;
    multilineSet: Set<string>;
    regex: RegExp;
};

/**
 * Schema definition for a single action input.
 *
 * `required` and `default` interact as follows:
 * - If `default` is set, the input always has a value (the default fills in when the user omits it),
 *   so `required` is effectively redundant.
 * - If `required: true` without a `default`, GitHub Actions will error before the action runs
 *   when the input is missing. Use this for inputs that have no sensible default.
 * - If neither is set, the input is optional and will receive the zero value for its type
 *   (empty string, false, 0, empty array, etc.) from the gh-inputs extraction functions.
 *
 * @template T - The TypeScript type of the input value
 *
 * @example
 * ```typescript
 * // Required input with no default - user must provide it
 * const repoInput: InputSchema<'string'> = {
 *     type: 'string',
 *     required: true,
 *     description: 'The repository to clone.'
 * };
 *
 * // Optional input with default - always has a value
 * const versionInput: InputSchema<'string'> = {
 *     type: 'string',
 *     default: '*',
 *     description: 'Version range to use.'
 * };
 *
 * // Optional input with transform
 * const pathInput: InputSchema<'string[]'> = {
 *     type: 'string[]',
 *     splitter: /[:;]/,
 *     default: [],
 *     description: 'Paths to search.',
 *     transform: (paths) => paths.map(p => p.trim())
 * };
 * ```
 */
export interface InputSchema<T extends InputType = InputType> {
    /** The type of input, determines extraction method */
    type: T;

    /**
     * Whether this input is required.
     *
     * Only meaningful when `default` is not set. When `default` is provided,
     * the input always has a value regardless of this flag.
     */
    required?: boolean;

    /** Default value when input is not provided */
    default?: InputTypeToTS[T];

    /** Environment variable(s) to check as fallback */
    fallbackEnv?: string | string[];

    /**
     * Allowed values for this input. If the extracted value is not in this
     * list, the default is used instead. Use `as const` for type narrowing:
     * `validValues: ['a', 'b'] as const` infers `'a' | 'b'` instead of `string`.
     */
    validValues?: readonly InputTypeToTS[T][];

    /** For 'string[]' and 'set' types: regex pattern to split the input */
    splitter?: RegExp;

    /**
     * Transform function applied after extraction.
     *
     * May return the same type (e.g., trimming a string) or a different type
     * (e.g., converting a string to a RegExp). When a different type is returned,
     * {@link InferInputType} infers the transformed type for the inputs object.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform?: (value: InputTypeToTS[T]) => any;

    /**
     * Cross-field transform applied after all per-field transforms.
     *
     * Receives the current field's transformed value and the full inputs object
     * (after per-field transforms). Useful for derivations that depend on other
     * inputs, e.g., resolving a path relative to another input's directory.
     *
     * @param value - The current field's value after per-field transform
     * @param allInputs - All inputs after per-field transforms (before cross-transforms)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crossTransform?: (value: any, allInputs: Record<string, unknown>) => any;

    /**
     * Description for documentation and action.yml generation.
     * Supports multiline strings with AsciiDoc formatting.
     */
    description: string;
}

/**
 * Schema definition for a single action output.
 */
export interface OutputSchema {
    /** Description for documentation and action.yml generation */
    description: string;
}

/**
 * Complete schema for all inputs of an action.
 *
 * @example
 * ```typescript
 * const inputsSchema = {
 *     version: { type: 'string' as const, default: '*', description: 'Version to use.' },
 *     checkLatest: { type: 'boolean' as const, default: false, description: 'Check latest.' }
 * } satisfies ActionInputsSchema;
 * ```
 */
export type ActionInputsSchema = Record<string, InputSchema>;

/**
 * Complete schema for all outputs of an action.
 *
 * @example
 * ```typescript
 * const outputsSchema = {
 *     path: { description: 'Path to the installed tool.' },
 *     version: { description: 'The resolved version.' }
 * } satisfies ActionOutputsSchema;
 * ```
 */
export type ActionOutputsSchema = Record<string, OutputSchema>;

/**
 * Infers the TypeScript type for a single input schema.
 *
 * Priority order:
 * 1. If `crossTransform` exists, its return type is used
 * 2. If `transform` exists, its return type is used
 * 3. If `validValues` is specified with `as const`, narrows to the union of those values
 * 4. Otherwise, the base type from `InputTypeToTS` is used
 */
export type InferInputType<S extends InputSchema> =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    S extends { crossTransform: (...args: any[]) => infer R }
        ? R
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : S extends { transform: (...args: any[]) => infer R }
            ? R
            : S extends { validValues: readonly (infer V)[] }
                ? V
                : S extends InputSchema<infer T>
                    ? InputTypeToTS[T]
                    : never;

/**
 * Infers the TypeScript interface for an entire inputs schema.
 *
 * @example
 * ```typescript
 * const schema = {
 *     version: { type: 'string' as const, default: '*', description: '...' },
 *     checkLatest: { type: 'boolean' as const, default: false, description: '...' }
 * } satisfies ActionInputsSchema;
 *
 * type Inputs = InferInputs<typeof schema>;
 * // Inputs = { version: string; checkLatest: boolean; }
 * ```
 */
export type InferInputs<S extends ActionInputsSchema> = {
    [K in keyof S]: InferInputType<S[K]>;
};

/**
 * Options for the action runner.
 *
 * @template I - The inferred inputs type
 * @template O - The outputs type
 *
 * @example
 * ```typescript
 * const options: RunnerOptions<Inputs, Outputs> = {
 *     inputsSchema,
 *     outputsSchema,
 *     title: 'Setup GCC',
 *     main: async (inputs) => {
 *         const result = await setupGCC(inputs.version, inputs.path);
 *         return { cc: result.cc, cxx: result.cxx };
 *     }
 * };
 * ```
 */
export interface RunnerOptions<I, O> {
    /** Schema for input extraction */
    inputsSchema: ActionInputsSchema;

    /** Schema for output definition (used for action.yml generation) */
    outputsSchema?: ActionOutputsSchema;

    /** Action title for error messages */
    title: string;

    /** Main action logic */
    main: (inputs: I) => Promise<O>;

    /** Optional: Custom validation for outputs */
    validateOutputs?: (outputs: O) => boolean;

    /** Optional: Custom failure message when validateOutputs returns false */
    failureMessage?: string;
}

/**
 * Parsed action.yml structure for updating.
 */
export interface ActionYml {
    name: string;
    description: string;
    inputs?: Record<string, ActionYmlInput>;
    outputs?: Record<string, ActionYmlOutput>;
    runs: {
        using: string;
        main: string;
        'post-if'?: string;
    };
    branding?: {
        icon: string;
        color: string;
    };
}

/**
 * Input definition in action.yml format.
 */
export interface ActionYmlInput {
    description: string;
    required?: boolean;
    default?: string;
}

/**
 * Output definition in action.yml format.
 */
export interface ActionYmlOutput {
    description: string;
}
