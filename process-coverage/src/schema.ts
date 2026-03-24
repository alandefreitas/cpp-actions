/**
 * Schema definitions for the process-coverage action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import * as path from 'node:path';
import * as semver from 'semver';

import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema,
    type InferInputs
} from 'action-schema';

/**
 * Extracts the major version number from a version string or semver range.
 *
 * Accepts bare major numbers (`'14'`), full semver (`'14.2.0'`),
 * semver-coercible strings (`'14.2'`), semver ranges (`'>=14'`),
 * or wildcards (`'*'`). Returns the major as a string suitable for
 * tool name suffixes (e.g., `'14'`), or `''` if the version cannot
 * be determined (wildcard, unparseable). An empty result causes the
 * tool discovery to skip versioned binary search and use unversioned
 * tools directly.
 *
 * @param version - Version string or semver range to parse
 * @returns The major version as a string, or `''` if undetermined
 */
function extractMajorVersion(version: string): string {
    const trimmed = version.trim();

    // Empty or wildcard — version is unknown
    if (trimmed === '' || trimmed === '*') {
        return '';
    }

    // Already a bare integer (e.g., '14')
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }

    // Try semver coercion first (handles '14.2.0', '14.2', etc.)
    const coerced = semver.coerce(trimmed);
    if (coerced) {
        return String(coerced.major);
    }

    // Try as a semver range (handles '>=14', '>=3.8 <6 || >11', etc.)
    const minVer = semver.minVersion(trimmed);
    if (minVer) {
        return String(minVer.major);
    }

    // Cannot determine version — fall back to unversioned tools
    return '';
}

/**
 * Input schema for the process-coverage action.
 */
