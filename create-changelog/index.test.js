const main = require('./index')

beforeEach(() => {
    main.featureSubjectIcon.count = 0
})

test('generateOutput avoids duplicating scope for multiline entries', () => {
    const commitA = new main.Commit()
    commitA.type = 'docs'
    commitA.scope = 'setup-cmake'
    commitA.description = 'Clarify behavior of check-latest.'
    commitA.hash = '0dae13a0000000000000000000000000000000000'

    const commitB = new main.Commit()
    commitB.type = 'docs'
    commitB.scope = 'setup-cmake'
    commitB.description = 'Enhance cmake path descriptions.'
    commitB.hash = '6370bd9000000000000000000000000000000000'

    const changes = {
        docs: {
            'setup-cmake': [commitA, commitB]
        }
    }
    const changeTypePriority = ['docs']
    const args = {link_commits: false, thank_non_regular: false}
    const authors = {}

    const output = main.generateOutput(changes, changeTypePriority, args, null, authors, null)

    expect(output).toContain('- setup-cmake:\n    - Clarify behavior of check-latest. 0dae13a')
    expect(output).toContain('    - Enhance cmake path descriptions. 6370bd9')
    expect(output).not.toContain('setup-cmake: Clarify behavior of check-latest.')
    expect(output).not.toContain('setup-cmake: Enhance cmake path descriptions.')
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

            runPromise = reportAndSetFailed(new Error('changelog boom'), {title: 'Create changelog failed', includeStackInSetFailed: true}).then(() => {
                expect(corePretty.error).toHaveBeenCalledTimes(1)
                const failedArg = corePretty.setFailed.mock.calls[0][0]
                expect(failedArg).toContain('changelog boom')
            })
        })

        await runPromise
    })
})
