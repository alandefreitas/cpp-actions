const core = require('@actions/core')
// const github = require('@actions/github');
const semver = require('semver')
const {execSync} = require('child_process')
const setup_program = require('setup-program')
const Handlebars = require('handlebars')
const fs = require('fs')
const path = require('path')

let trace_commands = false

function log(...args) {
    if (trace_commands) {
        console.log(...args)
    }
}

function isTruthy(s) {
    if (typeof s === 'string') {
        return s !== '' && s.trim().toLowerCase() !== 'false'
    }
    return !!s
}

function parseCompilerRequirements(inputString) {
    const tokens = inputString.split(/[\n\s]+/)
    const compilers = {}

    let currentCompiler = null
    let currentRequirements = ''

    for (const token of tokens) {
        if (/^[a-zA-Z\-]+$/.test(token)) {
            if (currentCompiler) {
                compilers[currentCompiler] = semver.validRange(currentRequirements.trim(), {loose: true})
                currentRequirements = ''
            }
            currentCompiler = token
        } else {
            currentRequirements += ' ' + token.trim()
        }
    }

    if (currentCompiler) {
        compilers[currentCompiler] = currentRequirements.trim()
    }

    return compilers
}

function parseCompilerFactors(inputString, compilers) {
    const tokens = inputString.split(/[\n\s]+/)

    const compilerFactors = {}
    let currentCompiler = null
    let currentFactors = []

    for (const token of tokens) {
        if (compilers.includes(token)) {
            if (currentCompiler) {
                compilerFactors[currentCompiler] = currentFactors
                currentFactors = []
            }
            currentCompiler = token.trim()
        } else {
            currentFactors.push(token.trim())
        }
    }

    if (currentCompiler) {
        compilerFactors[currentCompiler] = currentFactors
    }

    return compilerFactors
}

function parseCompilerSuggestions(inputLines, compilers) {
    const containerOptions = []
    for (let line of inputLines) {
        line = line.trim()
        if (line === '') {
            continue
        }

        // <compiler-name>[ <compiler-range|compiler-factor>]: <value>
        // Split line at first colon. If there are more than one colon, the
        // second part includes all other colons
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) {
            core.warning(`Ignoring invalid container option "${line}". Missing ":".`)
            continue
        }
        const compilerPart = line.substring(0, colonIndex).trim()
        const containerPart = line.substring(colonIndex + 1).trim()
        // Split compiler part at first space
        const spaceIndex = compilerPart.indexOf(' ')
        // If there's no space, version is "*" is the rest is compiler
        // name. Otherwise, the first part is the compiler name and the
        // second part is the version range
        let compilerName = null
        let compilerDescriptor = null
        if (spaceIndex === -1) {
            compilerName = compilerPart
            compilerDescriptor = '*'
        } else {
            compilerName = compilerPart.substring(0, spaceIndex).trim()
            compilerDescriptor = compilerPart.substring(spaceIndex + 1).trim()
        }
        // Check if compilerDescriptor is a semver version
        const descriptorIsSemver = semver.validRange(compilerDescriptor, {loose: true})

        // Check if the compiler name matches one of the compilers we know about
        if (!compilers.includes(compilerName)) {
            core.warning(`Unknown compiler name "${compilerName}" in container options. Ignoring.`)
        }
        // Create entry
        const entry = {
            compiler: compilerName,
            range: descriptorIsSemver ? compilerDescriptor : undefined,
            factor: descriptorIsSemver ? undefined : compilerDescriptor,
            value: containerPart
        }
        containerOptions.push(entry)
    }
    return containerOptions
}

function normalizeCppVersionRequirement(range) {
    // Regular expression to match two-digit C++ versions
    const regex = /\b(\d{2})\b/g

    const currentYear = new Date().getFullYear()
    const currentCenturyFirstYear = Math.floor(currentYear / 100) * 100
    const previousCenturyFirstYear = currentCenturyFirstYear - 100

    // Replace the two-digit versions with their corresponding four-digit versions
    const replacedRange = range.replace(regex, (match, version) => {
        const year = parseInt(version)
        if (year >= 0 && year <= 99) {
            const a = currentCenturyFirstYear + year
            const b = previousCenturyFirstYear + year
            const a_diff = Math.abs(currentYear - a)
            const b_diff = Math.abs(currentYear - b)
            if (a_diff < b_diff) {
                return a.toString()
            } else {
                return b.toString()
            }
        }
        return match // Return the match as is if it's not a two-digit version
    })

    return replacedRange.trim()
}

function normalizeCompilerName(name) {
    const lowerCaseName = name.toLowerCase()

    if (['gcc', 'g++', 'gcc-'].some(s => lowerCaseName.startsWith(s))) {
        return 'gcc'
    } else if (['clang-cl', 'clang-win'].some(s => lowerCaseName.startsWith(s))) {
        return 'clang-cl'
    } else if (['clang', 'clang++', 'llvm'].some(s => lowerCaseName.startsWith(s))) {
        return 'clang'
    } else if (['msvc', 'cl', 'visual studio', 'vc'].some(s => lowerCaseName.startsWith(s))) {
        return 'msvc'
    } else if (['min-gw', 'mingw'].some(s => lowerCaseName.startsWith(s))) {
        return 'mingw'
    }

    // Return the original name if no normalization rule matches
    return name
}

