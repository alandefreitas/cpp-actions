/**
 * Prepare (build) orchestration for workspaces.
 */

import { WorkspaceInfo } from './workspace';
import { runCommand, runParallel, TaskResult, printSummary } from './runner';

/**
 * Runs npm prepare for a single workspace.
 * @param workspace - The workspace to prepare
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
async function prepareWorkspace(workspace: WorkspaceInfo, rootDir: string): Promise<boolean> {
    // Use 'all' script for packages that have it (does build + esbuild bundle)
    // Fall back to 'build' script for utils packages that only need tsc
    const script = workspace.name.startsWith('utils/') ? 'build' : 'all';
    console.log(`==== Building (npm run ${script}) for ${workspace.name} ====`);

    const result = await runCommand('npm', ['run', script, '-w', workspace.name], {
        cwd: rootDir,
        timeout: 300000 // 5 minutes
    });

    if (!result.success) {
        console.error(`npm run ${script} failed for ${workspace.name}`);
        console.error(`Re-run locally: npm run ${script} -w "${workspace.name}"`);
        if (result.stderr) {
            console.error(result.stderr);
        }
    }

    return result.success;
}

/**
 * Runs npm prepare for all workspaces in parallel.
 * @param workspaces - Array of workspaces to prepare
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to array of task results
 */
export async function prepareAll(workspaces: WorkspaceInfo[], rootDir: string): Promise<TaskResult[]> {
    console.log('\n==== Preparing all workspaces ====');

    const tasks = workspaces.map(workspace => ({
        name: workspace.name,
        fn: () => prepareWorkspace(workspace, rootDir).then(success => {
            if (!success) throw new Error('Prepare failed');
        })
    }));

    const results = await runParallel(tasks);
    printSummary('Prepare Summary', results);

    return results;
}

/**
 * Runs npm prepare for a single specified workspace.
 * @param workspace - The workspace to prepare
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to the task result
 */
export async function prepareSingle(workspace: WorkspaceInfo, rootDir: string): Promise<TaskResult> {
    const success = await prepareWorkspace(workspace, rootDir);
    return {
        name: workspace.name,
        success,
        error: success ? undefined : 'Prepare failed'
    };
}
