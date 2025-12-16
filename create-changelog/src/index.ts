import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as exec from '@actions/exec';
import * as axios from 'axios';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';

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
interface Tag {
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
type CheckUnconventionalMode = 'false' | 'warn' | 'error';

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
interface Inputs {
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
 * Gets the current Git branch name.
 *
 * @param projectPath - Path to the Git repository
 * @returns Current branch name or null if not found
 */
async function getCurrentBranch(projectPath: string): Promise<string | null> {
    let branch = '';
    try {
        const exitCode = await exec.exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: projectPath,
            listeners: {
                stdout: (data: Buffer) => {
                    branch += data.toString();
                }
            }
        });
        if (exitCode === 0) {
            branch = branch.trim();
            if (branch.startsWith('heads/')) {
                branch = branch.slice(6);
            }
            return branch;
        } else {
            console.error(`Git command execution failed with exit code ${exitCode}`);
        }
    } catch (error) {
        console.error(`Error executing Git command: ${(error as Error).message}`);
    }
    return null;
}

/**
 * Gets the GitHub remote URL from a Git repository.
 *
 * @param gitPath - Path to the Git repository
 * @returns GitHub repository URL or null if not found
 */
async function getGithubRemote(gitPath: string): Promise<string | null> {
    let remoteOutput = '';
    try {
        // Get the remote URL using the git command
        await exec.exec('git remote -v', [], {
            cwd: gitPath,
            listeners: {
                stdout: (data: Buffer) => {
                    remoteOutput += data.toString();
                }
            }
        });

        // Parse the output to find the GitHub remote URL
        const remoteLines = remoteOutput.trim().split('\n');
        for (const line of remoteLines) {
            if (line.startsWith('origin')) {
                const parts = line.split(/\s+/);
                if (parts.length >= 2 && parts[1].startsWith('https://github.com/')) {
                    let url = parts[1];
                    if (url.endsWith('.git')) {
                        url = url.slice(0, -4);
                    }
                    return url;
                }
            }
        }
    } catch (error) {
        console.error(`Failed to execute 'git remote -v' command: ${(error as Error).message}`);
        return null;
    }

    return null;
}

/**
 * Extracts the repository owner from a GitHub URL.
 *
 * @param repoUrl - GitHub repository URL
 * @returns Repository owner name or null if not found
 */
function getGithubRepoOwner(repoUrl: string | undefined): string | null {
    if (!repoUrl) {
        return null;
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '');

    // Extract the repository owner
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/');
        if (pathParts.length >= 2) {
            return pathParts[1];
        }
    }
    return null;
}

/**
 * Extracts the repository name from a GitHub URL.
 *
 * @param repoUrl - GitHub repository URL
 * @returns Repository name or null if not found
 */
