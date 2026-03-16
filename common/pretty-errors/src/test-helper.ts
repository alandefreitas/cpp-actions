/**
 * Reusable test helper for verifying pretty-errors integration in action suites.
 *
 * Creates a `describe` block that mocks `@actions/core`, loads the real
 * `reportAndSetFailed` function, and asserts it completes without throwing
 * for both regular Error and ExpectedError paths.
 *
 * @module pretty-errors/test-helper
 */

/**
 * Registers a `describe('pretty errors', ...)` suite that exercises the real
 * `reportAndSetFailed` function with a mocked `@actions/core` for both
 * regular errors (full stack trace) and expected errors (clean message).
 *
 * @param errorMsg - Error message string to test with (e.g. `'gcc boom'`)
 * @param title - Title passed to `reportAndSetFailed` options (e.g. `'Setup GCC failed'`)
 */
export function describePrettyErrors(errorMsg: string, title: string): void {
    describe('pretty errors', () => {
        it('logs once and fails once for regular Error', async () => {
            let runPromise: Promise<void> | undefined;
            jest.isolateModules(() => {
                jest.resetModules();
                jest.doMock('@actions/core', () => ({
                    error: jest.fn(),
                    setFailed: jest.fn(),
                    debug: jest.fn()
                }));
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { reportAndSetFailed } = require('./index');
                runPromise = reportAndSetFailed(new Error(errorMsg), { title });
            });
            if (runPromise) {
                await runPromise;
            }
        });

        it('produces clean message for ExpectedError', async () => {
            let runPromise: Promise<void> | undefined;
            let mockCore: { error: jest.Mock; setFailed: jest.Mock; debug: jest.Mock };
            jest.isolateModules(() => {
                jest.resetModules();
                mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn(),
                    debug: jest.fn()
                };
                jest.doMock('@actions/core', () => mockCore);
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { reportAndSetFailed, ExpectedError } = require('./index');
                const err = new ExpectedError(errorMsg, title);
                runPromise = reportAndSetFailed(err);
            });
            if (runPromise) {
                await runPromise;
            }
            // Verify clean message without stack trace
            const errArg = mockCore!.error.mock.calls[0][0] as string;
            expect(errArg).toContain(errorMsg);
            expect(errArg).toContain(title);
            expect(errArg).not.toContain('Tip:');
        });
    });
}
