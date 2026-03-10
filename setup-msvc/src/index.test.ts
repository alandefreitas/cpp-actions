import { releaseYearToProductVersion, productVersionToReleaseYear, main } from './index'
import { describePrettyErrors } from 'pretty-errors/test-helper'

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

describePrettyErrors('msvc boom', 'Setup MSVC failed')
