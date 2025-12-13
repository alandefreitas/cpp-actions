// Mock @actions/core before importing the module
jest.mock('@actions/core', () => ({
    error: jest.fn(),
    setFailed: jest.fn()
}));

import * as core from '@actions/core';
import { reportAndSetFailed, withPrettyErrors } from './index';

const mockedCore = core as jest.Mocked<typeof core>;

describe('pretty-errors helper', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('reportAndSetFailed', () => {
        it('logs a Youch-rendered stack and marks the action as failed', async () => {
            const err = new Error('boom');

            await reportAndSetFailed(err, {
                title: 'Test Failure',
                hint: 'hint',
                locals: { foo: 'bar' }
            });

            expect(mockedCore.error).toHaveBeenCalledTimes(1);
            const payload = mockedCore.error.mock.calls[0][0] as string;
            expect(payload).toContain('Test Failure');
            expect(payload).toContain('boom');
            expect(payload).toContain('Locals');
            expect(mockedCore.setFailed).toHaveBeenCalledWith('boom');
        });

        it('omits the hint when provided null', async () => {
            await reportAndSetFailed(new Error('no hint'), {
                title: 'No Hint',
                hint: null
            });

            const payload = mockedCore.error.mock.calls[0][0] as string;
            expect(payload).toContain('No Hint: no hint');
            expect(payload).not.toContain('Tip: enable trace-commands');
            expect(mockedCore.setFailed).toHaveBeenCalledWith('no hint');
        });

        it('includes default hint when hint is undefined', async () => {
            await reportAndSetFailed(new Error('with default hint'), {
                title: 'Default Hint'
            });

            const payload = mockedCore.error.mock.calls[0][0] as string;
            expect(payload).toContain('Tip: enable trace-commands');
        });

        it('includes stack in setFailed when includeStackInSetFailed is true', async () => {
            const err = new Error('stack error');

            await reportAndSetFailed(err, {
                title: 'Stack Error',
                includeStackInSetFailed: true
            });

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('stack error');
            expect(setFailedArg).toContain('Error:');
        });

        it('handles locals as a function', async () => {
            await reportAndSetFailed(new Error('func locals'), {
                title: 'Func Locals',
                locals: () => ({ computed: 'value' })
            });

            const payload = mockedCore.error.mock.calls[0][0] as string;
            expect(payload).toContain('Locals');
            expect(payload).toContain('computed');
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
            expect(mockedCore.error).toHaveBeenCalledTimes(1);
            const payload = mockedCore.error.mock.calls[0][0] as string;
            expect(payload).toContain('Wrapped');
            expect(payload).toContain('wrapped error');
        });
    });
});
