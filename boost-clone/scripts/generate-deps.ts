#!/usr/bin/env npx ts-node

/**
 * Generator script for precomputed Boost module dependency data.
 *
 * This script clones Boost release tags, scans all modules for their dependencies,
 * builds transitive dependency closures, and outputs boost-deps.json.
 *
 * Usage:
 *   npx ts-node scripts/generate-deps.ts [options]
 *
 * Options:
 *   --latest N          Process the N most recent Boost releases (default: 2)
 *   --releases TAGS     Comma-separated list of release tags to process
 *   --output FILE       Output file path (default: boost-deps.json)
 *   --skip-existing     Skip releases already present in the output file
 *   --help              Show this help message
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';

// Import shared scanning logic
import {
    parseExceptions,
    parseGitmodules,
    scanModuleDependencies,
    type ExceptionsMap,
    type SubmodulePaths
} from '../src/scanning';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependency information for a single module.
 */
interface ModuleDeps {
    direct_deps: string[];
    transitive_deps: string[];
    total_count: number;
}

/**
 * Dependency data for a single release.
 */
interface ReleaseDeps {
    modules: Record<string, ModuleDeps>;
}

/**
 * Complete precomputed dependency data structure.
 */
interface BoostDepsData {
    generated: string;
    releases: Record<string, ReleaseDeps>;
}

/**
 * CLI argument configuration.
 */
interface GeneratorArgs {
    latest: number;
    releases: string[];
    output: string;
    skipExisting: boolean;
    help: boolean;
}

// ============================================================================
// Generator-specific functions
// ============================================================================

/**
 * Downloads a file from a URL and returns its contents as a string.
 *
 * @param url - The URL to download from
 * @returns The file contents
 */
function downloadFile(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Builds the transitive dependency closure for all modules.
 *
 * @param directDepsMap - Map of module name to its direct dependencies
 * @returns Map of module name to its complete dependency info
 */
function buildTransitiveClosures(
    directDepsMap: Map<string, Set<string>>
): Map<string, ModuleDeps> {
    const result = new Map<string, ModuleDeps>();

    for (const [moduleName, deps] of directDepsMap) {
        const transitiveDeps = new Set<string>();
        const queue = [...deps];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const dep = queue.shift()!;
            if (visited.has(dep)) {
                continue;
            }
            visited.add(dep);
            transitiveDeps.add(dep);

            const depDeps = directDepsMap.get(dep);
            if (depDeps) {
                for (const d of depDeps) {
                    if (!visited.has(d)) {
                        queue.push(d);
                    }
                }
            }
        }

        result.set(moduleName, {
            direct_deps: [...deps].sort(),
            transitive_deps: [...transitiveDeps].sort(),
            total_count: transitiveDeps.size
        });
    }

    return result;
}

/**
 * Scans all modules in a Boost installation and builds dependency data.
 *
 * @param boostDir - Path to the Boost installation
 * @param exceptions - Exception mappings
 * @param submodulePaths - Valid submodule paths
 * @returns Dependency data for all modules
 */
async function scanAllModules(
    boostDir: string,
    exceptions: ExceptionsMap,
    submodulePaths: SubmodulePaths
): Promise<ReleaseDeps> {
    const libsDir = path.join(boostDir, 'libs');
    const directDepsMap = new Map<string, Set<string>>();

    const moduleNames: string[] = [];
    for (const submodulePath of submodulePaths) {
        if (submodulePath.startsWith('libs/')) {
            const moduleName = submodulePath.slice(5);
            moduleNames.push(moduleName);
        }
    }

    console.log(`Scanning ${moduleNames.length} modules...`);

    for (const moduleName of moduleNames) {
        const modulePath = path.join(libsDir, moduleName);
        if (fs.existsSync(modulePath)) {
            const deps = await scanModuleDependencies(modulePath, moduleName, exceptions, submodulePaths);
            directDepsMap.set(moduleName, deps);
        }
    }

    console.log(`Building transitive closures...`);
    const moduleData = buildTransitiveClosures(directDepsMap);

    const modules: Record<string, ModuleDeps> = {};
    for (const [name, deps] of moduleData) {
        modules[name] = deps;
    }

    return { modules };
}

/**
 * Fetches the latest Boost release tags from GitHub.
 *
 * @param count - Number of releases to fetch
 * @returns Array of release tag names
 */
async function fetchLatestReleases(count: number): Promise<string[]> {
    const url = 'https://api.github.com/repos/boostorg/boost/tags?perPage=100';

    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'boost-deps-generator',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch tags: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const tags = JSON.parse(data) as Array<{ name: string }>;
                    const releases = tags
                        .map(t => t.name)
                        .filter(name => /^boost-\d+\.\d+\.\d+$/.test(name))
                        .slice(0, count);
                    resolve(releases);
                } catch (e) {
                    reject(e);
                }
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Downloads exception and gitmodule data for a release.
 *
 * @param tag - The release tag
 * @returns Object containing exceptions and submodule paths
 */
async function downloadMetadata(tag: string): Promise<{
    exceptions: ExceptionsMap;
    submodulePaths: SubmodulePaths;
}> {
    console.log(`Downloading metadata for ${tag}...`);

    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${tag}/.gitmodules`;
    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${tag}/depinst/exceptions.txt`;

    const [gitmodulesContent, exceptionsContent] = await Promise.all([
        downloadFile(gitmodulesUrl),
        downloadFile(exceptionsUrl).catch(() => {
            console.log(`  exceptions.txt not found for ${tag}, using master...`);
            return downloadFile('https://raw.githubusercontent.com/boostorg/boostdep/master/depinst/exceptions.txt');
        })
    ]);

    return {
        exceptions: parseExceptions(exceptionsContent),
        submodulePaths: parseGitmodules(gitmodulesContent)
    };
}

