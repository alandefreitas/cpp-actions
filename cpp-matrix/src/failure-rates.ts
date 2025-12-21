/**
 * Failure rate tracking and sorting for cpp-matrix action.
 *
 * @module failure-rates
 */

import * as trace_commands from 'trace-commands';
import * as httpClient from '@actions/http-client';

import { FailureRates, MatrixEntry, WorkflowJob, WorkflowRun } from './types';

/**
 * API Design Note (Dec 2025):
 *
 * We use parallel REST requests instead of GraphQL/batch for these reasons:
 *
 * 1. GitHub REST API doesn't support batch job requests - no endpoint exists
 *    to fetch jobs for multiple workflow runs in a single request.
 *
 * 2. GitHub GraphQL API doesn't directly expose workflow runs/jobs - the
 *    workflowRun and workflow objects are only accessible through CheckSuite,
 *    not queryable from Repository (see github.com/orgs/community/discussions/56300).
 *
 * 3. GraphQL CheckSuites approach is unsuitable - CheckSuites are accessed via
 *    commit history, which excludes failed runs from PRs that were never merged.
 *    We need failure data from ALL runs, including rejected PRs, which only
 *    the REST workflow runs API provides.
 *
 * Parallel REST requests complete in roughly the same time as a single request,
 * making this approach performant despite the multiple API calls.
 */

/**
 * Fetches historical failure rates for workflow jobs.
 *
 * Uses the GitHub API to fetch recent workflow runs and calculate failure rates
 * for each job name.
 *
 * @param numRuns - Number of recent workflow runs to analyze
 * @param token - GitHub token for API access
 * @returns Map of job names to failure rates (0.0 to 1.0), or null if unavailable
 */
