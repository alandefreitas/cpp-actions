const core = require('@actions/core')
const fs = require('fs')
const path = require('path')
const exec = require('@actions/exec')
const io = require('@actions/io')
const os = require('os')

let trace_commands = false

function log(...args) {
    if (trace_commands) {
        core.info(...args)
    } else {
        core.debug(...args)
    }
}

function set_trace_commands(trace) {
    trace_commands = trace
}

function numberOfCpus() {
    const result = typeof os.availableParallelism === 'function'
        ? os.availableParallelism()
        : os.cpus().length
    if (!result || result === 0) {
        return 1
    }
    return result
}

async function main(inputs) {
    function fnlog(msg) {
        log('b2-workflow: ' + msg)
    }

    // ----------------------------------------------
    // Set toolset compiler
    // ----------------------------------------------
    // In B2, instead of passing the compiler path in the command line
    // arguments, it is set in the user-config.jam file. This is a
    // Jamfile that is read by B2 before the build starts and is somewhat
    // equivalent to the CMAKE_CXX_COMPILER cache variable in CMake.
    core.startGroup('🔧 Set toolset compiler')
    if (inputs.cxx && path.basename(inputs.cxx) === inputs.cxx) {
        try {
            inputs.cxx = await io.which(inputs.cxx)
        } catch (error) {
            fnlog(`Could not find ${inputs.cxx} in PATH`)
        }
    }
    core.info(`🧩 cxx: ${inputs.cxx}`)
    inputs.cxx = inputs.cxx.replaceAll('\\', '\\\\')
    if (inputs.toolset && inputs.toolset !== 'clang-win') {
        const user_config_jam = path.join(os.homedir(), 'user-config.jam')
        fnlog(`user-config.jam: ${user_config_jam}`)
        const user_config_jam_contents = `using ${inputs.toolset} : : "${inputs.cxx}" ;`
        fnlog(`user-config.jam user_config_jam_contents: ${user_config_jam_contents}`)
        fs.writeFileSync(user_config_jam, user_config_jam_contents)
    }
    core.endGroup()

    // ----------------------------------------------
    // Bootstrap B2
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap B2')
    // Run bootstrap.sh or bootstrap.bat from the source directory
    // to build B2
    const prev_cxx = process.env['CXX']
    process.env['CXX'] = '' // Let B2 identify the compiler at this step
    const bootstrap_path = path.join(inputs.source_dir, 'bootstrap' + (process.platform === 'win32' ? '.bat' : '.sh'))
    fnlog(`bootstrap_path: ${bootstrap_path}`)
    let bootstrap_args = []
    // if (inputs.toolset && inputs.toolset !== 'clang-win') {
    //     bootstrap_args.push(inputs.toolset)
    // }
    core.info(`💻 ${inputs.source_dir}> ${bootstrap_path} ${bootstrap_args.join(' ')}`)
    {
        const {exitCode} = await exec.getExecOutput(`"${bootstrap_path}"`, bootstrap_args, {
            cwd: inputs.source_dir,
            ignoreReturnCode: true
        })
        if (exitCode !== 0) {
            throw new Error(`B2 bootstrap failed with exit code ${exitCode}`)
        }
    }
    process.env['CXX'] = prev_cxx
    core.endGroup()

    // ----------------------------------------------
    // Bootstrap headers
    // ----------------------------------------------
    core.startGroup('🔎 Bootstrap headers')
    // ./b2 headers
    const b2_path = path.join(inputs.source_dir, 'b2' + (process.platform === 'win32' ? '.exe' : ''))
    fnlog(`b2_path: ${b2_path}`)
    let bootstrap_headers_args = ['headers']
    core.info(`💻 ${inputs.source_dir}> ${b2_path} ${bootstrap_headers_args.join(' ')}`)
    {
        const {exitCode} = await exec.getExecOutput(`"${b2_path}"`, bootstrap_headers_args, {
            cwd: inputs.source_dir,
            ignoreReturnCode: true
        })
        if (exitCode !== 0) {
            throw new Error(`B2 headers failed with exit code ${exitCode}`)
        }
    }
    core.endGroup()

    // ----------------------------------------------
    // Build step
    // ----------------------------------------------
    // In B2, all the configure/build/test/install/package steps are
    // combined into a single step.
    core.startGroup('🛠️ Build and Test')

    /*
        Basic configuration options
     */
    let b2_args = []
    b2_args.push('-j')
    b2_args.push(`${inputs.jobs}`)
    if (inputs.toolset) {
        b2_args.push(`--toolset=${inputs.toolset}`)
    }
    if (inputs.address_model) {
        b2_args.push(`address-model=${inputs.address_model}`)
    }
    if (inputs.cxxstd) {
        b2_args.push(`cxxstd=${inputs.cxxstd}`)
    }
    if (inputs.build_type) {
        let lc_build_type = inputs.build_type.toLowerCase()
        if (lc_build_type === 'relwithdebinfo') {
            lc_build_type = 'release'
            b2_args.push(`variant=${lc_build_type}`)
            b2_args.push('debug-symbols=on')
        } else {
            b2_args.push(`variant=${lc_build_type}`)
        }
    }

    /*
        Flags
     */
    if (inputs.cxxflags) {
        b2_args.push(`cxxflags=${inputs.cxxflags}`)
    }
    if (inputs.ccflags) {
        b2_args.push(`cflags=${inputs.ccflags}`)
    }
    if (inputs.linkflags) {
        b2_args.push(`linkflags=${inputs.linkflags}`)
    }

    /*
        B2-specific options
     */
    if (inputs.threading) {
        b2_args.push(`threading=${inputs.threading}`)
    }
    if (inputs.rtti !== undefined) {
        if (typeof inputs.rtti === 'string') {
            b2_args.push(`rtti=${inputs.rtti}`)
        } else if (inputs.rtti) {
            b2_args.push(`rtti=${inputs.rtti ? 'on' : 'off'}`)
        }
    }
    if (inputs.shared) {
        b2_args.push('link=shared')
    }
    if (inputs.asan !== undefined) {
        if (typeof inputs.asan === 'string') {
            b2_args.push(`address-sanitizer=${inputs.asan}`)
        } else if (inputs.asan) {
            b2_args.push('address-sanitizer=norecover')
        }
    }
    if (inputs.ubsan !== undefined) {
        if (typeof inputs.ubsan === 'string') {
            b2_args.push(`undefined-sanitizer=${inputs.ubsan}`)
        } else if (inputs.ubsan) {
            b2_args.push('undefined-sanitizer=norecover')
        }
    }
    if (inputs.tsan !== undefined) {
        if (typeof inputs.tsan === 'string') {
            b2_args.push(`thread-sanitizer=${inputs.tsan}`)
        } else if (inputs.tsan) {
            b2_args.push('thread-sanitizer=norecover')
        }
    }
    if (inputs.coverage) {
        b2_args.push('coverage=on')
    }
    if (inputs.toolset === 'clang-win') {
        b2_args.push('embed-manifest-via=linker')
    }

    /*
        Modules
     */
    for (const module of inputs.modules) {
        b2_args.push(`libs/${module}/test`)
    }

    /*
        Run
     */
    {
        core.info(`💻 ${inputs.source_dir}> ${b2_path} ${b2_args.join(' ')}`)
        for (const arg of b2_args) {
            fnlog(`arg: ${arg} (${typeof arg})`)
        }
        const {exitCode} = await exec.getExecOutput(`"${b2_path}"`, b2_args, {
            cwd: inputs.source_dir,
            ignoreReturnCode: true
        })
        if (exitCode !== 0) {
            throw new Error(`B2 build failed with exit code ${exitCode}`)
        }
    }
    core.endGroup()
}

