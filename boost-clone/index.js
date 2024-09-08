const core = require('@actions/core')
const exec = require('@actions/exec')
const tc = require('@actions/tool-cache')
const cache = require('@actions/cache')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const semver = require('semver')
const setup_program = require('setup-program')
const trace_commands = require('trace-commands')
const gh_inputs = require('gh-inputs')
const os = require('os')

const boostSuperProjectRepo = 'https://github.com/boostorg/boost.git'

async function findGitFeatures(inputs) {
    const gitPath = await setup_program.findGit()
    const {exitCode: exitCode, stdout} = await exec.getExecOutput(`"${gitPath}"`, ['--version'])
    const versionOutput = stdout.trim()
    const versionRegex = /(\d+\.\d+\.\d+)/
    const versionMatches = versionOutput.match(versionRegex)
    const versionStr = versionMatches[1]
    const version = semver.coerce(versionStr, {includePrerelease: false, loose: true})
    const supportsJobs = semver.gte(version, '2.27.0')
    const supportsScanScripts = semver.gte(version, '3.5.0')
    const supportsDepth = semver.gte(version, '2.17.0')
    return {gitPath, version, supportsJobs, supportsScanScripts, supportsDepth}
}

function readExceptions(exceptionsPath) {
    function fnlog(msg) {
        trace_commands.log(`readExceptions: ${msg}`)
    }

    // exceptions.txt is the output of "boostdep --list-exceptions"
    // It includes headers that cannot be associated to a module
    // following the usual `boost/<module>/path` rules.
    fnlog(`Reading exceptions from ${exceptionsPath}`)
    const exceptions = {}
    let module = null
    if (!fs.existsSync(exceptionsPath)) {
        throw new Error(`Exceptions file not found: ${exceptionsPath}`)
    }
    const lines = fs.readFileSync(exceptionsPath, 'utf-8').split('\n')
    for (const line of lines) {
        const trimmedLine = line.trim()
        const match = trimmedLine.match(/(.*):$/)
        if (match) {
            // Line contains a module name
            module = match[1].replace('~', '/')
        } else {
            // Line contains an exception for the current module
            exceptions[trimmedLine] = module
        }
    }
    return exceptions
}

function readGitmodules(gitmodulesPath) {
    function fnlog(msg) {
        trace_commands.log(`readGitmodules: ${msg}`)
    }

    let submodulePaths = new Set()
    if (!fs.existsSync(gitmodulesPath)) {
        throw new Error(`.gitmodules file not found: ${gitmodulesPath}`)
    }
    const lines = fs.readFileSync(gitmodulesPath, 'utf-8').split('\n')
    for (const line of lines) {
        const trimmedLine = line.trim()
        // Look for lines such as "path = libs/algorithm"
        const match = trimmedLine.match(/path\s*=\s*(.*)$/)
        if (match) {
            submodulePaths.add(match[1])
        }
    }
    return submodulePaths
}

function isModule(moduleName, submodulePaths) {
    return submodulePaths.has(`libs/${moduleName}`)
}

const loggedHeaders = new Set()

function moduleForHeader(header, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`moduleForHeader: ${msg}`)
    }

    if (header in exceptions) {
        return exceptions[header]
    }

    const headerRegexes = [
        // Something like "boost/function.hpp" -> "function"
        'boost/([^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^\\./]*)\\.h[a-z]*$',
        // Something like "boost/numeric/conversion/header.hpp" -> "numeric/conversion"
        'boost/([^/]*/[^/]*)/',
        // Something like "boost/function/header.hpp" -> "function"
        'boost/([^/]*)/'
    ]

    for (const regex of headerRegexes) {
        const match = header.match(regex)
        if (match && isModule(match[1], submodulePaths)) {
            return match[1]
        }
    }

    if (!loggedHeaders.has(header)) {
        fnlog(`Cannot determine module for header: ${header}`)
        loggedHeaders.add(header)
    }
    return null
}

