/**
 * File system utilities for setup-program action.
 *
 * @module file-utils
 */

import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

/**
 * Recursively finds all subdirectories within a directory.
 *
 * @param directory - Root directory to search
 * @returns Array of absolute paths to all nested subdirectories
 */
export function getAllSubdirectories(directory: string): string[] {
    const subdirectories: string[] = [];

    function traverse(currentDir: string): void {
        const files = fs.readdirSync(currentDir);

        files.forEach(file => {
            const filePath = path.join(currentDir, file);
            const fileStat = fs.statSync(filePath);

            if (fileStat.isDirectory()) {
                subdirectories.push(filePath);
                traverse(filePath);
            }
        });
    }

    traverse(directory);
    return subdirectories;
}

/**
 * Checks if a file path is a symbolic link.
 *
 * @param filePath - Path to check
 * @returns True if the path is a symlink, false otherwise
 */
export function isSymlink(filePath: string): boolean {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isSymbolicLink();
    } catch (error) {
        traceCommands.log('An error occurred while checking if the path is a symlink:' + String(error));
        return false;
    }
}

/**
 * Copies a symbolic link to a new location.
 *
 * Recreates the symlink at the destination pointing to the same target.
 *
 * @param sourcePath - Path to the source symlink
 * @param destinationPath - Path where the symlink should be created
 * @param level - Recursion depth for logging indentation
 */
export function copySymlink(sourcePath: string, destinationPath: string, level = 0): void {
    const targetPath = fs.readlinkSync(sourcePath);
    const levelPrefix = ' '.repeat(level * 2);
    traceCommands.log(`${levelPrefix}Symlink found from ${sourcePath} to ${targetPath}`);
    fs.symlinkSync(targetPath, destinationPath);
    traceCommands.log(`${levelPrefix}Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`);
}