export const inputsSchema = {
    ...baseInputs,

    // ======================================
    // Compiler identification
    // ======================================
    compiler: {
        type: 'string' as const,
        default: '',
        description: `The compiler family used to build the project.

Determines which coverage pipeline to use: \`gcc\` uses gcov/lcov,
\`clang\` uses llvm-profdata/llvm-cov.

When not provided, the action auto-detects the compiler by running
\`cxx --version\` (if \`cxx\` is set).`
    },

    compilerVersion: {
        type: 'string' as const,
        default: '',
        description: `The compiler version used to build the project.

Accepts any version format: a bare major number (\`14\`), a full version
(\`14.2.0\`), a semver range (\`>=14\`), or a wildcard (\`*\`). The action
extracts the major version to locate version-matched coverage tools
(e.g., \`gcov-14\`, \`llvm-cov-18\`). When the major version cannot be
determined (e.g., \`*\`), the action falls back to unversioned tools.

When not provided, the action auto-detects the version from the \`cxx\`
binary's \`--version\` output, or falls back to unversioned tools.

Typically set from \`setup-cpp\` outputs (\`steps.setup-cpp.outputs.version\`),
cpp-matrix fields (\`matrix.major\` or \`matrix.version\`), or a literal
version number.`,
        transform: (v) => extractMajorVersion(v as string)
    },

    cxx: {
        type: 'string' as const,
        default: '',
        fallbackEnv: 'CXX',
        description: `Path to the C++ compiler binary.

Used as a fallback to detect the compiler family and version when
\`compiler\` or \`compiler-version\` are not provided. The action runs
\`cxx --version\` and parses the output to identify the compiler.

Falls back to the \`CXX\` environment variable if not set.

Typically set from \`setup-cpp\` outputs (\`steps.setup-cpp.outputs.cxx\`).`
    },

    // ======================================
    // Build paths
    // ======================================
    buildDir: {
        type: 'multiline' as const,
        default: ['build'],
        description: `List of build directories to search for coverage data.

For GCC, these directories contain \`.gcda\`/\`.gcno\` files.
For Clang, these directories are searched for \`.profraw\` files.`
    },

    // ======================================
    // LCOV filtering
    // ======================================
    include: {
        type: 'multiline' as const,
        default: [] as string[],
        transform: (v) => (v as string[]).map(p =>
            p.startsWith('/') || p.startsWith('*') || p.startsWith('!')
                ? p
                : path.resolve(p).replace(/\\/g, '/')
        ),
        description: `Glob patterns to include in coverage results.

Only LCOV sections whose source file path matches at least one pattern
are kept. Empty list means include all files.

Relative patterns like \`src/**\` or \`../boost-root/libs/url/**\`
are resolved to absolute paths relative to the working directory.
Use \`*\` to match within a single directory and \`**\` to match
across directories.`
    },

    exclude: {
        type: 'multiline' as const,
        default: [] as string[],
        transform: (v) => (v as string[]).map(p =>
            p.startsWith('/') || p.startsWith('*') || p.startsWith('!')
                ? p
                : path.resolve(p).replace(/\\/g, '/')
        ),
        description: `Glob patterns to exclude from coverage results.

LCOV sections whose source file path matches any pattern are removed.
Applied after include filtering. Empty list means exclude nothing.

Relative patterns are resolved to absolute paths relative to
the working directory, same as \`include\`.`
    },

    // ======================================
    // Step summary
    // ======================================
    summary: {
        type: 'boolean' as const,
        default: true,
        description: `Write a coverage summary table to the GitHub Actions step summary.

Includes line, function, and branch coverage metrics.
If new-code analysis is available, includes a new-code section.`
    },

    // ======================================
    // HTML report
    // ======================================
    htmlReport: {
        type: 'boolean' as const,
        default: false,
        description: `Generate an HTML coverage report using genhtml.

The report directory path is available via the \`html-report-dir\` output
for use in subsequent steps (e.g., deploying to GitHub Pages).`
    },

    htmlReportArtifact: {
        type: 'string' as const,
        default: '<auto>',
        description: `Name for the HTML coverage report artifact.

When set to \`<auto>\` (default), generates a unique name from the
compiler and platform (e.g., \`coverage-report-gcc-linux\`).

When set to any other value, that value is used as-is.

Set to an empty string to skip artifact upload — the report is
still generated and available via the \`html-report-dir\` output.`
    },

    htmlReportRetentionDays: {
        type: 'number' as const,
        default: 30,
        description: 'Number of days to retain the HTML coverage report artifact.'
    },

    // ======================================
    // New-code analysis
    // ======================================
    diffBase: {
        type: 'string' as const,
        default: '',
        description: `Git ref to compare against for new-code coverage analysis.

The action runs \`git diff <diff-base>..HEAD\` to identify which lines
were added or modified, then cross-references them with coverage data
to report what percentage of new code is covered.

Accepts any valid git ref: a branch name (\`main\`, \`origin/develop\`),
a commit SHA (\`abc123\` or full hash), a relative ref (\`HEAD~1\`), or
a tag (\`v1.0.0\`).

When not provided, the action auto-detects from the GitHub Actions
environment:
- **Pull requests**: uses \`origin/$GITHUB_BASE_REF\` (the PR target branch)
- **Push events**: uses \`HEAD~1\` (the previous commit)

Requires \`actions/checkout\` with \`fetch-depth: 0\` (or enough history
to reach the base ref). If the diff cannot be computed (e.g., shallow
clone), new-code analysis is silently skipped.`
    },

    // ======================================
    // Advanced: exclusion markers, Clang binaries, profraw
    // ======================================
    stripExclMarkers: {
        type: 'boolean' as const,
        default: true,
        description: `Strip LCOV_EXCL / GCOV_EXCL markers from coverage data.

When enabled, lines marked with LCOV_EXCL_LINE or between
LCOV_EXCL_START/LCOV_EXCL_STOP (and GCOV_EXCL equivalents)
are removed from the LCOV output. This is useful because some
coverage services and tools do not honor these markers natively.`
    },

    binaries: {
        type: 'multiline' as const,
        default: [] as string[],
        description: `Paths to the instrumented test executables (Clang only).

Clang's \`llvm-cov export\` needs to know which executable produced the
coverage data. Each entry is a path or glob pattern pointing to a test
binary built with \`-fprofile-instr-generate -fcoverage-mapping\`
(e.g. \`build/bin/my_tests\`, \`build/test_*\`).

When not provided, the action searches the build directories for
executable files and attempts to use them automatically. Provide
this input explicitly when auto-discovery picks up the wrong
binaries or when the build directory contains many unrelated
executables.

Ignored for GCC pipelines (GCC coverage tools do not need binary paths).`
    },

    profrawPattern: {
        type: 'string' as const,
        default: '*.profraw',
        description: `Glob pattern to match \`.profraw\` files in build directories.

Only used for Clang pipelines.`
    },

    // ======================================
    // Codecov upload
    // ======================================
    codecovToken: {
        type: 'string' as const,
        default: '',
        description: `Codecov upload token. If non-empty, uploads coverage to Codecov.

The token can be found in your Codecov repository settings.`
    },

    codecovFlags: {
        type: 'string' as const,
        default: '',
        description: 'Comma-separated list of Codecov flags to associate with the upload.'
    },

    codecovArgs: {
        type: 'string' as const,
        default: '',
        description: 'Extra arguments to pass to the Codecov CLI upload command.'
    },

    // ======================================
    // Coveralls upload
    // ======================================
    coverallsToken: {
        type: 'string' as const,
        default: '',
        description: `Coveralls repo token. If non-empty, uploads coverage to Coveralls.

The token can be found in your Coveralls repository settings.`
    },

    coverallsArgs: {
        type: 'string' as const,
        default: '',
        description: 'Extra arguments to pass to the Coveralls coverage-reporter command.'
    },

    // ======================================
    // Error handling
    // ======================================
    failOnUploadError: {
        type: 'boolean' as const,
        default: true,
        description: `Fail the action if a coverage upload (Codecov or Coveralls) fails.

Set to \`false\` to treat upload failures as warnings instead of
errors. This is useful for forks where coverage tokens may not be
available as secrets.`
    }
} satisfies ActionInputsSchema;

