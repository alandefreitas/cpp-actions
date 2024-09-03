const core = require('@actions/core')
const tc = require('@actions/tool-cache')
const semver = require('semver')
const fs = require('fs')
const setup_program = require('setup-program')
const path = require('path')
const trace_commands = require("trace-commands")

function findCMakeVersionsImpl() {
    let cachedVersions = null // Cache variable to store the versions

    return async function() {
        function fnlog(msg) {
            trace_commands.log('findCMakeVersions: ' + msg)
        }

        if (cachedVersions !== null) {
            // Return the cached versions if available
            return cachedVersions
        }

        // Check if the versions can be read from a file
        const versionsFromFile = setup_program.readVersionsFromFile('cmake-versions.txt')
        if (versionsFromFile !== null) {
            cachedVersions = versionsFromFile
            fnlog('CMake versions (from file): ' + versionsFromFile)
            return versionsFromFile
        }

        // regex='^v([0-9]+\.[0-9]+\.[0-9]+)$'
        const regex = /^refs\/tags\/v(\d+\.\d+\.\d+)$/
        let versions = []
        try {
            const gitTags = await setup_program.fetchGitTags('https://github.com/Kitware/CMake.git')
            for (const tag of gitTags) {
                if (tag.match(regex)) {
                    const version = tag.match(regex)[1]
                    versions.push(version)
                }
            }
            versions = versions.sort(semver.compare)
            cachedVersions = versions
            setup_program.saveVersionsToFile(versions, 'cmake-versions.txt')
            return versions
        } catch (error) {
            fnlog('Error fetching CMake versions: ' + error)
            return []
        }
    }
}

const findCMakeVersions = findCMakeVersionsImpl()

function updateCMakeVersionFromFile(cmake_file, version, allVersions) {
    function fnlog(msg) {
        trace_commands.log('updateCMakeVersionFromFile: ' + msg)
    }

    if (!cmake_file) {
        fnlog('No CMake file specified')
        return version
    }

    // Check if cmake_file exists
    let cmake_file_path = path.resolve(process.cwd(), cmake_file)
    fnlog(`cmake_file: ${cmake_file} resolved to ${cmake_file_path}`)
    if (!fs.existsSync(cmake_file_path)) {
        fnlog(`CMake file ${cmake_file_path} does not exist`)
        return version
    }

    if (fs.lstatSync(cmake_file_path).isDirectory()) {
        fnlog(`CMake file ${cmake_file_path} is a directory`)
        cmake_file_path = path.join(cmake_file_path, 'CMakeLists.txt')
        if (!fs.existsSync(cmake_file_path)) {
            fnlog(`CMake file ${cmake_file_path} also does not exist`)
            return version
        }
        return updateCMakeVersionFromFile(cmake_file_path, version, allVersions)
    }

    // Read cmake_file
    fnlog(`Reading Cmake file ${cmake_file_path}`)
    const cmake_file_content = fs.readFileSync(cmake_file_path, 'utf8')

    // Extract requirement from CMakeLists.txt
    // cmake_minimum_required(VERSION <min>[...<policy_max>] [FATAL_ERROR])
    const regex = /\s*cmake_minimum_required\(VERSION\s+(\d+(\.\d+)?)(?:\s*\.\.\.\s*(\d+(\.\d+)?))?\s*(?:FATAL_ERROR)?\)/
    let cmake_file_requirement
    const match = cmake_file_content.match(regex)
    if (match) {
        fnlog(`Matched: ${match[0]}`)
        cmake_file_requirement = match[1]
        fnlog(`CMake file requirement: ${cmake_file_requirement}`)
    }

    if (!cmake_file_requirement) {
        fnlog(`Could not find CMake file requirement in ${cmake_file_path}`)
        fnlog(`File contents: ${cmake_file_content}`)
        return version
    }

    // Merge version requirements
    try {
        const semverSV = semver.coerce(cmake_file_requirement)
        if (semverSV !== null) {
            cmake_file_requirement = '>=' + semverSV.toString()
            fnlog(`Coerced cMake file requirement: ${cmake_file_requirement}`)
            if (!version || version === '*') {
                version = cmake_file_requirement
            } else if (semver.intersects(version, cmake_file_requirement)) {
                // If ranges don't intersect, `version` has priority
                // If the intersect, then we need to merge the ranges
                let matchingVersions = allVersions
                    .filter((v) =>
                        semver.satisfies(v, cmake_file_requirement) && semver.satisfies(v, version))
                fnlog(`Matching versions: ${matchingVersions}`)
                if (!matchingVersions) {
                    fnlog(`No matching versions for ${cmake_file_requirement} and ${version}`)
                    fnlog(`Setting version requirement to ${version}`)
                    return version
                } else {
                    // Create a range string from the matching versions
                    const mergedRange = matchingVersions.join(' || ')
                    version = semver.simplifyRange(allVersions, mergedRange)
                    fnlog(`Merged version requirement to ${version}`)
                }
            }
        }
    } catch (error) {
        fnlog(`Error parsing CMake file requirement ${cmake_file_requirement} as semver string: ${error}`)
    }

    return version
}

