/**
 * Type definitions for flamegraph action.
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
 * A single event from a Chrome trace file.
 */
export interface TraceEvent {
    name: string;
    ph: string;
    ts: number;
    dur?: number;
    pid?: number;
    tid?: number;
    args?: {
        detail?: string;
    };
    cat?: string;
}

/**
 * Structure of a Chrome trace file.
 */
export interface Trace {
    traceEvents: TraceEvent[];
}

/**
 * A single compile command entry from compile_commands.json.
 */
export interface CompileCommand {
    command: string;
    file: string;
}

/**
 * Inputs for artifact upload.
 */
export interface UploadArtifactsInputs {
    /** Path to the output file */
    outputPath: string;
    /** Path to the report file */
    reportPath: string;
    /** Build directory containing the traces */
    buildDir: string;
    /** Number of days to retain the artifacts */
    packageRetentionDays?: number;
}

/**
 * Inputs for the main flamegraph action.
 */
export interface MainInputs {
    /** Source directory path */
    sourceDir: string;
    /** Build directory containing time traces */
    buildDir: string;
    /** Output path for combined traces */
    outputPath: string;
    /** Output path for the report */
    reportPath: string;
    /** Whether to update the GitHub Actions summary */
    updateSummary: boolean;
    /** Whether to upload artifacts */
    uploadArtifact: boolean;
    /** Artifact retention period in days */
    packageRetentionDays?: number;
}

/**
 * Outputs from the main flamegraph action.
 */
export interface MainOutputs {
    /** Path to the combined traces file */
    tracesPath: string;
    /** Path to the generated SVG file */
    svgPath: string;
}
