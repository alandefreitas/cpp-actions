import * as core from '@actions/core';

let traceCommands: boolean = process.env['ACTIONS_STEP_DEBUG'] === 'true';

export function log(...args: unknown[]): void {
    const message = args.map(String).join(' ');
    if (traceCommands) {
        core.info(message);
    } else {
        core.debug(message);
    }
}

export function set_trace_commands(trace: boolean): void {
    traceCommands = trace;
}

export function enabled(): boolean {
    return traceCommands;
}

// Export the variable for backward compatibility (though it won't track updates)
export { traceCommands as trace_commands };