async function findVersionsFromTags(name, repo, file, regex) {
    const versionsFromFile = setup_program.readVersionsFromFile(file)
    if (versionsFromFile !== null) {
        log(`${name} versions (from file): ` + versionsFromFile)
        return versionsFromFile
    }
    const tags = await setup_program.fetchGitTags(repo, {
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
    log(`${name} versions: ` + versions)
    setup_program.saveVersionsToFile(versions, file)
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

function findMSVCVersions() {
    // MSVC is not open source, so we assume the versions available from github runner images are available
    // See:
    // https://en.wikipedia.org/wiki/Microsoft_Visual_C%2B%2B

    // windows-2019 -> ['10.0.40219', '12.0.40660', '14.29.30139', '14.40.33810']
    // windows-2022 -> ['12.0.40660', '14.40.33810']
    // https://github.com/actions/runner-images/blob/main/images/win/Windows2019-Readme.md#microsoft-visual-c
    // https://github.com/actions/runner-images/blob/main/images/win/Windows2022-Readme.md#microsoft-visual-c
    return ['10.0.40219', '12.0.40660', '14.29.30139', '14.40.33810']
}

async function findCompilerVersions(compiler) {
    if (compiler === 'gcc') {
        return await findGCCVersions()
    } else if (compiler === 'clang') {
        return await findClangVersions()
    } else if (compiler === 'msvc') {
        return findMSVCVersions()
    }
    return []
}

function getVisualCppYear(msvc_version) {
    const v = semver.parse(msvc_version, {})
    if (semver.gte(v, '14.30.0')) {
        return '2022'
    } else if (semver.gte(v, '14.20.0')) {
        return '2019'
    } else if (semver.gte(v, '14.1.0')) {
        return '2017'
    } else if (semver.gte(v, '14.0.0')) {
        return '2015'
    } else if (semver.gte(v, '12.0.0')) {
        return '2013'
    } else if (semver.gte(v, '11.0.0')) {
        return '2012'
    } else if (semver.gte(v, '10.0.0')) {
        return '2010'
    } else if (semver.gte(v, '9.0.0')) {
        return '2008'
    } else if (semver.gte(v, '8.0.0')) {
        return '2005'
    } else if (semver.gte(v, '7.1.0')) {
        return '2003'
    } else if (semver.gte(v, '7.0.0')) {
        return '2002'
    } else if (semver.gte(v, '6.0.0')) {
        return '2001' // visual studio 6.0
    } else if (semver.gte(v, '5.0.0')) {
        return '1997' // visual studio 97
    } else if (semver.gte(v, '4.0.0')) {
        return '1995' // Visual C++ 4
    } else if (semver.gte(v, '2.0.0')) {
        return '1994' // Visual C++ 2/3
    } else if (semver.gte(v, '1.0.0')) {
        return '1993' // Visual C++ 1
    } else if (semver.gte(v, '0.0.0')) {
        return '1989' // Microsoft C 6.0
    }
}

function arraysHaveSameElements(arr1, arr2) {
    if (arr1.length !== arr2.length) {
        return false
    }

    const sortedArr1 = arr1.slice().sort()
    const sortedArr2 = arr2.slice().sort()

    for (let i = 0; i < sortedArr1.length; i++) {
        if (sortedArr1[i] !== sortedArr2[i]) {
            return false
        }
    }

    return true
}


const SubrangePolicies = {
    ONE_PER_MAJOR: 0, ONE_PER_MINOR: 1, ONE_PER_MAJOR_OR_MINOR: 2
}

function getSubrangePolicy(policyStr) {
    if (policyStr === 'one-per-major') {
        return SubrangePolicies.ONE_PER_MAJOR
    } else if (policyStr === 'one-per-minor') {
        return SubrangePolicies.ONE_PER_MINOR
    } else if (policyStr === 'one-per-major-or-minor') {
        return SubrangePolicies.ONE_PER_MAJOR_OR_MINOR
    }
    return SubrangePolicies.ONE_PER_MAJOR
}

function getSubrangePolicyStr(policy) {
    if (policy === SubrangePolicies.ONE_PER_MAJOR) {
        return 'one-per-major'
    } else if (policy === SubrangePolicies.ONE_PER_MINOR) {
        return 'one-per-minor'
    } else if (policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR) {
        return 'one-per-major-or-minor'
    }
    return 'one-per-major'
}

function splitRanges(range, versions, policy = SubrangePolicies.ONE_PER_MAJOR) {
    function fnlog(msg) {
        log('splitRanges: ' + msg)
    }

    if (versions.length === 0) {
        // We know nothing about the available versions for that compiler, so we just return "*"
        return ['*']
    }
    fnlog(`range: ${range}`)
    fnlog(`versions: ${versions}`)
    fnlog(`policy: ${getSubrangePolicyStr(policy)}`)

    versions = versions.map(s => semver.parse(s, {}))
    const minVersion = semver.minSatisfying(versions, range)
    const maxVersion = semver.maxSatisfying(versions, range)
    if (minVersion === null || maxVersion === null) {
        return ['*']
    }
    fnlog(`minVersion: ${minVersion}`)
    fnlog(`maxVersion: ${maxVersion}`)

    const major_or_minor_policy = minVersion.major === maxVersion.major ? SubrangePolicies.ONE_PER_MINOR : SubrangePolicies.ONE_PER_MAJOR
    const effective_major_or_minor_policy = policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR ? major_or_minor_policy : policy
    const effective_policy = policy === SubrangePolicies.ONE_PER_MAJOR_OR_MINOR ? major_or_minor_policy : policy
    const range_versions = versions.filter(v => semver.satisfies(v, range))

    let subranges = []
    if (effective_policy === SubrangePolicies.ONE_PER_MAJOR) {
        fnlog('Effective policy: ONE_PER_MAJOR')

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minVersion.major; i <= maxVersion.major; i++) {
            // Create an initial requirement with just the major version (eg: "9")
            let major_range = i.toString()
            if (semver.subset(major_range, range)) {
                subranges.push(major_range)
                continue
            }

            // Versions that would satisfy the major requirement regardless of real requirement
            // (eg: 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0)
            let major_versions = versions.filter(v => semver.satisfies(v, major_range))
            if (major_versions.length === 0) {
                continue
            }

            // Versions that would satisfy both the major requirement and the input range
            // (eg: 9.3.0, 9.4.0, 9.5.0 when the range is >=9.3)
            let range_major_versions = range_versions.filter(v => semver.satisfies(v, major_range))
            if (range_major_versions.length === 0) {
                continue
            }

            // If both represent the same versions, this means the major requirement is effectively the same
            if (arraysHaveSameElements(major_versions, range_major_versions)) {
                subranges.push(major_range)
                continue
            }

            // If the main range satisfies all the highest minors in the major version, then this is
            // a "^" requirement, meaning we should define the minor, and we can update it as we want
            // eg:
            // 1) major matches 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0
            // 2) range + major matches 9.3.0, 9.4.0, 9.5.0
            // 3) requirement is ^9.3.0
            const latest_major_versions = major_versions.slice(-range_major_versions.length)
            if (arraysHaveSameElements(latest_major_versions, range_major_versions)) {
                let major_range = `^${i}.${latest_major_versions[0].minor}`
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (major_versions.some(v => v.minor === latest_major_versions[0].minor && !semver.satisfies(v, range))) {
                    major_range = `^${latest_major_versions[0].toString()}`
                }
                subranges.push(major_range)
                continue
            }

            // If the main range satisfies all the lowest minors in the major version, then this is
            // a <= requirement
            // eg:
            // 1) major matches 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0
            // 2) range + major matches 9.1.0, 9.2.0
            // 3) requirement is <=9.2.0
            const earliest_major_versions = major_versions.slice(0, range_major_versions.length)
            if (arraysHaveSameElements(earliest_major_versions, range_major_versions)) {
                major_range = `${i} - ${i}.${earliest_major_versions[earliest_major_versions.length - 1].minor}`
                // but if there's another major version with the same minor outside the range, we need to specify the
                // patch
                if (major_versions.some(v => v.minor === earliest_major_versions[earliest_major_versions.length - 1].minor && !semver.satisfies(v, range))) {
                    major_range = `${i} - ${earliest_major_versions[earliest_major_versions.length - 1].toString()}`
                }
                subranges.push(major_range)
                continue
            }

            // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
            // This might lead to false negatives as, in principle, the main range can still have multiple
            // intervals separated by "||". This is such an edge case for our application that we don't even
            // consider it.
            const fromIdx = major_versions.indexOf(range_major_versions[0])
            const toIdx = major_versions.indexOf(range_major_versions[range_major_versions.length - 1])
            let fromStr = major_versions[fromIdx].toString()
            if (fromIdx === 0 || major_versions[fromIdx - 1].minor !== major_versions[fromIdx].minor) {
                fromStr = `${major_versions[fromIdx].major}.${major_versions[fromIdx].minor}`
            }
            let toStr = major_versions[toIdx].toString()
            if (toIdx === major_versions.length - 1 || major_versions[toIdx + 1].minor !== major_versions[toIdx].minor) {
                toStr = `${major_versions[toIdx].major}.${major_versions[toIdx].minor}`
            }
            subranges.push(`${fromStr} - ${toStr}`)
        }
    }

    if (effective_policy === SubrangePolicies.ONE_PER_MINOR) {
        fnlog('Effective policy: ONE_PER_MINOR')

        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minVersion.major; i <= maxVersion.major; i++) {
            const unique_minors = versions
                .filter(v => v.major === i)
                .map(v => v.minor)
                .sort()
                .filter((value, index, self) => self.indexOf(value) === index)
            for (const j of unique_minors) {
                // Create an initial requirement with just the major version (eg: "9")
                let minor_range = `${i}.${j}`
                if (semver.subset(minor_range, range)) {
                    subranges.push(minor_range)
                    continue
                }

                // Versions that would satisfy the minor requirement regardless of real requirement
                let minor_versions = versions.filter(v => semver.satisfies(v, minor_range))
                if (minor_versions.length === 0) {
                    continue
                }

                // Versions that would satisfy both the minor requirement and the input range
                let range_minor_versions = range_versions.filter(v => semver.satisfies(v, minor_range))
                if (range_minor_versions.length === 0) {
                    continue
                }

                // If both represent the same versions, this means the major requirement is effectively the same
                if (arraysHaveSameElements(minor_versions, range_minor_versions)) {
                    subranges.push(minor_range)
                    continue
                }

                // If the main range satisfies all the highest minors in the major version, then this is
                // a "^" requirement, meaning we should define the minor, and we can update it as we want
                // eg:
                // 1) major matches 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0
                // 2) range + major matches 9.3.0, 9.4.0, 9.5.0
                // 3) requirement is ^9.3.0
                const latest_minor_versions = minor_versions.slice(-range_minor_versions.length)
                if (arraysHaveSameElements(latest_minor_versions, range_minor_versions)) {
                    subranges.push(`~${latest_minor_versions[0].toString()}`)
                    continue
                }

                // If the main range satisfies all the lowest minors in the major version, then this is
                // a <= requirement
                // eg:
                // 1) major matches 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0
                // 2) range + major matches 9.1.0, 9.2.0
                // 3) requirement is <=9.2.0
                const earliest_minor_versions = minor_versions.slice(0, range_minor_versions.length)
                if (arraysHaveSameElements(earliest_minor_versions, range_minor_versions)) {
                    subranges.push(`${i}.${j} - ${latest_minor_versions[0].toString()}`)
                    continue
                }

                // If the main range only satisfies an arbitrary interval of the major version, so this is a "-"
                // This might lead to false negatives as, in principle, the main range can still have multiple
                // intervals separated by "||". This is such an edge case for our application that we don't even
                // consider it.
                const fromIdx = minor_versions.indexOf(range_minor_versions[0])
                const toIdx = minor_versions.indexOf(range_minor_versions[range_minor_versions.length - 1])
                let fromStr = minor_versions[fromIdx].toString()
                let toStr = minor_versions[toIdx].toString()
                subranges.push(`${fromStr} - ${toStr}`)
            }
        }
    }

    return subranges
}

function compilerSupportsStd(compiler, version, cxxstd) {
    if (compiler === 'gcc') {
        return (cxxstd <= 2020 && semver.satisfies(version, '>=11')) ||
            (cxxstd <= 2017 && semver.satisfies(version, '>=7')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=6')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=4')) ||
            cxxstd <= 2003
    }
    if (compiler === 'clang') {
        return (cxxstd <= 2020 && semver.satisfies(version, '>=12')) ||
            (cxxstd <= 2017 && semver.satisfies(version, '>=6')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=4')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=3')) ||
            cxxstd <= 2003
    }
    if (compiler === 'msvc') {
        return (cxxstd <= 2020 && semver.satisfies(version, '>=14.30')) ||
            (cxxstd <= 2017 && semver.satisfies(version, '>=14.20')) ||
            (cxxstd <= 2014 && semver.satisfies(version, '>=14.11')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=14')) ||
            (cxxstd <= 2011 && semver.satisfies(version, '>=14.1')) ||
            cxxstd <= 2003
    }
    return false
}

