import { releaseYearToProductVersion, productVersionToReleaseYear, main } from './index'

test('release year maps to product version', () => {
    expect(releaseYearToProductVersion('2022')).toEqual('17.0')
})

test('product version maps to release year', () => {
    expect(productVersionToReleaseYear('17.0')).toEqual('2022')
})

test('setup-msvc', async () => {
    // Main function is exported
    expect(main).toBeDefined()
})

describe('pretty errors', () => {
    it('logs once and fails once', async () => {
        let runPromise: Promise<void>
        jest.isolateModules(() => {
            jest.doMock('pretty-errors', () => {
                const mockCore = {
                    error: jest.fn(),
                    setFailed: jest.fn()
                }
                return {
                    reportAndSetFailed: async (error: Error) => {
                        mockCore.error(error.message)
                        mockCore.setFailed(error.message)
                    },
                    __mockCore: mockCore
                }
            })
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const prettyErrors = require('pretty-errors')

            runPromise = prettyErrors.reportAndSetFailed(new Error('msvc boom'), { title: 'Setup MSVC failed' }).then(() => {
                expect(prettyErrors.__mockCore.error).toHaveBeenCalledTimes(1)
                expect(prettyErrors.__mockCore.setFailed).toHaveBeenCalledWith('msvc boom')
            })
        })

        await runPromise!
    })
})
