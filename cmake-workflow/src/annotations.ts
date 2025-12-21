/**
 * GitHub annotation creation for cmake-workflow action.
 *
 * @module annotations
 */

import * as core from '@actions/core';
import * as path from 'path';
import * as trace_commands from 'trace-commands';

import { Message, ResolvedInputs } from './types';

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
    function fnlog(msg: string): void {
        trace_commands.log('createCMakeConfigureAnnotations: ' + msg);
    }

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
                file = path.resolve(inputs.source_dir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.ref_source_dir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            // Get line and attempt to convert to integer
            let lineNum: number | undefined = match[4] ? parseInt(match[4]) : undefined;
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
    function fnlog(msg: string): void {
        trace_commands.log('createCMakeBuildAnnotations: ' + msg);
    }

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
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file: string | undefined = match[1] || undefined;
            fnlog(`File: ${file}`);
            if (file) {
                file = path.resolve(inputs.source_dir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.ref_source_dir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            // Get line and attempt to convert to integer
            let lineNum: number | undefined = match[2] ? parseInt(match[2]) : undefined;
            fnlog(`Line: ${lineNum}`);
            if (lineNum) {
                fnlog(`Line (int): ${lineNum}`);
            }
            // Get column and attempt to convert to integer
            let column: number | undefined = match[3] ? parseInt(match[3]) : undefined;
            fnlog(`Column: ${column}`);
            if (column) {
                fnlog(`Column (int): ${column}`);
            }
            // Capitalized severity
            let severity: string | undefined = match[4] || undefined;
            if (severity) {
                severity = severity.charAt(0).toUpperCase() + severity.slice(1);
            }
            const cxx_basename = path.basename(inputs.cxx);
            let title = `Build ${severity}`;
            if (inputs.cxx) {
                title += ` - ${cxx_basename}`;
            }
            const error_msg = match[5] || undefined;
            let msg = '';
            if (inputs.cxx) {
                msg = `${cxx_basename} - ${error_msg}`;
            } else {
                msg = error_msg || '';
            }
            const error_code = match[6] || undefined;
            if (error_code) {
                title += ` - ${error_code}`;
                msg += ` (${error_code})`;
            }
            const curMessage: Message = {
                title: title,
                file: file,
                line: lineNum,
                column: column,
                severity: severity || '',
                message: msg
            };
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`);
            messages.push(curMessage);
            continue;
        }
        match = line.match(msvcRegex);
        if (match) {
            fnlog(`Matched: ${match[0]}`);
            let file: string | undefined = match[1] || undefined;
            fnlog(`File: ${file}`);
            if (file) {
                file = path.resolve(inputs.source_dir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.ref_source_dir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            let lineNum: number | undefined = match[2] ? parseInt(match[2]) : undefined;
            fnlog(`Line: ${lineNum}`);
            if (lineNum) {
                fnlog(`Line (int): ${lineNum}`);
            }
            const column: number | undefined = undefined;
            let severity: string | undefined = match[3] || undefined;
            if (severity) {
                severity = severity.charAt(0).toUpperCase() + severity.slice(1);
            }
            const error_code = match[4] || undefined;
            const error_message = match[5] || undefined;
            const cxx_basename = path.basename(inputs.cxx);
            let title = `Build ${severity}`;
            if (inputs.cxx) {
                title += ` - ${cxx_basename}`;
            }
            let msg = '';
            if (inputs.cxx) {
                msg = `${cxx_basename} - ${error_message}`;
            } else {
                msg = error_message || '';
            }
            if (error_code) {
                title += ` - ${error_code}`;
                msg += ` (${error_code})`;
            }
            const curMessage: Message = {
                title: title,
                file: file,
                line: lineNum,
                column: column,
                severity: severity || '',
                message: msg
            };
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
    function fnlog(msg: string): void {
        trace_commands.log('createAnnotationsFromMessage: ' + msg);
    }

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
    function fnlog(msg: string): void {
        trace_commands.log('createCMakeTestAnnotations: ' + msg);
    }

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
                file = path.resolve(inputs.source_dir, file);
                fnlog(`Absolute file: ${file}`);
                file = path.relative(inputs.ref_source_dir, file);
                fnlog(`File relative to repository: ${file}`);
            }
            // Get line and attempt to convert to integer
            let lineNum: number | undefined = match[2] ? parseInt(match[2]) : undefined;
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
