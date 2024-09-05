const core = require('@actions/core')
const io = require('@actions/io')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const httpm = require('@actions/http-client')
const setup_program = require('setup-program')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')

function removeGCCPrefix(version) {
    // Remove "gcc-" or "g++-" prefix
    if (version.startsWith('gcc-') || version.startsWith('g++-')) {
        version = version.replace('gcc-', '').replace('g++-', '')
    }

    // Remove "gcc " or "g++ " prefix
    if (version.startsWith('gcc ') || version.startsWith('g++ ')) {
        version = version.replace('gcc ', '').replace('g++ ', '')
    }

    return version
}

async function main(version, paths, check_latest, update_environment) {
    core.startGroup('Find GCC versions')
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache'
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY']
    }

    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux')
    }

    const allVersions = await setup_program.findGCCVersions()
    core.endGroup()

    // Path program version
    let output_path
    let output_version

    // Setup path program
    core.startGroup('Find GCC in specified paths')
    core.info(`Searching for GCC ${version} in paths [${paths.join(',')}]`)
    const __ret = await setup_program.find_program_in_path(paths, version, check_latest)
    output_version = __ret.output_version
    output_path = __ret.output_path
    core.endGroup()

    // Setup system program
    const names = ['g++']
    if (output_path === null) {
        core.startGroup('Find GCC in system paths')
        core.info(`Searching for GCC ${version} in PATH`)
        const __ret = await setup_program.find_program_in_system_paths(paths, names, version, check_latest)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    }

    // Setup APT program
    if (output_version === null && process.platform === 'linux') {
        core.startGroup('Find GCC with APT')
        core.info(`Searching for GCC ${version} with APT`)

        // Add APT repository
        await setup_program.find_program_with_apt(['software-properties-common'], '*', true)
        let add_apt_repository_path = null
        try {
            add_apt_repository_path = await io.which('add-apt-repository')
            trace_commands.log(`add-apt-repository found at ${add_apt_repository_path}`)
        } catch (error) {
            add_apt_repository_path = null
        }
        if (add_apt_repository_path !== null && add_apt_repository_path !== '') {
            const repo = `ppa:ubuntu-toolchain-r/ppa`
            trace_commands.log(`Adding repository "${repo}"`)
            if (setup_program.isSudoRequired()) {
                await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], {ignoreReturnCode: true})
            } else {
                await exec.exec(`add-apt-repository -y "${repo}"`, [], {ignoreReturnCode: true})
            }
        }

        const __ret = await setup_program.find_program_with_apt(names, version, check_latest)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    } else {
        if (output_version !== null) {
            trace_commands.log(`Skipping APT step because GCC ${output_version} was already found in ${output_path}`)
        } else if (process.platform !== 'linux') {
            trace_commands.log(`Skipping APT step because platform is ${process.platform}`)
        }
    }

    // Install program from a valid URL
    if (output_version === null) {
        core.startGroup('Download GCC from release binaries')
        core.info(`Fetching GCC ${version} from release binaries`)
        // Determine the release to install and version candidates to fallback to
        trace_commands.log('All GCC versions: ' + allVersions)
        const maxV = semver.maxSatisfying(allVersions, version)
        trace_commands.log(`Max version in requirement "${version}": ` + maxV)
        const minV = semver.minSatisfying(allVersions, version)
        trace_commands.log(`Min version in requirement "${version}": ` + minV)
        const release = check_latest ? maxV : minV
        trace_commands.log(`Target release ${release} (check latest: ${check_latest})`)
        const semverRelease = semver.parse(release)
        trace_commands.log(`Parsed release "${release}" is "${semverRelease.toString()}"`)
        const major = semverRelease.major
        const minor = semverRelease.minor
        const patch = semverRelease.patch
        let version_candidates = [release]
        for (const v of allVersions) {
            const sv = semver.parse(v)
            if (sv.major === major && sv.minor === minor && sv.patch !== patch) {
                version_candidates.push(v)
            }
        }
        for (const v of allVersions) {
            const sv = semver.parse(v)
            if (sv.major === major && sv.minor !== minor) {
                version_candidates.push(v)
            }
        }
        trace_commands.log(`Version candidates: [${version_candidates.join(', ')}]`)

        // Determine ubuntu version
        const cur_ubuntu_version = setup_program.getCurrentUbuntuVersion()
        trace_commands.log(`Ubuntu version: ${cur_ubuntu_version}`)
        let ubuntu_versions
        if (cur_ubuntu_version === '20.04') {
            ubuntu_versions = ['20.04', '22.04', '18.04', '16.04', '14.04', '12.04', '10.04']
        } else if (cur_ubuntu_version === '18.04') {
            ubuntu_versions = ['18.04', '20.04', '16.04', '22.04', '14.04', '12.04', '10.04']
        } else if (cur_ubuntu_version === '16.04') {
            ubuntu_versions = ['16.04', '18.04', '14.04', '20.04', '12.04', '22.04', '10.04']
        } else if (cur_ubuntu_version === '12.04') {
            ubuntu_versions = ['12.04', '14.04', '10.04', '16.04', '18.04', '20.04', '22.04']
        } else if (cur_ubuntu_version === '10.04') {
            ubuntu_versions = ['10.04', '12.04', '14.04', '16.04', '18.04', '20.04', '22.04']
        } else {
            ubuntu_versions = ['22.04', '20.04', '18.04', '16.04', '14.04', '12.04', '10.04']
        }
        trace_commands.log(`Ubuntu version binaries: [${ubuntu_versions.join(', ')}]`)

        // Try URLs considering ubuntu versions
        const http_client = new httpm.HttpClient('setup-gcc', [], {
            allowRetries: true, maxRetries: 3
        })

        for (const ubuntu_version of ubuntu_versions) {
            for (const version_candidate of version_candidates) {
                trace_commands.log(`Trying to fetch GCC ${version_candidate} for Ubuntu ${ubuntu_version}`)
                const ubuntu_image = `ubuntu-${ubuntu_version}`
                trace_commands.log(`Ubuntu image: ${ubuntu_image}`)
                const gcc_basename = `gcc-${version_candidate}-x86_64-linux-gnu-${ubuntu_image}`
                trace_commands.log(`GCC basename: ${gcc_basename}`)
                const gcc_filename = `${gcc_basename}.tar.gz`
                trace_commands.log(`GCC filename: ${gcc_filename}`)
                const gcc_url = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gcc_filename}`
                const res = await http_client.head(gcc_url)
                if (res.message.statusCode !== 200) {
                    trace_commands.log(`Skipping ${gcc_url} because it does not exist`)
                    continue
                }
                const __ret = await setup_program.install_program_from_url(['gcc'], version, check_latest, gcc_url, update_environment, '/usr/local')
                output_version = __ret.output_version
                output_path = __ret.output_path
                if (output_version !== null) {
                    break
                }
            }
            if (output_version !== null) {
                break
            }
        }

        if (output_version === null) {
            // Find a URL for binaries (no ubuntu version)
            for (const version_candidate of version_candidates) {
                trace_commands.log(`Trying to fetch GCC ${version_candidate} for Linux`)
                const gcc_basename = `gcc-${version_candidate}-Linux-x86_64`
                trace_commands.log(`GCC basename: ${gcc_basename}`)
                const gcc_filename = `${gcc_basename}.tar.gz`
                trace_commands.log(`GCC filename: ${gcc_filename}`)
                const gcc_url = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gcc_filename}`
                const res = await http_client.head(gcc_url)
                if (res.message.statusCode !== 200) {
                    trace_commands.log(`Skipping ${gcc_url} because it does not exist`)
                    continue
                }
                const __ret = await setup_program.install_program_from_url(['gcc'], version, check_latest, gcc_url, update_environment, '/usr/local')
                output_version = __ret.output_version
                output_path = __ret.output_path
                if (output_version !== null) {
                    break
                }
            }
        }
        core.endGroup()
    } else {
        if (output_version !== null) {
            trace_commands.log(`Skipping download step because GCC ${output_version} was already found in ${output_path}`)
        }
    }

    // Create outputs
    core.startGroup('Set outputs')
    let cc = output_path
    let cxx = output_path
    let bindir = ''
    let dir = ''
    let release = '0.0.0'
    let version_major = 0
    let version_minor = 0
    let version_patch = 0
    if (output_path !== null && output_path !== undefined) {
        const path_basename = path.basename(output_path)
        if (path_basename.startsWith('gcc')) {
            cxx = path.join(path.dirname(output_path), path_basename.replace('gcc', 'g++'))
        } else if (path_basename.startsWith('g++')) {
            cc = path.join(path.dirname(output_path), path_basename.replace('g++', 'gcc'))
        }

        if (!fs.existsSync(cc)) {
            trace_commands.log(`Could not find ${cc}, using ${output_path} as cc instead`)
            cc = output_path
        }

        if (!fs.existsSync(cxx)) {
            trace_commands.log(`Could not find ${cxx}, using ${output_path} as cxx instead`)
            cxx = output_path
        }

        bindir = path.dirname(output_path)
        if (update_environment) {
            core.addPath(bindir)
        }
        dir = path.dirname(bindir)

        const semverV = output_version !== null ? semver.parse(output_version, {
            includePrerelease: false, loose: true
        }) : semver.parse('0.0.0', {includePrerelease: false, loose: true})
        release = semverV.toString()
        version_major = semverV.major
        version_minor = semverV.minor
        version_patch = semverV.patch
    }
    core.endGroup()
    return {output_path, cc, cxx, bindir, dir, version: release, version_major, version_minor, version_patch}
}

async function run() {
    try {
        const inputs = {
            version: removeGCCPrefix(gh_inputs.getInput('version', {defaultValue: '*'})),
            path: gh_inputs.getArray('path', /[:;]/),
            check_latest: gh_inputs.getBoolean('check-latest'),
            update_environment: gh_inputs.getBoolean('update-environment'),
            trace_commands: gh_inputs.getBoolean('trace-commands')
        }

        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        core.startGroup('📥 Action Inputs')
        gh_inputs.printInputObject(inputs)
        core.endGroup()

        const outputs = await main(
            inputs.version,
            inputs.path,
            inputs.check_latest,
            inputs.update_environment)

        // Parse Final program / Setup version / Outputs
        if (outputs.output_path) {
            core.startGroup('📤 Action Outputs')
            gh_inputs.setOutputObject(outputs)
            core.endGroup()
        } else {
            core.setFailed('Cannot setup GCC')
        }
    } catch (error) {
        core.setFailed(`${error.message}\n${error.stack}`)
    }
}

if (require.main === module) {
    run().catch(err => {
        console.error(err)
        core.setFailed(err.message)
    })
}

module.exports = {
    main
}