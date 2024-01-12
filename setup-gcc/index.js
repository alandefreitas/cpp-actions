const core = require('@actions/core')
const io = require('@actions/io')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const httpm = require('@actions/http-client')
const setup_program = require('./../setup-program/index')
// const github = require('@actions/github')
// const tc = require('@actions/tool-cache')

setup_program.trace_commands = false
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
    setup_program.set_trace_commands(trace)
}

const fetchGitTags = async (repo) => {
    try {
        // Find git in path
        let git_path
        try {
            git_path = await io.which('git')
        } catch (error) {
            git_path = null
        }
        if (git_path === null || git_path === '') {
            if (setup_program.isSudoRequired()) {
                await exec.exec(`sudo -n apt-get update`, [], {ignoreReturnCode: true})
                await exec.exec(`sudo -n apt-get install -y git`, [], {ignoreReturnCode: true})
            } else {
                await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
                await exec.exec(`apt-get install -y git`, [], {ignoreReturnCode: true})
            }
            git_path = await io.which('git')
        }

        const {
            exitCode: exitCode, stdout: out
        } = await exec.getExecOutput(`"${git_path}" ls-remote --tags ` + repo, [], {silent: true})
        if (exitCode !== 0) {
            throw new Error('Git exited with non-zero exit code: ' + exitCode)
        }
        const stdout = out.trim()
        const tags = stdout.split('\n').filter(tag => tag.trim() !== '')
        let gitTags = []
        for (const tag of tags) {
            const parts = tag.split('\t')
            if (parts.length > 1) {
                let ref = parts[1]
                if (!ref.endsWith('^{}')) {
                    gitTags.push(ref)
                }
            }
        }
        log('Git tags: ' + gitTags)
        return gitTags
    } catch (error) {
        throw new Error('Error fetching Git tags: ' + error.message)
    }
}

function findGCCVersionsImpl() {
    let cachedVersions = null // Cache variable to store the versions

    return async function() {
        if (cachedVersions !== null) {
            // Return the cached versions if available
            return cachedVersions
        }

        // Check if the versions can be read from a file
        const versionsFromFile = setup_program.readVersionsFromFile('gcc-versions.txt')
        if (versionsFromFile !== null) {
            cachedVersions = versionsFromFile
            log('GCC versions (from file): ' + versionsFromFile)
            return versionsFromFile
        }

        const regex = /^refs\/tags\/releases\/gcc-(\d+\.\d+\.\d+)$/
        let versions = []
        try {
            const gitTags = await fetchGitTags('git://gcc.gnu.org/git/gcc.git')
            for (const tag of gitTags) {
                if (tag.match(regex)) {
                    const version = tag.match(regex)[1]
                    versions.push(version)
                }
            }
            versions = versions.sort(semver.compare)
            cachedVersions = versions
            log('GCC versions: ' + versions)
            setup_program.saveVersionsToFile(versions, 'gcc-versions.txt')
            return versions
        } catch (error) {
            log('Error fetching GCC versions: ' + error)
            return []
        }
    }
}