function getGithubRepoName(repoUrl: string | undefined): string | null {
    if (!repoUrl) {
        return null;
    }

    // Remove leading "https://" or "http://" if present
    repoUrl = repoUrl.replace(/^https?:\/\//, '');

    // Extract the repository name
    if (repoUrl.startsWith('github.com/')) {
        const pathParts = repoUrl.split('/');
        if (pathParts.length >= 3) {
            return pathParts[2];
        }
    }
    return null;
}

/**
 * Adjusts input parameters by filling in missing values from environment.
 *
 * @param inputs - Input configuration to adjust
 */
async function adjustParameters(inputs: Inputs): Promise<void> {
    const envKeys = ['GITHUB_BASE_REF', 'GITHUB_REF_NAME'];
    for (const envKey of envKeys) {
        if (!inputs.repo_branch) {
            inputs.repo_branch = process.env[envKey];
            if (inputs.repo_branch) {
                console.log(`Repository Branch ${inputs.repo_branch} from ${envKey}`);
                break;
            }
        }
    }
    if (!inputs.repo_branch) {
        inputs.repo_branch = (await getCurrentBranch(inputs.source_dir)) || undefined;
        if (inputs.repo_branch) {
            console.log(`Repository Branch ${inputs.repo_branch} from local path`);
        }
    }
    if (!inputs.github_token) {
        inputs.github_token = process.env['GITHUB_TOKEN'] || '';
        if (inputs.github_token) {
            console.log(`Access token **** from GITHUB_TOKEN`);
        }
    }

    inputs.repoUrl = (await getGithubRemote(inputs.source_dir)) || undefined;
    inputs.repoOwner = getGithubRepoOwner(inputs.repoUrl) || undefined;
    inputs.repoName = getGithubRepoName(inputs.repoUrl) || undefined;
}

/**
 * Gets local Git tags matching a pattern.
 *
 * @param projectPath - Path to the Git repository
 * @param tagPattern - Regex pattern to filter tags
 * @returns Array of matching tags with names and SHAs
 */
async function getLocalTags(projectPath: string, tagPattern: RegExp): Promise<Tag[]> {
    const tags: Tag[] = [];
    const commonExecOptions = { cwd: projectPath };

    // Get local tags
    let tagsOutput = '';
    await exec.exec('git', ['tag', '-l'], {
        ...commonExecOptions,
        listeners: {
            stdout: (data: Buffer) => {
                tagsOutput += data.toString();
            }
        }
    });

    const tagLines = tagsOutput.split('\n').filter(line => line.trim() !== '');
    for (const tag of tagLines) {
        if (tagPattern.test(tag)) {
            let commitOutput = '';
            await exec.exec('git', ['rev-list', '-n', '1', tag], {
                ...commonExecOptions,
                listeners: {
                    stdout: (data: Buffer) => {
                        commitOutput += data.toString();
                    }
                }
            });
            const commitId = commitOutput.trim();
            tags.push({ name: tag, sha: commitId });
        }
    }

    // Get remote tags
    let lsRemoteOutput = '';
    await exec.exec('git', ['ls-remote', '--tags'], {
        ...commonExecOptions,
        listeners: {
            stdout: (data: Buffer) => {
                lsRemoteOutput += data.toString();
            }
        }
    });

    const remoteLines = lsRemoteOutput.split('\n').filter(line => line.trim() !== '');
    for (const line of remoteLines) {
        const parts = line.split(/\s+/);
        if (parts.length === 2 && parts[1].startsWith('refs/tags/')) {
            const commitId = parts[0];
            const tag = parts[1].split('/').pop();
            if (tag && tagPattern.test(tag)) {
                tags.push({ name: tag, sha: commitId });
            }
        }
    }

    return tags;
}

/**
 * Fetches tags from GitHub API matching a pattern.
 *
 * @param repoUrl - GitHub repository URL
 * @param tagPattern - Regex pattern to filter tags
 * @param accessToken - GitHub access token for API requests
 * @returns Array of matching tags
 */
async function getGithubTags(repoUrl: string | undefined, tagPattern: RegExp, accessToken: string): Promise<Tag[]> {
    if (!repoUrl) {
        return [];
    }

    const url = `https://api.github.com/repos/${getGithubRepoOwner(repoUrl)}/${getGithubRepoName(repoUrl)}/tags`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'My-User-Agent'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const tags: Tag[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const params = {
            page: page,
            per_page: perPage
        };

        try {
            const response = await axios.default.get(url, { headers, params });
            if (response.status === 200) {
                const pageTags = response.data;
                if (pageTags.length > 0) {
                    for (const pageTag of pageTags) {
                        if (tagPattern.test(pageTag.name)) {
                            tags.push({ name: pageTag.name, sha: pageTag.commit.sha });
                        }
                    }
                    page += 1;
                } else {
                    break;
                }
            } else {
                console.error(`Error: ${response.status} - ${response.statusText}`);
                return tags;
            }
        } catch (error) {
            const axiosError = error as { response?: { status: number; statusText: string } };
            if (axiosError.response) {
                console.error(`Error: ${axiosError.response.status} - ${axiosError.response.statusText}`);
            } else {
                console.error(`Error: ${(error as Error).message}`);
            }
            return tags;
        }
    }

    return tags;
}

/**
 * Removes duplicate tags based on specified fields.
 *
 * @param tags - Array of tags to deduplicate
 * @param comparisonFields - Fields to use for comparison
 * @returns Array of unique tags
 */
function removeTagDuplicates(tags: Tag[], comparisonFields: (keyof Tag)[]): Tag[] {
    const uniqueItems: Tag[] = [];
    const seenValues = new Set<string>();

    for (const tag of tags) {
        // Generate a string representation of the comparison fields
        const tagStrings = comparisonFields.map(field => tag[field]).join('|');

        // Check if the comparison values have been seen before
        if (!seenValues.has(tagStrings)) {
            uniqueItems.push(tag);
            seenValues.add(tagStrings);
        }
    }

    return uniqueItems;
}

/**
 * Processes tags from local and remote sources.
 *
 * Fetches local tags first, and if none found, fetches from GitHub.
 * Removes duplicates based on name and SHA.
 *
 * @param projectPath - Path to the Git repository
 * @param tagPattern - Regex pattern to filter tags
 * @param repoUrl - GitHub repository URL
 * @param accessToken - GitHub access token
 * @returns Array of unique tags
 */
async function processTags(projectPath: string, tagPattern: RegExp, repoUrl: string | undefined, accessToken: string): Promise<Tag[]> {
    function fnlog(msg: string): void {
        trace_commands.log('processTags: ' + msg);
    }

    let tags = await getLocalTags(projectPath, tagPattern);
    fnlog(`${tags.length} local tags`);

    if (tags.length === 0) {
        const repoTags = await getGithubTags(repoUrl, tagPattern, accessToken);
        fnlog(`${repoTags.length} repo tags`);
        tags = tags.concat(repoTags);
    }

    tags = removeTagDuplicates(tags, ['name', 'sha']);
    fnlog(`${tags.length} tags`);
    return tags;
}

/**
 * Gets the author username of a GitHub issue.
 *
 * @param repoUrl - GitHub repository URL
 * @param issueNumber - Issue number
 * @param accessToken - GitHub access token for API requests
 * @returns Issue author username or null if not found
 */
async function getIssueAuthor(repoUrl: string, issueNumber: string, accessToken: string): Promise<string | null> {
    // Extract the owner and repository name from the URL
    const urlParts = repoUrl.replace(/\/$/, '').split('/');
    const owner = urlParts[urlParts.length - 2];
    const repository = urlParts[urlParts.length - 1];

    // Construct the GitHub API URL for the issue
    const url = `https://api.github.com/repos/${owner}/${repository}/issues/${issueNumber}`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const issueData = response.data;
            const author = issueData.user.login;
            return author;
        }
    } catch (error) {
        console.error(`Error fetching issue author: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Checks if a string is a valid conventional commit type.
 *
 * @param s - String to validate
 * @returns True if the string is a valid commit type
 */
function isValidType(s: string): boolean {
    // A valid type according to `normalizeType`
    // Used to identify tags that can be converted to types
    const recognizedTypes = [
        'doc',
        'docs',
        'documentation',
        'fix',
        'fixes',
        'bugfix',
        'chore',
        'work',
        'chores',
        'maintenance',
        'feat',
        'feature',
        'refactor',
        'cleanup',
        'perf',
        'performance',
        'test',
        'testing',
        'tests',
        'release',
        'version',
        'ci',
        'integration',
        'breaking',
        'break',
        'revert',
        'undo',
        'style',
        'build',
        'improvement'
    ];
    return recognizedTypes.includes(s);
}

/**
 * Normalizes a commit type to a standard format.
 *
 * @param s - Type string to normalize
 * @returns Normalized type string
 */
function normalizeType(s: string | null): string {
    if (!s) {
        return 'other';
    }

    // The units of information that make up Conventional Commits MUST NOT be treated as case sensitive
    // by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
    // BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE
    const categoryMapping: Record<string, string> = {
        'doc': 'docs',
        'documentation': 'docs',
        'fixes': 'fix',
        'bugfix': 'fix',
        'work': 'chore',
        'chores': 'chore',
        'maintenance': 'chore',
        'feature': 'feat',
        'cleanup': 'refactor',
        'performance': 'perf',
        'testing': 'test',
        'tests': 'test',
        'version': 'release',
        'integration': 'ci',
        'break': 'breaking',
        'undo': 'revert'
    };
    return categoryMapping[s.toLowerCase()] || s;
}

/**
 * Parses conventional commit fields from a commit message.
 *
 * Extracts type, scope, description, body, footers, and breaking change
 * information from the commit message. Also identifies version tags.
 *
 * @param commit - Commit to populate
 * @param repoUrl - GitHub repository URL
 * @param versionPattern - Pattern to identify release commits
 * @param tags - Array of version tags
 * @returns The populated commit
 */
async function populateConventional(commit: Commit, repoUrl: string | undefined, versionPattern: RegExp, tags: Tag[]): Promise<Commit> {
    for (const line of commit.message.split('\n')) {
        if (!line) {
            continue;
        }

        if (!commit.subject) {
            // Is subject
            commit.subject = line;
            const m = line.match(/([ \w_-]+)(\(([ \w_-]+)\))?(!?): ([^\n]*)\n?(.*)/);
            if (m) {
                // conventional commit
                commit.type = normalizeType(m[1]);
                commit.scope = m[3];
                commit.description = m[5];
                commit.breaking = m[4] === '!';
                commit.conventional = true;
            } else {
                // regular commit
                commit.description = commit.subject;
                commit.type = 'other';
                commit.scope = null;
                commit.breaking = commit.subject.includes('BREAKING');
                commit.conventional = false;
            }
            continue;
        }

        // Subject populated: parse as body, footer, or tag
        // This regular expression matches lines that represent footers in a commit message.
        // It matches the following patterns:
        // 1. `([^ ]+): ` - A key followed by a colon and a space (e.g., "Fixes: ")
        // 2. `([^ ]+) #` - A key followed by a space and a hash symbol (e.g., "Issue #")
        // 3. `(BREAKING CHANGE): ` - The literal string "BREAKING CHANGE" followed by a colon and a space
        const footerKeyRegex = /^(([^ ]+): )|(([^ ]+) #)|((BREAKING CHANGE): )/;
        const m = line.match(footerKeyRegex);
        if (m) {
            const footerKey = m[1] ? m[2] : m[3] ? m[4] : m[5] ? m[6] : null;
            if (footerKey) {
                const offset = m[1] || m[5] ? 2 : 1;
                commit.footers[footerKey] = line.slice(footerKey.length + offset).trim();
                if (footerKey.toLowerCase().startsWith('breaking')) {
                    commit.breaking = true;
                }
            }
            continue;
        }

        // Check for a footer with no key and value
        if (['breaking', 'breaking-change', 'breaking change'].includes(line.toLowerCase())) {
            // footer with no key and value
            // -> the whole message is breaking change footer
            commit.breaking = true;
            continue;
        }

        // #<tag-expr>
        // The commit can contain a tag, which is just a string identifier
        // for whatever purpose the user wants to use it for.
        const tagRegex = /^\s*#(\S+)\s*$/;
        const tagMatch = line.match(tagRegex);
        if (tagMatch) {
            commit.tags.push(tagMatch[1]);
            continue;
        }

        // No special syntax: this is a line from the body
        if (!commit.body) {
            commit.body += line;
        } else {
            commit.body += '\n' + line;
        }
    }

    const issueFooterKeys = ['Close', 'Closes', 'Closed', 'close', 'closes', 'closed',
        'Fix', 'Fixes', 'Fixed', 'fix', 'fixes', 'fixed',
        'Resolve', 'Resolves', 'Resolved', 'resolve', 'resolves', 'resolved'];
    for (const [key, value] of Object.entries(commit.footers)) {
        if (issueFooterKeys.includes(key) && value.startsWith('#')) {
            commit.issue = value.slice(1);
            if (repoUrl) {
                commit.gh_issue_username = await getIssueAuthor(repoUrl, commit.issue, '');
            }
            break;
        }
    }

    for (const tag of tags) {
        if (commit.hash === tag.sha) {
            commit.tag = tag.name;
            break;
        }
    }

    // Attribute type from one of the tags if possible
    if (!commit.type || commit.type === 'other') {
        for (const tag of commit.tags) {
            if (isValidType(tag)) {
                commit.type = normalizeType(tag);
                break;
            }
        }
    }

    commit.is_parent_release = false;
    if (commit.tag !== null) {
        console.log(`Stopping at commit id ${commit.hash?.slice(0, 8)} (tag ${commit.tag})`);
        commit.is_parent_release = true;
    } else {
        let matches = commit.description?.match(versionPattern);
        if (matches) {
            console.log(`Stopping at commit id ${commit.hash?.slice(0, 8)} (description: ${commit.description})`);
            commit.is_parent_release = true;
        } else {
            matches = commit.subject?.match(versionPattern);
            if (matches) {
                console.log(`Stopping at commit id ${commit.hash?.slice(0, 8)} (subject: ${commit.subject})`);
                commit.is_parent_release = true;
            }
        }
    }

    return commit;
}

/**
 * Fetches and parses commits from the local Git repository.
 *
 * @param projectPath - Path to the Git repository
 * @param repoUrl - GitHub repository URL
 * @param versionPattern - Pattern to identify release commits
 * @param tags - Array of version tags
 * @returns Array of parsed commits
 */
async function getLocalCommits(projectPath: string, repoUrl: string | undefined, versionPattern: RegExp, tags: Tag[]): Promise<Commit[]> {
    const commits: Commit[] = [];
    let commitLogOutput = '';

    await exec.exec('git', ['--no-pager', 'log'], {
        cwd: projectPath,
        listeners: {
            stdout: (data: Buffer) => {
                commitLogOutput += data.toString();
            }
        }
    });

    const commitLogLines = commitLogOutput.split('\n');
    let commit = new Commit();

    for (const line of commitLogLines) {
        if (line === '') continue;

        if (line.startsWith('commit ') && !line.slice(7).includes(' ')) {
            if (commit.hash) {
                commit = await populateConventional(commit, repoUrl, versionPattern, tags);
                const isDetail = commit.subject?.startsWith('[') && commit.subject?.includes(']');
                if (!isDetail) {
                    commits.push(commit);
                    if (commits.length === 1) {
                        commits[0].is_parent_release = false;
                    } else if (commits[commits.length - 1].is_parent_release) {
                        break;
                    }
                }
                commit = new Commit();
            }
            commit.hash = line.slice(7);
        } else if (commit.hash && !commit.author && line.startsWith('Author: ')) {
            commit.author = line.slice(8);
            const p = commit.author.indexOf(' <');
            if (p !== -1) {
                commit.author_name = commit.author.slice(0, p);
                commit.author_email = commit.author.slice(p + 2, -1);
            }
        } else if (commit.author && !commit.date && line.startsWith('Date: ')) {
            commit.date = line.slice(6);
        } else if (commit.date && line.startsWith('    ')) {
            if (commit.message !== '') {
                commit.message += '\n' + line.slice(4);
            } else {
                commit.message += line.slice(4);
            }
        }
    }

    return commits;
}

/**
 * Fetches diff statistics for a list of commits using git show --numstat.
 *
 * Populates the lines_added, lines_deleted, and lines_changed properties
 * for each commit. This is only called when sort-by is 'lines-asc' or 'lines-desc'.
 *
 * @param projectPath - Path to the git repository
 * @param commits - Array of commits to populate with diff stats
 */
async function populateDiffStats(projectPath: string, commits: Commit[]): Promise<void> {
    for (const commit of commits) {
        if (!commit.hash) continue;

        let statOutput = '';
        try {
            await exec.exec('git', ['show', '--numstat', '--format=', commit.hash], {
                cwd: projectPath,
                listeners: {
                    stdout: (data: Buffer) => {
                        statOutput += data.toString();
                    }
                },
                silent: true
            });

            // Parse numstat output: <added>\t<deleted>\t<filename>
            let added = 0;
            let deleted = 0;
            for (const line of statOutput.split('\n')) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const lineAdded = parseInt(parts[0], 10);
                    const lineDeleted = parseInt(parts[1], 10);
                    // Binary files show '-' which parseInt returns NaN for
                    if (!isNaN(lineAdded)) added += lineAdded;
                    if (!isNaN(lineDeleted)) deleted += lineDeleted;
                }
            }

            commit.lines_added = added;
            commit.lines_deleted = deleted;
            commit.lines_changed = added + deleted;
            trace_commands.log(`Commit ${commit.hash?.slice(0, 7)}: +${added} -${deleted} (${added + deleted} total)`);
        } catch (error) {
            trace_commands.log(`Error fetching diff stats for ${commit.hash}: ${(error as Error).message}`);
        }
    }
}

