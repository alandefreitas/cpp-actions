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
    /**
     * Whether to treat an empty string as a valid input value.
     *
     * When `true`, an empty string from `core.getInput` is accepted as-is
     * without falling through to the next alias, environment variable, or
     * default value.
     *
     * When `false`, empty strings are skipped and the next source is tried.
     *
     * Defaults to `false`.
     *
     * NOTE: GitHub Actions runner issue #924 means the runner sets
     * `INPUT_<NAME>=""` for ALL declared inputs, even when the user does
     * not provide a value. This makes it impossible to distinguish "not
     * provided" from "explicitly set to empty." Use a sentinel default
     * value (e.g., a string containing invalid characters for the domain)
     * when you need this distinction.
     */
    acceptEmpty?: boolean;
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
