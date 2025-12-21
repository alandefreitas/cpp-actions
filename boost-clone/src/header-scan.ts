/**
 * Header scanning utilities for boost-clone action.
 *
 * @module header-scan
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { Inputs } from './types';
import { parseExceptions, parseGitmodules } from './scanning';

/**
 * Reads and parses the boostdep exceptions.txt file.
 *
 * @param exceptionsPath - Path to the exceptions.txt file
 * @returns Map of header path to module name
 * @throws Error if the file does not exist
 */
export function readExceptions(exceptionsPath: string): Record<string, string> {
    trace_commands.log(`readExceptions: Reading exceptions from ${exceptionsPath}`);
    if (!fs.existsSync(exceptionsPath)) {
        throw new Error(`Exceptions file not found: ${exceptionsPath}`);
    }
    const content = fs.readFileSync(exceptionsPath, 'utf-8');
    return parseExceptions(content);
}

/**
 * Reads and parses the .gitmodules file.
 *
 * @param gitmodulesPath - Path to the .gitmodules file
 * @returns Set of submodule paths (e.g., "libs/algorithm")
 * @throws Error if the file does not exist
 */
export function readGitmodules(gitmodulesPath: string): Set<string> {
    if (!fs.existsSync(gitmodulesPath)) {
        throw new Error(`.gitmodules file not found: ${gitmodulesPath}`);
    }
    const content = fs.readFileSync(gitmodulesPath, 'utf-8');
    return parseGitmodules(content);
}

/**
 * Checks if a module name corresponds to a valid Boost submodule.
 *
 * @param moduleName - The module name to check
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 * @returns True if the module exists in the submodule paths
 */
export function isModule(moduleName: string, submodulePaths: Set<string>): boolean {
    return submodulePaths.has(`libs/${moduleName}`);
}

const loggedHeaders = new Set<string>();

/**
 * Maps a Boost header path to its corresponding module name.
 *
 * @param header - The header path (e.g., "boost/algorithm/string.hpp")
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns The module name or null if not found
 */
export function moduleForHeader(header: string, exceptions: Record<string, string>, submodulePaths: Set<string>): string | null {
    function fnlog(msg: string): void {
        trace_commands.log(`moduleForHeader: ${msg}`);
    }

    if (header in exceptions) {
        return exceptions[header];
    }

    const headerRegexes = [
        // Something like "boost/function.hpp" -> "function"
        'boost/([^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion/header.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^/]*)/',
        // Something like "boost/function/header.hpp" -> "function"
        'boost/([^/]*)/'
    ];

    for (const regex of headerRegexes) {
        const match = header.match(regex);
        if (match && isModule(match[1], submodulePaths)) {
            return match[1];
        }
    }

    if (!loggedHeaders.has(header)) {
        fnlog(`Cannot determine module for header: ${header}`);
        loggedHeaders.add(header);
    }
    return null;
}

/**
 * Scans file contents for Boost include statements and extracts module dependencies.
 *
 * @param fileContents - The source file contents to scan
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found in the file
 */
export async function scanHeaderDependencies(fileContents: string, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    const modules = new Set<string>();
    const lines = fileContents.split('\n');
    for (const line of lines) {
        const match = line.match('[ \t]*#[ \t]*include[ \t]*["<](boost/[^">]*)[">]');
        if (match) {
            const header = match[1];
            const module = moduleForHeader(header, exceptions, submodulePaths);
            if (module) {
                modules.add(module);
            }
        }
    }
    return modules;
}

/**
 * Recursively scans a directory for Boost module dependencies.
 *
 * @param dir - Directory path to scan
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found in the directory
 */
export async function scanSubdirectoryDependencies(dir: string, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    function fnlog(msg: string): void {
        trace_commands.log(`scanSubdirectoryDependencies: ${msg}`);
    }

    fnlog(`Scanning directory: ${dir}`);
    const modules = new Set<string>();
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.resolve(path.join(dir, file));
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            fnlog(`Scanning subdir: ${filePath}`);
            const subdirModules = await scanSubdirectoryDependencies(filePath, exceptions, submodulePaths);
            subdirModules.forEach(module => modules.add(module));
        } else {
            const fileContents = fs.readFileSync(filePath, 'utf-8');
            const fileModules = await scanHeaderDependencies(fileContents, exceptions, submodulePaths);
            fileModules.forEach(module => modules.add(module));
        }
    }
    return modules;
}

/**
 * Lists Boost dependencies by scanning specified subdirectories.
 *
 * @param dir - Base directory to scan
 * @param subdirs - List of subdirectory names to scan within the base directory
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names found
 */
export async function listBoostDependencies(dir: string, subdirs: string[], exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    trace_commands.log(`listBoostDependencies: Scanning subdirs of ${dir}`);
    const modules = new Set<string>();
    for (const subdir of subdirs) {
        const subdirPath = path.resolve(path.join(dir, subdir));
        if (!fs.existsSync(subdirPath)) {
            continue;
        }
        trace_commands.log(`listBoostDependencies: Scanning subdir: ${subdirPath} for Boost dependencies`);
        const subdirModules = await scanSubdirectoryDependencies(subdirPath, exceptions, submodulePaths);
        for (const module of subdirModules) {
            modules.add(module);
        }
    }
    return modules;
}

/**
 * Scans a project directory for Boost module dependencies.
 *
 * Combines user-specified include/exclude paths with default directories
 * and filters out ignored modules.
 *
 * @param scanDir - Directory to scan for Boost dependencies
 * @param inputs - Action inputs containing scan configuration
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns Set of Boost module names required by the project
 */
export async function scanBoostDependencies(scanDir: string, inputs: Inputs, exceptions: Record<string, string>, submodulePaths: Set<string>): Promise<Set<string>> {
    const dir = scanDir;
    const ignore = inputs.scan_modules_ignore;
    const include = inputs.modules_scan_paths;
    const exclude = inputs.modules_exclude_paths;

    let subdirs = ['include', 'src', 'source', 'test', 'tests', 'example', 'examples'];
    for (const subdir of exclude) {
        if (subdirs.includes(subdir)) {
            subdirs = subdirs.filter((dir) => dir !== subdir);
        }
    }
    for (const subdir of include) {
        if (!subdirs.includes(subdir)) {
            subdirs.push(subdir);
        }
    }
    core.info(`Directories to scan: ${subdirs.join(', ')}`);

    const modules = await listBoostDependencies(dir, subdirs, exceptions, submodulePaths);
    core.info(`Scanned modules: ${gh_inputs.makeValueString(modules)}`);

    for (const ignored of ignore) {
        if (modules.has(ignored)) {
            modules.delete(ignored);
        }
    }
    modules.delete(null as unknown as string);

    return modules;
}
