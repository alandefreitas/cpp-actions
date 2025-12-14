/**
 * Shared scanning logic for Boost module dependency detection.
 *
 * Used by both the main action and the dependency generator script.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Map of header exceptions to their correct module names.
 */
export type ExceptionsMap = Record<string, string>;

/**
 * Set of valid submodule paths from .gitmodules.
 */
export type SubmodulePaths = Set<string>;

/**
 * Parses the boostdep exceptions.txt content to map non-standard headers to modules.
 *
 * @param content - Contents of the exceptions.txt file
 * @returns Map of header path to module name
 */
export function parseExceptions(content: string): ExceptionsMap {
    const exceptions: ExceptionsMap = {};
    let module: string | null = null;
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        const match = trimmedLine.match(/(.*):$/);
        if (match) {
            module = match[1].replace('~', '/');
        } else if (module !== null && trimmedLine) {
            exceptions[trimmedLine] = module;
        }
    }
    return exceptions;
}

/**
 * Parses the .gitmodules content to extract valid submodule paths.
 *
 * @param content - Contents of the .gitmodules file
 * @returns Set of submodule paths (e.g., "libs/algorithm")
 */
export function parseGitmodules(content: string): SubmodulePaths {
    const submodulePaths = new Set<string>();
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmedLine = line.trim();
        const match = trimmedLine.match(/path\s*=\s*(.*)$/);
        if (match) {
            submodulePaths.add(match[1]);
        }
    }
    return submodulePaths;
}

/**
 * Checks if a module name corresponds to a valid Boost submodule.
 *
 * @param moduleName - The module name to check
 * @param submodulePaths - Set of valid submodule paths from .gitmodules
 * @returns True if the module exists in the submodule paths
 */
export function isModule(moduleName: string, submodulePaths: SubmodulePaths): boolean {
    return submodulePaths.has(`libs/${moduleName}`);
}

/**
 * Maps a Boost header path to its corresponding module name.
 *
 * @param header - The header path (e.g., "boost/algorithm/string.hpp")
 * @param exceptions - Map of header exceptions to module names
 * @param submodulePaths - Set of valid submodule paths
 * @returns The module name or null if not found
 */
export function moduleForHeader(
    header: string,
    exceptions: ExceptionsMap,
    submodulePaths: SubmodulePaths
): string | null {
    if (header in exceptions) {
        return exceptions[header];
    }

    const headerRegexes = [
        // boost/function.hpp -> function
        /^boost\/([^./]*)\.h[a-z]*$/,
        // boost/numeric/conversion.hpp -> numeric/conversion
        /^boost\/([^/]*\/[^./]*)\.h[a-z]*$/,
        // boost/numeric/conversion/header.hpp -> numeric/conversion
        /^boost\/([^/]*\/[^/]*)\//,
        // boost/function/header.hpp -> function
        /^boost\/([^/]*)\//
    ];

    for (const regex of headerRegexes) {
        const match = header.match(regex);
        if (match && isModule(match[1], submodulePaths)) {
            return match[1];
        }
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
export function scanHeaderDependencies(
    fileContents: string,
    exceptions: ExceptionsMap,
    submodulePaths: SubmodulePaths
): Set<string> {
    const modules = new Set<string>();
    const lines = fileContents.split('\n');
    for (const line of lines) {
        const match = line.match(/[ \t]*#[ \t]*include[ \t]*["<](boost\/[^">]*)[">/]/);
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
export function scanSubdirectoryDependencies(
    dir: string,
    exceptions: ExceptionsMap,
    submodulePaths: SubmodulePaths
): Set<string> {
    const modules = new Set<string>();

    if (!fs.existsSync(dir)) {
        return modules;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const subdirModules = scanSubdirectoryDependencies(entryPath, exceptions, submodulePaths);
            subdirModules.forEach(module => modules.add(module));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.hpp', '.h', '.cpp', '.cc', '.cxx', '.ipp'].includes(ext)) {
                try {
                    const fileContents = fs.readFileSync(entryPath, 'utf-8');
                    const fileModules = scanHeaderDependencies(fileContents, exceptions, submodulePaths);
                    fileModules.forEach(module => modules.add(module));
                } catch {
                    // Skip files that can't be read
                }
            }
        }
    }
    return modules;
}

/**
 * Scans a single Boost module for its direct dependencies.
 *
 * @param modulePath - Path to the module directory
 * @param moduleName - Name of the module being scanned
 * @param exceptions - Exception mappings
 * @param submodulePaths - Valid submodule paths
 * @returns Set of direct dependency module names
 */
export function scanModuleDependencies(
    modulePath: string,
    moduleName: string,
    exceptions: ExceptionsMap,
    submodulePaths: SubmodulePaths
): Set<string> {
    const modules = new Set<string>();
    const dirsToScan = ['include', 'src'];

    for (const subdir of dirsToScan) {
        const subdirPath = path.join(modulePath, subdir);
        if (fs.existsSync(subdirPath)) {
            const subdirModules = scanSubdirectoryDependencies(subdirPath, exceptions, submodulePaths);
            subdirModules.forEach(module => modules.add(module));
        }
    }

    modules.delete(moduleName);
    return modules;
}
