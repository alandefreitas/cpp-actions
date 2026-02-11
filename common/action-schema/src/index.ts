/**
 * Schema-driven action definition and input parsing for GitHub Actions.
 *
 * Define inputs once in a schema, then derive TypeScript types, runtime parsing,
 * and action.yml generation from it.
 *
 * @example
 * ```typescript
 * import { runAction, setupInputs, type InferInputs } from 'action-schema';
 *
 * const inputsSchema = { ...setupInputs } satisfies ActionInputsSchema;
 * type Inputs = InferInputs<typeof inputsSchema>;
 *
 * runAction({
 *     inputsSchema,
 *     title: 'My Action',
 *     main: async (inputs: Inputs) => ({ result: 'ok' }),
 *     callerModule: module
 * });
 * ```
 *
 * @module action-schema
 */

export * from './types';
export * from './parser';
export * from './runner';
export * from './shared-schemas';
export * from './generators/action-yml';
