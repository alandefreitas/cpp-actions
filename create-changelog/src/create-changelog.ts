import * as fs from 'fs';
import { main } from './index';
import * as trace_commands from 'trace-commands';

interface CliInputs {
    source_dir: string;
    version_pattern: RegExp;
    tag_pattern: RegExp;
    output_path: string;
    limit: number;
    thank_non_regular: boolean;
    check_unconventional: boolean;
    link_commits: boolean;
    github_token: string;
    update_summary: boolean;
    trace_commands: boolean;
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

function parseArgs(): CliInputs {
    const args = process.argv.slice(2);
    const inputs: CliInputs = {
        source_dir: normalizePath(process.cwd()),
        version_pattern: /^v\d+\.\d+\.\d+$/,
        tag_pattern: /^v\d+\.\d+\.\d+$/,
        output_path: 'CHANGELOG.md',
        limit: 0,
        thank_non_regular: true,
        check_unconventional: true,
        link_commits: true,
        github_token: process.env.GITHUB_TOKEN || '',
        update_summary: false,
        trace_commands: true
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
                inputs.check_unconventional = args[++i] === 'true';
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
