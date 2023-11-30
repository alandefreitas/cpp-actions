const core = require('@actions/core')
const github = require('@actions/github')
const io = require('@actions/io')
const tc = require('@actions/tool-cache')
const semver = require('semver')
const fs = require('fs')
const exec = require('@actions/exec')
const path = require('path')

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


function isExecutable(path) {
  try {
    const stats = fs.statSync(path)
    if (process.platform === 'win32') {
      // On Windows, check if the file has a .exe extension
      return path.toLowerCase().endsWith('.exe')
    } else {
      // On Linux and other platforms, check the file permissions
      const mode = stats.mode
      const isExecutable = (mode & fs.constants.S_IXUSR) !== 0
      return isExecutable
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
async function program_satisfies(path, semver_requirements) {
  // Try to run the program and get the version string
  let version_output = null
  try {
    const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${path}"`, ['--version'])
    version_output = stdout.trim()
    if (exitCode !== 0) {
      log(`Path program ${path} --version exited with code ${exitCode}`)
      return '0.0.0'
    }
  } catch (error) {
    log(`Path program ${path} does not have a version string`)
    return '0.0.0'
  }

  const version_regexes = [/(\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /(\d+)/]
  let version = null
  for (const version_regex of version_regexes) {
    const version_matches = version_output.match(version_regex)
    if (version_matches !== null) {
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
  let output_version = null
  let output_path = null
  log(`Searching for program version ${version} in [${paths.join(', ')}]`)
  for (const exec_path of paths) {
    if (exec_path === '') {
      continue
    }
    log(`Searching for program version ${version} in "${exec_path}"`)
    // Check if path program exists, is not a directory, and is executable
    if (!fs.existsSync(exec_path)) {
      // log(`Path program ${exec_path} does not exist`)
      continue
    } else if (fs.lstatSync(exec_path).isDirectory()) {
      log(`Path program ${exec_path} is a directory. Skipping it.`)
    } else if (!isExecutable(exec_path)) {
      log(`Path program ${exec_path} is not an executable. Skipping it.`)
    } else {
      // Execute program in path and extract a version string
      const this_output_version = await program_satisfies(exec_path, version)
      if (output_version === null || (this_output_version !== '0.0.0' && this_output_version !== null) || (check_latest && semver.gt(this_output_version, output_version)) || (!check_latest && semver.lt(this_output_version, output_version))) {
        output_version = this_output_version
        output_path = exec_path
      }
    }
  }
  return {output_version, output_path}
}

async function find_program_in_paths(paths, names, version, check_latest, stop_at_first) {
  let output_version = null
  let output_path = null
  let path_log_view = paths
  if (paths.length > 10) {
    path_log_view = paths.slice(0, 10).concat(['...'])
  }
  log(`Searching for ${names.join(', ')} ${version} in [${path_log_view.join(', ')}]`)

  // Check if version requirement can be coerced into version
  let exec_suffixes = []
  const version_obj = semver.coerce(version)

  for (name of names) {
    if (version_obj !== null) {
      exec_suffixes.push(`${name}-${version_obj.major}.${version_obj.minor}.${version_obj.patch}`)
      if (process.platform.startsWith('win')) {
        exec_suffixes.push(`${name}-${version_obj.major}.${version_obj.minor}.${version_obj.patch}.exe`)
      }
      exec_suffixes.push(`${name}-${version_obj.major}.${version_obj.minor}`)
      if (process.platform.startsWith('win')) {
        exec_suffixes.push(`${name}-${version_obj.major}.${version_obj.minor}.exe`)
      }
      exec_suffixes.push(`${name}-${version_obj.major}`)
      if (process.platform.startsWith('win')) {
        exec_suffixes.push(`${name}-${version_obj.major}.exe`)
      }
    }
    exec_suffixes = exec_suffixes.concat([`${name}`])
    if (process.platform.startsWith('win')) {
      exec_suffixes.push(`${name}.exe`)
    }
  }
  log(`Searching for ${names.join(', ')} ${version} with suffixes [${exec_suffixes.join(', ')}]`)

  // Setup System program
  for (const dir of paths) {
    // Skip path if not a directory
    if (!fs.existsSync(dir)) {
      log(`Path ${dir} does not exist.`)
      continue
    }
    if (!fs.lstatSync(dir).isDirectory()) {
      log(`Path ${dir} is not a directory.`)
      continue
    }
    log(`Searching for ${names.join(', ')} ${version} in ${dir}`)
    // add each exec_suffix to dir
    for (const exec_suffix of exec_suffixes) {
      const exec_path = path.join(dir, exec_suffix)
      if (!fs.existsSync(exec_path) || fs.lstatSync(exec_path).isDirectory()) {
        // log(`Path program ${exec_path} does not exist`)
        // log(`Path program ${exec_path} is a directory.`)
      } else if (!isExecutable(exec_path)) {
        log(`Path program ${exec_path} is not an executable.`)
      } else {
        // Execute program in exec_path and extract a version string
        core.info(`Found ${exec_path}`)
        const this_output_version = await program_satisfies(exec_path, version)
        if (this_output_version === null) {
          core.info(`${exec_path} does not satisfy requirement ${version}`)
        } else {
          core.info(`Executable version: ${this_output_version} satisfies requirement ${version}`)
        }
        if (output_version === null || (check_latest && typeof (this_output_version) === 'string' && semver.gt(this_output_version, output_version)) || (!check_latest && typeof (this_output_version) === 'string' && semver.lt(this_output_version, output_version))) {
          log(`Found ${exec_path} with version ${this_output_version}.`)
          if (output_version !== null && output_version !== this_output_version) {
            log(`Previous best version was ${output_version}.`)
          }
          output_version = this_output_version
          output_path = exec_path
        }
      }
    }
    if (stop_at_first && output_version !== null && output_version !== '0.0.0') {
      break
    }
  }
  return {output_version, output_path}
}

async function find_program_in_system_paths(paths, name, version, check_latest) {
  // Append directories from PATH environment variable to paths
  // Get system PATHs with core
  const path_dirs = process.platform.startsWith('win') ? process.env.PATH.split(/[;]/) : process.env.PATH.split(/[:;]/)
  for (const path_dir of path_dirs) {
    if (!paths.includes(path_dir)) {
      paths.push(path_dir)
    }
  }
  return await find_program_in_paths(paths, name, version, check_latest, false)
}

function removeSemverLeadingZeros(version) {
  const components = version.split('.')
  const cleanedComponents = components.map(component => parseInt(component, 10))
  return cleanedComponents.join('.')
}

function isSudoRequired() {
  return process.getuid() !== 0
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function find_program_with_apt(names, version, check_latest) {
  let output_version = null
  let output_path = null

  log('Checking if APT is available')
  try {
    const {exitCode: exitCode, stdout: stdout} = await exec.getExecOutput('apt', ['--version'])
    if (exitCode !== 0) {
      throw new Error(`Failed to run "${path}" --version`)
    }
  } catch (error) {
    log('APT is not available')
    return {output_version, output_path}
  }

  // Find program "name" with APT
  try {
    log(`Searching for ${names.join(', ')} with APT`)
    let package_names = []
    for (const name of names) {
      if (isSudoRequired()) {
        await exec.exec(`sudo -n apt-get update`, [], {ignoreReturnCode: true})
      } else {
        await exec.exec(`apt-get update`, [], {ignoreReturnCode: true})
      }
      const search_expression = `${escapeRegExp(name)}(-[0-9\\.]+)?`
      log(`Searching for packages matching ${search_expression}`)
      const output = await exec.getExecOutput('apt-cache', ['search', `^${search_expression}$`])
      const apt_output = output.stdout.trim()
      if (output.exitCode === 0) {
        log(`apt-cache search. Exit code ${output.exitCode}`)
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
    log(`Found packages [${package_names.join(', ')}]`)

    log(`Listing all versions of packages [${package_names.join(', ')}]`)
    let package_match = null
    let package_version_match = null
    let install_matches = []
    for (const package_name of package_names) {
      const output = await exec.getExecOutput('apt-cache', ['showpkg', package_name], {silent: true})
      const showpkg_output = output.stdout.trim()
      if (output.exitCode !== 0) {
        throw new Error(`Failed to run "apt-cache showpkg '${package_name}'"`)
      } else if (output.stdout.trim() === '') {
        log('No output from apt-cache showpkg ' + package_name)
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
      log(`Package ${package_name} has APT versions [${package_versions.join(', ')}]`)

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
              log(`Package ${package_name}=${package_version} version ${pkg_version} does NOT satisfy ${names.join(', ')} version ${version}`)
            } else {
              install_matches.push(`${package_name}=${package_version}`)
              if (output_version === null || (check_latest && semver.gt(pkg_version, output_version)) || (!check_latest && semver.lt(pkg_version, output_version))) {
                log(`Package ${package_name}=${package_version} version ${pkg_version} satisfies ${names.join(', ')} version ${version}`)
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

      log(`Installing ${install_pkg}`)
      const opts = {
          env: {
              DEBIAN_FRONTEND: 'noninteractive',
              TZ: 'Etc/UTC',
              PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
          },
          ignoreReturnCode: true
      }

      // Install the package with the best match for the requirements
      let apt_get_exit_code = null
      if (isSudoRequired()) {
        apt_get_exit_code = await exec.exec(`sudo -n apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts)
      } else {
        apt_get_exit_code = await exec.exec(`apt-get install -f -y --allow-downgrades ${install_pkg}`, [], opts)
      }

      if (apt_get_exit_code !== 0) {
        log(`Failed to install ${install_pkg}. Trying aptitude and alternatives packages [${install_matches.join(', ')}]`)
        // Check if aptitude is available
        let aptitude_path = null
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
          log(`aptitude unavailable.`)
        }
      }

      // If the installation failed, try other versions that also satisfy the requirements
      if (apt_get_exit_code !== 0) {
        log(`Trying alternatives packages [${install_matches.join(', ')}]`)
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
    log(error.message)
  }
  if (output_path !== null) {
    log(`Program found: ${output_path}`)
  } else {
    log(`Failed to find ${name} packages with APT`)
  }
  if (output_version !== null) {
    log(`Package version found ${output_version}`)
  } else {
    log(`Failed to find ${name} packages with APT`)
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
  const result = template.replace(tokenRegex, (match, key) => {
    return data[key] || match
  })
  return result
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
    log('An error occurred while checking if the path is a symlink:', error)
    return false
  }
}

function copySymlink(sourcePath, destinationPath, level = 0) {
  const targetPath = fs.readlinkSync(sourcePath)
  const levelPrefix = ' '.repeat(level * 2)
  log(`${levelPrefix}Symlink found from ${sourcePath} to ${targetPath}`)
  fs.symlinkSync(targetPath, destinationPath)
  log(`${levelPrefix}Symlink recreated from ${sourcePath} to ${destinationPath} with target ${targetPath}`)
}

const fetchGitTags = async (repo) => {
  try {
    // Find git in path
    let git_path = null
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
    log('Versions saved to file.')
  } catch (error) {
    log('Error saving versions to file: ' + error)
  }
}

function getCurrentUbuntuVersion() {
  try {
    const osReleaseData = fs.readFileSync('/etc/os-release', 'utf8')
    const lines = osReleaseData.split('\n')
    const versionLine = lines.find(line => line.startsWith('VERSION_ID='))
    if (versionLine) {
      const version = versionLine.split('=')[1].replace(/"/g, '')
      return version
    }
    throw new Error('Ubuntu version not found')
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
    }
  }
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
  const levelPrefix = '  '.repeat(level)
  try {
    // Iterate all files in source directory
    const files = fs.readdirSync(source)
    let count = 0
    for (const file of files) {
      count++
      const source_path = path.join(source, file)
      const destination_path = path.join(destination, file)
      log(`${levelPrefix}${count}) Handle move from ${source_path} to ${destination_path}`)
      if (isSymlink(source_path)) {
        log(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`)
        copySymlink(source_path, destination_path, level)
      } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
        log(`${levelPrefix}${count}) Merge directory ${source_path} with existing ${destination_path}`)
        const ok = await moveWithPermissions(source_path, destination_path, copyInstead, level + 1)
        if (!ok) {
          throw new Error(`Failed to move ${source_path} to ${destination_path}`)
        }
      } else /* regular file or directory that doesn't exist at destination */ {
        if (!copyInstead) {
          log(`${levelPrefix}${count}) Moving ${source_path} to ${destination_path}`)
          await io.mv(source_path, destination_path)
        } else {
          log(`${levelPrefix}${count}) Copy ${source_path} to ${destination_path}`)
          await io.cp(source_path, destination_path, {recursive: true})
        }
      }
    }
    log(`${levelPrefix}Successfully moved ${source} to ${destination}.`)
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
  let sudo_path = null
  try {
    sudo_path = await io.which('sudo')
    log(`sudo found at ${sudo_path}`)
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
  let add_apt_repository_path = null
  try {
    add_apt_repository_path = await io.which('add-apt-repository')
    log(`add-apt-repository found at ${add_apt_repository_path}`)
  } catch (error) {
    add_apt_repository_path = null
  }
  if (add_apt_repository_path === null || add_apt_repository_path === '') {
    if (isSudoRequired()) {
      ensureSudoIsAvailable()
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
  await ensureSudoIsAvailable()
  const levelPrefix = '  '.repeat(level)
  const files = fs.readdirSync(source)
  let count = 0
  for (const file of files) {
    const source_path = path.join(source, file)
    const destination_path = path.join(destination, file)
    count++
    if (isSymlink(source_path)) {
      log(`${levelPrefix}${count}) Recreate symlink ${source_path} in ${destination_path}`)
      const target_path = fs.readlinkSync(source_path)
      log(`${levelPrefix}${count}) Symlink found from ${source_path} to ${target_path}`)
      const ln_command = `sudo ln -sf "${target_path}" "${destination_path}"`
      const {exitCode: exitCode, stdout: stdout} = await exec.getExecOutput(ln_command)
      log(`${levelPrefix}${count}) Symlink recreated from ${source_path} to ${destination_path} with target ${target_path}`)
    } else if (fs.statSync(source_path).isDirectory() && fs.existsSync(destination_path)) {
      const ok = await moveWithSudo(source_path, destination_path, copyInstead, level + 1)
      if (!ok) {
        return false
      }
    } else {
      const mkdir_command = `sudo mkdir -p "${destination}"`
      if (!fs.existsSync(destination_path)) {
        const {exitCode: exitCode, stdout: stdout} = await exec.getExecOutput(mkdir_command)
      }
      const mv_command = `sudo mv "${source_path}" "${destination}"`
      const cp_command = `sudo cp -r "${source_path}" "${destination}"`
      const command = copyInstead ? cp_command : mv_command
      const {exitCode: exitCode, stdout: stdout} = await exec.getExecOutput(command)
      const sudo_output = stdout.trim()
      if (exitCode !== 0) {
        core.warning(`${levelPrefix}${count}) Error occurred while moving with sudo: exit code ${exitCode}`)
        log(sudo_output)
        return false
      } else {
        log(`${levelPrefix}${count}) Successfully moved ${source_path} to ${destination_path} with sudo.`)
      }
    }
  }
  return true
}

async function install_program_from_url(names, version, check_latest, url_template, update_environment, install_prefix = null) {
  let output_version = null
  let output_path = null

  // Render URL template
  const coercedVersion = semver.coerce(version) || semver.coerce('0.0.0')
  const data = {
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
  const url = renderTemplate(url_template, data)
  if (url_template !== url) {
    log(`Template data: ${JSON.stringify(data)}`)
    log(`Template "${url_template}" rendered as "${url}"`)
  }

  // Download and extract archive to temporary directory
  let extPath = null
  try {
    const toolPath = await tc.downloadTool(url)
    log(`Downloaded ${url} to ${toolPath}`)
    // Extract
    if (url.endsWith('.zip')) {
      extPath = await tc.extractZip(toolPath)
    } else if (url.endsWith('.tar.gz')) {
      extPath = await tc.extractTar(toolPath)
    } else if (url.endsWith('.tar.xz')) {
      extPath = await tc.extractTar(toolPath, undefined, 'xJ')
    } else if (url.endsWith('.tar.bz2')) {
      extPath = await tc.extractTar(toolPath, undefined, 'xj')
    } else if (url.endsWith('.7z')) {
      extPath = await tc.extract7z(toolPath)
    } else if (process.platform === 'darwin' && url.endsWith('.pkg')) {
      extPath = await tc.extractXar(toolPath)
    } else {
      throw new Error(`Unsupported archive format: ${path.basename(url)}`)
    }
    log(`Extracted ${toolPath} to ${extPath}`)
  } catch (error) {
    log(error.message)
    return {output_version, output_path}
  }

  // Identify if extPath has a single directory and use it instead
  // This should be true for most archives, where the real directory to be
  // installed is one level down
  const files = fs.readdirSync(extPath)
  if (files.length === 1) {
    const subPath = path.join(extPath, files[0])
    const fileStat = fs.statSync(subPath)
    if (fileStat.isDirectory()) {
      log(`${names.join(', ')} ultimately installed in single subdir ${subPath}`)
      // List all files in subpath
      const subFiles = fs.readdirSync(subPath)
      log(`Files in ${subPath}: [${subFiles.join(', ')}]`)
      extPath = subPath
    }
  }

  // Install to prefix or to cache directory
  if (install_prefix !== null) {
    log(`Moving ${extPath} to ${install_prefix}`)
    const move_ok = await moveWithPermissions(extPath, install_prefix)
    if (!move_ok) {
      log(`Failed to move ${extPath} to ${install_prefix}. Aborting.`)
      return {output_version, output_path}
    }
  } else {
    // Cache
    log(`Caching tools`)
    const cachedPath = await tc.cacheDir(extPath, names[0], coercedVersion.toString())
    install_prefix = cachedPath
  }

  log(`Installed in ${install_prefix}`)
  if (update_environment) {
    core.addPath(install_prefix)
  }

  // Recursively iterate all subdirectories of extPath looking for ${name} executable
  const installPrefixSubdirectories = [install_prefix, path.join(install_prefix, 'bin')].concat(getAllSubdirectories(install_prefix))
  log(`Looking for ${names.join(', ')} binary in installed ${install_prefix} subdirectories`)
  const __ret2 = await find_program_in_paths(installPrefixSubdirectories, names, version, check_latest, true)
  output_version = __ret2.output_version
  output_path = __ret2.output_path

  return {output_version, output_path}
}

async function run() {
  try {
    // Get trace_commands input first
    trace_commands = core.getBooleanInput('trace-commands')
    log(`trace_commands: ${trace_commands}`)

    // Get inputs
    const name = core.getInput('name').split(' ').filter((name) => name !== '')
    if (name.length === 0) {
      core.setFailed('name input is required')
      return
    }
    log(`name: [${name.join(', ')}]`)
    const version = core.getInput('version') || '*'
    log(`version: ${version}`)
    const paths = core.getInput('path').split(/[:;]/).filter((path) => path !== '')
    log(`paths: ${paths}`)
    const check_latest = core.getBooleanInput('check-latest')
    log(`check_latest: ${check_latest}`)
    const update_environment = core.getBooleanInput('update-environment')
    log(`update_environment: ${update_environment}`)
    const url = core.getInput('url') || null
    log(`url: ${url}`)
    const install_prefix = core.getInput('install-prefix') || null
    log(`install_prefix: ${install_prefix}`)
    const fail_on_error = core.getBooleanInput('fail-on-error')
    log(`fail_on_error: ${fail_on_error}`)

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
    core.info(`Searching for ${name} ${version} in paths [${paths.join(',')}]`)
    const __ret = await find_program_in_path(paths, version, check_latest)
    output_version = __ret.output_version
    output_path = __ret.output_path

    // Setup system program
    if (output_path === null) {
      core.info(`Searching for ${name} ${version} in PATH`)
      const __ret = await find_program_in_system_paths(paths, name, version, check_latest)
      output_version = __ret.output_version
      output_path = __ret.output_path
    }

    // Setup APT program
    if (output_version === null && process.platform === 'linux') {
      core.info(`Searching for ${name} ${version} with APT`)
      const __ret = await find_program_with_apt(name, version, check_latest)
      output_version = __ret.output_version
      output_path = __ret.output_path
    } else {
      if (output_version !== null) {
        log(`Skipping APT step because ${name} ${output_version} was already found in ${output_path}`)
      } else if (process.platform !== 'linux') {
        log(`Skipping APT step because platform is ${process.platform}`)
      }
    }

    // Install program
    if (output_version === null && url !== null) {
      core.info(`Fetching ${name} ${version} from URL`)
      const __ret = await install_program_from_url(name, version, check_latest, url, update_environment, install_prefix)
      output_version = __ret.output_version
      output_path = __ret.output_path
    } else {
      if (output_version !== null) {
        log(`Skipping download step because ${name} ${output_version} was already found in ${output_path}`)
      } else if (url === null) {
        log(`Skipping download step because no URL was provided. URL: ${url}`)
      }
    }

    // Parse Final program / Setup version / Outputs
    if (output_path !== null && output_path !== undefined) {
      core.setOutput('path', output_path)
      log(`Setting output path to ${output_path}`)
      core.setOutput('dir', path.dirname(output_path))
      log(`Setting output dir to ${path.dirname(output_path)}`)
      const v = output_version !== null ? semver.parse(output_version, {
        includePrerelease: false, loose: true
      }) : semver.parse('0.0.0', {includePrerelease: false, loose: true})
      core.setOutput('version', v.toString())
      log(`Setting output version to ${v.toString()}`)
      core.setOutput('version-major', v.major)
      log(`Setting output version-major to ${v.major}`)
      core.setOutput('version-minor', v.minor)
      log(`Setting output version-minor to ${v.minor}`)
      core.setOutput('version-patch', v.patch)
      log(`Setting output version-patch to ${v.patch}`)
      core.setOutput('found', true)
    } else {
      core.setOutput('found', false)
      if (fail_on_error) {
        core.setFailed('Cannot find program')
      } else {
        core.info('Cannot find program')
      }
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

if (require.main === module) {
  run()
}

module.exports = {
  find_program_in_path,
  find_program_in_system_paths,
  find_program_with_apt,
  install_program_from_url,
  trace_commands,
  set_trace_commands,
  isSudoRequired,
  fetchGitTags,
  readVersionsFromFile,
  saveVersionsToFile,
  getCurrentUbuntuVersion,
  moveWithPermissions,
  getCurrentUbuntuName,
  ensureSudoIsAvailable,
  ensureAddAptRepositoryIsAvailable
}
