import * as core from '@actions/core';

let traceCommands: boolean = process.env['ACTIONS_STEP_DEBUG'] === 'true';

/**
 * Logs a message to the GitHub Actions output with conditional visibility.
 *
 * When trace commands are enabled (via ACTIONS_STEP_DEBUG=true or set_trace_commands),
 * messages are logged using core.info() making them visible in the workflow output.
 * Otherwise, messages are logged using core.debug() and only visible when debug
 * logging is enabled.
 *
 * @param args - Values to log. Each value is converted to string and joined with spaces.
 */
export function log(...args: unknown[]): void {
    const message = args.map(String).join(' ');
    if (traceCommands) {
        core.info(message);
    } else {
        core.debug(message);
    }
}

/**
 * Creates a scoped logging function that prepends a fixed prefix to each message.
 *
 * Useful for tagging debug output with the originating function or module name
 * without repeating the prefix at every call site.
 *
 * @param name - Prefix to prepend before each message (e.g., "fetchMetadata")
 * @returns A function that logs `"name: msg"` through {@link log}
 */
export function scoped(name: string): (msg: string) => void {
    return (msg: string) => log(`${name}: ${msg}`);
}

/**
 * Enables or disables trace command output for the action.
 *
 * When enabled, log() calls will output to info level (visible in workflow logs).
 * When disabled, log() calls will output to debug level (only visible with debug enabled).
 *
 * @param trace - True to enable trace command output, false to disable
 */
export function set_trace_commands(trace: boolean): void {
    traceCommands = trace;
}

/**
 * Returns whether trace commands are currently enabled.
 *
 * Trace commands are enabled by default if the ACTIONS_STEP_DEBUG environment
 * variable is set to 'true', or if set_trace_commands(true) has been called.
 *
 * @returns True if trace commands are enabled, false otherwise
 */
export function enabled(): boolean {
    return traceCommands;
}

/**
 * Exported trace commands flag for backward compatibility.
 *
 * Note: This export reflects the initial state and will not track dynamic updates
 * made via set_trace_commands(). Use enabled() for current state.
 */
export { traceCommands as trace_commands };
