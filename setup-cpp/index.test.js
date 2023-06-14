const main = require('./index')
const fs = require('fs')
const semver = require('semver')

test('normalize compiler', async () => {
  const compiler = await main.normalizeCompiler('gcc-4.9.2', '*')
  expect(compiler.compiler).toEqual('gcc')
  expect(compiler.version).toEqual('4.9.2')
})

