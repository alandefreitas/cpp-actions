const core = require('@actions/core')
const github = require('@actions/github')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const httpm = require('@actions/http-client')
const setup_program = require('./../setup-program/index')
const setup_gcc = require('./../setup-gcc/index')
const setup_clang = require('./../setup-clang/index')
const setup_msvc = require('./msvc-dev-cmd')

setup_program.trace_commands = false
setup_gcc.trace_commands = false
setup_clang.trace_commands = false
let trace_commands = false

function log(...args) {
  if (trace_commands) {
    core.info(...args)
  } else {
    core.debug(...args)
  }
}

function normalizeCompiler(compiler, version) {
  let parts = compiler.split(/-|\s/)
  let num_parts = parts.length

  // Split compiler from version in the compiler name
  // If the compiler is something like "gcc-10.2.0", we need to split it
  if (num_parts !== 1 && /[\d\\.]+/.test(parts[num_parts - 1])) {
    compiler = parts[0]
    for (let i = 1; i < num_parts - 1; i++) {
      compiler += `-${parts[i]}`
    }
    version = parts[num_parts - 1]
  }

  // Normalize compiler name
  compiler = compiler.toLowerCase()
  if (compiler.startsWith('gcc') || compiler.startsWith('g++')) {
    compiler = 'gcc'
  } else if (compiler.startsWith('clang') || compiler.startsWith('apple-clang') || compiler.startsWith('appleclang')) {
    if (process.platform === 'win32') {
      compiler = 'clang-cl'
    } else {
      compiler = 'clang'
    }
  } else if (compiler.startsWith('msvc') || compiler.startsWith('cl')) {
    compiler = 'msvc'
  }

  return {
    compiler,
    version
  }
}

