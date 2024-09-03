const core = require('@actions/core')
const fs = require('fs')
const path = require('path')
const exec = require('@actions/exec')
const tc = require('@actions/tool-cache')
const cache = require('@actions/cache')
const io = require('@actions/io')
const os = require('os')
const semver = require('semver')
const crypto = require('crypto')
const uuidV4 = require('uuid').v4
const trace_commands = require('trace-commands')

function formatTime(ms) {
    if (ms < 1000) {
        return `${ms}ms`
    }
    if (ms < 1000 * 60) {
        return `${(ms / 1000).toFixed(1)}s`
    }
    return `${(ms / 1000 / 60).toFixed(1)}m`
}

function isSudoRequired() {
    if (process.platform !== 'linux') {
        return false
    }
    return process.getuid() !== 0
}

async function apt_get_main(inputs) {
    function fnlog(msg) {
        trace_commands.log('apt_get_main: ' + msg)
    }

    core.startGroup('🔍 Find apt-get')
    fnlog(`Check if apt-get is installed`)
    const apt_get_path = await io.which('apt-get', true)
    const sudo_required = isSudoRequired()
    const sudoPrefix = sudo_required ? 'sudo ' : ''
    core.info(`🧩 apt-get-path: ${apt_get_path}`)
    core.info(`🧩 sudo-required: ${sudo_required}`)

    core.endGroup()

    if (inputs.apt_get_source_keys.length > 0) {
        core.startGroup('🔑 Install apt-get source keys')
        for (const key of inputs.apt_get_source_keys) {
            let retryTime = 2000
            for (let i = 0; i < inputs.apt_get_retries; i++) {
                core.info(`Add key ${key}`)
                const key_path = await tc.downloadTool(key)
                const exitCode = await exec.exec(`${sudoPrefix} apt-key add ${key_path}`, [], {
                    ignoreReturnCode: i !== inputs.apt_get_retries - 1
                })
                if (exitCode === 0) {
                    break
                }
                if (i !== inputs.apt_get_retries - 1) {
                    core.info(`Failed to add key ${key}, retrying in ${formatTime(retryTime)}`)
                    await new Promise((resolve) => setTimeout(resolve, retryTime))
                    retryTime *= 2
                }
            }
        }
        core.endGroup()
    }

    if (inputs.apt_get_sources.length > 0) {
        core.startGroup('🌐 Install apt-get sources')

        // Get the version of software-properties-common
        const {
            exitCode,
            stdout
        } = await exec.getExecOutput('dpkg-query --showformat=\'${Version}\' --show software-properties-common')
        if (exitCode !== 0) {
            throw new Error('Failed to get the version of software-properties-common')
        }
        const softwarePropertiesCommonVersion = stdout.trim()

        // Identify features of apt-add-repository command and set initial args
        const aptAddRepoCommonArgs = semver.gte(softwarePropertiesCommonVersion, '0.96.24.20') ? ['-y', '-n'] : ['-y']
        const aptAddRepoHasSourceArgs = semver.gte(softwarePropertiesCommonVersion, '0.98.10')

        // Iterate through each source and attempt to add it with retries
        for (const source of inputs.apt_get_sources) {
            let retryTime = 2000

            // Construct the arguments
            let aptAddRepoArgs = [...aptAddRepoCommonArgs]

            // Modify arguments based on source type
            if (aptAddRepoHasSourceArgs) {
                switch (true) {
                    case source.startsWith('ppa:'):
                        aptAddRepoArgs.push('-P')
                        break
                    case source.startsWith('deb '):
                        aptAddRepoArgs.push('-S')
                        break
                    default:
                        aptAddRepoArgs.push('-U')
                }
            }
            aptAddRepoArgs.push(source)

            for (let i = 0; i < inputs.apt_get_retries; i++) {
                try {
                    // Execute the apt-add-repository command
                    const exitCode = await exec.exec(`${sudoPrefix} -E apt-add-repository ${aptAddRepoArgs.join(' ')}`, [], {
                        ignoreReturnCode: i !== inputs.apt_get_retries - 1
                    })
                    if (exitCode === 0) {
                        core.info(`Added source ${source}`)
                        break
                    }
                    if (i !== inputs.apt_get_retries - 1) {
                        core.info(`Failed to add source ${source}, retrying in ${formatTime(retryTime)}`)
                        await new Promise((resolve) => setTimeout(resolve, retryTime))
                        retryTime *= 2
                    }
                } catch (error) {
                    console.error(`Failed to add repository: ${error}`)
                    await new Promise((resolve) => setTimeout(resolve, retryTime))
                    retryTime *= 2
                }
            }
        }
        core.endGroup()
    }

    // Add architectures
    if (inputs.apt_get_add_architecture.length > 0) {
        core.startGroup('📦 Add architectures')
        for (const arch of inputs.apt_get_add_architecture) {
            await exec.exec(`${sudoPrefix} dpkg --add-architecture ${arch}`, [])
        }
        core.endGroup()
    }

    // Update apt-get
    // $sudo_prefix apt-get -o Acquire::Retries=${{ inputs.apt-get-retries }} update
    core.startGroup('♻️ Update apt-get')
    await exec.exec(`${sudoPrefix} apt-get -o Acquire::Retries=${inputs.apt_get_retries} update`, [])
    core.endGroup()

    // Install packages
    if (inputs.apt_get_ignore_missing || !inputs.apt_get_bulk_install) {
        for (const pkg of inputs.apt_get) {
            core.startGroup('📦 Install apt-get package: ' + pkg)
            const args = inputs.apt_get_ignore_missing ?
                ['-o', 'Acquire::Retries=' + inputs.apt_get_retries, '--ignore-missing', 'install', '-y', pkg] :
                ['-o', 'Acquire::Retries=' + inputs.apt_get_retries, 'install', '-y', pkg]
            const exitCode = await exec.exec(`${sudoPrefix} apt-get`, args, {
                env: {
                    // set the DEBIAN_FRONTEND environment variable to
                    // noninteractive so that the tzdata package
                    // doesn't prompt for input
                    DEBIAN_FRONTEND: 'noninteractive',
                    TZ: 'Etc/UTC',
                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                },
                ignoreReturnCode: true
            })
            if (exitCode !== 0 && !inputs.apt_get_ignore_missing) {
                core.endGroup()
                throw new Error(`Failed to install package ${pkg}`)
            }
            core.endGroup()
        }
    } else {
        core.startGroup('📦 Install apt-get packages')
        await exec.exec(`${sudoPrefix} apt-get -o Acquire::Retries=${inputs.apt_get_retries} install -y ${inputs.apt_get.join(' ')}`, [])
        core.endGroup()
    }
}

