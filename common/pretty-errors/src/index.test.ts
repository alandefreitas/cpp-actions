// Mock @actions/core before importing the module
jest.mock('@actions/core', () => ({
    error: jest.fn(),
    setFailed: jest.fn(),
    getInput: jest.fn()
}));

import * as core from '@actions/core';
import { reportAndSetFailed, withPrettyErrors } from './index';

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

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('Test Failure');
            expect(setFailedArg).toContain('boom');
        });

        it('omits the hint when provided null', async () => {
            await reportAndSetFailed(new Error('no hint'), {
                title: 'No Hint',
                hint: null
            });

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('No Hint: no hint');
            expect(setFailedArg).not.toContain('Tip: enable trace-commands');
            expect(setFailedArg).toContain('no hint');
        });

        it('includes default hint when hint is undefined', async () => {
            await reportAndSetFailed(new Error('with default hint'), {
                title: 'Default Hint'
            });

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('Tip: enable trace-commands');
        });

        it('suppresses default hint when trace-commands input is true', async () => {
            mockedCore.getInput.mockReturnValue('true');

            await reportAndSetFailed(new Error('traced'), {
                title: 'Traced'
            });

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('Traced');
            expect(setFailedArg).not.toContain('Tip: enable trace-commands');
        });

        it('setFailed uses simple message without stack', async () => {
            const err = new Error('stack error');

            await reportAndSetFailed(err, {
                title: 'Stack Error'
            });

            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('stack error');
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
            const setFailedArg = mockedCore.setFailed.mock.calls[0][0] as string;
            expect(setFailedArg).toContain('Wrapped');
            expect(setFailedArg).toContain('wrapped error');
        });
    });
});
