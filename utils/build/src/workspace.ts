/**
 * Workspace discovery and management utilities.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Information about a discovered workspace.
 */
export interface WorkspaceInfo {
    /** Workspace name (directory name or path for common modules) */
    name: string;
    /** Full path to the workspace directory */
    path: string;
    /** Whether the workspace has a package.json */
    hasPackageJson: boolean;
    /** Whether the workspace has an action.yml (composite action) */
    hasActionYml: boolean;
    /** Display name for Jest (last path component for common modules) */
    displayName: string;
}

/**
 * Discovers all workspaces in the monorepo.
 * @param rootDir - The root directory of the monorepo
 * @returns Array of discovered workspace information
 */
export function discoverWorkspaces(rootDir: string): WorkspaceInfo[] {
    const workspaces: WorkspaceInfo[] = [];

    // Check root-level directories
    const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of rootEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === 'docs' || entry.name.startsWith('.')) continue;

        const dirPath = path.join(rootDir, entry.name);
        const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));
        const hasActionYml = fs.existsSync(path.join(dirPath, 'action.yml'));

        if (hasPackageJson || hasActionYml) {
            workspaces.push({
                name: entry.name,
                path: dirPath,
                hasPackageJson,
                hasActionYml,
                displayName: entry.name
            });
        }
    }

    // Check common/ directory for shared libraries
    const commonDir = path.join(rootDir, 'common');
    if (fs.existsSync(commonDir)) {
        const commonEntries = fs.readdirSync(commonDir, { withFileTypes: true });
        for (const entry of commonEntries) {
            if (!entry.isDirectory()) continue;

            const dirPath = path.join(commonDir, entry.name);
            const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));

            if (hasPackageJson) {
                workspaces.push({
                    name: `common/${entry.name}`,
                    path: dirPath,
                    hasPackageJson,
                    hasActionYml: false,
                    displayName: entry.name
                });
            }
        }
    }

    // Check utils/ directory for internal utilities
    const utilsDir = path.join(rootDir, 'utils');
    if (fs.existsSync(utilsDir)) {
        const utilsEntries = fs.readdirSync(utilsDir, { withFileTypes: true });
        for (const entry of utilsEntries) {
            if (!entry.isDirectory()) continue;

            const dirPath = path.join(utilsDir, entry.name);
            const hasPackageJson = fs.existsSync(path.join(dirPath, 'package.json'));

            if (hasPackageJson) {
                workspaces.push({
                    name: `utils/${entry.name}`,
                    path: dirPath,
                    hasPackageJson,
                    hasActionYml: false,
                    displayName: entry.name
                });
            }
        }
    }

    return workspaces;
}

/**
 * Filters workspaces to only those with package.json files.
 * @param workspaces - Array of workspace information
 * @returns Filtered array containing only workspaces with package.json
 */
export function filterPackageWorkspaces(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
    return workspaces.filter(w => w.hasPackageJson);
}

/**
 * Filters workspaces to only composite actions (action.yml without package.json).
 * @param workspaces - Array of workspace information
 * @returns Filtered array containing only composite actions
 */
export function filterCompositeActions(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
    return workspaces.filter(w => w.hasActionYml && !w.hasPackageJson);
}

/**
 * Finds a specific workspace by name.
 * @param workspaces - Array of workspace information
 * @param name - The workspace name to find
 * @returns The matching workspace or undefined
 */
export function findWorkspace(workspaces: WorkspaceInfo[], name: string): WorkspaceInfo | undefined {
    return workspaces.find(w => w.name === name || w.displayName === name);
}
