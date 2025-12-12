const main = require('./index')
const fs = require('fs')
const semver = require('semver')

test('split compiler', async () => {

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

            runPromise = reportAndSetFailed(new Error('clang boom'), {title: 'Setup Clang failed'}).then(() => {
                expect(core.error).toHaveBeenCalledTimes(1)
                expect(core.setFailed).toHaveBeenCalledWith('clang boom')
            })
        })

        await runPromise
    })
})
