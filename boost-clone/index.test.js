// Mirror the production modules but replace side effects with controllable spies.
// Each mock maps to our runtime dependencies so we can assert call patterns
// without launching external processes.
jest.mock('@actions/core', () => ({
    info: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn()
}))

jest.mock('@actions/cache', () => ({
    restoreCache: jest.fn(),
    saveCache: jest.fn(),
    isFeatureAvailable: jest.fn()
}))

jest.mock('@actions/tool-cache', () => ({
    downloadTool: jest.fn()
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

const fs = require('fs')
const os = require('os')
const path = require('path')
const {generateCacheKey, main} = require('./index')
const exec = require('@actions/exec')
const cache = require('@actions/cache')
const tc = require('@actions/tool-cache')
const core = require('@actions/core')
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

    const {cacheKey: cacheKeyA} = await generateCacheKey(baseInputs, allModules, gitFeatures, {withFragments: true})
    const {cacheKey: cacheKeyB} = await generateCacheKey({
        ...baseInputs,
        modules_exclude_paths: new Set(['examples'])
    }, allModules, gitFeatures, {withFragments: true})

    // Distinct exclude lists should alter the configuration hash and produce unique keys.
    expect(cacheKeyA).not.toEqual(cacheKeyB)
})

test('main short-circuits on cache hit before downloads and saves', async () => {
    cache.isFeatureAvailable.mockReturnValue(true)
    cache.restoreCache.mockResolvedValue('cache-hit')
    const boostHashOutput = {exitCode: 0, stdout: 'boosthash\trefs/heads/master\n'}
    const versionOutput = {exitCode: 0, stdout: 'git version 2.30.0'}
    exec.getExecOutput.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
            return Promise.resolve(versionOutput)
        }
        return Promise.resolve(boostHashOutput)
    })
    exec.exec.mockResolvedValue(0)
    setup_program.findGit.mockResolvedValue('/usr/bin/git')
    setup_program.cloneGitRepo.mockResolvedValue()

    const inputs = {
        boost_dir: path.join(os.tmpdir(), 'boost-cache-hit'),
        branch: 'master',
        modules: new Set(),
        patches: new Set(),
        scan_modules_ignore: new Set(),
        scan_modules_dir: new Set(),
        modules_scan_paths: new Set(),
        modules_exclude_paths: new Set(),
        cache: true,
        optimistic_caching: false,
        trace_commands: false
    }

    await main(inputs)

    expect(cache.restoreCache).toHaveBeenCalled()
    expect(tc.downloadTool).not.toHaveBeenCalled()
    expect(setup_program.cloneGitRepo).not.toHaveBeenCalled()
    expect(cache.saveCache).not.toHaveBeenCalled()
})

test('main saves cache on miss and logs key fragments', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boost-cache-miss-'))
    const gitmodulesPath = path.join(tmpDir, '.gitmodules')
    const exceptionsPath = path.join(tmpDir, 'exceptions.txt')
    fs.writeFileSync(gitmodulesPath, '[submodule "libs/config"]\n\tpath = libs/config\n\turl = https://github.com/boostorg/config.git\n')
    fs.writeFileSync(exceptionsPath, 'throw_exception.hpp: exception\n')

    cache.isFeatureAvailable.mockReturnValue(true)
    cache.restoreCache.mockResolvedValue(undefined)
    cache.saveCache.mockResolvedValue('saved')

    const versionOutput = {exitCode: 0, stdout: 'git version 2.30.0'}
    const boostHashOutput = {exitCode: 0, stdout: 'boosthash\trefs/heads/master\n'}
    exec.getExecOutput.mockImplementation((_cmd, args) => {
        if (args[0] === '--version') {
            return Promise.resolve(versionOutput)
        }
        return Promise.resolve(boostHashOutput)
    })
    exec.exec.mockResolvedValue(0)
    setup_program.findGit.mockResolvedValue('/usr/bin/git')
    setup_program.cloneGitRepo.mockResolvedValue()

    tc.downloadTool
        .mockResolvedValueOnce(gitmodulesPath)
        .mockResolvedValueOnce(exceptionsPath)

    const inputs = {
        boost_dir: path.join(tmpDir, 'boost-src'),
        branch: 'master',
        modules: new Set(['config']),
        patches: new Set(),
        scan_modules_ignore: new Set(),
        scan_modules_dir: new Set(),
        modules_scan_paths: new Set(),
        modules_exclude_paths: new Set(),
        cache: true,
        optimistic_caching: true,
        trace_commands: false
    }

    await main(inputs)

    expect(cache.restoreCache).toHaveBeenCalled()
    expect(tc.downloadTool).toHaveBeenCalledTimes(2)
    expect(cache.saveCache).toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Cache key fragments'))
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Saving cache for key'))
})