async function scanHeaderDependencies(fileContents, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`scanHeaderDependencies: ${msg}`)
    }

    let modules = new Set()
    const lines = fileContents.split('\n')
    for (const line of lines) {
        const match = line.match('[ \t]*#[ \t]*include[ \t]*["<](boost/[^">]*)[">]')
        if (match) {
            const header = match[1]
            const module = moduleForHeader(header, exceptions, submodulePaths)
            if (module) {
                modules.add(module)
            }
        }
    }
    return modules
}

async function scanSubdirectoryDependencies(dir, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`scanSubdirectoryDependencies: ${msg}`)
    }

    fnlog(`Scanning directory: ${dir}`)
    let modules = new Set()
    const files = fs.readdirSync(dir)
    for (const file of files) {
        const filePath = path.resolve(path.join(dir, file))
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
            fnlog(`Scanning subdir: ${filePath}`)
            const subdirModules = await scanSubdirectoryDependencies(filePath, exceptions, submodulePaths)
            subdirModules.forEach(module => modules.add(module))
        } else {
            const fileContents = fs.readFileSync(filePath, 'utf-8')
            const fileModules = await scanHeaderDependencies(fileContents, exceptions, submodulePaths)
            fileModules.forEach(module => modules.add(module))
        }
    }
    return modules
}

async function listBoostDependencies(dir, subdirs, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`listBoostDependencies: ${msg}`)
    }

    fnlog(`Scanning subdirs of ${dir}`)
    let modules = new Set()
    for (const subdir of subdirs) {
        const subdirPath = path.resolve(path.join(dir, subdir))
        if (!fs.existsSync(subdirPath)) {
            continue
        }
        fnlog(`Scanning subdir: ${subdirPath} for Boost dependencies`)
        const subdirModules = await scanSubdirectoryDependencies(subdirPath, exceptions, submodulePaths)
        for (const module of subdirModules) {
            modules.add(module)
        }
    }
    return modules
}

async function scanBoostDependencies(scanDir, inputs, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`scanDeps: ${msg}`)
    }

    const dir = scanDir
    const ignore = inputs.scan_modules_ignore
    const include = inputs.modules_scan_paths
    const exclude = inputs.modules_exclude_paths

    let subdirs = ['include', 'src', 'source', 'test', 'tests', 'example', 'examples']
    for (const subdir of exclude) {
        if (subdirs.includes(subdir)) {
            subdirs = subdirs.filter((dir) => dir !== subdir)
        }
    }
    for (const subdir of include) {
        if (!subdirs.includes(subdir)) {
            subdirs.push(subdir)
        }
    }
    core.info(`Directories to scan: ${subdirs.join(', ')}`)

    const modules = await listBoostDependencies(dir, subdirs, exceptions, submodulePaths)
    core.info(`Scanned modules: ${gh_inputs.makeValueString(modules)}`)

    for (const ignored of ignore) {
        if (modules.has(ignored)) {
            modules.delete(ignored)
        }
    }
    modules.delete(null)

    return modules
}

async function getGitHash(repoUrl, branch, gitFeatures) {
    const {exitCode, stdout} = await exec.getExecOutput(`"${gitFeatures.gitPath}"`, [
        'ls-remote', repoUrl, branch])
    if (exitCode !== 0) {
        throw new Error(`Failed to get hash for ${repoUrl} at branch ${branch}`)
    }
    return stdout.trim().split('\t')[0]
}

function getModuleRepoUrl(module) {
    return `https://github.com/boostorg/${module.replace('/', '_')}.git`
}

