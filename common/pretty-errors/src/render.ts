/**
 * Error rendering utilities for terminal output.
 *
 * @module render
 */

import * as core from '@actions/core';
import * as path from 'path';
import type {
    SourceContext,
    ErrorFrame,
    ErrorPayload,
    StackTraceyFrame,
    ExtendedError
} from './types';
import { parseStackTrace } from './stack-parser';
import {
    resolveFilePath,
    readFileSync,
    resolveSourceMapLocation
} from './source-map';

/**
 * ANSI color codes for terminal output.
 */
export const colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    // Bright yellow stays legible on GitHub Actions' light log background
    yellow: '\x1b[93m',
    cyan: '\x1b[36m',
    green: '\x1b[32m'
};

/**
 * Options for reading source context around a stack frame.
 */
interface ReadContextOptions {
    pre?: number;
    post?: number;
}

/**
 * Determines whether trace-commands logging is enabled via inputs/env or, if
 * available, the trace-commands helper itself. This is kept lightweight and
 * optional so pretty-errors stays usable without extra dependencies.
 *
 * @returns True if trace-commands logging is enabled
 */
export async function isTraceCommandsEnabled(): Promise<boolean> {
    // ACTIONS_STEP_DEBUG is set by GitHub when step debugging is on
    const stepDebug = (process.env.ACTIONS_STEP_DEBUG || '').toLowerCase() === 'true';

    // INPUT_TRACE_COMMANDS comes from the action input
    let inputTrace = false;
    try {
        if (typeof (core as unknown as { getInput?: (name: string) => string }).getInput === 'function') {
            const val = (core as unknown as { getInput: (name: string) => string }).getInput('trace-commands');
            inputTrace = (val || '').toLowerCase() === 'true';
        }
    } catch {
        inputTrace = false;
    }

    // Optional: consult trace-commands helper if present
    let helperTrace = false;
    try {
        // Dynamic import to avoid hard dependency
        const mod = await import('trace-commands');
        const fn = (mod as unknown as { isTraceCommandsEnabled?: () => boolean }).isTraceCommandsEnabled;
        if (typeof fn === 'function') {
            helperTrace = !!fn();
        }
    } catch {
        helperTrace = false;
    }

    return stepDebug || inputTrace || helperTrace;
}

/**
 * Extracts source context from a content string.
 *
 * @param content - The source content string
 * @param lineNumber - The line number to center context around
 * @param options - Options for number of lines before and after
 * @returns Source context
 */
export function extractContextFromContent(
    content: string,
    lineNumber: number,
    options: ReadContextOptions = {}
): SourceContext {
    const { pre = 5, post = 5 } = options;
    const lines = content.split(/\r?\n/);
    return {
        pre: lines.slice(Math.max(0, lineNumber - (pre + 1)), lineNumber - 1),
        line: lines[lineNumber - 1] || '',
        post: lines.slice(lineNumber, lineNumber + post)
    };
}

/**
 * Reads source code context around a specific line in a file.
 *
 * @param filePath - The file to read from
 * @param lineNumber - The line number to center context around
 * @param options - Options for number of lines before and after
 * @returns Source context or null if file cannot be read
 */
export function readContextFromFile(
    filePath: string,
    lineNumber: number,
    options: ReadContextOptions = {}
): SourceContext | null {
    const content = readFileSync(filePath);
    if (!content) return null;
    return extractContextFromContent(content, lineNumber, options);
}

/**
 * Gets relative path from current working directory.
 *
 * @param filePath - Absolute file path
 * @returns Relative path or original path if relative fails
 */
export function getRelativePath(filePath: string): string {
    try {
        return path.relative(process.cwd(), filePath);
    } catch {
        return filePath;
    }
}

/**
 * Renders source context lines with line numbers.
 *
 * @param context - Source context containing pre, line, and post lines
 * @param lineNumber - The line number of the error line
 * @returns Formatted string with source code context
 */
export function renderSourceContext(context: SourceContext, lineNumber: number): string {
    const lines: string[] = [];
    const startLine = lineNumber - context.pre.length;

    // Render lines before the error
    context.pre.forEach((line, idx) => {
        const num = String(startLine + idx).padStart(4, ' ');
        lines.push(`${colors.dim}  ${num} │ ${line}${colors.reset}`);
    });

    // Render the error line (highlighted)
    const errorNum = String(lineNumber).padStart(4, ' ');
    lines.push(`${colors.red}❯ ${errorNum} │ ${context.line}${colors.reset}`);

    // Render lines after the error
    context.post.forEach((line, idx) => {
        const num = String(lineNumber + 1 + idx).padStart(4, ' ');
        lines.push(`${colors.dim}  ${num} │ ${line}${colors.reset}`);
    });

    return lines.join('\n');
}

