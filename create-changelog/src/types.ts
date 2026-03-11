/**
 * Type definitions for create-changelog action.
 *
 * @module types
 */

/**
 * Represents a parsed git commit with conventional commit information.
 *
 * This class stores all metadata about a commit including author information,
 * conventional commit parsing results (type, scope, description, breaking changes),
 * associated GitHub issues, and release tag information.
 */
export class Commit {
    hash: string | null = null;
    extraHashes: string[] = [];
    author: string | null = null;
    authorName: string | null = null;
    authorEmail: string | null = null;
    ghName: string | null = null;
    ghUsername: string | null = null;
    date: string | null = null;
    message = '';

    // conventional fields
    subject: string | null = null;
    type: string | null = null;
    scope: string | null = null;
    description: string | null = null;
    body = '';
    footers: Record<string, string> = {};
    breaking = false;

    // Extensions to conventional fields (#<tag-expr>)
    tags: string[] = [];

    // whether the commit is conventional or not
    conventional = true;

    // issue info
    issue: string | null = null;
    ghIssueUsername: string | null = null;

    // delimiter (git tag or version pattern)
    tag: string | null = null;
    isParentRelease = false;

    // diff statistics (populated when sort-by is lines-based)
    linesAdded = 0;
    linesDeleted = 0;
    linesChanged = 0;
}

/**
 * Represents a GitHub user with contribution statistics.
 *
 * This class stores information about a contributor including their
 * GitHub username, display name, commit count, and repository role
 * (owner, admin, affiliated, or regular contributor).
 */
export class GitHubUser {
    username: string | null = null;
    name: string | null = null;
    commits = 0;
    commitsPerc = 0;
    isOwner = false;
    isAdmin = false;
    isAffiliated = false;
    isRegular = true;
}

/**
 * Represents a Git tag with its name and commit SHA.
 */
export interface Tag {
    /** Tag name (e.g., 'v1.0.0') */
    name: string;
    /** Commit SHA the tag points to */
    sha: string;
}

/**
 * Valid modes for the check-unconventional input.
 *
 * - 'false': Disable checking (no warnings or errors)
 * - 'warn': Emit warnings for unconventional commits
 * - 'error': Fail the action if unconventional commits are found
 */
export type CheckUnconventionalMode = 'false' | 'warn' | 'error';

/**
 * Valid sorting options for changelog commits within each scope.
 *
 * - 'most-changes-first': Sort by lines changed, most changes first (default)
 * - 'latest-first': Sort by date, newest first
 * - 'oldest-first': Sort by date, oldest first
 */
export type SortByOption = 'most-changes-first' | 'latest-first' | 'oldest-first';

/**
 * Parses a sort-by input value into its validated option.
 *
 * @param value - The input value to parse
 * @returns The normalized SortByOption, defaulting to 'most-changes-first' for invalid values
 */
export function parseSortByOption(value: string): SortByOption {
    const normalized = value.toLowerCase().trim();
    if (['most-changes-first', 'latest-first', 'oldest-first'].includes(normalized)) {
        return normalized as SortByOption;
    }
    return 'most-changes-first';
}

/**
 * Parses a check-unconventional mode value.
 *
 * Handles backwards compatibility with boolean values ('true'/'false')
 * and the new mode values ('warn'/'error').
 *
 * @param value - The input value to parse
 * @returns The normalized CheckUnconventionalMode
 */
export function parseCheckUnconventionalMode(value: string): CheckUnconventionalMode {
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
 * Represents categorized changes for the changelog output.
 */
export interface Changes {
    /**
     * Changes grouped by type, then by scope.
     * Structure: { [type]: { [scope]: Commit[] } }
     */
    [type: string]: {
        [scope: string]: Commit[];
    };
}
