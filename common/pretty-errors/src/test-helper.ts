/**
 * Reusable test helper for verifying pretty-errors integration in action suites.
 *
 * Creates a `describe` block that mocks `@actions/core`, loads the real
 * `reportAndSetFailed` function, and asserts it completes without throwing.
 *
 * @module pretty-errors/test-helper
 */

/**
 * Registers a `describe('pretty errors', ...)` suite that exercises the real
 * `reportAndSetFailed` function with a mocked `@actions/core`.
 *
 * @param errorMsg - Error message string to test with (e.g. `'gcc boom'`)
 * @param title - Title passed to `reportAndSetFailed` options (e.g. `'Setup GCC failed'`)
 */
export function describePrettyErrors(errorMsg: string, title: string): void {
    describe('pretty errors', () => {
        it('logs once and fails once', async () => {
            let runPromise: Promise<void> | undefined;
            jest.isolateModules(() => {
                jest.resetModules();
                jest.doMock('@actions/core', () => ({
                    error: jest.fn(),
                    setFailed: jest.fn()
                }));
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { reportAndSetFailed } = require('./index');
                runPromise = reportAndSetFailed(new Error(errorMsg), { title });
            });
            if (runPromise) {
                await runPromise;
            }
        });
    });
}