function humanizeCompilerName(compiler) {
    const human_compiler_names = {
        'gcc': 'GCC',
        'clang': 'Clang',
        'apple-clang': 'Apple-Clang',
        'msvc': 'MSVC',
        'mingw': 'MinGW',
        'clang-cl': 'Windows-Clang'
    }
    if (compiler in human_compiler_names) {
        return human_compiler_names[compiler]
    }
    return compiler
}

function compilerEmoji(compiler) {
    const compiler_emojis = {
        'gcc': '🐧',
        'clang': '🐉',
        'apple-clang': '🍏',
        'msvc': '🪟',
        'mingw': '🪓',
        'clang-cl': '🛠️'
    }
    if (compiler in compiler_emojis) {
        return compiler_emojis[compiler]
    }
    return '🛠️'
}

function getCompilerCxxStds(entry, inputs, allCompilerVersions, cxxstds, compilerName, minSubrangeVersion) {
    // The versions of cxxstd we should test with this compiler
    let compiler_cxxs = []
    if (allCompilerVersions.length !== 0) {
        // Identify versions of cxxstd supported by this compiler + version
        compiler_cxxs = cxxstds.filter(cxxstd => compilerSupportsStd(compilerName, minSubrangeVersion, cxxstd))

        // Set entry values if we found any
        if (compiler_cxxs.length === 0) {
            // We know about the compiler versions but this compiler does not
            // support any of the standards we want to test. Skip it.
            return undefined
        }

        if (inputs.max_standards && compiler_cxxs.length > inputs.max_standards) {
            compiler_cxxs = compiler_cxxs.splice(-inputs.max_standards)
        }
        compiler_cxxs = compiler_cxxs.map(v => v.toString().slice(-2))
        entry['cxxstd'] = compiler_cxxs.join(',')
        entry['latest-cxxstd'] = compiler_cxxs[compiler_cxxs.length - 1]
    }
    // Return list even if it's empty.
    // An empty list means we want to test this compiler, but we don't know
    // what versions of cxxstd it supports because there's no compiler version
    // we know about.
    return compiler_cxxs
}

function setEntrySemverComponents(entry, minSubrangeVersion, maxSubrangeVersion) {
    // Extract major, minor, and patch versions from the subrange
    if (minSubrangeVersion !== null && maxSubrangeVersion !== null) {
        if (minSubrangeVersion.major === maxSubrangeVersion.major) {
            entry['major'] = minSubrangeVersion.major
            if (minSubrangeVersion.minor === maxSubrangeVersion.minor) {
                entry['minor'] = minSubrangeVersion.minor
                if (minSubrangeVersion.patch === maxSubrangeVersion.patch) {
                    entry['patch'] = minSubrangeVersion.patch
                } else {
                    entry['patch'] = `*`
                }
            } else {
                entry['minor'] = `*`
                entry['patch'] = `*`
            }
        } else {
            entry['major'] = `*`
            entry['minor'] = `*`
            entry['patch'] = `*`
        }
    }
}

function setCompilerExecutableNames(entry, compilerName, minSubrangeVersion) {
    // Usual cxx/cc names (no name usually needed for msvc)
    if (compilerName === 'gcc') {
        if (semver.satisfies(minSubrangeVersion, '>=5')) {
            entry['cxx'] = `g++-${minSubrangeVersion.major}`
            entry['cc'] = `gcc-${minSubrangeVersion.major}`
        } else {
            entry['cxx'] = `g++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
            entry['cc'] = `gcc-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
        }
    } else if (compilerName === 'clang') {
        if (semver.satisfies(minSubrangeVersion, '>=7')) {
            entry['cxx'] = `clang++-${minSubrangeVersion.major}`
            entry['cc'] = `clang-${minSubrangeVersion.major}`
        } else {
            entry['cxx'] = `clang++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
            entry['cc'] = `clang-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
        }
    } else if (compilerName === 'apple-clang') {
        entry['cxx'] = `clang++`
        entry['cc'] = `clang`
    } else if (compilerName === 'clang-cl') {
        entry['cxx'] = `clang++-cl`
        entry['cc'] = `clang-cl`
    } else if (compilerName === 'mingw') {
        entry['cxx'] = `g++`
        entry['cc'] = `gcc`
    }
}

function isArrayOfObjects(val) {
    return Array.isArray(val) && val.length > 0 && typeof val[0] === 'object'
}

function setSuggestion(entry, key, suggestionMap, subrange) {
    if (isArrayOfObjects(suggestionMap)) {
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.factor !== undefined && userSuggestion.compiler === entry.compiler) {
                const factor_key = userSuggestion.factor.toLowerCase()
                if (entry[factor_key]) {
                    entry[key] = userSuggestion.value
                    return true
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    entry[key] = userSuggestion.value
                    return true
                }
            }
        }
    }
    return false
}

function applyForcedFactors(entry, suggestionMap, subrange) {
    if (isArrayOfObjects(suggestionMap)) {
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.factor !== undefined && userSuggestion.compiler === entry.compiler) {
                const factor_key = userSuggestion.factor.toLowerCase()
                if (entry[factor_key]) {
                    const forced_factor = userSuggestion.value
                    const lc_forced_factor = forced_factor.toLowerCase()
                    entry[lc_forced_factor] = true
                    return true
                }
            }
        }
        for (const userSuggestion of suggestionMap) {
            if (userSuggestion.range !== undefined && userSuggestion.compiler === entry.compiler) {
                if (semver.subset(subrange, userSuggestion.range)) {
                    const forced_factor = userSuggestion.value
                    const lc_forced_factor = forced_factor.toLowerCase()
                    entry[lc_forced_factor] = true
                    return true
                }
            }
        }
    }
    return false
}


