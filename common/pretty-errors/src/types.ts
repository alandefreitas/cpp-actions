/**
 * Options for reportAndSetFailed
 */
export interface ErrorReportOptions {
    /** Title to display in the error message */
    title?: string;
    /** Optional hint text. Set to null to omit, undefined for default hint */
    hint?: string | null;
    /** Local variables to include in the error report */
    locals?: Record<string, unknown> | (() => Record<string, unknown>);
    /** Whether to include the full stack trace in setFailed call */
    includeStackInSetFailed?: boolean;
}

/**
 * Context around a line of source code
 */
export interface SourceContext {
    pre: string[];
    line: string;
    post: string[];
}

/**
 * Frame information for Youch-like payload
 */
export interface YouchFrame {
    file: string;
    filePath: string;
    line: number;
    column: number;
    callee: string;
    calleeShort: string;
    context: SourceContext;
    isModule: boolean;
    isNative: boolean;
    isApp: boolean;
}

/**
 * Youch-like error payload structure
 */
export interface YouchPayload {
    error: {
        message: string | undefined;
        name: string | undefined;
        status?: number;
        frames: YouchFrame[];
    };
}

/**
 * StackTracey frame type (partial, as the library doesn't have types)
 */
export interface StackTraceyFrame {
    file?: string;
    fileRelative?: string;
    line: number;
    column: number;
    callee?: string;
    calleeShort?: string;
    native?: boolean;
    thirdParty?: boolean;
}

/**
 * StackTracey instance type (partial)
 */
export interface StackTraceyInstance {
    items: StackTraceyFrame[];
}

/**
 * Error type that may have additional properties
 */
export interface ExtendedError extends Error {
    status?: number;
}