/**
 * Removes duplicate commits and merges their metadata.
 *
 * Commits are considered duplicates if they have the same type, scope,
 * and description. Duplicate metadata (body, footers, tags, hashes)
 * is merged into the first occurrence.
 *
 * @param commits - Array of commits to deduplicate
 * @returns Array of unique commits with merged metadata
 */
function removeCommitDuplicates(commits: Commit[]): Commit[] {
    const uniqueCommits: Commit[] = [];
    const visitedCommits = new Set<string>();

    for (const commit of commits) {
        const commitStr = JSON.stringify([commit.type, commit.scope, commit.description]);
        const isNewCommit = !visitedCommits.has(commitStr);
        if (isNewCommit) {
            uniqueCommits.push(commit);
            visitedCommits.add(commitStr);
            continue;
        }

        // The commit has already been included in the list
        // Find the commit we put on the list
        let idx = -1;
        for (let i = 0; i < uniqueCommits.length; i++) {
            const otherCommitStr = JSON.stringify([uniqueCommits[i].type, uniqueCommits[i].scope, uniqueCommits[i].description]);
            if (commitStr === otherCommitStr) {
                idx = i;
                break;
            }
        }
        const cannotFindCommit = idx === -1;
        if (cannotFindCommit) {
            continue;
        }

        // Merge the commit with the one we put on the list
        if (uniqueCommits[idx].body !== commit.body) {
            uniqueCommits[idx].body += commit.body;
        }
        // Merge footers
        for (const [footerKey, footerValue] of Object.entries(commit.footers)) {
            if (!uniqueCommits[idx].footers.hasOwnProperty(footerKey)) {
                uniqueCommits[idx].footers[footerKey] = footerValue;
            }
        }
        // Merge tags
        for (const tag of commit.tags) {
            if (!uniqueCommits[idx].tags.includes(tag)) {
                uniqueCommits[idx].tags.push(tag);
            }
        }
        // Merge breaking
        if (commit.breaking) {
            uniqueCommits[idx].breaking = true;
        }
        // Merge extra hashes
        if (commit.hash) {
            uniqueCommits[idx].extra_hashes.push(commit.hash);
        }
    }

    return uniqueCommits;
}

