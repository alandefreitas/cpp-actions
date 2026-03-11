/**
 * Trace file discovery and loading for flamegraph action.
 *
 * @module trace-files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { type Trace, type CompileCommand } from './types';

/**
 * Creates a README file explaining the time-trace artifact contents.
 *
 * @param readmePath - Path where the README file should be created
 */
export async function createReadmeFile(readmePath: string): Promise<void> {
    let content = `# Time-Trace reports\n\n`;
    content += `## time-trace-report.md\n\n`;
    content += `This file includes the report also included in your action summary.\n\n`;
    content += `## combined-traces.json.svg\n\n`;
    content += 'This is an interactive graphical representation of the time-traces generated with https://github.com/brendangregg/FlameGraph).\n\n';
    content += 'You can open this file directly in the browser to navigate the results.\n\n';
    content += '## combined-traces.json\n\n';
    content += 'This file includes the combined time-trace files in a single file you can open with https://www.speedscope.app/ or chrome://tracing/.\n\n';
    fs.mkdirSync(path.dirname(readmePath), { recursive: true });
    fs.writeFileSync(readmePath, content);
}

/**
 * Recursively finds all time-trace JSON files in a directory.
 *
 * @param dir - Directory to search
 * @returns Set of absolute paths to trace files
 */
export async function findTraceFiles(dir: string): Promise<Set<string>> {
    const traceFiles = new Set<string>();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const isDir = fs.statSync(filePath).isDirectory();
        if (isDir) {
            const subTraceFiles = await findTraceFiles(filePath);
            for (const subTraceFile of subTraceFiles) {
                traceFiles.add(subTraceFile);
            }
        } else {
            const isTraceFile = file.endsWith('.cpp.json');
            if (!isTraceFile) {
                continue;
            }
            const relativeObjectFile = file.slice(0, -9) + '.cpp.o';
            const objectFile = path.join(dir, relativeObjectFile);
            const objectFileExists = fs.existsSync(objectFile);
            if (isTraceFile && objectFileExists) {
                traceFiles.add(filePath);
            }
        }
    }
    return traceFiles;
}

/**
 * Opens and parses multiple trace files into memory.
 *
 * @param traceFiles - Set of trace file paths to open
 * @returns Record mapping file paths to parsed trace data
 */
export async function openTraceFiles(traceFiles: Set<string>): Promise<Record<string, Trace>> {
    const traces: Record<string, Trace> = {};
    for (const traceFile of traceFiles) {
        const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
        traces[traceFile] = trace;
    }
    return traces;
}

/**
 * Searches for compile_commands.json starting from a directory and moving up.
 *
 * @param dir - Starting directory for the search
 * @returns Path to compile_commands.json or undefined if not found
 */
export async function findCompileCommands(dir: string): Promise<string | undefined> {
    let currentDir = path.resolve(dir);
    while (currentDir !== path.sep) {
        const compileCommandsPath = path.join(currentDir, 'compile_commands.json');
        if (fs.existsSync(compileCommandsPath)) {
            return compileCommandsPath;
        }
        currentDir = path.dirname(currentDir);
    }
    return undefined;
}

/**
 * Loads compile_commands.json from the build directory.
 *
 * @param dir - Directory to search for compile_commands.json
 * @returns Array of compile command entries
 */
export async function loadCompileCommands(dir: string): Promise<CompileCommand[]> {
    const compileCommandsPath = await findCompileCommands(dir);
    if (compileCommandsPath === undefined) {
        return [];
    } else {
        return JSON.parse(fs.readFileSync(compileCommandsPath, 'utf8'));
    }
}

/**
 * Extracts include paths from a compile command string.
 *
 * @param compileCommand - The compile command string
 * @returns Set of include paths found in the command
 */
export async function extractIncludePaths(compileCommand: string): Promise<Set<string>> {
    const includePaths = new Set<string>();
    const isystemRegex = /-isystem\s+(\S+)/g;
    let matches;
    while ((matches = isystemRegex.exec(compileCommand)) !== null) {
        includePaths.add(matches[1]);
    }
    const iOptionRegex = /-I\s*(\S+)/g;
    while ((matches = iOptionRegex.exec(compileCommand)) !== null) {
        includePaths.add(matches[1]);
    }
    return includePaths;
}

/**
 * Loads all include paths from compile commands and system defaults.
 *
 * @param compileCommands - Array of compile command entries
 * @returns Set of all include paths
 */
export async function loadIncludePaths(compileCommands: CompileCommand[]): Promise<Set<string>> {
    const includePaths = new Set<string>();
    for (const compileCommand of compileCommands) {
        const commandIncludes = await extractIncludePaths(compileCommand.command);
        for (const commandInclude of commandIncludes) {
            includePaths.add(commandInclude);
        }
    }
    const PATH = process.env.PATH;
    if (PATH) {
        const PATHIncludes = PATH.split(os.platform() === 'win32' ? ';' : ':');
        for (const PATHInclude of PATHIncludes) {
            includePaths.add(PATHInclude);
        }
    }
    includePaths.add('/usr/include');
    includePaths.add('/usr/local/include');
    includePaths.add('/usr/include/c++');
    includePaths.add('/usr/lib');
    return includePaths;
}
