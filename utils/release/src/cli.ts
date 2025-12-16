/**
 * CLI argument parsing for the release utility.
 */

/**
 * Parsed command-line arguments for the release CLI.
 */
export interface CliArgs {
    /** The version tag to release (e.g., "1.2.3" or "v1.2.3") */
    version?: string;
    /** Dry run mode - show what would happen without making changes */
    dryRun: boolean;
    /** Skip confirmation prompts */
    yes: boolean;
    /** Show help */
    help: boolean;
}

/**
 * Parses command-line arguments into a structured object.
 * @param args - The command-line arguments (typically process.argv.slice(2))
 * @returns Parsed CLI arguments
 */
export function parseArgs(args: string[]): CliArgs {
    const result: CliArgs = {
        dryRun: false,
        yes: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--version':
            case '-v':
                result.version = args[++i];
                break;
            case '--dry-run':
            case '-n':
                result.dryRun = true;
                break;
            case '--yes':
            case '-y':
                result.yes = true;
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
            default:
                // Positional argument - treat as version if not starting with -
                if (!arg.startsWith('-') && !result.version) {
                    result.version = arg;
                }
        }
    }

    return result;
}

/**
 * Prints usage information to stdout.
 */
export function printHelp(): void {
    console.log(`
Release CLI - Release orchestration for cpp-actions monorepo

Usage: release-cli [version] [options]

Arguments:
  version                 The version to release (e.g., 1.2.3 or v1.2.3)
                         If not provided, will prompt for version selection

Options:
  --version, -v <ver>    Specify version explicitly
  --dry-run, -n          Show what would happen without making changes
  --yes, -y              Skip confirmation prompts
  --help, -h             Show this help message

The release process:
  1. Fetches latest refs from origin
  2. Verifies develop branch is up to date
  3. Creates a worktree for master branch
  4. Rebases master onto origin/develop if needed
  5. Pushes master to origin
  6. Creates and pushes the version tag

Examples:
  release-cli                    # Interactive release (prompts for version)
  release-cli 1.2.3              # Release version 1.2.3
  release-cli --dry-run          # Show what would happen
  release-cli -y 1.2.3           # Release without prompts
`);
}
