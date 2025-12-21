/**
 * Source map loading, caching, and resolution utilities.
 *
 * @module source-map
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SourceMapConsumer, RawSourceMap } from 'source-map';

// Cache for source map consumers to avoid re-parsing
const sourceMapCache = new Map<string, SourceMapConsumer | null>();

// Cache for source file contents
const sourceContentCache = new Map<string, string | null>();

/**
 * Represents a resolved source location after source map transformation.
 */
export interface ResolvedLocation {
    file: string;
    line: number;
    column: number;
    name: string | null;
    sourceContent: string | null;
}

/**
 * Resolves a potentially relative or file URL path to an absolute path.
 *
 * @param filePath - The file path to resolve
 * @returns The resolved absolute path
 */
export function resolveFilePath(filePath: string): string {
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
export function readFileSync(filePath: string): string | null {
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
export async function loadSourceMap(filePath: string): Promise<SourceMapConsumer | null> {
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
 * Checks if a source path is from application code (not node_modules or external).
 *
 * @param source - The source path to check
 * @returns True if the source is application code
 */
export function isAppSource(source: string | null): boolean {
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
export async function resolveSourceMapLocation(
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
