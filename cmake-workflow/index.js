const core = require('@actions/core')
const actions_artifact = require('@actions/artifact')
const fs = require('fs')
const setup_cmake = require('setup-cmake')
const setup_program = require('setup-program')
const path = require('path')
const exec = require('@actions/exec')
const io = require('@actions/io')
const os = require('os')

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
        const match = line.match(boostTestRegex)
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

function readAndValidatePresetFile(presetPath, supportedPresetsVersion) {
    let exists = false
    let supported = false
    let presetJson = {}

    const presetPathExists = fs.existsSync(presetPath)
    const presetPathIsFile = fs.statSync(presetPath).isFile()
    if (!presetPathExists || !presetPathIsFile) {
        core.info(`Preset file not found: ${presetPath}`)
        return {exists, supported, presetJson}
    }
    exists = true
    const presetFileContents = fs.readFileSync(presetPath, 'utf8')
    try {
        presetJson = JSON.parse(presetFileContents)
    } catch (error) {
        log(`Failed to parse preset file: ${error}`)
        return {exists, supported, presetJson}
    }
    if (typeof presetJson !== 'object') {
        log(`Preset file is not an object`)
        return {exists, supported, presetJson}
    }
    if (!('version' in presetJson)) {
        log(`Preset file does not have a 'version' field`)
        return {exists, supported, presetJson}
    }
    if (typeof presetJson['version'] !== 'number') {
        log(`Preset file 'version' field is not a number`)
        return {exists, supported, presetJson}
    }
    const presetVersion = presetJson['version']
    if (presetVersion > supportedPresetsVersion) {
        log(`Preset file version ${presetVersion} is greater than the maximum supported version ${supportedPresetsVersion}`)
        return {exists, supported, presetJson}
    }
    // The preset file is supported
    supported = true
    return {exists, supported, presetJson}
}

function mergeCMakePresetObject(presetJson, userPresetJson) {
    if (!userPresetJson) {
        return presetJson
    }
    const merged = {...presetJson}
    for (const key in userPresetJson) {
        if (!presetJson.hasOwnProperty(key)) {
            merged[key] = userPresetJson[key]
        } else {
            const presetValue = presetJson[key]
            const userValue = userPresetJson[key]
            if (typeof presetValue === 'number' && typeof userValue === 'number') {
                merged[key] = Math.max(presetValue, userValue)
            } else if (Array.isArray(presetValue) && Array.isArray(userValue)) {
                merged[key] = presetValue.concat(userValue)
            } else if (typeof presetValue === 'object' && typeof userValue === 'object') {
                merged[key] = mergeCMakePresetObject(presetValue, userValue)
            } else {
                merged[key] = userValue !== undefined ? userValue : presetValue
            }
        }
    }
    return merged
}

function mergeCMakeConfigurePresetObject(presetJson, basePreset) {
    if (!basePreset) {
        return presetJson
    }
    // Merge two configure presets
    // The presetJson inherits all fields from basePreset
    let merged = {...presetJson}
    for (const key in basePreset) {
        if (!presetJson.hasOwnProperty(key)) {
            if (key === 'hidden') {
                // "hidden is not inherited"
                continue
            }
            // If a field is only present in basePreset, it is inherited
            merged[key] = basePreset[key]
            continue
        }
        // If a field is present in both, the value from presetJson is used,
        // but we still merge values for objects and arrays
        const presetValue = presetJson[key]
        const baseValue = basePreset[key]
        if (Array.isArray(presetValue) && Array.isArray(baseValue)) {
            // If both contain the key and are arrays, concatenate them
            merged[key] = presetValue.concat(baseValue)
        } else if (Array.isArray(presetValue) && typeof baseValue === 'string') {
            // If both contain the key and are arrays, concatenate them
            merged[key] = presetValue.concat([baseValue])
        } else if (typeof presetValue === 'string' && Array.isArray(baseValue)) {
            // If both contain the key and are arrays, concatenate them
            merged[key] = [presetValue].concat(baseValue)
        } else if (typeof presetValue === 'object' && typeof baseValue === 'object') {
            // If both contain the key and are objects, merge them, giving
            // priority to keys in presetJson
            let mergedValue = {...presetValue}
            for (const subKey in baseValue) {
                if (!presetValue.hasOwnProperty(subKey)) {
                    mergedValue[subKey] = baseValue[subKey]
                }
            }
            merged[key] = mergedValue
        }
        // If we got here, the value is a primitive type (string, number, boolean),
        // so in this case, the value from presetJson is used
    }
    return merged
}

function cacheVariableValueToArgsString(value) {
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE'
    }
    if (typeof value === 'string') {
        return value
    }
    if (typeof value === 'object') {
        // type and value
        if (!('type' in value) || !('value' in value)) {
            return undefined
        }
        return cacheVariableValueToArgsString(value['value'])
    }
    return undefined
}

function makeCacheVariablesArgsArray(cacheVariables) {
    let cacheVariablesArray = []
    for (const keyValue of cacheVariables) {
        const key = keyValue[0]
        const value = cacheVariableValueToArgsString(keyValue[1])
        if (value) {
            cacheVariablesArray.push(`-D`)
            cacheVariablesArray.push(`${key}=${value}`)
        }
    }
    return cacheVariablesArray
}

