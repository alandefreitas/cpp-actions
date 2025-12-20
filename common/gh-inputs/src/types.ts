/**
 * Options for input retrieval functions
 */
export interface InputOptions {
    /** Whether the input is required */
    required?: boolean;
    /** Whether to trim whitespace from the input */
    trimWhitespace?: boolean;
    /** Environment variable(s) to fall back to if input is not provided */
    fallbackEnv?: string | string[];
    /** Default value if input is not provided */
    defaultValue?: string | boolean | string[];
    /** Whether to filter out comment lines (lines starting with commentPrefix). Defaults to true. */
    filterComments?: boolean;
    /** The prefix that identifies comment lines. Defaults to '#'. */
    commentPrefix?: string;
    /** Whether to filter out blank/whitespace-only lines. Defaults to true. */
    filterBlankLines?: boolean;
}

/**
 * A key-value pair parsed from input
 */
export interface KeyValue {
    key: string;
    value: string;
}

/**
 * A three-valued boolean: true, false, or undefined
 */
export type Tribool = boolean | undefined;

/**
 * Function type for filtering strings in arrays
 */
export type FilterFn = (s: string) => boolean;

/**
 * Splitter argument type for getArray/getSet
 */
export type SplitterArg = RegExp | string | undefined;

/**
 * Record type for objects with string keys
 */
export type StringRecord = Record<string, unknown>;
