/**
 * Test orchestration for workspaces.
 */

import { WorkspaceInfo } from './workspace';
import { runCommand, runParallel, TaskResult, printSummary } from './runner';

/**
 * Runs tests for a single workspace using Jest.
 * @param workspace - The workspace to test
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
async function testWorkspace(workspace: WorkspaceInfo, rootDir: string): Promise<boolean> {
    console.log(`==== Testing (jest --selectProjects) for ${workspace.name} ====`);

    // Use displayName for Jest project selection (last path component for common modules)
    const result = await runCommand('npx', ['jest', '--selectProjects', workspace.displayName, '--passWithNoTests'], {
        cwd: rootDir,
        timeout: 300000 // 5 minutes
    });

    if (!result.success) {
        console.error(`jest failed for ${workspace.name}`);
        console.error(`Re-run locally: npx jest --selectProjects "${workspace.displayName}"`);
        if (result.stderr) {
            console.error(result.stderr);
        }
    }

    return result.success;
}

/**
 * Runs tests for all workspaces in parallel.
 * @param workspaces - Array of workspaces to test
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to array of task results
 */
export async function testAll(workspaces: WorkspaceInfo[], rootDir: string): Promise<TaskResult[]> {
    console.log('\n==== Testing all workspaces ====');

    const tasks = workspaces.map(workspace => ({
        name: workspace.name,
        fn: () => testWorkspace(workspace, rootDir).then(success => {
            if (!success) throw new Error('Tests failed');
        })
    }));

    const results = await runParallel(tasks);
    printSummary('Test Summary', results);

    return results;
}

/**
 * Runs tests for a single specified workspace.
 * @param workspace - The workspace to test
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to the task result
 */
export async function testSingle(workspace: WorkspaceInfo, rootDir: string): Promise<TaskResult> {
    const success = await testWorkspace(workspace, rootDir);
    return {
        name: workspace.name,
        success,
        error: success ? undefined : 'Tests failed'
    };
}
