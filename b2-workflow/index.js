const core = require('@actions/core')
const fs = require('fs')
const path = require('path')
const exec = require('@actions/exec')
const io = require('@actions/io')
const os = require('os')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')

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
        trace_commands.log('b2-workflow: ' + msg)
    }

    // ----------------------------------------------
    // Set toolset compiler
    // ----------------------------------------------
    // In B2, instead of passing the compiler path in the command line
    // arguments, it is set in the user-config.jam file. This is a
    // Jamfile that is read by B2 before the build starts and is somewhat
    // equivalent to the CMAKE_CXX_COMPILER cache variable in CMake.
    // The user is responsible for setting this configuration properly
    // if providing its own user-config.jam file.
    if (!inputs.user_config && inputs.cxx && inputs.toolset && inputs.toolset !== 'clang-win') {
        core.startGroup('🔧 Create user-config.jam')
        if (inputs.cxx && path.basename(inputs.cxx) === inputs.cxx) {
            try {
                inputs.cxx = await io.which(inputs.cxx)
            } catch (error) {
                fnlog(`Could not find ${inputs.cxx} in PATH`)
            }
        }
        core.info(`🧩 cxx: ${inputs.cxx}`)
        inputs.cxx = inputs.cxx.replaceAll('\\', '\\\\')
        // toolset_basename is toolset up to first '-'
        // For instance, for the toolset `gcc-13`, we should include the
        // path to `gcc` in user-config.jam. For `clang-win`, we should
        // include the path to `clang`.
        const toolset_basename = inputs.toolset.split('-')[0]
        const user_config_jam = path.join(os.homedir(), 'user-config.jam')
        fnlog(`user-config.jam: ${user_config_jam}`)
        const user_config_jam_contents = `using ${toolset_basename} : : "${inputs.cxx}" ;`
        fnlog(`user-config.jam contents: ${user_config_jam_contents}`)
        fs.writeFileSync(user_config_jam, user_config_jam_contents)
        core.info(`📝 ${user_config_jam} contents:`)
        core.info(user_config_jam_contents)
        core.endGroup()
    }

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
    if (inputs.build_dir) {
        b2_args.push(`--build-dir=${inputs.build_dir}`)
    }
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
    if (inputs.extra_args) {
        b2_args = b2_args.concat(inputs.extra_args)
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
    if (inputs.shared === true) {
        b2_args.push('link=shared')
    } else if (inputs.shared === false) {
        b2_args.push('link=static')
    }

    // The user can provide these options as a boolean (true/false) or as any
    // string. If the user provides a string, we pass it as-is to B2.
    // An empty string or undefined value is ignored.
    const boolOrStringOptions = [
        {key: 'warnings_as_errors', b2_key: 'warnings-as-errors', true_value: 'on', false_value: 'off'},
        {key: 'rtti', b2_key: 'rtti', true_value: 'on', false_value: 'off'},
        {key: 'asan', b2_key: 'address-sanitizer', true_value: 'norecover', false_value: undefined},
        {key: 'ubsan', b2_key: 'undefined-sanitizer', true_value: 'norecover', false_value: undefined},
        {key: 'msan', b2_key: 'memory-sanitizer', true_value: 'norecover', false_value: undefined},
        {key: 'tsan', b2_key: 'thread-sanitizer', true_value: 'norecover', false_value: undefined},
        {key: 'runtime_link', b2_key: 'runtime-link', true_value: 'shared', false_value: 'static'}
    ]
    for (const option of boolOrStringOptions) {
        const inputVal = inputs[option.key]
        if (typeof inputVal === 'string') {
            if (inputVal !== '') {
                b2_args.push(`${option.b2_key}=${inputVal}`)
            }
        } else if (inputVal || typeof inputVal === 'boolean') {
            if (option.false_value !== undefined) {
                b2_args.push(`${option.b2_key}=${inputVal ? option.true_value : option.false_value}`)
            } else if (inputVal) {
                b2_args.push(`${option.b2_key}=${option.true_value}`)
            }
        }
    }

    if (inputs.coverage) {
        b2_args.push('coverage=on')
    }
    if (inputs.toolset === 'clang-win') {
        b2_args.push('embed-manifest-via=linker')
    }
    if (inputs.clean_all) {
        b2_args.push('--clean-all')
    } else if (inputs.clean) {
        b2_args.push('--clean')
    }

    if (inputs.abbreviate_paths) {
        b2_args.push('--abbreviate-paths')
    } else if (inputs.hash) {
        b2_args.push('--hash')
    }
    if (inputs.rebuild_all) {
        b2_args.push('-a')
    }
    if (inputs.dry_run) {
        b2_args.push('-n')
    }
    if (inputs.stop_on_error) {
        b2_args.push('-q')
    }

    if (inputs.config) {
        b2_args.push(`--config=${inputs.config}`)
    }
    if (inputs.site_config) {
        b2_args.push(`--site-config=${inputs.site_config}`)
    }
    if (inputs.user_config) {
        b2_args.push(`--user-config=${inputs.user_config}`)
    }
    if (inputs.project_config) {
        b2_args.push(`--project-config=${inputs.project_config}`)
    }
    if (inputs.debug_configuration) {
        b2_args.push('--debug-configuration')
    }
    if (inputs.debug_building) {
        b2_args.push('--debug-building')
    }
    if (inputs.debug_generators) {
        b2_args.push('--debug-generators')
    }
    if (inputs.include) {
        b2_args.push(`--include=${inputs.include}`)
    }
    if (inputs['define']) {
        b2_args.push(`--define=${inputs['define']}`)
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


async function run() {
    function fnlog(msg) {
        trace_commands.log('b2-workflow: ' + msg)
    }

    try {
        let inputs = {
            // Configure options
            source_dir: gh_inputs.getResolvedPath('source-dir'),
            build_dir: gh_inputs.getNormalizedPath('build-dir'),
            cxx: gh_inputs.getNormalizedPath('cxx', {fallbackEnv: 'CXX'}),
            ccflags: gh_inputs.getInput('ccflags', {fallbackEnv: 'CFLAGS'}),
            cxxflags: gh_inputs.getInput('cxxflags', {fallbackEnv: 'CXXFLAGS'}),
            cxxstd: gh_inputs.getInput('cxxstd', {fallbackEnv: 'CXXSTD'}),
            shared: gh_inputs.getTribool('shared', {fallbackEnv: 'BUILD_SHARED_LIBS'}),
            toolset: gh_inputs.getInput('toolset', {fallbackEnv: 'B2_TOOLSET'}),
            build_type: gh_inputs.getLowerCaseInput(['build-variant', 'build-type'], {fallbackEnv: ['B2_BUILD_VARIANT', 'B2_BUILD_TYPE']}),
            modules: gh_inputs.getArray('modules', /[,; ]/),
            extra_args: gh_inputs.getBashArguments('extra-args'),
            // B2-specific options
            warnings_as_errors: gh_inputs.getBoolOrString('warnings-as-errors'),
            address_model: gh_inputs.getInput('address-model') || undefined,
            asan: gh_inputs.getBoolOrString('asan'),
            ubsan: gh_inputs.getBoolOrString('ubsan'),
            msan: gh_inputs.getBoolOrString('msan'),
            tsan: gh_inputs.getBoolOrString('tsan'),
            coverage: gh_inputs.getInput('coverage') || undefined,
            linkflags: gh_inputs.getInput('linkflags') || undefined,
            threading: gh_inputs.getInput('threading') || undefined,
            rtti: gh_inputs.getBoolOrString('rtti'),
            clean: gh_inputs.getTribool('clean'),
            clean_all: gh_inputs.getTribool('clean-all'),
            abbreviate_paths: gh_inputs.getTribool('abbreviate-paths'),
            hash: gh_inputs.getTribool('hash'),
            rebuild_all: gh_inputs.getTribool('rebuild-all'),
            dry_run: gh_inputs.getTribool('dry-run'),
            stop_on_error: gh_inputs.getTribool('stop-on-error'),
            config: gh_inputs.getNormalizedPath('config'),
            site_config: gh_inputs.getNormalizedPath('site-config'),
            user_config: gh_inputs.getNormalizedPath('user-config'),
            project_config: gh_inputs.getNormalizedPath('project-config'),
            debug_configuration: gh_inputs.getTribool('debug-configuration'),
            debug_building: gh_inputs.getTribool('debug-building'),
            debug_generators: gh_inputs.getTribool('debug-generators'),
            include: gh_inputs.getNormalizedPath('include'),
            define: gh_inputs.getInput('define'),
            runtime_link: gh_inputs.getBoolOrString('runtime-link'),
            // Build options
            jobs: gh_inputs.getInt('jobs', {fallbackEnv: 'B2_JOBS'}) || numberOfCpus(),
            // Annotations and tracing
            trace_commands: gh_inputs.getBoolean('trace-commands')
        }

        // Apply trace commands
        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }
        fnlog(`🧩 b2-workflow.trace_commands: ${trace_commands}`)

        core.startGroup('📥 Action Inputs')
        gh_inputs.printInputObject(inputs)
        core.endGroup()

        await main(inputs)
    } catch (error) {
        core.setFailed(`${error.message}\n${error.stack}`)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(`${error.message}\n${error.stack}`)
    })
}

module.exports = {
    main
}
