/**
 * JSDoc linting utilities.
 */

import * as path from 'path';
import { runCommand, TaskResult } from './runner';

/**
 * Runs JSDoc linting for all workspaces.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to the task result
 */
export async function lintAll(rootDir: string): Promise<TaskResult> {
    console.log('\n==== Linting JSDoc documentation ====');

    const linterPath = path.join(rootDir, 'utils/jsdoc-linter/dist/index.js');
    const result = await runCommand('node', [linterPath], {
        cwd: rootDir,
        timeout: 120000 // 2 minutes
    });

    if (!result.success) {
        console.error('JSDoc linting failed');
        console.error('Re-run locally: npm run lint:jsdoc');
        if (result.stderr) {
            console.error(result.stderr);
        }
        if (result.stdout) {
            console.log(result.stdout);
        }
    } else {
        console.log('\u2705 JSDoc linting passed');
    }

    return {
        name: 'JSDoc Linting',
        success: result.success,
        error: result.success ? undefined : 'Linting failed'
    };
}

/**
 * Runs JSDoc linting for a specific workspace.
 * @param workspaceName - The name of the workspace to lint
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to the task result
 */
export async function lintWorkspace(workspaceName: string, rootDir: string): Promise<TaskResult> {
    console.log(`\n==== Linting JSDoc for ${workspaceName} ====`);

    const linterPath = path.join(rootDir, 'utils/jsdoc-linter/dist/index.js');
    const result = await runCommand('node', [linterPath, '--workspace', workspaceName], {
        cwd: rootDir,
        timeout: 60000 // 1 minute
    });

    if (!result.success) {
        console.error(`JSDoc linting failed for ${workspaceName}`);
        console.error(`Re-run locally: npm run lint:jsdoc -- --workspace "${workspaceName}"`);
        if (result.stderr) {
            console.error(result.stderr);
        }
        if (result.stdout) {
            console.log(result.stdout);
        }
    } else {
        console.log(`\u2705 JSDoc linting passed for ${workspaceName}`);
    }

    return {
        name: `JSDoc Linting (${workspaceName})`,
        success: result.success,
        error: result.success ? undefined : 'Linting failed'
    };
}
