/**
 * Header scanning utilities for boost-clone action.
 *
 * @module header-scan
 */

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as traceCommands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import type { Inputs } from './schema';
import { parseExceptions, parseGitmodules } from './scanning';

/**
 * Reads and parses the boostdep exceptions.txt file.
 *
 * @param exceptionsPath - Path to the exceptions.txt file
 * @returns Map of header path to module name
 * @throws Error if the file does not exist
 */
export async function readExceptions(exceptionsPath: string): Promise<Record<string, string>> {
    traceCommands.log(`readExceptions: Reading exceptions from ${exceptionsPath}`);
    try {
        await fsp.access(exceptionsPath);
    } catch {
        throw new Error(`Exceptions file not found: ${exceptionsPath}`);
    }
    const content = await fsp.readFile(exceptionsPath, 'utf-8');
    return parseExceptions(content);
}

/**
 * Reads and parses the .gitmodules file.
 *
 * @param gitmodulesPath - Path to the .gitmodules file
 * @returns Set of submodule paths (e.g., "libs/algorithm")
 * @throws Error if the file does not exist
 */
export async function readGitmodules(gitmodulesPath: string): Promise<Set<string>> {
    try {
        await fsp.access(gitmodulesPath);
    } catch {
        throw new Error(`.gitmodules file not found: ${gitmodulesPath}`);
    }
    const content = await fsp.readFile(gitmodulesPath, 'utf-8');
    return parseGitmodules(content);
}

/**
 * Downloads and parses `.gitmodules` and `exceptions.txt` from the Boost
 * repository at the given branch.
 *
 * @param branch - Boost branch or tag to fetch metadata from
 * @returns Parsed submodule paths and header-to-module exception map
 */
export async function fetchBoostMetadata(branch: string): Promise<{ submodulePaths: Set<string>; exceptions: Record<string, string> }> {
    const fnlog = traceCommands.scoped('fetchBoostMetadata');

    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${branch}/.gitmodules`;
    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${branch}/depinst/exceptions.txt`;

    const [gitmodulesPath, exceptionsPath] = await Promise.all([
        tc.downloadTool(gitmodulesUrl).then(p => path.resolve(p)),
        tc.downloadTool(exceptionsUrl).then(p => path.resolve(p))
    ]);

    core.info(`Downloaded ${gitmodulesUrl} to ${gitmodulesPath}`);
    const submodulePaths = await readGitmodules(gitmodulesPath);
    fnlog(`Submodule Paths: ${JSON.stringify([...submodulePaths])}`);

    core.info(`Downloaded ${exceptionsUrl} to ${exceptionsPath}`);
    const exceptions = await readExceptions(exceptionsPath);
    fnlog(`Exceptions: ${JSON.stringify(exceptions)}`);

    return { submodulePaths, exceptions };
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
    const fnlog = traceCommands.scoped('moduleForHeader');

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
    const fnlog = traceCommands.scoped('scanSubdirectoryDependencies');

    fnlog(`Scanning directory: ${dir}`);
    const modules = new Set<string>();
    const files = await fsp.readdir(dir);
    for (const file of files) {
        const filePath = path.resolve(path.join(dir, file));
        const stat = await fsp.stat(filePath);
        if (stat.isDirectory()) {
            fnlog(`Scanning subdir: ${filePath}`);
            const subdirModules = await scanSubdirectoryDependencies(filePath, exceptions, submodulePaths);
            subdirModules.forEach(module => modules.add(module));
        } else {
            const fileContents = await fsp.readFile(filePath, 'utf-8');
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
    traceCommands.log(`listBoostDependencies: Scanning subdirs of ${dir}`);
    const modules = new Set<string>();
    for (const subdir of subdirs) {
        const subdirPath = path.resolve(path.join(dir, subdir));
        try {
            await fsp.access(subdirPath);
        } catch {
            continue;
        }
        traceCommands.log(`listBoostDependencies: Scanning subdir: ${subdirPath} for Boost dependencies`);
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
    const ignore = inputs.scanModulesIgnore;
    const include = inputs.modulesScanPaths;
    const exclude = inputs.modulesExcludePaths;

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