function toTriboolInput(input) {
    if (typeof input === 'boolean') {
        return input
    }
    if (typeof input === 'number') {
        return input !== 0
    }
    if (typeof input !== 'string') {
        return undefined
    }
    if (['true', '1', 'on', 'yes', 'y'].includes(input.toLowerCase())) {
        return true
    } else if (['false', '0', 'off', 'no', 'n'].includes(input.toLowerCase())) {
        return false
    } else {
        return undefined
    }
}

function toTriboolOrStringInput(input) {
    const asBool = toTriboolInput(input)
    if (typeof asBool !== 'boolean') {
        return input
    }
    return asBool
}

function toIntegerInput(input) {
    const parsedInt = parseInt(input)
    if (isNaN(parsedInt)) {
        return undefined
    } else {
        return parsedInt
    }
}

function normalizePath(path) {
    const pathIsString = typeof path === 'string' || path instanceof String
    if (pathIsString && process.platform === 'win32') {
        return path.replace(/\\/g, '/')
    }
    return path
}

async function run() {
    function fnlog(msg) {
        log('b2-workflow: ' + msg)
    }

    try {
        let inputs = {
            // Configure options
            source_dir: normalizePath(core.getInput('source-dir')),
            cxx: normalizePath(core.getInput('cxx') || process.env['CXX'] || ''),
            ccflags: (core.getInput('ccflags') || process.env['CFLAGS'] || '').trim(),
            cxxflags: (core.getInput('cxxflags') || process.env['CXXFLAGS'] || '').trim(),
            cxxstd: (core.getInput('cxxstd') || process.env['CXXSTD'] || '').trim(),
            shared: toTriboolInput(core.getInput('shared') || process.env['BUILD_SHARED_LIBS'] || ''),
            toolset: core.getInput('toolset') || process.env['B2_TOOLSET'] || '',
            build_type: (core.getInput('build-variant') || process.env['B2_BUILD_VARIANT'] || core.getInput('build-type') || process.env['B2_BUILD_TYPE'] || '').toLowerCase(),
            modules: (core.getInput('modules') || '').split(/[,; ]/).filter((input) => input !== ''),
            // B2-specific options
            address_model: core.getInput('address-model') || undefined,
            asan: toTriboolOrStringInput(core.getInput('asan') || undefined),
            ubsan: toTriboolOrStringInput(core.getInput('ubsan') || undefined),
            tsan: toTriboolOrStringInput(core.getInput('tsan') || undefined),
            coverage: core.getInput('coverage') || undefined,
            linkflags: core.getInput('linkflags') || undefined,
            threading: core.getInput('threading') || undefined,
            rtti: toTriboolOrStringInput(core.getInput('rtti')) || undefined,
            // Build options
            jobs: toIntegerInput(core.getInput('jobs') || process.env['B2_JOBS']) || numberOfCpus(),
            // Annotations and tracing
            trace_commands: core.getBooleanInput('trace-commands')
        }

        // Resolve paths
        inputs.source_dir = path.resolve(inputs.source_dir)
        if (process.env['ACTIONS_STEP_DEBUG'] === 'true') {
            // Force trace-commands
            inputs.trace_commands = true
            trace_commands = true
        }
        trace_commands = inputs.trace_commands
        set_trace_commands(trace_commands)

        core.startGroup('📥 Workflow Inputs')
        fnlog(`🧩 b2-workflow.trace_commands: ${trace_commands}`)
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${value ? (typeof value === 'string' ? `"${value}"` : value) : '<empty>'}`)
        }
        core.endGroup()

        try {
            await main(inputs)
        } catch (error) {
            // Print stack trace
            fnlog(error.stack)
            // Print error message
            core.error(error)
            core.setFailed(error.message)
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.error('b2-workflow')
        core.error(error)
        core.error(error.message)
        core.error(error.stack)
        core.setFailed(error.stack)
    })
}

module.exports = {
    trace_commands,
    set_trace_commands,
    main
}