function generateCMakeURL(version, architecture, fnlog) {
    const versionSV = semver.parse(version)
    const {major, minor} = versionSV

    // Determine path to download
    const system_os = (process.env['RUNNER_OS'] || process.platform).toLowerCase()
    let url_os = system_os
    // Put it in the same format as the GitHub Actions runner
    if (url_os === 'darwin') {
        url_os = 'macos'
    } else if (url_os === 'win32') {
        url_os = 'windows'
    } else {
        url_os = 'linux'
    }

    let url_arch = (architecture || process.env['RUNNER_ARCH'] || process.arch).toLowerCase()
    // Put it in the same format as the GitHub Actions runner (X86, X64, ARM, or ARM64)
    if (url_arch === 'ia32') {
        url_arch = 'x86'
    }

    // CMake 3.19.0 and below use a different URL format for OS
    if (semver.lte(version, '3.19.0')) {
        if (url_os === 'windows') {
            if (url_arch === 'x86') {
                url_os = 'win32'
            } else {
                url_os = 'win64'
            }
        } else if (url_os === 'linux') {
            url_os = 'Linux'
        } else if (url_os === 'macos' && semver.lte(version, '3.18.2')) {
            url_os = 'Darwin'
        }
    }

    // Arch URL format depends on OS
    if (url_os === 'windows') {
        url_arch = url_arch.startsWith('arm') ? 'arm64' : 'x86_64'
    } else if (url_os === 'win32') {
        url_arch = 'x86'
    } else if (url_os === 'win64') {
        url_arch = 'x64'
    } else if (url_os.toLowerCase() === 'linux') {
        url_arch = url_arch.startsWith('arm') ? 'aarch64' : 'x86_64'
    } else if (url_os === 'macos') {
        url_arch = 'universal'
    }

    // Form complete URL
    const url_extension = (system_os === 'windows') ? 'zip' : 'tar.gz'
    const cmake_basename = `cmake-${version}-${url_os}-${url_arch}`
    const cmake_filename = `${cmake_basename}.${url_extension}`
    const cmake_url = `https://cmake.org/files/v${major}.${minor}/${cmake_filename}`
    fnlog(`CMake URL: ${cmake_url}`)
    return cmake_url
}

