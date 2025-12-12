const msvc = require('./index')

test('release year maps to product version', () => {
  expect(msvc.releaseYearToProductVersion('2022')).toEqual('17.0')
})

test('product version maps to release year', () => {
  expect(msvc.productVersionToReleaseYear('17.0')).toEqual('2022')
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

      runPromise = reportAndSetFailed(new Error('msvc boom'), {title: 'Setup MSVC failed'}).then(() => {
        expect(core.error).toHaveBeenCalledTimes(1)
        expect(core.setFailed).toHaveBeenCalledWith('msvc boom')
      })
    })

    await runPromise
  })
})
