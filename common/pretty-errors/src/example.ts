/**
 * Example script demonstrating pretty-errors functionality.
 * Run with: npm run example -w pretty-errors
 *
 * This script mocks @actions/core to print to console instead of
 * using GitHub Actions workflow commands.
 */

// Mock @actions/core before importing pretty-errors
// This redirects error output to console for demonstration
const mockCore = {
    error: (msg: string) => {
        console.log('\n' + '─'.repeat(70));
        console.log('📋 core.error() output:');
        console.log('─'.repeat(70));
        console.log(msg);
    },
    setFailed: (msg: string) => {
        console.log('\n' + '─'.repeat(70));
        console.log('❌ core.setFailed() output:');
        console.log('─'.repeat(70));
        console.log(msg);
    }
};

// Inject mock before module loads
require.cache[require.resolve('@actions/core')] = {
    id: require.resolve('@actions/core'),
    filename: require.resolve('@actions/core'),
    loaded: true,
    exports: mockCore
} as NodeModule;

// Now import pretty-errors (it will use our mock)
import { reportAndSetFailed, withPrettyErrors } from './index';

/** Demonstrates basic error with title and custom hint. */
async function demonstrateBasicError(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 1: Basic error with title and hint');
    console.log('='.repeat(70));

    const error = new Error('Database connection failed');
    await reportAndSetFailed(error, {
        title: 'Connection Error',
        hint: 'Check that the database server is running and credentials are correct.'
    });
}

/** Demonstrates error with stack trace included in setFailed output. */
async function demonstrateErrorWithStack(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 2: Error with stack trace in setFailed');
    console.log('='.repeat(70));

    const error = new Error('Unexpected null pointer');
    await reportAndSetFailed(error, {
        title: 'Runtime Error',
        hint: 'Enable trace-commands for more details.'
    });
}

/** Demonstrates error from nested function calls showing stack hierarchy.
 *
 * @throws Error always
 */
async function demonstrateNestedError(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 3: Nested function error (deeper stack trace)');
    console.log('='.repeat(70));

    function innerFunction() {
        throw new Error('Something went wrong deep in the stack');
    }

    function middleFunction() {
        innerFunction();
    }

    function outerFunction() {
        middleFunction();
    }

    try {
        outerFunction();
    } catch (error) {
        await reportAndSetFailed(error as Error, {
            title: 'Nested Error',
            hint: 'Check the stack trace to see the call hierarchy.'
        });
    }
}

/** Demonstrates the withPrettyErrors wrapper function.
 *
 * @throws Error always
 */
async function demonstrateWithPrettyErrors(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 4: Using withPrettyErrors wrapper');
    console.log('='.repeat(70));

    const result = await withPrettyErrors(
        async () => {
            // Simulate some async work that fails
            await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error('Async operation failed');
        },
        {
            title: 'Async Error'
        }
    );

    console.log(`\n→ withPrettyErrors returned: ${result}`);
}

/** Demonstrates error with default hint when hint is not specified. */
async function demonstrateDefaultHint(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 5: Error with default hint (hint not specified)');
    console.log('='.repeat(70));

    const error = new Error('Build failed');
    await reportAndSetFailed(error, {
        title: 'Build Error'
        // hint is undefined, so default hint will be shown
    });
}

/** Demonstrates withPrettyErrors returning successfully when no error occurs. */
async function demonstrateSuccessCase(): Promise<void> {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Example 6: withPrettyErrors success case (no error)');
    console.log('='.repeat(70));

    const result = await withPrettyErrors(
        async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { status: 'ok', data: [1, 2, 3] };
        },
        { title: 'Should Not Appear' }
    );

    console.log(`\n→ withPrettyErrors returned successfully: ${JSON.stringify(result)}`);
}

/** Runs all demonstration examples. */
async function main(): Promise<void> {
    console.log('\n');
    console.log('='.repeat(70));
    console.log('Pretty Errors - Feature Demonstration');
    console.log('This script shows how errors are rendered with pretty-errors.');
    console.log('='.repeat(70));

    await demonstrateBasicError();
    await demonstrateErrorWithStack();
    await demonstrateNestedError();
    await demonstrateWithPrettyErrors();
    await demonstrateDefaultHint();
    await demonstrateSuccessCase();

    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('End of demonstration');
    console.log('='.repeat(70));
    console.log('\n');
}

main().catch(console.error);