/**
 * Fetches commits from the GitHub API.
 *
 * @param repoUrl - GitHub repository URL
 * @param branch - Branch name to fetch commits from
 * @param versionPattern - Pattern to identify release commits
 * @param tags - Array of tags to check against commits
 * @param accessToken - GitHub access token
 * @returns Array of commits from the GitHub API
 */
async function getGithubCommits(repoUrl: string | undefined, branch: string | undefined, versionPattern: RegExp, tags: Tag[], accessToken: string): Promise<Commit[]> {
    if (!repoUrl || !branch) {
        return [];
    }

    const commits: Commit[] = [];
    const url = `https://api.github.com/repos/${getGithubRepoOwner(repoUrl)}/${getGithubRepoName(repoUrl)}/commits`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'My-User-Agent',
        'sha': branch
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    let page = 1;
    while (commits.length === 0 || !commits[commits.length - 1].is_parent_release) {
        const params = {
            page: page,
            per_page: 100
        };

        try {
            const response = await axios.default.get(url, { headers, params });
            if (response.status === 200) {
                const pageCommits = response.data;
                if (pageCommits.length > 0) {
                    for (const pageCommit of pageCommits) {
                        let commit = new Commit();
                        commit.hash = pageCommit.sha;
                        commit.author = `${pageCommit.commit.committer.name} <${pageCommit.commit.committer.email}>`;
                        commit.author_name = pageCommit.commit.committer.name;
                        commit.author_email = pageCommit.commit.committer.email;
                        if (pageCommit.committer?.login) {
                            commit.gh_name = await getGithubProfileName(pageCommit.committer.login, accessToken);
                            commit.gh_username = pageCommit.committer.login;
                        }
                        commit.date = pageCommit.commit.committer.date;
                        commit.message = pageCommit.commit.message;
                        commit = await populateConventional(commit, repoUrl, versionPattern, tags);
                        const isDetail = commit.subject?.startsWith('[') && commit.subject?.includes(']');
                        if (!isDetail) {
                            commits.push(commit);
                            if (commits.length === 1) {
                                commits[0].is_parent_release = false;
                            } else if (commits[commits.length - 1].is_parent_release) {
                                break;
                            }
                        }
                    }
                    page += 1;
                } else {
                    break;
                }
            } else {
                core.error(`Error: ${response.status} - ${response.statusText}`);
                return commits;
            }
        } catch (error) {
            const axiosError = error as { response?: { status: number; statusText: string } };
            if (axiosError.response) {
                core.error(`Error: ${axiosError.response.status} - ${axiosError.response.statusText}`);
            } else {
                core.error(`Error: ${(error as Error).message}`);
            }
            return commits;
        }
    }

    return commits;
}

/**
 * Processes commits from local and remote sources.
 *
 * @param projectPath - Path to the Git repository
 * @param repoUrl - GitHub repository URL
 * @param versionPattern - Pattern to identify release commits
 * @param tags - Array of version tags
 * @param repoBranch - Branch name
 * @param accessToken - GitHub access token
 * @param checkUnconventional - Mode for handling unconventional commits
 * @returns Array of processed commits
 */
async function processCommits(projectPath: string, repoUrl: string | undefined, versionPattern: RegExp, tags: Tag[], repoBranch: string | undefined, accessToken: string, checkUnconventional: CheckUnconventionalMode): Promise<Commit[]> {
    function fnlog(msg: string): void {
        trace_commands.log('processCommits: ' + msg);
    }

    let commits = await getLocalCommits(projectPath, repoUrl, versionPattern, tags);

    if (checkUnconventional !== 'false') {
        const unconventionalCommits = commits.filter(commit => !commit.conventional);
        if (unconventionalCommits.length > 0) {
            const message = unconventionalCommits.length === 1
                ? `Commit "${unconventionalCommits[0].subject}" is not a conventional commit`
                : `${unconventionalCommits.length} unconventional commits`;

            if (checkUnconventional === 'error') {
                core.setFailed(message);
            } else {
                core.warning(message, { title: 'Conventional Commits' });
            }
        }
    }

    fnlog(`${commits.length} local commits`);

    if (commits.length === 0 || !commits[commits.length - 1].is_parent_release) {
        const commitHashes = new Set(commits.map(commit => commit.hash));
        const repoCommits = await getGithubCommits(repoUrl, repoBranch, versionPattern, tags, accessToken);
        fnlog(`${repoCommits.length} repo commits`);

        for (const repoCommit of repoCommits) {
            if (!commitHashes.has(repoCommit.hash)) {
                commits.push(repoCommit);
            }
        }

        fnlog(`${commits.length} total commits`);
    }

    commits = removeCommitDuplicates(commits);
    return commits;
}

/**
 * Fetches a user's display name from their GitHub profile.
 *
 * @param username - GitHub username
 * @param accessToken - GitHub access token
 * @returns Profile display name or null if not found
 */
