const path = require('path');

// Root directory for absolute path resolution
const rootDir = __dirname;

// Common module mapper for action packages (use absolute paths)
const commonModuleMapper = {
    '^trace-commands$': path.join(rootDir, 'common/trace-commands/src/index.ts'),
    '^gh-inputs$': path.join(rootDir, 'common/gh-inputs/src/index.ts'),
    '^pretty-errors$': path.join(rootDir, 'common/pretty-errors/src/index.ts')
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
    verbose: true
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
    'common/gh-inputs',
    'common/pretty-errors',
    'common/trace-commands'
];

// Generate project configs for actions
const actionProjects = actionPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg,
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: path.join(rootDir, 'tsconfig.test.json')
        }]
    },
    moduleNameMapper: commonModuleMapper
}));

// Generate project configs for common modules
const commonProjects = commonPackages.map(pkg => ({
    ...baseConfig,
    displayName: pkg.split('/')[1],
    rootDir: path.join(rootDir, pkg),
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: path.join(rootDir, 'tsconfig.test.json')
        }]
    }
}));

module.exports = {
    projects: [...actionProjects, ...commonProjects],
    coverageDirectory: path.join(rootDir, 'coverage')
};
