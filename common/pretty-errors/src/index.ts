import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SourceMapConsumer, RawSourceMap } from 'source-map';
import type {
    ErrorReportOptions,
    SourceContext,
    ErrorFrame,
    ErrorPayload,
    StackTraceyFrame,
    ExtendedError
} from './types';

export type { ErrorReportOptions, SourceContext, ErrorFrame, ErrorPayload };

// Cache for source map consumers to avoid re-parsing
const sourceMapCache = new Map<string, SourceMapConsumer | null>();

// Cache for source file contents
const sourceContentCache = new Map<string, string | null>();

/**
 * Resolves a potentially relative or file URL path to an absolute path.
 *
 * @param filePath - The file path to resolve
 * @returns The resolved absolute path
 */
function resolveFilePath(filePath: string): string {
    if (filePath.startsWith('file:')) {
        try {
            return fileURLToPath(filePath);
        } catch {
            return filePath;
        }
    }
    return filePath;
}

/**
 * Reads a file synchronously, with caching.
 *
 * @param filePath - The path to the file
 * @returns The file contents or null if not readable
 */
function readFileSync(filePath: string): string | null {
    if (sourceContentCache.has(filePath)) {
        return sourceContentCache.get(filePath) || null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        sourceContentCache.set(filePath, content);
        return content;
    } catch {
        sourceContentCache.set(filePath, null);
        return null;
    }
}

/**
 * Extracts the source map URL from a file's contents.
 *
 * @param content - The file content to search
 * @returns The source map URL or null if not found
 */
