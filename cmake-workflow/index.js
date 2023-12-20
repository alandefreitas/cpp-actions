const core = require('@actions/core')
const actions_artifact = require('@actions/artifact')
const fs = require('fs')
const setup_cmake = require('./../setup-cmake/index')
const path = require('path')
const exec = require('@actions/exec')
const io = require('@actions/io')
const os = require('os')

// const semver = require('semver')
// const httpm = require('@actions/http-client')
// const io = require('@actions/io')
// const tc = require('@actions/tool-cache')
// const exec = require('@actions/exec')
// const github = require('@actions/github')

setup_cmake.trace_commands = false
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
    setup_cmake.set_trace_commands(trace)
}

function createCMakeConfigureAnnotations(output, inputs) {
    function fnlog(msg) {
        log('createCMakeConfigureAnnotations: ' + msg)
    }

    // A CMake configure warning/error message looks like this regex followed
    // by optional line breaks, then more lines with the message.
    const regex = /^CMake (?:\([^)]\) )?(Warning|Error)( at ([^:]+):(\d+) \(([^)]+)\))?:(.*)/
    let match
    let curMessage = undefined
    let messages = []
    for (const line of output.split(/\r?\n/)) {
        match = line.match(regex)
        if (match) {
            fnlog(`Matched: ${match[0]}`)
            if (curMessage && curMessage.message !== '') {
                messages.push(curMessage)
            }
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file = match[3] || undefined
            fnlog(`File: ${file}`)
            if (file) {
                file = path.resolve(inputs.source_dir, file)
                fnlog(`Absolute file: ${file}`)
                file = path.relative(inputs.ref_source_dir, file)
                fnlog(`File relative to repository: ${file}`)
            }
            // Get line and attempt to convert to integer
            let line = match[4] || undefined
            fnlog(`Line: ${line}`)
            if (line) {
                line = parseInt(line)
                fnlog(`Line (int): ${line}`)
            }
            let title = match[5] || undefined
            if (title) {
                title = 'CMake: ' + title.trim()
            } else {
                title = 'CMake'
            }
            curMessage = {
                title: title,
                file: file,
                line: line,
                severity: match[1] || '',
                message: match[6] || ''
            }
            fnlog(`Creating message: ${JSON.stringify(curMessage)}`)
        } else if (curMessage) {
            curMessage.message += '\n' + line
            const emptyLine = line.trim().length !== 0
            if (emptyLine) {
                // Append after first non-empty line.
                fnlog(`Appending message: ${JSON.stringify(curMessage)}`)
                messages.push(curMessage)
                curMessage = undefined
            }
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages)
}

