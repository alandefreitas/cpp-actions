/**
 * Schema definitions for the flamegraph action.
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
 * Input schema for the flamegraph action.
 */
export const inputsSchema = {
    ...baseInputs,

    source_dir: {
        type: 'path' as const,
        default: '.',
        description: `The source directory used to generate time-traces.

Relative paths in the report will be relative to the current working directory.`
    },

    build_dir: {
        type: 'path' as const,
        default: '.',
        description: `The directory with the time-traces.

This should usually be your \`build\` directory, if any.

The default value is the same as the source-dir, so all time-trace files will
be scanned in all subdirectories of the source-dir.

If this is a relative path, it will be made relative to the current working directory.`
    },

    output_path: {
        type: 'path' as const,
        default: 'combined-traces.json',
        description: `The path where the combined traces will be stored.

If this is a relative path, it will be made relative to the build-dir.`
    },

    report_path: {
        type: 'path' as const,
        default: 'time-trace-report.md',
        description: `The path where the report will be stored.

If this is a relative path, it will be made relative to the build-dir.`
    },

    generate_svg: {
        type: 'boolean' as const,
        default: true,
        description: 'Generate an SVG file with the output.'
    },

    generate_report: {
        type: 'boolean' as const,
        default: true,
        description: `Generate a markdown report analyzing compilation times.

The report includes:
- Summary of time spent in each compilation phase (frontend, backend, parsing, instantiation)
- Per-file breakdown showing which files take longest to compile
- Symbol analysis showing which templates and functions are slowest to parse/instantiate`
    },

    update_summary: {
        type: 'boolean' as const,
        default: true,
        description: `Update the GitHub Actions job summary with the time-trace report.

When enabled, the compilation time analysis is displayed directly in the
workflow run summary, making it easy to review without downloading artifacts.`
    },

    github_token: {
        type: 'string' as const,
        default: '',
        description: 'The GitHub token used to upload the artifacts.'
    },

    upload_artifact: {
        type: 'boolean' as const,
        default: true,
        description: `Upload combined traces and visualizations as a GitHub Actions artifact.

The artifact includes:
- combined-traces.json: Can be opened with speedscope.app or chrome://tracing
- combined-traces.json.svg: Interactive SVG flamegraph viewable in browser
- time-trace-report.md: Markdown report with compilation time analysis`
    }
} satisfies ActionInputsSchema;

/**
 * Output schema for the flamegraph action.
 */
export const outputsSchema = {
    traces_path: {
        description: 'The absolute path to combined traces.'
    },
    svg_path: {
        description: 'The absolute path to svg file.'
    }
} satisfies ActionOutputsSchema;
