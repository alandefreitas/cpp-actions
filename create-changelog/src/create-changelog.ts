import * as fs from 'fs';
import { main } from './index';
import * as traceCommands from 'trace-commands';

import type { Inputs } from './schema';

/**
 * Normalizes a file path by expanding ~ and converting backslashes.
 *
 * @param inputPath - Path to normalize
 * @returns Normalized path string
 */
function normalizePath(inputPath: string): string {
    let p = inputPath;
    if (p.startsWith('~/') || p.startsWith('~\\')) {
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            p = p.replace('~', process.env.HOME || process.env.USERPROFILE || '');
        } else {
            p = p.replace('~', process.env.HOME || '');
        }
    }
    p = p.replace(/\\/g, '/');
    return p;
}

/**
 * Parses a string to an integer, returning undefined if invalid.
 *
 * @param value - String to parse
 * @returns Parsed integer or undefined
 */
function toIntegerInput(value: string): number | undefined {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses command line arguments into CLI input options.
 *
 * @returns Parsed CLI input configuration
 */
function parseArgs(): Inputs {
    const args = process.argv.slice(2);
    const inputs: Inputs = {
        sourceDir: normalizePath(process.cwd()),
        versionPattern: /^v\d+\.\d+\.\d+$/,
        tagPattern: /^v\d+\.\d+\.\d+$/,
        outputPath: 'CHANGELOG.md',
        limit: 0,
        thankNonRegular: true,
        checkUnconventional: 'warn',
        linkCommits: true,
        githubToken: process.env.GITHUB_TOKEN || '',
        updateSummary: false,
        traceCommands: true,
        includeTypes: new Set<string>(),
        excludeTypes: new Set(['chore', 'style']),
        sortBy: 'most-changes-first'
    };

    const sink: string[] = [];
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--sourceDir':
                inputs.sourceDir = normalizePath(args[++i]);
                break;
            case '--versionPattern':
                inputs.versionPattern = new RegExp(args[++i]);
                break;
            case '--tagPattern':
                inputs.tagPattern = new RegExp(args[++i]);
                break;
            case '--outputPath':
            case '-o':
                inputs.outputPath = normalizePath(args[++i]);
                break;
            case '--limit':
                inputs.limit = toIntegerInput(args[++i]) || 0;
                break;
            case '--thankNonRegular':
                inputs.thankNonRegular = args[++i] === 'true';
                break;
            case '--checkUnconventional':
                inputs.checkUnconventional = args[++i] as typeof inputs.checkUnconventional;
                break;
            case '--linkCommits':
                inputs.linkCommits = args[++i] === 'true';
                break;
            case '--githubToken':
                inputs.githubToken = args[++i];
                break;
            case '--updateSummary':
                inputs.updateSummary = args[++i] === 'true';
                break;
            case '--traceCommands':
                inputs.traceCommands = args[++i] === 'true';
                break;
            case '--includeTypes':
                inputs.includeTypes = new Set(args[++i].split(',').map(t => t.trim()).filter(t => t));
                break;
            case '--excludeTypes':
                inputs.excludeTypes = new Set(args[++i].split(',').map(t => t.trim()).filter(t => t));
                break;
            case '--sortBy':
                inputs.sortBy = args[++i] as typeof inputs.sortBy;
                break;
            default:
                sink.push(args[i]);
        }
    }

    if (sink.length > 0) {
        const sinkDir = normalizePath(sink[0]);
        const dirExists = fs.existsSync(sinkDir);
        const isDir = dirExists && fs.lstatSync(sinkDir).isDirectory();
        if (dirExists && !isDir) {
            inputs.sourceDir = sinkDir;
        }
    }

    return inputs;
}

/**
 * Main entry point for local CLI execution of create-changelog.
 */
async function runLocal(): Promise<void> {
    const inputs = parseArgs();
    traceCommands.setTraceCommands(true);
    try {
        await main(inputs);
    } catch (error) {
        console.error('Error:', error);
    }
}

runLocal();
