/**
 * Stack trace parsing utilities.
 *
 * @module stack-parser
 */

import * as path from 'path';
import type { StackTraceyFrame } from './types';

/**
 * Parses a V8 stack trace string into structured frame information.
 *
 * @param stack - The stack trace string to parse
 * @returns Array of parsed stack frames
 */
export function parseStackTrace(stack: string): StackTraceyFrame[] {
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