async function main(inputs, subgroups = true) {
    function fnlog(msg) {
        trace_commands.log('setup-cmake: ' + msg)
    }

    let {
        version,
        architecture,
        cmake_file,
        path: inputPath,
        cache,
        check_latest,
        update_environment
    } = inputs

    // ----------------------------------------------
    // Look for CMake versions
    // ----------------------------------------------
    if (subgroups) {
        core.startGroup('🌐 Find CMake versions')
    }
    const allVersions = await findCMakeVersions()
    fnlog('All CMake versions: ' + allVersions)
    if (subgroups) {
        core.endGroup()
    }

    // ----------------------------------------------
    // Identify requirements
    // ----------------------------------------------
    if (subgroups) {
        core.startGroup('📋 Identify requirements')
    }
    version = semver.simplifyRange(allVersions, version)
    if (!version) {
        version = '*'
    }
    version = updateCMakeVersionFromFile(cmake_file, version, allVersions)
    if (subgroups) {
        core.endGroup()
    }

    // ----------------------------------------------
    // Adjust hostedtoolcache directory
    // ----------------------------------------------
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache'
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY']
    }

    let output_path
    let output_version

    // ----------------------------------------------
    // Look for path CMake
    // ----------------------------------------------
    let execPaths = inputPath.split(/[:;]/).filter((inputPath) => inputPath !== '')
    if (execPaths.length !== 0) {
        if (subgroups) {
            core.startGroup(`📂 Look for CMake in ${inputPath}`)
        }

        // Setup from provided path
        core.info(`Searching for CMake ${version} in path${execPaths.length === 1 ? '' : 's'} [${execPaths.join(',')}]`)
        let __ret = await setup_program.find_program_in_path(execPaths, version, check_latest)
        if (__ret.output_version && __ret.output_path) {
            core.info(`✅ Found CMake ${__ret.output_version} in ${__ret.output_path}`)
        }
        output_version = __ret.output_version
        output_path = __ret.output_path
        if (subgroups) {
            core.endGroup()
        }
    }

    // ----------------------------------------------
    // Look for system CMake
    // ----------------------------------------------
    if (output_path === null) {
        if (subgroups) {
            core.startGroup('📦 Look for system CMake')
        }
        core.info(`Searching for CMake ${version} in PATH`)

        // Check environment variable $CMAKE_ROOT and include both $CMAKE_ROOT
        // and $CMAKE_ROOT/bin in paths. This action will also define CMAKE_ROOT
        // if CMAKE_ROOT ends up being downloaded from a URL in a previous step.
        let extraPaths = []
        if (process.env['CMAKE_ROOT']?.trim()) {
            const cmake_root = process.env['CMAKE_ROOT']
            if (!extraPaths.includes(cmake_root)) {
                extraPaths.push(cmake_root)
            }
            if (!extraPaths.includes(path.join(cmake_root, 'bin'))) {
                extraPaths.push(path.join(cmake_root, 'bin'))
            }
        }

        // Include all versions potentially cached with tc
        const tc_paths = tc.findAllVersions('CMake')
        for (const tc_path of tc_paths) {
            if (!extraPaths.includes(tc_path)) {
                extraPaths.push(tc_path)
            }
        }

        const __ret = await setup_program.find_program_in_system_paths(extraPaths, ['cmake'], version, check_latest)
        if (__ret.output_path && __ret.output_version) {
            core.info(`✅ Found CMake ${__ret.output_version} in ${__ret.output_path}`)
        }
        output_version = __ret.output_version
        output_path = __ret.output_path
        if (subgroups) {
            core.endGroup()
        }
    }

    // ----------------------------------------------
    // Download CMake
    // ----------------------------------------------
    if (!output_version) {
        if (subgroups) {
            core.startGroup('⬇️ Download CMake')
        }
        version = inputs.check_latest ?
            semver.maxSatisfying(allVersions, version) :
            semver.minSatisfying(allVersions, version)
        version = semver.coerce(version).toString()

        core.info(`Downloading CMake ${version}`)
        const cmake_url = generateCMakeURL(version, architecture, fnlog)
        const __ret = await setup_program.install_program_from_url(['cmake'], version, check_latest, cmake_url, update_environment)
        if (__ret.output_version && __ret.output_path) {
            core.info(`✅ Installed CMake ${__ret.output_version} to ${__ret.output_path}`)
        }
        output_version = __ret.output_version
        output_path = __ret.output_path
        if (subgroups) {
            core.endGroup()
        }
    }

    if (subgroups) {
        core.startGroup('📤 Return outputs')
    }
    if (!output_path) {
        core.error(`❌ Could not find or install CMake ${version}`)
        fnlog(`output_version: ${output_version}`)
        fnlog(`output_path: ${output_path}`)
        return {}
    }

    inputPath = output_path
    version = output_version
    const versionSV = semver.coerce(version)
    fnlog(`Found CMake ${version} in ${inputPath}`)
    if (subgroups) {
        core.endGroup()
    }

    const max_supported_presets_version =
        semver.gte(versionSV, '3.25.3') ? 6 :
            semver.gte(versionSV, '3.24.4') ? 5 :
                semver.gte(versionSV, '3.23.5') ? 4 :
                    semver.gte(versionSV, '3.21.7') ? 3 :
                        semver.gte(versionSV, '3.20.6') ? 2 :
                            semver.gte(versionSV, '3.19.8') ? 1 : 0

    // Create outputs
    return {
        path: inputPath,
        dir: path.dirname(inputPath),
        version: versionSV.toString(),
        version_major: versionSV.major,
        version_minor: versionSV.minor,
        version_patch: versionSV.patch,
        // Cache is always disabled because it's not needed
        cache_hit: false,
        supports_path_to_build: semver.gte(versionSV, '3.13.0'),
        supports_parallel_build: semver.gte(versionSV, '3.12.0'),
        supports_build_multiple_targets: semver.gte(versionSV, '3.15.0'),
        supports_cmake_install: semver.gte(versionSV, '3.15.0'),
        supported_presets_version: max_supported_presets_version
    }
}

async function run() {
    function fnlog(msg) {
        trace_commands.log('setup-cmake: ' + msg)
    }

    try {
        const inputs = {
            trace_commands: core.getBooleanInput('trace-commands'),
            version: core.getInput('version') || '*',
            architecture: core.getInput('architecture'),
            cmake_file: core.getInput('cmake-file'),
            path: core.getInput('path'),
            cmake_path: core.getInput('cmake-path'),
            cache: core.getBooleanInput('cache'),
            check_latest: core.getBooleanInput('check-latest'),
            update_environment: core.getBooleanInput('update-environment')
        }

        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        for (const [name, value] of Object.entries(inputs)) {
            fnlog(`${name}: ${value}`)
        }

        if (inputs.cmake_path) {
            inputs.path = inputs.cmake_path
        }

        try {
            const outputs = await main(inputs)
            // Parse Final program / Setup version / Outputs
            if (outputs['path']) {
                core.startGroup('📥 Set outputs')
                for (const [name, value] of Object.entries(outputs)) {
                    const yaml_key = name.replaceAll('_', '-')
                    core.setOutput(yaml_key, value)
                    fnlog(`${yaml_key}: ${value}`)
                }
                core.endGroup()
            } else {
                core.setFailed('Cannot setup CMake')
            }
        } catch (error) {
            // Print stack trace
            fnlog(error.stack)
            core.setFailed(error)
        }
    } catch (error) {
        fnlog(error.stack)
        core.setFailed(error)
    }
}

if (require.main === module) {
    run().catch((error) => {
        core.setFailed(error)
    })
}

module.exports = {
    main
}