function createCMakeBuildAnnotations(output, inputs) {
    function fnlog(msg) {
        log('createCMakeBuildAnnotations: ' + msg)
    }

    // A CMake build warning/error message is actually a warning/error
    // message from the compiler
    // msvc format: <file>(<line>): (warning|error) <code>: <message>
    const msvcRegex = /^([^()]+)\((\d+)\):\s+(warning|error)\s+([^:]+):\s+(.*)$/
    // gcc_clang_regex="^([^:]+):([[:digit:]]+):([[:digit:]]+)?: (warning|error):([^\\[]*)(\\[-W[A-Za-z0-9-]*\\])?$"
    // gcc/clang format: <file>:<line>:<column> (warning|error): <message> [\[error_code\]]
    const gccClangRegex = /^([^:]+):(\d+):(\d+)?:\s+(warning|error):\s+([^\\\[]*)\s*(\[-W[A-Za-z0-9-]+])?$/
    let match
    let messages = []
    for (const line of output.split(/\r?\n/)) {
        match = line.match(gccClangRegex)
        if (match) {
            fnlog(`Matched: ${match[0]}`)
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file = match[1] || undefined
            fnlog(`File: ${file}`)
            if (file) {
                file = path.resolve(inputs.source_dir, file)
                fnlog(`Absolute file: ${file}`)
                file = path.relative(inputs.ref_source_dir, file)
                fnlog(`File relative to repository: ${file}`)
            }
            // Get line and attempt to convert to integer
            let line = match[2] || undefined
            fnlog(`Line: ${line}`)
            if (line) {
                line = parseInt(line)
                fnlog(`Line (int): ${line}`)
            }
            // Get column and attempt to convert to integer
            let column = match[3] || undefined
            fnlog(`Column: ${column}`)
            if (column) {
                column = parseInt(column)
                fnlog(`Column (int): ${column}`)
            }
            // Capitalized severity
            let severity = match[4] || undefined
            if (severity) {
                severity = severity.charAt(0).toUpperCase() + severity.slice(1)
            }
            let cxx_basename = path.basename(inputs.cxx)
            let title = `Build ${severity}`
            if (inputs.cxx) {
                title += ` - ${cxx_basename}`
            }
            let error_msg = match[5] || undefined
            let msg = ''
            if (inputs.cxx) {
                msg = `${cxx_basename} - ${error_msg}`
            } else {
                msg = error_msg
            }
            let error_code = match[6] || undefined
            if (error_code) {
                title += ` - ${error_code}`
                msg += ` (${error_code})`
            }
            let curMessage = {
                title: title,
                file: file,
                line: line,
                column: column,
                severity: severity,
                message: msg
            }
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`)
            messages.push(curMessage)
            continue
        }
        match = line.match(msvcRegex)
        if (match) {
            fnlog(`Matched: ${match[0]}`)
            let file = match[1] || undefined
            fnlog(`File: ${file}`)
            if (file) {
                file = path.resolve(inputs.source_dir, file)
                fnlog(`Absolute file: ${file}`)
                file = path.relative(inputs.ref_source_dir, file)
                fnlog(`File relative to repository: ${file}`)
            }
            let line = match[2] || undefined
            fnlog(`Line: ${line}`)
            if (line) {
                line = parseInt(line)
                fnlog(`Line (int): ${line}`)
            }
            let column = undefined
            let severity = match[3] || undefined
            if (severity) {
                severity = severity.charAt(0).toUpperCase() + severity.slice(1)
            }
            let error_code = match[4] || undefined
            let error_message = match[5] || undefined
            let cxx_basename = path.basename(inputs.cxx)
            let title = `Build ${severity}`
            if (inputs.cxx) {
                title += ` - ${cxx_basename}`
            }
            let msg = ''
            if (inputs.cxx) {
                msg = `${cxx_basename} - ${error_message}`
            } else {
                msg = error_message
            }
            if (error_code) {
                title += ` - ${error_code}`
                msg += ` (${error_code})`
            }
            let curMessage = {
                title: title,
                file: file,
                line: line,
                column: column,
                severity: severity,
                message: msg
            }
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`)
            messages.push(curMessage)
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages)
}

function createAnnotationsFromMessage(messages) {
    function fnlog(msg) {
        log('createAnnotationsFromMessage: ' + msg)
    }

    for (const message of messages) {
        fnlog(`Creating annotation: ${JSON.stringify(message)}`)
        const properties = {
            title: message.title ? message.title.trim() : undefined,
            file: message.file ? message.file : undefined,
            startLine: message.line,
            endLine: message.line,
            startColumn: message.column ? message.column : 0,
            endColumn: message.column ? message.column : 0
        }
        fnlog(`Annotation properties: ${JSON.stringify(properties)}`)
        if (message.severity.toLowerCase() === 'error') {
            core.error(message.message, properties)
        } else {
            core.warning(message.message, properties)
        }
    }
}

function createCMakeTestAnnotations(output, inputs) {
    function fnlog(msg) {
        log('createCMakeTestAnnotations: ' + msg)
    }

    // A CMake test warning/error message is actually an error message
    // from whatever test framework is being used. The only supported format
    // for now is Boost.Test.
    // boost_test_regex="^#[[:digit:]]+ ([^\\(\\)]+)\\(([[:digit:]]+)\\) failed: (.*)"
    const boostTestRegex = /^#\d* ([^()]+)\((\d+)\) failed: (.*)/
    let messages = []
    for (const line of output.split(/\r?\n/)) {
        match = line.match(boostTestRegex)
        if (match) {
            fnlog(`Matched: ${match[0]}`)
            // The file in the message is always relative
            // to the source directory. Make it relative to
            // the workspace directory.
            let file = match[1] || undefined
            fnlog(`File: ${file}`)
            if (file) {
                file = path.resolve(inputs.source_dir, file)
                fnlog(`Absolute file: ${file}`)
                file = path.relative(inputs.ref_source_dir, file)
                fnlog(`File relative to repository: ${file}`)
            }
            // Get line and attempt to convert to integer
            let line = match[2] || undefined
            fnlog(`Line: ${line}`)
            if (line) {
                line = parseInt(line)
                fnlog(`Line (int): ${line}`)
            }
            // Message
            let msg = match[3] || undefined
            // Get column and attempt to convert to integer
            let column = undefined
            let curMessage = {
                title: 'Boost.Test',
                file: file,
                line: line,
                column: column,
                severity: 'Error',
                message: 'Boost.Test: ' + msg
            }
            fnlog(`Appending message: ${JSON.stringify(curMessage)}`)
            messages.push(curMessage)
        }
    }

    // Create GitHub annotations from the messages
    createAnnotationsFromMessage(messages)
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

function makeArgsString(args) {
    let res = []
    for (const arg of args) {
        if (arg.includes(' ')) {
            res.push(`"${arg.replaceAll('"', '\\"')}"`)
        } else {
            res.push(arg)
        }
    }
    return res.join(' ')
}

async function main(inputs) {
    function fnlog(msg) {
        log('cmake-workflow: ' + msg)
    }

    let {
        // CMake
        cmake_path,
        cmake_version,
        // Configure options
        source_dir,
        build_dir,
        cc,
        ccflags,
        cxx,
        cxxflags,
        cxxstd: cxxstds,
        shared,
        toolchain,
        generator,
        generator_toolset,
        build_type,
        build_target,
        extra_args,
        export_compile_commands,
        install_prefix,
        // Build options
        jobs,
        // Test options
        run_tests,
        configure_tests_flag,
        test_all_cxxstd,
        // Install
        install,
        install_all_cxxstd,
        // Package
        package: do_package,
        package_all_cxxstd,
        package_name,
        package_dir,
        package_vendor,
        package_generators,
        package_artifact,
        package_retention_days,
        // Annotations and tracing
        create_annotations,
        // ref_source_dir, /* Only used by annotations */
        trace_commands
    } = inputs

    // ----------------------------------------------
    // Look for CMake versions
    // ----------------------------------------------
    core.startGroup(`🔎 Setup CMake`)
    const setupCMakeInputs = {
        trace_commands: trace_commands,
        version: cmake_version,
        cmake_file: path.resolve(source_dir, 'CMakeLists.txt'),
        path: cmake_path,
        cmake_path: 'cmake',
        cache: false,
        check_latest: false,
        update_environment: false
    }
    const setupCMakeOutputs = await setup_cmake.main(setupCMakeInputs, false)
    if (!setupCMakeOutputs.path) {
        throw new Error('❌ CMake not found')
    }
    cmake_path = setupCMakeOutputs.path
    // cmake_version = setupCMakeOutputs.version
    const cmake_dir = setupCMakeOutputs.dir
    // const version_major = setupCMakeOutputs.version_major
    // const version_minor = setupCMakeOutputs.version_minor
    // const version_patch = setupCMakeOutputs.version_patch
    // const cache_hit = setupCMakeOutputs.cache_hit
    const supports_path_to_build = setupCMakeOutputs.supports_path_to_build
    const supports_parallel_build = setupCMakeOutputs.supports_parallel_build
    const supports_build_multiple_targets = setupCMakeOutputs.supports_build_multiple_targets
    const supports_cmake_install = setupCMakeOutputs.supports_cmake_install
    core.endGroup()

    // ----------------------------------------------
    // Identify generator features
    // ----------------------------------------------
    core.startGroup(`🎛️ CMake parameters`)
    if (!generator) {
        // Execute and get the output of:
        fnlog(`Identifying default generator`)
        // "$cmake_path" --system-information | sed -n 's/^CMAKE_GENERATOR [[:space:]]*"\([^"]*\)".*/\1/p')
        const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cmake_path}"`, ['--system-information'], {
            silent: true,
            ignoreReturnCode: true
        })
        let match
        if (exitCode === 0) {
            // Find first line in stdout that describes the default 'CMAKE_GENERATOR'
            // The pattern is: CMAKE_GENERATOR "<generator>"
            const regex = /^\s*CMAKE_GENERATOR\s+"([^"]*)"/
            for (const line of stdout.split(/\r?\n/).map(line => line.trim())) {
                match = line.match(regex)
                if (match) {
                    fnlog(`Matched: ${match[0]}`)
                    break
                }
            }
        }
        if (match) {
            generator = match[1]
        } else {
            fnlog(`Could not identify default generator. Inferring default generator from OS.`)
            if (process.platform === 'win32') {
                generator = 'Visual Studio'
            } else {
                generator = 'Unix Makefiles'
            }
        }
        fnlog(`Default generator: ${generator}`)
    }
    const generator_is_multi_config = generator.startsWith('Visual Studio') || ['Ninja Multi-Config', 'Xcode'].includes(generator)
    core.info(`🔄 Generator "${generator}" ${generator_is_multi_config ? 'IS' : 'is NOT'} multi-config`)

    // ----------------------------------------------
    // Identify extra workflow parameters
    // ----------------------------------------------
    const ctest_path = path.join(cmake_dir, 'ctest')
    core.info(`🧩 ctest_path: ${ctest_path}`)
    const cpack_path = path.join(cmake_dir, 'cpack')
    core.info(`🧩 cpack_path: ${cpack_path}`)
    if (cc && path.basename(cc) === cc) {
        try {
            cc = await io.which(cc)
        } catch (error) {
            fnlog(`Could not find ${cc} in PATH`)
        }
    }
    core.info(`🧩 cc: ${cc}`)
    if (cxx && path.basename(cxx) === cxx) {
        try {
            cxx = await io.which(cxx)
        } catch (error) {
            fnlog(`Could not find ${cxx} in PATH`)
        }
    }
    core.info(`🧩 cxx: ${cxx}`)
    if (cxxstds.length === 0) {
        // Null element represents the default compiler
        cxxstds = [null]
    }
    core.info(`🧩 cxxstd: ${cxxstds.map(element => (element === null ? '<default>' : element))}`)
    const main_cxxstd = cxxstds[cxxstds.length - 1]
    core.info(`🧩 main_cxxstd: ${main_cxxstd === null ? '<default>' : main_cxxstd}`)
    core.endGroup()

    // ----------------------------------------------
    // Configure steps
    // ----------------------------------------------
    function make_build_dir(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? build_dir : (build_dir + '-' + cur_cxxstd)
    }

    function make_install_prefix(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? install_prefix : (install_prefix + '-' + cur_cxxstd)
    }

    function make_package_dir(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? package_dir : (package_dir + '-' + cur_cxxstd)
    }

    function make_factor_description(cur_cxxstd) {
        let description = ''
        if (inputs.extra_args_key) {
            description = `${inputs.extra_args_key}: `
        }
        if (cur_cxxstd) {
            description += `C++${cur_cxxstd}`
        } else {
            description += `Default C++ standard`
        }
        return description
    }

    core.startGroup(`⚙️ Configure`)
    for (const cur_cxxstd of cxxstds) {
        core.info(`⚙️ Configure (${make_factor_description(cur_cxxstd)})`)
        const std_build_dir = make_build_dir(cur_cxxstd)

        let configure_args = []
        /*
            Build parameters
         */
        if (supports_path_to_build) {
            // If this can't be set directly, then we need to change the
            // working directory when running the command
            configure_args.push('-S')
            configure_args.push(source_dir)
            configure_args.push('-B')
            configure_args.push(std_build_dir)
        }
        if (generator) {
            configure_args.push('-G')
            configure_args.push(generator)
        }
        if (generator_toolset) {
            configure_args.push('-T')
            configure_args.push(generator_toolset)
        }
        if (cxxflags.includes('/m32') && generator.startsWith('Visual Studio')) {
            // In Visual Studio, the -A option is used to specify the architecture,
            // and it needs to be set explicitly
            configure_args.push('-A', 'Win32')
            // Remove /m32 from cxxflags
            cxxflags = cxxflags
                .split(' ').filter((input) => input !== '')
                .filter((input) => input !== '/m32')
                .join(' ')
            ccflags = ccflags
                .split(' ').filter((input) => input !== '')
                .filter((input) => input !== '/m32')
                .join(' ')
        }
        if (!generator_is_multi_config) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_BUILD_TYPE=${build_type || 'Release'}`)
        } else {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CONFIGURATION_TYPES=${build_type || 'Release'}`)
        }
        if (toolchain) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_TOOLCHAIN_FILE=${toolchain}`)
        }
        if (run_tests !== undefined && configure_tests_flag) {
            configure_args.push('-D')
            if (configure_tests_flag.includes('=')) {
                configure_args.push(configure_tests_flag)
            } else {
                configure_args.push(`${configure_tests_flag}=${run_tests ? 'ON' : 'OFF'}`)
            }
        }
        if (shared) {
            configure_args.push('-D')
            configure_args.push('BUILD_SHARED_LIBS=ON')
        }
        if (cc) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_C_COMPILER=${cc}`)
        }
        if (ccflags) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_C_FLAGS=${ccflags}`)
        }
        if (cxx) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_COMPILER=${cxx}`)
        }
        if (cxxflags) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_FLAGS=${cxxflags}`)
        }
        if (cur_cxxstd) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_STANDARD=${cur_cxxstd}`)
        }
        if (export_compile_commands === true) {
            configure_args.push('-D')
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=ON')
        } else if (export_compile_commands === false) {
            configure_args.push('-D')
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=OFF')
        }
        configure_args.push('--no-warn-unused-cli')

        /*
            Install and package parameters
         */
        if (install_prefix) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_INSTALL_PREFIX=${make_install_prefix(cur_cxxstd)}`)
        }
        if (package_generators.length > 0) {
            configure_args.push('-D')
            configure_args.push(`CPACK_GENERATOR=${package_generators.join(';')}`)
        }
        if (package_name) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_NAME=${package_name}`)
        }
        if (package_dir) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_DIRECTORY=${package_dir}`)
        }
        if (package_vendor) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_VENDOR=${package_vendor}`)
        }

        /*
            Extra arguments
         */
        fnlog(`Extra arguments: ${JSON.stringify(extra_args)}`)
        for (const extra_arg of extra_args) {
            configure_args.push(extra_arg)
        }
        if (!supports_path_to_build) {
            // If CMake doesn't support the -S and -B options, then we will
            // need to change the working directory when running the command
            // and set the source directory as the last argument
            configure_args.push(`${source_dir}`)
        }

        /*
            Prepare build directory
         */
        // Ensure build_dir exists
        const cmd_dir = supports_path_to_build ? source_dir : std_build_dir
        if (!supports_path_to_build) {
            await io.mkdirP(std_build_dir)
        }
        core.info(`💻 ${std_build_dir}> ${cmake_path} ${makeArgsString(configure_args)}`)
        const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cmake_path}"`, configure_args, {
            cwd: cmd_dir,
            ignoreReturnCode: true
        })
        if (create_annotations) {
            createCMakeConfigureAnnotations(stdout, inputs)
        }
        if (exitCode !== 0) {
            throw new Error(`CMake configure failed with exit code ${exitCode}`)
        }
    }
    core.endGroup()

    // ==============================================
    // Build steps
    // ==============================================
    core.startGroup(`🛠️ Build`)
    if (build_target.length === 0) {
        // null represents the default target
        build_target = [null]
    } else if (supports_build_multiple_targets && build_target.length > 1) {
        // If multiple targets are specified, then we can only build them
        // all at once if the generator supports it. The targets
        // need to be space separated.
        build_target = [build_target.join(' ')]
    }
    for (const cur_cxxstd of cxxstds) {
        core.info(`🛠️ Build (${make_factor_description(cur_cxxstd)})`)
        const std_build_dir = make_build_dir(cur_cxxstd)

        /*
            Build parameters
         */
        for (const cur_build_target of build_target) {
            let build_args = ['--build']
            build_args.push(std_build_dir)
            if (supports_parallel_build) {
                build_args.push('--parallel')
                build_args.push(`${jobs}`)
            }
            build_args.push('--config')
            build_args.push(build_type || 'Release')
            if (cur_build_target) {
                build_args.push('--target')
                for (const split_build_target of cur_build_target.split(' ').filter((input) => input !== '')) {
                    build_args.push(split_build_target)
                }
            }
            core.info(`💻 ${source_dir}> ${cmake_path} ${makeArgsString(build_args)}`)
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cmake_path}"`, build_args, {
                cwd: source_dir,
                ignoreReturnCode: true
            })
            if (create_annotations) {
                createCMakeBuildAnnotations(stdout, inputs)
            }
            if (exitCode !== 0) {
                throw new Error(`CMake build failed with exit code ${exitCode}`)
            }
        }
    }
    core.endGroup()

    // ==============================================
    // Test step
    // ==============================================
    if (run_tests !== false) {
        core.startGroup(`🧪 Test`)
        const tests_cxxstd = test_all_cxxstd ? cxxstds : [main_cxxstd]
        for (const cur_cxxstd of tests_cxxstd) {
            core.info(`🧪 Tests (${make_factor_description(cur_cxxstd)})`)
            const std_build_dir = make_build_dir(cur_cxxstd)

            /*
                Test parameters
             */
            let test_args = ['--test-dir', std_build_dir]
            if (supports_parallel_build) {
                test_args.push('--parallel')
                test_args.push(`${jobs}`)
            }
            test_args.push('--build-config')
            test_args.push(build_type || 'Release')
            if (run_tests === true) {
                test_args.push('--no-tests=error')
            } else {
                test_args.push('--no-tests=ignore')
            }
            test_args.push('--progress')
            test_args.push('--output-on-failure')

            /*
                Run
             */
            core.info(`💻 ${source_dir}> ${ctest_path} ${makeArgsString(test_args)}`)
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${ctest_path}"`, test_args, {
                cwd: source_dir,
                ignoreReturnCode: true
            })
            if (create_annotations) {
                createCMakeTestAnnotations(stdout, inputs)
            }
            if (exitCode !== 0 && run_tests === true) {
                throw new Error(`CMake tests failed with exit code ${exitCode}`)
            }
        }
        core.endGroup()
    }

    // ==============================================
    // Install step
    // ==============================================
    if (install !== false) {
        core.startGroup(`🚚 Install`)
        const install_cxxstd = install_all_cxxstd ? cxxstds : [main_cxxstd]
        for (const cur_cxxstd of install_cxxstd) {
            core.info(`🚚 Install (${make_factor_description(cur_cxxstd)})`)
            const std_build_dir = make_build_dir(cur_cxxstd)
            const std_install_dir = make_install_prefix(cur_cxxstd)

            // Ensure install_dir exists
            await io.mkdirP(std_install_dir)

            /*
                Install parameters
             */
            let install_args = []
            if (supports_cmake_install) {
                install_args.push('--install')
            } else {
                install_args.push('--build')
            }
            install_args.push(std_build_dir)
            install_args.push('--config')
            install_args.push(build_type || 'Release')
            if (supports_cmake_install) {
                if (install_prefix) {
                    install_args.push('--prefix')
                    install_args.push(std_install_dir)
                }
            } else {
                install_args.push('--target')
                install_args.push('install')
            }

            /*
                Run
             */
            core.info(`💻 ${source_dir}> ${cmake_path} ${makeArgsString(install_args)}`)
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cmake_path}"`, install_args, {
                cwd: source_dir,
                ignoreReturnCode: true
            })
            if (exitCode !== 0 && install === true) {
                throw new Error(`CMake install failed with exit code ${exitCode}`)
            }
        }
        core.endGroup()
    }

    // ==============================================
    // Package step
    // ==============================================
    if (do_package) {
        core.startGroup(`📦 Package`)

        /*
            Determine cpack generators
         */
        let use_default_generators = false
        if (package_generators.length === 0) {
            fnlog(`No package generators specified. Using available generators.`)
            // Run something equivalent to
            // generators=$("${{ steps.params.outputs.cpack_path }}" --help | awk '/Generators/ {flag=1; next} flag && NF {print $1}' ORS=';' | sed 's/;$//')
            // to find the line where the list of generators starts, and then
            // get each generator from the following lines until a blank line.
            // The output of each of these lines is something like:
            //   7Z                           = 7-Zip file format
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cpack_path}"`, ['--help'], {
                silent: true,
                ignoreReturnCode: true
            })
            let available_generators = []
            let collecting_generators = false
            for (const line of stdout.split(/\r?\n/)) {
                if (!collecting_generators) {
                    collecting_generators = line.trim() === 'Generators'
                } else {
                    if (line.trim() === '') {
                        break
                    }
                    const parts = line.split('=')
                    if (parts.length !== 2) {
                        break
                    }
                    available_generators.push(parts[0].trim())
                }
            }
            core.info(`🔄 Available CPack generators: ${available_generators.join(';')}`)
            package_generators = available_generators
            use_default_generators = true
        } else {
            fnlog(`Using specified package generators: ${package_generators.join(';')}`)
        }

        const package_cxxstd = package_all_cxxstd ? cxxstds : [main_cxxstd]
        let package_files = []
        for (const cur_cxxstd of package_cxxstd) {
            core.info(`📦 Package (${make_factor_description(cur_cxxstd)})`)
            const std_build_dir = make_build_dir(cur_cxxstd)
            // const std_install_dir = make_install_prefix(cur_cxxstd)

            for (const package_generator of package_generators) {
                core.info(`⚙️ Generating package with generator "${package_generator}"`)
                let cpack_args = ['-G', package_generator]
                cpack_args.push('-C')
                cpack_args.push(build_type || 'Release')
                if (trace_commands) {
                    cpack_args.push('--verbose')
                }
                if (package_name) {
                    cpack_args.push('-P')
                    cpack_args.push(package_name)
                }
                if (package_dir) {
                    cpack_args.push('-B')
                    cpack_args.push(make_package_dir(cur_cxxstd))
                }
                if (package_vendor) {
                    cpack_args.push('--vendor')
                    cpack_args.push(package_vendor)
                }
                /*
                    Run
                 */
                core.info(`💻 ${std_build_dir}> ${cpack_path} ${makeArgsString(cpack_args)}`)
                const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${cpack_path}"`, cpack_args, {
                    cwd: std_build_dir,
                    ignoreReturnCode: true
                })
                if (exitCode !== 0) {
                    fnlog(`package: ${do_package}`)
                    fnlog(`use_default_generators: ${use_default_generators}`)
                    const msg = `CPack (generator: ${package_generator}) failed with exit code ${exitCode}`
                    if (!use_default_generators) {
                        throw new Error(msg)
                    } else {
                        // If we are using the default generators, then we
                        // can ignore the failure and continue with the
                        // next generator because the generator hasn't been
                        // explicitly specified by the user.
                        fnlog(msg)
                        continue
                    }
                }

                // Find package file from the command output
                const lines = stdout.split(/\r?\n/)
                const regex = /^\s*CPack: - package: (.*) generated\.$/
                for (const line of lines) {
                    const match = line.match(regex)
                    if (match) {
                        const packagePath = match[1]
                        core.info(`✅ Generated package: ${packagePath}`)
                        package_files.push(packagePath)
                        break
                    }
                }
            }
        }
        core.endGroup()

        if (package_files.length !== 0 && package_artifact) {
            core.startGroup(`⬆️ Upload package artifacts`)
            /*
                Generate artifacts
             */
            core.info(`📦 Package files: ${package_files.join(',')}`)

            // Determine the common prefix of the basenamse of these files
            // to use as the artifact
            let common_prefix = ''
            for (const package_file of package_files) {
                if (common_prefix === '') {
                    common_prefix = package_file
                } else {
                    let i = 0
                    for (; i < common_prefix.length && i < package_file.length; i++) {
                        if (common_prefix[i] !== package_file[i]) {
                            break
                        }
                    }
                    common_prefix = common_prefix.substring(0, i)
                }
            }
            fnlog(`Common package prefix: ${common_prefix}`)

            // Create a name for the artifact with all packages
            let artifact_name = path.basename(common_prefix) + '-'
            // Check if platform OS is Ubuntu
            if (artifact_name === 'linux' && fs.existsSync('/etc/os-release')) {
                const os_release = fs.readFileSync('/etc/os-release', 'utf8')
                if (os_release.includes('Ubuntu')) {
                    // Get ubuntu version
                    let ubuntu_version = undefined
                    const regex = /VERSION_ID="(.*)"/
                    const match = os_release.match(regex)
                    if (match) {
                        ubuntu_version = match[1]
                    }
                    if (!ubuntu_version) {
                        // Rely on lsb_release -rs
                        const {exitCode: exitCode, stdout} = await exec.getExecOutput('lsb_release', ['-rs'], {
                            ignoreReturnCode: true
                        })
                        if (exitCode === 0) {
                            artifact_name += stdout.trim()
                        }
                    }
                    if (!ubuntu_version) {
                        // Extract Ubuntu version from /etc/lsb-release
                        const lsb_release = fs.readFileSync('/etc/lsb-release', 'utf8')
                        const regex = /DISTRIB_RELEASE=(.*)/
                        const match = lsb_release.match(regex)
                        if (match) {
                            ubuntu_version = match[1].trim()
                        }
                    }
                    if (!ubuntu_version) {
                        // Extract Ubuntu version from uname -a
                        const {exitCode: exitCode, stdout} = await exec.getExecOutput('uname', ['-a'], {
                            ignoreReturnCode: true
                        })
                        if (exitCode === 0) {
                            const regex = /Ubuntu (.*)/
                            const match = stdout.match(regex)
                            if (match) {
                                ubuntu_version = match[1].trim()
                            }
                        }
                    }
                    if (ubuntu_version) {
                        artifact_name += '-ubuntu-' + ubuntu_version
                    }
                }
            } else {
                artifact_name += '-' + (process.env['RUNNER_OS'] || process.platform).toLowerCase()
            }

            // Add compiler to artifact name
            if (!cxx && artifact_name === 'windows') {
                artifact_name += '-msvc'
            } else if (cxx) {
                const cxx_basename = path.basename(cxx)
                if (cxx_basename.startsWith('clang')) {
                    if (artifact_name !== 'windows') {
                        artifact_name += '-clang'
                    } else {
                        artifact_name += '-clang-cl'
                    }
                } else if (cxx_basename.startsWith('gcc') || cxx_basename.startsWith('g++')) {
                    if (artifact_name !== 'windows') {
                        artifact_name += '-gcc'
                    } else {
                        artifact_name += '-mingw'
                    }
                } else if (cxx_basename.startsWith('cl')) {
                    artifact_name += '-msvc'
                }
            }
            artifact_name += '-packages'
            fnlog(`Artifact name: ${artifact_name}`)
            fnlog(`Retention days: ${package_retention_days}`)
            const packages_dir = path.dirname(common_prefix)
            fnlog(`Packages directory: ${packages_dir}`)
            const {id, size} = await actions_artifact.create().uploadArtifact(
                artifact_name,
                package_files,
                packages_dir,
                {retentionDays: package_retention_days}
            )
            log(`Created artifact with id: ${id} (bytes: ${size}`)
            core.endGroup()
        }
    }
}

