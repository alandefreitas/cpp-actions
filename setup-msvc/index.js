const core = require('@actions/core')
const child_process = require('child_process')
const fs = require('fs')
const path = require('path')
const process = require('process')
const io = require('@actions/io')
const exec = require('@actions/exec')
const semver = require('semver')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')
const {reportAndSetFailed} = require('pretty-errors')

const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)']
const PROGRAM_FILES = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']]


const EDITIONS = ['Enterprise', 'Professional', 'Community']

// Visual Studio exposes multiple overlapping identifiers:
// - Release year (e.g., 2022)
// - Product version (e.g., 17.0)
// - MSVC toolset version (e.g., 14.42)
// - MSVC compiler front-end version (e.g., 19.44)
// This map keeps release-year/product-version relationships explicit so callers can be precise.
const RELEASE_YEAR_TO_PRODUCT_VERSION = {
    '2026': '18.0',
    '2022': '17.0',
    '2019': '16.0',
    '2017': '15.0',
    '2015': '14.0',
    '2013': '12.0'
}

const YEARS = Object.keys(RELEASE_YEAR_TO_PRODUCT_VERSION)

function getDefaultArch() {
    return process.env['PROCESSOR_ARCHITECTURE'] || 'x64'
}

function listInstalledToolsets(vcvarsallPath) {
    if (!vcvarsallPath) {
        return []
    }
    const vcRoot = path.dirname(path.dirname(path.dirname(vcvarsallPath)))
    const toolsetRoot = path.join(vcRoot, 'Tools', 'MSVC')
    if (!fs.existsSync(toolsetRoot)) {
        return []
    }
    return fs.readdirSync(toolsetRoot, {withFileTypes: true})
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
}

function selectToolsetVersion(requestedVersion, installedVersions) {
    if (!requestedVersion || requestedVersion === '*') {
        return null
    }
    const normalizedInstalled = installedVersions
        .map((version) => ({version, semver: semver.coerce(version)}))
        .filter(({semver: s}) => s !== null)
        .sort((a, b) => semver.rcompare(a.semver, b.semver))

    const satisfying = normalizedInstalled.find(({semver: s}) => semver.satisfies(s, requestedVersion, {includePrerelease: true}))
    return satisfying ? satisfying.version : null
}

/**
 * Extracts the MSVC toolset version from the compiler path as a fallback when the environment omits it.
 * @param {string} compilerPath - Absolute path to cl.exe.
 * @returns {?string} Toolset version string such as 14.44.35207 when detected.
 */
function inferToolsetVersionFromPath(compilerPath) {
    if (!compilerPath) {
        return null
    }
    const normalized = compilerPath.replace(/\\/g, '/').toLowerCase()
    const match = normalized.match(/msvc\/(\d+\.\d+\.\d+)/)
    if (match) {
        return match[1]
    }
    return null
}

/**
 * Converts a Visual Studio release year into the product-version form (e.g., 2022 → 17.0).
 *
 * @param {string} releaseYearOrProduct - Visual Studio release year (e.g. 2022) or product version (e.g. 17.0).
 * @returns {string} The Visual Studio product version string (e.g. 17.0).
 *
 * @example
 * // Returns '17.0' for the 2022 release line
 * releaseYearToProductVersion('2022')
 *
 * @example
 * // Returns '17.5' when the calling code already supplied the number
 * releaseYearToProductVersion('17.5')
 *
 * @remarks
 * The lookup table in {@link RELEASE_YEAR_TO_PRODUCT_VERSION} must be updated when new Visual Studio
 * releases become available; otherwise newer year inputs will fall through and be
 * returned as-is. Callers should be prepared for that pass-through behavior.
 */
function releaseYearToProductVersion(releaseYearOrProduct) {
    if (Object.values(RELEASE_YEAR_TO_PRODUCT_VERSION).includes(releaseYearOrProduct)) {
        return releaseYearOrProduct
    }
    if (releaseYearOrProduct in RELEASE_YEAR_TO_PRODUCT_VERSION) {
        return RELEASE_YEAR_TO_PRODUCT_VERSION[releaseYearOrProduct]
    }
    return releaseYearOrProduct
}

/**
 * Converts a Visual Studio product version into the release-year form (e.g., 17.0 → 2022).
 *
 * @param {string} productVersionOrYear - Visual Studio product version (e.g., 17.0) or release year.
 * @returns {string} The release year string when available, otherwise the original input.
 *
 * @example
 * // Returns '2022'
 * productVersionToReleaseYear('17.0')
 *
 * @example
 * // Returns '16.9' unchanged because the table does not contain that patch release
 * productVersionToReleaseYear('16.9')
 *
 * @remarks
 * When {@link RELEASE_YEAR_TO_PRODUCT_VERSION} grows stale the function simply returns the input value,
 * so downstream code should tolerate non-year strings.
 */
