/**
 * Severity level for linting issues.
 */
export type Severity = 'error' | 'warning';

/**
 * Represents a single linting issue found in the code.
 */
export interface LintIssue {
    /** The file path where the issue was found */
    file: string;
    /** Line number (1-based) */
    line: number;
    /** Column number (1-based) */
    column: number;
    /** The rule that was violated */
    rule: string;
    /** Severity of the issue */
    severity: Severity;
    /** Human-readable description of the issue */
    message: string;
    /** The name of the symbol with the issue */
    symbol: string;
    /** The type of declaration (function, class, interface, etc.) */
    declarationType: string;
}

/**
 * Result from linting a single file.
 */
export interface FileLintResult {
    /** The file path that was linted */
    file: string;
    /** List of issues found in the file */
    issues: LintIssue[];
    /** Number of errors found */
    errorCount: number;
    /** Number of warnings found */
    warningCount: number;
}

/**
 * Overall result from linting multiple files.
 */
export interface LintResult {
    /** Results for each file that was linted */
    files: FileLintResult[];
    /** Total number of errors across all files */
    totalErrors: number;
    /** Total number of warnings across all files */
    totalWarnings: number;
    /** Total number of files processed */
    totalFiles: number;
    /** Number of files with issues */
    filesWithIssues: number;
}

/**
 * Options for the linter.
 */
export interface LinterOptions {
    /** Root directory of the project */
    rootDir: string;
    /** Specific workspaces to lint (if empty, lint all) */
    workspaces: string[];
    /** Glob patterns to exclude from linting */
    exclude: string[];
    /** Output format */
    format: 'text' | 'json' | 'github';
    /** Whether to treat warnings as errors */
    failOnWarnings: boolean;
}

/**
 * Information about a JSDoc tag.
 */
export interface JSDocTag {
    /** The tag name (e.g., 'param', 'returns', 'throws') */
    tagName: string;
    /** The parameter name (for @param tags) */
    name?: string;
    /** The tag comment/description */
    comment?: string;
    /** The type (if specified) */
    type?: string;
}

/**
 * Parsed JSDoc comment.
 */
export interface ParsedJSDoc {
    /** The main description */
    description: string;
    /** All tags in the JSDoc */
    tags: JSDocTag[];
}

/**
 * Information about a parameter.
 */
export interface ParameterInfo {
    /** Parameter name */
    name: string;
    /** Parameter type as string */
    type: string;
    /** Whether the parameter is optional */
    optional: boolean;
    /** Whether the parameter has a default value */
    hasDefault: boolean;
}

/**
 * Information about a declaration being analyzed.
 */
export interface DeclarationInfo {
    /** Name of the declaration */
    name: string;
    /** Type of declaration */
    type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property';
    /** Whether the declaration is exported */
    isExported: boolean;
    /** Line number of the declaration */
    line: number;
    /** Column number of the declaration */
    column: number;
    /** List of parameters (for functions/methods) */
    parameters: ParameterInfo[];
    /** Return type (for functions/methods) */
    returnType?: string;
    /** Whether the function/method has throw statements */
    hasThrowStatements: boolean;
    /** The parsed JSDoc if present */
    jsdoc?: ParsedJSDoc;
}
