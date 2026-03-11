/**
 * Schema definitions for the create-changelog action.
 *
 * This file is the single source of truth for inputs and outputs.
 * Types are inferred from these schemas, and action.yml is generated from them.
 *
 * @module schema
 */

import {
    baseInputs,
    type ActionInputsSchema,
    type ActionOutputsSchema
} from 'action-schema';

/**
 * Input schema for the create-changelog action.
 */
export const inputsSchema = {
    ...baseInputs,

    sourceDir: {
        type: 'path' as const,
        default: '.',
        description: 'The source directory from whose commits will be analyzed'
    },

    versionPattern: {
        type: 'string' as const,
        default: '(Bump|Set)\\s+version',
        description: `A regex pattern used to identify if a commit is a version delimiter.

When a commit has a message that matches this pattern, the list of
commits considered in the notes is complete.

For instance, assuming the pattern '(Bump|Set)\\s+version', when
we find a commit subject such as 'Bump version to 1.0.0', the list
of commits considered in the notes is complete.

This constraint does not apply to the current and latest commit.`
    },

    tagPattern: {
        type: 'string' as const,
        default: 'v.*\\..*\\..*',
        description: `A regex pattern used to identify if a commit is a tagged delimiter.

When a commit has the same hash has the commit associated with a
tag whose name matches this pattern, the list of commits considered
in the notes is complete.

For instance, assuming the pattern 'v.*\\..*\\..*', when we find
a commit with the same hash as the commit associated with the tag
'v1.0.0', the list of commits considered in the notes is complete.

This tag is then associated as the parent version of the
current release, and this information is included at the
end of the changelog.

This constraint does not apply to the current and latest commit.`
    },

    outputPath: {
        type: 'string' as const,
        default: 'CHANGELOG.md',
        description: `The path where the changelog will be stored.

Relative paths are resolved from the source directory.`
    },

    limit: {
        type: 'number' as const,
        default: 0,
        description: `The limit on the number of commits considered in the Changelog.

If the limit is set to 0 or undefined, all commits are considered.`
    },

    thankNonRegular: {
        type: 'boolean' as const,
        default: true,
        description: `Thank non-regular contributors.

The action will attempt to identify non-regular contributors by
analyzing the commit history and the GitHub token provided.

Non-regular contributors are contributors that do not have a
are not part of the repository's collaborators and have
a small number of commits.

The changelog will include a thank you message to these
contributors, including a tag to their GitHub profile.

When the Changelog is used in a release, this tag
will usually be used by GitHub to notify these contributors
of the new release with their contribution and the
thank you message.`
    },

    checkUnconventional: {
        type: 'string' as const,
        default: 'warn',
        description: `Check for commits that do not follow the conventional commit format.

This input controls the behavior when unconventional commits are detected:

- \`false\`: Disable checking (no warnings or errors)
- \`warn\` or \`true\`: Emit warnings for unconventional commits (default)
- \`error\`: Fail the action if unconventional commits are found

When enabled, if one of the new commits in a PR does not follow the
conventional commit format, the action will either warn or fail depending
on this setting.

This helps ensure all commit messages can be used in the changelog so
that it's consistent and that the release notes are clear and concise.`
    },

    linkCommits: {
        type: 'boolean' as const,
        default: false,
        description: `Link commit ids in the changelog to the repository commit.

For instance, if the changelog includes a commit id such as '471aec5',
instead of including "#471aec5" next to the commit message, it will
include the full version with the link:

https://github.com/boostorg/url/commit/471aec59401fb973e325cd50e7d61f613357e4ad[#471aec5]

This is usually unnecessary because GitHub flavored markdown automatically links commits id in
text to the commits in the same repository. Thus, including explicit links would often make the
output more verbose and remove any extra GitHub functionality, such as pop ups associated with
these ids.

However, when the outputs is only going to be used as an action summary or in any other context
outside GitHub, these automatic links do not exist and it's often a good idea to explicitly
include them to allow the reader to navigate to these repository commits.`
    },

    githubToken: {
        type: 'string' as const,
        default: '',
        description: `Github token to identify information about the project.

This is currently used to:

- Fetch the commit history to compare with the proposed changes
  and create a full changelog including the changes proposed in a
  PR and the changes that are already in the main branch.
- Fetch the list of collaborators to identify non-regular contributors.

The reason we need to fetch the commit history is because the
checkout action only fetches the latest commit so the information
about existing commits is not readily available to the workflow.

The value for this token is usually set as the value of
\`secrets.GITHUB_TOKEN\`.

Although the action does not require this token to work, it will
be limited in the number of requests it can make to the GitHub API
and might be forced to work with limited information.`
    },

    updateSummary: {
        type: 'boolean' as const,
        default: true,
        description: `When set to \`true\`, this action will update the workflow summary
with the current changelog.`
    },

    includeTypes: {
        type: 'string[]' as const,
        default: [] as string[],
        description: `Comma-separated list of commit types to include in the changelog.

When specified, only commits with these types will appear in the changelog.
If empty (default), all commit types are included before applying exclusions.

Common types: feat, fix, perf, refactor, docs, style, build, test, ci, chore, release, other

Example: 'feat, fix, perf, docs'

Note: The 'other' type represents commits that don't follow conventional commit format.`
    },

    excludeTypes: {
        type: 'string[]' as const,
        default: ['chore', 'style'] as string[],
        description: `Comma-separated list of commit types to exclude from the changelog.

Commits with these types will be filtered out from the changelog output.
This filter is applied after include-types (if specified).

Common types: feat, fix, perf, refactor, docs, style, build, test, ci, chore, release, other

Example: 'chore, style, release'

Tip: Use this to create cleaner changelogs by excluding routine maintenance commits.`
    },

    sortBy: {
        type: 'string' as const,
        default: 'most-changes-first',
        description: `Specifies how commits should be sorted within each scope in the changelog.

Available options:
- \`most-changes-first\`: Sort by lines changed, most changes first (default)
- \`latest-first\`: Sort by date, newest commits first
- \`oldest-first\`: Sort by date, oldest commits first

Note: When using \`most-changes-first\`, the action will fetch diff statistics
for each commit, which may take additional time for repositories with
many commits.

Example: Sort by newest commits first:
\`\`\`yaml
- uses: alandefreitas/cpp-actions/create-changelog@v1
  with:
    sort-by: 'latest-first'
\`\`\``
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the create-changelog action.
 */
export const outputsSchema = {} satisfies ActionOutputsSchema;
