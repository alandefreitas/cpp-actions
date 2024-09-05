const core = require('@actions/core')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')
const os = require('os')
const httpm = require('@actions/http-client')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')

function isExecutable(path) {
    if (!fs.existsSync(path) || fs.lstatSync(path).isDirectory()) {
        return false
    }
    try {
        if (process.platform === 'win32') {
            // On Windows, check if the file has a .exe extension
            const extensions = ['.exe', '.cmd', '.bat']
            for (const extension of extensions) {
                if (path.toLowerCase().endsWith(extension)) {
                    return true
                }
            }
            return false
        } else {
            // On Linux and other platforms, check the file permissions
            const stats = fs.statSync(path)
            const mode = stats.mode
            return (mode & fs.constants.S_IXUSR) !== 0
        }
    } catch (error) {
        // Handle file not found or other errors
        console.error(error)
        return false
    }
}

/// Check if path program version satisfies the requirements
///
/// If the version does not satisfy the requirements, then return
/// null.
///
/// If the path program cannot be executed with the --version flag,
/// then the version is assumed to be 0.0.0 to indicate the version
/// is OK.
///
/// In any other cases, return the version string.
///
/// @param path: Path program path
/// @param semver_requirements: Semver requirements
/// @return: True if path program version satisfies the requirements
async function program_satisfies(exec_path, semver_requirements) {
    function fnlog(msg) {
        trace_commands.log('program_satisfies: ' + msg)
    }

    // Try to run the program and get the version string
    fnlog(`Checking if program ${exec_path} version satisfies ${semver_requirements}`)
    let version_output = null
    try {
        fnlog(`Running ${exec_path} --version`)
        const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${exec_path}"`, ['--version'])
        fnlog(`Exit code: ${exitCode}`)
        fnlog(`Output: ${stdout.slice(0, 300)}`)
        version_output = stdout.trim()
        if (exitCode !== 0) {
            fnlog(`Path program ${exec_path} --version exited with code ${exitCode}`)
            return '0.0.0'
        }
    } catch (error) {
        fnlog(`Path program ${exec_path} does not have a version string`)
        return '0.0.0'
    }

    const version_regexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/]
    let version = null
    for (const version_regex of version_regexes) {
        const version_matches = version_output.match(version_regex)
        if (version_matches !== null) {
            fnlog(`Path program ${exec_path} matches version string ${version_matches[1]}`)
            const version_str = version_matches[1]
            version = semver.coerce(version_str, {includePrerelease: false, loose: true})
            if (version === null) {
                continue
            }
            if (semver_requirements === '*' || semver_requirements === '' || semver.satisfies(version, semver_requirements)) {
                return version.toString()
            }
            break
        }
    }

    // If no version could be parsed, then return 0.0.0
    if (version === null) {
        return '0.0.0'
    }

    // If parsed version does not satisfy the requirements, then return null
    return null
}

async function find_program_in_path(paths, version, check_latest) {
    function fnlog(msg) {
        trace_commands.log('find_program_in_path: ' + msg)
    }

    let output_version = null
    let output_path = null
    if (paths.length > 1) {
        fnlog(`Searching for program version ${version} in paths [${paths.join(', ')}]`)
    }
    for (const exec_path of paths) {
        if (exec_path === '') {
            continue
        }
        fnlog(`Searching for program version ${version} in "${exec_path}"`)

        // Find as a program in path if only basename is provided
        const isBasenameOnly = path.basename(exec_path) === exec_path
        if (isBasenameOnly) {
            const {output_version, output_path} = find_program_in_system_paths([], [exec_path], version, check_latest)
            if (output_path && output_version) {
                fnlog(`Found program ${exec_path} in system paths (${output_path} - version ${output_version}).`)
                return {output_version, output_path}
            }
        }

        // Find as a file in path
        const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
        for (const extension of extensions) {
            const path = exec_path + extension
            if (!fs.existsSync(path)) {
                continue
            }

            if (fs.lstatSync(path).isDirectory()) {
                continue
            }

            if (fs.lstatSync(path).isDirectory()) {
                fnlog(`Path ${path} is a directory. Skipping it.`)
                continue
            }

            if (!isExecutable(path)) {
                core.debug(`Path ${path} is not an executable. Skipping it.`)
                continue
            }

            // Execute program in path and extract a version string
            const this_output_version = await program_satisfies(path, version)
            const has_no_output_version_yet = output_version === null
            let real_version_parsed = this_output_version !== '0.0.0'
            let satisfied_requirements = this_output_version !== null
            if (has_no_output_version_yet ||
                (real_version_parsed && satisfied_requirements) ||
                (check_latest && semver.gt(this_output_version, output_version)) ||
                (!check_latest && semver.lt(this_output_version, output_version))) {
                output_version = this_output_version
                output_path = path
            }
        }
    }
    return {output_version, output_path}
}

