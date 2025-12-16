/**
 * CLI argument parsing for the build utility.
 */

/**
 * Parsed command-line arguments for the build CLI.
 */
export interface CliArgs {
    /** Run all build steps (default behavior) */
    all: boolean;
    /** Specific workspace to build (if provided) */
    workspace?: string;
    /** Only fetch remote tags */
    fetchTags: boolean;
    /** Only run prepare step */
    prepare: boolean;
    /** Only run tests */
    test: boolean;
    /** Only run JSDoc linting */
    lint: boolean;
    /** Only generate documentation */
    docs: boolean;
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
        all: true,
        fetchTags: false,
        prepare: false,
        test: false,
        lint: false,
        docs: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--workspace':
            case '-w':
                result.workspace = args[++i];
                break;
            case '--fetch-tags':
                result.fetchTags = true;
                result.all = false;
                break;
            case '--prepare':
                result.prepare = true;
                result.all = false;
                break;
            case '--test':
                result.test = true;
                result.all = false;
                break;
            case '--lint':
                result.lint = true;
                result.all = false;
                break;
            case '--docs':
                result.docs = true;
                result.all = false;
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
 * Prints usage information to stdout.
 */
export function printHelp(): void {
    console.log(`
Build CLI - Build orchestration for cpp-actions monorepo

Usage: build-cli [options]

Options:
  --workspace, -w <name>  Build only the specified workspace
  --fetch-tags            Only fetch remote tags (GCC, Clang, CMake)
  --prepare               Only run npm prepare across workspaces
  --test                  Only run tests
  --lint                  Only run JSDoc linting
  --docs                  Only generate documentation
  --help, -h              Show this help message

When no specific option is provided, all build steps are executed.

Examples:
  build-cli                     # Run full build
  build-cli --workspace boost-clone  # Build only boost-clone
  build-cli --prepare --test    # Run prepare and test steps
`);
}