function setCompilerContainer(entry, inputs, compilerName, minSubrangeVersion, subrange) {
    // runs-on / container
    if (compilerName === 'gcc') {
        if (semver.satisfies(minSubrangeVersion, '>=14')) {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:24.04'
        } else if (semver.satisfies(minSubrangeVersion, '>=13')) {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:23.04'
        } else if (semver.satisfies(minSubrangeVersion, '>=9')) {
            entry['runs-on'] = 'ubuntu-22.04'
            if (inputs.use_containers) {
                entry['container'] = 'ubuntu:22.04'
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=7')) {
            if (!inputs.use_containers) {
                entry['runs-on'] = 'ubuntu-20.04'
            } else {
                entry['runs-on'] = 'ubuntu-22.04'
                entry['container'] = 'ubuntu:20.04'
            }
        } else {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:18.04'
        }
    } else if (compilerName === 'clang') {
        if (semver.satisfies(minSubrangeVersion, '>=17')) {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:23.10'
        } else if (semver.satisfies(minSubrangeVersion, '>=16')) {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:23.04'
        } else if (semver.satisfies(minSubrangeVersion, '>=15')) {
            entry['runs-on'] = 'ubuntu-22.04'
            if (inputs.use_containers) {
                entry['container'] = 'ubuntu:22.04'
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=12')) {
            // Clang >=12 <15 require a container to isolate
            // incompatible libstdc++ versions
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:22.04'
        } else if (semver.satisfies(minSubrangeVersion, '>=6')) {
            if (!inputs.use_containers) {
                entry['runs-on'] = 'ubuntu-20.04'
            } else {
                entry['runs-on'] = 'ubuntu-22.04'
                entry['container'] = 'ubuntu:20.04'
            }
        } else if (semver.satisfies(minSubrangeVersion, '>=3.9')) {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:18.04'
        } else {
            entry['runs-on'] = 'ubuntu-22.04'
            entry['container'] = 'ubuntu:16.04'
        }
    } else if (compilerName === 'msvc') {
        if (semver.satisfies(minSubrangeVersion, '>=14.30')) {
            entry['runs-on'] = 'windows-2022'
        } else {
            entry['runs-on'] = 'windows-2019'
        }
    } else if (compilerName === 'apple-clang') {
        entry['runs-on'] = 'macos-14'
    } else if (['mingw', 'clang-cl'].includes(compilerName)) {
        entry['runs-on'] = 'windows-2022'
    }

    // Set the volumes for the compiler
    if (entry.container) {
        const image = entry.container
        if (image.startsWith('ubuntu')) {
            const version = entry.container.split(':')[1]
            const versionNumbers = version.split('.').map(s => parseInt(s))
            const versionMajor = versionNumbers[0]
            if (versionMajor < 20) {
                entry.container = {
                    image: image,
                    volumes: ['/node20217:/node20217:rw,rshared', '/node20217:/__e/node20:ro,rshared']
                }
            }
        }
    }
}

function setCompilerB2Toolset(entry, inputs, compilerName, subrange) {
    // Recommended b2-toolset
    // The b2 toolset never includes the version number
    if (['mingw', 'gcc'].includes(compilerName)) {
        entry['b2-toolset'] = `gcc`
    } else if (['clang', 'apple-clang'].includes(compilerName)) {
        entry['b2-toolset'] = `clang`
    } else if (compilerName === 'msvc') {
        entry['b2-toolset'] = `msvc`
    } else if (compilerName === 'clang-cl') {
        entry['b2-toolset'] = `clang-win`
    }
}

function setCompilerCMakeGenerator(entry, inputs, compilerName, minSubrangeVersion, maxSubrangeVersion, subrange) {
    // Recommended cmake generator
    if (compilerName === 'msvc') {
        const year = getVisualCppYear(minSubrangeVersion)
        if (minSubrangeVersion === maxSubrangeVersion || year === getVisualCppYear(maxSubrangeVersion)) {
            if (year === '2022') {
                entry['generator'] = `Visual Studio 17 ${year}`
            } else if (year === '2019') {
                entry['generator'] = `Visual Studio 16 ${year}`
            } else if (year === '2017') {
                entry['generator'] = `Visual Studio 15 ${year}`
            } else if (year === '2015') {
                entry['generator'] = `Visual Studio 14 ${year}`
            } else if (year === '2013') {
                entry['generator'] = `Visual Studio 12 ${year}`
            } else if (year === '2012') {
                entry['generator'] = `Visual Studio 11 ${year}`
            } else if (year === '2010') {
                entry['generator'] = `Visual Studio 10 ${year}`
            } else if (year === '2008') {
                entry['generator'] = `Visual Studio 9 ${year}`
            } else if (year === '2005') {
                entry['generator'] = `Visual Studio 8 ${year}`
            }
        }
    } else if (compilerName === 'mingw') {
        entry['generator'] = `MinGW Makefiles`
    } else if (compilerName === 'clang-cl') {
        entry['generator-toolset'] = `ClangCL`
    }
}

function setEntryVersionFlags(entry, i, subranges, minSubrangeVersion, maxSubrangeVersion) {
    // Latest/earliest/has-major/has-minor/has-patch/subrange-policy flags
    // subranges are ordered so the latest flag is the last entry
    // in the matrix for this compiler
    entry['is-latest'] = i === subranges.length - 1
    entry['is-main'] = i === subranges.length - 1

    // Earliest flag
    entry['is-earliest'] = i === 0

    // Intermediary flags
    entry['is-intermediary'] = !entry['is-latest'] && !entry['is-earliest']

    // Indicate if major, minor, or patch are not specified
    entry['has-major'] = entry['major'] !== '*'
    entry['has-minor'] = entry['minor'] !== '*'
    entry['has-patch'] = entry['patch'] !== '*'

    // Flag with the subrange policy used
    if (entry['has-major'] === false) {
        entry['subrange-policy'] = 'system-version'
    } else if (subranges.length === 1 || minSubrangeVersion.major !== maxSubrangeVersion.major) {
        entry['subrange-policy'] = 'one-per-major'
    } else {
        entry['subrange-policy'] = 'one-per-minor'
    }
}

function setEntryName(entry, compilerName, subrange, compiler_cxxs) {
    // Come up with a name for this entry
    let name = `${humanizeCompilerName(compilerName)}`
    if (subrange !== '*') {
        name += ` ${subrange}`
    }
    if (compiler_cxxs.length !== 0) {
        if (compiler_cxxs.length > 1) {
            name += `: C++${compiler_cxxs[0]}-${compiler_cxxs[compiler_cxxs.length - 1]}`
        } else {
            name += `: C++${compiler_cxxs[0]}`
        }
    }
    entry['name'] = name
}

function applyLatestFactors(matrix, inputs, latestIdx, earliestIdx, compilerName) {
    // Apply latest factors for this compiler.
    // We duplicate the latest entry for each latest factor and set the
    // property to true for each duplicated entry.
    if (compilerName in inputs.latest_factors) {
        // Duplicate latest entry for each latest factor and set properties
        for (const factor of inputs.latest_factors[compilerName]) {
            let latest_copy = {...matrix[latestIdx]}
            latest_copy['is-main'] = false
            for (const composite_factor of factor.split('+')) {
                latest_copy[composite_factor.toLowerCase()] = true
            }
            latest_copy['has-factors'] = true
            latest_copy['name'] += ` (${factor})`
            matrix.push(latest_copy)
        }

        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.latest_factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false
                    }
                }
            }
        }
    }
}

function applyVariantFactors(matrix, inputs, latestIdx, earliestIdx, compilerName) {
    // Apply variant factors for this compiler
    // We skip the latest entry and apply the variant factors to the
    // intermediary entries.
    let variantIdx = latestIdx
    if (variantIdx !== earliestIdx) {
        variantIdx--
    }
    if (compilerName in inputs.factors) {
        // Apply each variant factor to the intermediary entries
        for (const factor of inputs.factors[compilerName]) {
            if (variantIdx !== earliestIdx) {
                for (const composite_factor of factor.split('+')) {
                    matrix[variantIdx][composite_factor.toLowerCase()] = true
                }
                matrix[variantIdx]['name'] += ` (${factor})`
                matrix[variantIdx]['has-factors'] = true
                variantIdx--
            } else {
                // If we reached the earliest entry by doing that,
                // we need to duplicate the latest entry to apply new
                // factors
                let latest_copy = {...matrix[latestIdx]}
                latest_copy['is-main'] = false
                for (const composite_factor of factor.split('+')) {
                    latest_copy[composite_factor.toLowerCase()] = true
                }
                latest_copy['name'] += ` (${factor})`
                latest_copy['has-factors'] = true
                matrix.push(latest_copy)
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false
                    }
                }
            }
        }
    }
}

