/**
 * Changelog output generation for create-changelog action.
 *
 * Handles categorizing commits, filtering, sorting, and generating
 * the formatted Markdown changelog output.
 *
 * @module changelog-output
 */

import * as fs from 'fs';
import * as path from 'path';
import * as traceCommands from 'trace-commands';

import type {
    Commit,
    GitHubUser,
    SortByOption,
    Changes
} from './types';
import type { Inputs } from './schema';

import {
    iconFor,
    humanize,
    commitTypeDescription,
    capitalizeSentences,
    featureSubjectIcon
} from './commit-formatting';

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
export function identifyNonRegularContributors(authors: Record<string, GitHubUser>): void {
    // Create an array of commit counts
    const commitHist = Object.values(authors).map(author => author.commits);
    const commitSum = commitHist.reduce((sum, commits) => sum + commits, 0);
    const perc80 = calculatePercentile(commitHist, 80);

    for (const author of Object.values(authors)) {
        // 1. Author is not owner, admin, or affiliated
        if (author.isAdmin || author.isAffiliated || author.isOwner) {
            author.isRegular = true;
            continue;
        }
        // 2. Has less than 10% of commits
        if (author.commits < commitSum / 10) {
            author.isRegular = false;
            continue;
        }
        // 3. Has 3 or fewer commits
        if (author.commits <= 3) {
            author.isRegular = false;
            continue;
        }
        // 4. Is not among 20% top contributors
        if (author.commits < perc80) {
            author.isRegular = false;
            continue;
        }
        author.isRegular = true;
    }
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
            return b.linesChanged - a.linesChanged;
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
export function categorizeCommits(commits: Commit[]): { changes: Changes; changeTypePriority: string[]; parentRelease: Commit | null } {
    const fnlog = traceCommands.scoped('categorizeCommits');

    let parentRelease: Commit | null = null;
    const changes: Changes = {};

    for (const c of commits.slice().reverse()) {
        if (c.isParentRelease) {
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
    const fnlog = traceCommands.scoped('generateOutput');

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
                                `${key}: ${JSON.stringify(value)}` :
                                value.startsWith('#') ?
                                    `${key} ${value}` :
                                    `${key}: ${value}`
                        );
                        if (footerStrings.length > 0) {
                            output += ` (${footerStrings.join(', ')})`;
                        }
                    }

                    // Commit ids
                    if (args.linkCommits) {
                        for (const h of [commit.hash, ...commit.extraHashes]) {
                            if (h) {
                                output += ` [${h.slice(0, 7)}](${repoUrl}/commit/${h})`;
                            }
                        }
                    } else {
                        for (const h of [commit.hash, ...commit.extraHashes]) {
                            if (h) {
                                output += ` ${h.slice(0, 7)}`;
                            }
                        }
                    }

                    // Thanks
                    if (args.thankNonRegular) {
                        const relatedUsernames: string[] = [];
                        if (commit.ghUsername !== null) {
                            relatedUsernames.push(commit.ghUsername);
                        }
                        if (commit.ghIssueUsername !== null && commit.ghIssueUsername !== commit.ghUsername) {
                            relatedUsernames.push(commit.ghIssueUsername);
                        }
                        const thankList = relatedUsernames.filter(username => !authors[username]?.isRegular).map(username => `@${username}`);
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
export function writeChangelog(outputPath: string, output: string): void {
    const absolutePath = path.resolve(outputPath);
    fs.writeFileSync(absolutePath, output);
}
