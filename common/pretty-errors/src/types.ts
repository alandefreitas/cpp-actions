/**
 * Options for reportAndSetFailed
 */
export interface ErrorReportOptions {
    /** Title to display in the error message */
    title?: string;
    /** Optional hint text. Set to null to omit, undefined for default hint */
    hint?: string | null;
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
 * Processed stack frame with source context and metadata.
 */
export interface ErrorFrame {
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
 * Structured error payload for rendering.
 */
export interface ErrorPayload {
    error: {
        message: string | undefined;
        name: string | undefined;
        status?: number;
        frames: ErrorFrame[];
    };
}

/**
 * Parsed stack frame information.
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
 * Error type that may have additional properties
 */
export interface ExtendedError extends Error {
    status?: number;
}