function applyCombinatorialFactors(matrix, inputs, latestIdx, earliestIdx, compilerName) {
    // Apply combinatorial factors for this compiler
    // For each entry, we create a copy that set that factor to true
    // Here we go:
    if (compilerName in inputs.combinatorial_factors) {
        // Apply each combinatorial factor to each entry
        for (const factor of inputs.combinatorial_factors[compilerName]) {
            for (let i = earliestIdx; i < latestIdx + 1; i++) {
                let entry_copy = {...matrix[i]}
                for (const composite_factor of factor.split('+')) {
                    entry_copy[composite_factor.toLowerCase()] = true
                }
                entry_copy['name'] += ` (${factor})`
                entry_copy['has-factors'] = true
                matrix.push(entry_copy)
            }
        }
        // Set the property to false for all other entries
        for (let i = 0; i < matrix.length; i++) {
            for (const factor of inputs.combinatorial_factors[compilerName]) {
                for (const composite_factor of factor.split('+')) {
                    if (!(composite_factor.toLowerCase() in matrix[i])) {
                        matrix[i][composite_factor.toLowerCase()] = false
                    }
                }
            }
        }
    }
}

async function setRecommendedFlags(entry, inputs) {
    entry['build-type'] = 'Release'
    entry['cxxflags'] = ''
    entry['ccflags'] = ''
    entry['install'] = ''

    // Flags for asan
    let sanitizers = []
    let supportsAsan = ['gcc', 'clang', 'msvc'].includes(entry['compiler'])
    if ('asan' in entry && entry['asan'] === true && supportsAsan) {
        sanitizers.push('address')
    }

    // Flags for ubsan
    let supportsSanitizers = ['gcc', 'clang'].includes(entry['compiler'])
    if ('ubsan' in entry && entry['ubsan'] === true && supportsSanitizers) {
        sanitizers.push('undefined')
        // https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html#stack-traces-and-report-symbolization
        entry['env'] = {'UBSAN_OPTIONS': 'print_stacktrace=1'}
    }

    // Flags for msan
    if ('msan' in entry && entry['msan'] === true && supportsSanitizers) {
        sanitizers.push('memory')
    }

    // Flags for tsan
    if ('tsan' in entry && entry['tsan'] === true && supportsSanitizers) {
        sanitizers.push('thread')
    }

    if (sanitizers.length !== 0) {
        const sanitizers_str = sanitizers.join(',')
        const sanitizer_flags = entry['compiler'] === 'msvc' ?
            ` /fsanitize=${sanitizers_str}` :
            ` -fsanitize=${sanitizers_str} -fno-sanitize-recover=${sanitizers_str} -fno-omit-frame-pointer`
        entry['cxxflags'] += sanitizer_flags
        entry['ccflags'] += sanitizer_flags
        entry['build-type'] = inputs.sanitizer_build_type || 'Release'
    }

    // Flags for coverage
    if ('coverage' in entry && entry['coverage'] === true) {
        if (entry['compiler'] === 'gcc') {
            entry['cxxflags'] += ' --coverage -fprofile-arcs -ftest-coverage'
            entry['ccflags'] += ' --coverage -fprofile-arcs -ftest-coverage'
            entry['install'] += ' lcov'
        } else if (entry['compiler'] === 'clang') {
            entry['cxxflags'] += ' -fprofile-instr-generate -fcoverage-mapping'
            entry['ccflags'] += ' -fprofile-instr-generate -fcoverage-mapping'
        }
        entry['build-type'] = 'Debug'
    }

    // Flags for x86
    if ('x86' in entry && entry['x86'] === true) {
        if (entry['compiler'] === 'msvc') {
            entry['cxxflags'] += ' /m32'
            entry['ccflags'] += ' /m32'
        } else if (entry['compiler'] === 'clang') {
            entry['cxxflags'] += ' -m32'
            entry['ccflags'] += ' -m32'
        }
        entry['build-type'] = inputs.x86_build_type || 'Release'
    }

    // Flags for time-trace
    if ('time-trace' in entry && entry['time-trace'] === true) {
        if (entry['compiler'] === 'clang') {
            const v = semver.minSatisfying(await findClangVersions(), entry['version'])
            if (semver.satisfies(v, '>=9')) {
                entry['cxxflags'] += ' -ftime-trace'
                entry['ccflags'] += ' -ftime-trace'
                entry['install'] += ' wget unzip'
            }
        }
        if (entry['cxxstd'] !== '') {
            entry['cxxstd'] = entry['latest-cxxstd']
            entry['name'] = entry['name'].replace(/C\+\+\d+-\d+/g, `C++${entry['latest-cxxstd']}`)
        }
    }

    // Install build-essential for Ubuntu containers
    if ('container' in entry) {
        // Check if it's a string
        if (typeof entry['container'] === 'string') {
            if (entry['container'].startsWith('ubuntu')) {
                entry['install'] += ' build-essential pkg-config git curl'
            }
        }
        // Check if it's an object with the "image" key
        if (typeof entry['container'] === 'object' && 'image' in entry['container']) {
            if (entry['container']['image'].startsWith('ubuntu')) {
                entry['install'] += ' build-essential pkg-config git curl'
            }
        }
    }

    // Trim flags
    entry['install'] = entry['install'].trim()
    entry['cxxflags'] = entry['cxxflags'].trim()
    entry['ccflags'] = entry['ccflags'].trim()

    // Include vcpkg triplet recommendations (vcpkg help triplet)
    const arch_prefix = entry['x86'] ? 'x86' : 'x64'
    if (['msvc', 'clang-cl'].includes(entry['compiler'])) {
        entry['triplet'] = `${arch_prefix}-windows`
    } else if (entry['compiler'] === 'mingw') {
        entry['triplet'] = `${arch_prefix}-mingw-static`
    } else if (entry['compiler'] === 'apple-clang') {
        entry['triplet'] = `${arch_prefix}-osx`
    } else {
        entry['triplet'] = `${arch_prefix}-linux`
    }
}

function sortMatrix(matrix, inputs) {
    // Sort matrix
    // 1) Latest
    // 2) Unique
    // 3) Earliest
    // 4) Factors
    // 5) Intermediary
    const contains_factor = (entry) => {
        let allFactors = []
        if (entry['compiler'] in inputs.latest_factors) {
            allFactors.push(...inputs.latest_factors[entry['compiler']])
        }
        if (entry['compiler'] in inputs.factors) {
            allFactors.push(...inputs.factors[entry['compiler']])
        }
        if (allFactors.length === 0) {
            return false
        }
        allFactors = allFactors.map(f => f.toLowerCase())
        for (const [key, value] of Object.entries(entry)) {
            if (value === true && allFactors.includes(key)) {
                return true
            }
        }
        return false
    }

    const is_latest_no_factor = (entry) => {
        return entry['is-latest'] && !entry['is-earliest'] && !contains_factor(entry)
    }

    const is_unique_no_factor = (entry) => {
        return entry['is-latest'] && entry['is-earliest'] && !contains_factor(entry)
    }

    const is_earliest_no_factor = (entry) => {
        return entry['is-earliest'] && !entry['is-latest'] && !contains_factor(entry)
    }

    matrix.reverse()
    matrix.sort(function(a, b) {
        // Latest compilers come first
        const a0 = is_latest_no_factor(a)
        const b0 = is_latest_no_factor(b)
        if (a0 && !b0) {
            return -1
        } else if (!a0 && b0) {
            return 1
        }

        // Then compilers with a single version
        const a1 = is_unique_no_factor(a)
        const b1 = is_unique_no_factor(b)
        if (a1 && !b1) {
            return -1
        } else if (!a1 && b1) {
            return 1
        }

        // Then the oldest compilers
        const a2 = is_earliest_no_factor(a)
        const b2 = is_earliest_no_factor(b)
        if (a2 && !b2) {
            return -1
        } else if (!a2 && b2) {
            return 1
        }

        // Then configurations with special factors
        const a3 = contains_factor(a)
        const b3 = contains_factor(b)
        if (a3 && !b3) {
            return -1
        } else if (!a3 && b3) {
            return 1
        }

        // Then, ceteris paribus, compilers with fewer entries come first
        // so that it increases the changes all seeing all compilers on the screen
        const an = matrix.filter(entry => entry.compiler === a.compiler).length
        const bn = matrix.filter(entry => entry.compiler === b.compiler).length
        if (an < bn) {
            return -1
        } else if (an > bn) {
            return 1
        } else {
            return 0
        }
    })
}

