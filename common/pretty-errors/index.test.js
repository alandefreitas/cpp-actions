const core = require('@actions/core')
jest.mock('@actions/core', () => ({
    error: jest.fn(),
    setFailed: jest.fn()
}))

const {reportAndSetFailed} = require('./index')

describe('pretty-errors helper', () => {
    it('logs a Youch-rendered stack and marks the action as failed', async () => {
        const err = new Error('boom')

        await reportAndSetFailed(err, {
            title: 'Test Failure',
            hint: 'hint',
            locals: {foo: 'bar'}
        })

        expect(core.error).toHaveBeenCalledTimes(1)
        const payload = core.error.mock.calls[0][0]
        expect(payload).toContain('Test Failure')
        expect(payload).toContain('boom')
        expect(payload).toContain('Locals')
        expect(core.setFailed).toHaveBeenCalledWith('boom')
    })

    it('omits the hint when provided null', async () => {
        core.error.mockClear()
        core.setFailed.mockClear()

        await reportAndSetFailed(new Error('no hint'), {
            title: 'No Hint',
            hint: null
        })

        const payload = core.error.mock.calls[0][0]
        expect(payload).toContain('No Hint: no hint')
        expect(payload).not.toContain('Tip: enable trace-commands')
        expect(core.setFailed).toHaveBeenCalledWith('no hint')
    })
})
