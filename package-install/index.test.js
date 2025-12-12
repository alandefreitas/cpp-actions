const {semverGteLoose} = require('./index')

describe('semverGteLoose', () => {
    test('handles four-part versions without throwing', () => {
        expect(semverGteLoose('0.96.24.20', '0.96.24.20')).toBe(true)
        expect(semverGteLoose('0.96.24.21', '0.96.24.20')).toBe(true)
        expect(semverGteLoose('0.96.24.19', '0.96.24.20')).toBe(false)
    })

    test('coerces distro-suffixed versions without throwing', () => {
        expect(() => semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).not.toThrow()
        expect(semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).toBe(false)
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
            const core = require('../common/pretty-errors/node_modules/@actions/core')
            const {reportAndSetFailed} = require('../common/pretty-errors')

            runPromise = reportAndSetFailed(new Error('pkg boom'), {title: 'Package install failed', includeStackInSetFailed: true}).then(() => {
                expect(core.error).toHaveBeenCalledTimes(1)
                const failedArg = core.setFailed.mock.calls[0][0]
                expect(failedArg).toContain('pkg boom')
            })
        })

        await runPromise
    })
})
