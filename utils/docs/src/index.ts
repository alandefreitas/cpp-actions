#!/usr/bin/env node
/**
 * Generates documentation from action YAML files and builds the Antora site.
 */

import * as path from 'path';
import { generateDocs } from './docs';

/**
 * Main entry point for the docs utility.
 */
async function main(): Promise<void> {
    const rootDir = path.resolve(__dirname, '../../..');

    const success = await generateDocs(rootDir);

    if (!success) {
        console.error('Documentation generation failed');
        process.exit(1);
    }

    console.log('\n\u2705 Documentation generated successfully');
}

main().catch((err) => {
    console.error('docs failed:', err);
    process.exit(1);
});
