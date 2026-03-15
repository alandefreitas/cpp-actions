const path = require('path');

// Root directory for absolute path resolution
const rootDir = __dirname;

// Common module mapper for action packages (use absolute paths)
const commonModuleMapper = {
    '^action-schema$': path.join(rootDir, 'common/action-schema/src/index.ts'),
    '^trace-commands$': path.join(rootDir, 'common/trace-commands/src/index.ts'),
    '^gh-inputs$': path.join(rootDir, 'common/gh-inputs/src/index.ts'),
    '^pretty-errors$': path.join(rootDir, 'common/pretty-errors/src/index.ts'),
    '^pretty-errors/test-helper$': path.join(rootDir, 'common/pretty-errors/src/test-helper.ts')
};

// Transform config for TypeScript source files
const tsTransform = {
    '^.+\\.tsx?$': ['ts-jest', {
        tsconfig: path.join(rootDir, 'tsconfig.test.json')
    }]
};

// Transform config for ESM-only JS packages (e.g. @actions/* v3+)
const esmJsTransform = {
    '^.+\\.m?js$': ['ts-jest', {
        tsconfig: {
            allowJs: true,
            esModuleInterop: true,
            resolveJsonModule: true,
            target: 'ES2021',
            module: 'CommonJS'
        }
    }]
};

// Base configuration shared across all projects
const baseConfig = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.test.ts'
    ],
    // Custom resolver to handle ESM-only @actions/* v3+ package exports
    resolver: path.join(rootDir, 'jest-resolver.js'),
    // Allow transforming ESM-only node_modules (many deps are now ESM-only)
    transformIgnorePatterns: []
};

// Action packages (need moduleNameMapper)
const actionPackages = [
    'b2-workflow',
    'boost-clone',
    'cmake-workflow',
    'cpp-matrix',
    'create-changelog',
    'flamegraph',
    'package-install',
    'setup-clang',
    'setup-cmake',
    'setup-cpp',
    'setup-gcc',
    'setup-msvc',
    'setup-program'
];

// Common packages (no moduleNameMapper needed)
const commonPackages = [
    'common/action-schema',
    'common/gh-inputs',
    'common/pretty-errors',
    'common/trace-commands'
];

// Utils packages (no moduleNameMapper needed)
const utilsPackages = [
    'utils/update-data',
    'utils/docs',
    'utils/esbuild',
    'utils/jsdoc-linter',
    'utils/release'
];

// Resolve all workspace packages to TypeScript source to avoid ts-jest
// trying to compile lib/*.js without allowJs
const workspaceModuleMapper = Object.fromEntries(
    actionPackages.map(pkg => [`^${pkg}$`, path.join(rootDir, pkg, 'src/index.ts')])
);

// Generate project configs for actions
const actionProjects = actionPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg,
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: { ...tsTransform, ...esmJsTransform },
    moduleNameMapper: { ...commonModuleMapper, ...workspaceModuleMapper }
}));

// Generate project configs for common modules
const commonProjects = commonPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg.split('/')[1],
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: { ...tsTransform, ...esmJsTransform }
}));

// Transform config that strips shebangs before passing to ts-jest.
// Needed for utils/jsdoc-linter which has #!/usr/bin/env node in index.ts.
const shebangTsTransform = {
    '^.+\\.tsx?$': [path.join(rootDir, 'jest-shebang-transformer.js'), {
        tsconfig: path.join(rootDir, 'tsconfig.test.json')
    }]
};

// Generate project configs for utils modules
// Use shebangTsTransform for all utils packages since several have #!/usr/bin/env node shebangs
const utilsProjects = utilsPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg.split('/')[1],
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: { ...shebangTsTransform, ...esmJsTransform }
}));

// Per-project coverage thresholds based on current baselines.
// Each threshold is set to floor(actual) - 1 to provide ~1% safety margin
// against run-to-run variance. 100% thresholds are kept exact.
// To update thresholds after improving coverage:
//   1. Run: npm run test:coverage
//   2. Look at the per-directory summary lines in the output
//   3. Update the values below to floor(actual) - 1, or 100 if actually 100%
const coverageThreshold = {
    './b2-workflow/src/':            { statements: 97, branches: 93, functions: 87, lines: 97 },
    './boost-clone/src/':            { statements: 92, branches: 87, functions: 86, lines: 92 },
    './cmake-workflow/src/':         { statements: 94, branches: 86, functions: 73, lines: 94 },
    './common/action-schema/src/':   { statements: 97, branches: 93, functions: 100, lines: 97 },
    './common/gh-inputs/src/':       { statements: 98, branches: 96, functions: 100, lines: 98 },
    './common/pretty-errors/src/':   { statements: 97, branches: 89, functions: 64, lines: 97 },
    './common/trace-commands/src/':  { statements: 100, branches: 100, functions: 100, lines: 100 },
    './cpp-matrix/src/':             { statements: 95, branches: 93, functions: 85, lines: 95 },
    './create-changelog/src/':       { statements: 100, branches: 92, functions: 100, lines: 100 },
    './flamegraph/src/':             { statements: 93, branches: 86, functions: 89, lines: 93 },
    './package-install/src/':        { statements: 95, branches: 87, functions: 76, lines: 94 },
    './setup-clang/src/':            { statements: 92, branches: 86, functions: 80, lines: 92 },
    './setup-cmake/src/':            { statements: 96, branches: 93, functions: 81, lines: 96 },
    './setup-cpp/src/':              { statements: 97, branches: 95, functions: 79, lines: 97 },
    './setup-gcc/src/':              { statements: 96, branches: 92, functions: 70, lines: 96 },
    './setup-msvc/src/':             { statements: 96, branches: 94, functions: 83, lines: 96 },
    './setup-program/src/':          { statements: 86, branches: 67, functions: 96, lines: 86 },
    './utils/docs/src/':             { statements: 100, branches: 100, functions: 100, lines: 100 },
    './utils/esbuild/src/':          { statements: 100, branches: 100, functions: 100, lines: 100 },
    './utils/jsdoc-linter/src/':     { statements: 98, branches: 98, functions: 100, lines: 100 },
    './utils/release/src/':          { statements: 100, branches: 100, functions: 100, lines: 100 },
    './utils/update-data/src/':      { statements: 85, branches: 82, functions: 84, lines: 89 }
};

module.exports = {
    projects: [...actionProjects, ...commonProjects, ...utilsProjects],
    coverageDirectory: path.join(rootDir, 'coverage'),
    coverageThreshold,
    verbose: true
};
