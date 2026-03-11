import { type LintResult, type LintIssue } from './types';

/**
 * Formats a lint issue for text output.
 *
 * @param issue - The lint issue to format
 * @returns Formatted string
 */
function formatIssueText(issue: LintIssue): string {
    const severity = issue.severity === 'error' ? '\x1b[31merror\x1b[0m' : '\x1b[33mwarning\x1b[0m';
    return `  ${issue.line}:${issue.column}  ${severity}  ${issue.message}  ${issue.rule}`;
}

/**
 * Formats a lint issue for GitHub Actions annotations.
 *
 * @param issue - The lint issue to format
 * @returns GitHub Actions annotation string
 */
function formatIssueGitHub(issue: LintIssue): string {
    const level = issue.severity === 'error' ? 'error' : 'warning';
    return `::${level} file=${issue.file},line=${issue.line},col=${issue.column},title=${issue.rule}::${issue.message}`;
}

/**
 * Reports lint results in text format to stdout.
 *
 * @param result - The lint result to report
 */
export function reportText(result: LintResult): void {
    const filesWithIssues = result.files.filter(f => f.issues.length > 0);

    if (filesWithIssues.length === 0) {
        console.log('\x1b[32m✓ All files pass JSDoc linting\x1b[0m');
        console.log(`  ${result.totalFiles} files checked`);
        return;
    }

    for (const file of filesWithIssues) {
        console.log(`\n\x1b[4m${file.file}\x1b[0m`);
        for (const issue of file.issues) {
            console.log(formatIssueText(issue));
        }
    }

    console.log('');
    console.log('\x1b[1m' + '═'.repeat(60) + '\x1b[0m');

    const errorColor = result.totalErrors > 0 ? '\x1b[31m' : '\x1b[32m';
    const warningColor = result.totalWarnings > 0 ? '\x1b[33m' : '\x1b[32m';

    console.log(
        `${errorColor}${result.totalErrors} error(s)\x1b[0m, ` +
        `${warningColor}${result.totalWarnings} warning(s)\x1b[0m in ` +
        `${result.filesWithIssues}/${result.totalFiles} files`
    );

    if (result.totalErrors > 0) {
        console.log('\n\x1b[31m✗ JSDoc linting failed\x1b[0m');
    }
}

/**
 * Reports lint results in JSON format to stdout.
 *
 * @param result - The lint result to report
 */
export function reportJSON(result: LintResult): void {
    console.log(JSON.stringify(result, null, 2));
}

/**
 * Reports lint results in GitHub Actions format.
 *
 * @param result - The lint result to report
 */
export function reportGitHub(result: LintResult): void {
    for (const file of result.files) {
        for (const issue of file.issues) {
            console.log(formatIssueGitHub(issue));
        }
    }

    if (result.totalErrors > 0 || result.totalWarnings > 0) {
        console.log(
            `::notice::JSDoc linting: ${result.totalErrors} error(s), ` +
            `${result.totalWarnings} warning(s) in ${result.filesWithIssues}/${result.totalFiles} files`
        );
    } else {
        console.log(`::notice::JSDoc linting passed: ${result.totalFiles} files checked`);
    }
}

/**
 * Reports lint results in the specified format.
 *
 * @param result - The lint result to report
 * @param format - The output format
 */
export function report(result: LintResult, format: 'text' | 'json' | 'github'): void {
    switch (format) {
        case 'json':
            reportJSON(result);
            break;
        case 'github':
            reportGitHub(result);
            break;
        case 'text':
        default:
            reportText(result);
            break;
    }
}