async function getGithubProfileName(username: string, accessToken: string): Promise<string | null> {
    const url = `https://api.github.com/users/${username}`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const profileData = response.data;
            const githubProfileName = profileData.name;
            if (githubProfileName) {
                return githubProfileName;
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub profile name: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Finds a GitHub username by email address.
 *
 * @param email - Email address to search for
 * @param accessToken - GitHub access token
 * @returns GitHub username or null if not found
 */
async function getGithubUsername(email: string, accessToken: string): Promise<string | null> {
    const url = `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`;
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        const response = await axios.default.get(url, { headers });
        if (response.status === 200) {
            const searchResults = response.data;
            const items = searchResults.items;
            if (items && items.length > 0) {
                return items[0].login;
            }
        }
    } catch (error) {
        console.error(`Error fetching GitHub username: ${(error as Error).message}`);
    }

    return null;
}

/**
 * Populates GitHub usernames and names for all commits.
 *
 * Propagates username information to commits with matching email addresses.
 *
 * @param commits - Array of commits to populate
 * @param accessToken - GitHub access token
 */
async function populateGithubUsernames(commits: Commit[], accessToken: string): Promise<void> {
    for (const commit of commits) {
        if (!commit.gh_username) {
            continue;
        }
        let ghUsername = commit.gh_username;
        let ghName = commit.gh_name;
        if (!ghName) {
            ghName = await getGithubProfileName(ghUsername, accessToken);
        }
        if (ghName) {
            commit.gh_name = ghName;
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername;
                    commit2.gh_name = ghName;
                }
            }
        }
    }

    for (const commit of commits) {
        if (commit.gh_username) {
            continue;
        }
        if (!commit.author_email) {
            continue;
        }
        const ghUsername = await getGithubUsername(commit.author_email, accessToken);
        if (!ghUsername) {
            continue;
        }
        const ghName = await getGithubProfileName(ghUsername, accessToken);
        if (ghName) {
            commit.gh_username = ghUsername;
            commit.gh_name = ghName;
            for (const commit2 of commits) {
                if (commit2.author_email === commit.author_email) {
                    commit2.gh_username = ghUsername;
                    commit2.gh_name = ghName;
                }
            }
        }
    }
}

/**
 * Checks if a user has admin permissions on a repository.
 *
 * @param repoUrl - GitHub repository URL
 * @param username - GitHub username to check
 * @param accessToken - GitHub access token
 * @returns True if user has admin permissions
 */
async function checkGithubAdminPermissions(repoUrl: string, username: string, accessToken: string): Promise<boolean> {
    // Extract the repository owner and name from the URL
    const [, , , owner, repo] = repoUrl.replace(/\/$/, '').split('/');

    // Prepare the API endpoint URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/collaborators/${username}/permission`;

    // Set the request headers with the access token for authentication
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.default.get(apiUrl, { headers });
        if (response.status === 200) {
            const permissionData = response.data;
            if (permissionData.permission === 'admin') {
                return true;
            }
        }
    } catch (error) {
        console.error(`Error checking GitHub admin permissions: ${(error as Error).message}`);
    }

    return false;
}

/**
 * Checks if a user belongs to the repository owner's organization.
 *
 * @param repoUrl - GitHub repository URL
 * @param username - GitHub username to check
 * @param accessToken - GitHub access token
 * @returns True if user is in the owner's organization
 */