function registerHelpers() {
    Handlebars.registerHelper('lowercase', function(value) {
        return value.toLowerCase()
    })
    Handlebars.registerHelper('uppercase', function(value) {
        return value.toUpperCase()
    })
    Handlebars.registerHelper('contains', function(str, substr) {
        return str.includes(substr)
    })
    for (const key of ['startsWith', 'starts-with']) {
        Handlebars.registerHelper(key, function(str, substr) {
            return str.startsWith(substr)
        })
    }
    for (const key of ['endsWith', 'ends-with']) {
        Handlebars.registerHelper(key, function(str, substr) {
            return str.endsWith(substr)
        })
    }
    Handlebars.registerHelper('substr', function(str, start, end) {
        return str.substring(start, end)
    })

    Handlebars.registerHelper('and', function(...args) {
        const numArgs = args.length
        if (numArgs === 3) return args[0] && args[1]
        if (numArgs < 3) throw new Error('{{and}} helper expects at least 2 arguments')
        args.pop()
        return args.every((it) => it)
    })
    Handlebars.registerHelper('eq', function(a, b) {
        return a === b
    })
    Handlebars.registerHelper('ieq', function(a, b) {
        return a.toLowerCase() === b.toLowerCase()
    })
    Handlebars.registerHelper('ne', function(a, b) {
        return a !== b
    })
    Handlebars.registerHelper('ine', function(a, b) {
        return a.toLowerCase() !== b.toLowerCase()
    })
    Handlebars.registerHelper('or', function(...args) {
        const numArgs = args.length
        if (numArgs === 3) return args[0] || args[1]
        if (numArgs < 3) throw new Error('{{or}} helper expects at least 2 arguments')
        args.pop()
        return args.some((it) => it)
    })
    Handlebars.registerHelper('not', function(value) {
        return !value
    })
}


function injectExtraValues(matrix, extraValues) {
    if (!extraValues) {
        return
    }

    registerHelpers()

    // Use Object.entries to iterate over the key-value pairs of extraValues
    const compiledTemplates = extraValues.map(({key, value}) => ({
        key,
        template: Handlebars.compile(value)
    }))

    let warnedKeys = []
    for (const entry of matrix) {
        for (const {key, template} of compiledTemplates) {
            const fail = key in entry
            if (fail) {
                if (!warnedKeys.includes(key)) {
                    core.warning(`Extra entry key "${key}" already exists in the matrix`)
                }
                // Add to the list of keys we already warned about
                warnedKeys.push(key)
                continue
            }
            entry[key] = template(entry)
        }
    }
}

function setOS(matrix) {
    for (const entry of matrix) {
        if (entry.container) {
            entry.os = 'Linux'
        } else if (entry['runs-on']) {
            const runsOn = entry['runs-on'].toLowerCase()
            if (runsOn.startsWith('windows')) {
                entry.os = 'Windows'
            } else if (runsOn.startsWith('macos')) {
                entry.os = 'macOS'
            } else {
                entry.os = 'Linux'
            }
        } else {
            entry.os = 'Linux'
        }
    }
}

async function generateMatrix(inputs) {
    function fnlog(msg) {
        log('generateMatrix: ' + msg)
    }

    let matrix = []
    const allcxxstds = ['1998.0.0', '2003.0.0', '2011.0.0', '2014.0.0', '2017.0.0', '2020.0.0', '2023.0.0', '2026.0.0']
    const cxxstds = allcxxstds.filter(v => semver.satisfies(v, inputs.standards)).map(v => semver.parse(v, {}).major)

    core.startGroup('🔄 Generating matrix entries')
    const compilers = Object.entries(inputs.compiler_versions)

    for (const [compilerName0, range] of compilers) {
        fnlog(`Generating entries for ${compilerName0} version ${range}`)
        const earliestIdx = matrix.length
        const compilerName = normalizeCompilerName(compilerName0)
        fnlog(`Find versions for ${compilerName}`)
        const allCompilerVersions = await findCompilerVersions(compilerName)
        const subrangePolicyStr = inputs.subrange_policy[compilerName] || inputs.subrange_policy[''] || 'one-per-major'
        fnlog(`Subrange policy for ${compilerName}: ${subrangePolicyStr}`)
        const subranges = splitRanges(range, allCompilerVersions, getSubrangePolicy(subrangePolicyStr))
        fnlog(`${compilerName} sub-ranges: ${JSON.stringify(subranges)}`)

        // Iterate over subranges and generate an entry for each
        for (let i = 0; i < subranges.length; i++) {
            fnlog(`Generating entry for ${compilerName} subrange ${subranges[i]}`)
            const subrange = subranges[i]
            let entry = {
                'name': `${humanizeCompilerName(compilerName)}`,
                'compiler': compilerName,
                'version': subrange,
                'env': {}
            }

            // The standards we should test with this compiler
            const minSubrangeVersion = semver.parse(semver.minSatisfying(allCompilerVersions, subrange, {}))
            const maxSubrangeVersion = semver.parse(semver.maxSatisfying(allCompilerVersions, subrange, {}))

            const compiler_cxxstds = getCompilerCxxStds(
                entry, inputs, allCompilerVersions, cxxstds, compilerName, minSubrangeVersion)
            if (compiler_cxxstds === undefined) {
                // This compiler version does not support any of the standards
                // we want to test. Skip it.
                continue
            }
            setEntrySemverComponents(entry, minSubrangeVersion, maxSubrangeVersion)
            setCompilerExecutableNames(compilerName, minSubrangeVersion, entry)
            setCompilerContainer(entry, inputs, compilerName, minSubrangeVersion, subrange)
            setCompilerCMakeGenerator(entry, inputs, compilerName, minSubrangeVersion, maxSubrangeVersion, subrange)
            setCompilerB2Toolset(entry, inputs, compilerName, subrange)
            setEntryVersionFlags(entry, i, subranges, minSubrangeVersion, maxSubrangeVersion)
            setEntryName(entry, compilerName, subrange, compiler_cxxstds)
            matrix.push(entry)
            fnlog(`Entry: ${JSON.stringify(entry)}`)
        }
        fnlog(`Apply factors for ${compilerName}`)
        const latestIdx = matrix.length - 1
        fnlog(`${compilerName}: ${latestIdx - earliestIdx} basic entries`)
        applyLatestFactors(matrix, inputs, latestIdx, earliestIdx, compilerName)
        applyVariantFactors(matrix, inputs, latestIdx, earliestIdx, compilerName)
        applyCombinatorialFactors(matrix, inputs, latestIdx, earliestIdx, compilerName)
        for (let i = earliestIdx; i < matrix.length; i++) {
            if (!('has-factors' in matrix[i])) {
                matrix[i]['has-factors'] = false
            }
            matrix[i]['is-no-factor-intermediary'] = matrix[i]['is-intermediary'] && !matrix[i]['has-factors']
            matrix[i]['is-container'] = 'container' in matrix[i]
        }
        fnlog(`${compilerName}: ${matrix.length - earliestIdx} total entries`)
    }

    function printMatrix() {
        log(`Matrix (${matrix.length} entries):`)
        matrix.forEach(obj => {
            log(`- ${JSON.stringify(obj)}`)
        })
    }

    printMatrix()
    core.endGroup()

    core.startGroup('⚙️ Set recommended flags')
    // Patch each entry with recommended flags for special factors
    for (let entry of matrix) {
        await setRecommendedFlags(entry, inputs)
    }
    printMatrix()
    core.endGroup()

    core.startGroup('👤 Set custom values')
    for (let entry of matrix) {
        if (setSuggestion(entry, 'container', inputs.containers, entry.version)) {
            entry['runs-on'] = 'ubuntu-22.04'
        }
        setSuggestion(entry, 'b2-toolset', inputs.generators, entry.version)
        setSuggestion(entry, 'generator', inputs.generators, entry.version)
        setSuggestion(entry, 'generator-toolset', inputs.generator_toolsets, entry.version)
        setSuggestion(entry, 'runs-on', inputs.runs_on, entry.version)
        setSuggestion(entry, 'ccflags', inputs.ccflags, entry.version)
        setSuggestion(entry, 'cxxflags', inputs.cxxflags, entry.version)
        setSuggestion(entry, 'install', inputs.install, entry.version)
        setSuggestion(entry, 'triplet', inputs.triplets, entry.version)
        setSuggestion(entry, 'build-type', inputs.build_types, entry.version)
        applyForcedFactors(entry, inputs.force_factors, entry.version)
    }
    printMatrix()
    core.endGroup()

    // Set entry OS
    core.startGroup('🖥️ Set OS')
    setOS(matrix)
    core.endGroup()

    if (inputs.extra_values) {
        core.startGroup('🔧 Add extra values')
        injectExtraValues(matrix, inputs.extra_values)
        core.endGroup()
    }

    core.startGroup('🔀 Sort matrix')
    sortMatrix(matrix, inputs)
    printMatrix()
    core.endGroup()

    core.startGroup('🏁 Final matrix')
    if (inputs.log_matrix) {
        core.info(`Matrix (${matrix.length} entries):`)
        matrix.forEach((obj) => {
            core.info(`- ${JSON.stringify(obj)}`)
        })
    } else {
        printMatrix()
    }
    core.endGroup()

    if (inputs.generate_summary) {
        core.startGroup('📋 C++ Matrix Summary')
        const table = generateTable(matrix, inputs)
        core.summary.addHeading('C++ Test Matrix').addTable(table).write().then(result => {
            log('Table generated', result)
        }).catch(error => {
            log('An error occurred generating the table:', error)
        })
        core.info('Summary table generated')
        core.endGroup()
    }

    if (inputs.output_file) {
        core.startGroup('📄 Write matrix to file')
        const filename = path.resolve(inputs.output_file)
        const content = JSON.stringify(matrix, null, 2)
        fs.writeFileSync(filename, content)
        core.info(`Matrix written to ${filename}`)
        core.endGroup()
    }

    return matrix
}