/**
 * Checks if a frame has valid (non-minified) source context.
 *
 * @param frame - The frame to check
 * @returns True if the frame has valid source context
 */
export function hasValidContext(frame: ErrorFrame): boolean {
    return !!(
        frame.context &&
        frame.context.line &&
        frame.context.line.length < 500 &&
        frame.line > 1
    );
}

/**
 * Builds a structured error payload from an error for terminal rendering.
 * Resolves source maps to show original source locations.
 *
 * @param error - The error to build a payload from
 * @returns Payload containing error details and stack frames with source context
 */
export async function buildErrorPayload(error: ExtendedError | null | undefined): Promise<ErrorPayload> {
    const stackFrames = parseStackTrace(error?.stack || '');
    const frames: ErrorFrame[] = await Promise.all(
        stackFrames
            .filter((frame: StackTraceyFrame) => frame.file)
            .map(async (frame: StackTraceyFrame): Promise<ErrorFrame> => {
                let filePath = frame.file || '';
                let line = frame.line;
                let column = frame.column;
                let callee = frame.callee || 'anonymous';
                let sourceContent: string | null = null;

                // Try to resolve through source maps
                const resolved = await resolveSourceMapLocation(filePath, line, column);
                if (resolved) {
                    filePath = resolved.file;
                    line = resolved.line;
                    column = resolved.column;
                    sourceContent = resolved.sourceContent;
                    if (resolved.name) {
                        callee = resolved.name;
                    }
                }

                // Get context: prefer embedded source content, fall back to file
                let context: SourceContext | null = null;
                if (sourceContent) {
                    // Use embedded source content from source map
                    context = extractContextFromContent(sourceContent, line);
                } else {
                    // Fall back to reading from disk
                    const resolvedFilePath = resolveFilePath(filePath);
                    context = readContextFromFile(resolvedFilePath, line);
                }

                // Determine frame type based on path
                const isThirdParty = filePath.includes('node_modules');
                const isNative = filePath.startsWith('node:') || !!frame.native;

                return {
                    file: filePath,
                    filePath: filePath,
                    line,
                    column,
                    callee,
                    calleeShort: callee.split('.').pop() || callee,
                    context: context || { pre: [], line: '', post: [] },
                    isModule: isThirdParty,
                    isNative: isNative,
                    isApp: !isNative && !isThirdParty
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
 * Renders error frames in a simple, readable format.
 * Shows the main frame with source context, followed by a full stack trace.
 *
 * @param payload - Error payload containing processed frames
 * @returns Formatted string with stack trace and source context
 */
export function renderErrorPayload(payload: ErrorPayload): string {
    const lines: string[] = [];
    const { error } = payload;

    // Show full stack trace, attaching context to each frame when available.
    const appFrames = error.frames.filter((f) => !f.isNative);
    if (appFrames.length > 0) {
        lines.push('');
        lines.push(`${colors.dim}Stack trace:${colors.reset}`);

        for (const frame of appFrames) {
            const relativePath = getRelativePath(frame.filePath || frame.file);
            const location = `${relativePath}:${frame.line}:${frame.column}`;
            const ctxAvailable = hasValidContext(frame);

            if (frame.isApp) {
                // App frames in cyan
                lines.push(`${colors.cyan}  at ${frame.callee}${colors.reset}`);
                lines.push(`${colors.dim}     ${location}${colors.reset}`);
                if (ctxAvailable) {
                    lines.push('');
                    lines.push(renderSourceContext(frame.context, frame.line));
                }
            } else {
                // Module/third-party frames dimmed
                lines.push(`${colors.dim}  at ${frame.callee}${colors.reset}`);
                lines.push(`${colors.dim}     ${location}${colors.reset}`);
            }

            lines.push(''); // spacer between frames
        }
    }

    return lines.join('\n');
}

/**
 * Renders an error to a colorized terminal-friendly string.
 *
 * @param error - The error to render
 * @returns Formatted string with stack trace and source context
 */
export async function renderTerminal(error: ExtendedError | null | undefined): Promise<string> {
    if (!error) {
        return '<no error>';
    }

    try {
        const payload = await buildErrorPayload(error);
        return renderErrorPayload(payload);
    } catch (renderErr) {
        const fallbackStack = error.stack || String(error);
        const message = renderErr instanceof Error ? renderErr.message : String(renderErr);
        return `Pretty renderer failed: ${message}\n${fallbackStack}`;
    }
}
