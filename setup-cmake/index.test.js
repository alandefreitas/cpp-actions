jest.mock('@actions/core', () => ({
    info: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    error: jest.fn()
}))

jest.mock('@actions/io', () => ({
    which: jest.fn()
}))

jest.mock('@actions/exec', () => ({
    exec: jest.fn().mockResolvedValue(0)
}))

const core = require('@actions/core')
const io = require('@actions/io')
const exec = require('@actions/exec')
const fs = require('fs')
const setup_program = require('setup-program')

const {ensureGit} = require('./index')

function mockOsRelease(content) {
    jest.spyOn(fs, 'readFileSync').mockReturnValue(content)
}

describe('ensureGit', () => {
    const runnerOS = process.env.RUNNER_OS

    beforeEach(() => {
        jest.clearAllMocks()
        process.env.RUNNER_OS = 'Linux'
    })

    afterEach(() => {
        jest.restoreAllMocks()
        process.env.RUNNER_OS = runnerOS
    })

    test('returns existing git path without installing', async () => {
        io.which.mockResolvedValue('/usr/bin/git')

        const gitPath = await ensureGit({subgroups: false})

        expect(gitPath).toBe('/usr/bin/git')
        expect(exec.exec).not.toHaveBeenCalled()
    })

    test('installs git on Debian-like runners when missing', async () => {
        io.which.mockResolvedValueOnce(null).mockResolvedValueOnce('/usr/bin/git')
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false)
        mockOsRelease('ID=ubuntu\nID_LIKE=debian\n')

        const gitPath = await ensureGit({subgroups: false})

        expect(gitPath).toBe('/usr/bin/git')
        expect(exec.exec).toHaveBeenCalledTimes(2)
        expect(exec.exec).toHaveBeenNthCalledWith(1, 'apt-get', ['update'], expect.objectContaining({ignoreReturnCode: true}))
        expect(exec.exec).toHaveBeenNthCalledWith(2, 'apt-get', ['install', '-y', 'git'], expect.objectContaining({ignoreReturnCode: true}))
    })

    test('skips install on non-debian linux', async () => {
        io.which.mockResolvedValue(null)
        jest.spyOn(setup_program, 'isSudoRequired').mockReturnValue(false)
        mockOsRelease('ID=alpine\n')

        const gitPath = await ensureGit({subgroups: false})

        expect(gitPath).toBeNull()
        expect(core.info).toHaveBeenCalledWith('git is missing but runner is not Debian/Ubuntu; skipping automatic installation.')
        expect(exec.exec).not.toHaveBeenCalled()
    })
})

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise
        jest.isolateModules(() => {
            jest.doMock('../common/pretty-errors/node_modules/@actions/core', () => ({
                error: jest.fn(),
                setFailed: jest.fn()
            }))
            const corePretty = require('../common/pretty-errors/node_modules/@actions/core')
            const {reportAndSetFailed} = require('../common/pretty-errors')

            runPromise = reportAndSetFailed(new Error('cmake boom'), {title: 'Setup CMake failed', includeStackInSetFailed: true}).then(() => {
                expect(corePretty.error).toHaveBeenCalledTimes(1)
                const failedArg = corePretty.setFailed.mock.calls[0][0]
                expect(failedArg).toContain('cmake boom')
            })
        })

        await runPromise
    })
})