async function createTempFolder(dest) {
    dest = path.join(process.env['RUNNER_TEMP'] || os.tmpdir() || '', uuidV4())
    await io.mkdirP(dest)
    return dest
}

function sha1sum(input) {
    const hash = crypto.createHash('sha1')
    hash.update(input)
    return hash.digest('hex')
}

function escapePath(path) {
    // If there are no whitespaces or slashes (forwards or backwards), then
    // we don't need to quote the path.
    if (!path.match(/[\\\/\s]/)) {
        return path
    }
    // Escape quotes
    path = path.replaceAll('"', '\\"')
    // Quote the path
    path = `"${path}"`
    return path
}

async function vcpkg_main(inputs) {
    /*
        Infer any vcpkg parameters necessary and
        create a cache key.
     */
    core.startGroup('🔢 vcpkg parameters')
    // Git Hash
    const gitPath = await io.which('git', true)
    core.info(`🧩 git-path: ${gitPath}`)
    const vcpkg_repo = 'https://github.com/microsoft/vcpkg.git'
    core.info(`🧩 vcpkg-repo: ${vcpkg_repo}`)
    core.info(`🧩 vcpkg-branch: ${inputs.vcpkg_branch}`)
    const vcpkg_commit_hash = (await exec.getExecOutput(escapePath(gitPath), ['ls-remote', vcpkg_repo, inputs.vcpkg_branch])).stdout.trim()
    core.info(`🧩 vcpkg-commit-hash: ${vcpkg_commit_hash}`)

    // Triplet
    const defaultTriplet = ({'win32': 'x64-windows', 'linux': 'x64-linux', 'darwin': 'x64-osx'})[process.platform] || ''
    core.info(`🧩 default-triplet: ${defaultTriplet}`)
    const triplet = inputs.vcpkg_triplet || defaultTriplet
    const tripletSuffix = triplet ? `:${triplet}` : ''
    core.info(`🧩 triplet: ${triplet}`)

    // vcpkg directory
    let vcpkgDir = inputs.vcpkg_dir
    if (!vcpkgDir) {
        vcpkgDir = tc.find('vcpkg', inputs.vcpkg_branch)
    }
    if (!vcpkgDir && process.env.RUNNER_TOOL_CACHE) {
        const dir = path.join(process.env.RUNNER_TOOL_CACHE, 'vcpkg', inputs.vcpkg_branch)
        if (fs.existsSync(dir)) {
            vcpkgDir = dir
        }
    }
    if (!vcpkgDir) {
        const tmp = await createTempFolder()
        const vcpkgTempDir = path.join(tmp, 'vcpkg')
        await io.mkdirP(vcpkgTempDir)
        // Move that empty folder to the cache tools and make the cache
        // tool the final directory
        vcpkgDir = await tc.cacheDir(vcpkgTempDir, 'vcpkg', inputs.vcpkg_branch)
    }
    if (vcpkgDir && !path.isAbsolute(vcpkgDir)) {
        vcpkgDir = path.join(process.cwd(), vcpkgDir)
    }

    core.info(`🧩 vcpkg-dir: ${vcpkgDir}`)
    const bootstrapBasename = process.platform === 'win32' ? 'bootstrap-vcpkg.bat' : 'bootstrap-vcpkg.sh'
    const bootstrapPath = path.join(vcpkgDir, bootstrapBasename)
    core.info(`🧩 bootstrap-path: ${bootstrapPath}`)
    const toolchainPath = path.join(vcpkgDir, 'scripts', 'buildsystems', 'vcpkg.cmake')
    const vcpkgExecutable = path.join(vcpkgDir, 'vcpkg')

    // Compiler hash
    let compilerHashStr = ''
    let cxxCompilerVersion = ''
    if (inputs.cxx !== '') {
        if (inputs.cxx === path.basename(inputs.cxx)) {
            inputs.cxx = await io.which(inputs.cxx, true)
        }
        const compilerVersionOutput = (await exec.getExecOutput(escapePath(inputs.cxx), ['--version'])).stdout.trim()
        const regex = /[0-9]+\.[0-9]+\.[0-9]+/
        const matches = compilerVersionOutput.match(regex)
        const compilerVersion = matches ? matches[0] : ''
        compilerHashStr += `cxx:${inputs.cxx}-version:${compilerVersion}-flags:${inputs.cxxflags}`
        cxxCompilerVersion = compilerVersion
    }
    if (inputs.cc !== '') {
        if (inputs.cc === path.basename(inputs.cc)) {
            inputs.cc = await io.which(inputs.cc, true)
        }
        const compilerVersionOutput = (await exec.getExecOutput(escapePath(inputs.cc), ['--version'])).stdout.trim()
        const regex = /[0-9]+\.[0-9]+\.[0-9]+/
        const matches = compilerVersionOutput.match(regex)
        const compilerVersion = matches ? matches[0] : ''
        if (cxxCompilerVersion !== compilerVersion || inputs.ccflags !== inputs.cxxflags) {
            compilerHashStr += `cc:${inputs.cc}-version:${compilerVersion}-flags:${inputs.ccflags}`
        }
    }
    core.info(`🧩 compiler-hash-str: ${compilerHashStr}`)
    const compilerHash = sha1sum(compilerHashStr)
    core.info(`🧩 compiler-hash: ${compilerHash}`)
    const compilerHashId = compilerHash.substr(0, 8)
    const packagesHash = sha1sum(inputs.vcpkg.join('-'))
    const packagesHashId = packagesHash.substr(0, 8)
    let vcpkgCacheKey = `vcpkg${tripletSuffix}-os:${process.platform}-cxx:${compilerHashId}-packages:${packagesHashId}`
    core.info(`🧩 vcpkg-cache-key: ${vcpkgCacheKey}`)

    let outputs = {
        vcpkg_executable: vcpkgExecutable,
        vcpkg_toolchain: toolchainPath
    }
    core.endGroup()

    let cachePaths = [vcpkgDir]
    if (inputs.vcpkg_cache) {
        core.startGroup('🔍 Cache lookup')
        const cacheKey = await cache.restoreCache([vcpkgDir], vcpkgCacheKey, [], {}, false)
        if (cacheKey) {
            core.info(`Cache hit: ${cacheKey}`)
            core.info(`- triplet: ${triplet}`)
            core.info(`- compiler-hash-id: ${compilerHashId}`)
            core.info(`- packages: ${inputs.vcpkg.join('-')}`)
            core.endGroup()
            return outputs
        }
        core.info(`Cache miss for key: ${vcpkgCacheKey}`)
        core.endGroup()
    }
    core.startGroup('📦 Install vcpkg')
    const clone_args = ['clone', vcpkg_repo, '-b', inputs.vcpkg_branch, '--depth', '1', vcpkgDir]
    core.info(`💻 ${escapePath(gitPath)} ${clone_args.join(' ')}`)
    await exec.exec(escapePath(gitPath), clone_args, {})
    core.info(`💻 ${escapePath(bootstrapPath)}`)
    await exec.exec(escapePath(bootstrapPath), [], {cwd: vcpkgDir})
    core.endGroup()

    if (inputs.vcpkg.length > 0) {
        // Set environment variables to determine how vcpkg should
        // build packages by default
        if (inputs.cxx !== '') {
            core.exportVariable('CXX', inputs.cxx)
        }
        if (inputs.cxxflags !== '') {
            core.exportVariable('CXXFLAGS', inputs.cxxflags)
        }
        if (inputs.cc !== '') {
            core.exportVariable('CC', inputs.cc)
        }
        if (inputs.ccflags) {
            core.exportVariable('CFLAGS', inputs.ccflags)
        }

        for (const pkg of inputs.vcpkg) {
            core.startGroup('📦 Install vcpkg package: ' + pkg)
            // Check pkg contains its own triplet suffix
            const hasOwnTriplet = pkg.includes(':')
            const pkgWithTriplet = hasOwnTriplet ? pkg : `${pkg}${tripletSuffix}`
            const exitCode = await exec.exec(escapePath(vcpkgExecutable), ['install', pkg, pkgWithTriplet], {
                ignoreReturnCode: true
            })
            if (exitCode === 0) {
                core.endGroup()
                continue
            }
            // If the package failed to install, we attempt to print some
            // helpful information about why it failed.
            // vcpkg might store this information in a number of log files
            const pkgWithoutTriplet = hasOwnTriplet ? pkg.split(':')[0] : pkg
            const pkgTriplet = hasOwnTriplet ? pkg.split(':')[1] : triplet
            for (const prefix of ['detect_compiler', pkgWithoutTriplet]) {
                for (const build_type of ['rel', 'dbg']) {
                    for (const step of ['config', 'build', 'install']) {
                        for (const suffix of ['CMakeCache.txt', 'out', 'err']) {
                            const log_basename = `${step}-${pkgTriplet}-${build_type}-${suffix}.log`
                            const log_path = path.join(vcpkgDir, 'buildtrees', prefix, log_basename)
                            if (fs.existsSync(log_path)) {
                                core.info(`📄 Contents of ${log_path}:`)
                                const contents = fs.readFileSync(log_path, 'utf8')
                                core.info(contents)
                            }
                        }
                    }
                    const cmake_output_log_path = path.join(vcpkgDir, 'buildtrees', prefix, `${pkgTriplet}-${build_type}`, 'CMakeFiles', 'CMakeOutput.log')
                    if (fs.existsSync(cmake_output_log_path)) {
                        core.info(`📄 Contents of ${cmake_output_log_path}:`)
                        const contents = fs.readFileSync(cmake_output_log_path, 'utf8')
                        core.info(contents)
                    }
                    const cmake_error_log_path = path.join(vcpkgDir, 'buildtrees', prefix, `${pkgTriplet}-${build_type}`, 'CMakeFiles', 'CMakeError.log')
                    if (fs.existsSync(cmake_error_log_path)) {
                        core.info(`📄 Contents of ${cmake_error_log_path}:`)
                        const contents = fs.readFileSync(cmake_error_log_path, 'utf8')
                        core.info(contents)
                    }
                }
            }
            core.endGroup()
            throw new Error(`Failed to install package ${pkg}`)
        }
    }

    if (inputs.vcpkg_cache) {
        core.startGroup('💾 Cache vcpkg and built packages')
        core.info(`Cache path: ${cachePaths.join(', ')}`)
        core.info(`Cache key: ${vcpkgCacheKey}`)
        await cache.saveCache(cachePaths, vcpkgCacheKey, {}, false)
        core.endGroup()
    }

    return outputs
}

