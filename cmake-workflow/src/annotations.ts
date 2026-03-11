/**
 * GitHub annotation creation for cmake-workflow action.
 *
 * @module annotations
 */

import * as core from '@actions/core';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import { type Message, type ResolvedInputs } from './types';

/**
 * Fields extracted from a compiler diagnostic regex match.
 */
interface BuildMatchFields {
    /** Raw file path from regex match (may be undefined) */
    file: string | undefined;
    /** Raw line number string from regex match */
    lineStr: string | undefined;
    /** Parsed column number (undefined for MSVC) */
    column: number | undefined;
    /** Raw severity string (e.g. 'warning', 'error') */
    severity: string | undefined;
    /** Error description text */
    errorMsg: string | undefined;
    /** Compiler-specific error code (e.g. C4996, -Wdeprecated) */
    errorCode: string | undefined;
}

/**
 * Constructs a build annotation Message from parsed regex match fields.
 *
 * Resolves file paths relative to the source and reference directories,
 * capitalizes severity, and builds title/message strings with compiler info.
 *
 * @param fields - Extracted regex match fields
 * @param inputs - Workflow inputs for path resolution and compiler info
 * @param fnlog - Trace logging function
 * @returns Constructed Message object
 */
function constructBuildMessage(
    fields: BuildMatchFields,
    inputs: ResolvedInputs,
    fnlog: (msg: string) => void
): Message {
    let { file } = fields;
    fnlog(`File: ${file}`);
    if (file) {
        file = path.resolve(inputs.sourceDir, file);
        fnlog(`Absolute file: ${file}`);
        file = path.relative(inputs.refSourceDir, file);
        fnlog(`File relative to repository: ${file}`);
    }

    const lineNum = fields.lineStr ? parseInt(fields.lineStr) : undefined;
    fnlog(`Line: ${lineNum}`);
    if (lineNum) {
        fnlog(`Line (int): ${lineNum}`);
    }

    let severity = fields.severity;
    if (severity) {
        severity = severity.charAt(0).toUpperCase() + severity.slice(1);
    }

    const cxxBasename = path.basename(inputs.cxx);
    let title = `Build ${severity}`;
    if (inputs.cxx) {
        title += ` - ${cxxBasename}`;
    }

    let msg = '';
    if (inputs.cxx) {
        msg = `${cxxBasename} - ${fields.errorMsg}`;
    } else {
        msg = fields.errorMsg || '';
    }

    if (fields.errorCode) {
        title += ` - ${fields.errorCode}`;
        msg += ` (${fields.errorCode})`;
    }

    return {
        title,
        file,
        line: lineNum,
        column: fields.column,
        severity: severity || '',
        message: msg
    };
}

/**
 * Creates GitHub annotations from CMake configure output.
 *
 * Parses CMake warning and error messages and creates corresponding
 * GitHub annotations with file and line information.
 *
 * @param output - CMake configure command output
 * @param inputs - Workflow inputs for path resolution
 */
