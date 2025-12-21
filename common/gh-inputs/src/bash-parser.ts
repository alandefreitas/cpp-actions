/**
 * Bash-style argument parsing utilities.
 *
 * @module bash-parser
 */

import * as core from '@actions/core';
import type { InputOptions } from './types';

/**
 * Result of extracting an environment variable identifier from a string.
 */
interface ExtractIdentifierResult {
    i: number;
    curArg: string;
}

/**
 * Extracts and expands an environment variable identifier from a string position.
 *
 * @param i - Current position in the line
 * @param line - The line being parsed
 * @param char - Current character being processed
 * @param curArg - Current argument being built
 * @returns Updated position and argument with expanded variable
 */
function extractIdentifier(
    i: number,
    line: string,
    char: string,
    curArg: string
): ExtractIdentifierResult {
    const nextChar = i < line.length - 1 ? line[i + 1] : undefined;
    if (nextChar && /^[a-zA-Z_]/.test(nextChar)) {
        let identifier = nextChar;
        let j = i + 2;
        for (; j < line.length; j++) {
            const idChar = line[j];
            if (/^[a-zA-Z0-9_]/.test(idChar)) {
                identifier += idChar;
            } else {
                break;
            }
        }
        const envValue = process.env[identifier];
        if (envValue) {
            curArg += envValue;
        }
        i = j - 1;
    } else {
        curArg += char;
    }
    return { i, curArg };
}

/**
 * Parses a bash-style argument string into an array of individual arguments.
 *
 * Handles:
 * - Single and double quoted strings (preserving spaces within)
 * - Escaped characters with backslash
 * - Environment variable expansion ($VAR syntax)
 * - Proper quote nesting rules (single quotes are literal, double quotes allow escapes)
 *
 * @param extra_args - A string or array of strings containing bash-style arguments
 * @returns Array of parsed individual arguments
 */
export function parseBashArguments(extra_args: string | string[]): string[] {
    const argsArray = Array.isArray(extra_args) ? extra_args : [extra_args];

    const args: string[] = [];
    for (const line of argsArray) {
        let curQuote: string | undefined = undefined;
        let curArg = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const inQuote = curQuote !== undefined;
            const curIsQuote = ['"', "'"].includes(char);
            const curIsEscaped = i > 0 && line[i - 1] === '\\';

            if (!inQuote) {
                if (!curIsEscaped) {
                    if (curIsQuote) {
                        curQuote = char;
                    } else if (char === ' ') {
                        if (curArg !== '') {
                            args.push(curArg);
                            curArg = '';
                        }
                    } else if (char === '$') {
                        const result = extractIdentifier(i, line, char, curArg);
                        i = result.i;
                        curArg = result.curArg;
                    } else if (char !== '\\') {
                        curArg += char;
                    }
                } else {
                    curArg += char;
                }
            } else if (curQuote === '"') {
                if (!curIsEscaped) {
                    if (char === curQuote) {
                        curQuote = undefined;
                    } else if (char === '$') {
                        const result = extractIdentifier(i, line, char, curArg);
                        i = result.i;
                        curArg = result.curArg;
                    } else if (char !== '\\') {
                        curArg += char;
                    }
                } else {
                    if (!['$', '`', '"', '\\'].includes(char)) {
                        curArg += '\\';
                    }
                    curArg += char;
                }
            } else if (curQuote === "'") {
                if (char !== curQuote) {
                    curArg += char;
                } else {
                    curQuote = undefined;
                }
            }
        }

        if (curArg !== '') {
            args.push(curArg);
        }
    }
    return args;
}

/**
 * Retrieves a multiline GitHub Actions input and parses it as bash-style arguments.
 *
 * Combines getMultilineInput with parseBashArguments to retrieve and parse
 * command-line style arguments from a GitHub Actions input.
 *
 * @param name - The input name or array of name aliases to retrieve
 * @param options - Configuration options for input retrieval
 * @returns Array of parsed individual arguments
 */
export function getBashArguments(name: string | string[], options: InputOptions = {}): string[] {
    return parseBashArguments(core.getMultilineInput(Array.isArray(name) ? name[0] : name, options));
}