export async function fetchFailureRates(numRuns: number, token: string): Promise<FailureRates | null> {
    function fnlog(msg: string): void {
        trace_commands.log('fetchFailureRates: ' + msg);
    }

    const effectiveToken = token || process.env.GITHUB_TOKEN;
    if (!effectiveToken) {
        fnlog('github-token not provided and GITHUB_TOKEN env var not set, skipping failure rate calculation');
        return null;
    }

    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository) {
        fnlog('GITHUB_REPOSITORY not available, skipping failure rate calculation');
        return null;
    }

    const workflowRef = process.env.GITHUB_WORKFLOW_REF;
    if (!workflowRef) {
        fnlog('GITHUB_WORKFLOW_REF not available, skipping failure rate calculation');
        return null;
    }

    // Extract workflow file name from GITHUB_WORKFLOW_REF
    // Format: {owner}/{repo}/.github/workflows/{workflow}.yml@{ref}
    const workflowMatch = workflowRef.match(/\.github\/workflows\/([^@]+)@/);
    if (!workflowMatch) {
        fnlog(`Could not parse workflow file from GITHUB_WORKFLOW_REF: ${workflowRef}`);
        return null;
    }
    const workflowFile = workflowMatch[1];
    fnlog(`Workflow file: ${workflowFile}`);

    try {
        const client = new httpClient.HttpClient('cpp-matrix', [], {
            headers: {
                'Authorization': `token ${effectiveToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        // Fetch recent workflow runs
        const runsUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?per_page=${numRuns}&status=completed`;
        fnlog(`Fetching workflow runs from: ${runsUrl}`);

        const runsResponse = await client.get(runsUrl);
        if (runsResponse.message.statusCode !== 200) {
            fnlog(`Failed to fetch workflow runs: ${runsResponse.message.statusCode}`);
            return null;
        }

        const runsBody = await runsResponse.readBody();
        const runsData = JSON.parse(runsBody);
        const runs: WorkflowRun[] = runsData.workflow_runs || [];

        if (runs.length === 0) {
            fnlog('No completed workflow runs found');
            return null;
        }

        fnlog(`Found ${runs.length} completed workflow runs`);

        // Collect job outcomes from all runs
        const jobOutcomes: { [name: string]: { failures: number; total: number } } = {};

        // Fetch jobs for all runs in parallel
        const jobPromises = runs.map(async (run) => {
            const jobsUrl = `https://api.github.com/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`;
            try {
                const jobsResponse = await client.get(jobsUrl);
                if (jobsResponse.message.statusCode !== 200) {
                    fnlog(`Failed to fetch jobs for run ${run.id}: ${jobsResponse.message.statusCode}`);
                    return [];
                }
                const jobsBody = await jobsResponse.readBody();
                const jobsData = JSON.parse(jobsBody);
                return (jobsData.jobs || []) as WorkflowJob[];
            } catch (error) {
                fnlog(`Error fetching jobs for run ${run.id}`);
                return [];
            }
        });

        const allJobsArrays = await Promise.all(jobPromises);

        // Process all jobs from all runs
        for (const jobs of allJobsArrays) {
            for (const job of jobs) {
                if (!job.name || job.conclusion === null) {
                    continue;
                }

                if (!(job.name in jobOutcomes)) {
                    jobOutcomes[job.name] = { failures: 0, total: 0 };
                }

                jobOutcomes[job.name].total++;
                if (job.conclusion === 'failure') {
                    jobOutcomes[job.name].failures++;
                }
            }
        }

        // Calculate failure rates
        const failureRates: FailureRates = {};
        for (const [name, outcomes] of Object.entries(jobOutcomes)) {
            if (outcomes.total > 0) {
                failureRates[name] = outcomes.failures / outcomes.total;
                fnlog(`Job "${name}": ${outcomes.failures}/${outcomes.total} = ${(failureRates[name] * 100).toFixed(1)}% failure rate`);
            }
        }

        return failureRates;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fnlog(`Error fetching failure rates: ${errorMessage}`);
        return null;
    }
}

/**
 * Applies failure rates to matrix entries and performs stable sort.
 *
 * Entries with higher failure rates are sorted first. Entries without historical
 * data are assigned the mean failure rate. Uses stable sort to preserve existing
 * order for entries with equal failure rates.
 *
 * @param matrix - Matrix array to sort (modified in place)
 * @param failureRates - Map of job names to failure rates
 */
export function sortByFailureRate(matrix: MatrixEntry[], failureRates: FailureRates): void {
    function fnlog(msg: string): void {
        trace_commands.log('sortByFailureRate: ' + msg);
    }

    if (Object.keys(failureRates).length === 0) {
        fnlog('No failure rate data available, skipping sort');
        return;
    }

    // Calculate mean failure rate for entries without history
    const rates = Object.values(failureRates);
    const meanRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    fnlog(`Mean failure rate: ${(meanRate * 100).toFixed(1)}%`);

    // Assign failure rates to matrix entries
    for (const entry of matrix) {
        const name = entry['name'] as string;
        if (name in failureRates) {
            entry['failure-rate'] = failureRates[name];
        } else {
            // Use mean rate for entries without history
            entry['failure-rate'] = meanRate;
            fnlog(`No history for "${name}", using mean rate ${(meanRate * 100).toFixed(1)}%`);
        }
    }

    // Stable sort by failure rate (descending)
    // JavaScript's sort is not guaranteed to be stable, so we add index tracking
    const indexed = matrix.map((entry, index) => ({ entry, index }));
    indexed.sort((a, b) => {
        const rateA = (a.entry['failure-rate'] as number) || 0;
        const rateB = (b.entry['failure-rate'] as number) || 0;
        if (rateB !== rateA) {
            return rateB - rateA; // Higher failure rate first
        }
        // Preserve original order for equal rates (stable sort)
        return a.index - b.index;
    });

    // Copy sorted entries back to matrix
    for (let i = 0; i < matrix.length; i++) {
        matrix[i] = indexed[i].entry;
    }

    fnlog('Matrix sorted by failure rate');
}
