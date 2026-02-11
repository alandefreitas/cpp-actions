#!/usr/bin/env node
/**
 * Action.yml generation from schemas.
 *
 * Generates action.yml files from the schema definitions in each action package,
 * ensuring they stay in sync. Run after `npm run build` since it requires compiled schemas.
 *
 * @module action-yml
 */

import * as path from 'path';
import * as fs from 'fs';
import { updateActionYml, type UpdateActionYmlResult } from 'action-schema';

/**
 * Discovers actions that have compiled schema files.
 *
 * Scans top-level directories for `lib/schema.js` (compiled from `src/schema.ts`),
 * so the list stays in sync automatically when new actions are added.
 *
 * @param rootDir - Root directory of the monorepo
 * @returns Sorted array of action directory names
 */
function discoverSchemaActions(rootDir: string): string[] {
    const skipDirs = new Set(['.git', '.github', '.issues', 'node_modules', 'common', 'utils', 'tools', 'docs']);
    const actions: string[] = [];

    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || skipDirs.has(entry.name)) {
            continue;
        }
        if (fs.existsSync(path.join(rootDir, entry.name, 'lib', 'schema.js'))) {
            actions.push(entry.name);
        }
    }

    return actions.sort();
}

/**
 * Result of generating action.yml files.
 */
export interface GenerateActionYmlsResult {
    /** Total number of actions processed */
    total: number;

    /** Number of action.yml files that were modified */
    modified: number;

    /** Number of actions skipped (no schema) */
    skipped: number;

    /** Details for each action */
    details: Array<{
        name: string;
        result?: UpdateActionYmlResult;
        error?: string;
        skipped?: boolean;
    }>;
}

/**
 * Generates action.yml files from schemas for all applicable actions.
 *
 * @param rootDir - Root directory of the monorepo
 * @param dryRun - If true, don't write changes
 * @returns Results of the generation
 */
export async function generateActionYmls(
    rootDir: string,
    dryRun = false
): Promise<GenerateActionYmlsResult> {
    console.log('==== Generating action.yml files from schemas ====');

    const results: GenerateActionYmlsResult = {
        total: 0,
        modified: 0,
        skipped: 0,
        details: []
    };

    const schemaActions = discoverSchemaActions(rootDir);

    for (const name of schemaActions) {
        results.total++;

        const actionDir = path.join(rootDir, name);
        const schemaPath = path.join(actionDir, 'lib', 'schema.js');
        const actionYmlPath = path.join(actionDir, 'action.yml');

        // Check if schema exists (compiled)
        if (!fs.existsSync(schemaPath)) {
            console.log(`  ⚠️  ${name}: No compiled schema found at ${schemaPath}`);
            results.skipped++;
            results.details.push({ name, skipped: true, error: 'No compiled schema found' });
            continue;
        }

        // Check if action.yml exists
        if (!fs.existsSync(actionYmlPath)) {
            console.log(`  ⚠️  ${name}: No action.yml found`);
            results.skipped++;
            results.details.push({ name, skipped: true, error: 'No action.yml found' });
            continue;
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const schema = require(schemaPath);

            if (!schema.inputsSchema && !schema.outputsSchema) {
                throw new Error('Schema module must export inputsSchema or outputsSchema');
            }

            const result = await updateActionYml({
                actionYmlPath,
                inputsSchema: schema.inputsSchema,
                outputsSchema: schema.outputsSchema,
                dryRun
            });

            if (result.modified) {
                results.modified++;
                console.log(`  ✏️  ${name}: Updated (${result.inputsCount} inputs, ${result.outputsCount} outputs)`);
            } else {
                console.log(`  ✓  ${name}: Up to date`);
            }

            results.details.push({ name, result });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`  ❌ ${name}: ${errorMsg}`);
            results.details.push({ name, error: errorMsg });
        }
    }

    console.log(`\nAction.yml generation: ${results.total} total, ${results.modified} modified, ${results.skipped} skipped`);

    return results;
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
    const rootDir = path.resolve(__dirname, '../../..');
    const dryRun = process.argv.includes('--dry-run');

    const results = await generateActionYmls(rootDir, dryRun);

    const errors = results.details.filter(d => d.error && !d.skipped);
    if (errors.length > 0) {
        console.error(`\n${errors.length} action(s) failed to generate.`);
        process.exit(1);
    }

    if (results.modified > 0 && !dryRun) {
        console.log(`\n${results.modified} action.yml file(s) were updated. Review changes before committing.`);
    }
}

main().catch((err) => {
    console.error('action-yml generation failed:', err);
    process.exit(1);
});
