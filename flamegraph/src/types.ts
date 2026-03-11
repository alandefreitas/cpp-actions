/**
 * Core trace data types for flamegraph action.
 *
 * These types are shared across 3+ modules (index.ts, flamegraph-svg.ts, trace-files.ts).
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