function resolvePreset(inputs, setupCMakeOutputs) {
    if (!inputs.preset) {
        return
    }
    const presetPath = path.resolve(inputs.source_dir, 'CMakePresets.json')
    const {
        exists,
        supported,
        presetJson
    } = readAndValidatePresetFile(presetPath, setupCMakeOutputs.supported_presets_version)

    const userPresetPath = path.resolve(inputs.source_dir, 'CMakeUserPresets.json')
    const {
        exists: userExists,
        supported: userSupported,
        presetJson: userPresetJson
    } = readAndValidatePresetFile(userPresetPath, setupCMakeOutputs.supported_presets_version)

    if (exists && supported && (!userExists || userSupported)) {
        // Everything OK. User built-in support for presets
        return
    }

    // Apply preset manually:
    // Check if at least the main preset file exists
    if (!exists) {
        log(`Preset file not found: ${presetPath}`)
        return
    }

    const mergedPresetJson =
        userExists ?
            mergeCMakePresetObject(presetJson, userPresetJson) :
            presetJson

    // Function to get a configuration preset from a preset json
    // The preset is in configurePresets and is identified by the name field
    function getPreset(presetName, presetJson) {
        const presets = presetJson['configurePresets']
        for (const preset of presets) {
            if (preset['name'] === presetName) {
                return preset
            }
        }
        return undefined
    }

    // Find the main preset
    let mainPreset = getPreset(inputs.preset, mergedPresetJson)
    if (!mainPreset) {
        log(`Preset ${inputs.preset} not found`)
        return
    }
    if (mainPreset['inherits'] && !Array.isArray(mainPreset['inherits']) && typeof mainPreset['inherits'] !== 'string') {
        log(`Preset ${inputs.preset} has an invalid inherits field`)
        return
    }
    if (mainPreset['inherits'] && typeof mainPreset['inherits'] === 'string') {
        mainPreset['inherits'] = [mainPreset['inherits']]
    }

    // Preset becomes an empty string and we don't use it in the command line
    // because the current cmake version doens't support presets
    inputs.preset = ''

    // Apply any inheritance
    // While the main preset has an "inherits" field, keep applying inheritance
    // until there is no more inheritance to apply. The field can be a string
    // or an array of strings.
    let inheritedPresetNames = []
    while (mainPreset['inherits']) {
        const inherits = [...mainPreset['inherits']]
        for (const inherit of inherits) {
            if (inheritedPresetNames.includes(inherit)) {
                log(`Inherited preset ${inherit} already inherited`)
                continue
            }
            const inheritedPreset = getPreset(inherit, mergedPresetJson)
            if (!inheritedPreset) {
                log(`Inherited preset ${inherit} not found`)
                continue
            }
            mainPreset = mergeCMakeConfigurePresetObject(mainPreset, inheritedPreset)
            inheritedPresetNames.push(inherit)
        }
        // Remove the already inherited objects from the array
        for (const inherit of inherits) {
            const index = mainPreset['inherits'].indexOf(inherit)
            if (index !== -1) {
                mainPreset['inherits'].splice(index, 1)
            }
        }
    }

    // Apply the preset values to inputs with precedence to the user's inputs
    inputs.generator = inputs.generator || mainPreset['generator'] || ''
    inputs.build_dir = inputs.build_dir || mainPreset['binaryDir'] || ''
    inputs.toolchain = inputs.toolchain || mainPreset['toolchainFile'] || ''
    inputs.generator_toolset = inputs.generator_toolset || mainPreset['toolset'] || ''
    inputs.generator_architecture = inputs.generator_architecture || mainPreset['architecture'] || ''
    inputs.toolchain = inputs.toolchain || mainPreset['toolchainFile'] || ''
    inputs.install_prefix = inputs.install_prefix || mainPreset['installDir'] || ''
    inputs.cmake_path = inputs.cmake_path || mainPreset['cmakeExecutable'] || ''
    if ('cacheVariables' in mainPreset) {
        const cacheVariablesArgsArray = makeCacheVariablesArgsArray(mainPreset['cacheVariables'])
        inputs.extra_args = inputs.extra_args.concat(cacheVariablesArgsArray)
    }
    if ('environment' in mainPreset) {
        const environment = mainPreset['environment']
        for (const key in environment) {
            if (environment[key] !== null) {
                process.env[key] = environment[key]
            }
        }
    }
    if ('warnings' in mainPreset) {
        const warningsObj = mainPreset['warnings']
        for (const warning of warningsObj) {
            const value = warningsObj[warning]
            if (typeof value !== 'boolean') {
                continue
            }
            if (warning === 'dev') {
                if (value) {
                    inputs.extra_args.push('-Wdev')
                } else {
                    inputs.extra_args.push('-Wno-dev')
                }
            } else if (warning === 'deprecated') {
                if (value) {
                    inputs.extra_args.push('-Wdeprecated')
                } else {
                    inputs.extra_args.push('-Wno-deprecated')
                }
            } else if (warning === 'uninitialized') {
                if (value) {
                    inputs.extra_args.push('--warn-uninitialized')
                }
            } else if (warning === 'unusedCli') {
                if (!value) {
                    inputs.extra_args.push('--no-warn-unused-cli')
                }
            } else if (warning === 'systemVars') {
                if (value) {
                    inputs.extra_args.push('--check-system-vars')
                }
            }
        }
    }
    if ('errors' in mainPreset) {
        const errorsObj = mainPreset['errors']
        for (const error of errorsObj) {
            const value = errorsObj[error]
            if (typeof value !== 'boolean') {
                continue
            }
            if (error === 'dev') {
                if (value) {
                    inputs.extra_args.push('-Werror=dev')
                } else {
                    inputs.extra_args.push('-Wno-error=dev')
                }
            } else if (error === 'deprecated') {
                if (value) {
                    inputs.extra_args.push('-Werror=deprecated')
                } else {
                    inputs.extra_args.push('-Wno-error=deprecated')
                }
            }
        }
    }
    if ('debug' in mainPreset) {
        const debug = mainPreset['debug']
        for (const key in debug) {
            const value = debug[key]
            if (typeof value !== 'boolean') {
                continue
            }
            if (key === 'output') {
                if (value) {
                    inputs.extra_args.push('--debug-output')
                }
            } else if (key === 'tryCompile') {
                if (value) {
                    inputs.extra_args.push('--debug-trycompile')
                }
            } else if (key === 'find') {
                if (value) {
                    inputs.extra_args.push('--debug-find')
                }
            }
        }
    }
    if ('trace' in mainPreset) {
        const trace = mainPreset['trace']
        for (const key in trace) {
            const value = trace[key]
            if (key === 'output') {
                if (typeof value !== 'string') {
                    continue
                }
                if (value === 'on') {
                    inputs.extra_args.push('--trace')
                } else if (value === 'expand') {
                    inputs.extra_args.push('--trace-expand')
                }
            } else if (key === 'format') {
                if (typeof value !== 'string') {
                    continue
                }
                inputs.extra_args.push(`--trace-format=${value}`)
            } else if (key === 'source') {
                if (!Array.isArray(value) && typeof value !== 'string') {
                    continue
                }
                const sources = Array.isArray(value) ? value : [value]
                for (const source of sources) {
                    const escapedSource = source.replace(/"/g, '\\"')
                    inputs.extra_args.push(`--trace-source="${escapedSource}"`)
                }
            } else if (key === 'redirect') {
                if (typeof value !== 'string') {
                    continue
                }
                const escapedValue = value.replace(/"/g, '\\"')
                inputs.extra_args.push(`--trace-redirect="${escapedValue}"`)
            }
        }
    }
}

async function setupDefaultGenerator(inputs) {
    function fnlog(msg) {
        log('setupDefaultGenerator: ' + msg)
    }

    // Execute and get the output of:
    fnlog(`Identifying default generator`)
    // "$cmake_path" --system-information | sed -n 's/^CMAKE_GENERATOR [[:space:]]*"\([^"]*\)".*/\1/p')
    const {
        exitCode: exitCode,
        stdout
    } = await exec.getExecOutput(`"${inputs.cmake_path}"`, ['--system-information'], {
        silent: true,
        ignoreReturnCode: true
    })
    let match
    if (exitCode === 0) {
        // Find the first line in stdout that describes the default 'CMAKE_GENERATOR'
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
        inputs.generator = match[1]
    } else {
        fnlog(`Could not identify default generator. Inferring default generator from OS.`)
        if (process.platform === 'win32') {
            inputs.generator = 'Visual Studio'
        } else {
            inputs.generator = 'Unix Makefiles'
        }
    }
    fnlog(`Default generator: ${inputs.generator}`)
}

async function resolveInputParameters(inputs, setupCMakeOutputs) {
    function fnlog(msg) {
        log('resolveInputParameters: ' + msg)
    }

    // ----------------------------------------------
    // Identify and apply preset to input args
    // ----------------------------------------------
    resolvePreset(inputs, setupCMakeOutputs)

    // ----------------------------------------------
    // Set default values
    // ----------------------------------------------
    if (!inputs.preset) {
        // We don't set these when there's a preset because
        // it might be defined there
        inputs.build_type = inputs.build_type || 'Release'
        inputs.build_dir = inputs.build_dir || 'build'
    }
    inputs.cmake_path = setupCMakeOutputs.path || 'cmake'

    // ----------------------------------------------
    // Identify generator features
    // ----------------------------------------------
    if (!inputs.generator && !inputs.preset) {
        await setupDefaultGenerator(inputs)
    }
    let generator_is_multi_config = false
    if (inputs.generator) {
        generator_is_multi_config = inputs.generator.startsWith('Visual Studio') || ['Ninja Multi-Config', 'Xcode'].includes(inputs.generator)
        core.info(`🔄 Generator "${inputs.generator}" ${generator_is_multi_config ? 'IS' : 'is NOT'} multi-config`)
    }

    // ----------------------------------------------
    // Identify complete compiler paths
    // ----------------------------------------------
    const ctest_path = path.join(setupCMakeOutputs.dir, 'ctest')
    core.info(`🧩 ctest_path: ${ctest_path}`)
    const cpack_path = path.join(setupCMakeOutputs.dir, 'cpack')
    core.info(`🧩 cpack_path: ${cpack_path}`)
    if (inputs.cc && path.basename(inputs.cc) === inputs.cc) {
        try {
            inputs.cc = await io.which(inputs.cc)
        } catch (error) {
            fnlog(`Could not find ${inputs.cc} in PATH`)
        }
    }
    core.info(`🧩 cc: ${inputs.cc}`)
    if (inputs.cxx && path.basename(inputs.cxx) === inputs.cxx) {
        try {
            inputs.cxx = await io.which(inputs.cxx)
        } catch (error) {
            fnlog(`Could not find ${inputs.cxx} in PATH`)
        }
    }
    core.info(`🧩 cxx: ${inputs.cxx}`)

    // ----------------------------------------------
    // Identify C++ standards to test
    // ----------------------------------------------
    if (inputs.cxxstd.length === 0) {
        // Null element represents the default compiler
        inputs.cxxstd = [null]
    }
    core.info(`🧩 cxxstd: ${inputs.cxxstd.map(element => (element === null ? '<default>' : element))}`)
    const main_cxxstd = inputs.cxxstd[inputs.cxxstd.length - 1]
    core.info(`🧩 main_cxxstd: ${main_cxxstd === null ? '<default>' : main_cxxstd}`)

    // ----------------------------------------------
    // Resolve paths
    // ----------------------------------------------
    inputs.source_dir = path.resolve(applyPresetMacros(inputs.source_dir, inputs))
    if (inputs.build_dir) {
        inputs.build_dir = path.resolve(inputs.source_dir, applyPresetMacros(inputs.build_dir, inputs))
    }
    if (inputs.install_prefix) {
        inputs.install_prefix = path.resolve(applyPresetMacros(inputs.install_prefix, inputs))
    }
    if (inputs.package_dir) {
        inputs.package_dir = path.resolve(inputs.build_dir, applyPresetMacros(inputs.package_dir, inputs))
    }

    // Apply preset macros to the inputs that accept them
    inputs = applyPresetMacros(inputs, inputs)

    // ----------------------------------------------
    // Print the adjusted parameters
    // ----------------------------------------------
    fnlog(`🧩 cmake-workflow.trace_commands: ${trace_commands}`)
    fnlog(`🧩 setup-cmake.trace_commands: ${setup_cmake.trace_commands}`)
    for (const [name, value] of Object.entries(inputs)) {
        core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`)
    }

    return {
        main_cxxstd,
        generator_is_multi_config,
        ctest_path,
        cpack_path
    }
}

async function downloadUrlSourceCode(inputs) {
    if (inputs.download_dir) {
        const res = await setup_program.downloadAndExtract(inputs.url, inputs.download_dir)
        if (res === undefined) {
            throw new Error(`❌ Failed to download source code from ${inputs.url}`)
        }
    } else {
        const res = await setup_program.downloadAndExtract(inputs.url)
        if (res === undefined) {
            throw new Error(`❌ Failed to download source code from ${inputs.url}`)
        }
        inputs.download_dir = res
    }
    await setup_program.stripSingleDirectoryFromPath(inputs.download_dir)
}

async function cloneGitRepository(inputs) {
    if (!inputs.download_dir) {
        inputs.download_dir = await fs.mkdtemp(path.join(os.tmpdir(), 'source-'))
    }
    inputs.download_dir = path.resolve(inputs.download_dir)
    if (inputs.git_tag) {
        await setup_program.cloneGitRepo(inputs.git_repository, inputs.download_dir, inputs.git_tag, {shallow: true})
    } else {
        await setup_program.cloneGitRepo(inputs.git_repository, inputs.download_dir, undefined, {shallow: true})
    }
}

async function downloadSourceCode(inputs) {
    if (!inputs.download_dir) {
        inputs.download_dir = inputs.source_dir
    }
    if (inputs.url) {
        await downloadUrlSourceCode(inputs)
    } else {
        await cloneGitRepository(inputs)
    }
}

async function applyPatches(inputs) {
    function fnlog(msg) {
        log('applyPatches: ' + msg)
    }

    if (!inputs.patches) {
        return
    }
    for (const patch of inputs.patches) {
        const patchPath = path.resolve(patch)
        if (!fs.existsSync(patchPath)) {
            fnlog(`Patch file not found: ${patchPath}`)
            continue
        }
        const isDir = fs.statSync(patchPath).isDirectory()
        if (isDir) {
            // Copy all files from the directory to the source directory
            const files = fs.readdirSync(patchPath)
            for (const file of files) {
                const filePath = path.resolve(patchPath, file)
                const destPath = path.resolve(inputs.source_dir, file)
                core.info(`Copying ${filePath} to ${destPath}`)
                await io.cp(filePath, destPath, {recursive: true})
            }
        } else {
            const filePath = path.resolve(patch)
            const destPath = path.resolve(inputs.source_dir, path.basename(patch))
            core.info(`Copying ${filePath} to ${destPath}`)
            await io.cp(filePath, destPath)
        }
    }
}

async function main(inputs) {
    function fnlog(msg) {
        log('cmake-workflow: ' + msg)
    }

    // ----------------------------------------------
    // Download the source code
    // ----------------------------------------------
    if (inputs.url || inputs.git_repository) {
        core.startGroup(`🌎 Download source code`)
        await downloadSourceCode(inputs)
        core.endGroup()
    }

    // ----------------------------------------------
    // Apply patches
    // ----------------------------------------------
    if (inputs.patches.length > 0) {
        core.startGroup(`🩹 Apply patches`)
        await applyPatches(inputs)
        core.endGroup()
    }

    // ----------------------------------------------
    // Look for CMake versions
    // ----------------------------------------------
    core.startGroup(`🔎 Setup CMake`)
    const setupCMakeOutputs = await setup_cmake.main({
        trace_commands: trace_commands,
        version: inputs.cmake_version,
        cmake_file: path.resolve(inputs.source_dir, 'CMakeLists.txt'),
        path: inputs.cmake_path,
        cmake_path: 'cmake',
        cache: false,
        check_latest: false,
        update_environment: false
    }, false)
    if (!setupCMakeOutputs.path) {
        throw new Error('❌ CMake not found')
    }
    inputs.cmake_path = setupCMakeOutputs.path
    core.endGroup()

    core.startGroup(`🎛️ CMake parameters`)
    const {
        main_cxxstd,
        generator_is_multi_config,
        ctest_path,
        cpack_path
    } = await resolveInputParameters(inputs, setupCMakeOutputs)
    core.endGroup()

    // ----------------------------------------------
    // Configure steps
    // ----------------------------------------------
    function make_build_dir(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? inputs.build_dir : (inputs.build_dir + '-' + cur_cxxstd)
    }

    function make_install_prefix(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? inputs.install_prefix : (inputs.install_prefix + '-' + cur_cxxstd)
    }

    function make_package_dir(cur_cxxstd) {
        return (!cur_cxxstd || cur_cxxstd === main_cxxstd) ? inputs.package_dir : (inputs.package_dir + '-' + cur_cxxstd)
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
    for (const cur_cxxstd of inputs.cxxstd) {
        core.info(`⚙️ Configure (${make_factor_description(cur_cxxstd)})`)
        const std_build_dir = make_build_dir(cur_cxxstd)

        let configure_args = []
        /*
            Build parameters
         */
        if (setupCMakeOutputs.supports_path_to_build) {
            // If this can't be set directly, then we need to change the
            // working directory when running the command
            configure_args.push('-S')
            configure_args.push(inputs.source_dir)
            configure_args.push('-B')
            configure_args.push(std_build_dir)
        }
        if (inputs.preset) {
            configure_args.push(`--preset=${inputs.preset}`)
        }
        if (inputs.generator) {
            configure_args.push('-G')
            configure_args.push(inputs.generator)
        }
        if (inputs.generator_toolset) {
            configure_args.push('-T')
            configure_args.push(inputs.generator_toolset)
        }
        if (inputs.generator_architecture) {
            configure_args.push('-A')
            configure_args.push(inputs.generator_architecture)
        }
        if (inputs.cxxflags.includes('/m32') && inputs.generator.startsWith('Visual Studio')) {
            // In Visual Studio, the -A option is used to specify the architecture,
            // and it needs to be set explicitly
            configure_args.push('-A', 'Win32')
            // Remove /m32 from cxxflags
            inputs.cxxflags = inputs.cxxflags
                .split(' ').filter((input) => input !== '')
                .filter((input) => input !== '/m32')
                .join(' ')
            inputs.ccflags = inputs.ccflags
                .split(' ').filter((input) => input !== '')
                .filter((input) => input !== '/m32')
                .join(' ')
        }
        if (inputs.build_type) {
            if (!generator_is_multi_config) {
                configure_args.push('-D')
                configure_args.push(`CMAKE_BUILD_TYPE=${inputs.build_type}`)
            } else {
                configure_args.push('-D')
                configure_args.push(`CMAKE_CONFIGURATION_TYPES=${inputs.build_type}`)
            }
        }
        if (inputs.toolchain) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_TOOLCHAIN_FILE=${inputs.toolchain}`)
        }
        if (inputs.run_tests !== undefined && inputs.configure_tests_flag) {
            configure_args.push('-D')
            if (inputs.configure_tests_flag.includes('=')) {
                configure_args.push(inputs.configure_tests_flag)
            } else {
                configure_args.push(`${inputs.configure_tests_flag}=${inputs.run_tests ? 'ON' : 'OFF'}`)
            }
        }
        if (inputs.shared) {
            configure_args.push('-D')
            configure_args.push('BUILD_SHARED_LIBS=ON')
        }
        if (inputs.cc) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_C_COMPILER=${inputs.cc}`)
        }
        if (inputs.ccflags) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_C_FLAGS=${inputs.ccflags}`)
        }
        if (inputs.cxx) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_COMPILER=${inputs.cxx}`)
        }
        if (inputs.cxxflags) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_FLAGS=${inputs.cxxflags}`)
        }
        if (cur_cxxstd) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_CXX_STANDARD=${cur_cxxstd}`)
        }
        if (inputs.export_compile_commands === true) {
            configure_args.push('-D')
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=ON')
        } else if (inputs.export_compile_commands === false) {
            configure_args.push('-D')
            configure_args.push('CMAKE_EXPORT_COMPILE_COMMANDS=OFF')
        }
        configure_args.push('--no-warn-unused-cli')

        /*
            Install and package parameters
         */
        if (inputs.install_prefix) {
            configure_args.push('-D')
            configure_args.push(`CMAKE_INSTALL_PREFIX=${make_install_prefix(cur_cxxstd)}`)
        }
        if (inputs.package_name.length > 0) {
            configure_args.push('-D')
            configure_args.push(`CPACK_GENERATOR=${inputs.package_generators.join(';')}`)
        }
        if (inputs.package_name) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_NAME=${inputs.package_name}`)
        }
        if (inputs.package_dir) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_DIRECTORY=${inputs.package_dir}`)
        }
        if (inputs.package_vendor) {
            configure_args.push('-D')
            configure_args.push(`CPACK_PACKAGE_VENDOR=${inputs.package_vendor}`)
        }

        /*
            Extra arguments
         */
        fnlog(`Extra arguments: ${JSON.stringify(inputs.extra_args)}`)
        for (const extra_arg of inputs.extra_args) {
            configure_args.push(extra_arg)
        }
        if (!setupCMakeOutputs.supports_path_to_build) {
            // If CMake doesn't support the -S and -B options, then we will
            // need to change the working directory when running the command
            // and set the source directory as the last argument
            configure_args.push(`${inputs.source_dir}`)
        }

        /*
            Prepare build directory
         */
        // Ensure build_dir exists
        const cmd_dir = setupCMakeOutputs.supports_path_to_build ? inputs.source_dir : std_build_dir
        if (!setupCMakeOutputs.supports_path_to_build) {
            await io.mkdirP(std_build_dir)
        }
        core.info(`💻 ${std_build_dir}> ${inputs.cmake_path} ${makeArgsString(configure_args)}`)
        const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${inputs.cmake_path}"`, configure_args, {
            cwd: cmd_dir,
            ignoreReturnCode: true
        })
        if (inputs.create_annotations) {
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
    if (inputs.build_target.length === 0) {
        // null represents the default target
        inputs.build_target = [null]
    } else if (setupCMakeOutputs.supports_build_multiple_targets && inputs.build_target.length > 1) {
        // If multiple targets are specified, then we can only build them
        // all at once if the generator supports it. The targets
        // need to be space separated.
        inputs.build_target = [inputs.build_target.join(' ')]
    }
    for (const cur_cxxstd of inputs.cxxstd) {
        core.info(`🛠️ Build (${make_factor_description(cur_cxxstd)})`)
        const std_build_dir = make_build_dir(cur_cxxstd)

        /*
            Build parameters
         */
        for (const cur_build_target of inputs.build_target) {
            let build_args = ['--build']
            build_args.push(std_build_dir)
            if (setupCMakeOutputs.supports_parallel_build) {
                build_args.push('--parallel')
                build_args.push(`${inputs.jobs}`)
            }
            if (inputs.build_type) {
                build_args.push('--config')
                build_args.push(inputs.build_type || 'Release')
            }
            if (cur_build_target) {
                build_args.push('--target')
                for (const split_build_target of cur_build_target.split(' ').filter((input) => input !== '')) {
                    build_args.push(split_build_target)
                }
            }
            core.info(`💻 ${inputs.source_dir}> ${inputs.cmake_path} ${makeArgsString(build_args)}`)
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${inputs.cmake_path}"`, build_args, {
                cwd: inputs.source_dir,
                ignoreReturnCode: true
            })
            if (inputs.create_annotations) {
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
    if (inputs.run_tests !== false) {
        core.startGroup(`🧪 Test`)
        const tests_cxxstd = inputs.test_all_cxxstd ? inputs.cxxstd : [main_cxxstd]
        for (const cur_cxxstd of tests_cxxstd) {
            core.info(`🧪 Tests (${make_factor_description(cur_cxxstd)})`)
            const std_build_dir = make_build_dir(cur_cxxstd)

            /*
                Test parameters
             */
            let test_args = ['--test-dir', std_build_dir]
            if (setupCMakeOutputs.supports_parallel_build) {
                test_args.push('--parallel')
                test_args.push(`${inputs.jobs}`)
            }
            if (inputs.build_type) {
                test_args.push('--build-config')
                test_args.push(inputs.build_type || 'Release')
            }
            if (inputs.run_tests === true) {
                test_args.push('--no-tests=error')
            } else {
                test_args.push('--no-tests=ignore')
            }
            test_args.push('--progress')
            test_args.push('--output-on-failure')

            /*
                Run
             */
            core.info(`💻 ${inputs.source_dir}> ${ctest_path} ${makeArgsString(test_args)}`)
            const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${ctest_path}"`, test_args, {
                cwd: inputs.source_dir,
                ignoreReturnCode: true
            })
            if (inputs.create_annotations) {
                createCMakeTestAnnotations(stdout, inputs)
            }
            if (exitCode !== 0 && inputs.run_tests === true) {
                throw new Error(`CMake tests failed with exit code ${exitCode}`)
            }
        }
        core.endGroup()
    }

    // ==============================================
    // Install step
    // ==============================================
    if (inputs.install !== false) {
        core.startGroup(`🚚 Install`)
        const install_cxxstd = inputs.install_all_cxxstd ? inputs.cxxstd : [main_cxxstd]
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
            if (setupCMakeOutputs.supports_cmake_install) {
                install_args.push('--install')
            } else {
                install_args.push('--build')
            }
            install_args.push(std_build_dir)
            if (inputs.build_type) {
                install_args.push('--config')
                install_args.push(inputs.build_type || 'Release')
            }
            if (setupCMakeOutputs.supports_cmake_install) {
                if (inputs.install_prefix) {
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
            core.info(`💻 ${inputs.source_dir}> ${inputs.cmake_path} ${makeArgsString(install_args)}`)
            const {exitCode: exitCode} = await exec.getExecOutput(`"${inputs.cmake_path}"`, install_args, {
                cwd: inputs.source_dir,
                ignoreReturnCode: true
            })
            if (exitCode !== 0 && inputs.install === true) {
                throw new Error(`CMake install failed with exit code ${exitCode}`)
            }
        }
        core.endGroup()
    }

    // ==============================================
    // Package step
    // ==============================================
    if (inputs.package) {
        core.startGroup(`📦 Package`)

        /*
            Determine cpack generators
         */
        let use_default_generators = false
        if (inputs.package_generators.length === 0) {
            fnlog(`No package generators specified. Using available generators.`)
            // Run something equivalent to
            // generators=$("${{ steps.params.outputs.cpack_path }}" --help | awk '/Generators/ {flag=1; next} flag && NF {print $1}' ORS=';' | sed 's/;$//')
            // to find the line where the list of generators starts, and then
            // get each generator from the following lines until a blank line.
            // The output of each of these lines is something like:
            //   7Z                           = 7-Zip file format
            const {stdout} = await exec.getExecOutput(`"${cpack_path}"`, ['--help'], {
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
            inputs.package_generators = available_generators
            use_default_generators = true
        } else {
            fnlog(`Using specified package generators: ${inputs.package_generators.join(';')}`)
        }

        const package_cxxstd = inputs.package_all_cxxstd ? inputs.cxxstd : [main_cxxstd]
        let package_files = []
        for (const cur_cxxstd of package_cxxstd) {
            core.info(`📦 Package (${make_factor_description(cur_cxxstd)})`)
            const std_build_dir = make_build_dir(cur_cxxstd)
            // const std_install_dir = make_install_prefix(cur_cxxstd)

            for (const package_generator of inputs.package_generators) {
                core.info(`⚙️ Generating package with generator "${package_generator}"`)
                let cpack_args = ['-G', package_generator]
                if (inputs.build_type) {
                    cpack_args.push('-C')
                    cpack_args.push(inputs.build_type || 'Release')
                }
                if (trace_commands) {
                    cpack_args.push('--verbose')
                }
                if (inputs.package_name) {
                    cpack_args.push('-P')
                    cpack_args.push(inputs.package_name)
                }
                if (inputs.package_dir) {
                    cpack_args.push('-B')
                    cpack_args.push(make_package_dir(cur_cxxstd))
                }
                if (inputs.package_vendor) {
                    cpack_args.push('--vendor')
                    cpack_args.push(inputs.package_vendor)
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
                    fnlog(`package: ${inputs.package}`)
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

        if (package_files.length !== 0 && inputs.package_artifact) {
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
                        // Extract the Ubuntu version from /etc/lsb-release
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
            if (!inputs.cxx && artifact_name === 'windows') {
                artifact_name += '-msvc'
            } else if (inputs.cxx) {
                const cxx_basename = path.basename(inputs.cxx)
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
            fnlog(`Retention days: ${inputs.package_retention_days}`)
            const packages_dir = path.dirname(common_prefix)
            fnlog(`Packages directory: ${packages_dir}`)
            const {id, size} = await actions_artifact.create().uploadArtifact(
                artifact_name,
                package_files,
                packages_dir,
                {retentionDays: inputs.package_retention_days}
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

    function extractIdentifier(i, line, char, curArg) {
        const nextChar = i < line.length - 1 ? line[i + 1] : undefined
        if (nextChar && nextChar.match(/^[a-zA-Z_]/)) {
            let identifier = nextChar
            let j = i + 2
            for (; j < line.length; j++) {
                const idChar = line[j]
                // check if idChar is alphanum or underscore
                if (idChar.match(/^[a-zA-Z0-9_]/)) {
                    identifier += char
                } else {
                    break
                }
            }
            // Replace $ with the value of the environment variable
            // if it exists
            const envValue = process.env[identifier]
            if (envValue) {
                curArg += envValue
            }
            // Advance i to the last character of the identifier
            i = j - 1
        } else {
            // No valid identifier after $. Just output $.
            curArg += char
        }
        return {i, curArg}
    }

    let args = []
    for (const line of extra_args) {
        let curQuote = undefined
        let curArg = ''
        for (let i = 0; i < line.length; i++) {
            const char = line[i]
            const inQuote = curQuote !== undefined
            const curIsQuote = ['"', '\''].includes(char)
            const curIsEscaped = i > 0 && line[i - 1] === '\\'
            if (!inQuote) {
                if (!curIsEscaped) {
                    if (curIsQuote) {
                        curQuote = char
                    } else if (char === ' ') {
                        if (curArg !== '') {
                            args.push(curArg)
                            curArg = ''
                        }
                    } else if (char === '$') {
                        const __ret = extractIdentifier(i, line, char, curArg)
                        i = __ret.i
                        curArg = __ret.curArg
                    } else if (char !== '\\') {
                        curArg += char
                    }
                } else {
                    curArg += char
                }
            } else if (curQuote === '"') {
                // Preserve the literal value of all characters except for
                // ($), (`), ("), (\), and the (!) character
                if (!curIsEscaped) {
                    if (char === curQuote) {
                        curQuote = undefined
                    } else if (char === '$') {
                        const __ret = extractIdentifier(i, line, char, curArg)
                        i = __ret.i
                        curArg = __ret.curArg
                    } else if (char !== '\\') {
                        curArg += char
                    }
                } else {
                    if (!['$', '`', '"', '\\'].includes(char)) {
                        curArg += '\\'
                    }
                    curArg += char
                }
            } else if (curQuote === '\'') {
                // Preserve the literal value of each character within the
                // quotes
                if (char !== curQuote) {
                    curArg += char
                } else {
                    curQuote = undefined
                }
            }
        }
        if (curArg !== '') {
            args.push(curArg)
            curArg = ''
        }
    }
    return args
}

function parseExtraArgs(extra_args) {
    function fnlog(msg) {
        log('parseExtraArgs: ' + msg)
    }

    if (extra_args.length === 0) {
        return []
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
        const curKey = res.key
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

function normalizePath(inputPath) {
    const pathIsString = typeof inputPath === 'string' || inputPath instanceof String
    if (pathIsString && pathIsString && process.platform === 'win32') {
        inputPath = inputPath.replace(/\\/g, '/')
    }
    return inputPath
}

// function ensureAbsolute(inputPath) {
//     const pathIsString = typeof inputPath === 'string' || inputPath instanceof String
//     if (pathIsString) {
//         if (!path.isAbsolute(inputPath)) {
//             inputPath = path.resolve(process.cwd(), inputPath)
//         }
//     }
//     return inputPath
// }

function applyPresetMacros(value, allInputs) {
    // The action allows preset macros to be used in the input.
    // Macros are recognized in the form $<macro-namespace>{<macro-name>}
    // Most placeholders are allowed:
    // - ${sourceDir}: The source directory
    // - ${sourceParentDir}: The parent directory of the source directory
    // - ${sourceDirName}: The name of the source directory
    // - ${presetName}: The name of the preset
    // - ${generator}: The CMake generator
    // - ${hostSystemName}: Only Linux, Windows, and Darwin are supported
    // - ${dollar}: The dollar sign ($)
    // - ${pathListSep}: The path list separator (; on Windows, : on other systems)
    // - $env{<variable-name>}: The value of the environment variable
    // - $penv{<variable-name>}: The value of the environment variable
    if (typeof value === 'string' || value instanceof String) {
        return value.replace(/\${sourceDir}/g, allInputs.source_dir)
            .replace(/\${sourceParentDir}/g, path.dirname(allInputs.source_dir))
            .replace(/\${sourceDirName}/g, path.basename(allInputs.source_dir))
            .replace(/\${presetName}/g, allInputs.preset)
            .replace(/\${generator}/g, allInputs.generator)
            .replace(/\${hostSystemName}/g, process.platform === 'win32' ? 'Windows' : (process.platform === 'darwin' ? 'Darwin' : 'Linux'))
            .replace(/\${dollar}/g, '$')
            .replace(/\${pathListSep}/g, process.platform === 'win32' ? ';' : ':')
            .replace(/\$env{([^}]+)}/g, (_, name) => process.env[name] || '')
            .replace(/\$penv{([^}]+)}/g, (_, name) => process.env[name] || '')
    } else if (Array.isArray(value)) {
        return value.map((element) => applyPresetMacros(element, allInputs))
    } else if (typeof value === 'object') {
        let result = {}
        for (const key in value) {
            result[key] = applyPresetMacros(value[key], allInputs)
        }
        return result
    } else {
        return value
    }
}

async function run() {
    function fnlog(msg) {
        log('cmake-workflow: ' + msg)
    }

    try {
        let inputs = {
            // CMake
            cmake_path: core.getInput('cmake-path') || '',
            cmake_version: core.getInput('cmake-version') || '*',
            // Source project
            source_dir: normalizePath(core.getInput('source-dir')),
            url: core.getInput('url') || '',
            git_repository: core.getInput('git-repository') || '',
            git_tag: core.getInput('git-tag') || '',
            download_dir: normalizePath(core.getInput('download-dir')),
            patches: core.getMultilineInput('patches') || [],
            // Configure options
            build_dir: normalizePath(core.getInput('build-dir')),
            preset: core.getInput('preset') || '',
            cc: normalizePath(core.getInput('cc') || process.env['CC'] || ''),
            ccflags: core.getInput('ccflags') || process.env['CFLAGS'] || '',
            cxx: normalizePath(core.getInput('cxx') || process.env['CXX'] || ''),
            cxxflags: core.getInput('cxxflags') || process.env['CXXFLAGS'] || '',
            cxxstd: (core.getInput('cxxstd') || process.env['CXXSTD'] || '').split(/[,; ]/).filter((input) => input !== ''),
            shared: toBooleanInput(core.getInput('shared') || process.env['BUILD_SHARED_LIBS'] || ''),
            toolchain: normalizePath(core.getInput('toolchain') || process.env['CMAKE_TOOLCHAIN_FILE'] || ''),
            generator: core.getInput('generator') || process.env['CMAKE_GENERATOR'] || '',
            generator_toolset: core.getInput('generator-toolset') || process.env['CMAKE_GENERATOR_TOOLSET'] || '',
            generator_architecture: core.getInput('generator-architecture') || process.env['CMAKE_GENERATOR_ARCHITECTURE'] || '',
            build_type: core.getInput('build-type') || process.env['CMAKE_BUILD_TYPE'] || '',
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

        if (process.env['ACTIONS_STEP_DEBUG'] === 'true') {
            // Force trace-commands
            inputs.trace_commands = true
            trace_commands = true
        }
        trace_commands = inputs.trace_commands
        set_trace_commands(trace_commands)
        setup_cmake.set_trace_commands(trace_commands)
        setup_program.set_trace_commands(trace_commands)

        core.startGroup('📥 Workflow Inputs')
        fnlog(`🧩 cmake-workflow.trace_commands: ${trace_commands}`)
        fnlog(`🧩 setup-cmake.trace_commands: ${setup_cmake.trace_commands}`)
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`)
        }
        core.endGroup()

        const singleExtraArgs = Array.isArray(inputs.extra_args)
        if (singleExtraArgs) {
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
                    // Create custom build/install/package dirs for each
                    // extra key-value pair in the extra_args map
                    const safeKey = key
                        .replace(/[^a-zA-Z0-9_-]/g, '_')
                        .replace(/_+/g, '_')
                    const old_build_dir = new_inputs.build_dir || 'build'
                    new_inputs.build_dir = path.join(old_build_dir, safeKey)
                    fnlog(`build_dir: ${old_build_dir} -> ${new_inputs.build_dir}`)
                    const old_install_prefix = new_inputs.install_prefix || 'install'
                    new_inputs.install_prefix = path.join(old_install_prefix, safeKey)
                    fnlog(`install_prefix: ${old_install_prefix} -> ${new_inputs.install_prefix}`)
                    const old_package_dir = new_inputs.package_dir || 'package'
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
        core.setFailed(`${error.message}\n${error.stack}`)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(`${error.message}\n${error.stack}`)
    })
}

module.exports = {
    trace_commands,
    set_trace_commands,
    parseExtraArgsEntry,
    main
}
