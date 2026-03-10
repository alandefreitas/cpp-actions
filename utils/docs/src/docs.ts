/**
 * Documentation generation utilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runCommand } from 'update-data';

/**
 * Ensures Python dependencies are installed for docs generation.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
async function ensurePythonDeps(rootDir: string): Promise<boolean> {
    const docsDir = path.join(rootDir, 'docs');
    const pydepsDir = path.join(docsDir, '.pydeps');
    const requirementsFile = path.join(docsDir, 'requirements.txt');

    // Check if requirements.txt exists
    if (!fs.existsSync(requirementsFile)) {
        console.log('No docs/requirements.txt found, skipping Python deps check');
        return true;
    }

    // Set up PYTHONPATH
    const pythonPath = pydepsDir + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : '');

    // Check if PyYAML is available
    const checkResult = await runCommand('python3', [
        '-c',
        'import yaml'
    ], {
        cwd: rootDir,
        env: { ...process.env, PYTHONPATH: pythonPath }
    });

    if (checkResult.success) {
        console.log('\u2705 Docs Python requirements already satisfied');
        return true;
    }

    // Install deps into docs/.pydeps
    console.log('Installing docs Python requirements...');
    const installResult = await runCommand('python3', [
        '-m', 'pip', 'install',
        '--no-cache-dir', '--upgrade',
        '--target', pydepsDir,
        '-r', requirementsFile
    ], {
        cwd: rootDir,
        timeout: 120000 // 2 minutes
    });

    if (installResult.success) {
        console.log('\u2705 Installed docs Python requirements');
    } else {
        console.error('\u274C Installing docs Python requirements failed');
        console.error(installResult.stderr);
    }

    return installResult.success;
}

/**
 * Generates documentation pages from action YAML files.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
async function generatePagesFromYaml(rootDir: string): Promise<boolean> {
    const docsDir = path.join(rootDir, 'docs');
    const pydepsDir = path.join(docsDir, '.pydeps');
    const parseScript = path.join(docsDir, 'parse_actions.py');

    if (!fs.existsSync(parseScript)) {
        console.log('No docs/parse_actions.py found, skipping YAML parsing');
        return true;
    }

    console.log('Generating pages from YAML...');

    // Set up PYTHONPATH
    const pythonPath = pydepsDir + (process.env.PYTHONPATH ? ':' + process.env.PYTHONPATH : '');

    const result = await runCommand('python3', [parseScript], {
        cwd: rootDir,
        env: { ...process.env, PYTHONPATH: pythonPath },
        timeout: 120000 // 2 minutes
    });

    if (result.success) {
        console.log('\u2705 Generated pages from YAML');
    } else {
        console.error('\u274C Generating pages from YAML failed');
        console.error(result.stderr);
    }

    return result.success;
}

/**
 * Builds the Antora documentation site.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
async function buildAntoraSite(rootDir: string): Promise<boolean> {
    const docsDir = path.join(rootDir, 'docs');
    const playbookFile = path.join(docsDir, 'local-antora-playbook.yml');

    if (!fs.existsSync(playbookFile)) {
        console.log('No docs/local-antora-playbook.yml found, skipping Antora build');
        return true;
    }

    console.log('Building Antora site...');

    const result = await runCommand('npx', [
        'antora',
        '--fetch',
        '--stacktrace',
        'local-antora-playbook.yml'
    ], {
        cwd: docsDir,
        timeout: 300000 // 5 minutes
    });

    if (result.success) {
        console.log('\u2705 Antora site build succeeded');
    } else {
        console.error('\u274C Antora site build failed');
        console.error(result.stderr);
    }

    return result.success;
}

/**
 * Generates all documentation: Python deps, YAML pages, and Antora site.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if all steps succeeded
 */
export async function generateDocs(rootDir: string): Promise<boolean> {
    console.log('\n==== Regenerating documentation ====');

    const depsOk = await ensurePythonDeps(rootDir);
    if (!depsOk) return false;

    const yamlOk = await generatePagesFromYaml(rootDir);
    if (!yamlOk) return false;

    const antoraOk = await buildAntoraSite(rootDir);
    return antoraOk;
}