async function find_program_in_paths(paths, names, version, check_latest, stop_at_first) {
    function fnlog(msg) {
        trace_commands.log('find_program_in_paths: ' + msg)
    }

    let output_version = null
    let output_path = null
    let path_log_view = paths
    if (paths.length > 10) {
        path_log_view = paths.slice(0, 10).concat(['...'])
    }
    fnlog(`Searching for ${names.join(', ')} ${version} in [${path_log_view.join(', ')}]`)

    // Check if version requirement can be coerced into version
    let exec_name_candidates = []
    const version_obj = semver.coerce(version)

    for (name of names) {
        const filename_prefixes = []
        if (version_obj !== null) {
            filename_prefixes.push(`${name}-${version_obj.major}.${version_obj.minor}.${version_obj.patch}`)
            filename_prefixes.push(`${name}-${version_obj.major}.${version_obj.minor}`)
            filename_prefixes.push(`${name}-${version_obj.major}`)
        }
        filename_prefixes.push(`${name}`)
        const filename_suffixes = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
        // exec_name_candidates is the cross-product of filename prefixes and suffixes
        for (const filename_prefix of filename_prefixes) {
            for (const filename_suffix of filename_suffixes) {
                exec_name_candidates.push(filename_prefix + filename_suffix)
            }
        }
    }
    fnlog(`Searching for ${names.join(', ')} ${version} with filenames [${exec_name_candidates.join(', ')}]`)

    // Setup System program
    for (const dir of paths) {
        // Skip path if not a directory
        if (!fs.existsSync(dir)) {
            fnlog(`Path ${dir} does not exist.`)
            continue
        }
        if (!fs.lstatSync(dir).isDirectory()) {
            fnlog(`Path ${dir} is not a directory.`)
            continue
        }
        fnlog(`Searching for ${names.join(', ')} ${version} in ${dir}`)
        // add each exec_name_candidate to dir
        for (const exec_name_candidate of exec_name_candidates) {
            const exec_path = path.join(dir, exec_name_candidate)
            if (!fs.existsSync(exec_path)) {
                continue
            }
            if (fs.lstatSync(exec_path).isDirectory()) {
                fnlog(`Path ${exec_path} is a directory. Skipping it.`)
                continue
            }
            if (!isExecutable(exec_path)) {
                fnlog(`Path program ${exec_path} is not an executable.`)
                continue
            }
            // Execute program in exec_path and extract a version string
            core.info(`Found ${exec_path}`)
            const this_output_version = await program_satisfies(exec_path, version)
            if (this_output_version === null) {
                core.info(`${exec_path} does not satisfy requirement ${version}`)
            } else {
                core.info(`Executable version: ${this_output_version} satisfies requirement ${version}`)
            }
            if (output_version === null ||
                (check_latest && typeof (this_output_version) === 'string' && semver.gt(this_output_version, output_version)) ||
                (!check_latest && typeof (this_output_version) === 'string' && semver.lt(this_output_version, output_version))) {
                fnlog(`Found ${exec_path} with version ${this_output_version}.`)
                if (output_version && output_version !== this_output_version) {
                    fnlog(`Previous best version was ${output_version}.`)
                }
                output_version = this_output_version
                output_path = exec_path
            }
        }
        if (stop_at_first && output_version !== null && output_version !== '0.0.0') {
            break
        }
    }
    return {output_version, output_path}
}

async function find_program_in_system_paths(extra_paths, names, version, check_latest) {
    function fnlog(msg) {
        trace_commands.log('find_program_in_system_paths: ' + msg)
    }

    // Append directories from PATH environment variable to paths
    // Get system PATHs with core
    fnlog(`Looking for ${names.join(', ')} ${version} in system PATH`)
    let path_dirs = process.platform.startsWith('win') ? process.env.PATH.split(/;/) : process.env.PATH.split(/[:;]/)
    fnlog(`Paths in $PATH environment variable: ${path_dirs.slice(0, 10).join(', ')}...`)
    if (process.env['RUNNER_TOOL_CACHE']) {
        fnlog(`RUNNER_TOOL_CACHE environment variable: ${process.env['RUNNER_TOOL_CACHE']}`)
        let cached_tool_versions_paths = []
        for (const name of names) {
            cached_tool_versions_paths.push(path.join(process.env['RUNNER_TOOL_CACHE'], name))
        }
        for (const cached_tool_versions_path of cached_tool_versions_paths) {
            fnlog(`Cached tool versions path: ${cached_tool_versions_path}`)
            if (fs.existsSync(cached_tool_versions_path) && fs.lstatSync(cached_tool_versions_path).isDirectory()) {
                // Iterate all directories in cached_tool_versions_path at the first level
                const subdirectories = fs.readdirSync(cached_tool_versions_path)
                    .filter((file) => fs.lstatSync(path.join(cached_tool_versions_path, file)).isDirectory())
                fnlog(`Adding ${cached_tool_versions_path} to PATH`)
                path_dirs.push(cached_tool_versions_path)
                for (const subdirectory of subdirectories) {
                    fnlog(`Adding ${subdirectory} to PATH`)
                    const subdirectory_path = path.join(cached_tool_versions_path, subdirectory)
                    path_dirs.push(subdirectory_path)
                    const subdirectory_bin_path = path.join(subdirectory_path, 'bin')
                    if (fs.existsSync(subdirectory_bin_path) && fs.lstatSync(subdirectory_bin_path).isDirectory()) {
                        fnlog(`Adding ${subdirectory_bin_path} to PATH`)
                        path_dirs.push(subdirectory_bin_path)
                    }
                }
            }
        }
    }

    // Merge PATH paths with paths passed as parameter
    for (const path_dir of path_dirs) {
        if (!extra_paths.includes(path_dir)) {
            extra_paths.push(path_dir)
        }
    }
    const __ret2 = await find_program_in_paths(extra_paths, names, version, check_latest, false)
    if (__ret2.output_path) {
        fnlog(`Found ${names.join(', ')} version ${__ret2.output_version} in ${__ret2.output_path}`)
    }
    return __ret2
}

function removeSemverLeadingZeros(version) {
    const components = version.split('.')
    const cleanedComponents = components.map(component => parseInt(component, 10))
    return cleanedComponents.join('.')
}

function isSudoRequired() {
    if (process.platform !== 'linux') {
        return false
    }
    return process.getuid() !== 0
}