async function generateCacheKey(inputs, allModules, gitFeatures) {
    function fnlog(msg) {
        trace_commands.log(`generateCacheKey: ${msg}`)
    }

    const boostHash = await getGitHash(boostSuperProjectRepo, inputs.branch, gitFeatures)
    fnlog(`Boost hash at ${inputs.branch}: ${boostHash}`)

    let moduleHashes = {}
    if (inputs.optimistic_caching) {
        // Optimistic caching: only modules and patches define the key
        // Pessimistic caching: we'll clone all modules, so we only need the
        // hash of the super-project
        for (const module of allModules) {
            const moduleRepoUrl = getModuleRepoUrl(module)
            const moduleRepoExists = await setup_program.urlExists(moduleRepoUrl)
            if (moduleRepoExists) {
                const moduleHash = await getGitHash(moduleRepoUrl, inputs.branch)
                fnlog(`Hash for module ${module}: ${moduleHash}`)
                moduleHashes[module] = moduleHash
            } else {
                moduleHashes[module] = boostHash
            }
        }
    }

    let patchHashes = {}
    for (const patch of inputs.patches) {
        const patchHash = await getGitHash(patch, inputs.branch)
        fnlog(`Hash for patch ${patch}: ${patchHash}`)
        patchHashes[patch] = patchHash
    }

    const concatenatedHashes = Object.values(moduleHashes).join('') + Object.values(patchHashes).join('')
    const modulesAndPatchesHash = crypto.createHash('sha1').update(concatenatedHashes).digest('hex')
    fnlog(`Modules hash (direct dependencies and patches): ${modulesAndPatchesHash}`)

    const cacheKey =
        // No modules or patches specified, we'll clone all modules
        allModules.length === 0 && inputs.patches.length === 0 ?
            `boost-source-${boostHash}` :
            inputs.optimistic_caching ?
                // Optimistic caching: only modules and patches define the key
                `boost-source-${modulesAndPatchesHash}` :
                // Pessimistic caching with no patches: we'll clone all modules
                inputs.patches.length === 0 ?
                    `boost-source-${boostHash}` :
                    // Pessimistic caching with patches: invalidate cache
                    // when any module or patch changes
                    `boost-source-${boostHash}-${modulesAndPatchesHash}`
    fnlog(`Cache key: ${cacheKey}`)

    return cacheKey
}

async function getCachedBoost(inputs, cacheKey) {
    core.info(`Checking cache for key: ${cacheKey}`)
    const hit = await cache.restoreCache([inputs.boost_dir], cacheKey, []) !== undefined
    if (hit) {
        core.info(`Cache hit! 🙂`)
    } else {
        core.info(`Cache miss! 😔`)
    }
    return hit
}

async function cacheBoost(inputs, cacheKey) {
    await cache.saveCache([inputs.boost_dir], cacheKey, {})
}

async function cloneBoostSuperproject(inputs) {
    await setup_program.cloneGitRepo(boostSuperProjectRepo, inputs.boost_dir, inputs.branch)
}

