import * as core from '@actions/core';
import * as traceCommands from 'trace-commands';
import { runAction } from 'action-schema';

import {
    type Commit,
    type GitHubUser,
    type Tag,
    type Changes
} from './types';

// Schema imports
import { inputsSchema, outputsSchema, type Inputs } from './schema';
export { inputsSchema, outputsSchema };

import {
    getGithubRepoOwner,
    populateGithubUsernames,
    populateIssueData
} from './github-api';

import {
    getCurrentBranch,
    getGithubRemote,
    processTags,
    processCommits,
    populateDiffStats
} from './git-parsing';

import {
    identifyNonRegularContributors,
    filterChangesByType,
    sortChanges,
    categorizeCommits,
    generateOutput,
    writeChangelog
} from './changelog-output';

// Re-export types for external consumers
export { Commit, GitHubUser, SortByOption, parseSortByOption, Changes } from './types';

// Re-export formatting functions for external consumers
export { featureSubjectIcon } from './commit-formatting';

// Re-export changelog output functions for external consumers
export { filterChangesByType, compareCommits, sortChanges, generateOutput } from './changelog-output';

/**
 * Runner class that orchestrates the create-changelog pipeline.
 *
 * Processes git commits from a repository, applies conventional commit parsing,
 * enriches with GitHub data, categorizes changes, and generates a formatted
 * Markdown changelog.
 */
class CreateChangelogRunner {
    /** Frozen input configuration */
    private readonly inputs: Inputs;

    /** Resolved repository branch name (derived from env or git) */
    private repoBranch: string | undefined;

    /** Resolved GitHub token (may come from env) */
    private githubToken: string;

    /** GitHub repository URL derived from git remote */
    private repoUrl: string | undefined;

    /** Repository owner extracted from repoUrl */
    private repoOwner: string | undefined;

    /** Version tags collected from local and remote sources */
    private tags!: Tag[];

    /** Parsed and deduplicated commits from the repository */
    private commits!: Commit[];

    /** Map of GitHub usernames to author metadata */
    private authors!: Record<string, GitHubUser>;

    /** Categorized changes grouped by type and scope */
    private changes!: Changes;

    /** Ordered list of change types for section ordering */
    private changeTypePriority!: string[];

    /** The commit marking the previous release boundary, if found */
    private parentRelease: Commit | null = null;

    /**
     * Creates a new CreateChangelogRunner.
     *
     * @param inputs - Configuration inputs for changelog generation
     */
    constructor(inputs: Inputs) {
        this.inputs = Object.freeze({ ...inputs });
        this.repoBranch = undefined;
        this.githubToken = inputs.githubToken;
        this.repoUrl = undefined;
        this.repoOwner = undefined;
    }

    /**
     * Runs the full changelog generation pipeline.
     */
    async run(): Promise<void> {
        const fnlog = traceCommands.scoped('run');

        core.startGroup('🧩 Adjusting parameters');
        await this.adjustParameters();
        for (const [name, value] of Object.entries(this.inputs)) {
            fnlog(`🧩 ${name.replaceAll('_', '-')} = ${JSON.stringify(value)}`);
        }
        core.endGroup();

        core.startGroup('🏷️ Identifying tags');
        await this.identifyTags();
        core.endGroup();

        core.startGroup('📜 Identifying commits');
        await this.identifyCommits();
        core.endGroup();

        core.startGroup('👤 Populating GitHub usernames');
        await this.enrichGithubUsernames();
        core.endGroup();

        core.startGroup('🔗 Populating issue data');
        await this.enrichIssueData();
        core.endGroup();

        core.startGroup('👥 Identifying non-regular contributors');
        identifyNonRegularContributors(this.authors);
        core.endGroup();

        if (this.inputs.sortBy === 'most-changes-first') {
            core.startGroup('📊 Fetching diff statistics');
            await populateDiffStats(this.inputs.sourceDir, this.commits);
            core.endGroup();
        }

        core.startGroup('📦 Categorizing commits');
        this.categorize();
        core.endGroup();

        core.startGroup('🔍 Filtering commit types');
        this.filterByType();
        core.endGroup();

        core.startGroup('🔀 Sorting commits');
        this.sortCommits();
        core.endGroup();

        core.startGroup('📄 Generating output');
        const outputContents = this.generateChangelog();
        core.endGroup();

        core.startGroup('📝 Writing changelog');
        writeChangelog(this.inputs.outputPath, outputContents);
        core.endGroup();

        if (this.inputs.updateSummary) {
            core.startGroup('📝 Updating summary');
            await this.updateSummary(outputContents);
            core.endGroup();
        }
    }

