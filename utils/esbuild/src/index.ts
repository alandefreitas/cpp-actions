#!/usr/bin/env node
/**
 * Build script for GitHub Actions using esbuild.
 * Generates properly source-mapped bundles for better error diagnostics.
 *
 * Usage:
 *   node utils/esbuild/dist/index.js <workspace-path>  (from monorepo root)
 *   node ../utils/esbuild/dist/index.js .              (from workspace dir)
 *
 * Examples:
 *   node utils/esbuild/dist/index.js cmake-workflow
 *   cd cmake-workflow && node ../utils/esbuild/dist/index.js .
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

interface PackageJson {
    main?: string;
    [key: string]: unknown;
}

// Get workspace path - defaults to current directory if not specified or "."
let workspacePath = process.argv[2] || '.';
if (workspacePath === '.') {
    workspacePath = process.cwd();
}

const absWorkspacePath = path.resolve(workspacePath);
const packageJsonPath = path.join(absWorkspacePath, 'package.json');

if (!fs.existsSync(packageJsonPath)) {
    console.error(`package.json not found at ${packageJsonPath}`);
    process.exit(1);
}

const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const entryPoint = path.join(absWorkspacePath, packageJson.main || 'lib/index.js');
const outfile = path.join(absWorkspacePath, 'dist', 'index.js');

// Injected helper to enable source-map-support inside the bundle (bundled, no runtime dep)
const injectSourceMapRegister = path.join(__dirname, 'sourcemap-register.js');

/**
 * Build the action bundle using esbuild.
 */
async function build(): Promise<void> {
    const startTime = Date.now();

    try {
        const result = await esbuild.build({
            entryPoints: [entryPoint],
            bundle: true,
            platform: 'node',
            target: 'node16',
            outfile: outfile,
            sourcemap: true,
            minify: true,
            keepNames: true, // preserve function names for clearer stacks
            // Include original sources in source map for debugging
            sourcesContent: true,
            // Inject source-map-support/register so it's bundled (no external dep)
            inject: [injectSourceMapRegister],
            // Mark native modules as external
            external: [],
            // Generate metafile for analysis
            metafile: true,
            // Log level
            logLevel: 'info',
        });

        const elapsed = Date.now() - startTime;
        const outSize = fs.statSync(outfile).size;
        const mapSize = fs.statSync(outfile + '.map').size;

        console.log(`\n  ${(outSize / 1024).toFixed(0)}kB  ${path.relative(process.cwd(), outfile)}`);
        console.log(`  ${(mapSize / 1024).toFixed(0)}kB  ${path.relative(process.cwd(), outfile + '.map')}`);
        console.log(`\n⚡ Done in ${elapsed}ms\n`);

        // Write metafile for analysis
        fs.writeFileSync(
            path.join(absWorkspacePath, 'dist', 'meta.json'),
            JSON.stringify(result.metafile, null, 2)
        );

    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
