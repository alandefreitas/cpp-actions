import * as fs from 'fs';
import { main } from './index';
import * as trace_commands from 'trace-commands';

/**
 * Valid modes for the check-unconventional input.
 *
 * - 'false': Disable checking (no warnings or errors)
 * - 'warn': Emit warnings for unconventional commits
 * - 'error': Fail the action if unconventional commits are found
 */
type CheckUnconventionalMode = 'false' | 'warn' | 'error';

interface CliInputs {
    source_dir: string;
    version_pattern: RegExp;
    tag_pattern: RegExp;
    output_path: string;
    limit: number;
    thank_non_regular: boolean;
    check_unconventional: CheckUnconventionalMode;
    link_commits: boolean;
    github_token: string;
    update_summary: boolean;
    trace_commands: boolean;
    include_types: Set<string>;
    exclude_types: Set<string>;
}

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

function parseArgs(): CliInputs {
    const args = process.argv.slice(2);
    const inputs: CliInputs = {
        source_dir: normalizePath(process.cwd()),
        version_pattern: /^v\d+\.\d+\.\d+$/,
        tag_pattern: /^v\d+\.\d+\.\d+$/,
        output_path: 'CHANGELOG.md',
        limit: 0,
        thank_non_regular: true,
        check_unconventional: 'warn',
        link_commits: true,
        github_token: process.env.GITHUB_TOKEN || '',
        update_summary: false,
        trace_commands: true,
        include_types: new Set<string>(),
        exclude_types: new Set(['chore', 'style'])
    };

    const sink: string[] = [];
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--source_dir':
                inputs.source_dir = normalizePath(args[++i]);
                break;
            case '--version_pattern':
                inputs.version_pattern = new RegExp(args[++i]);
                break;
            case '--tag_pattern':
                inputs.tag_pattern = new RegExp(args[++i]);
                break;
            case '--output_path':
            case '-o':
                inputs.output_path = normalizePath(args[++i]);
                break;
            case '--limit':
                inputs.limit = toIntegerInput(args[++i]) || 0;
                break;
            case '--thank_non_regular':
                inputs.thank_non_regular = args[++i] === 'true';
                break;
            case '--check_unconventional':
                inputs.check_unconventional = parseCheckUnconventionalMode(args[++i]);
                break;
            case '--link_commits':
                inputs.link_commits = args[++i] === 'true';
                break;
            case '--github_token':
                inputs.github_token = args[++i];
                break;
            case '--update_summary':
                inputs.update_summary = args[++i] === 'true';
                break;
            case '--trace_commands':
                inputs.trace_commands = args[++i] === 'true';
                break;
            case '--include_types':
                inputs.include_types = new Set(args[++i].split(',').map(t => t.trim()).filter(t => t));
                break;
            case '--exclude_types':
                inputs.exclude_types = new Set(args[++i].split(',').map(t => t.trim()).filter(t => t));
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
            inputs.source_dir = sinkDir;
        }
    }

    return inputs;
}

async function runLocal(): Promise<void> {
    const inputs = parseArgs();
    trace_commands.set_trace_commands(true);
    try {
        await main(inputs);
    } catch (error) {
        console.error('Error:', error);
    }
}

runLocal();
