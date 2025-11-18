const msvc = require('./index')

test('release year maps to product version', () => {
  expect(msvc.releaseYearToProductVersion('2022')).toEqual('17.0')
})

test('product version maps to release year', () => {
  expect(msvc.productVersionToReleaseYear('17.0')).toEqual('2022')
})