function factorEmoji(factor) {
    const factor_emojis = {
        'x86': '💻',
        'shared': '📚',
        'ubsan': '🔬',
        'msan': '🧹',
        'tsan': '🕵️‍♂️',
        'coverage': '📊',
        'asan': '🛡️',
        'time-trace': '⏱️',
        'fuzz': '🔀'
    }
    if (factor in factor_emojis) {
        return factor_emojis[factor]
    }
    // Check if factor contains '+'
    if (factor.includes('+')) {
        for (const composite_factor of factor.split('+')) {
            if (composite_factor in factor_emojis) {
                return factor_emojis[composite_factor]
            }
        }
    }
    return '🔢'
}

function buildTypeEmoji(build_type) {
    const build_type_emojis = {
        'debug': '🐞',
        'release': '🚀',
        'relwithdebinfo': '🔍',
        'minsizerel': '💡'
    }
    const lc_build_type = build_type.toLowerCase()
    if (lc_build_type in build_type_emojis) {
        return build_type_emojis[lc_build_type]
    }
    return '🏗️'
}

function osEmoji(os) {
    const os_emojis = {
        'windows': '🪟',
        'macos': '🍎',
        'linux': '🐧',
        'ubuntu': '🐧',
        'android': '🤖',
        'ios': '📱'
    }
    const lc_os = os.toLowerCase()
    for (const [key, value] of Object.entries(os_emojis)) {
        if (lc_os.startsWith(key)) {
            return value
        }
    }
    return '🖥️'
}

function getAllFactors(latest_factors, factors) {
    let allFactors = []
    Object.values(latest_factors).forEach(factors => {
        for (const factor of factors) {
            for (const composite_factor of factor.split('+')) {
                allFactors.push(composite_factor)
            }
        }
    })
    Object.values(factors).forEach(factors => {
        for (const factor of factors) {
            for (const composite_factor of factor.split('+')) {
                allFactors.push(composite_factor)
            }
        }
    })
    return [...new Set(allFactors)]
}

function generateTable(matrix, inputs) {
    function fnlog(msg) {
        log('generateTable: ' + msg)
    }

    const {latest_factors, factors} = inputs
    if (matrix.length === 0) {
        return []
    }

    let allFactors = getAllFactors(latest_factors, factors)
    const allFactorKeys = allFactors.map(v => v.toLowerCase())

    const headerValues = [
        '📋 Name',
        '🖥️ Environment',
        '🔧 Compiler',
        '📚 C++ Standard',
        '🏗️ Build Type',
        '🔢 Factors<br/>🚩 Flags<br/>🔧 Install',
        '🔨 Generator<br/>🛠️ Toolset<br/>💻 Triplet']
    let table = [headerValues.map(key => ({data: key, header: true}))]

    function transformStdString(inputString) {
        if (inputString === undefined || inputString === null || inputString === '') {
            return 'System Default'
        }
        const versions = inputString.split(',')
        const transformedString = versions.map((version, index) => {
            if (index === versions.length - 1) {
                return `C++${version}`
            } else {
                return `C++${version},`
            }
        }).join(' ')
        const lastIndex = transformedString.lastIndexOf(',')
        if (lastIndex !== -1) {
            return transformedString.substring(0, lastIndex) + ' and' + transformedString.substring(lastIndex + 1)
        }
        return transformedString
    }


    for (const entry of matrix) {
        let row = []
        let nameEmojis = []

        // Name
        row.push(`${entry['name']}`)

        // Environment
        if ('container' in entry) {
            // Check if it's a string
            if (typeof entry['container'] === 'string') {
                row.push(`${osEmoji(entry['container'])} <code>${entry['container']}</code><br/>on <code>${entry['runs-on']}</code>`)
            }
            // Check if it's an object with the "image" key
            else if (typeof entry['container'] === 'object' && 'image' in entry['container']) {
                row.push(`${osEmoji(entry['container']['image'])} <code>${entry['container']['image']}</code><br/>on <code>${entry['runs-on']}</code>`)
            }
        } else {
            // No container: directly on runner image
            row.push(`${osEmoji(entry['runs-on'])} <code>${entry['runs-on']}</code>`)
        }

        // Compiler
        nameEmojis.push(compilerEmoji(entry['compiler']))
        row.push(`${compilerEmoji(entry['compiler'])} ${humanizeCompilerName(entry['compiler'])} <i>${entry['version']}</i>`)
        // Standards
        row.push(`${transformStdString(entry['cxxstd'])}`)

        // Build type
        if ('build-type' in entry) {
            row.push(`${buildTypeEmoji(entry['build-type'])} ${entry['build-type']}`)
        } else {
            row.push('')
        }

        // Description/Factors
        let descriptionStrs = []

        // - Factors
        let entryFactors = []
        for (let i = 0; i < allFactors.length && i < allFactorKeys.length; i++) {
            const fact = allFactors[i]
            const key = allFactorKeys[i]
            if (entry[key] === true) {
                entryFactors.push(`${factorEmoji(key)} ${fact}`)
                nameEmojis.push(factorEmoji(key))
            }
        }
        if (entryFactors.length !== 0) {
            descriptionStrs.push(entryFactors.join(', '))
        }

        // - Latest/Main/Unique/Earliest
        if (entry['is-main'] === true) {
            if (entry['is-earliest'] === true) {
                // This is latest, earliest, and main
                if (entry['version'] === '*') {
                    // Version is *, so any version: the system compiler
                    descriptionStrs.push(`🧰 System ${humanizeCompilerName(entry['compiler'])} version`)
                    nameEmojis.push('🧰')
                } else {
                    // Both main/latest and earliest, so this is a unique version
                    descriptionStrs.push(`🎩 Unique ${humanizeCompilerName(entry['compiler'])} version`)
                    nameEmojis.push('🎩')
                }
            } else {
                // Main but not earliest: latest
                descriptionStrs.push(`🆕 Latest ${humanizeCompilerName(entry['compiler'])} version`)
                nameEmojis.push('🆕')
            }
        } else if (entry['is-earliest'] === true) {
            // Earliest but not main: describe as earliest
            descriptionStrs.push(`🕰️ Earliest ${humanizeCompilerName(entry['compiler'])} version`)
            nameEmojis.push('🕰️')
        } else if (entryFactors.length === 0) {
            // No factors, not main/latest/early: Just an intermediary compiler version
            descriptionStrs.push(`(Intermediary ${humanizeCompilerName(entry['compiler'])} version)`)
        }

        // - C++ Flags
        let cxxflags = ''
        if (entry['cxxflags'] === entry['ccflags']) {
            if (entry['cxxflags'].length !== 0) {
                // Split entry['cxxflags'] on whitespaces and join with <code> tags around it
                cxxflags = `<code>${entry['cxxflags'].split(' ').join('</code> <code>')}</code>`
            } else {
                cxxflags = ''
            }
        } else {
            if (entry['cxxflags'].length !== 0 || entry['ccflags'].length !== 0) {
                cxxflags = `C++: <code>${entry['cxxflags'].split(' ').join('</code> <code>')}</code>, C: <code>${entry['ccflags'].split(' ').join('</code> <code>')}</code>`
            } else {
                cxxflags = ''
            }
        }
        if (cxxflags !== '') {
            descriptionStrs.push(`🚩 ${cxxflags}`)
        }

        // - Install
        if ('install' in entry && entry['install'] !== '') {
            descriptionStrs.push(`🔧 <code>${entry['install'].split(' ').join('</code> <code>')}</code>`)
        }
        row.push(descriptionStrs.join('<br/>'))

        // Generator/Toolset/Triplet
        let generator_str = ''
        if ('generator' in entry) {
            generator_str += `<code>${entry['generator']}</code>`
            if ('generator-toolset' in entry) {
                generator_str += ` (<code>${entry['generator-toolset']}</code>)`
            }
        } else {
            generator_str += 'System Default'
        }
        if ('b2-toolset' in entry) {
            generator_str += `<br/><code>${entry['b2-toolset']}</code>`
        }
        if ('triplet' in entry) {
            generator_str += `<br/><code>${entry['triplet']}</code>`
        }
        row.push(generator_str)

        // Apply emojis to name
        row[0] = `${nameEmojis.join('')} ${row[0]}`

        table.push(row)

        fnlog(`- ${JSON.stringify(row)}`)
    }

    return table
}

