const core = require('@actions/core')

let trace_commands = process.env['ACTIONS_STEP_DEBUG'] === 'true'

function log(...args) {
    if (trace_commands) {
        core.info(args.join(' '))
    } else {
        core.debug(args.join(' '))
    }
}

function set_trace_commands(trace) {
    trace_commands = trace
}

function enabled() {
    return trace_commands
}

module.exports = {
    trace_commands,
    set_trace_commands,
    enabled,
    log
}