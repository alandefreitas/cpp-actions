const core = require('@actions/core')
const io = require('@actions/io')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const setup_gcc = require('setup-gcc')
const setup_clang = require('setup-clang')
const setup_msvc = require('./msvc-dev-cmd')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')

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
        const inputs = {
            compiler: gh_inputs.getInput('compiler', {defaultValue: '*'}),
            version: gh_inputs.getInput('version', {defaultValue: '*'}),
            path: gh_inputs.getArray('path', /[:;]/),
            check_latest: gh_inputs.getBoolean('check-latest'),
            update_environment: gh_inputs.getBoolean('update-environment'),
            trace_commands: gh_inputs.getBoolean('trace-commands')
        }

        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        const {compiler, version} = normalizeCompiler(inputs.compiler, inputs.version)
        inputs.compiler = compiler
        inputs.version = version

        core.startGroup('📥 Action Inputs')
        gh_inputs.printInputObject(inputs)
        core.endGroup()


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
            trace_commands.log(`compiler: ${compiler}... forwarding to setup ${compiler} action.`)
            let SetupResult = null
            if (compiler === 'clang') {
                SetupResult = await setup_clang.main(
                    inputs.version,
                    inputs.path,
                    inputs.check_latest,
                    inputs.update_environment)
            } else if (compiler === 'gcc') {
                SetupResult = await setup_gcc.main(
                    inputs.version,
                    inputs.path,
                    inputs.check_latest,
                    inputs.update_environment)
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
            trace_commands.log(`compiler: ${compiler}... forwarding to setupMSVCDevCmd.`)
            const arch = process.env['PROCESSOR_ARCHITECTURE'] || 'x64'
            setup_msvc.setupMSVCDevCmd(arch, '', '', '', '', '')
            output_path = process.env['Path']
            for (const [key, value] of Object.entries(process.env)) {
                trace_commands.log(`${key}: ${value}`)
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
            core.startGroup(`🔍 Searching for ${compiler}`)
            trace_commands.log(`compiler: ${compiler}... looking for compiler in PATH.`)
            let which_arg
            if (['mingw', 'mingw32', 'mingw64', 'gcc'].includes(compiler)) {
                which_arg = 'gcc'
            } else if (compiler === 'clang' && process.platform === 'win32') {
                which_arg = 'clang-cl'
            } else {
                which_arg = compiler
            }
            // Check if executable exists
            let compiler_path
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
                    trace_commands.log(`Path program ${path} --version exited with code ${exitCode}`)
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
            core.endGroup()
        }

        // Parse Final program / Setup version / Outputs
        if (output_path !== null && output_path !== undefined) {
            const outputs = {
                cc: cc,
                cxx: cxx,
                bindir: bindir,
                dir: dir,
                version: release,
                version_major: version_major,
                version_minor: version_minor,
                version_patch: version_patch
            }
            core.startGroup('📤 Action Outputs')
            gh_inputs.setOutputObject(outputs)
            core.endGroup()
        } else {
            core.setFailed(`Cannot setup ${compiler}`)
        }
    } catch
        (error) {
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(error.message)
    })
}

module.exports = {
    normalizeCompiler
}
