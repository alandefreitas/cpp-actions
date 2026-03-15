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
        traceModule.setTraceCommands(false);
    });

    describe('log', () => {
        it('should call core.debug when trace is disabled', () => {
            traceModule.setTraceCommands(false);
            traceModule.log('test message');

            expect(core.debug).toHaveBeenCalledWith('test message');
            expect(core.info).not.toHaveBeenCalled();
        });

        it('should call core.info when trace is enabled', () => {
            traceModule.setTraceCommands(true);
            traceModule.log('test message');

            expect(core.info).toHaveBeenCalledWith('test message');
            expect(core.debug).not.toHaveBeenCalled();
        });

        it('should join multiple arguments with spaces', () => {
            traceModule.setTraceCommands(true);
            traceModule.log('hello', 'world', 123);

            expect(core.info).toHaveBeenCalledWith('hello world 123');
        });
    });

    describe('setTraceCommands', () => {
        it('should enable tracing', () => {
            traceModule.setTraceCommands(true);
            expect(traceModule.enabled()).toBe(true);
        });

        it('should disable tracing', () => {
            traceModule.setTraceCommands(true);
            traceModule.setTraceCommands(false);
            expect(traceModule.enabled()).toBe(false);
        });
    });

    describe('scoped', () => {
        it('should return a function that logs with the given prefix', () => {
            traceModule.setTraceCommands(true);
            const scopedLog = traceModule.scoped('myModule');
            scopedLog('hello');

            expect(core.info).toHaveBeenCalledWith('myModule: hello');
        });

        it('should respect trace disabled state', () => {
            traceModule.setTraceCommands(false);
            const scopedLog = traceModule.scoped('myModule');
            scopedLog('hello');

            expect(core.debug).toHaveBeenCalledWith('myModule: hello');
            expect(core.info).not.toHaveBeenCalled();
        });
    });

    describe('enabled', () => {
        it('should return current trace state', () => {
            traceModule.setTraceCommands(false);
            expect(traceModule.enabled()).toBe(false);

            traceModule.setTraceCommands(true);
            expect(traceModule.enabled()).toBe(true);
        });
    });

    describe('traceCommands export', () => {
        it('should export the traceCommands flag', () => {
            expect(typeof traceModule.traceCommands).toBe('boolean');
        });
    });
});
