const core = require('@actions/core')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const httpm = require('@actions/http-client')
const setup_program = require('setup-program')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')

function removeClangPrefix(version) {
    // Remove "clang-" or "clang++-" prefix
    if (version.startsWith('clang-') || version.startsWith('clang++-')) {
        version = version.replace('clang-', '').replace('clang++-', '')
    }

    // Remove "clang " or "clang++ " prefix
    if (version.startsWith('clang ') || version.startsWith('clang++ ')) {
        version = version.replace('clang ', '').replace('clang++ ', '')
    }

    return version
}

function clangDownloadCandidates(version, allVersions, check_latest) {
    core.info(`Fetching Clang ${version} from release binaries`)
    // Determine the release to install and version candidates to fall back to
    trace_commands.log('All Clang versions: ' + allVersions)
    const maxV = semver.maxSatisfying(allVersions, version)
    trace_commands.log(`Max version in requirement "${version}": ` + maxV)
    const minV = semver.minSatisfying(allVersions, version)
    trace_commands.log(`Min version in requirement "${version}": ` + minV)
    const release = check_latest ? maxV : minV
    trace_commands.log(`Target release ${release} (check latest: ${check_latest})`)
    const srelease = semver.parse(release)
    trace_commands.log(`Parsed release "${release}" is "${srelease.toString()}"`)

    // Determine version candidates we can fall back to by order of preference
    const major = srelease.major
    const minor = srelease.minor
    const patch = srelease.patch
    let version_candidates = [release]
    // 1) Same major, minor, different patch
    if (check_latest) {
        allVersions = allVersions.sort((a, b) => semver.compare(b, a))
    } else {
        allVersions = allVersions.sort(semver.compare)
    }
    for (const v of allVersions) {
        const sv = semver.parse(v)
        if (sv.major === major && sv.minor === minor && sv.patch !== patch) {
            version_candidates.push(v)
        }
    }
    // 2) Same major, different minor
    for (const v of allVersions) {
        const sv = semver.parse(v)
        if (sv.major === major && sv.minor !== minor) {
            version_candidates.push(v)
        }
    }
    trace_commands.log(`Version candidates: [${version_candidates.join(', ')}]`)

    // Determine alternative ubuntu versions to try if the current one fails
    // to have a valid URL
    const cur_ubuntu_version = setup_program.getCurrentUbuntuVersion()
    trace_commands.log(`Ubuntu version: ${cur_ubuntu_version}`)

    // Get list of all ubuntu version candidates in order of preference
    // based on distance from the current ubuntu version
    let ubuntu_versions = []
    for (ubuntuMajor of ['10', '12', '14', '16', '18', '20', '21', '22', '23']) {
        for (ubuntuMinor of ['04', '10']) {
            ubuntu_versions.push(`${ubuntuMajor}.${ubuntuMinor}`)
        }
    }

    // Sort the ubuntu versions based on the distance from the current ubuntu
    // version
    ubuntu_versions = ubuntu_versions.sort((a, b) => {
        const aMajor = parseInt(a.split('.')[0])
        const aMinor = parseInt(a.split('.')[1])
        const bMajor = parseInt(b.split('.')[0])
        const bMinor = parseInt(b.split('.')[1])
        const curMajor = parseInt(cur_ubuntu_version.split('.')[0])
        const curMinor = parseInt(cur_ubuntu_version.split('.')[1])
        const distA = Math.abs(aMajor - curMajor) * 100 + Math.abs(aMinor - curMinor)
        const distB = Math.abs(bMajor - curMajor) * 100 + Math.abs(bMinor - curMinor)
        return distA - distB
    })
    trace_commands.log(`Ubuntu version binaries: [${ubuntu_versions.join(', ')}]`)
    return {version_candidates, ubuntu_versions}
}

