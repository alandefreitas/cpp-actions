const setupCpp = require('./index')
const msvc = require('setup-msvc')

test('normalize compiler', async () => {
  const compiler = await setupCpp.normalizeCompiler('gcc-4.9.2', '*')
  expect(compiler.compiler).toEqual('gcc')
  expect(compiler.version).toEqual('4.9.2')
})

test('build MSVC outputs uses Visual Studio metadata when available', () => {
  const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe'
  const env = {
    VCINSTALLDIR: 'C\\VS\\VC\\',
    VisualStudioVersion: '17.11.35205.1',
    VCToolsVersion: '14.40.33807'
  }

  const outputs = msvc.buildMSVCOutputs(compilerPath, env, {compilerVersion: '19.44.35219'})

  expect(outputs.cc).toEqual(compilerPath)
  expect(outputs.cxx).toEqual(compilerPath)
  expect(outputs.bindir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64')
  expect(outputs.dir).toEqual('C\\VS\\VC\\')
  expect(outputs.release).toEqual('14.40.33807')
  expect(outputs.version_major).toEqual(14)
  expect(outputs.version_minor).toEqual(40)
  expect(outputs.version_patch).toEqual(33807)
  expect(outputs.msvc_toolset_version).toEqual('14.40.33807')
  expect(outputs.msvc_product_version).toEqual('17.11.35205.1')
  expect(outputs.msvc_release_year).toEqual('2022')
  expect(outputs.msvc_compiler_version).toEqual('19.44.35219')
})

test('build MSVC outputs falls back when metadata is missing', () => {
  const compilerPath = 'C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe'
  const outputs = msvc.buildMSVCOutputs(compilerPath, {})

  expect(outputs.dir).toEqual('C\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64')
  expect(outputs.release).toEqual('14.40.33807')
  expect(outputs.version_major).toEqual(14)
})
