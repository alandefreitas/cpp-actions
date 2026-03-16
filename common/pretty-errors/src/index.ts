/**
 * Pretty error reporting for GitHub Actions.
 *
 * Provides source-map aware error rendering with colorized output,
 * showing original TypeScript source locations and context.
 *
 * @module pretty-errors
 */

import * as core from '@actions/core';
import type {
    ErrorReportOptions,
    SourceContext,
    ErrorFrame,
    ErrorPayload,
    ExtendedError
} from './types';
import { ExpectedError, expectedError } from './expected-error';

export type { ErrorReportOptions, SourceContext, ErrorFrame, ErrorPayload };
export { ExpectedError, expectedError };

// Re-export commonly used utilities
export { resolveFilePath, readFileSync, resolveSourceMapLocation } from './source-map';
export type { ResolvedLocation } from './source-map';
export { parseStackTrace } from './stack-parser';
export {
    colors,
    isTraceCommandsEnabled,
    extractContextFromContent,
    readContextFromFile,
    getRelativePath,
    renderSourceContext,
    hasValidContext,
    buildErrorPayload,
    renderErrorPayload,
    renderTerminal
} from './render';

/**
 * Renders a human-friendly, source-aware stack trace and marks the action as failed.
 *
 * This function produces a colorized, detailed error report with source context
 * and code locations mapped through source maps. It displays the error in the
 * GitHub Actions log and then sets the action status to failed.
 *
 * @param error - The error to report. Can be a standard Error or ExtendedError with
 *                additional context like an `expose` property containing extra details.
 * @param options - Configuration options for the error report including title, hint text,
 *                  and whether to include stack in setFailed.
 */
export async function reportAndSetFailed(
    error: Error | ExtendedError,
    options: ErrorReportOptions = {}
): Promise<void> {
    // Expected errors get a clean message with no stack trace or source context
    if (error instanceof ExpectedError) {
        const { isTraceCommandsEnabled } = await import('./render');
        const title = error.title || options.title || 'Action failed';
        const message = `${title}: ${error.message}`;

        // Log stack trace at debug level when trace commands are enabled
        const traceEnabled = await isTraceCommandsEnabled();
        if (traceEnabled && error.stack) {
            core.debug(error.stack);
        }

        if (process.env.JEST_WORKER_ID) {
            core.error(message);
        } else {
            core.setFailed(message);
        }
        return;
    }

    // Dynamic import to avoid circular dependency
    const { isTraceCommandsEnabled, renderTerminal, colors } = await import('./render');

    const {
        title = 'Action failed',
        hint: providedHint
    } = options;

    const defaultTrueHint = 'Tip: Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
    const defaultFalseHint = 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs.';
    const traceEnabled = await isTraceCommandsEnabled();
    const hint = providedHint === undefined
        ? (traceEnabled ? defaultTrueHint : defaultFalseHint )
        : providedHint;
    const rendered = await renderTerminal(error);

    // Build the detailed error message for core.error()
    // Format: Title: message, then location/context, then hint
    const parts: string[] = [`${title}: ${error.message}`];
    if (rendered) {
        parts.push(rendered);
    }
    if (hint) {
        parts.push(`${colors.yellow}⚠ ${hint}${colors.reset}`);
    }

    const combined = parts.join('\n');
    // In test environments, avoid setFailed (it sets process.exitCode) to keep jest exit code clean
    if (process.env.JEST_WORKER_ID) {
        core.error(combined);
    } else {
        // Emit a single annotation only via setFailed to avoid duplicate error entries
        core.setFailed(combined);
    }
}

/**
 * Wraps an async function with pretty error reporting and failure handling.
 *
 * Executes the provided function and catches any errors, reporting them with
 * reportAndSetFailed. This is retained for backward compatibility; new code
 * should prefer direct try/catch with reportAndSetFailed for more control.
 *
 * @param fn - The async function to execute with error handling
 * @param options - Configuration options passed to reportAndSetFailed if an error occurs
 * @returns The result of fn() if successful, or undefined if an error occurred
 */
export async function withPrettyErrors<T>(
    fn: () => Promise<T>,
    options: ErrorReportOptions = {}
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (error) {
        await reportAndSetFailed(error as Error, options);
        return undefined;
    }
}
