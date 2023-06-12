const main = require('./index')
const fs = require('fs')
const semver = require('semver')

test('find_program_in_path', async () => {
  const {find_program_in_path} = main
  for (const name of ['node', 'gcc']) {
    const paths = ['/usr/bin', '/usr/local/bin']
    const version = '>=1'
    // check if /usr/local/bin/node exists
    if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
      const paths = [`/usr/local/bin/${name}`, `/usr/bin/${name}`]
      const __ret = await find_program_in_path(paths, version, true)
      // __ret.output_version satisfies version
      expect(semver.satisfies(__ret.output_version, version)).toBe(true)
      expect(__ret.output_path == `/usr/local/bin/${name}` || __ret.output_path == `/usr/bin/${name}`).toBe(true)
    }
  }
})

test('find_program_in_system_paths', async () => {
  const {find_program_in_system_paths} = main
  for (const name of ['node', 'gcc']) {
    const paths = ['/usr/bin', '/usr/local/bin']
    const version = '>=1'
    // check if /usr/local/bin/node exists
    if (fs.existsSync(`/usr/local/bin/${name}`) || fs.existsSync(`/usr/bin/${name}`)) {
      const __ret = await find_program_in_system_paths(paths, [name], version, true)
      expect(semver.satisfies(__ret.output_version, version)).toBe(true)
      expect(__ret.output_path == `/usr/local/bin/${name}` || __ret.output_path == `/usr/bin/${name}`).toBe(true)
    }
  }
})

test('find_program_with_apt', async () => {
  if (process.platform === 'linux') {
    const {find_program_with_apt} = main
    for (const name of ['cowsay']) {
      const version = '>=1'
      const __ret = await find_program_with_apt([name], version, true)
      if (__ret.output_path !== null) {
        expect(semver.satisfies(__ret.output_version, version)).toBe(true)
        expect(__ret.output_path == `/usr/local/bin/${name}` || __ret.output_path == `/usr/bin/${name}`).toBe(true)
      }
    }
  }
})