function toBooleanInput(input) {
    if (typeof input === 'boolean') {
        return input
    }
    if (input === undefined || input === null) {
        return undefined
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

function toIntegerInput(input) {
    const parsedInt = parseInt(input)
    if (isNaN(parsedInt)) {
        return undefined
    } else {
        return parsedInt
    }
}

function parseExtraArgsEntry(extra_args) {
    // The extra_args input is a multiline string. Each element in the array
    // is a line in the string. We need to split each line into arguments
    // and then join them into a single array. It's not as simple as splitting
    // on spaces because arguments can be quoted.
    let args = []
    for (const line of extra_args) {
        // Split on spaces, but not spaces inside quotes
        const regex = /(?:[^\s"]+|"[^"]*")+/g
        let match
        while (match = regex.exec(line)) {
            args.push(match[0].trim())
        }
    }
    // Sanitize arguments: cmake often includes arguments of the form
    // "VAR=value" or "VAR="value"". The second form is invalid when
    // converting to an array because any tool will attempt to include extra
    // quotes when it sees a space. The internal quotes are not necessary
    // because external quotes can already handle the problem.
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        const regex = /^([^=]+)="([^)]*)"$/
        const match = arg.match(regex)
        if (match) {
            args[i] = `${match[1]}=${match[2]}`
        }
    }
    return args
}

function parseExtraArgs(extra_args) {
    function fnlog(msg) {
        log('parseExtraArgs: ' + msg)
    }

    // Extra args is a multiline string. It can be parsed as either
    // a single line representing the arguments or as a map of arguments.
    // When a map is provided, the workflow will be run for each
    // key-value pair in the map.

    function getLineKeyValue(line) {
        // Check if the line has a key-value pair or if it's just
        // more args. The key is any identifier followed by ":".
        const regex = /^([^:]+):(.*)$/
        const match = line.match(regex)
        if (!match) {
            return undefined
        }
        const key = match[1].trim()
        const keyIsQuoted =
            (key.startsWith('"') && key.endsWith('"')) ||
            (key.startsWith('\'') && key.endsWith('\''))
        if (keyIsQuoted) {
            return {key: key.substring(1, key.length - 1), value: match[2]}
        }
        const keyIsInvalid = key.trim().includes(' ')
        if (keyIsInvalid) {
            return undefined
        }
        return {key: key, value: match[2]}
    }

    const first_line = extra_args[0]
    let res = getLineKeyValue(first_line)
    if (!res) {
        // Parse all lines as a single line of cmake args
        fnlog('Parsing all lines as a single line of cmake args')
        return parseExtraArgsEntry(extra_args)
    } else {
        // Parse lines as a map of key-value pairs where each value
        // is one factor we have to test.
        fnlog('Parsing lines as a map of key-value pairs')
        let extraArgsMap = {}
        extraArgsMap[res.key] = [res.value]
        curKey = res.key
        for (let i = 1; i < extra_args.length; i++) {
            const line = extra_args[i]
            res = getLineKeyValue(line)
            if (!res) {
                // Continuation of the previous key
                extraArgsMap[curKey].push(line)
            }
            extraArgsMap[res.key] = [res.value]
        }
        fnlog(`Parsed extra args map: ${JSON.stringify(extraArgsMap)}`)
        // Parse each value in the map as a single line of cmake args
        for (const key in extraArgsMap) {
            extraArgsMap[key] = parseExtraArgsEntry(extraArgsMap[key])
        }
        fnlog(`Parsed extra args map: ${JSON.stringify(extraArgsMap)}`)
        return extraArgsMap
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
        log('cmake-workflow: ' + msg)
    }

    try {
        let inputs = {
            // CMake
            cmake_path: core.getInput('cmake-path') || 'cmake',
            cmake_version: core.getInput('cmake-version') || '*',
            // Configure options
            source_dir: normalizePath(core.getInput('source-dir')),
            build_dir: normalizePath(core.getInput('build-dir')),
            cc: normalizePath(core.getInput('cc') || process.env['CC'] || ''),
            ccflags: core.getInput('ccflags') || process.env['CFLAGS'] || '',
            cxx: normalizePath(core.getInput('cxx') || process.env['CXX'] || ''),
            cxxflags: core.getInput('cxxflags') || process.env['CXXFLAGS'] || '',
            cxxstd: (core.getInput('cxxstd') || process.env['CXXSTD'] || '').split(/[,; ]/).filter((input) => input !== ''),
            shared: toBooleanInput(core.getInput('shared') || process.env['BUILD_SHARED_LIBS'] || ''),
            toolchain: normalizePath(core.getInput('toolchain') || process.env['CMAKE_TOOLCHAIN_FILE'] || ''),
            generator: core.getInput('generator') || process.env['CMAKE_GENERATOR'] || '',
            generator_toolset: core.getInput('generator-toolset') || process.env['CMAKE_GENERATOR_TOOLSET'] || '',
            build_type: core.getInput('build-type') || process.env['CMAKE_BUILD_TYPE'] || 'Release',
            build_target: (core.getInput('build-target') || '').split(/[,; ]/).filter((input) => input !== ''),
            extra_args: parseExtraArgs(core.getMultilineInput('extra-args')) || '',
            export_compile_commands: toBooleanInput(core.getInput('export-compile-commands') || process.env['CMAKE_EXPORT_COMPILE_COMMANDS'] || ''),
            // Build options
            jobs: toIntegerInput(core.getInput('jobs') || process.env['CMAKE_JOBS']) || numberOfCpus(),
            // Test options
            run_tests: toBooleanInput(core.getInput('run-tests') || process.env['CMAKE_RUN_TESTS'] || ''),
            configure_tests_flag: core.getInput('configure-tests-flag') || '',
            test_all_cxxstd: core.getBooleanInput('test-all-cxxstd'),
            // Install
            install: toBooleanInput(core.getInput('install') || process.env['CMAKE_INSTALL'] || ''),
            install_all_cxxstd: core.getBooleanInput('install-all-cxxstd'),
            install_prefix: normalizePath(core.getInput('install-prefix') || process.env['CMAKE_INSTALL_PREFIX'] || ''),
            // Package
            package: toBooleanInput(core.getInput('package') || process.env['CMAKE_PACKAGE'] || ''),
            package_all_cxxstd: core.getBooleanInput('package-all-cxxstd'),
            package_name: core.getInput('package-name') || '',
            package_dir: normalizePath(core.getInput('package-dir')),
            package_vendor: core.getInput('package-vendor') || '',
            package_generators: (core.getInput('package-generators') || process.env['CPACK_GENERATOR'] || '').split(/[,; ]/).filter((input) => input !== ''),
            package_artifact: toBooleanInput(core.getInput('package-artifact') || process.env['CMAKE_PACKAGE_ARTIFACT'] || 'true'),
            package_retention_days: toIntegerInput(core.getInput('package-retention-days')) || 10,
            // Annotations and tracing
            create_annotations: toBooleanInput(core.getInput('create-annotations') || process.env['CMAKE_CREATE_ANNOTATIONS'] || 'true'),
            ref_source_dir: normalizePath(path.resolve(core.getInput('ref-source-dir') || process.env['GITHUB_WORKSPACE'] || '')),
            trace_commands: core.getBooleanInput('trace-commands')
        }

        // Resolve paths
        inputs.source_dir = path.resolve(inputs.source_dir)
        inputs.build_dir = path.resolve(inputs.source_dir, inputs.build_dir)
        if (inputs.install_prefix) {
            inputs.install_prefix = path.resolve(inputs.install_prefix)
        }
        if (inputs.package_dir) {
            inputs.package_dir = path.resolve(inputs.build_dir, inputs.package_dir)
        }
        if (process.env['ACTIONS_STEP_DEBUG'] === 'true') {
            // Force trace-commands
            inputs.trace_commands = true
            trace_commands = true
        }
        trace_commands = inputs.trace_commands
        set_trace_commands(trace_commands)
        setup_cmake.set_trace_commands(trace_commands)

        core.startGroup('📥 Workflow Inputs')
        fnlog(`🧩 cmake-workflow.trace_commands: ${trace_commands}`)
        fnlog(`🧩 setup-cmake.trace_commands: ${setup_cmake.trace_commands}`)
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${value ? JSON.stringify(value) : '<empty>'}`)
        }
        core.endGroup()

        if (Array.isArray(inputs.extra_args)) {
            await main(inputs)
        } else {
            // Run workflow for each key-value pair in the extra_args map
            let isFirst = true
            for (const key in inputs.extra_args) {
                core.startGroup(`🧩 Running workflow "${key}"`)
                const value = inputs.extra_args[key]
                const new_inputs = Object.assign({}, inputs)
                new_inputs.extra_args = value
                fnlog(`Running workflow for key "${key}" with args "${value}"`)
                if (!isFirst) {
                    const safeKey = key
                        .replace(/[^a-zA-Z0-9_-]/g, '_')
                        .replace(/_+/g, '_')
                    const old_build_dir = new_inputs.build_dir
                    new_inputs.build_dir = path.join(old_build_dir, safeKey)
                    fnlog(`build_dir: ${old_build_dir} -> ${new_inputs.build_dir}`)
                    const old_install_prefix = new_inputs.install_prefix
                    new_inputs.install_prefix = path.join(old_install_prefix, safeKey)
                    fnlog(`install_prefix: ${old_install_prefix} -> ${new_inputs.install_prefix}`)
                    const old_package_dir = new_inputs.package_dir
                    new_inputs.package_dir = path.join(old_package_dir, safeKey)
                    fnlog(`package_dir: ${old_package_dir} -> ${new_inputs.package_dir}`)
                }
                new_inputs.extra_args_key = key
                await main(new_inputs)
                isFirst = false
                core.endGroup()
            }
        }
    } catch (error) {
        fnlog(error.stack)
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(error)
    })
}

module.exports = {
    trace_commands,
    set_trace_commands,
    main
}