function extractSourceMapUrl(content: string): string | null {
    // Look for //# sourceMappingURL=... at the end of the file
    const match = /\/\/[#@]\s*sourceMappingURL=(.+)\s*$/.exec(content);
    return match ? match[1].trim() : null;
}

/**
 * Loads a source map for a given file.
 *
 * @param filePath - The path to the generated file
 * @returns A SourceMapConsumer or null if no source map found
 */
async function loadSourceMap(filePath: string): Promise<SourceMapConsumer | null> {
    const resolvedPath = resolveFilePath(filePath);

    if (sourceMapCache.has(resolvedPath)) {
        return sourceMapCache.get(resolvedPath) || null;
    }

    try {
        const content = readFileSync(resolvedPath);
        if (!content) {
            sourceMapCache.set(resolvedPath, null);
            return null;
        }

        const sourceMapUrl = extractSourceMapUrl(content);
        if (!sourceMapUrl) {
            sourceMapCache.set(resolvedPath, null);
            return null;
        }

        let sourceMapContent: string | null = null;

        if (sourceMapUrl.startsWith('data:')) {
            // Inline source map (data URI)
            const match = /^data:application\/json;(?:charset=utf-8;)?base64,(.+)$/.exec(sourceMapUrl);
            if (match) {
                sourceMapContent = Buffer.from(match[1], 'base64').toString('utf-8');
            }
        } else {
            // External source map file
            const sourceMapPath = path.resolve(path.dirname(resolvedPath), sourceMapUrl);
            sourceMapContent = readFileSync(sourceMapPath);
        }

        if (!sourceMapContent) {
            sourceMapCache.set(resolvedPath, null);
            return null;
        }

        const rawSourceMap: RawSourceMap = JSON.parse(sourceMapContent);
        const consumer = await new SourceMapConsumer(rawSourceMap);
        sourceMapCache.set(resolvedPath, consumer);
        return consumer;
    } catch {
        sourceMapCache.set(resolvedPath, null);
        return null;
    }
}

/**
 * Represents a resolved source location after source map transformation.
 */
interface ResolvedLocation {
    file: string;
    line: number;
    column: number;
    name: string | null;
    sourceContent: string | null;
}

/**
 * Determines whether trace-commands logging is enabled via inputs/env or, if
 * available, the trace-commands helper itself. This is kept lightweight and
 * optional so pretty-errors stays usable without extra dependencies.
 *
 * @return True if trace-commands logging is enabled
 */
async function isTraceCommandsEnabled(): Promise<boolean> {
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
 * Checks if a source path is from application code (not node_modules or external).
 *
 * @param source - The source path to check
 * @returns True if the source is application code
 */
function isAppSource(source: string | null): boolean {
    if (!source) return false;
    return !source.includes('node_modules');
}

/**
 * Extracts an inline source map from source content.
 *
 * @param content - The source content to search
 * @returns The parsed source map or null if not found
 */
function extractInlineSourceMap(content: string): RawSourceMap | null {
    // Look for inline source map: //# sourceMappingURL=data:application/json;base64,...
    const match = /\/\/[#@]\s*sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(content);
    if (!match) return null;

    try {
        const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
        return JSON.parse(decoded) as RawSourceMap;
    } catch {
        return null;
    }
}

/**
 * Creates a SourceMapConsumer from an inline source map in content.
 *
 * @param content - The source content containing an inline source map
 * @returns A SourceMapConsumer or null if no inline map found
 */
async function createConsumerFromInlineMap(content: string): Promise<SourceMapConsumer | null> {
    const rawMap = extractInlineSourceMap(content);
    if (!rawMap) return null;

    try {
        return await new SourceMapConsumer(rawMap);
    } catch {
        return null;
    }
}

/**
 * Resolves a location through source maps to find the original source.
 * Follows source map chains recursively (e.g., dist → lib → src).
 * Also retrieves the source content from the source map if available.
 * Uses GREATEST_LOWER_BOUND bias to find nearest mapping when exact match fails.
 *
 * @param filePath - The generated file path
 * @param line - The line number in the generated file
 * @param column - The column number in the generated file
 * @param maxDepth - Maximum recursion depth to prevent infinite loops
 * @returns The original location with source content, or null if not resolvable
 */
async function resolveSourceMapLocation(
    filePath: string,
    line: number,
    column: number,
    maxDepth: number = 3
): Promise<ResolvedLocation | null> {
    if (maxDepth <= 0) return null;

    const consumer = await loadSourceMap(filePath);
    if (!consumer) {
        return null;
    }

    // Try exact match first
    let original = consumer.originalPositionFor({ line, column });

    // If exact match fails or points to node_modules, try with GREATEST_LOWER_BOUND bias
    if (!original.source || !isAppSource(original.source)) {
        original = consumer.originalPositionFor({
            line,
            column,
            bias: SourceMapConsumer.GREATEST_LOWER_BOUND
        });
    }

    // If still no good match, return null - we can't reliably resolve this position
    // This happens with minified bundles where V8 reports columns that fall in
    // external library code rather than the actual function location
    if (!original.source || !isAppSource(original.source)) {
        return null;
    }

    if (original.source && original.line !== null) {
        // Resolve the source path relative to the source map location
        const resolvedFilePath = resolveFilePath(filePath);
        const sourceDir = path.dirname(resolvedFilePath);
        let originalPath = original.source;

        // Get source content from the source map (embedded in sourcesContent)
        let sourceContent: string | null = null;
        try {
            sourceContent = consumer.sourceContentFor(original.source, true);
        } catch {
            // sourceContentFor may throw if source not found
        }

        // Check if the source content has an inline source map (chained source maps)
        // This happens when TypeScript compiles to JS with inlineSourceMap, then
        // ncc bundles to dist - we need to follow the chain back to TypeScript
        if (sourceContent && maxDepth > 1) {
            const inlineConsumer = await createConsumerFromInlineMap(sourceContent);
            if (inlineConsumer) {
                // Resolve through the nested source map
                const nestedOriginal = inlineConsumer.originalPositionFor({
                    line: original.line,
                    column: original.column ?? 0
                });

                if (nestedOriginal.source && nestedOriginal.line !== null) {
                    // Get the nested source content
                    let nestedSourceContent: string | null = null;
                    try {
                        nestedSourceContent = inlineConsumer.sourceContentFor(nestedOriginal.source, true);
                    } catch {
                        // Ignore
                    }

                    // Update to the nested (more original) location
                    let nestedDisplayPath = nestedOriginal.source;
                    if (nestedDisplayPath.startsWith('webpack://')) {
                        nestedDisplayPath = nestedDisplayPath.replace(/^webpack:\/\/[^/]*\//, '');
                    }
                    while (nestedDisplayPath.startsWith('../')) {
                        nestedDisplayPath = nestedDisplayPath.substring(3);
                    }

                    // Clean up the consumer
                    inlineConsumer.destroy();

                    return {
                        file: nestedDisplayPath,
                        line: nestedOriginal.line,
                        column: nestedOriginal.column ?? 0,
                        name: nestedOriginal.name ?? original.name ?? null,
                        sourceContent: nestedSourceContent
                    };
                }
                inlineConsumer.destroy();
            }
        }

        // Handle webpack:// and other protocol prefixes for display path
        let displayPath = originalPath;
        if (displayPath.startsWith('webpack://')) {
            displayPath = displayPath.replace(/^webpack:\/\/[^/]*\//, '');
        }

        // Make the display path cleaner - remove leading ../
        while (displayPath.startsWith('../')) {
            displayPath = displayPath.substring(3);
        }

        // Make the path absolute if it's relative (for file reading fallback)
        if (!path.isAbsolute(originalPath)) {
            originalPath = path.resolve(sourceDir, originalPath);
        }

        return {
            file: displayPath,
            line: original.line,
            column: original.column ?? 0,
            name: original.name ?? null,
            sourceContent
        };
    }

    return null;
}

/**
 * Parses a V8 stack trace string into structured frame information.
 *
 * @param stack - The stack trace string to parse
 * @returns Array of parsed stack frames
 */
function parseStackTrace(stack: string): StackTraceyFrame[] {
    const frames: StackTraceyFrame[] = [];
    const lines = stack.split('\n');

    // V8 stack trace format patterns:
    // "    at functionName (file:line:column)"
    // "    at file:line:column"
    // "    at functionName (native)"
    // "    at async functionName (file:line:column)"
    const frameRegex = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
    const nativeRegex = /^\s*at\s+(?:async\s+)?(.+?)\s+\(native\)$/;
    const evalRegex = /^\s*at\s+(?:async\s+)?(.+?)\s+\(<anonymous>\)$/;

    for (const line of lines) {
        // Skip non-frame lines (like "Error: message")
        if (!line.trim().startsWith('at ')) continue;

        // Check for native frames
        const nativeMatch = nativeRegex.exec(line);
        if (nativeMatch) {
            frames.push({
                callee: nativeMatch[1],
                calleeShort: nativeMatch[1].split('.').pop() || nativeMatch[1],
                native: true,
                line: 0,
                column: 0
            });
            continue;
        }

        // Check for eval/anonymous frames
        const evalMatch = evalRegex.exec(line);
        if (evalMatch) {
            frames.push({
                callee: evalMatch[1],
                calleeShort: evalMatch[1].split('.').pop() || evalMatch[1],
                line: 0,
                column: 0
            });
            continue;
        }

        // Parse standard frames
        const match = frameRegex.exec(line);
        if (match) {
            const [, callee, file, lineNum, colNum] = match;
            const parsedLine = parseInt(lineNum, 10);
            const parsedCol = parseInt(colNum, 10);

            // Determine if this is a third-party/node_modules frame
            const isThirdParty = file.includes('node_modules');
            const isNative = file.startsWith('node:');

            // Get relative file path
            let fileRelative = file;
            try {
                if (!file.startsWith('node:') && !file.startsWith('file:')) {
                    fileRelative = path.relative(process.cwd(), file);
                }
            } catch {
                // Keep original path if relative fails
            }

            frames.push({
                file,
                fileRelative,
                callee: callee || 'anonymous',
                calleeShort: callee ? (callee.split('.').pop() || callee) : 'anonymous',
                line: parsedLine,
                column: parsedCol,
                native: isNative,
                thirdParty: isThirdParty
            });
        }
    }

    return frames;
}

// ANSI color codes for terminal output
const colors = {
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
 * Extracts source context from a content string.
 *
 * @param content - The source content string
 * @param lineNumber - The line number to center context around
 * @param options - Options for number of lines before and after
 * @returns Source context
 */
function extractContextFromContent(
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
function readContextFromFile(
    filePath: string,
    lineNumber: number,
    options: ReadContextOptions = {}
): SourceContext | null {
    const content = readFileSync(filePath);
    if (!content) return null;
    return extractContextFromContent(content, lineNumber, options);
}

/**
 * Builds a structured error payload from an error for terminal rendering.
 * Resolves source maps to show original source locations.
 *
 * @param error - The error to build a payload from
 * @returns Payload containing error details and stack frames with source context
 */
async function buildErrorPayload(error: ExtendedError | null | undefined): Promise<ErrorPayload> {
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
 * Gets relative path from current working directory.
 *
 * @param filePath - Absolute file path
 * @returns Relative path or original path if relative fails
 */
function getRelativePath(filePath: string): string {
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
function renderSourceContext(context: SourceContext, lineNumber: number): string {
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
function hasValidContext(frame: ErrorFrame): boolean {
    return !!(
        frame.context &&
        frame.context.line &&
        frame.context.line.length < 500 &&
        frame.line > 1
    );
}

/**
 * Renders error frames in a simple, readable format.
 * Shows the main frame with source context, followed by a full stack trace.
 *
 * @param payload - Error payload containing processed frames
 * @returns Formatted string with stack trace and source context
 */
function renderErrorPayload(payload: ErrorPayload): string {
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
async function renderTerminal(error: ExtendedError | null | undefined): Promise<string> {
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