function generateClangUrlsFor(version_candidate, ubuntu_version) {
    trace_commands.log(`Trying to fetch Clang ${version_candidate} for Ubuntu ${ubuntu_version}`)
    const ubuntu_image = `ubuntu-${ubuntu_version}`
    trace_commands.log(`Ubuntu image: ${ubuntu_image}`)
    const clang_basename = `clang+llvm-${version_candidate}-x86_64-linux-gnu-${ubuntu_image}`
    trace_commands.log(`Clang basename: ${clang_basename}`)
    const clang_filename = `${clang_basename}.tar.xz`
    trace_commands.log(`Clang filename: ${clang_filename}`)

    const llvm_project_url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version_candidate}/${clang_filename}`

    const llvm_releases_url = `https://releases.llvm.org/${version_candidate}/${clang_filename}`

    const old_clang_basename = `clang+llvm-${version_candidate}-linux-x86_64-ubuntu${ubuntu_version}`
    const old_clang_filename = `${old_clang_basename}.tar.xz`
    const old_llvm_releases_url = `https://releases.llvm.org/${version_candidate}/${old_clang_filename}`

    return {llvm_project_url, llvm_releases_url, old_llvm_releases_url}
}


async function install_program_from_clang_urls(ubuntu_versions, version_candidates, version, check_latest, update_environment, output_version, output_path) {
    // Try URLs considering ubuntu versions
    const http_client = new httpm.HttpClient('setup-clang', [], {
        allowRetries: true, maxRetries: 3
    })

    // Assemble valid URLs in the order of preference in the LLVM project format
    for (const ubuntu_version of ubuntu_versions) {
        for (const version_candidate of version_candidates) {
            const {
                llvm_project_url,
                llvm_releases_url,
                old_llvm_releases_url
            } = generateClangUrlsFor(version_candidate, ubuntu_version)
            for (const clang_url of [llvm_project_url, llvm_releases_url, old_llvm_releases_url]) {
                if (!await setup_program.urlExists(clang_url)) {
                    trace_commands.log(`Skipping ${clang_url} because it does not exist`)
                } else {
                    const __ret = await setup_program.install_program_from_url(['clang'], version_candidate, check_latest, clang_url, update_environment, '/usr/local')
                    output_version = __ret.output_version
                    output_path = __ret.output_path
                    if (output_version !== null) {
                        return {output_version, output_path}
                    }
                }
            }
        }
    }
    return {output_version, output_path}
}

