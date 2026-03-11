import tseslint from 'typescript-eslint';

export default tseslint.config(
    // Global ignores
    {
        ignores: [
            '**/dist/**',
            '**/lib/**',
            '**/node_modules/**',
            'utils/esbuild/**',
            'docs/**',
            'coverage/**',
            '*.js',
        ],
    },

    // Base config for all TypeScript files
    ...tseslint.configs.recommended,

    // TypeScript-specific rules
    {
        files: ['**/*.ts'],
        rules: {
            // Moderate strictness: catch real issues, avoid busywork
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'error',
            '@typescript-eslint/consistent-type-imports': ['error', {
                prefer: 'type-imports',
                fixStyle: 'inline-type-imports',
            }],

            // Allow short-circuit expressions (condition && doSomething())
            '@typescript-eslint/no-unused-expressions': ['error', {
                allowShortCircuit: true,
                allowTernary: true,
            }],

            // Code quality
            'no-constant-condition': 'error',
            'no-duplicate-case': 'error',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'error',

            // Naming conventions
            '@typescript-eslint/naming-convention': ['error',
                {
                    selector: 'default',
                    format: ['camelCase', 'PascalCase'],
                    leadingUnderscore: 'allow',
                },
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
                    leadingUnderscore: 'allow',
                },
                {
                    selector: 'parameter',
                    format: ['camelCase', 'PascalCase', 'snake_case'],
                    leadingUnderscore: 'allow',
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase'],
                },
                {
                    selector: 'enumMember',
                    format: ['PascalCase', 'UPPER_CASE'],
                },
                {
                    selector: 'import',
                    format: null,
                },
                // Allow snake_case for object properties (external API boundaries)
                {
                    selector: 'objectLiteralProperty',
                    format: null,
                },
                {
                    selector: 'typeProperty',
                    format: null,
                },
                // Allow kebab-case and other formats for class/object members
                // accessed via bracket notation or matching external APIs
                {
                    selector: 'classProperty',
                    format: ['camelCase', 'PascalCase'],
                    leadingUnderscore: 'allow',
                },
                {
                    selector: 'method',
                    format: ['camelCase'],
                    leadingUnderscore: 'allow',
                },
            ],
        },
    },

    // Action entry points: no console.log (use core.info/debug instead)
    {
        files: [
            '*/src/index.ts',
            'common/*/src/index.ts',
        ],
        rules: {
            'no-console': 'error',
        },
    },

    // Test files: relaxed rules
    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/naming-convention': 'off',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
);