async function urlExists(url) {
    const http_client = new httpm.HttpClient('setup-clang', [], {
        allowRetries: true, maxRetries: 3
    })
    try {
        const res = await http_client.head(url)
        return res.message.statusCode === 200
    } catch (error) {
        return false
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function find_program_with_apt(names, version, check_latest) {
    function fnlog(msg) {
        trace_commands.log('find_program_with_apt: ' + msg)
    }

    let output_version = null
    let output_path = null

    fnlog('Checking if APT is available')
    try {
        const exitCode = await exec.exec('apt', ['--version'])
        if (exitCode !== 0) {
            fnlog(`apt --version returned ${exitCode}`)
            return {output_version, output_path}
        }
    } catch (error) {
        fnlog('APT is not available')
        return {output_version, output_path}
    }

    // Find program "name" with APT
    try {
        fnlog(`Searching for ${names.join(', ')} with APT`)
        let package_names = []
        for (const name of names) {
            if (isSudoRequired()) {
                await exec.exec(`sudo -n apt-get update`, [], {ignoreReturnCode: true})
            } else {
                await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
            }
            const search_expression = `${escapeRegExp(name)}(-[0-9\\.]+)?`
            fnlog(`Searching for packages matching ${search_expression}`)
            const output = await exec.getExecOutput('apt-cache', ['search', `^${search_expression}$`])
            const apt_output = output.stdout.trim()
            if (output.exitCode === 0) {
                fnlog(`apt-cache search. Exit code ${output.exitCode}`)
            } else {
                throw new Error(`Failed to run apt-cache search. Exit code ${output.exitCode}`)
            }
            const apt_lines = apt_output.split('\n')
            for (const apt_line of apt_lines) {
                const apt_line_regex = new RegExp(`^(${search_expression}) `)
                const apt_line_matches = apt_line.match(apt_line_regex)
                if (apt_line_matches !== null) {
                    const apt_version = apt_line_matches[1]
                    package_names.push(apt_version)
                }
            }
        }
        fnlog(`Found packages [${package_names.join(', ')}]`)

        fnlog(`Listing all versions of packages [${package_names.join(', ')}]`)
        let package_match = null
        let package_version_match = null
        let install_matches = []
        for (const package_name of package_names) {
            const output = await exec.getExecOutput('apt-cache', ['showpkg', package_name], {silent: true})
            const showpkg_output = output.stdout.trim()
            if (output.exitCode !== 0) {
                throw new Error(`Failed to run "apt-cache showpkg '${package_name}'"`)
            } else if (output.stdout.trim() === '') {
                fnlog('No output from apt-cache showpkg ' + package_name)
            }
            const showpkg_lines = showpkg_output.split('\n')
            const dependencies_index = showpkg_lines.findIndex((line) => line.startsWith('Dependencies:'))
            if (dependencies_index === -1) {
                continue
            }
            let provides_index = showpkg_lines.findIndex((line) => line.startsWith('Provides:'))
            if (provides_index === -1) {
                provides_index = showpkg_lines.length
            }
            const dependencies_lines = showpkg_lines.slice(dependencies_index + 1, provides_index)
            const package_versions = dependencies_lines.map((line) => line.split(' ')[0])
            fnlog(`Package ${package_name} has APT versions [${package_versions.join(', ')}]`)

            // Filter the versions that install the required program version
            for (const package_version of package_versions) {
                // a limited list of common formats to express versions in apt package names
                const version_regexes = [/\d+:(\d+.\d+)-\d+/, /\d+:(\d+)-\d+/, /(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/]
                let pkg_version_str = null
                for (const version_regex of version_regexes) {
                    const version_matches = package_version.match(version_regex)
                    if (version_matches !== null) {
                        pkg_version_str = removeSemverLeadingZeros(version_matches[1])
                        const pkg_version = semver.coerce(pkg_version_str)
                        const satisfies = pkg_version !== null ? semver.satisfies(pkg_version, version) : true
                        if (!satisfies) {
                            fnlog(`Package ${package_name}=${package_version} version ${pkg_version} does NOT satisfy ${names.join(', ')} version ${version}`)
                        } else {
                            install_matches.push(`${package_name}=${package_version}`)
                            if (output_version === null || (check_latest && semver.gt(pkg_version, output_version)) || (!check_latest && semver.lt(pkg_version, output_version))) {
                                fnlog(`Package ${package_name}=${package_version} version ${pkg_version} satisfies ${names.join(', ')} version ${version}`)
                                package_match = package_name
                                package_version_match = package_version
                                output_version = pkg_version.toString()
                            }
                        }
                        break
                    }
                }
            }
        }

        // Install the package name and version that match the requirements
        if (package_match !== null) {
            let install_pkg = package_match
            if (package_version_match !== null) {
                install_pkg = `${package_match}=${package_version_match}`
            }

            fnlog(`Installing ${install_pkg}`)
            const opts = {
                env: {
                    DEBIAN_FRONTEND: 'noninteractive',
                    TZ: 'Etc/UTC',
                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
                },
                ignoreReturnCode: true
            }

            // Install the package with the best match for the requirements
            let apt_get_exit_code
            if (isSudoRequired()) {
                apt_get_exit_code = await exec.exec(`sudo -n apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts)
            } else {
                apt_get_exit_code = await exec.exec(`apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts)
            }

            if (apt_get_exit_code !== 0) {
                fnlog(`Failed to install ${install_pkg}. Trying aptitude and alternatives packages [${install_matches.join(', ')}]`)
                // Check if aptitude is available
                let aptitude_path
                try {
                    aptitude_path = await io.which('aptitude')
                } catch (error) {
                    aptitude_path = null
                }
                if (aptitude_path !== null && aptitude_path !== '') {
                    // retry with aptitude, which can solve unmet dependencies
                    if (isSudoRequired()) {
                        apt_get_exit_code = await exec.exec(`sudo -n aptitude install -f -y ${install_pkg}`, [], opts)
                    } else {
                        apt_get_exit_code = await exec.exec(`aptitude install -f -y ${install_pkg}`, [], opts)
                    }
                } else {
                    fnlog(`aptitude unavailable.`)
                }
            }

            // If the installation failed, try other versions that also satisfy the requirements
            if (apt_get_exit_code !== 0) {
                fnlog(`Trying alternatives packages [${install_matches.join(', ')}]`)
                for (const install_match of install_matches) {
                    if (isSudoRequired()) {
                        apt_get_exit_code = await exec.exec(`sudo -n apt-get install -f -y --allow-downgrades ${install_match}`, [], opts)
                    } else {
                        apt_get_exit_code = await exec.exec(`apt-get install -f -y --allow-downgrades ${install_match}`, [], opts)
                    }
                    if (apt_get_exit_code === 0) {
                        break
                    }
                }
            }

            const __ret = await find_program_in_system_paths([], names, version, check_latest)
            output_version = __ret.output_version
            output_path = __ret.output_path
        }
    } catch (error) {
        fnlog(error.message)
    }
    if (output_path !== null) {
        fnlog(`Program found: ${output_path}`)
    } else {
        fnlog(`Failed to find ${name} packages with APT`)
    }
    if (output_version !== null) {
        fnlog(`Package version found ${output_version}`)
    } else {
        fnlog(`Failed to find ${name} packages with APT`)
    }
    return {output_version, output_path}
}

// Recursively find all directories in a directory
function getAllSubdirectories(directory) {
    const subdirectories = []

    function traverse(currentDir) {
        const files = fs.readdirSync(currentDir)

        files.forEach(file => {
            const filePath = path.join(currentDir, file)
            const fileStat = fs.statSync(filePath)

            if (fileStat.isDirectory()) {
                subdirectories.push(filePath)
                traverse(filePath)
            }
        })
    }

    traverse(directory)
    return subdirectories
}

function renderTemplate(template, data) {
    const tokenRegex = /{{\s*([^\s{}]+)\s*}}/g
    return template.replaceAll(tokenRegex, (match, key) => {
        return data[key] || match
    })
}

function get_runner_os() {
    const platform = process.platform
    if (platform === 'win32') {
        return 'Windows'
    } else if (platform === 'darwin') {
        return 'macOS'
    } else {
        return 'Linux'
    }
}

function isSymlink(path) {
    try {
        const stats = fs.lstatSync(path)
        return stats.isSymbolicLink()
    } catch (error) {
        trace_commands.log('An error occurred while checking if the path is a symlink:', error)
        return false
    }
}

function copySymlink(sourcePath, destinationPath, level = 0) {
    const targetPath = fs.readlinkSync(sourcePath)
    const levelPrefix = ' '.repeat(level * 2)
    trace_commands.log(`${levelPrefix}Symlink found from ${sourcePath} to ${targetPath}`)
    fs.symlinkSync(targetPath, destinationPath)
    trace_commands.log(`${levelPrefix}Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`)
}

async function findGit() {
    let git_path = undefined
    try {
        git_path = await io.which('git')
    } catch (error) {
        git_path = null
    }
    if (git_path === null || git_path === '') {
        if (isSudoRequired()) {
            await exec.exec(`sudo -n apt-get update`, [], {ignoreReturnCode: true})
            await exec.exec(`sudo -n apt-get install -y git`, [], {ignoreReturnCode: true})
        } else {
            await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
            await exec.exec(`apt-get install -y git`, [], {ignoreReturnCode: true})
        }
        git_path = await io.which('git')
    }
    return git_path
}

async function sleep(ms) {
    const start = new Date().getTime()
    while (new Date().getTime() < start + ms) {
    }
}


async function fetchGitTags(repo, options = {}) {
    try {
        // Find git in PATH
        let git_path = null
        try {
            git_path = await findGit()
        } catch (error) {
            git_path = null
        }
        // Install git if we have to
        if (!git_path) {
            await find_program_with_apt(['git'], '*', false)
            git_path = await findGit()
        }
        // Still no git? Fail
        if (!git_path) {
            throw new Error('Git not found')
        }
        const maxRetries = options.maxRetries || 10
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const args = ['ls-remote', '--tags', repo]
                const {
                    exitCode, stdout
                } = await exec.getExecOutput(`"${git_path}"`, args, {silent: true})
                if (exitCode !== 0) {
                    throw new Error('Git exited with non-zero exit code: ' + exitCode)
                }
                const stdoutTrimmed = stdout.trim()
                const tags = stdoutTrimmed.split('\n').filter(tag => tag.trim() !== '')
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
                trace_commands.log('Git tags: ' + gitTags)
                return gitTags
            } catch (error) {
                if (attempt < maxRetries) {
                    trace_commands.log('Error fetching Git tags: ' + error.message)
                    trace_commands.log(`Attempt ${attempt} of ${maxRetries}`)
                    // Exponential backoff
                    const delay = Math.pow(2, attempt - 1) * 1000
                    trace_commands.log(`Retrying in ${delay} milliseconds...`)
                    await sleep(delay)
                } else {
                    throw new Error('Max retries reached. Error fetching Git tags: ' + error.message)
                }
            }
        }
    } catch (error) {
        throw new Error('Error fetching Git tags: ' + error.message)
    }
}

async function findVersionsFromTags(name, repo, file, regex) {
    const versionsFromFile = readVersionsFromFile(file)
    if (versionsFromFile !== null) {
        trace_commands.log(`${name} versions (from file): ` + versionsFromFile)
        return versionsFromFile
    }
    const tags = await fetchGitTags(repo, {
        maxRetries: 10
    })
    let versions = []
    for (const tag of tags) {
        if (tag.match(regex)) {
            const version = tag.match(regex)[1]
            versions.push(version)
        }
    }
    versions = versions.sort(semver.compare)
    trace_commands.log(`${name} versions: ` + versions)
    saveVersionsToFile(versions, file)
    return versions
}

async function findGCCVersions() {
    return await findVersionsFromTags(
        'GCC',
        'git://gcc.gnu.org/git/gcc.git',
        'gcc-versions.txt',
        /^refs\/tags\/releases\/gcc-(\d+\.\d+\.\d+)$/)
}

async function findClangVersions() {
    return await findVersionsFromTags(
        'Clang',
        'https://github.com/llvm/llvm-project',
        'clang-versions.txt',
        /^refs\/tags\/llvmorg-(\d+\.\d+\.\d+)$/)
}

async function findCMakeVersions() {
    return await findVersionsFromTags(
        'CMake',
        'https://github.com/Kitware/CMake.git',
        'cmake-versions.txt',
        /^refs\/tags\/v(\d+\.\d+\.\d+)$/)
}


async function cloneGitRepo(repo, destPath, ref = undefined, options = {shallow: true}) {
    try {
        const git_path = await findGit()
        if (!git_path) {
            throw new Error('Git not found')
        }
        // Clean the destPath
        if (fs.existsSync(destPath)) {
            await io.rmRF(destPath)
        }

        const refIsHash = ref ? /^[0-9a-f]{40}$/.test(ref) : false
        if (!refIsHash) {
            // Clone the repository with the specified reference
            let args = []
            args.push('clone')
            args.push(repo)
            args.push(destPath)
            if (options.shallow) {
                args.push('--depth')
                args.push('1')
            }
            if (ref) {
                args.push('--branch')
                args.push(ref)
            }
            await exec.exec(`"${git_path}"`, args)
        } else {
            // Reference is a commit hash: init and checkout
            await io.rmRF(destPath)
            await io.mkdirP(destPath)
            await exec.exec(`"${git_path}"`, ['config', '--global', 'init.defaultBranch', 'master'], {cwd: destPath})
            await exec.exec(`"${git_path}"`, ['config', '--global', 'advice.detachedHead', 'false'], {cwd: destPath})
            await exec.exec(`"${git_path}"`, ['init'], {cwd: destPath})
            await exec.exec(`"${git_path}"`, ['remote', 'add', 'origin', repo], {cwd: destPath})
            let args = ['fetch']
            if (options.shallow) {
                args.push('--depth')
                args.push('1')
            }
            args.push('origin')
            args.push(ref)
            await exec.exec(`"${git_path}"`, args, {cwd: destPath})
            await exec.exec(`"${git_path}"`, ['checkout', 'FETCH_HEAD'], {cwd: destPath})
        }
    } catch (error) {
        throw new Error('Error cloning Git repository: ' + error.message)
    }
}

function readVersionsFromFile(filename) {
    try {
        const fileContents = fs.readFileSync(filename, 'utf8')
        const versions = JSON.parse(fileContents)
        if (Array.isArray(versions)) {
            return versions
        }
    } catch (error) {
        // File reading failed or versions couldn't be parsed
    }
    return null
}

function saveVersionsToFile(versions, filename) {
    try {
        const fileContents = JSON.stringify(versions)
        fs.writeFileSync(filename, fileContents, 'utf8')
        trace_commands.log('Versions saved to file.')
    } catch (error) {
        trace_commands.log('Error saving versions to file: ' + error)
    }
}

function getCurrentUbuntuVersion() {
    try {
        const osReleaseData = fs.readFileSync('/etc/os-release', 'utf8')
        const lines = osReleaseData.split('\n')
        const versionLine = lines.find(line => line.startsWith('VERSION_ID='))
        if (versionLine) {
            return versionLine.split('=')[1].replace(/"/g, '')
        }
        console.error('Ubuntu version not found')
        return null
    } catch (error) {
        console.error('Error:', error)
        return null
    }
}

function getCurrentUbuntuName() {
    const version = getCurrentUbuntuVersion()
    if (version) {
        if (version === '18.04') {
            return 'bionic'
        } else if (version === '20.04') {
            return 'focal'
        } else if (version === '20.10') {
            return 'groovy'
        } else if (version === '21.04') {
            return 'hirsute'
        } else if (version === '21.10') {
            return 'impish'
        } else if (version === '22.04') {
            return 'jammy'
        } else if (version === '22.10') {
            return 'kinetic'
        } else if (version === '23.04') {
            return 'lunar'
        } else if (version === '23.10') {
            return 'mantic'
        } else if (version === '24.04') {
            return 'noble'
        }
    }
    trace_commands.log(`setup-program::getCurrentUbuntuName: Ubuntu name for version ${version} not supported`)
    return null
}


/// Move files considering permissions and ownership that make the operation
/// fail on lots of environments
///
/// - If the destination directory does not exist, it will be created
/// - If the destination directory exists, it will be merged
/// - If the destination file does not exist, it will be created
/// - If the destination file exists, it will be overwritten
/// - If destination is on a different device, retry as copy instead
/// - If permissions are required, they will be moved or copied with sudo
async function moveWithPermissions(source, destination, copyInstead = false, level = 0) {
    function fnlog(msg) {
        trace_commands.log('moveWithPermissions: ' + msg)
    }

    const levelPrefix = '  '.repeat(level)
    try {
        // Iterate all files in source directory
        const files = fs.readdirSync(source)
        let count = 0
        for (const file of files) {
            count++
            const source_path = path.join(source, file)
            const destination_path = path.join(destination, file)
            fnlog(`${levelPrefix}${count}) Handle move from ${source_path} to ${destination_path}`)
            if (isSymlink(source_path)) {
                fnlog(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`)
                copySymlink(source_path, destination_path, level)
            } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
                fnlog(`${levelPrefix}${count}) Merge directory ${source_path} with existing ${destination_path}`)
                const ok = await moveWithPermissions(source_path, destination_path, copyInstead, level + 1)
                if (!ok) {
                    throw new Error(`Failed to move ${source_path} to ${destination_path}`)
                }
            } else /* regular file or directory that doesn't exist at destination */ {
                if (!copyInstead) {
                    fnlog(`${levelPrefix}${count}) Moving ${source_path} to ${destination_path}`)
                    await io.mv(source_path, destination_path)
                } else {
                    fnlog(`${levelPrefix}${count}) Copy ${source_path} to ${destination_path}`)
                    await io.cp(source_path, destination_path, {recursive: true})
                }
            }
        }
        fnlog(`${levelPrefix}Successfully moved ${source} to ${destination}.`)
        return true
    } catch (error) {
        core.info(`${levelPrefix}Error occurred while moving ${source} to ${destination}: ${error} (code : ${error.code})`)
        // If failed because destination is on a different device, retry as copy
        if (error.code === 'EXDEV' && !copyInstead) {
            return await moveWithPermissions(source, destination, true, level)
        }
        // If permission denied error, retry the move with sudo
        // Also move with sudo when the file is a symlink and can't be moved because of that
        if (((error.code || 'EACCES') === 'EACCES' || error.code === 'ENOENT') && process.platform === 'linux') {
            return await moveWithSudo(source, destination, copyInstead, level)
        }
        return false
    }
}

async function ensureSudoIsAvailable() {
    function fnlog(msg) {
        trace_commands.log('ensureSudoIsAvailable: ' + msg)
    }

    let sudo_path = null
    try {
        sudo_path = await io.which('sudo')
        fnlog(`sudo found at ${sudo_path}`)
    } catch (error) {
        sudo_path = null
    }
    if (sudo_path === null || sudo_path === '') {
        await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
        await exec.exec(`apt-get install -y sudo`, [], {ignoreReturnCode: true})
        await io.which('sudo')
    }
}

async function ensureAddAptRepositoryIsAvailable() {
    function fnlog(msg) {
        trace_commands.log('ensureAddAptRepositoryIsAvailable: ' + msg)
    }

    let add_apt_repository_path = null
    try {
        add_apt_repository_path = await io.which('add-apt-repository')
        fnlog(`add-apt-repository found at ${add_apt_repository_path}`)
    } catch (error) {
        add_apt_repository_path = null
    }
    if (add_apt_repository_path === null || add_apt_repository_path === '') {
        if (isSudoRequired()) {
            await ensureSudoIsAvailable()
            await exec.exec(`sudo -n apt-get update`, [], {ignoreReturnCode: true})
            await exec.exec(`sudo -n apt-get install -y software-properties-common`, [], {ignoreReturnCode: true})
        } else {
            await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
            await exec.exec(`apt-get install -y software-properties-common`, [], {ignoreReturnCode: true})
        }
        await io.which('add-apt-repository')
    }
}

async function moveWithSudo(source, destination, copyInstead = false, level) {
    function fnlog(msg) {
        trace_commands.log('moveWithSudo: ' + msg)
    }

    await ensureSudoIsAvailable()
    const levelPrefix = '  '.repeat(level)
    const files = fs.readdirSync(source)
    let count = 0
    for (const file of files) {
        const source_path = path.join(source, file)
        const destination_path = path.join(destination, file)
        count++
        if (isSymlink(source_path)) {
            fnlog(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`)
            const target_path = fs.readlinkSync(source_path)
            fnlog(`${levelPrefix}${count}) Symlink found from ${source_path} to ${target_path}`)
            const ln_command = `sudo ln -sf "${target_path}" "${destination_path}"`
            await exec.getExecOutput(ln_command)
            fnlog(`${levelPrefix}${count}) Symlink recreated from ${source_path} to ${destination_path} with target ${target_path}`)
        } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
            const ok = await moveWithSudo(source_path, destination_path, copyInstead, level + 1)
            if (!ok) {
                return false
            }
        } else {
            const mkdir_command = `sudo mkdir -p "${destination}"`
            if (!fs.existsSync(destination_path)) {
                await exec.getExecOutput(mkdir_command)
            }
            const mv_command = `sudo mv "${source_path}" "${destination}"`
            const cp_command = `sudo cp -r "${source_path}" "${destination}"`
            const command = copyInstead ? cp_command : mv_command
            const {exitCode, stdout} = await exec.getExecOutput(command)
            const sudo_output = stdout.trim()
            if (exitCode !== 0) {
                core.warning(`${levelPrefix}${count}) Error occurred while moving with sudo: exit code ${exitCode}`)
                fnlog(sudo_output)
                return false
            } else {
                fnlog(`${levelPrefix}${count}) Successfully moved ${source_path} to ${destination_path} with sudo.`)
            }
        }
    }
    return true
}