function productVersionToReleaseYear(productVersionOrYear) {
    if (Object.keys(RELEASE_YEAR_TO_PRODUCT_VERSION).includes(productVersionOrYear)) {
        return productVersionOrYear
    }
    const normalizedProduct = semver.coerce(productVersionOrYear)
    if (normalizedProduct) {
        for (const [year, version] of Object.entries(RELEASE_YEAR_TO_PRODUCT_VERSION)) {
            const normalizedMapVersion = semver.coerce(version)
            if (normalizedMapVersion && normalizedMapVersion.major === normalizedProduct.major) {
                return year
            }
        }
    }
    for (const [year, version] of Object.entries(RELEASE_YEAR_TO_PRODUCT_VERSION)) {
        if (version === productVersionOrYear) {
            return year
        }
    }
    return productVersionOrYear
}

const VSWHERE_PATH = `${PROGRAM_FILES_X86}\\Microsoft Visual Studio\\Installer`

/**
 * Locates a Visual Studio installation path matching the provided constraints via vswhere.
 *
 * @param {string} pattern - Relative path to append to the vswhere installation root.
 * @param {string} version_pattern - vswhere version range selector.
 * @returns {?string} Absolute path if found, otherwise null.
 *
 * @example
 * // Retrieves the latest vcvarsall location or null when vswhere is missing
 * findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', '-latest')
 *
 * @remarks
 * vswhere is not guaranteed to exist on self-hosted agents. In that case the
 * function logs a warning and returns null so callers can fall back to manual probes.
 */
function findWithVswhere(pattern, version_pattern) {
    try {
        let installationPath = child_process.execSync(`vswhere -products * ${version_pattern} -prerelease -property installationPath`).toString().trim()
        return installationPath + '\\' + pattern
    } catch (e) {
        core.warning(`vswhere failed: ${e}`)
    }
    return null
}

/**
 * Searches for the vcvarsall.bat script using vswhere first and then conventional install paths.
 *
 * @param {string} vsversion - Visual Studio version/year constraint.
 * @returns {string} Absolute path to vcvarsall.bat.
 * @throws When no suitable installation is detected.
 *
 * @example
 * const vcvarsPath = findVcvarsall('2022')
 *
 * @remarks
 * The probing logic iterates multiple well-known directories; installations in
 * custom locations may still evade detection. Consumers should catch the error
 * to provide actionable diagnostics.
 */
function findVcvarsall(vsversion) {
    const vsversion_number = releaseYearToProductVersion(vsversion)
    let version_pattern
    if (vsversion_number) {
        const upper_bound = vsversion_number.split('.')[0] + '.9'
        version_pattern = `-version "${vsversion_number},${upper_bound}"`
    } else {
        version_pattern = '-latest'
    }

    // If vswhere is available, ask it about the location of the latest Visual Studio.
    let path = findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', version_pattern)
    if (path && fs.existsSync(path)) {
        core.info(`Found with vswhere: ${path}`)
        return path
    }
    core.info('Not found with vswhere')

    // If that does not work, try the standard installation locations,
    // starting with the latest and moving to the oldest.
    const years = vsversion ? [productVersionToReleaseYear(vsversion)] : YEARS
    for (const prog_files of PROGRAM_FILES) {
        for (const ver of years) {
            for (const ed of EDITIONS) {
                path = `${prog_files}\\Microsoft Visual Studio\\${ver}\\${ed}\\VC\\Auxiliary\\Build\\vcvarsall.bat`
                core.info(`Trying standard location: ${path}`)
                if (fs.existsSync(path)) {
                    core.info(`Found standard location: ${path}`)
                    return path
                }
            }
        }
    }
    core.info('Not found in standard locations')

    // Special case for Visual Studio 2015 (and maybe earlier), try it out too.
    path = `${PROGRAM_FILES_X86}\\Microsoft Visual C++ Build Tools\\vcbuildtools.bat`
    if (fs.existsSync(path)) {
        core.info(`Found VS 2015: ${path}`)
        return path
    }
    core.info(`Not found in VS 2015 location: ${path}`)

    throw new Error('Microsoft Visual Studio not found')
}

