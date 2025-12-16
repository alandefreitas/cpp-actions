#!/usr/bin/env node
/**
 * Build CLI - Build orchestration for cpp-actions monorepo.
 *
 * This utility replaces the legacy build.sh and build-utils.sh scripts,
 * providing cross-platform TypeScript-based build orchestration.
 */

import * as path from 'path';
import { parseArgs, printHelp } from './cli';
import { discoverWorkspaces, filterPackageWorkspaces, filterCompositeActions, findWorkspace } from './workspace';
import { fetchAllTags } from './tags';
import { generateUbuntuVersionsJson } from './ubuntu-versions';
import { generateBoostDeps } from './boost-deps';
import { prepareAll, prepareSingle } from './prepare';
import { testAll, testSingle } from './test';
import { lintAll, lintWorkspace } from './lint';
import { generateDocs } from './docs';
import { runCommand, TaskResult, printSummary } from './runner';

/**
 * Main entry point for the build CLI.
 */
async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    // Determine root directory (two levels up from dist/index.js)
    const rootDir = path.resolve(__dirname, '../../..');

    // Discover workspaces
    const allWorkspaces = discoverWorkspaces(rootDir);
    const packageWorkspaces = filterPackageWorkspaces(allWorkspaces);
    const compositeActions = filterCompositeActions(allWorkspaces);

    // Track overall success
    let hasFailures = false;
    const allResults: TaskResult[] = [];

    // Handle single workspace build
    if (args.workspace) {
        const workspace = findWorkspace(packageWorkspaces, args.workspace);
        if (!workspace) {
            console.error(`Workspace "${args.workspace}" not found or does not have a package.json`);
            console.error('Available workspaces:');
            for (const ws of packageWorkspaces) {
                console.error(`  - ${ws.name}`);
            }
            process.exit(1);
        }

        console.log(`Building specified workspace: ${workspace.name}`);

        // Prepare
        const prepareResult = await prepareSingle(workspace, rootDir);
        allResults.push(prepareResult);
        if (!prepareResult.success) {
            printSummary('Build Summary', allResults);
            process.exit(1);
        }

        // Test
        const testResult = await testSingle(workspace, rootDir);
        allResults.push(testResult);
        if (!testResult.success) {
            printSummary('Build Summary', allResults);
            process.exit(1);
        }

        // Lint (workspace-specific)
        const lintResult = await lintWorkspace(workspace.name, rootDir);
        allResults.push(lintResult);
        if (!lintResult.success) {
            printSummary('Build Summary', allResults);
            process.exit(1);
        }

        printSummary('Build Summary', allResults);
        console.log(`\n\u2705 Build completed successfully for ${workspace.name}`);
        process.exit(0);
    }

    // Full build or specific steps
    const runAll = args.all;

    // Show composite actions
    if (runAll) {
        console.log('==== Composite actions ====');
        if (compositeActions.length > 0) {
            for (const action of compositeActions) {
                console.log(action.name);
            }
        } else {
            console.log('(none)');
        }
    }

    // Step 1: Fetch remote tags
    if (runAll || args.fetchTags) {
        const tagsOk = await fetchAllTags(rootDir);
        if (!tagsOk) {
            console.error('Warning: Some tag fetches failed');
        }

        // Generate Ubuntu versions JSON
        const ubuntuOk = await generateUbuntuVersionsJson(rootDir);
        if (!ubuntuOk) {
            console.error('Warning: Ubuntu versions generation failed');
        }
    }

    // Step 2: Install dependencies (only for full build)
    if (runAll) {
        console.log('\n==== Installing dependencies (npm workspaces) ====');
        const installResult = await runCommand('npm', ['install'], {
            cwd: rootDir,
            inheritStdio: true,
            timeout: 300000 // 5 minutes
        });
        if (!installResult.success) {
            console.error('npm install failed');
            process.exit(1);
        }
    }

    // Step 3: Prepare all workspaces
    if (runAll || args.prepare) {
        const prepareResults = await prepareAll(packageWorkspaces, rootDir);
        allResults.push(...prepareResults);

        if (prepareResults.some(r => !r.success)) {
            hasFailures = true;
            if (runAll) {
                console.error('One or more projects failed during prepare. Tests skipped.');
                printSummary('Build Summary', allResults);
                process.exit(1);
            }
        }
    }

    // Step 4: Generate Boost deps (only for full build, after prepare)
    if (runAll) {
        await generateBoostDeps(rootDir);
    }

    // Step 5: Run tests
    if (runAll || args.test) {
        const testResults = await testAll(packageWorkspaces, rootDir);
        allResults.push(...testResults);

        if (testResults.some(r => !r.success)) {
            hasFailures = true;
            if (runAll) {
                console.error('One or more projects failed during tests.');
                printSummary('Build Summary', allResults);
                process.exit(1);
            }
        }
    }

    // Step 6: Run JSDoc linting
    if (runAll || args.lint) {
        const lintResult = await lintAll(rootDir);
        allResults.push(lintResult);

        if (!lintResult.success) {
            hasFailures = true;
            if (runAll) {
                console.error('JSDoc linting failed. Fix documentation before proceeding.');
                printSummary('Build Summary', allResults);
                process.exit(1);
            }
        }
    }

    // Step 7: Generate documentation
    if (runAll || args.docs) {
        const docsResult = await generateDocs(rootDir);
        allResults.push(docsResult);

        if (!docsResult.success) {
            hasFailures = true;
        }
    }

    // Print final summary
    if (allResults.length > 0) {
        printSummary('Build Summary', allResults);
    }

    if (hasFailures) {
        process.exit(1);
    }

    console.log('\n\u2705 Build completed successfully');
}

main().catch((err) => {
    console.error('Build failed with error:', err);
    process.exit(1);
});