async function extractTar(tarPath, destPath, flags = undefined) {
    function fnlog(msg) {
        trace_commands.log('extractTar: ' + msg)
    }

    const IS_WINDOWS = process.platform === 'win32'
    if (!IS_WINDOWS) {
        return await tc.extractTar(tarPath, destPath, flags)
    } else {
        // Define the destPath
        flags = flags || ''
        const tarFilename = path.basename(tarPath)
        const tarBasename = path.basename(tarFilename, path.extname(tarFilename))
        if (destPath === undefined) {
            destPath = path.join(os.tmpdir(), tarBasename)
            await io.mkdirP(destPath)
        }
        // Define the intermediary paths
        const isTwoStep = !tarPath.endsWith('.tar')
        const firstDestPath = path.join(os.tmpdir(), tarBasename + '_1st')
        await io.mkdirP(firstDestPath)
        const secondDestPath = path.join(os.tmpdir(), tarBasename + '_2nd')
        if (isTwoStep) {
            await io.mkdirP(secondDestPath)
        }
        const finalDestPath = destPath
        await io.mkdirP(finalDestPath)

        fnlog(`First destination path: ${firstDestPath}`)
        fnlog(`Second destination path: ${secondDestPath}`)
        fnlog(`Final destination path: ${finalDestPath}`)

        // First step
        const path7z = await io.which('7z', true)
        const args = ['x', tarPath, `-o${firstDestPath}`].concat(flags.includes('v') ? ['-bb1'] : [])
        const {exitCode, stdout, stderr} = await exec.getExecOutput(path7z, args)
        if (exitCode !== 0) {
            throw new Error(`Failed to extract ${tarPath} to ${firstDestPath} with 7z: ${stderr}`)
        }

        async function copyFilesAndRemoveDir(sourcePath, destPath) {
            fnlog(`Moving ${sourcePath} to ${destPath}`)
            const files = fs.readdirSync(sourcePath)
            for (const file of files) {
                const sourceFilePath = path.join(sourcePath, file)
                const destFilePath = path.join(destPath, file)
                fnlog(`Copying ${sourceFilePath} to ${destFilePath}`)
                await io.cp(sourceFilePath, destFilePath, {recursive: true})
            }
            fnlog(`Removing ${sourcePath}`)
            await io.rmRF(sourcePath)
            return destPath
        }

        if (!isTwoStep) {
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath)
        }

        // Find tar file for the second step
        // The tar archive is compressed so 7z produces a .tar file and leaves
        // it in the destination directory. So now we extract the tar
        // file with 7z.
        const files = fs.readdirSync(firstDestPath)
        if (files.length > 1) {
            // It extracted more than one file, so we assume it's the deflated
            // tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath)
        }
        const tarFiles = files.filter(file => file.endsWith('.tar'))
        if (tarFiles.length === 0) {
            // No tar file, so we assume it's the deflated tar file
            return await copyFilesAndRemoveDir(firstDestPath, finalDestPath)
        }

        // Second step
        const tarFile = path.join(firstDestPath, tarFiles[0])
        fnlog(`Extracting ${tarFile} to ${secondDestPath} with 7z`)
        const args2 = ['x', tarFile, `-o${secondDestPath}`].concat(flags.includes('v') ? ['-bb1'] : [])
        const {exitCode: exitCode2, stdout: stdout2, stderr: stderr2} = await exec.getExecOutput(path7z, args2)
        if (exitCode2 !== 0) {
            throw new Error(`Failed to extract ${tarFile} to ${secondDestPath} with 7z: ${stderr2}`)
        }
        if (secondDestPath !== finalDestPath) {
            await copyFilesAndRemoveDir(secondDestPath, finalDestPath)
        }
        if (firstDestPath !== finalDestPath) {
            fnlog(`Removing ${firstDestPath}`)
            await io.rmRF(firstDestPath)
        }
        return finalDestPath
    }
}