/**
 * Determines whether the provided environment variable name is PATH-like.
 *
 * @param {string} name - Environment variable name.
 * @returns {boolean} True when the variable represents a path list.
 *
 * @example
 * isPathVariable('LIB') // true
 *
 * @example
 * isPathVariable('TEMP') // false
 */
function isPathVariable(name) {
    const pathLikeVariables = ['PATH', 'INCLUDE', 'LIB', 'LIBPATH']
    return pathLikeVariables.indexOf(name.toUpperCase()) !== -1
}

/**
 * Deduplicates entries in a PATH-style string while preserving order.
 *
 * @param {string} path - Semi-colon separated path string.
 * @returns {string} Deduplicated path string.
 *
 * @example
 * deduplicatePathValue('C:\\bin;C:\\bin;D:\\bin') // 'C:\\bin;D:\\bin'
 *
 * @remarks
 * Empty segments are preserved intentionally to avoid mutating the caller's
 * environment in unexpected ways.
 */
function deduplicatePathValue(path) {
    let paths = path.split(';')
    // Remove duplicates by keeping the first occurrence and preserving order.
    // This keeps path shadowing working as intended.
    function unique(value, index, self) {
        return self.indexOf(value) === index
    }

    return paths.filter(unique).join(';')
}

/**
 * Configures the MSVC developer command prompt and returns compiler metadata for action outputs.
 *
 * @param {string} arch - Target architecture (x86, x64, arm64, etc.).
 * @param {string} sdk - Optional SDK version requested by the caller.
 * @param {string} toolset - MSVC toolset version (vcvars_ver) override.
 * @param {string} uwp - Whether to configure the UWP SDK ("true" to enable).
 * @param {string} spectre - Whether to enable Spectre mitigated libraries ("true" to enable).
 * @param {string} vsversion - Visual Studio version/year selector for discovery.
 * @returns {Promise<object>} Paths and version fields suitable for action outputs.
 *
 * @example
 * const outputs = await setupMSVCCompiler('x64', '', '', '', '', '2022')
 * core.info(outputs.cc)
 *
 * @remarks
 * The function throws when executed outside Windows or when vcvarsall cannot be
 * located. If the environment contains multiple Visual Studio versions the
 * `vsversion` filter keeps the selection deterministic.
 */