/**
 * Clones a Boost release tag to a temporary directory.
 *
 * @param tag - The release tag to clone
 * @param targetDir - The directory to clone into
 */
function cloneBoostRelease(tag: string, targetDir: string): void {
    console.log(`Cloning ${tag}...`);

    execSync(
        `git clone --depth 1 --branch ${tag} https://github.com/boostorg/boost.git "${targetDir}"`,
        { stdio: 'inherit' }
    );

    console.log(`Initializing submodules for ${tag}...`);
    execSync(
        `git submodule update --init --recursive --depth 1 --jobs ${os.cpus().length}`,
        { cwd: targetDir, stdio: 'inherit' }
    );
}

/**
 * Processes a single Boost release and returns its dependency data.
 *
 * @param tag - The release tag to process
 * @returns Dependency data for the release
 */
async function processRelease(tag: string): Promise<ReleaseDeps> {
    const tempDir = path.join(os.tmpdir(), `boost-deps-${tag}-${Date.now()}`);

    try {
        cloneBoostRelease(tag, tempDir);
        const { exceptions, submodulePaths } = await downloadMetadata(tag);
        const releaseDeps = await scanAllModules(tempDir, exceptions, submodulePaths);
        return releaseDeps;
    } finally {
        console.log(`Cleaning up ${tempDir}...`);
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            console.warn(`Warning: Could not remove ${tempDir}`);
        }
    }
}

/**
 * Loads existing data from output file if it exists.
 *
 * @param outputPath - Path to the output file
 * @returns Existing data or empty structure
 */
function loadExistingData(outputPath: string): BoostDepsData {
    if (fs.existsSync(outputPath)) {
        try {
            const content = fs.readFileSync(outputPath, 'utf-8');
            return JSON.parse(content) as BoostDepsData;
        } catch {
            console.warn(`Warning: Could not parse existing ${outputPath}, starting fresh`);
        }
    }
    return {
        generated: new Date().toISOString().split('T')[0],
        releases: {}
    };
}

/**
 * Prints usage information.
 */
function printHelp(): void {
    console.log(`
boost-deps generator - Generate Boost module dependency data

Usage:
  npx ts-node scripts/generate-deps.ts [options]

Options:
  --latest N          Process the N most recent Boost releases (default: 2)
  --releases TAGS     Comma-separated list of release tags to process
  --output FILE       Output file path (default: boost-deps.json)
  --skip-existing     Skip releases already present in the output file
  --help              Show this help message

Examples:
  npx ts-node scripts/generate-deps.ts --latest 2
  npx ts-node scripts/generate-deps.ts --releases boost-1.87.0,boost-1.86.0
  npx ts-node scripts/generate-deps.ts --latest 2 --skip-existing
`);
}

/**
 * Parses command line arguments.
 *
 * @param args - Command line arguments
 * @returns Parsed arguments
 */
function parseArgs(args: string[]): GeneratorArgs {
    const result: GeneratorArgs = {
        latest: 2,
        releases: [],
        output: path.join(__dirname, '..', 'boost-deps.json'),
        skipExisting: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--latest':
                result.latest = parseInt(args[++i], 10);
                break;
            case '--releases':
                result.releases = args[++i].split(',').map(s => s.trim());
                break;
            case '--output':
                result.output = args[++i];
                break;
            case '--skip-existing':
                result.skipExisting = true;
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
        }
    }

    return result;
}

/**
 * Main entry point for the generator.
 */
async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        printHelp();
        process.exit(0);
    }

    let releasesToProcess: string[];
    if (args.releases.length > 0) {
        releasesToProcess = args.releases;
    } else {
        console.log(`Fetching latest ${args.latest} Boost releases...`);
        releasesToProcess = await fetchLatestReleases(args.latest);
    }

    console.log(`Releases to process: ${releasesToProcess.join(', ')}`);

    const outputPath = path.resolve(args.output);
    const data = loadExistingData(outputPath);

    if (args.skipExisting) {
        const existingReleases = Object.keys(data.releases);
        const newReleases = releasesToProcess.filter(r => !existingReleases.includes(r));
        if (newReleases.length === 0) {
            console.log('All requested releases already exist in output file. Nothing to do.');
            process.exit(0);
        }
        console.log(`Skipping existing releases. Processing: ${newReleases.join(', ')}`);
        releasesToProcess = newReleases;
    }

    for (const tag of releasesToProcess) {
        console.log(`\n=== Processing ${tag} ===`);
        try {
            const releaseDeps = await processRelease(tag);
            data.releases[tag] = releaseDeps;
        } catch (error) {
            console.error(`Error processing ${tag}:`, error);
            process.exit(1);
        }
    }

    data.generated = new Date().toISOString().split('T')[0];

    // Sort releases by version (newest first)
    const sortedReleases: Record<string, ReleaseDeps> = {};
    const sortedKeys = Object.keys(data.releases).sort((a, b) => {
        const versionA = a.replace('boost-', '').split('.').map(Number);
        const versionB = b.replace('boost-', '').split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (versionB[i] !== versionA[i]) {
                return versionB[i] - versionA[i];
            }
        }
        return 0;
    });
    for (const key of sortedKeys) {
        sortedReleases[key] = data.releases[key];
    }
    data.releases = sortedReleases;

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`\nWriting output to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n');

    const totalModules = Object.values(data.releases).reduce(
        (sum, r) => sum + Object.keys(r.modules).length,
        0
    );
    console.log(`\nDone! Generated dependency data for ${Object.keys(data.releases).length} releases (${totalModules} total module entries).`);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