export function createCMakeConfigureAnnotations(output: string, inputs: ResolvedInputs): void {
    const fnlog = traceCommands.scoped('createCMakeConfigureAnnotations');

    // A CMake configure warning/error message looks like this regex followed
    // by optional line breaks, then more lines with the message.
    const regex = /^CMake (?:\([^)]\) )?(Warning|Error)( at ([^:]+):(\d+) \(([^)]+)\))?:(.*)/;
    let match: RegExpMatchArray | null;
    let curMessage: Message | undefined = undefined;
    const messages: Message[] = [];
    for (const line of output.split(/\r?\n/)) {
        match = line.match(regex);
        if (match) {
            fnlog(`Matched: ${match[0]}`);
            if (curMessage && curMessage.message !== '') {
                messages.push(curMessage);
            }
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file: string | undefined = match[3] || undefined;
            fnlog(`File: ${file}`);
            if (file) {
                file = path.resolve(inputs.sourceDir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.refSourceDir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            // Get line and attempt to convert to integer
            const lineNum: number | undefined = match[4] ? parseInt(match[4]) : undefined;
            fnlog(`Line: ${lineNum}`);
            if (lineNum) {
                fnlog(`Line (int): ${lineNum}`);
            }
            let title = match[5] || undefined;
            if (title) {
                title = 'CMake: ' + title.trim();
            } else {
                title = 'CMake';
            }
            curMessage = {
                title: title,
                file: file,
                line: lineNum,
                severity: match[1] || '',
                message: match[6] || ''
            };
            fnlog(`Creating message: ${JSON.stringify(curMessage)}`);
        } else if (curMessage) {
            curMessage.message += '\n' + line;
            const emptyLine = line.trim().length !== 0;
            if (emptyLine) {
                // Append after first non-empty line.
                fnlog(`Appending message: ${JSON.stringify(curMessage)}`);
                messages.push(curMessage);
                curMessage = undefined;
            }
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages);
}

/**
 * Creates GitHub annotations from CMake build output.
 *
 * Parses compiler warning and error messages (MSVC, GCC, Clang formats)
 * and creates corresponding GitHub annotations.
 *
 * @param output - CMake build command output
 * @param inputs - Workflow inputs for path resolution
 */
export function createCMakeBuildAnnotations(output: string, inputs: ResolvedInputs): void {
    const fnlog = traceCommands.scoped('createCMakeBuildAnnotations');

    // A CMake build warning/error message is actually a warning/error
    // message from the compiler
    // msvc format: <file>(<line>): (warning|error) <code>: <message>
    const msvcRegex = /^([^()]+)\((\d+)\):\s+(warning|error)\s+([^:]+):\s+(.*)$/;
    // gcc_clang_regex="^([^:]+):([[:digit:]]+):([[:digit:]]+)?: (warning|error):([^\\[]*)(\\[-W[A-Za-z0-9-]*\\])?$"
    // gcc/clang format: <file>:<line>:<column> (warning|error): <message> [\[error_code\]]
    const gccClangRegex = /^([^:]+):(\d+):(\d+)?:\s+(warning|error):\s+([^\\\[]*)\s*(\[-W[A-Za-z0-9-]+])?$/;
    let match: RegExpMatchArray | null;
    const messages: Message[] = [];
    for (const line of output.split(/\r?\n/)) {
        match = line.match(gccClangRegex);
        if (match) {
            fnlog(`Matched: ${match[0]}`);
            const column = match[3] ? parseInt(match[3]) : undefined;
            if (column) {
                fnlog(`Column: ${column}`);
                fnlog(`Column (int): ${column}`);
            }
            const curMessage = constructBuildMessage({
                file: match[1] || undefined,
                lineStr: match[2],
                column,
                severity: match[4] || undefined,
                errorMsg: match[5] || undefined,
                errorCode: match[6] || undefined
            }, inputs, fnlog);
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`);
            messages.push(curMessage);
            continue;
        }
        match = line.match(msvcRegex);
        if (match) {
            fnlog(`Matched: ${match[0]}`);
            const curMessage = constructBuildMessage({
                file: match[1] || undefined,
                lineStr: match[2],
                column: undefined,
                severity: match[3] || undefined,
                errorMsg: match[5] || undefined,
                errorCode: match[4] || undefined
            }, inputs, fnlog);
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`);
            messages.push(curMessage);
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages);
}

/**
 * Creates GitHub annotations from parsed message objects.
 *
 * @param messages - Array of parsed messages to create annotations from
 */
export function createAnnotationsFromMessage(messages: Message[]): void {
    const fnlog = traceCommands.scoped('createAnnotationsFromMessage');

    for (const message of messages) {
        fnlog(`Creating annotation: ${JSON.stringify(message)}`);
        const properties: core.AnnotationProperties = {
            title: message.title ? message.title.trim() : undefined,
            file: message.file ? message.file : undefined,
            startLine: message.line,
            endLine: message.line,
            startColumn: message.column ? message.column : 0,
            endColumn: message.column ? message.column : 0
        };
        fnlog(`Annotation properties: ${JSON.stringify(properties)}`);
        if (message.severity.toLowerCase() === 'error') {
            core.error(message.message, properties);
        } else {
            core.warning(message.message, properties);
        }
    }
}

/**
 * Creates GitHub annotations from CTest output.
 *
 * Parses Boost.Test failure messages and creates corresponding
 * GitHub annotations.
 *
 * @param output - CTest command output
 * @param inputs - Workflow inputs for path resolution
 */
export function createCMakeTestAnnotations(output: string, inputs: ResolvedInputs): void {
    const fnlog = traceCommands.scoped('createCMakeTestAnnotations');

    // A CMake test warning/error message is actually an error message
    // from whatever test framework is being used. The only supported format
    // for now is Boost.Test.
    // boost_test_regex="^#[[:digit:]]+ ([^\\(\\)]+)\\(([[:digit:]]+)\\) failed: (.*)"
    const boostTestRegex = /^#\d* ([^()]+)\((\d+)\) failed: (.*)/;
    const messages: Message[] = [];
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(boostTestRegex);
        if (match) {
            fnlog(`Matched: ${match[0]}`);
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file: string | undefined = match[1] || undefined;
            fnlog(`File: ${file}`);
            if (file) {
                file = path.resolve(inputs.sourceDir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.refSourceDir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            // Get line and attempt to convert to integer
            const lineNum: number | undefined = match[2] ? parseInt(match[2]) : undefined;
            fnlog(`Line: ${lineNum}`);
            if (lineNum) {
                fnlog(`Line (int): ${lineNum}`);
            }
            // Message
            const msg = match[3] || undefined;
            // Get column and attempt to convert to integer
            const column: number | undefined = undefined;
            const curMessage: Message = {
                title: 'Boost.Test',
                file: file,
                line: lineNum,
                column: column,
                severity: 'Error',
                message: 'Boost.Test: ' + msg
            };
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`);
            messages.push(curMessage);
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages);
}