const findGCCVersions = findGCCVersionsImpl()

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

    const allVersions = await findGCCVersions()
    core.endGroup()

    // Path program version
    let output_path = null
    let output_version = null

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
        let add_apt_repository_path = null
        try {
            add_apt_repository_path = await io.which('add-apt-repository')
            log(`add-apt-repository found at ${add_apt_repository_path}`)
        } catch (error) {
            add_apt_repository_path = null
        }
        if (add_apt_repository_path !== null && add_apt_repository_path !== '') {
            const repo = `ppa:ubuntu-toolchain-r/ppa`
            log(`Adding repository "${repo}"`)
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
            log(`Skipping APT step because GCC ${output_version} was already found in ${output_path}`)
        } else if (process.platform !== 'linux') {
            log(`Skipping APT step because platform is ${process.platform}`)
        }
    }

    // Install program from a valid URL
    if (output_version === null) {
        core.startGroup('Download GCC from release binaries')
        core.info(`Fetching GCC ${version} from release binaries`)
        // Determine the release to install and version candidates to fallback to
        log('All GCC versions: ' + allVersions)
        const maxV = semver.maxSatisfying(allVersions, version)
        log(`Max version in requirement "${version}": ` + maxV)
        const minV = semver.minSatisfying(allVersions, version)
        log(`Min version in requirement "${version}": ` + minV)
        const release = check_latest ? maxV : minV
        log(`Target release ${release} (check latest: ${check_latest})`)
        const srelease = semver.parse(release)
        log(`Parsed release "${release}" is "${srelease.toString()}"`)
        const major = srelease.major
        const minor = srelease.minor
        const patch = srelease.patch
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
        log(`Version candidates: [${version_candidates.join(', ')}]`)

        // Determine ubuntu version
        const cur_ubuntu_version = setup_program.getCurrentUbuntuVersion()
        log(`Ubuntu version: ${cur_ubuntu_version}`)
        let ubuntu_versions = []
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
        log(`Ubuntu version binaries: [${ubuntu_versions.join(', ')}]`)

        // Try URLs considering ubuntu versions
        const http_client = new httpm.HttpClient('setup-gcc', [], {
            allowRetries: true, maxRetries: 3
        })

        for (const ubuntu_version of ubuntu_versions) {
            for (const version_candidate of version_candidates) {
                log(`Trying to fetch GCC ${version_candidate} for Ubuntu ${ubuntu_version}`)
                const ubuntu_image = `ubuntu-${ubuntu_version}`
                log(`Ubuntu image: ${ubuntu_image}`)
                const gcc_basename = `gcc-${version_candidate}-x86_64-linux-gnu-${ubuntu_image}`
                log(`GCC basename: ${gcc_basename}`)
                const gcc_filename = `${gcc_basename}.tar.gz`
                log(`GCC filename: ${gcc_filename}`)
                const gcc_url = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gcc_filename}`
                const res = await http_client.head(gcc_url)
                if (res.message.statusCode !== 200) {
                    log(`Skipping ${gcc_url} because it does not exist`)
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
                log(`Trying to fetch GCC ${version_candidate} for Linux`)
                const gcc_basename = `gcc-${version_candidate}-Linux-x86_64`
                log(`GCC basename: ${gcc_basename}`)
                const gcc_filename = `${gcc_basename}.tar.gz`
                log(`GCC filename: ${gcc_filename}`)
                const gcc_url = `https://github.com/alandefreitas/cpp-actions/releases/download/gcc-binaries/${gcc_filename}`
                const res = await http_client.head(gcc_url)
                if (res.message.statusCode !== 200) {
                    log(`Skipping ${gcc_url} because it does not exist`)
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
            log(`Skipping download step because GCC ${output_version} was already found in ${output_path}`)
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
            log(`Could not find ${cc}, using ${output_path} as cc instead`)
            cc = output_path
        }

        if (!fs.existsSync(cxx)) {
            log(`Could not find ${cxx}, using ${output_path} as cxx instead`)
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
    return {output_path, cc, cxx, bindir, dir, release, version_major, version_minor, version_patch}
}

async function run() {
    try {
        const inputs = [
            ['trace_commands', core.getBooleanInput('trace-commands')],
            ['version', removeGCCPrefix(core.getInput('version') || '*')],
            ['path', core.getInput('path').split(/[:;]/).filter((path) => path !== '')],
            ['check_latest', core.getBooleanInput('check-latest')],
            ['update_environment', core.getBooleanInput('update-environment')]
        ]

        for (const [name, value] of inputs) {
            if (name === 'trace_commands') {
                trace_commands = value
                if (process.env['ACTIONS_STEP_DEBUG'] === 'true') {
                    // Force trace-commands
                    trace_commands = true
                }
                setup_program.set_trace_commands(trace_commands)
                log(`setup_program.trace_commands: ${setup_program.trace_commands}`)
            }
            log(`${name}: ${value}`)
        }

        function getInput(inputs, key) {
            return inputs.find(([name]) => name === key)[1]
        }

        let {
            output_path,
            cc,
            cxx,
            bindir,
            dir,
            release,
            version_major,
            version_minor,
            version_patch
        } = await main(
            getInput(inputs, 'version'),
            getInput(inputs, 'path'),
            getInput(inputs, 'check_latest'),
            getInput(inputs, 'update_environment'))

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
            core.setFailed('Cannot setup GCC')
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch(err => {
        console.error(err)
        core.setFailed(err.message)
    })
}

module.exports = {
    trace_commands,
    set_trace_commands,
    main
}