/** Inferred input types from the schema. */
export type Inputs = InferInputs<typeof inputsSchema>;

/**
 * Output schema for the process-coverage action.
 *
 * Outputs include paths to generated files and coverage metrics
 * for lines, functions, branches, and new code.
 */
export const outputsSchema = {
    // ======================================
    // File paths
    // ======================================
    lcovFile: {
        description: 'Absolute path to the final LCOV .info file after filtering.'
    },
    htmlReportDir: {
        description: 'Absolute path to the HTML coverage report directory. Empty if html-report is not enabled.'
    },

    // ======================================
    // Line coverage metrics
    // ======================================
    linesCovered: {
        description: 'Number of lines with non-zero execution count.'
    },
    linesTotal: {
        description: 'Total number of instrumented lines.'
    },
    linesPercent: {
        description: 'Line coverage percentage formatted with one decimal place (e.g. 85.7).'
    },

    // ======================================
    // Function coverage metrics
    // ======================================
    functionsCovered: {
        description: 'Number of functions with non-zero execution count.'
    },
    functionsTotal: {
        description: 'Total number of instrumented functions.'
    },
    functionsPercent: {
        description: 'Function coverage percentage formatted with one decimal place (e.g. 92.3).'
    },

    // ======================================
    // Branch coverage metrics
    // ======================================
    branchesCovered: {
        description: 'Number of branches with non-zero execution count.'
    },
    branchesTotal: {
        description: 'Total number of instrumented branches.'
    },
    branchesPercent: {
        description: 'Branch coverage percentage formatted with one decimal place (e.g. 70.1).'
    },

    // ======================================
    // New-code coverage metrics
    // ======================================
    newLinesCovered: {
        description: 'Number of new or modified lines with non-zero execution count. Zero if diff analysis is unavailable.'
    },
    newLinesTotal: {
        description: 'Total number of new or modified instrumented lines. Zero if diff analysis is unavailable.'
    },
    newLinesPercent: {
        description: 'New-code line coverage percentage formatted with one decimal place. Zero if diff analysis is unavailable.'
    },
    newFunctionsCovered: {
        description: 'Number of covered new/modified functions. Zero if diff analysis is unavailable.'
    },
    newFunctionsTotal: {
        description: 'Total number of new/modified instrumented functions. Zero if diff analysis is unavailable.'
    },
    newFunctionsPercent: {
        description: 'New-code function coverage percentage formatted with one decimal place. Zero if diff analysis is unavailable.'
    },
    newBranchesCovered: {
        description: 'Number of covered new/modified branches. Zero if diff analysis is unavailable.'
    },
    newBranchesTotal: {
        description: 'Total number of new/modified instrumented branches. Zero if diff analysis is unavailable.'
    },
    newBranchesPercent: {
        description: 'New-code branch coverage percentage formatted with one decimal place. Zero if diff analysis is unavailable.'
    }
} satisfies ActionOutputsSchema;