function getRepoName(url) {
    // Strip query parameters and fragment identifiers
    const cleanUrl = url.split(/[?#]/)[0]

    // Remove trailing slashes and the `.git` extension if present
    return cleanUrl.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop()
}

async function applyPatches(inputs) {
    function fnlog(msg) {
        trace_commands.log(`applyPatches: ${msg}`)
    }

    for (const patch of inputs.patches) {
        const patchName = getRepoName(patch)
        const patchDir = path.join(inputs.boost_dir, 'libs', patchName)
        if (fs.existsSync(patchDir)) {
            fnlog(`Removing existing directory: ${patchDir}`)
            fs.rmdirSync(patchDir, {recursive: true})
        }
        await setup_program.cloneGitRepo(patch, patchDir, inputs.branch)
    }
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

async function initializeSubmodules(inputs, allModules, gitFeatures, exceptions, submodulePaths) {
    function fnlog(msg) {
        trace_commands.log(`initializeSubmodules: ${msg}`)
    }

    const jobsArgs = gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : []
    const depthArgs = gitFeatures.supportsDepth ? ['--depth', '1'] : []
    const gitArgs = jobsArgs.concat(depthArgs).concat(['-q'])

    const allModulesSubPaths = new Set(Array.from(allModules).map((module) => `libs/${module}`))
    const essentialModuleSubPaths = new Set(['libs/config', 'libs/headers', 'tools/boost_install', 'tools/build', 'tools/cmake'])
    const initialModuleSubpaths = new Set(Array.from(allModulesSubPaths).concat(Array.from(essentialModuleSubPaths)))
    for (const moduleSubPath of initialModuleSubpaths) {
        const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath])
        await exec.exec(`"${gitFeatures.gitPath}"`, args, {cwd: inputs.boost_dir})
    }

    let initializedModules = new Set(allModules)
    initializedModules.add('config')
    initializedModules.add('headers')
    let scannedModules = new Set()
    let remainingModules = new Set(initializedModules)
    while (remainingModules.size > 0) {
        fnlog(`==== ${remainingModules.size} modules remaining to scan ====`)
        fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`)
        fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`)
        fnlog(`Scanned modules: ${gh_inputs.makeValueString(scannedModules)}`)

        const module = remainingModules.values().next().value
        const modulePath = path.resolve(path.join(inputs.boost_dir, 'libs', module))
        const moduleInputs = {
            ...inputs,
            scan_modules_ignore: new Set([module]),
            modules_scan_paths: new Set(),
            modules_exclude_paths: new Set(['test', 'tests', 'example', 'examples'])
        }
        const submodules = await scanBoostDependencies(modulePath, moduleInputs, exceptions, submodulePaths)
        fnlog(`Submodules of ${module}: ${gh_inputs.makeValueString(submodules)}`)
        scannedModules.add(module)
        remainingModules.delete(module)

        // Initialize submodules
        for (const submodule of submodules) {
            // Add to the list if not scanned yet
            if (!scannedModules.has(submodule)) {
                fnlog(`Submodule: ${submodule} has not been scanned yet`)
                remainingModules.add(submodule)
                fnlog(`Remaining modules: ${gh_inputs.makeValueString(remainingModules)}`)
            } else {
                fnlog(`Submodule: ${submodule} has already been scanned`)
            }
            // Initialize submodule if not initialized yet
            if (!initializedModules.has(submodule)) {
                fnlog(`Initializing submodule: ${submodule}`)
                const moduleSubPath = `libs/${submodule}`
                const args = ['submodule', 'update'].concat(gitArgs).concat(['--init', moduleSubPath])
                await exec.exec(`"${gitFeatures.gitPath}"`, args, {cwd: inputs.boost_dir})
                initializedModules.add(submodule)
                fnlog(`Initialized modules: ${gh_inputs.makeValueString(initializedModules)}`)
            } else {
                fnlog(`Submodule: ${submodule} has already been initialized`)
            }
        }
    }
}


async function initializeAllSubmodules(inputs, gitFeatures) {
    const args = ['submodule', 'update']
        .concat(gitFeatures.supportsDepth ? ['--depth', '1'] : [])
        .concat(gitFeatures.supportsJobs ? ['--jobs', `${numberOfCpus()}`] : [])
        .concat(['--init', '--recursive'])
    await exec.exec(`"${gitFeatures.gitPath}"`, args, {cwd: inputs.boost_dir})
}


