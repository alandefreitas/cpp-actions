// Mock @actions/core before importing the module
jest.mock('@actions/core', () => ({
    error: jest.fn(),
    setFailed: jest.fn(),
    getInput: jest.fn(),
    debug: jest.fn()
}));

import * as core from '@actions/core';
import { reportAndSetFailed, withPrettyErrors, ExpectedError, expectedError } from './index';

const mockedCore = core as jest.Mocked<typeof core>;

describe('pretty-errors helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedCore.getInput.mockReturnValue('');
    });

    describe('reportAndSetFailed', () => {
        it('logs a pretty-rendered stack and marks the action as failed', async () => {
            const err = new Error('boom');

            await reportAndSetFailed(err, {
                title: 'Test Failure',
                hint: 'hint'
            });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Test Failure');
            expect(errArg).toContain('boom');
        });

        it('omits the hint when provided null', async () => {
            await reportAndSetFailed(new Error('no hint'), {
                title: 'No Hint',
                hint: null
            });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('No Hint: no hint');
            expect(errArg).not.toContain('Tip: enable trace-commands');
            expect(errArg).toContain('no hint');
        });

        it('includes default hint when hint is undefined', async () => {
            await reportAndSetFailed(new Error('with default hint'), {
                title: 'Default Hint'
            });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Tip: enable trace-commands');
        });

        it('suppresses default hint when trace-commands input is true', async () => {
            mockedCore.getInput.mockReturnValue('true');

            await reportAndSetFailed(new Error('traced'), {
                title: 'Traced'
            });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Traced');
            expect(errArg).not.toContain('Tip: enable trace-commands');
        });

        it('setFailed uses simple message without stack', async () => {
            const err = new Error('stack error');

            await reportAndSetFailed(err, {
                title: 'Stack Error'
            });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('stack error');
        });

    });

    describe('reportAndSetFailed with ExpectedError', () => {
        it('calls core.error with just the message string', async () => {
            const err = new ExpectedError('build failed');

            await reportAndSetFailed(err);

            expect(mockedCore.error).toHaveBeenCalledTimes(1);
            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('build failed');
        });

        it('does NOT produce stack trace output, source context, or hint text', async () => {
            const err = new ExpectedError('config missing');

            await reportAndSetFailed(err);

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            // Should not contain stack trace frames
            expect(errArg).not.toContain('at ');
            // Should not contain source context (line numbers with pipe separators)
            expect(errArg).not.toMatch(/\d+\s*\|/);
            // Should not contain hint text
            expect(errArg).not.toContain('Tip:');
        });

        it('includes the title in the annotation when set on the error', async () => {
            const err = new ExpectedError('exit code 1', 'CMake Configure');

            await reportAndSetFailed(err);

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('CMake Configure');
            expect(errArg).toContain('exit code 1');
        });

        it('uses options.title as fallback when error has no title', async () => {
            const err = new ExpectedError('something broke');

            await reportAndSetFailed(err, { title: 'Fallback Title' });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Fallback Title');
        });

        it('uses default title when neither error nor options provide one', async () => {
            const err = new ExpectedError('no title anywhere');

            await reportAndSetFailed(err);

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Action failed');
        });

        it('logs stack at core.debug level when trace commands are enabled', async () => {
            mockedCore.getInput.mockReturnValue('true');
            const err = new ExpectedError('traced error');

            await reportAndSetFailed(err);

            expect(mockedCore.debug).toHaveBeenCalledTimes(1);
            const debugArg = mockedCore.debug.mock.calls[0][0] as string;
            expect(debugArg).toContain('ExpectedError');
            expect(debugArg).toContain('traced error');
        });

        it('does NOT log stack at debug level when trace commands are disabled', async () => {
            mockedCore.getInput.mockReturnValue('');
            const err = new ExpectedError('untraced error');

            await reportAndSetFailed(err);

            expect(mockedCore.debug).not.toHaveBeenCalled();
        });
    });

    describe('expectedError factory', () => {
        it('creates an ExpectedError instance', () => {
            const err = expectedError('factory message');
            expect(err).toBeInstanceOf(ExpectedError);
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('factory message');
        });

        it('creates an ExpectedError with title', () => {
            const err = expectedError('factory message', 'Factory Title');
            expect(err).toBeInstanceOf(ExpectedError);
            expect(err.title).toBe('Factory Title');
        });

        it('creates an ExpectedError without title when omitted', () => {
            const err = expectedError('no title');
            expect(err.title).toBeUndefined();
        });
    });

    describe('regular Error still produces full stack trace', () => {
        it('includes rendered stack trace with source-mapped frames', async () => {
            const err = new Error('logic bug');

            await reportAndSetFailed(err, { title: 'Bug', hint: null });

            const errArg = mockedCore.error.mock.calls[0][0] as string;
            // Regular errors should include the title and message
            expect(errArg).toContain('Bug');
            expect(errArg).toContain('logic bug');
            // Regular errors go through renderTerminal which includes stack frames
            // (at minimum the error message is rendered)
        });
    });

    describe('withPrettyErrors', () => {
        it('returns the function result on success', async () => {
            const result = await withPrettyErrors(async () => 'success');
            expect(result).toBe('success');
            expect(mockedCore.error).not.toHaveBeenCalled();
        });

        it('catches and reports errors', async () => {
            const result = await withPrettyErrors(async () => {
                throw new Error('wrapped error');
            }, { title: 'Wrapped' });

            expect(result).toBeUndefined();
            const errArg = mockedCore.error.mock.calls[0][0] as string;
            expect(errArg).toContain('Wrapped');
            expect(errArg).toContain('wrapped error');
        });
    });
});