async function configureMSVCEnvironment(arch, sdk, toolset, uwp, spectre, vsversion) {
    if (!arch) {
        arch = getDefaultArch()
    }
    if (process.platform !== 'win32') {
        throw new Error('MSVC compiler setup is only supported on Windows environments')
    }

    // Add standard location of "vswhere" to PATH, in case it's not there.
    process.env.PATH += path.delimiter + VSWHERE_PATH

    // There are all sorts of way the architectures are called. In addition to
    // values supported by Microsoft Visual C++, recognize some common aliases.
    let arch_aliases = {
        'win32': 'x86',
        'win64': 'x64',
        'x86_64': 'x64',
        'x86-64': 'x64'
    }
    // Ignore case when matching as that's what humans expect.
    if (arch.toLowerCase() in arch_aliases) {
        arch = arch_aliases[arch.toLowerCase()]
    }

    // Due to the way Microsoft Visual C++ is configured, we have to resort to the following hack:
    // Call the configuration batch file and then output *all* the environment variables.

    const args = [arch]
    if (uwp == 'true') {
        args.push('uwp')
    }
    if (sdk) {
        args.push(sdk)
    }


    core.startGroup('🔍 Find vcvarsall.bat')
    const vcvarsallPath = findVcvarsall(vsversion)
    const installedToolsets = listInstalledToolsets(vcvarsallPath)
    core.startGroup('📦 Installed MSVC toolsets')
    if (installedToolsets.length > 0) {
        core.info(`Available toolsets: [${installedToolsets.join(', ')}]`)
    } else {
        core.info(`No MSVC toolset folders were detected under ${path.join(path.dirname(path.dirname(path.dirname(vcvarsallPath))), 'Tools', 'MSVC')}`)
    }
    core.endGroup()
    const resolvedToolset = selectToolsetVersion(toolset, installedToolsets)
    if (toolset && !resolvedToolset) {
        core.startGroup('⚠️ Toolset warning')
        core.warning(`Requested toolset version '${toolset}' not found. Available versions: [${installedToolsets.join(', ')}]. Falling back to Visual Studio default.`)
        core.endGroup()
    }
    if (resolvedToolset) {
        args.push(`-vcvars_ver=${resolvedToolset}`)
    }
    if (spectre == 'true') {
        args.push('-vcvars_spectre_libs=spectre')
    }
    const vcvars = `"${vcvarsallPath}" ${args.join(' ')}`
    core.debug(`vcvars command-line: ${vcvars}`)

    const cmd_output_string = child_process.execSync(`set && cls && ${vcvars} && cls && set`, {shell: 'cmd'}).toString()
    const cmd_output_parts = cmd_output_string.split('\f')

    const old_environment = cmd_output_parts[0].split('\r\n')
    const vcvars_output = cmd_output_parts[1].split('\r\n')
    const new_environment = cmd_output_parts[2].split('\r\n')

    // If vsvars.bat is given an incorrect command line, it will print out
    // an error and *still* exit successfully. Parse out errors from output
    // which don't look like environment variables, and fail if appropriate.
    const error_messages = vcvars_output.filter((line) => {
        if (line.match(/^\[ERROR.*\]/)) {
            // Don't print this particular line which will be confusing in output.
            if (!line.match(/Error in script usage. The correct usage is:$/)) {
                return true
            }
        }
        return false
    })
    if (error_messages.length > 0) {
        throw new Error('invalid parameters' + '\r\n' + error_messages.join('\r\n'))
    }

    // Convert old environment lines into a dictionary for easier lookup.
    let old_env_vars = {}
    for (let string of old_environment) {
        const [name, value] = string.split('=')
        old_env_vars[name] = value
    }
    core.endGroup()

    // Now look at the new environment and export everything that changed.
    // These are the variables set by vsvars.bat. Also export everything
    // that was not there during the first sweep: those are new variables.
    core.startGroup('📘 Environment Variables')
    for (let string of new_environment) {
        // vsvars.bat likes to print some fluff at the beginning.
        // Skip lines that don't look like environment variables.
        if (!string.includes('=')) {
            continue
        }
        let [name, new_value] = string.split('=')
        let old_value = old_env_vars[name]
        // For new variables "old_value === undefined".
        if (new_value !== old_value) {
            core.info(`Setting ${name}`)
            // Special case for a bunch of PATH-like variables: vcvarsall.bat
            // just prepends its stuff without checking if its already there.
            // This makes repeated invocations of this action fail after some
            // point, when the environment variable overflows. Avoid that.
            if (isPathVariable(name)) {
                new_value = deduplicatePathValue(new_value)
            }
            core.exportVariable(name, new_value)
        }
    }

    core.info(`Configured Developer Command Prompt`)
    core.endGroup()

    const compilerPath = await findMSVCCompilerExecutable()
    if (compilerPath === null) {
        throw new Error('Cannot find cl.exe after configuring the MSVC developer command prompt')
    }

    const compilerVersion = await getMSVCCompilerVersion(compilerPath)

    return buildMSVCOutputs(compilerPath, process.env, {compilerVersion})
}

async function main(version, arch, sdk, toolset, uwp, spectre, vsversion) {
    const resolvedArch = arch || getDefaultArch()
    const resolvedToolset = toolset || (version && version !== '*' ? version : '')
    const normalizedUwp = uwp ? 'true' : 'false'
    const normalizedSpectre = spectre ? 'true' : 'false'

    const outputs = await configureMSVCEnvironment(
        resolvedArch,
        sdk || '',
        resolvedToolset,
        normalizedUwp,
        normalizedSpectre,
        vsversion || ''
    )

    return {
        ...outputs,
        version: outputs.release
    }
}

/**
 * Searches the PATH for cl.exe, accounting for different executable spellings.
 *
 * @returns {Promise<?string>} Absolute path to the compiler executable when found.
 *
 * @example
 * const clPath = await findMSVCCompilerExecutable()
 *
 * @remarks
 * The lookup simply walks PATH via {@link io.which}; if users override PATH
 * afterwards the helper may surface stale entries, so call it only after
 * configuring the Developer Command Prompt.
 */
async function findMSVCCompilerExecutable() {
    const candidates = ['cl.exe', 'cl']
    for (const candidate of candidates) {
        try {
            const resolved = await io.which(candidate)
            if (resolved) {
                core.debug(`Found ${candidate} at ${resolved}`)
                return resolved
            }
        } catch (error) {
            core.debug(`Could not locate ${candidate}: ${error}`)
        }
    }
    return null
}

/**
 * Reads the MSVC front-end compiler version (e.g., 19.44.35219) using `cl /Bv`.
 * @param {string} compilerPath - Absolute path to cl.exe.
 * @returns {?string} Version string when it can be parsed, otherwise null.
 */