async function main(inputs) {
    function fnlog(msg) {
        trace_commands.log(`main: ${msg}`)
    }

    let outputs = {boost_dir: inputs.boost_dir}

    core.startGroup('📐 Identify git features')
    const gitFeatures = await findGitFeatures(inputs)
    core.endGroup()

    // Get gitmodules and exceptions
    core.startGroup('🌍 Download .gitmodules and exceptions.txt')
    // .gitmodules
    const gitmodulesUrl = `https://raw.githubusercontent.com/boostorg/boost/${inputs.branch}/.gitmodules`
    const gitmodulesPath = path.resolve(await tc.downloadTool(gitmodulesUrl))
    core.info(`Downloaded ${gitmodulesUrl} to ${gitmodulesPath}`)
    const submodulePaths = readGitmodules(gitmodulesPath)
    fnlog(`Submodule Paths: ${gh_inputs.makeValueString(submodulePaths)}`)

    // exceptions.txt
    const exceptionsUrl = `https://raw.githubusercontent.com/boostorg/boostdep/${inputs.branch}/depinst/exceptions.txt`
    const exceptionsPath = path.resolve(await tc.downloadTool(exceptionsUrl))
    core.info(`Downloaded ${exceptionsUrl} to ${exceptionsPath}`)
    const exceptions = readExceptions(exceptionsPath, inputs.branch)
    fnlog(`Exceptions: ${JSON.stringify(exceptions)}`)
    core.endGroup()

    let allModules = new Set(inputs.modules)
    for (const scanDir of inputs.scan_modules_dir) {
        core.startGroup(`🔍 Scan Boost Modules Required by ${path.basename(scanDir)}`)
        const scannedModules = await scanBoostDependencies(scanDir, inputs, exceptions, submodulePaths)
        for (const module of scannedModules) {
            allModules.add(module)
        }
        core.endGroup()
    }

    core.startGroup('🔑 Calculate Boost Cache Key')
    const cacheKey = await generateCacheKey(inputs, allModules, gitFeatures)
    core.endGroup()

    if (inputs.cache) {
        core.startGroup('📦 Check Boost Cache')
        const cacheHit = await getCachedBoost(inputs, cacheKey)
        core.endGroup()
        if (cacheHit) {
            // And we're done
            return outputs
        }
    }

    // Clone boost
    core.startGroup('🚀 Clone Boost Super-project')
    await cloneBoostSuperproject(inputs)
    core.endGroup()

    // Apply patches
    if (inputs.patches.length > 0) {
        core.startGroup('🔨 Apply Boost Patches')
        await applyPatches(inputs)
        core.endGroup()
    }

    if (allModules.length === 0) {
        core.startGroup('🔧 Initialize All Boost Submodules')
        await initializeAllSubmodules(inputs, gitFeatures)
        core.endGroup()
    } else {
        core.startGroup('🔧 Initialize Boost Submodules')
        await initializeSubmodules(inputs, allModules, gitFeatures, exceptions, submodulePaths)
        core.endGroup()
    }

    // Cache boost
    if (inputs.cache) {
        core.startGroup(`📦 Cache Boost`)
        await cacheBoost(inputs, cacheKey)
        core.endGroup()
    }

    return outputs
}

async function run() {
    try {
        const inputs = {
            boost_dir: gh_inputs.getInput('boost-dir'),
            branch: gh_inputs.getInput('branch', {defaultValue: 'master'}),
            // Modules to clone
            modules: gh_inputs.getSet('modules'),
            patches: gh_inputs.getSet('patches'),
            scan_modules_ignore: gh_inputs.getSet('scan-modules-ignore'),
            // Paths to scan
            scan_modules_dir: new Set(gh_inputs.getMultilineInput('scan-modules-dir')),
            modules_scan_paths: gh_inputs.getSet('modules-scan-paths'),
            modules_exclude_paths: gh_inputs.getSet('modules-exclude-paths'),
            // Caching
            cache: gh_inputs.getBoolean('cache'),
            optimistic_caching: gh_inputs.getBoolean('optimistic-caching'),
            trace_commands: gh_inputs.getBoolean('trace-commands')
        }

        // Remove any empty entry from scan_modules_dir
        inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].filter((dir) => dir.trim() !== ''))
        // Resolve scan modules dir
        inputs.scan_modules_dir = new Set([...inputs.scan_modules_dir].map((dir) => path.resolve(dir)))

        // If Boost dir is not provided, we will use a temporary directory
        // for it. This directory will be returned as an output.
        if (!inputs.boost_dir) {
            const pathSuffix = `boost-${inputs.branch}`
            inputs.boost_dir = path.join(os.tmpdir(), pathSuffix)
        }
        inputs.boost_dir = path.resolve(inputs.boost_dir)

        if (inputs.trace_commands) {
            trace_commands.set_trace_commands(true)
        }

        core.startGroup('📥 Action Inputs')
        gh_inputs.printInputObject(inputs)
        core.endGroup()

        const outputs = await main(inputs)

        // Parse Final program / Setup version / Outputs
        if (outputs.boost_dir) {
            core.startGroup('📤 Action Outputs')
            gh_inputs.setOutputObject(outputs)
            core.endGroup()
        } else {
            core.setFailed('Cannot clone Boost')
        }
    } catch (error) {
        core.setFailed(`${error.message}\n${error.stack}`)
    }
}

if (require.main === module) {
    run().catch((error) => {
        console.error(error)
        core.setFailed(`${error.message}\n${error.stack}`)
    })
}

module.exports = {
    main
}