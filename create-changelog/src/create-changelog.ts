import * as fs from 'fs';
import { main, type SortByOption, parseSortByOption } from './index';
import * as traceCommands from 'trace-commands';

/**
 * Valid modes for the check-unconventional input.
 *
 * - 'false': Disable checking (no warnings or errors)
 * - 'warn': Emit warnings for unconventional commits
 * - 'error': Fail the action if unconventional commits are found
 */
type CheckUnconventionalMode = 'false' | 'warn' | 'error';

/**
 * CLI input options for the create-changelog tool.
 */
interface CliInputs {
    sourceDir: string;
    versionPattern: RegExp;
    tagPattern: RegExp;
    outputPath: string;
    limit: number;
    thankNonRegular: boolean;
    checkUnconventional: CheckUnconventionalMode;
    linkCommits: boolean;
    githubToken: string;
    updateSummary: boolean;
    traceCommands: boolean;
    includeTypes: Set<string>;
    excludeTypes: Set<string>;
    sortBy: SortByOption;
}

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
 * Parses a check-unconventional CLI argument value into its mode.
 *
 * Handles backwards compatibility with boolean values ('true'/'false')
 * and the new mode values ('warn'/'error').
 *
 * @param value - The CLI argument value to parse
 * @returns The normalized CheckUnconventionalMode
 */
function parseCheckUnconventionalMode(value: string): CheckUnconventionalMode {
    const normalized = value.toLowerCase().trim();
    if (normalized === 'false') {
        return 'false';
    }
    if (normalized === 'error') {
        return 'error';
    }
    // 'true', 'warn', or any other value defaults to 'warn'
    return 'warn';
}

/**
 * Parses command line arguments into CLI input options.
 *
 * @returns Parsed CLI input configuration
 */
function parseArgs(): CliInputs {
    const args = process.argv.slice(2);
    const inputs: CliInputs = {
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
                inputs.checkUnconventional = parseCheckUnconventionalMode(args[++i]);
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
                inputs.sortBy = parseSortByOption(args[++i]);
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
