# action-schema

Schema-driven input definitions for GitHub Actions. Define inputs once, derive types, parsing, and `action.yml` from it.

## Adding a schema to an action

Each action that uses `action-schema` has three files:

| File | Purpose |
|------|---------|
| `src/schema.ts` | Single source of truth for inputs and outputs |
| `src/types.ts` | `export type Inputs = InferInputs<typeof inputsSchema>` plus action-specific types |
| `src/index.ts` | Calls `runAction({ inputsSchema, main: ... })` instead of manual extraction |

The `action.yml` inputs/outputs sections are regenerated from the schema at build time.

### 1. Define the schema

```typescript
// setup-gcc/src/schema.ts
import { createSetupInputs, type ActionInputsSchema, type ActionOutputsSchema } from 'action-schema';

export const inputsSchema = {
    ...createSetupInputs('GCC'),
    version: {
        type: 'string' as const,
        default: '*',
        description: 'GCC version range or exact version.',
        transform: (v) => v.replace(/^g(cc|\+\+)-?/i, '')
    }
} satisfies ActionInputsSchema;

export const outputsSchema = {
    cc:  { description: 'Path to gcc.' },
    cxx: { description: 'Path to g++.' }
} satisfies ActionOutputsSchema;
```

### 2. Derive types from it

```typescript
// setup-gcc/src/types.ts
import type { InferInputs } from 'action-schema';
import type { inputsSchema } from './schema';

export type Inputs = InferInputs<typeof inputsSchema>;
// Inputs.version is string, Inputs.check_latest is boolean, etc.
```

### 3. Use `runAction` as entry point

```typescript
// setup-gcc/src/index.ts
import { runAction } from 'action-schema';
import { inputsSchema, outputsSchema } from './schema';

runAction({
    inputsSchema,
    outputsSchema,
    title: 'Setup GCC',
    main: async (inputs) => {
        // inputs is fully typed from the schema
        const result = await setupGCC(inputs.version, inputs.path);
        return { cc: result.cc, cxx: result.cxx };
    },
    callerModule: module
});
```

`runAction` handles input extraction, trace-commands setup, input/output logging, and error reporting.

## Input types

| Type | TypeScript | Example |
|------|-----------|---------|
| `'string'` | `string` | `version: { type: 'string', default: '*', ... }` |
| `'boolean'` | `boolean` | `check_latest: { type: 'boolean', default: false, ... }` |
| `'number'` | `number` | `jobs: { type: 'number', default: 4, ... }` |
| `'string[]'` | `string[]` | `path: { type: 'string[]', splitter: /[:;]/, ... }` |
| `'path'` | `string` | `source_dir: { type: 'path', default: '.', ... }` |
| `'multiline'` | `string[]` | `patches: { type: 'multiline', default: [], ... }` |
| `'tribool'` | `boolean \| undefined` | `shared: { type: 'tribool', ... }` |
| `'map'` | `Record<string, string>` | `env: { type: 'map', ... }` |

Schema keys use `snake_case` (TypeScript convention). They're automatically converted to `kebab-case` for `action.yml` and input extraction (`check_latest` becomes `check-latest`).

## Shared schema fragments

| Fragment | Fields | Used by |
|----------|--------|---------|
| `baseInputs` | `trace_commands` | All actions |
| `setupInputs` | `version`, `path`, `check_latest`, `update_environment`, `trace_commands` | setup-* actions |
| `compilerEnvInputs` | `cc`, `cxx`, `ccflags`, `cxxflags` (with env fallbacks) | cmake-workflow, b2-workflow, package-install |
| `compilerOutputs` | `cc`, `cxx`, `dir`, `version`, `version_major/minor/patch` | setup-gcc, setup-clang, setup-msvc |
| `toolOutputs` | `path`, `dir`, `version` | setup-cmake, setup-program |

Use `createSetupInputs('GCC')` or `createCompilerOutputs('GCC', 'gcc', 'g++')` for tool-specific descriptions.

## Source files

Ordered from building blocks to higher-level components:

1. **`types.ts`** - Core type definitions (`InputSchema`, `InferInputs`, `RunnerOptions`)
2. **`shared-schemas.ts`** - Reusable schema fragments (`setupInputs`, `compilerOutputs`, etc.)
3. **`parser.ts`** - `parseInputs(schema)` extracts all inputs at runtime
4. **`generators/action-yml.ts`** - `updateActionYml()` regenerates `action.yml` from schemas
5. **`runner.ts`** - `runAction()` standardized entry point with error handling
6. **`index.ts`** - Public API barrel file
