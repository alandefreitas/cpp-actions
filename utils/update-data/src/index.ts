#!/usr/bin/env node
/**
 * Fetches external data: compiler tags, ubuntu versions, and boost dependency graph.
 */

import * as path from 'path';
import { fetchAllTags } from './tags';
import { generateUbuntuVersionsJson } from './ubuntu-versions';
import { generateBoostDeps } from './boost-deps';
import { updateUbuntuCompilerDefaults } from './ubuntu-compiler-defaults';
import { updateMacOSXcodeDefaults } from './macos-xcode-defaults';
import { updateWindowsMsvcDefaults } from './windows-msvc-defaults';
import { updateRunnerImages } from './runner-images';

// Re-export runner utilities for consumers (e.g. utils/docs)
export { runCommand } from './runner';
export type { CommandResult, RunOptions } from './runner';

/**
 * Main entry point for the update-data utility.
 */
async function main(): Promise<void> {
    const rootDir = path.resolve(__dirname, '../../..');

    console.log('==== Updating external data ====');

    const runnerImagesOk = await updateRunnerImages(rootDir);
    if (!runnerImagesOk) {
        console.error('Warning: Runner images discovery failed');
    }

    const tagsOk = await fetchAllTags(rootDir);
    if (!tagsOk) {
        console.error('Warning: Some tag fetches failed');
    }

    const ubuntuOk = await generateUbuntuVersionsJson(rootDir);
    if (!ubuntuOk) {
        console.error('Warning: Ubuntu versions generation failed');
    }

    const compilerDefaultsOk = await updateUbuntuCompilerDefaults(rootDir);
    if (!compilerDefaultsOk) {
        console.error('Warning: Ubuntu compiler defaults generation failed');
    }

    const macosOk = await updateMacOSXcodeDefaults(rootDir);
    if (!macosOk) {
        console.error('Warning: macOS Xcode defaults generation failed');
    }

    const msvcOk = await updateWindowsMsvcDefaults(rootDir);
    if (!msvcOk) {
        console.error('Warning: Windows MSVC defaults generation failed');
    }

    const boostOk = await generateBoostDeps(rootDir);
    if (!boostOk) {
        console.error('Warning: Boost deps generation failed');
    }

    if (!runnerImagesOk || !tagsOk || !ubuntuOk || !compilerDefaultsOk || !macosOk || !msvcOk || !boostOk) {
        process.exit(1);
    }

    console.log('\n\u2705 External data updated successfully');
}

main().catch((err) => {
    console.error('update-data failed:', err);
    process.exit(1);
});
