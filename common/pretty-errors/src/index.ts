import * as core from '@actions/core';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type {
    ErrorReportOptions,
    SourceContext,
    YouchFrame,
    YouchPayload,
    StackTraceyFrame,
    StackTraceyInstance,
    ExtendedError
} from './types';

export type { ErrorReportOptions, SourceContext, YouchFrame, YouchPayload };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const youchTerminal = require('youch-terminal');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StackTracey = require('stacktracey');

/**
 * Checks if a stack frame originates from Node.js internal code.
 *
 * @param frame - Stack frame to check
 * @returns True if the frame is from Node.js internals
 */
function isNodeFrame(frame: StackTraceyFrame): boolean {
    if (frame.native) return true;
    const filename = frame.file || '';
    if (filename.startsWith('node:')) return true;
    return false;
}

/**
 * Options for reading source context around a stack frame.
 */
interface ReadContextOptions {
    pre?: number;
    post?: number;
}

/**
 * Reads source code context around a stack frame location.
 *
 * @param frame - Stack frame containing file and line information
 * @param options - Options for number of lines before and after
 * @returns Source context or null if file cannot be read
 */
function readContext(
    frame: StackTraceyFrame,
    options: ReadContextOptions = {}
): Promise<SourceContext | null> {
    const { pre = 5, post = 5 } = options;

    return new Promise((resolve) => {
        let filePath = frame.file;
        if (!filePath) return resolve(null);

        try {
            filePath = filePath.startsWith('file:') ? fileURLToPath(filePath) : filePath;
        } catch {
            // keep original path if URL conversion fails
        }

        fs.readFile(filePath, 'utf-8', (err, contents) => {
            if (err) return resolve(null);
            const lines = contents.split(/\r?\n/);
            const lineNumber = frame.line;
            resolve({
                pre: lines.slice(Math.max(0, lineNumber - (pre + 1)), lineNumber - 1),
                line: lines[lineNumber - 1] || '',
                post: lines.slice(lineNumber, lineNumber + post)
            });
        });
    });
}

/**
 * Builds a Youch-compatible payload from an error for terminal rendering.
 *
 * @param error - The error to build a payload from
 * @returns Payload containing error details and stack frames with source context
 */
async function buildYouchLikePayload(error: ExtendedError | null | undefined): Promise<YouchPayload> {
    const stack: StackTraceyInstance = new StackTracey(error?.stack || '');
    const frames: YouchFrame[] = await Promise.all(
        stack.items
            .filter((frame: StackTraceyFrame) => frame.file)
            .map(async (frame: StackTraceyFrame): Promise<YouchFrame> => {
                const context = await readContext(frame);
                let filePath = frame.file || '';
                try {
                    if (filePath.startsWith('file:')) {
                        filePath = fileURLToPath(filePath).replaceAll('\\', '/');
                    }
                } catch {
                    // keep original path
                }
                return {
                    file: frame.fileRelative || frame.file || '',
                    filePath,
                    line: frame.line,
                    column: frame.column,
                    callee: frame.callee || frame.calleeShort || 'anonymous',
                    calleeShort: frame.calleeShort || frame.callee || 'anonymous',
                    context: context || { pre: [], line: '', post: [] },
                    isModule: !!frame.thirdParty,
                    isNative: !!frame.native,
                    isApp: !isNodeFrame(frame)
                };
            })
    );

    return {
        error: {
            message: error?.message,
            name: error?.name,
            status: error?.status,
            frames
        }
    };
}

/**
 * Renders an error to a colorized terminal-friendly string.
 *
 * @param error - The error to render
 * @returns Formatted string with stack trace and source context
 */
async function renderTerminal(error: ExtendedError | null | undefined): Promise<string> {
    if (!error) {
        return '<no error>';
    }

    try {
        const payload = await buildYouchLikePayload(error);
        return youchTerminal(payload) as string;
    } catch (renderErr) {
        const fallbackStack = error.stack || String(error);
        const message = renderErr instanceof Error ? renderErr.message : String(renderErr);
        return `Pretty renderer failed: ${message}\n${fallbackStack}`;
    }
}

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
 *                  local variables to include, and whether to include stack in setFailed.
 */
export async function reportAndSetFailed(
    error: Error | ExtendedError,
    options: ErrorReportOptions = {}
): Promise<void> {
    const {
        title = 'Action failed',
        hint: providedHint,
        locals,
        includeStackInSetFailed = false
    } = options;

    const defaultHint = 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true or ACTIONS_STEP_DEBUG=true) for more logs. If this keeps happening, please open an issue at github.com/alandefreitas/cpp-actions.';
    const hint = providedHint === undefined ? defaultHint : providedHint;

    const rendered = await renderTerminal(error);

    let localsBlock = '';
    const resolvedLocals = typeof locals === 'function' ? locals() : locals;
    if (resolvedLocals) {
        try {
            localsBlock = `\nLocals: ${JSON.stringify(resolvedLocals, null, 2)}`;
        } catch (jsonErr) {
            const message = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
            localsBlock = `\nLocals: <unserializable: ${message}>`;
        }
    }

    const hintBlock = hint ? `\n${hint}` : '';
    const message = `${title}: ${error.message}\n${rendered}${localsBlock}${hintBlock}`;
    core.error(message);

    if (includeStackInSetFailed) {
        core.setFailed(`${error.message}\n${error.stack}`);
    } else {
        core.setFailed(error.message);
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