function normalizeCompilerNameKeys(obj) {
    for (const [name, value] of Object.entries(obj)) {
        const newName = normalizeCompilerName(name)
        if (newName !== name) {
            obj[newName] = value
            delete obj[name]
        }
    }
}

function normalizeCompilerNameSuggestions(suggestionMap) {
    if (isArrayOfObjects(suggestionMap)) {
        suggestionMap = []
    }
    suggestionMap.forEach(obj => {
        obj['compiler'] = normalizeCompilerName(obj['compiler'])
    })
}

function parseKeyValues(lines) {
    const keyValues = []
    for (const line of lines) {
        const [key, value] = line.split(':')
        if (key && value) {
            keyValues.push({key: key.trim(), value: value.trim()})
        } else if (key) {
            keyValues.push({key: '', value: key.trim()})
        }
    }
    return keyValues
}

function parseMap(lines) {
    const keyValues = {}
    for (const line of lines) {
        const [key, value] = line.split(':')
        if (key && value) {
            keyValues[key.trim()] = value.trim()
        } else if (key) {
            keyValues[''] = key.trim()
        }
    }
    return keyValues
}

function normalizePath(path) {
    const pathIsString = typeof path === 'string' || path instanceof String
    if (pathIsString && process.platform === 'win32') {
        return path.replace(/\\/g, '/')
    }
    return path
}

async function run() {
    try {
        const compilerVersions = parseCompilerRequirements(core.getInput('compilers'))
        let inputs = {
            // Compilers
            compiler_versions: compilerVersions,
            subrange_policy: parseMap(core.getMultilineInput('subrange-policy')),
            standards: normalizeCppVersionRequirement(core.getInput('standards')),
            max_standards: parseInt(core.getInput('max-standards').trim()),

            // Factors
            latest_factors: parseCompilerFactors(core.getInput('latest-factors'), Object.keys(compilerVersions)),
            factors: parseCompilerFactors(core.getInput('factors'), Object.keys(compilerVersions)),
            combinatorial_factors: parseCompilerFactors(core.getInput('combinatorial-factors'), Object.keys(compilerVersions)),
            force_factors: parseCompilerSuggestions(core.getMultilineInput('force-factors'), Object.keys(compilerVersions)),
            extra_values: parseKeyValues(core.getMultilineInput('extra-values')),

            // Customize suggestions
            runs_on: parseCompilerSuggestions(core.getMultilineInput('runs-on'), Object.keys(compilerVersions)),
            containers: parseCompilerSuggestions(core.getMultilineInput('containers'), Object.keys(compilerVersions)),
            generators: parseCompilerSuggestions(core.getMultilineInput('generators'), Object.keys(compilerVersions)),
            generator_toolsets: parseCompilerSuggestions(core.getMultilineInput('generator-toolsets'), Object.keys(compilerVersions)),
            b2_toolsets: parseCompilerSuggestions(core.getMultilineInput('b2-toolsets'), Object.keys(compilerVersions)),
            ccflags: parseCompilerSuggestions(core.getMultilineInput('ccflags'), Object.keys(compilerVersions)),
            cxxflags: parseCompilerSuggestions(core.getMultilineInput('cxxflags'), Object.keys(compilerVersions)),
            install: parseCompilerSuggestions(core.getMultilineInput('install'), Object.keys(compilerVersions)),
            triplets: parseCompilerSuggestions(core.getMultilineInput('triplets'), Object.keys(compilerVersions)),
            build_types: parseCompilerSuggestions(core.getMultilineInput('build-types'), Object.keys(compilerVersions)),

            // Customization flags
            default_build_type: core.getInput('default-build-type').trim() || 'Release',
            sanitizer_build_type: core.getInput('sanitizer-build-type').trim() || 'Release',
            x86_build_type: core.getInput('x86-build-type').trim() || 'Release',
            use_containers: core.getBooleanInput('use-containers'),

            // Output file
            output_file: normalizePath(core.getInput('output-file')),

            // Annotations and tracing
            log_matrix: core.getBooleanInput('log-matrix'),
            generate_summary: core.getBooleanInput('generate-summary'),
            trace_commands: core.getBooleanInput('trace-commands')
        }

        trace_commands = isTruthy(inputs.trace_commands) || process.env['ACTIONS_STEP_DEBUG'] === 'true'

        // Normalize compiler names in the keys of compiler_versions,
        // latest_factors, factors, combinatorial_factors
        normalizeCompilerNameKeys(inputs.subrange_policy)
        normalizeCompilerNameKeys(inputs.compiler_versions)
        normalizeCompilerNameKeys(inputs.latest_factors)
        normalizeCompilerNameKeys(inputs.factors)
        normalizeCompilerNameKeys(inputs.combinatorial_factors)

        // Normalize compiler names in the 'compiler' fields of runs_on and
        // containers. They are arrays of objects.
        normalizeCompilerNameSuggestions(inputs.runs_on)
        normalizeCompilerNameSuggestions(inputs.containers)
        normalizeCompilerNameSuggestions(inputs.generators)
        normalizeCompilerNameSuggestions(inputs.generator_toolsets)
        normalizeCompilerNameSuggestions(inputs.b2_toolsets)
        normalizeCompilerNameSuggestions(inputs.ccflags)
        normalizeCompilerNameSuggestions(inputs.cxxflags)
        normalizeCompilerNameSuggestions(inputs.install)
        normalizeCompilerNameSuggestions(inputs.triplets)
        normalizeCompilerNameSuggestions(inputs.build_types)

        core.startGroup('📥 C++ Matrix Requirements')
        for (const [name, value] of Object.entries(inputs)) {
            core.info(`🧩 ${name.replaceAll('_', '-')}: ${JSON.stringify(value)}`)
        }
        core.endGroup()

        try {
            const matrix = await generateMatrix(inputs)
            core.setOutput('matrix', matrix)

        } catch (error) {
            core.setFailed(`${error.message}\n${error.stack}`)
        }
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
    isTruthy,
    parseCompilerRequirements,
    parseCompilerSuggestions,
    normalizeCppVersionRequirement,
    parseCompilerFactors,
    normalizeCompilerName,
    findGCCVersions,
    findClangVersions,
    findMSVCVersions,
    SubrangePolicies,
    splitRanges,
    generateMatrix,
    generateTable
}
