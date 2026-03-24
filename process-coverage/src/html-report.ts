/**
 * HTML coverage report generation using genhtml.
 *
 * Produces a browsable HTML coverage report from an LCOV .info file,
 * with optional upload as a GitHub Actions artifact.
 *
 * @module html-report
 */

import * as path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as traceCommands from 'trace-commands';
import {DefaultArtifactClient} from '@actions/artifact';
import {create as createGlob} from '@actions/glob';

const fnlog = traceCommands.scoped('html-report');

/**
 * Generates an HTML coverage report from an LCOV file using genhtml.
 *
 * Falls back to a warning if genhtml is not available, rather than
 * failing the action. This allows Clang-only pipelines (which may
 * not have lcov/genhtml installed) to proceed without error.
 *
 * @param lcovFile - Absolute path to the LCOV .info file
 * @param outputDir - Directory where the HTML report will be written
 * @param genhtmlPath - Path to the genhtml binary (if already known)
 * @returns Absolute path to the output directory, or empty string if genhtml is unavailable
 */
export async function generateHtmlReport(
    lcovFile: string,
    outputDir: string,
    genhtmlPath?: string
): Promise<string> {
    const resolvedDir = path.resolve(outputDir);

    const genhtml = genhtmlPath ?? 'genhtml';

    // --keep-going tells genhtml to produce a result despite data errors
    // (e.g., lcov v2 consistency checks on C++ templates/inline functions).
    // See: https://github.com/linux-test-project/lcov/issues/319
    try {
        const result = await exec.getExecOutput(genhtml, [
            lcovFile,
            '--output-directory',
            resolvedDir,
            '--keep-going'
        ], {ignoreReturnCode: true});

        if (result.exitCode !== 0) {
            core.info(`genhtml exited with code ${result.exitCode} (errors were encountered but --keep-going was used)`);
        }

        // Check if genhtml actually produced output despite errors
        const { existsSync } = await import('node:fs');
        const indexFile = path.join(resolvedDir, 'index.html');
        if (existsSync(indexFile)) {
            core.info(`HTML coverage report written to ${resolvedDir}`);
            return resolvedDir;
        }
    } catch {
        // genhtml binary not found or other spawn error
    }

    core.warning('Failed to generate HTML coverage report with genhtml');
    return '';
}

/**
 * Uploads an HTML coverage report directory as a GitHub Actions artifact.
 *
 * Skips the upload gracefully if the report directory is empty (meaning
 * the report was not generated).
 *
 * @param reportDir - Absolute path to the HTML report directory
 * @param artifactName - Name for the uploaded artifact
 * @param retentionDays - Number of days to retain the artifact
 * @throws If the artifact upload fails
 */
export async function uploadHtmlArtifact(
    reportDir: string,
    artifactName: string,
    retentionDays: number
): Promise<void> {
    if (!reportDir) {
        fnlog(
            'Skipping HTML report artifact upload — report was not generated.'
        );
        return;
    }

    const { lstatSync } = await import('node:fs');
    const globber = await createGlob(
        path.join(reportDir, '**', '*'),
        {followSymbolicLinks: false}
    );
    const allEntries = await globber.glob();
    const files = allEntries.filter(f => {
        try { return lstatSync(f).isFile(); } catch { return false; }
    });
    fnlog(`Found ${files.length} file(s) in report directory`);

    if (files.length === 0) {
        core.warning(
            'HTML report directory is empty — skipping artifact upload.'
        );
        return;
    }

    const client = new DefaultArtifactClient();
    await client.uploadArtifact(artifactName, files, reportDir, {
        retentionDays
    });
    core.info(
        `Uploaded ${files.length} files as artifact "${artifactName}"`
    );
}
