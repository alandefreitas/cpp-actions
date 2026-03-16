/**
 * Git parsing utilities for create-changelog action.
 *
 * Handles fetching and parsing commits and tags from local git repositories
 * and the GitHub API.
 *
 * @module git-parsing
 */

import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as axios from 'axios';
import * as traceCommands from 'trace-commands';
import { ExpectedError } from 'pretty-errors';

import {
    Commit,
    type Tag,
    type CheckUnconventionalMode
} from './types';

import {
    isValidType,
    normalizeType
} from './commit-formatting';

import {
    getGithubRepoOwner,
    getGithubRepoName,
    getIssueAuthor,
    getGithubTags,
    getGithubProfileName
} from './github-api';

/**
 * Gets the current Git branch name.
 *
 * @param projectPath - Path to the Git repository
 * @returns Current branch name or null if not found
 */
export async function getCurrentBranch(projectPath: string): Promise<string | null> {
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
            core.error(`Git command execution failed with exit code ${exitCode}`);
        }
    } catch (error) {
        core.error(`Error executing Git command: ${(error as Error).message}`);
    }
    return null;
}

/**
 * Gets the GitHub remote URL from a Git repository.
 *
 * @param gitPath - Path to the Git repository
 * @returns GitHub repository URL or null if not found
 */
export async function getGithubRemote(gitPath: string): Promise<string | null> {
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
        core.error(`Failed to execute 'git remote -v' command: ${(error as Error).message}`);
        return null;
    }

    return null;
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
export async function processTags(projectPath: string, tagPattern: RegExp, repoUrl: string | undefined, accessToken: string): Promise<Tag[]> {
    const fnlog = traceCommands.scoped('processTags');

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
                commit.ghIssueUsername = await getIssueAuthor(repoUrl, commit.issue, '');
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

    commit.isParentRelease = false;
    if (commit.tag !== null) {
        core.info(`Stopping at commit id ${commit.hash?.slice(0, 8)} (tag ${commit.tag})`);
        commit.isParentRelease = true;
    } else {
        let matches = commit.description?.match(versionPattern);
        if (matches) {
            core.info(`Stopping at commit id ${commit.hash?.slice(0, 8)} (description: ${commit.description})`);
            commit.isParentRelease = true;
        } else {
            matches = commit.subject?.match(versionPattern);
            if (matches) {
                core.info(`Stopping at commit id ${commit.hash?.slice(0, 8)} (subject: ${commit.subject})`);
                commit.isParentRelease = true;
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
                        commits[0].isParentRelease = false;
                    } else if (commits[commits.length - 1].isParentRelease) {
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
                commit.authorName = commit.author.slice(0, p);
                commit.authorEmail = commit.author.slice(p + 2, -1);
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
 * Populates the linesAdded, linesDeleted, and linesChanged properties
 * for each commit. This is only called when sort-by is 'lines-asc' or 'lines-desc'.
 *
 * @param projectPath - Path to the git repository
 * @param commits - Array of commits to populate with diff stats
 */
export async function populateDiffStats(projectPath: string, commits: Commit[]): Promise<void> {
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

            commit.linesAdded = added;
            commit.linesDeleted = deleted;
            commit.linesChanged = added + deleted;
            traceCommands.log(`Commit ${commit.hash?.slice(0, 7)}: +${added} -${deleted} (${added + deleted} total)`);
        } catch (error) {
            traceCommands.log(`Error fetching diff stats for ${commit.hash}: ${(error as Error).message}`);
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
            uniqueCommits[idx].extraHashes.push(commit.hash);
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
    while (commits.length === 0 || !commits[commits.length - 1].isParentRelease) {
        const params = {
            page: page,
            perPage: 100
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
                        commit.authorName = pageCommit.commit.committer.name;
                        commit.authorEmail = pageCommit.commit.committer.email;
                        if (pageCommit.committer?.login) {
                            commit.ghName = await getGithubProfileName(pageCommit.committer.login, accessToken);
                            commit.ghUsername = pageCommit.committer.login;
                        }
                        commit.date = pageCommit.commit.committer.date;
                        commit.message = pageCommit.commit.message;
                        commit = await populateConventional(commit, repoUrl, versionPattern, tags);
                        const isDetail = commit.subject?.startsWith('[') && commit.subject?.includes(']');
                        if (!isDetail) {
                            commits.push(commit);
                            if (commits.length === 1) {
                                commits[0].isParentRelease = false;
                            } else if (commits[commits.length - 1].isParentRelease) {
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
export async function processCommits(projectPath: string, repoUrl: string | undefined, versionPattern: RegExp, tags: Tag[], repoBranch: string | undefined, accessToken: string, checkUnconventional: CheckUnconventionalMode): Promise<Commit[]> {
    const fnlog = traceCommands.scoped('processCommits');

    let commits = await getLocalCommits(projectPath, repoUrl, versionPattern, tags);

    if (checkUnconventional !== 'false') {
        const unconventionalCommits = commits.filter(commit => !commit.conventional);
        if (unconventionalCommits.length > 0) {
            const message = unconventionalCommits.length === 1
                ? `Commit "${unconventionalCommits[0].subject}" is not a conventional commit`
                : `${unconventionalCommits.length} unconventional commits`;

            if (checkUnconventional === 'error') {
                throw new ExpectedError(message, 'Conventional Commits');
            } else {
                core.warning(message, { title: 'Conventional Commits' });
            }
        }
    }

    fnlog(`${commits.length} local commits`);

    if (commits.length === 0 || !commits[commits.length - 1].isParentRelease) {
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