    /**
     * Resolves repository metadata from environment and git remote.
     */
    private async adjustParameters(): Promise<void> {
        const envKeys = ['GITHUB_BASE_REF', 'GITHUB_REF_NAME'];
        for (const envKey of envKeys) {
            if (!this.repoBranch) {
                this.repoBranch = process.env[envKey];
                if (this.repoBranch) {
                    core.info(`Repository Branch ${this.repoBranch} from ${envKey}`);
                    break;
                }
            }
        }
        if (!this.repoBranch) {
            this.repoBranch = (await getCurrentBranch(this.inputs.sourceDir)) || undefined;
            if (this.repoBranch) {
                core.info(`Repository Branch ${this.repoBranch} from local path`);
            }
        }
        if (!this.githubToken) {
            this.githubToken = process.env['GITHUB_TOKEN'] || '';
            if (this.githubToken) {
                core.info(`Access token **** from GITHUB_TOKEN`);
            }
        }

        this.repoUrl = (await getGithubRemote(this.inputs.sourceDir)) || undefined;
        this.repoOwner = getGithubRepoOwner(this.repoUrl) || undefined;
    }

    /**
     * Fetches and deduplicates tags from local and remote sources.
     */
    private async identifyTags(): Promise<void> {
        this.tags = await processTags(this.inputs.sourceDir, this.inputs.tagPattern, this.repoUrl, this.githubToken);
    }

    /**
     * Fetches, parses, and deduplicates commits from local and remote sources.
     */
    private async identifyCommits(): Promise<void> {
        this.commits = await processCommits(
            this.inputs.sourceDir,
            this.repoUrl,
            this.inputs.versionPattern,
            this.tags,
            this.repoBranch,
            this.githubToken,
            this.inputs.checkUnconventional);

        if (this.inputs.limit && this.commits.length > this.inputs.limit) {
            this.commits = this.commits.slice(0, this.inputs.limit);
            core.info(`Limited to ${this.inputs.limit} commits`);
        }
    }

    /**
     * Enriches commits with GitHub username and profile name data.
     */
    private async enrichGithubUsernames(): Promise<void> {
        await populateGithubUsernames(this.commits, this.githubToken);
    }

    /**
     * Populates author and issue metadata for all commits.
     */
    private async enrichIssueData(): Promise<void> {
        this.authors = await populateIssueData(this.commits, this.repoUrl, this.repoOwner, this.githubToken);
    }

    /**
     * Groups commits by type and scope, extracting the parent release.
     */
    private categorize(): void {
        const result = categorizeCommits(this.commits);
        this.changes = result.changes;
        this.changeTypePriority = result.changeTypePriority;
        this.parentRelease = result.parentRelease;
    }

    /**
     * Applies include/exclude type filters to categorized changes.
     */
    private filterByType(): void {
        this.changes = filterChangesByType(this.changes, this.inputs.includeTypes, this.inputs.excludeTypes);
        if (this.inputs.includeTypes.size > 0) {
            traceCommands.log(`Including types: ${Array.from(this.inputs.includeTypes).join(', ')}`);
        }
        if (this.inputs.excludeTypes.size > 0) {
            traceCommands.log(`Excluding types: ${Array.from(this.inputs.excludeTypes).join(', ')}`);
        }
        traceCommands.log(`Filtered to ${Object.keys(this.changes).length} types`);
    }

    /**
     * Sorts commits within each scope based on the configured sort option.
     */
    private sortCommits(): void {
        this.changes = sortChanges(this.changes, this.inputs.sortBy);
        traceCommands.log(`Sorted commits by: ${this.inputs.sortBy}`);
    }

    /**
     * Generates the formatted Markdown changelog content.
     *
     * @returns Formatted changelog string
     */
    private generateChangelog(): string {
        return generateOutput(
            this.changes, this.changeTypePriority, this.inputs, this.repoUrl, this.authors, this.parentRelease);
    }

    /**
     * Writes the changelog content to the GitHub Actions summary.
     *
     * @param outputContents - Changelog content to write
     */
    private async updateSummary(outputContents: string): Promise<void> {
        const fnlog = traceCommands.scoped('updateSummary');
        try {
            await core.summary
                .addRaw(`# Changelog\n\n${outputContents}`)
                .write();
            fnlog('Summary written successfully.');
        } catch (error) {
            core.setFailed(`Failed to write summary: ${(error as Error).message}`);
        }
    }
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
    return new CreateChangelogRunner(inputs).run();
}

/**
 * Action entry point using schema-driven runner.
 */
runAction({
    inputsSchema,
    outputsSchema,
    title: 'Create Changelog',
    main: async (inputs: Inputs) => {
        await main(inputs);
        return {};
    },
    callerModule: module
});
