import * as traceModule from './index';

// Mock @actions/core
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn()
}));

import * as core from '@actions/core';

describe('trace-commands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        traceModule.set_trace_commands(false);
    });

    describe('log', () => {
        it('should call core.debug when trace is disabled', () => {
            traceModule.set_trace_commands(false);
            traceModule.log('test message');

            expect(core.debug).toHaveBeenCalledWith('test message');
            expect(core.info).not.toHaveBeenCalled();
        });

        it('should call core.info when trace is enabled', () => {
            traceModule.set_trace_commands(true);
            traceModule.log('test message');

            expect(core.info).toHaveBeenCalledWith('test message');
            expect(core.debug).not.toHaveBeenCalled();
        });

        it('should join multiple arguments with spaces', () => {
            traceModule.set_trace_commands(true);
            traceModule.log('hello', 'world', 123);

            expect(core.info).toHaveBeenCalledWith('hello world 123');
        });
    });

    describe('set_trace_commands', () => {
        it('should enable tracing', () => {
            traceModule.set_trace_commands(true);
            expect(traceModule.enabled()).toBe(true);
        });

        it('should disable tracing', () => {
            traceModule.set_trace_commands(true);
            traceModule.set_trace_commands(false);
            expect(traceModule.enabled()).toBe(false);
        });
    });

    describe('enabled', () => {
        it('should return current trace state', () => {
            traceModule.set_trace_commands(false);
            expect(traceModule.enabled()).toBe(false);

            traceModule.set_trace_commands(true);
            expect(traceModule.enabled()).toBe(true);
        });
    });
});
