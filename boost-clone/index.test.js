// Mirror the production modules but replace side effects with controllable spies.
// Each mock maps to our runtime dependencies so we can assert call patterns
// without launching external processes.
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}))

// Replace child-process execution helpers with spies; tests stub their results
// to simulate git output deterministically.
jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn(),
    exec: jest.fn()
}))

// Substitute setup-program helpers so git discovery and URL checks never reach
// the network during unit tests.
jest.mock('setup-program', () => ({
    urlExists: jest.fn(),
    findGit: jest.fn(),
    cloneGitRepo: jest.fn()
}))

const {generateCacheKey} = require('./index')
const exec = require('@actions/exec')
const setup_program = require('setup-program')

beforeEach(() => {
    // Reset spies between tests to prevent cross-test contamination.
    jest.clearAllMocks()
})

test('generateCacheKey reflects modules-exclude-paths', async () => {
    // Pretend every module repo exists so the module hash branch executes.
    setup_program.urlExists.mockResolvedValue(true)

    // Emulate `git ls-remote` returning stable hashes for the super-project and module repo.
    exec.getExecOutput.mockImplementation((_cmd, args) => {
        const repo = args[1]
        if (repo === 'https://github.com/boostorg/boost.git') {
            return Promise.resolve({exitCode: 0, stdout: 'boosthash\trefs/heads/master\n'})
        }
        if (repo === 'https://github.com/boostorg/filesystem.git') {
            return Promise.resolve({exitCode: 0, stdout: 'modulehash\trefs/heads/master\n'})
        }
        return Promise.resolve({exitCode: 0, stdout: 'fallbackhash\trefs/heads/master\n'})
    })

    const gitFeatures = {gitPath: '/usr/bin/git'}
    const baseInputs = {
        // Mirrors action inputs but uses Sets to match production parsing.
        branch: 'master',
        patches: new Set(),
        modules: new Set(['filesystem']),
        scan_modules_dir: new Set(),
        modules_scan_paths: new Set(),
        modules_exclude_paths: new Set(['test']),
        scan_modules_ignore: new Set(),
        optimistic_caching: true
    }
    const allModules = new Set(['filesystem'])

    const cacheKeyA = await generateCacheKey(baseInputs, allModules, gitFeatures)
    const cacheKeyB = await generateCacheKey({
        ...baseInputs,
        modules_exclude_paths: new Set(['examples'])
    }, allModules, gitFeatures)

    // Distinct exclude lists should alter the configuration hash and produce unique keys.
    expect(cacheKeyA).not.toEqual(cacheKeyB)
})
