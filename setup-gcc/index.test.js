const main = require('./index')
const fs = require('fs')
const semver = require('semver')

test('setup-gcc', async () => {})

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

            runPromise = reportAndSetFailed(new Error('gcc boom'), {title: 'Setup GCC failed'}).then(() => {
                expect(core.error).toHaveBeenCalledTimes(1)
                expect(core.setFailed).toHaveBeenCalledWith('gcc boom')
            })
        })

        await runPromise
    })
})
