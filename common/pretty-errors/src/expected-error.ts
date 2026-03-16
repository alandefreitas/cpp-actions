/**
 * Error class for expected, user-facing failures.
 *
 * Expected errors (subprocess failures, tool-not-found, config errors) are
 * rendered as clean messages without stack traces. Logic errors (bugs in
 * action code) still produce the full pretty-error stack trace.
 *
 * @module expected-error
 */

/**
 * An error representing an expected failure condition.
 *
 * When caught by {@link reportAndSetFailed}, instances of this class produce
 * a clean, user-friendly message without a stack trace or source context.
 * The stack trace is still available at `core.debug()` level for debugging.
 */
export class ExpectedError extends Error {
    /** Optional annotation title for the GitHub Actions error annotation. */
    title?: string;

    /**
     * Creates a new ExpectedError.
     *
     * @param message - The user-facing error message
     * @param title - Optional title for the GitHub Actions error annotation
     */
    constructor(message: string, title?: string) {
        super(message);
        this.name = 'ExpectedError';
        this.title = title;
    }
}

/**
 * Convenience factory for creating ExpectedError instances.
 *
 * @param message - The user-facing error message
 * @param title - Optional title for the GitHub Actions error annotation
 * @returns A new ExpectedError instance
 */
export function expectedError(message: string, title?: string): ExpectedError {
    return new ExpectedError(message, title);
}