async function downloadAndExtract(url, destPath = undefined) {
    function fnlog(msg) {
        trace_commands.log('downloadAndExtract: ' + msg)
    }

    let extPath = undefined
    try {
        let toolPath = await tc.downloadTool(url)
        fnlog(`Downloaded ${url} to ${toolPath}`)
        // Resolve the destination path if not undefined
        if (destPath !== undefined) {
            // Resolve the destination path if relative
            if (!path.isAbsolute(destPath)) {
                destPath = path.resolve(destPath)
                fnlog(`Destination path is relative. Resolved to ${destPath}`)
            }
            // Create destination directory
            if (!fs.existsSync(destPath)) {
                fnlog(`Creating directory ${destPath}`)
                await io.mkdirP(destPath)
            }
        }
        // Rename the toolPath filename to match the URL filename
        const urlFilename = path.basename(url)
        const isValidFilenameChars = /^[a-z0-9._-]+$/i.test(urlFilename)
        if (isValidFilenameChars) {
            // Rename only if the filename is valid
            // Renaming makes the archive file name consistent with the URL
            // and easier for tools to recognize the archive type
            const newToolPath = path.join(path.dirname(toolPath), urlFilename)
            await io.mv(toolPath, newToolPath)
            fnlog(`Renamed ${toolPath} to ${newToolPath}`)
            toolPath = newToolPath
        }
        // Patches for Windows
        if (process.platform === 'win32' && destPath !== undefined) {
            // https://github.com/actions/toolkit/pull/180
            destPath = destPath.replace(/\\/g, '/')
            toolPath = toolPath.replace(/\\/g, '/')
        }
        // Extract
        if (url.endsWith('.zip')) {
            extPath = await tc.extractZip(toolPath, destPath)
        } else if (url.endsWith('.tar')) {
            const flags = trace_commands.enabled() ? '-vx' : '-x'
            extPath = await extractTar(toolPath, destPath, flags)
        } else if (url.endsWith('.tar.gz')) {
            const flags = trace_commands.enabled() ? '-vxz' : '-xz'
            extPath = await extractTar(toolPath, destPath, flags)
        } else if (url.endsWith('.tar.xz')) {
            const flags = trace_commands.enabled() ? '-vxJ' : '-xJ'
            extPath = await extractTar(toolPath, destPath, flags)
        } else if (url.endsWith('.tar.bz2')) {
            const flags = trace_commands.enabled() ? '-vxj' : '-xj'
            extPath = await extractTar(toolPath, destPath, flags)
        } else if (url.endsWith('.7z')) {
            extPath = await tc.extract7z(toolPath, destPath)
        } else if (process.platform === 'darwin' && url.endsWith('.pkg')) {
            extPath = await tc.extractXar(toolPath, destPath)
        } else {
            fnlog(`Unsupported archive format: ${path.basename(url)}`)
            return extPath
        }
        fnlog(`Extracted ${toolPath} to ${extPath}`)
    } catch (error) {
        fnlog(error.message)
        extPath = undefined
    }
    return extPath
}

