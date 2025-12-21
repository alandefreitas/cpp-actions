/**
 * Type definitions for flamegraph action.
 *
 * @module types
 */

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
    output_path: string;
    /** Path to the report file */
    report_path: string;
    /** Build directory containing the traces */
    build_dir: string;
    /** Number of days to retain the artifacts */
    package_retention_days?: number;
}

/**
 * Inputs for the main flamegraph action.
 */
export interface MainInputs {
    /** Source directory path */
    source_dir: string;
    /** Build directory containing time traces */
    build_dir: string;
    /** Output path for combined traces */
    output_path: string;
    /** Output path for the report */
    report_path: string;
    /** Whether to update the GitHub Actions summary */
    update_summary: boolean;
    /** Whether to upload artifacts */
    upload_artifact: boolean;
    /** Artifact retention period in days */
    package_retention_days?: number;
}

/**
 * Outputs from the main flamegraph action.
 */
export interface MainOutputs {
    /** Path to the combined traces file */
    traces_path: string;
    /** Path to the generated SVG file */
    svg_path: string;
}
