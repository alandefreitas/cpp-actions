/**
 * Boost dependency data generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runCommand } from './runner';

/**
 * Generates the Boost dependency data file.
 * This calls the existing generate-deps.ts script in boost-clone.
 * @param rootDir - The root directory of the monorepo
 * @returns Promise resolving to true if successful
 */
export async function generateBoostDeps(rootDir: string): Promise<boolean> {
    console.log('\n==== Generating Boost dependency data ====');

    const generatorPath = path.join(rootDir, 'boost-clone/scripts/generate-deps.ts');

    if (!fs.existsSync(generatorPath)) {
        console.log('Warning: generate-deps.ts not found. Skipping boost-deps generation.');
        return true;
    }

    const outputPath = path.join(rootDir, 'boost-clone/boost-deps.json');

    const result = await runCommand('npx', [
        'ts-node',
        generatorPath,
        '--latest', '1',
        '--output', outputPath,
        '--skip-existing'
    ], {
        cwd: rootDir,
        timeout: 300000 // 5 minutes timeout
    });

    if (result.success) {
        console.log('boost-deps.json is up to date.');
    } else {
        console.error('Warning: Failed to update boost-deps.json');
        console.error(result.stderr);
    }

    return result.success;
}
