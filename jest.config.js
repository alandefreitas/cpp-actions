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

// Per-project coverage thresholds using max-uncovered-count (negative numbers).
// A value of -5 means "fail if more than 5 statements/branches/functions/lines are uncovered."
// This is more stable than percentages: adding tested code doesn't affect thresholds,
// and only genuinely uncovered new code triggers failures.
// To update after improving coverage:
//   1. Run: npm run test:coverage
//   2. Count the uncovered lines/branches per directory in the report
//   3. Set each value to -(current_uncovered + 2) for a small buffer
const coverageThreshold = {
    './b2-workflow/src/':            { statements: -5, branches: -8, functions: -5, lines: -5 },
    './boost-clone/src/':            { statements: -55, branches: -24, functions: -15, lines: -53 },
    './cmake-workflow/src/':         { statements: -52, branches: -68, functions: -21, lines: -52 },
    './common/action-schema/src/':   { statements: -5, branches: -5, functions: 0, lines: -5 },
    './common/gh-inputs/src/':       { statements: -4, branches: -5, functions: 0, lines: -4 },
    './common/pretty-errors/src/':   { statements: -6, branches: -14, functions: -16, lines: -6 },
    './common/trace-commands/src/':  { statements: 0, branches: 0, functions: 0, lines: 0 },
    './cpp-matrix/src/':             { statements: -60, branches: -50, functions: -33, lines: -55 },
    './create-changelog/src/':       { statements: 0, branches: -8, functions: 0, lines: 0 },
    './flamegraph/src/':             { statements: -52, branches: -39, functions: -12, lines: -51 },
    './package-install/src/':        { statements: -15, branches: -14, functions: -8, lines: -15 },
    './setup-clang/src/':            { statements: -28, branches: -15, functions: -8, lines: -28 },
    './setup-cmake/src/':            { statements: -10, branches: -10, functions: -6, lines: -10 },
    './setup-cpp/src/':              { statements: -6, branches: -5, functions: -5, lines: -6 },
    './setup-gcc/src/':              { statements: -11, branches: -8, functions: -8, lines: -10 },
    './setup-msvc/src/':             { statements: -8, branches: -6, functions: -8, lines: -8 },
    './setup-program/src/':          { statements: -67, branches: -64, functions: -3, lines: -67 },
    './utils/docs/src/':             { statements: 0, branches: 0, functions: 0, lines: 0 },
    './utils/esbuild/src/':          { statements: 0, branches: 0, functions: 0, lines: 0 },
    './utils/jsdoc-linter/src/':     { statements: -3, branches: -3, functions: 0, lines: 0 },
    './utils/release/src/':          { statements: 0, branches: 0, functions: 0, lines: 0 },
    './utils/update-data/src/':      { statements: -5, branches: -3, functions: -3, lines: -4 }
};

module.exports = {
    projects: [...actionProjects, ...commonProjects, ...utilsProjects],
    coverageDirectory: path.join(rootDir, 'coverage'),
    coverageThreshold,
    verbose: true
};