async function checkUserInstitution(repoUrl: string, username: string, accessToken: string): Promise<boolean> {
    // Extract the repository owner from the URL
    const [, , , owner] = repoUrl.replace(/\/$/, '').split('/');

    // Prepare the API endpoint URL to retrieve user information
    const apiUrl = `https://api.github.com/users/${username}`;

    // Set the authorization header with the access token
    const headers: Record<string, string> = {};
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    try {
        // Send the GET request to the API endpoint
        const response = await axios.default.get(apiUrl, { headers });
        if (response.status === 200) {
            const userData = response.data;
            const organizationsUrl = userData.organizations_url;

            // Retrieve all organizations using pagination
            const organizations: { login: string }[] = [];
            let page = 1;
            while (true) {
                const orgsUrl = `${organizationsUrl}?page=${page}&per_page=100`;
                const orgsResponse = await axios.default.get(orgsUrl, { headers });
                if (orgsResponse.status === 200) {
                    const orgsData = orgsResponse.data;
                    if (orgsData.length > 0) {
                        organizations.push(...orgsData);
                        page += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            // Check if the repository owner is in the organization list
            for (const org of organizations) {
                if (org.login === owner) {
                    return true;
                }
            }
        }
    } catch (error) {
        console.error(`Error checking user institution: ${(error as Error).message}`);
    }

    return false;
}

/**
 * Populates author data and issue information for commits.
 *
 * Creates GitHubUser entries for commit authors and issue reporters,
 * including permission and affiliation checks.
 *
 * @param commits - Array of commits to process
 * @param repoUrl - GitHub repository URL
 * @param repoOwner - Repository owner username
 * @param accessToken - GitHub access token
 * @returns Map of usernames to GitHubUser objects
 */
async function populateIssueData(commits: Commit[], repoUrl: string | undefined, repoOwner: string | undefined, accessToken: string): Promise<Record<string, GitHubUser>> {
    const authors: Record<string, GitHubUser> = {};

    if (!repoUrl) {
        return authors;
    }

    for (const commit of commits) {
        if (commit.gh_username) {
            if (!authors[commit.gh_username]) {
                authors[commit.gh_username] = new GitHubUser();
                authors[commit.gh_username].username = commit.gh_username;
                authors[commit.gh_username].name = commit.gh_name;
                authors[commit.gh_username].commits = 1;
                authors[commit.gh_username].commits_perc = 1 / commits.length;
                if (repoOwner && repoOwner === commit.gh_username) {
                    authors[commit.gh_username].is_owner = true;
                }
                authors[commit.gh_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_username, accessToken);
                authors[commit.gh_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_username, accessToken);
            } else {
                authors[commit.gh_username].commits += 1;
                authors[commit.gh_username].commits_perc = authors[commit.gh_username].commits / commits.length;
            }
        }

        if (commit.gh_issue_username) {
            if (!authors[commit.gh_issue_username]) {
                authors[commit.gh_issue_username] = new GitHubUser();
                authors[commit.gh_issue_username].username = commit.gh_issue_username;
                authors[commit.gh_issue_username].name = await getGithubProfileName(commit.gh_issue_username, accessToken);
                authors[commit.gh_issue_username].commits = 0;
                authors[commit.gh_issue_username].commits_perc = 0;
                if (repoOwner && repoOwner === commit.gh_issue_username) {
                    authors[commit.gh_issue_username].is_owner = true;
                }
                authors[commit.gh_issue_username].is_admin = await checkGithubAdminPermissions(repoUrl, commit.gh_issue_username, accessToken);
                authors[commit.gh_issue_username].is_affiliated = await checkUserInstitution(repoUrl, commit.gh_issue_username, accessToken);
            }
        }
    }

    return authors;
}

/**
 * Calculates a percentile value from an array of numbers.
 *
 * @param data - Array of numbers to calculate percentile from
 * @param percentile - Percentile to calculate (0-100)
 * @returns The calculated percentile value
 */
function calculatePercentile(data: number[], percentile: number): number {
    if (data.length === 0) {
        return 1;
    }

    const sortedData = data.slice().sort((a, b) => a - b);
    const index = (percentile / 100) * (sortedData.length - 1);

    if (Number.isInteger(index)) {
        return sortedData[index];
    } else {
        const lower = sortedData[Math.floor(index)];
        const upper = sortedData[Math.ceil(index)];
        return lower + (index % 1) * (upper - lower);
    }
}

/**
 * Identifies non-regular contributors based on commit statistics.
 *
 * Contributors are marked as non-regular if they are not admin/affiliated
 * and have fewer commits than the threshold.
 *
 * @param authors - Map of usernames to GitHubUser objects
 */
function identifyNonRegularContributors(authors: Record<string, GitHubUser>): void {
    // Create an array of commit counts
    const commitHist = Object.values(authors).map(author => author.commits);
    const commitSum = commitHist.reduce((sum, commits) => sum + commits, 0);
    const perc80 = calculatePercentile(commitHist, 80);

    for (const author of Object.values(authors)) {
        // 1. Author is not owner, admin, or affiliated
        if (author.is_admin || author.is_affiliated || author.is_owner) {
            author.is_regular = true;
            continue;
        }
        // 2. Has less than 10% of commits
        if (author.commits < commitSum / 10) {
            author.is_regular = false;
            continue;
        }
        // 3. Has 3 or fewer commits
        if (author.commits <= 3) {
            author.is_regular = false;
            continue;
        }
        // 4. Is not among 20% top contributors
        if (author.commits < perc80) {
            author.is_regular = false;
            continue;
        }
        author.is_regular = true;
    }
}

/**
 * Returns an emoji icon for a commit type.
 *
 * @param s - Commit type string
 * @returns Emoji icon representing the commit type
 */
function iconFor(s: string | null): string {
    // https://github.com/favoloso/conventional-changelog-emoji#available-emojis
    const m: Record<string, string> = {
        'docs': '📖',
        'fix': '🐛',
        'style': '🎨',
        'chore': '🏗️',
        'build': '📦️',
        'feat': '🚀',
        'refactor': '♻️',
        'perf': '⚡️',
        'test': '🧪',
        'release': '🔖',
        'ci': '🚦',
        'improvement': '🛠️',
        'breaking': '🚨',
        'revert': '🔙',
        'other': '💬'
    };
    if (s === null) {
        return '💬';
    }
    return m.hasOwnProperty(s) ? m[s] : s;
}

/**
 * Returns a rotating icon for feature commits in the changelog.
 *
 * Cycles through sparkle/star icons (✨, 💫, 🌟) to add visual variety
 * when listing multiple feature commits in the generated changelog.
 *
 * @returns An emoji icon string that cycles through available feature icons
 */
export function featureSubjectIcon(): string {
    const icons = ['✨', '💫', '🌟'];
    const icon = icons[featureSubjectIcon.count % icons.length];
    featureSubjectIcon.count += 1;
    return icon;
}

// Initialize the count property
featureSubjectIcon.count = 0;

/**
 * Capitalizes the first letter of each sentence in a text.
 *
 * @param text - Text to capitalize
 * @returns Text with capitalized sentences
 */
function capitalizeSentences(text: string): string {
    const sentences = text.split('. ');
    let result = '';
    for (let sentence of sentences) {
        sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
        sentence = sentence.trim();
        result += sentence;
        if (!sentence.endsWith('.')) {
            result += '. ';
        }
    }
    return result.trim();
}

/**
 * A mapping of commit types to scopes to commits for changelog generation.
 *
 * The first level key is the commit type (e.g., 'feat', 'fix', 'docs').
 * The second level key is the scope (or 'null' for unscoped commits).
 * The value is an array of commits with that type and scope.
 */
export interface Changes {
    [type: string]: {
        [scope: string]: Commit[];
    };
}

/**
 * Filters changes object based on include/exclude type criteria.
 *
 * Applies type filtering to the categorized changes. If includeTypes is non-empty,
 * only those types are kept. Then excludeTypes are removed from the result.
 *
 * @param changes - The categorized changes object mapping types to scopes to commits
 * @param includeTypes - Set of types to include (empty means include all)
 * @param excludeTypes - Set of types to exclude
 * @returns A new Changes object with filtered types
 */
export function filterChangesByType(
    changes: Changes,
    includeTypes: Set<string>,
    excludeTypes: Set<string>
): Changes {
    const filtered: Changes = {};
    for (const [type, scopeMap] of Object.entries(changes)) {
        // If includeTypes is specified and non-empty, check if this type is included
        if (includeTypes.size > 0 && !includeTypes.has(type)) {
            continue;
        }
        // Check if this type is excluded
        if (excludeTypes.has(type)) {
            continue;
        }
        // Type passes both filters
        filtered[type] = scopeMap;
    }
    return filtered;
}

/**
 * Compares two commits based on the specified sort option.
 *
 * @param a - First commit to compare
 * @param b - Second commit to compare
 * @param sortBy - The sorting option to use
 * @returns Negative if a should come first, positive if b should come first, 0 if equal
 */
export function compareCommits(a: Commit, b: Commit, sortBy: SortByOption): number {
    switch (sortBy) {
        case 'oldest-first':
            // Oldest first - compare dates ascending
            return new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
        case 'latest-first':
            // Newest first - compare dates descending
            return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        case 'most-changes-first':
            // Most changes first (default)
            return b.lines_changed - a.lines_changed;
        default:
            return 0;
    }
}

/**
 * Sorts commits within each type of the changes object.
 *
 * For each type, all commits across all scopes are collected and sorted together.
 * The scope map is then rebuilt in sorted order, ensuring that:
 * 1. Scopes appear in the order their first commit appears after sorting
 * 2. Commits within each scope maintain their relative sorted order
 *
 * @param changes - The categorized changes object
 * @param sortBy - The sorting option to use
 * @returns The changes object with commits sorted across all scopes
 */
export function sortChanges(changes: Changes, sortBy: SortByOption): Changes {
    for (const type of Object.keys(changes)) {
        // Collect all commits for this type with their scopes
        const allCommits: { scope: string; commit: Commit }[] = [];
        for (const scope of Object.keys(changes[type])) {
            for (const commit of changes[type][scope]) {
                allCommits.push({ scope, commit });
            }
        }

        // Sort all commits together
        allCommits.sort((a, b) => compareCommits(a.commit, b.commit, sortBy));

        // Rebuild the scope map in sorted order
        const newScopeMap: { [scope: string]: Commit[] } = {};
        for (const { scope, commit } of allCommits) {
            if (!newScopeMap[scope]) {
                newScopeMap[scope] = [];
            }
            newScopeMap[scope].push(commit);
        }

        changes[type] = newScopeMap;
    }
    return changes;
}

/**
 * Categorizes commits by type and scope.
 *
 * @param commits - Array of commits to categorize
 * @returns Object with changes map, type priority list, and parent release commit
 */
function categorizeCommits(commits: Commit[]): { changes: Changes; changeTypePriority: string[]; parentRelease: Commit | null } {
    function fnlog(msg: string): void {
        trace_commands.log('categorizeCommits: ' + msg);
    }

    let parentRelease: Commit | null = null;
    const changes: Changes = {};

    for (const c of commits.slice().reverse()) {
        if (c.is_parent_release) {
            parentRelease = c;
            continue;
        }
        const type = c.type || 'other';
        const scope = c.scope || 'null';
        if (!changes[type]) {
            changes[type] = {};
        }
        if (!changes[type][scope]) {
            changes[type][scope] = [];
        }
        changes[type][scope].push(c);
    }
    fnlog(`${Object.keys(changes).length} change categories:`);

    const changeTypePriority = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'build', 'test', 'ci', 'chore', 'release'];
    for (const type of Object.keys(changes)) {
        if (!changeTypePriority.includes(type)) {
            changeTypePriority.push(type);
        }
    }
    if (!changeTypePriority.includes('other')) {
        changeTypePriority.push('other');
    }

    return { changes, changeTypePriority, parentRelease };
}

/**
 * Converts a commit type to a human-readable section title.
 *
 * @param s - Commit type string
 * @returns Human-readable title for the commit type
 */
function humanize(s: string): string {
    const mapping: Record<string, string> = {
        'docs': 'Documentation',
        'fix': 'Fixes',
        'style': 'Style',
        'chore': 'Chores',
        'build': 'Build',
        'feat': 'Features',
        'refactor': 'Refactor',
        'perf': 'Performance',
        'test': 'Tests',
        'release': 'Release',
        'ci': 'Continuous Integration',
        'improvement': 'Improvement',
        'breaking': 'Breaking',
        'revert': 'Revert',
        'other': 'Other'
    };
    return mapping[s] || s;
}

/**
 * Returns a description for a commit type.
 *
 * @param s - Commit type string
 * @returns Description of what this commit type represents
 */
function commitTypeDescription(s: string): string {
    const mapping: Record<string, string> = {
        'docs': 'Documentation updates and improvements',
        'fix': 'Bug fixes and error corrections',
        'style': 'Code style and formatting changes',
        'chore': 'Routine tasks, maintenance, and housekeeping',
        'build': 'Build system and configuration changes',
        'feat': 'New features and additions',
        'refactor': 'Code refactoring and restructuring',
        'perf': 'Performance optimizations and enhancements',
        'test': 'Test cases and testing-related changes',
        'release': 'Release-specific changes and preparations',
        'ci': 'Changes related to continuous integration',
        'improvement': 'General improvements and enhancements',
        'breaking': 'Breaking changes and compatibility modifications',
        'revert': 'Reverted changes to previous versions',
        'other': 'Other changes not covered by specific categories'
    };
    return mapping[s] || '';
}

/**
 * Generates a formatted changelog output from parsed commit changes.
 *
 * This function creates a Markdown-formatted changelog with sections for each
 * change type (features, fixes, etc.), including commit links, author attribution,
 * and footnotes for detailed descriptions.
 *
 * @param changes - Object mapping change types to arrays of commits
 * @param changeTypePriority - Ordered list of change types determining section order
 * @param args - Input configuration controlling output format and content
 * @param repoUrl - GitHub repository URL for generating commit and issue links
 * @param authors - Map of author usernames to GitHubUser objects for attribution
 * @param parentRelease - The previous release commit for version comparison, or null
 * @returns Formatted Markdown changelog string
 */
export function generateOutput(changes: Changes, changeTypePriority: string[], args: Inputs, repoUrl: string | undefined, authors: Record<string, GitHubUser>, parentRelease: Commit | null): string {
    function fnlog(msg: string): void {
        trace_commands.log('generateOutput: ' + msg);
    }

    let output = '';
    let footnotesOutput = '';
    let footnotesCount = 1;

    for (const changeType of changeTypePriority) {
        if (changes.hasOwnProperty(changeType)) {
            // Title
            if (Object.keys(changes).length > 1 || (Object.keys(changes).length > 0 && changeType !== 'other')) {
                if (output) {
                    output += '\n';
                }
                output += `## ${iconFor(changeType)} ${humanize(changeType)}\n\n`;
                const desc = commitTypeDescription(changeType);
                if (desc) {
                    output += `${desc}\n\n`;
                }
            }

            // Scopes
            const typeChanges = changes[changeType] || {};
            for (const [scope, scopedChanges] of Object.entries(typeChanges)) {
                const indentedScope = (scope !== null && scope !== 'null' && scope !== 'undefined') && scopedChanges.length > 1;
                if (indentedScope) {
                    output += `- ${scope}:\n`;
                }
                // Scope changes
                for (const commit of scopedChanges) {
                    // Padding
                    if (indentedScope) {
                        output += '    ';
                    }
                    output += '- ';

                    // Feat icon
                    if (commit.type === 'feat') {
                        output += `${featureSubjectIcon()} `;
                    }

                    // Scope prefix
                    if (!indentedScope && scope !== null && scope !== 'null' && scope !== 'undefined') {
                        output += `${scope}: `;
                    }

                    // Description
                    output += `${capitalizeSentences(commit.description || '')}`;

                    // Breaking
                    if (commit.breaking) {
                        output += ` (${iconFor('breaking')} BREAKING)`;
                    }
                    // Body Footnote Link
                    if (commit.body) {
                        output += `[^${footnotesCount}]`;
                        const footnote = commit.body.replace(/\n/g, '').trim();
                        footnotesOutput += `[^${footnotesCount}]: ${capitalizeSentences(footnote)}\n`;
                        footnotesCount += 1;
                    }

                    // Footer keys
                    if (Object.entries(commit.footers).length > 0) {
                        const footerStrings = Object.entries(commit.footers).map(([key, value]) =>
                            typeof value !== 'string' ?
                                `${key}: ${gh_inputs.makeValueString(value)}` :
                                value.startsWith('#') ?
                                    `${key} ${value}` :
                                    `${key}: ${value}`
                        );
                        if (footerStrings.length > 0) {
                            output += ` (${footerStrings.join(', ')})`;
                        }
                    }

                    // Commit ids
                    if (args.link_commits) {
                        for (const h of [commit.hash, ...commit.extra_hashes]) {
                            if (h) {
                                output += ` [${h.slice(0, 7)}](${repoUrl}/commit/${h})`;
                            }
                        }
                    } else {
                        for (const h of [commit.hash, ...commit.extra_hashes]) {
                            if (h) {
                                output += ` ${h.slice(0, 7)}`;
                            }
                        }
                    }

                    // Thanks
                    if (args.thank_non_regular) {
                        const relatedUsernames: string[] = [];
                        if (commit.gh_username !== null) {
                            relatedUsernames.push(commit.gh_username);
                        }
                        if (commit.gh_issue_username !== null && commit.gh_issue_username !== commit.gh_username) {
                            relatedUsernames.push(commit.gh_issue_username);
                        }
                        const thankList = relatedUsernames.filter(username => !authors[username]?.is_regular).map(username => `@${username}`);
                        if (thankList.length > 0) {
                            output += ` (thanks ${thankList.join(', ')})`;
                        }
                    }
                    output += '\n';
                }
            }
        }
    }

    // Output parent release
    if (parentRelease) {
        output += '\n';
        output += '> Parent release: ';
        if (repoUrl !== null && parentRelease.tag) {
            output += `[${parentRelease.tag}](${repoUrl}/releases/tag/${parentRelease.tag})`;
        } else if (parentRelease.tag) {
            output += `> Parent release: ${parentRelease.tag}`;
        }
        output += ` ${parentRelease.hash?.slice(0, 7)}\n`;
    }

    // Output footnotes
    if (footnotesOutput) {
        output += '\n';
        output += footnotesOutput;
    }

    fnlog('CHANGELOG Contents:\n' + output);

    return output;
}

/**
 * Writes changelog content to a file.
 *
 * @param outputPath - Path where the changelog will be written
 * @param output - Changelog content to write
 */
function writeChangelog(outputPath: string, output: string): void {
    const absolutePath = path.resolve(outputPath);
    fs.writeFileSync(absolutePath, output);
}

/**
 * Main entry point for the create-changelog action.
 *
 * Parses git commits from the repository, processes them according to
 * conventional commit format, and generates a formatted changelog. The
 * changelog can be output to a file and/or set as GitHub Actions outputs.
 *
 * @param inputs - Configuration inputs controlling changelog generation behavior
 *                 including version patterns, output paths, and formatting options
 */
export async function main(inputs: Inputs): Promise<void> {
    function fnlog(msg: string): void {
        trace_commands.log('create-changelog: ' + msg);
    }

    core.startGroup('🧩 Adjusting parameters');
    await adjustParameters(inputs);
    // Print a table with the parameters
    for (const [name, value] of Object.entries(inputs)) {
        fnlog(`🧩 ${name.replaceAll('_', '-')} = ${JSON.stringify(value)}`);
    }
    core.endGroup();

    core.startGroup('🏷️ Identifying tags');
    let tags = await processTags(inputs.source_dir, inputs.tag_pattern, inputs.repoUrl, inputs.github_token);
    core.endGroup();

    core.startGroup('📜 Identifying commits');
    let commits = await processCommits(
        inputs.source_dir,
        inputs.repoUrl,
        inputs.version_pattern,
        tags,
        inputs.repo_branch,
        inputs.github_token,
        inputs.check_unconventional);

    // Limit the number of commits
    if (inputs.limit && commits.length > inputs.limit) {
        commits = commits.slice(0, inputs.limit);
        console.log(`Limited to ${inputs.limit} commits`);
    }
    core.endGroup();

    core.startGroup('👤 Populating GitHub usernames');
    await populateGithubUsernames(commits, inputs.github_token);
    core.endGroup();

    // Populate issue data
    core.startGroup('🔗 Populating issue data');
    const authors = await populateIssueData(commits, inputs.repoUrl, inputs.repoOwner, inputs.github_token);
    core.endGroup();

    // Identify non-regular contributors
    core.startGroup('👥 Identifying non-regular contributors');
    identifyNonRegularContributors(authors);
    core.endGroup();

    // Populate diff stats if needed for lines-based sorting
    if (inputs.sort_by === 'most-changes-first') {
        core.startGroup('📊 Fetching diff statistics');
        await populateDiffStats(inputs.source_dir, commits);
        core.endGroup();
    }

    // Categorize commits
    core.startGroup('📦 Categorizing commits');
    const { changes: rawChanges, changeTypePriority, parentRelease } = categorizeCommits(commits);
    core.endGroup();

    // Filter changes by type
    core.startGroup('🔍 Filtering commit types');
    const filteredChanges = filterChangesByType(rawChanges, inputs.include_types, inputs.exclude_types);
    if (inputs.include_types.size > 0) {
        trace_commands.log(`Including types: ${Array.from(inputs.include_types).join(', ')}`);
    }
    if (inputs.exclude_types.size > 0) {
        trace_commands.log(`Excluding types: ${Array.from(inputs.exclude_types).join(', ')}`);
    }
    trace_commands.log(`Filtered from ${Object.keys(rawChanges).length} to ${Object.keys(filteredChanges).length} types`);
    core.endGroup();

    // Sort changes within each scope
    core.startGroup('🔀 Sorting commits');
    const changes = sortChanges(filteredChanges, inputs.sort_by);
    trace_commands.log(`Sorted commits by: ${inputs.sort_by}`);
    core.endGroup();

    // Generate output
    core.startGroup('📄 Generating output');
    const outputContents = generateOutput(
        changes, changeTypePriority, inputs, inputs.repoUrl, authors, parentRelease);
    core.endGroup();

    // Write file
    core.startGroup('📝 Writing changelog');
    writeChangelog(inputs.output_path, outputContents);
    core.endGroup();

    if (inputs.update_summary) {
        core.startGroup('📝 Updating summary');
        try {
            await core.summary
                .addRaw(`# Changelog\n\n${outputContents}`)
                .write();
            fnlog('Summary written successfully.');
        } catch (error) {
            core.setFailed(`Failed to write summary: ${(error as Error).message}`);
        }
        core.endGroup();
    }
}

/**
 * Parses a check-unconventional input value into its mode.
 *
 * Handles backwards compatibility with boolean values ('true'/'false')
 * and the new mode values ('warn'/'error').
 *
 * @param value - The input value to parse
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

/**
 * GitHub Actions entry point for the create-changelog action.
 *
 * Reads inputs from GitHub Actions context, configures trace commands,
 * and invokes the main function with the parsed inputs. Handles errors
 * with pretty error reporting for better debugging experience.
 */
export async function run(): Promise<void> {
    let inputs: Inputs = {
        // Configure options
        source_dir: gh_inputs.getNormalizedPath('source-dir'),
        version_pattern: gh_inputs.getRegex('version-pattern'),
        tag_pattern: gh_inputs.getRegex('tag-pattern'),
        output_path: gh_inputs.getNormalizedPath('output-path'),
        limit: gh_inputs.getInt('limit') || 0,
        thank_non_regular: gh_inputs.getBoolean('thank-non-regular'),
        check_unconventional: parseCheckUnconventionalMode(gh_inputs.getInput('check-unconventional') || 'warn'),
        link_commits: gh_inputs.getBoolean('link-commits'),
        github_token: gh_inputs.getInput('github-token'),
        update_summary: gh_inputs.getBoolean('update-summary'),
        trace_commands: gh_inputs.getBoolean('trace-commands'),
        include_types: gh_inputs.getSet('include-types'),
        exclude_types: gh_inputs.getSet('exclude-types'),
        sort_by: parseSortByOption(gh_inputs.getInput('sort-by') || 'most-changes-first')
    };

    // Resolve paths
    inputs.source_dir = path.resolve(inputs.source_dir);
    // output path, if relative, is relative to the source directory
    inputs.output_path = path.resolve(inputs.source_dir, inputs.output_path);

    // Set trace_commands when in debug mode or when
    // the user explicitly sets it to true.
    // This enables the log() function to print to the console.
    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true);
    }

    // Print a summary of the inputs
    core.startGroup('📥 Action Inputs');
    gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
    core.endGroup();

    await main(inputs);
}

if (require.main === module) {
    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: 'Create changelog failed'
            });
        }
    })();
}