async function main(inputs, force_install_vcpkg) {
    // ----------------------------------------------
    // apt-get
    // ----------------------------------------------
    // Check if environment is Linux
    if (inputs.apt_get.length > 0 && process.platform === 'linux') {
        await apt_get_main(inputs)
    }

    // ----------------------------------------------
    // Vcpkg
    // ----------------------------------------------
    if (inputs.vcpkg.length > 0 || inputs.vcpkg_force_install) {
        return await vcpkg_main(inputs)
    }

    return {}
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
        trace_commands.log('package-install: ' + msg)
    }

    try {
        let inputs = {
            // packages
            vcpkg: (core.getInput('vcpkg') || '').split(/[,; \n]/).filter((input) => input !== ''),
            apt_get: (core.getInput('apt-get') || '').split(/[,; \n]/).filter((input) => input !== ''),
            // vcpkg options
            cxx: normalizePath(core.getInput('cxx') || process.env['CXX'] || ''),
            cxxflags: (core.getInput('cxxflags') || process.env['CXXFLAGS'] || '').trim(),
            cc: normalizePath(core.getInput('cc') || process.env['CC'] || ''),
            ccflags: (core.getInput('ccflags') || process.env['CFLAGS'] || '').trim(),
            vcpkg_triplet: core.getInput('vcpkg-triplet') || '',
            vcpkg_dir: normalizePath(core.getInput('vcpkg-dir') || ''),
            vcpkg_branch: core.getInput('vcpkg-branch') || '',
            vcpkg_cache: toTriboolInput(core.getInput('vcpkg-cache')) || true,
            vcpkg_force_install: toTriboolInput(core.getInput('vcpkg-force-install')) || false,
            // apt-get options
            apt_get_retries: toIntegerInput(core.getInput('apt-get-retries') || process.env['APT_GET_RETRIES']) || 3,
            apt_get_sources: (core.getInput('apt-get-sources') || '').split(/[,; ]/).filter((input) => input !== ''),
            apt_get_source_keys: (core.getInput('apt-get-source-keys') || '').split(/[,; ]/).filter((input) => input !== ''),
            apt_get_ignore_missing: toTriboolInput(core.getInput('apt-get-ignore-missing')) || false,
            apt_get_add_architecture: (core.getInput('apt-get-add-architecture') || '').split(/[,; ]/).filter((input) => input !== ''),
            apt_get_bulk_install: toTriboolInput(core.getInput('apt-get-bulk-install')) || false,
            // Annotations and tracing
            trace_commands: core.getBooleanInput('trace-commands')
        }

        // Resolve paths
        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        // ----------------------------------------------
        // patch apt-get packages for vcpkg
        // ----------------------------------------------
        if (inputs.vcpkg.length > 0 && process.platform === 'linux') {
            for (const pkg of ['git', 'curl', 'zip', 'unzip', 'tar']) {
                if (!inputs.apt_get.includes(pkg)) {
                    inputs.apt_get.push(pkg)
                }
            }
        }

        // ----------------------------------------------
        // Force install vcpkg anyway
        // ----------------------------------------------
        if (inputs.apt_get.includes('vcpkg')) {
            inputs.vcpkg_force_install = true
            inputs.apt_get = inputs.apt_get.filter((item) => item !== 'vcpkg')
        } else if (inputs.vcpkg.includes('true')) {
            inputs.vcpkg_force_install = true
            inputs.vcpkg = inputs.vcpkg.filter((item) => item !== 'true')
        }

        core.startGroup('📥 Workflow Inputs')
        fnlog(`🧩 package-install.trace_commands: ${trace_commands}`)
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${value ? (typeof value === 'string' ? `"${value}"` : value) : '<empty>'}`)
        }
        core.endGroup()

        try {
            const outputs = await main(inputs)
            core.startGroup('📤 Workflow Outputs')
            for (const [name, value] of Object.entries(outputs)) {
                const outputKey = name.replaceAll('_', '-')
                core.info(`🧩 ${outputKey}: ${value ? (typeof value === 'string' ? `"${value}"` : value) : '<empty>'}`)
                core.setOutput(outputKey, value)
            }
            core.endGroup()
        } catch (error) {
            fnlog(error.stack)
            core.setFailed(error)
        }
    } catch (error) {
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
