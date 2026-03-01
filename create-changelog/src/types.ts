/**
 * Type definitions for create-changelog action.
 *
 * @module types
 */

import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

/**
 * Raw input type as parsed from the schema.
 * Uses simple types that are later converted to internal types.
 */
export type RawInputs = InferInputs<typeof inputsSchema>;

/**
 * Represents a parsed git commit with conventional commit information.
 *
 * This class stores all metadata about a commit including author information,
 * conventional commit parsing results (type, scope, description, breaking changes),
 * associated GitHub issues, and release tag information.
 */
export class Commit {
    hash: string | null = null;
    extra_hashes: string[] = [];
    author: string | null = null;
    author_name: string | null = null;
    author_email: string | null = null;
    gh_name: string | null = null;
    gh_username: string | null = null;
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
    gh_issue_username: string | null = null;

    // delimiter (git tag or version pattern)
    tag: string | null = null;
    is_parent_release = false;

    // diff statistics (populated when sort-by is lines-based)
    lines_added = 0;
    lines_deleted = 0;
    lines_changed = 0;
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
    commits_perc = 0;
    is_owner = false;
    is_admin = false;
    is_affiliated = false;
    is_regular = true;
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
 * Configuration inputs for the create-changelog action.
 */
export interface Inputs {
    /** Path to the source repository */
    source_dir: string;
    /** Pattern to match version strings in commit messages */
    version_pattern: RegExp;
    /** Pattern to match version tags */
    tag_pattern: RegExp;
    /** Path where the changelog will be written */
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
    sort_by: SortByOption;
    repo_branch?: string;
    repoUrl?: string;
    repoOwner?: string;
    repoName?: string;
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
