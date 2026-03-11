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

// Generate project configs for utils modules
const utilsProjects = utilsPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg.split('/')[1],
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: { ...tsTransform, ...esmJsTransform }
}));

module.exports = {
    projects: [...actionProjects, ...commonProjects, ...utilsProjects],
    coverageDirectory: path.join(rootDir, 'coverage'),
    verbose: true
};