async function stripSingleDirectoryFromPath(dirPath) {
    function fnlog(msg) {
        trace_commands.log('stripSingleDirectoryFromPath: ' + msg)
    }

    fnlog(`Checking if ${dirPath} contains a single directory`)
    const files = fs.readdirSync(dirPath)
    if (files.length === 1) {
        const subPath = path.join(dirPath, files[0])
        fnlog(`Single file found in ${dirPath}: ${subPath}`)
        const fileStat = fs.statSync(subPath)
        if (fileStat.isDirectory()) {
            // List all files in subpath
            const subFiles = fs.readdirSync(subPath)
            fnlog(`Strip files from ${subPath}: [${subFiles.join(', ')}]`)

            // Move everything to the parent directory
            for (const file of subFiles) {
                const sourcePath = path.join(subPath, file)
                const destPath = path.join(dirPath, file)
                await io.mv(sourcePath, destPath)
            }
            return true
        } else {
            fnlog(`Single file is not a directory: ${subPath}`)
        }
    }
    return false
}

async function install_program_from_url(
    names,
    version,
    check_latest,
    url_template,
    update_environment,
    install_prefix) {
    function fnlog(msg) {
        trace_commands.log('install_program_from_url: ' + msg)
    }

    let output_version = null
    let output_path = null

    // Render URL template
    const coercedVersion = semver.coerce(version) || semver.coerce('0.0.0')
    let url = url_template
    let may_be_template = url.includes('{{')
    if (may_be_template) {
        const context = {
            name: names[0],
            platform: process.platform,
            arch: process.arch,
            os: get_runner_os().toLowerCase(),
            version: coercedVersion.toString(),
            major: coercedVersion.major,
            minor: coercedVersion.minor,
            patch: coercedVersion.patch
        }
        // Convert data to JSON string
        url = renderTemplate(url, context)
        if (url_template !== url) {
            fnlog(`Template data: ${JSON.stringify(context)}`)
            fnlog(`Template "${url_template}" rendered as "${url}"`)
        }
    }


    // Download and extract archive to temporary directory
    const extPath = await downloadAndExtract(url)
    fnlog(`Downloaded and extracted ${url} to ${extPath}`)
    if (!extPath) {
        return {output_version, output_path}
    }

    // Strip single directory from the path if that's the case
    fnlog(`Stripping single directory from ${extPath}`)
    const stripped = await stripSingleDirectoryFromPath(extPath)
    if (stripped) {
        fnlog(`Stripped single directory from ${extPath}`)
    } else {
        fnlog(`No single directory to strip from ${extPath}`)
    }

    // Create environment variable <tool name>_ROOT with the installation path
    for (const name of names) {
        const env_var_name = `${name.toUpperCase()}_ROOT`
        core.exportVariable(env_var_name, extPath)
    }

    // Install to prefix or to cache directory
    if (install_prefix) {
        fnlog(`Moving ${extPath} to ${install_prefix}`)
        const move_ok = await moveWithPermissions(extPath, install_prefix)
        if (!move_ok) {
            fnlog(`Failed to move ${extPath} to ${install_prefix}. Aborting.`)
            return {output_version, output_path}
        }
    } else {
        // Cache
        install_prefix = await tc.cacheDir(extPath, names[0], coercedVersion.toString())
        fnlog(`Caching ${names[0]} in ${install_prefix}`)
    }

    fnlog(`Installed in ${install_prefix}`)
    if (update_environment) {
        core.addPath(install_prefix)
        const bin_path = path.join(install_prefix, 'bin')
        if (fs.existsSync(bin_path)) {
            core.addPath(bin_path)
        }
    }

    // Recursively iterate subdirectories of extPath looking for ${name} executable
    fnlog(`Looking for ${names.join(', ')} binary in ${extPath} subdirectories`)
    const installPrefixSubdirectories = [install_prefix, path.join(install_prefix, 'bin')].concat(getAllSubdirectories(install_prefix))
    fnlog(`Looking for ${names.join(', ')} binary in installed ${install_prefix} subdirectories`)
    const __ret2 = await find_program_in_paths(installPrefixSubdirectories, names, '*', check_latest, true)
    if (__ret2.output_path) {
        fnlog(`Found ${names.join(', ')} binary in ${__ret2.output_path}`)
    }
    output_version = __ret2.output_version
    output_path = __ret2.output_path

    return {output_version, output_path}
}

