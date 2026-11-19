import { describePrettyErrors } from './test-helper';

// The helper registers its own `describe('pretty errors')` suite. Running it
// here exercises the helper exactly the way action test suites use it.
describePrettyErrors('gcc boom', 'Setup GCC failed');

describe('describePrettyErrors', () => {
    it('is a function taking an error message and a title', () => {
        expect(typeof describePrettyErrors).toBe('function');
        expect(describePrettyErrors).toHaveLength(2);
    });

    it('registers a nested describe block with two tests', () => {
        const describeSpy = jest.fn((_name: string, fn: () => void) => fn());
        const itSpy = jest.fn();
        const origDescribe = global.describe;
        const origIt = global.it;
        (global as unknown as { describe: unknown }).describe = describeSpy;
        (global as unknown as { it: unknown }).it = itSpy;
        try {
            describePrettyErrors('msg', 'Title');
        } finally {
            (global as unknown as { describe: unknown }).describe = origDescribe;
            (global as unknown as { it: unknown }).it = origIt;
        }
        expect(describeSpy).toHaveBeenCalledWith('pretty errors', expect.any(Function));
        expect(itSpy.mock.calls.map(c => c[0])).toEqual([
            'logs once and fails once for regular Error',
            'produces clean message for ExpectedError'
        ]);
    });
});
