#!/usr/bin/env node
/**
 * Fetches external data: compiler tags, ubuntu versions, and boost dependency graph.
 */

import * as path from 'path';
import { fetchAllTags } from './tags';
import { generateUbuntuVersionsJson } from './ubuntu-versions';
import { generateBoostDeps } from './boost-deps';

// Re-export runner utilities for consumers (e.g. utils/docs)
export { runCommand } from './runner';
export type { CommandResult, RunOptions } from './runner';

/**
 * Main entry point for the update-data utility.
 */
async function main(): Promise<void> {
    const rootDir = path.resolve(__dirname, '../../..');

    console.log('==== Updating external data ====');

    const tagsOk = await fetchAllTags(rootDir);
    if (!tagsOk) {
        console.error('Warning: Some tag fetches failed');
    }

    const ubuntuOk = await generateUbuntuVersionsJson(rootDir);
    if (!ubuntuOk) {
        console.error('Warning: Ubuntu versions generation failed');
    }

    const boostOk = await generateBoostDeps(rootDir);
    if (!boostOk) {
        console.error('Warning: Boost deps generation failed');
    }

    if (!tagsOk || !ubuntuOk || !boostOk) {
        process.exit(1);
    }

    console.log('\n\u2705 External data updated successfully');
}

main().catch((err) => {
    console.error('update-data failed:', err);
    process.exit(1);
});