async function main(version, paths, check_latest, update_environment) {
    core.startGroup('🌍 Find clang versions')
    if (process.platform === 'darwin') {
        process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache'
    }

    if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
        process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY']
    }
    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux')
    }

    const allVersions = await setup_program.findClangVersions()
    core.endGroup()

    // Path program version
    let output_path
    let output_version

    // Setup path program
    if (paths.length > 0) {
        core.startGroup('📂 Find clang in specified paths')
        core.info(`Searching for Clang ${version} in paths [${paths.join(',')}]`)
        const __ret = await setup_program.find_program_in_path(paths, version, check_latest)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    }

    // Setup system program
    if (!output_path) {
        core.startGroup('💻 Find clang in system paths')
        core.info(`Searching for Clang ${version} in PATH`)
        trace_commands.log(`Arguments: ${paths}, ['clang++'], ${version}, ${check_latest}`)
        const __ret = await setup_program.find_program_in_system_paths(paths, ['clang++'], version, check_latest)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    }

    // Setup APT program
    if (!output_version && process.platform === 'linux') {
        core.startGroup('📦 Find clang with APT')
        core.info(`Searching for Clang ${version} with APT`)

        // Add repositories for major clang versions
        const allVersionMajors = allVersions
            .filter(v => semver.satisfies(v, version)) // the ones that satisfy the requested version
            .map(v => semver.parse(v, {}).major) // only major components
            .filter((value) => value >= 10) // only major > 10
            .filter((value, index, self) => self.indexOf(value) === index) // no replicates
            .sort((a, b) => b - a) // descending order
        trace_commands.log(`All version major candidates: [${allVersionMajors.join(', ')}]`)

        const ubuntuName = setup_program.getCurrentUbuntuName()
        trace_commands.log(`Ubuntu version name: ${ubuntuName}`)
        if (ubuntuName !== null && allVersionMajors.length !== 0 && ['bionic', 'focal', 'jammy', 'kinetic', 'lunar', 'mantic'].includes(ubuntuName)) {
            // Adding a key requires gnupg
            await setup_program.find_program_with_apt(['gnupg'], '*', true)

            // Download repo key
            const gpg_key_url = 'https://apt.llvm.org/llvm-snapshot.gpg.key'
            const keyPath = await tc.downloadTool(gpg_key_url)
            if (setup_program.isSudoRequired()) {
                await setup_program.ensureSudoIsAvailable()
                await exec.exec(`sudo -n sudo apt-key add "${keyPath}"`, [], {ignoreReturnCode: true})
            } else {
                await exec.exec(`apt-key add "${keyPath}"`, [], {ignoreReturnCode: true})
            }

            // add-apt-repository requires installing software-properties-common
            await setup_program.find_program_with_apt(['software-properties-common'], '*', true)
            let add_apt_repository_path = null
            try {
                add_apt_repository_path = await io.which('add-apt-repository')
                trace_commands.log(`add-apt-repository found at ${add_apt_repository_path}`)
            } catch (error) {
                add_apt_repository_path = null
            }

            // Add APT repositories
            if (add_apt_repository_path !== null && add_apt_repository_path !== '') {
                for (const major of allVersionMajors) {
                    const ReleaseFileURL = `https://apt.llvm.org/${ubuntuName}/dists/llvm-toolchain-${ubuntuName}-${major}/Release`
                    trace_commands.log(`Checking if ${ReleaseFileURL} exists`)
                    if (!await setup_program.urlExists(ReleaseFileURL)) {
                        trace_commands.log(`Skipping repository for major version ${major} because ${ReleaseFileURL} does not exist`)
                        continue
                    }
                    await setup_program.ensureAddAptRepositoryIsAvailable()
                    const repo = `deb https://apt.llvm.org/${ubuntuName}/ llvm-toolchain-${ubuntuName}-${major} main`
                    trace_commands.log(`Adding repository "${repo}"`)
                    if (setup_program.isSudoRequired()) {
                        await exec.exec(`sudo -n add-apt-repository -y "${repo}"`, [], {ignoreReturnCode: true})
                    } else {
                        await exec.exec(`add-apt-repository -y "${repo}"`, [], {ignoreReturnCode: true})
                    }
                }
            }
        }

        const __ret = await setup_program.find_program_with_apt(['clang'], version, check_latest)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    } else {
        if (output_version !== null) {
            trace_commands.log(`Skipping APT step because Clang ${output_version} was already found in ${output_path}`)
        } else if (process.platform !== 'linux') {
            trace_commands.log(`Skipping APT step because platform is ${process.platform}`)
        }
    }

    // If output_version === null, and it gets installed at all, it will be installed from a URL
    const installed_from_url = output_version === null
    if (output_version === null) {
        core.startGroup('⬇️ Download clang')
        let {version_candidates, ubuntu_versions} = clangDownloadCandidates(version, allVersions, check_latest)
        const __ret = await install_program_from_clang_urls(ubuntu_versions, version_candidates, version, check_latest, update_environment, output_version, output_path)
        output_version = __ret.output_version
        output_path = __ret.output_path
        core.endGroup()
    } else /* output_version !== null */ {
        trace_commands.log(`Skipping download step because Clang ${output_version} was already found in ${output_path}`)
    }

    // Create outputs
    core.startGroup('📤 Set outputs')
    let cc = output_path
    let cxx = output_path
    let bindir = ''
    let dir = ''
    let release = '0.0.0'
    let version_major = 0
    let version_minor = 0
    let version_patch = 0
    if (output_path && output_path) {
        const path_basename = path.basename(output_path)
        if (path_basename.startsWith('clang++')) {
            cc = path.join(path.dirname(output_path), path_basename.replace('clang++', 'clang'))
        } else if (path_basename.startsWith('clang')) {
            cxx = path.join(path.dirname(output_path), path_basename.replace('clang', 'clang++'))
        }

        if (!fs.existsSync(cc)) {
            trace_commands.log(`Could not find ${cc}, using ${output_path} as cc instead`)
            cc = output_path
        }

        if (!fs.existsSync(cxx)) {
            trace_commands.log(`Could not find ${cxx}, using ${output_path} as cxx instead`)
            cxx = output_path
        }

        const semverV = output_version !== null ? semver.parse(output_version, {
            includePrerelease: false, loose: true
        }) : semver.parse('0.0.0', {includePrerelease: false, loose: true})
        release = semverV.toString()
        version_major = semverV.major
        version_minor = semverV.minor
        version_patch = semverV.patch

        bindir = path.dirname(output_path)
        if (update_environment) {
            core.addPath(bindir)
        }
        dir = path.dirname(bindir)

        if (installed_from_url) {
            // Patch with the shared libraries the binaries need
            // const clang_libs_url = 'https://github.com/alandefreitas/cpp-actions/releases/download/clang-binaries/clang-libs.tar.xz'
            // const clangLibsPath = await tc.downloadTool(clang_libs_url)
            // const clangLibsDir = await tc.extractTar(clangLibsPath, undefined, 'xJ')
            // await setup_program.moveWithPermissions(clangLibsDir, path.join(dir, 'lib'))
            // if (setup_program.getCurrentUbuntuVersion() != '16.04') {
            //   const libstdcpp_path = path.join(dir, 'lib', 'libstdc++.so.6')
            //   if (fs.existsSync(libstdcpp_path)) {
            //     trace_commands.log(`Removing ${libstdcpp_path} because it's not needed on Ubuntu 16.04`)
            //     fs.unlinkSync(libstdcpp_path)
            //   } else {
            //     trace_commands.log(`Skipping libstdc++ removal because ${libstdcpp_path} does not exist`)
            //   }
            // } else {
            //   trace_commands.log(`Skipping libstdc++ removal because Ubuntu version is 16.04`)
            // }

            // If it's installed from the url, we need to add the lib dirs to LD_LIBRARY_PATH,
            // or it won't be able to find the default shared libraries
            let LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
            let LD_LIBRARY_PATHS = []
            if (LD_LIBRARY_PATH !== null && LD_LIBRARY_PATH !== undefined) {
                LD_LIBRARY_PATHS = process.env.LD_LIBRARY_PATH.split(':').filter((x) => x !== '')
            }
            const lib_dirs = [
                path.join(dir, 'lib')
                // path.join(dir, 'lib', 'x86_64-unknown-linux-gnu'),
                // path.join(dir, 'lib', 'clang', `${version_major}`, 'lib', 'x86_64-unknown-linux-gnu')
            ]
            for (const lib_dir of lib_dirs) {
                if (fs.existsSync(lib_dir)) {
                    if (!LD_LIBRARY_PATHS.includes(lib_dir)) {
                        trace_commands.log(`Adding ${lib_dir} to LD_LIBRARY_PATH`)
                        LD_LIBRARY_PATHS.push(lib_dir)
                    } else {
                        trace_commands.log(`Skipping ${lib_dir} because it is already in LD_LIBRARY_PATH`)
                    }
                } else {
                    trace_commands.log(`Skipping ${lib_dir} because it does not exist`)
                }
            }
            LD_LIBRARY_PATH = LD_LIBRARY_PATHS.join(':')
            if (LD_LIBRARY_PATH !== process.env.LD_LIBRARY_PATH) {
                trace_commands.log(`Setting LD_LIBRARY_PATH to ${LD_LIBRARY_PATH}`)
                core.exportVariable('LD_LIBRARY_PATH', LD_LIBRARY_PATH)
            }
        }
    }
    core.endGroup()
    return {output_path, cc, cxx, bindir, dir, version: release, version_major, version_minor, version_patch}
}

async function run() {
    try {
        const inputs = {
            version: removeClangPrefix(gh_inputs.getInput('version', {defaultValue: '*'})),
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
            inputs.version, inputs.path, inputs.check_latest, inputs.update_environment)

        // Parse Final program / Setup version / Outputs
        if (outputs.output_path) {
            core.startGroup('📤 Action Outputs')
            gh_inputs.setOutputObject(outputs)
            core.endGroup()
        } else {
            core.setFailed('Cannot setup Clang')
        }
    } catch (error) {
        core.setFailed(error.message)
    }
}

if (require.main === module) {
    run().catch((error) => {
        console.error(error)
        core.setFailed(error.message)
    })
}

module.exports = {
    main
}