async function run() {
  try {
    const inputs = [
      ['trace_commands', core.getBooleanInput('trace-commands')],
      ['compiler', core.getInput('compiler') || '*'],
      ['version', core.getInput('version') || '*'],
      ['path', core.getInput('path').split(/[:;]/).filter((path) => path !== '')],
      ['check_latest', core.getBooleanInput('check-latest')],
      ['update_environment', core.getBooleanInput('update-environment')]
    ]

    function getInput(inputs, key) {
      return inputs.find(([name]) => name === key)[1]
    }

    function setInput(inputs, key, value) {
      const input = inputs.find(([name]) => name === key)
      if (input) {
        input[1] = value
      } else {
        log(`Input ${key} not found`)
        inputs.push([key, value])
      }
    }

    for (const [name, value] of inputs) {
      if (name === 'trace_commands') {
        trace_commands = value
        setup_program.set_trace_commands(value)
        setup_gcc.set_trace_commands(value)
        setup_clang.set_trace_commands(value)
        log(`setup_program.trace_commands: ${setup_program.trace_commands}`)
        log(`setup_gcc.trace_commands: ${setup_gcc.trace_commands}`)
        log(`setup_clang.trace_commands: ${setup_clang.trace_commands}`)
      }
      log(`${name}: ${value}`)
    }

    const {compiler, version} = normalizeCompiler(getInput(inputs, 'compiler'), getInput(inputs, 'version'))
    setInput(inputs, 'compiler', compiler)
    setInput(inputs, 'version', version)


    let output_path = null
    let cc = null
    let cxx = null
    let bindir = null
    let dir = null
    let release = null
    let version_major = null
    let version_minor = null
    let version_patch = null

    if (['clang', 'gcc'].includes(compiler) && process.platform === 'linux') {
      log(`compiler: ${compiler}... forwarding to setup ${compiler} action.`)
      let SetupResult = null
      if (compiler === 'clang') {
        SetupResult = await setup_clang.main(
          getInput(inputs, 'version'),
          getInput(inputs, 'path'),
          getInput(inputs, 'check_latest'),
          getInput(inputs, 'update_environment'))
      } else if (compiler === 'gcc') {
        SetupResult = await setup_gcc.main(
          getInput(inputs, 'version'),
          getInput(inputs, 'path'),
          getInput(inputs, 'check_latest'),
          getInput(inputs, 'update_environment'))
      }
      if (SetupResult !== null) {
        output_path = SetupResult.output_path
        cc = SetupResult.cc
        cxx = SetupResult.cxx
        bindir = SetupResult.bindir
        dir = SetupResult.dir
        release = SetupResult.release
        version_major = SetupResult.version_major
        version_minor = SetupResult.version_minor
        version_patch = SetupResult.version_patch
      }
    } else if (compiler === 'msvc') {
      log(`compiler: ${compiler}... forwarding to setupMSVCDevCmd.`)
      const arch = process.env['PROCESSOR_ARCHITECTURE'] || 'x64'
      setup_msvc.setupMSVCDevCmd(arch, '', '', '', '', '')
      output_path = process.env['Path']
      for (const [key, value] of Object.entries(process.env)) {
        log(`${key}: ${value}`)
      }
      cc = ''
      cxx = ''
      bindir = process.env['VCINSTALLDIR'] + '\\bin'
      dir = path.dirname(bindir)
      const semverRelease = semver.coerce(process.env.VisualStudioVersion)
      release = semverRelease ? semverRelease.toString() : '0.0.0'
      version_major = semverRelease ? semverRelease.major : 0
      version_minor = semverRelease ? semverRelease.minor : 0
      version_patch = semverRelease ? semverRelease.patch : 0
    } else if (['mingw', 'mingw32', 'mingw64', 'gcc', 'clang', 'clang-cl'].includes(compiler)) {
      log(`compiler: ${compiler}... looking for compiler in PATH.`)
      let which_arg = ''
      if (['mingw', 'mingw32', 'mingw64', 'gcc'].includes(compiler)) {
        which_arg = 'gcc'
      } else if (compiler === 'clang' && process.platform === 'win32') {
        which_arg = 'clang-cl'
      } else {
        which_arg = compiler
      }
      // Check if executable exists
      let compiler_path = null
      try {
        compiler_path = await io.which(which_arg)
      } catch (error) {
        compiler_path = null
      }
      if (compiler_path === null) {
        core.setFailed(`Cannot find ${which_arg}`)
      } else {
        // Set outputs
        output_path = compiler_path
        cc = compiler_path
        cxx = compiler_path.replace(/gcc/g, 'g++').replace(/clang/g, 'clang++')
        if (!fs.existsSync(cxx)) {
          cxx = cc
        }
        bindir = path.dirname(output_path)
        dir = path.dirname(bindir)


        // Get version
        const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${output_path}"`, ['--version'])
        const version_output = stdout.trim()
        if (exitCode !== 0) {
          log(`Path program ${path} --version exited with code ${exitCode}`)
          release = '0.0.0'
          version_major = '0'
          version_minor = '0'
          version_patch = '0'
        } else {
          const version_regexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/]
          let version = null
          for (const version_regex of version_regexes) {
            const version_matches = version_output.match(version_regex)
            if (version_matches !== null) {
              const version_str = version_matches[1]
              version = semver.coerce(version_str, {includePrerelease: false, loose: true})
              if (version === null) {
                continue
              }
              release = version.toString()
              version_major = version.major
              version_minor = version.minor
              version_patch = version.patch
              break
            }
          }
        }
      }
    }

    // Parse Final program / Setup version / Outputs
    if (output_path !== null && output_path !== undefined) {
      const outputs = [
        ['cc', cc],
        ['cxx', cxx],
        ['bindir', bindir],
        ['dir', dir],
        ['version', release],
        ['version-major', version_major],
        ['version-minor', version_minor],
        ['version-patch', version_patch]
      ]
      for (const [name, value] of outputs) {
        core.setOutput(name, value)
        log(`Setting output ${name} to ${value}`)
      }
    } else {
      core.setFailed(`Cannot setup ${compiler}`)
    }
  } catch
    (error) {
    core.setFailed(error.message)
  }
}

if (require.main === module) {
  run()
}

module.exports = {
  trace_commands,
  normalizeCompiler
}