async function run() {
    function fnlog(msg) {
        trace_commands.log('setup-program: ' + msg)
    }

    try {
        let inputs = {
            name: gh_inputs.getArray('name', / /, undefined, {required: true}),
            version: gh_inputs.getInput('version', {defaultValue: '*'}),
            paths: gh_inputs.getArray('path', /[:;]/),
            check_latest: gh_inputs.getBoolean('check-latest'),
            update_environment: gh_inputs.getBoolean('update-environment'),
            url: gh_inputs.getInput('url'),
            install_prefix: gh_inputs.getInput('install-prefix'),
            fail_on_error: gh_inputs.getBoolean('fail-on-error'),
            trace_commands: gh_inputs.getBoolean('trace-commands')
        }

        // Get trace_commands input first
        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        core.startGroup('📥 Action Inputs')
        gh_inputs.printInputObject(inputs)
        core.endGroup()

        // Set cache directory
        if (process.platform === 'darwin') {
            process.env['AGENT_TOOLSDIRECTORY'] = '/Users/runner/hostedtoolcache'
        }
        if (process.env.AGENT_TOOLSDIRECTORY?.trim()) {
            process.env['RUNNER_TOOL_CACHE'] = process.env['AGENT_TOOLSDIRECTORY']
        }

        // Path program version
        let output_path = null
        let output_version = null

        // Setup path program
        if (inputs.paths) {
            core.startGroup('🔍 Searching in user provided paths')
            core.info(`Searching for ${inputs.name} ${inputs.version} in paths [${inputs.paths.join(',')}]`)
            const __ret = await find_program_in_path(inputs.paths, inputs.version, inputs.check_latest)
            output_version = __ret.output_version
            output_path = __ret.output_path
            core.endGroup()
        }

        // Setup system program
        if (output_path === null) {
            core.startGroup('🔍 Searching in system paths')
            core.info(`Searching for ${inputs.name} ${inputs.version} in PATH`)
            const __ret = await find_program_in_system_paths(inputs.paths, inputs.name, inputs.version, inputs.check_latest)
            output_version = __ret.output_version
            output_path = __ret.output_path
            core.endGroup()
        }

        // Setup APT program
        if (output_version === null && process.platform === 'linux') {
            core.startGroup('📦 Searching with APT')
            core.info(`Searching for ${inputs.name} ${inputs.version} with APT`)
            const __ret = await find_program_with_apt(inputs.name, inputs.version, inputs.check_latest)
            output_version = __ret.output_version
            output_path = __ret.output_path
            core.endGroup()
        } else {
            if (output_version !== null) {
                fnlog(`Skipping APT step because ${inputs.name} ${output_version} was already found in ${output_path}`)
            } else if (process.platform !== 'linux') {
                fnlog(`Skipping APT step because platform is ${process.platform}`)
            }
        }

        // Install program
        if (output_version === null && inputs.url !== null) {
            core.startGroup('🚚 Downloading and Installing')
            core.info(`Fetching ${inputs.name} ${inputs.version} from URL`)
            const __ret = await install_program_from_url(
                inputs.name,
                inputs.version,
                inputs.check_latest,
                inputs.url,
                inputs.update_environment,
                inputs.install_prefix)
            output_version = __ret.output_version
            output_path = __ret.output_path
            core.endGroup()
        } else {
            if (output_version !== null) {
                fnlog(`Skipping download step because ${inputs.name} ${output_version} was already found in ${output_path}`)
            } else if (inputs.url === null) {
                fnlog(`Skipping download step because no URL was provided. URL: ${url}`)
            }
        }

        // Parse Final program / Setup version / Outputs
        core.startGroup('📤 Return outputs')
        if (output_path) {
            const semverVersion = output_version !== null ?
                semver.parse(output_version, {includePrerelease: false, loose: true}) :
                semver.parse('0.0.0', {includePrerelease: false, loose: true})
            const outputs = {
                path: output_path,
                dir: path.dirname(output_path),
                version: semverVersion.toString(),
                version_major: semverVersion.major,
                version_minor: semverVersion.minor,
                version_patch: semverVersion.patch,
                found: true
            }
            core.startGroup('📤 Action Outputs')
            gh_inputs.setOutputObject(outputs)
            core.endGroup()
        } else {
            core.setOutput('found', false)
            if (inputs.fail_on_error) {
                core.setFailed('Cannot find program')
            } else {
                core.info('Cannot find program')
            }
        }
        core.endGroup()
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
    find_program_in_path,
    find_program_in_system_paths,
    find_program_with_apt,
    install_program_from_url,
    isSudoRequired,
    findGit,
    fetchGitTags,
    readVersionsFromFile,
    saveVersionsToFile,
    getCurrentUbuntuVersion,
    moveWithPermissions,
    getCurrentUbuntuName,
    ensureSudoIsAvailable,
    ensureAddAptRepositoryIsAvailable,
    downloadAndExtract,
    cloneGitRepo,
    stripSingleDirectoryFromPath,
    findVersionsFromTags,
    findClangVersions,
    findCMakeVersions,
    findGCCVersions,
    urlExists
}
