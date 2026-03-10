/**
 * Standardized action runner infrastructure.
 *
 * This module provides wrapper functions that handle the common boilerplate
 * for GitHub Actions entry points:
 * - Input extraction from schema
 * - Trace commands setup
 * - Input/output logging
 * - Error handling with pretty-errors
 *
 * @module runner
 */

import * as core from '@actions/core';
import * as trace_commands from 'trace-commands';
import * as gh_inputs from 'gh-inputs';
import { reportAndSetFailed } from 'pretty-errors';
import { parseInputs } from './parser';
import type { ActionInputsSchema, InferInputs, RunnerOptions } from './types';

/**
 * Base interface for inputs that support tracing.
 *
 * This is automatically satisfied when your schema includes `baseInputs` or `setupInputs`,
 * since they define the `trace_commands` field.
 */
export interface TraceableInputs {
    trace_commands: boolean;
}

/**
 * Creates a standardized action runner function.
 *
 * This function handles:
 * - Input extraction from schema
 * - Enabling trace commands if requested
 * - Logging inputs and outputs
 * - Calling the main action logic
 *
 * @param options - Runner configuration including schema and main function
 * @returns An async function that runs the action
 *
 * @example
 * ```typescript
 * const run = createActionRunner({
 *     inputsSchema: gccInputsSchema,
 *     title: 'Setup GCC',
 *     main: async (inputs) => {
 *         // Main action logic
 *         return { cc: '/usr/bin/gcc', cxx: '/usr/bin/g++', ... };
 *     }
 * });
 *
 * await run();
 * ```
 */
export function createActionRunner<
    S extends ActionInputsSchema,
    I extends InferInputs<S> & TraceableInputs,
    O extends object
>(
    options: RunnerOptions<I, O> & { inputsSchema: S }
): () => Promise<void> {
    const { inputsSchema, title, main, validateOutputs, failureMessage } = options;

    return async function run(): Promise<void> {
        // Extract inputs from schema
        const inputs = parseInputs(inputsSchema) as I;

        // Enable tracing if requested
        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true);
        }

        // Log inputs
        core.startGroup('📥 Action Inputs');
        gh_inputs.printInputObject(inputs as unknown as Record<string, unknown>);
        core.endGroup();

        // Run main action logic
        const outputs = await main(inputs);

        // Validate outputs if validator provided
        if (validateOutputs && !validateOutputs(outputs)) {
            core.setFailed(failureMessage ?? `${title} failed: output validation failed`);
            return;
        }

        // Log and set outputs
        core.startGroup('📤 Action Outputs');
        gh_inputs.setOutputObject(outputs as unknown as Record<string, unknown>);
        core.endGroup();
    };
}

/**
 * Options for the runAction entry point.
 */
export interface RunActionOptions<
    S extends ActionInputsSchema,
    I extends InferInputs<S> & TraceableInputs,
    O extends object
> extends RunnerOptions<I, O> {
    /** The inputs schema */
    inputsSchema: S;

    /**
     * Reference to the module object for checking if this is the main module.
     * Pass `module` from the calling file.
     */
    callerModule?: NodeModule;
}

/**
 * Complete entry point for a GitHub Action with error handling.
 *
 * This function should be called at the module level of your action's entry file.
 * It only executes if the current file is the main module (not imported).
 *
 * @param options - Runner configuration
 *
 * @example
 * ```typescript
 * // setup-gcc/src/index.ts
 * import { runAction, setupInputs } from 'action-schema';
 *
 * const inputsSchema = {
 *     ...setupInputs,
 *     version: {
 *         ...setupInputs.version,
 *         transform: removeGCCPrefix
 *     }
 * } as const;
 *
 * runAction({
 *     inputsSchema,
 *     title: 'Setup GCC',
 *     main: async (inputs) => setupGCC(inputs),
 *     callerModule: module
 * });
 * ```
 */
export function runAction<
    S extends ActionInputsSchema,
    I extends InferInputs<S> & TraceableInputs,
    O extends object
>(
    options: RunActionOptions<S, I, O>
): void {
    const { callerModule, title, ...runnerOptions } = options;

    // Only run if this is the main module
    // If callerModule is not provided, always run (for testing)
    if (callerModule && require.main !== callerModule) {
        return;
    }

    const run = createActionRunner({ ...runnerOptions, title });

    (async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: `${title} failed`
            });
        }
    })();
}

/**
 * Creates an async main function that can be exported and called.
 *
 * Unlike runAction which executes immediately, this returns a function
 * that can be called later or exported for testing.
 *
 * @param options - Runner configuration
 * @returns An async function that runs the action with error handling
 *
 * @example
 * ```typescript
 * export const main = createActionMain({
 *     inputsSchema,
 *     title: 'Setup GCC',
 *     main: async (inputs) => setupGCC(inputs)
 * });
 *
 * // In tests or when called programmatically:
 * await main();
 * ```
 */
export function createActionMain<
    S extends ActionInputsSchema,
    I extends InferInputs<S> & TraceableInputs,
    O extends object
>(
    options: Omit<RunActionOptions<S, I, O>, 'callerModule'>
): () => Promise<void> {
    const run = createActionRunner(options);

    return async () => {
        try {
            await run();
        } catch (error) {
            await reportAndSetFailed(error as Error, {
                title: `${options.title} failed`
            });
        }
    };
}
