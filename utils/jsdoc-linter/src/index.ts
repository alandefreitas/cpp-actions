#!/usr/bin/env node

/**
 * JSDoc Linter CLI
 *
 * A command-line tool to validate JSDoc documentation in TypeScript projects.
 * Ensures all exported functions, classes, and interfaces have comprehensive
 * documentation including parameter descriptions, return types, and throw documentation.
 */

import * as path from 'path';
import { lint } from './linter';
import { report } from './reporter';
import { type LinterOptions } from './types';

/**
 * Parses command-line arguments into linter options.
 *
 * @param args - Command-line arguments (process.argv.slice(2))
 * @returns Parsed linter options
 */
function parseArgs(args: string[]): LinterOptions {
    const options: LinterOptions = {
        rootDir: process.cwd(),
        workspaces: [],
        exclude: [],
        format: 'text',
        failOnWarnings: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '-w':
            case '--workspace':
                if (i + 1 < args.length) {
                    options.workspaces.push(args[++i]);
                }
                break;

            case '-e':
            case '--exclude':
                if (i + 1 < args.length) {
                    options.exclude.push(args[++i]);
                }
                break;

            case '-f':
            case '--format':
                if (i + 1 < args.length) {
                    const format = args[++i];
                    if (format === 'text' || format === 'json' || format === 'github') {
                        options.format = format;
                    } else {
                        console.error(`Unknown format: ${format}. Using 'text'.`);
                    }
                }
                break;

            case '--fail-on-warnings':
                options.failOnWarnings = true;
                break;

            case '-r':
            case '--root':
                if (i + 1 < args.length) {
                    options.rootDir = path.resolve(args[++i]);
                }
                break;

            case '-h':
            case '--help':
                printHelp();
                process.exit(0);

            default:
                if (!arg.startsWith('-')) {
                    // Treat positional arguments as workspaces
                    options.workspaces.push(arg);
                } else {
                    console.error(`Unknown option: ${arg}`);
                }
        }
    }

    return options;
}

/**
 * Prints help message to stdout.
 */
function printHelp(): void {
    console.log(`
JSDoc Linter - Validate JSDoc documentation in TypeScript projects

Usage: jsdoc-linter [options] [workspaces...]

Options:
  -w, --workspace <name>    Lint specific workspace(s). Can be used multiple times.
  -e, --exclude <pattern>   Glob pattern to exclude. Can be used multiple times.
  -f, --format <format>     Output format: text (default), json, github
  -r, --root <path>         Root directory of the project (default: cwd)
  --fail-on-warnings        Treat warnings as errors
  -h, --help                Show this help message

Examples:
  jsdoc-linter                        Lint all workspaces
  jsdoc-linter setup-gcc              Lint only setup-gcc workspace
  jsdoc-linter -w common/gh-inputs    Lint only gh-inputs workspace
  jsdoc-linter --format github        Output in GitHub Actions format
  jsdoc-linter --fail-on-warnings     Fail on any issue

Rules enforced:
  - All exported functions, classes, interfaces must have JSDoc
  - JSDoc must have a meaningful description (not lazy)
  - All parameters must have @param tags with descriptions
  - Non-void functions must have @returns with description
  - Functions with throw statements should have @throws (warning)
`);
}

/**
 * Main entry point for the CLI.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    try {
        const result = await lint(options);
        report(result, options.format);

        // Exit with error code if there are errors (or warnings with --fail-on-warnings)
        const hasErrors = result.totalErrors > 0;
        const hasWarnings = result.totalWarnings > 0 && options.failOnWarnings;

        if (hasErrors || hasWarnings) {
            process.exit(1);
        }
    } catch (error) {
        console.error('Error running JSDoc linter:', error);
        process.exit(2);
    }
}

main();