async function getMSVCCompilerVersion(compilerPath) {
    if (!compilerPath) {
        return null
    }
    try {
        const {stdout} = await exec.getExecOutput(compilerPath, ['/Bv'], {ignoreReturnCode: true})
        const match = stdout.match(/Compiler Version ([0-9.]+)/i)
        if (match) {
            return match[1]
        }
    } catch (error) {
        core.debug(`Failed to detect MSVC compiler version: ${error}`)
    }
    return null
}

/**
 * Builds the output structure expected by setup-cpp consumers based on MSVC metadata.
 *
 * @param {string} compilerPath - Absolute path to cl.exe.
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment variables containing Visual Studio metadata.
 * @param {object} [metadata={}] - Additional metadata such as the parsed compilerVersion.
 * @returns {object} Compiler and version output fields.
 *
 * @example
 * const outputs = buildMSVCOutputs('C:\\VS\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64\\cl.exe', process.env)
 *
 * @remarks
 * When {@link env.VisualStudioVersion} is missing the helper falls back to
 * `0.0.0`, which keeps the action functional for older setups that do not expose
 * that variable.
 */
function buildMSVCOutputs(compilerPath, env = process.env, metadata = {}) {
    if (!compilerPath) {
        throw new Error('compilerPath is required to compute MSVC outputs')
    }

    const windowsPath = path.win32
    const normalizedCompilerPath = windowsPath.normalize(compilerPath)
    const bindir = windowsPath.dirname(normalizedCompilerPath)

    let dir = env.VCINSTALLDIR ? windowsPath.normalize(env.VCINSTALLDIR) : windowsPath.dirname(bindir)
    if (!dir || dir === '.' || dir === '') {
        dir = windowsPath.dirname(bindir)
    }

    const toolsetVersion = env.VCToolsVersion || inferToolsetVersionFromPath(normalizedCompilerPath)
    const toolsetSemver = toolsetVersion ? semver.coerce(toolsetVersion) : null
    const releaseString = toolsetSemver ? toolsetSemver.toString() : (toolsetVersion || '0.0.0')
    const version_major = toolsetSemver ? toolsetSemver.major : 0
    const version_minor = toolsetSemver ? toolsetSemver.minor : 0
    const version_patch = toolsetSemver ? toolsetSemver.patch : 0
    const productVersion = env.VisualStudioVersion || ''
    const releaseYear = productVersionToReleaseYear(productVersion)
    const compilerVersion = metadata.compilerVersion || ''

    return {
        cc: normalizedCompilerPath,
        cxx: normalizedCompilerPath,
        bindir,
        dir,
        release: releaseString,
        version_major,
        version_minor,
        version_patch,
        msvc_toolset_version: toolsetVersion || '',
        msvc_product_version: productVersion,
        msvc_release_year: releaseYear,
        msvc_compiler_version: compilerVersion
    }
}

let lastInputsForErrors = undefined

async function run() {
    const inputs = {
        version: gh_inputs.getInput('version', {defaultValue: '*'}),
        arch: gh_inputs.getInput('arch', {defaultValue: getDefaultArch()}),
        sdk: gh_inputs.getInput('sdk', {defaultValue: ''}),
        toolset: gh_inputs.getInput('toolset', {defaultValue: ''}),
        vsversion: gh_inputs.getInput('visual-studio-version', {defaultValue: ''}),
        uwp: gh_inputs.getBoolean('uwp'),
        spectre: gh_inputs.getBoolean('spectre'),
        trace_commands: gh_inputs.getBoolean('trace-commands')
    }

    lastInputsForErrors = inputs

    if (inputs.trace_commands) {
        trace_commands.set_trace_commands(true)
    }

    core.startGroup('📥 Action Inputs')
    gh_inputs.printInputObject(inputs)
    core.endGroup()

    const outputs = await main(
        inputs.version,
        inputs.arch,
        inputs.sdk,
        inputs.toolset,
        inputs.uwp,
        inputs.spectre,
        inputs.vsversion
    )

    core.startGroup('📤 Action Outputs')
    gh_inputs.setOutputObject(outputs)
    core.endGroup()
}

if (require.main === module) {
    (async () => {
        try {
            await run()
        } catch (error) {
            const hint = lastInputsForErrors?.trace_commands
                ? 'Trace commands already enabled; if this looks like a bug, please open an issue at github.com/alandefreitas/cpp-actions with stack and logs.'
                : 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true) for more logs. '
            await reportAndSetFailed(error, {
                title: 'Setup MSVC failed',
                hint,
                locals: () => ({inputs: lastInputsForErrors})
            })
        }
    })()
}

module.exports = {
    main,
    buildMSVCOutputs,
    releaseYearToProductVersion,
    productVersionToReleaseYear
}
