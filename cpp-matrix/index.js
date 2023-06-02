const core = require('@actions/core');
const github = require('@actions/github');
const semver = require('semver');
const fs = require('fs');
const {execSync} = require("child_process");

let trace_commands = false;

function log(...args) {
    if (trace_commands) {
        console.log(...args);
    }
}

function isTruthy(s) {
    s = s.trim()
    return s !== '' && s.toLowerCase() !== 'false'
}

function parseCompilerRequirements(inputString) {
    const tokens = inputString.split(/[\n\s]+/);
    const compilers = {};

    let currentCompiler = null;
    let currentRequirements = '';

    for (const token of tokens) {
        if (/^[a-zA-Z\-]+$/.test(token)) {
            if (currentCompiler) {
                compilers[currentCompiler] = semver.validRange(currentRequirements.trim(), {loose: true});
                currentRequirements = '';
            }
            currentCompiler = token;
        } else {
            currentRequirements += ' ' + token.trim();
        }
    }

    if (currentCompiler) {
        compilers[currentCompiler] = currentRequirements.trim();
    }

    return compilers;
}

function parseCompilerFactors(inputString, compilers) {
    const tokens = inputString.split(/[\n\s]+/);

    const compilerFactors = {};
    let currentCompiler = null;
    let currentFactors = [];

    for (const token of tokens) {
        if (compilers.includes(token)) {
            if (currentCompiler) {
                compilerFactors[currentCompiler] = currentFactors;
                currentFactors = [];
            }
            currentCompiler = token.trim();
        } else {
            currentFactors.push(token.trim())
        }
    }

    if (currentCompiler) {
        compilerFactors[currentCompiler] = currentFactors
    }

    return compilerFactors;
}

function normalizeCppVersionRequirement(range) {
    // Regular expression to match two-digit C++ versions
    const regex = /\b(\d{2})\b/g;

    const currentYear = new Date().getFullYear()
    const currentCenturyFirstYear = Math.floor(currentYear / 100) * 100;
    const previousCenturyFirstYear = currentCenturyFirstYear - 100;

    // Replace the two-digit versions with their corresponding four-digit versions
    const replacedRange = range.replace(regex, (match, version) => {
        const year = parseInt(version);
        if (year >= 0 && year <= 99) {
            const a = currentCenturyFirstYear + year;
            const b = previousCenturyFirstYear + year;
            const a_diff = Math.abs(currentYear - a);
            const b_diff = Math.abs(currentYear - b);
            if (a_diff < b_diff) {
                return a.toString();
            } else {
                return b.toString();
            }
        }
        return match; // Return the match as is if it's not a two-digit version
    });

    return replacedRange.trim();
}

function normalizeCompilerName(name) {
    const lowerCaseName = name.toLowerCase();

    if (lowerCaseName.startsWith('gcc') || lowerCaseName.startsWith('g++') || lowerCaseName.startsWith('gcc-')) {
        return 'gcc';
    } else if (lowerCaseName.startsWith('clang') || lowerCaseName.startsWith('clang++') || lowerCaseName.startsWith('llvm')) {
        return 'clang';
    } else if (lowerCaseName.startsWith('msvc') || lowerCaseName.startsWith('cl') || lowerCaseName.startsWith('visual studio') || lowerCaseName.startsWith('vc')) {
        return 'msvc';
    } else if (lowerCaseName.startsWith('min-gw') || lowerCaseName.startsWith('mingw')) {
        return 'mingw';
    }

    // Return the original name if no normalization rule matches
    return name;
}

const fetchGitTags = (repo) => {
    try {
        const stdout = execSync("git ls-remote --tags " + repo).toString();
        const tags = stdout.split("\n").filter(tag => tag.trim() !== "");
        let gitTags = []
        for (const tag of tags) {
            const parts = tag.split("\t")
            if (parts.length > 1) {
                let ref = parts[1]
                if (!ref.endsWith('^{}')) {
                    gitTags.push(ref)
                }
            }
        }
        return gitTags;
    } catch (error) {
        throw new Error("Error fetching Git tags: " + error.message);
    }
};

function readVersionsFromFile(filename) {
    try {
        const fileContents = fs.readFileSync(filename, 'utf8');
        const versions = JSON.parse(fileContents);
        if (Array.isArray(versions)) {
            return versions;
        }
    } catch (error) {
        // File reading failed or versions couldn't be parsed
    }
    return null;
}

function saveVersionsToFile(versions, filename) {
    try {
        const fileContents = JSON.stringify(versions);
        fs.writeFileSync(filename, fileContents, 'utf8');
        log('Versions saved to file.');
    } catch (error) {
        log('Error saving versions to file: ' + error);
    }
}


function findGCCVersionsImpl() {
    let cachedVersions = null; // Cache variable to store the versions

    return function () {
        if (cachedVersions !== null) {
            // Return the cached versions if available
            return cachedVersions;
        }

        // Check if the versions can be read from a file
        const versionsFromFile = readVersionsFromFile('gcc-versions.txt');
        if (versionsFromFile !== null) {
            cachedVersions = versionsFromFile;
            log("GCC versions (from file): " + versionsFromFile);
            return versionsFromFile;
        }

        const regex = /^refs\/tags\/releases\/gcc-(\d+\.\d+\.\d+)$/;
        let versions = [];
        const gitTags = fetchGitTags("git://gcc.gnu.org/git/gcc.git");
        for (const tag of gitTags) {
            if (tag.match(regex)) {
                const version = tag.match(regex)[1];
                versions.push(version);
            }
        }
        versions = versions.sort(semver.compare);
        cachedVersions = versions;
        log("GCC versions: " + versions);
        saveVersionsToFile(versions, 'gcc-versions.txt');
        return versions
    }
}

const findGCCVersions = findGCCVersionsImpl();

function findClangVersionsImpl() {
    let cachedVersions = null; // Cache variable to store the versions

    return function () {
        if (cachedVersions !== null) {
            // Return the cached versions if available
            return cachedVersions;
        }

        const versionsFromFile = readVersionsFromFile('clang-versions.txt');
        if (versionsFromFile !== null) {
            cachedVersions = versionsFromFile;
            log("GCC versions (from file): " + versionsFromFile);
            return versionsFromFile;
        }

        const regex = /^refs\/tags\/llvmorg-(\d+\.\d+\.\d+)$/;
        let versions = [];
        const gitTags = fetchGitTags("https://github.com/llvm/llvm-project");
        for (const tag of gitTags) {
            if (tag.match(regex)) {
                const version = tag.match(regex)[1];
                versions.push(version);
            }
        }
        versions = versions.sort(semver.compare);
        log("Clang versions: " + versions);
        cachedVersions = versions;
        saveVersionsToFile(versions, 'clang-versions.txt');
        return versions;
    };
}

// Usage:
const findClangVersions = findClangVersionsImpl();

function findMSVCVersions() {
    // MSVC is not open source, so we assume the versions available from github runner images are available
    // See:
    // https://en.wikipedia.org/wiki/Microsoft_Visual_C%2B%2B

    // windows-2019 -> ['10.0.40219', '12.0.40660', '14.29.30139', '14.34.31938']
    // windows-2022 -> ['12.0.40660', '14.34.31938']
    // https://github.com/actions/runner-images/blob/main/images/win/Windows2019-Readme.md#microsoft-visual-c
    // https://github.com/actions/runner-images/blob/main/images/win/Windows2022-Readme.md#microsoft-visual-c
    return ['10.0.40219', '12.0.40660', '14.29.30139', '14.34.31938']
}

function findCompilerVersions(compiler) {
    if (compiler === 'gcc') {
        return findGCCVersions()
    } else if (compiler === 'clang') {
        return findClangVersions()
    } else if (compiler === 'msvc') {
        return findMSVCVersions()
    }
    return []
}

function getVisualCppYear(msvc_version) {
    const v = semver.parse(msvc_version)
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
        return false;
    }

    const sortedArr1 = arr1.slice().sort();
    const sortedArr2 = arr2.slice().sort();

    for (let i = 0; i < sortedArr1.length; i++) {
        if (sortedArr1[i] !== sortedArr2[i]) {
            return false;
        }
    }

    return true;
}


const SubrangePolicies = {
    ONE_PER_MAJOR: 0, ONE_PER_MINOR: 1, DEFAULT: 2
};

function splitRanges(range, versions, policy = SubrangePolicies.DEFAULT) {
    if (versions.length === 0) {
        // We know nothing about the available versions for that compiler, so we just return "*"
        return ['*']
    }

    versions = versions.map(s => semver.parse(s))
    const minVersion = semver.minSatisfying(versions, range)
    const maxVersion = semver.maxSatisfying(versions, range)
    if (minVersion === null || maxVersion === null) {
        return ['*']
    }
    const default_policy = minVersion.major === maxVersion.major ? SubrangePolicies.ONE_PER_MINOR : SubrangePolicies.ONE_PER_MAJOR;
    const effective_policy = policy == SubrangePolicies.DEFAULT ? default_policy : policy;
    const range_versions = versions.filter(v => semver.satisfies(v, range))
    let subranges = []
    if (effective_policy === SubrangePolicies.ONE_PER_MAJOR) {
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
                if (major_versions.some(v => v.minor == latest_major_versions[0].minor && !semver.satisfies(v, range))) {
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
                if (major_versions.some(v => v.minor == earliest_major_versions[earliest_major_versions.length - 1].minor && !semver.satisfies(v, range))) {
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
        // Add each major range (1, 2, 3, ...) from the main range for which there is a valid version
        for (let i = minVersion.major; i <= maxVersion.major; i++) {
            const unique_minors = versions
                .filter(v => v.major == i)
                .map(v => v.minor)
                .sort()
                .filter((value, index, self) => self.indexOf(value) === index);
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
        return (cxxstd <= 2020 && semver.satisfies(version, '>=11')) || (cxxstd <= 2017 && semver.satisfies(version, '>=7')) || (cxxstd <= 2014 && semver.satisfies(version, '>=6')) || (cxxstd <= 2011 && semver.satisfies(version, '>=4')) || cxxstd <= 2003
    }
    if (compiler === 'clang') {
        return (cxxstd <= 2020 && semver.satisfies(version, '>=12')) || (cxxstd <= 2017 && semver.satisfies(version, '>=6')) || (cxxstd <= 2014 && semver.satisfies(version, '>=4')) || (cxxstd <= 2011 && semver.satisfies(version, '>=3')) || cxxstd <= 2003
    }
    if (compiler === 'msvc') {
        return (cxxstd <= 2020 && semver.satisfies(version, '>=14.30')) || (cxxstd <= 2017 && semver.satisfies(version, '>=14.20')) || (cxxstd <= 2014 && semver.satisfies(version, '>=14.11')) || (cxxstd <= 2011 && semver.satisfies(version, '>=14')) || (cxxstd <= 2011 && semver.satisfies(version, '>=14.1')) || cxxstd <= 2003
    }
    return false
}

function humanizeCompilerName(compiler) {
    const human_compiler_names = {
        'gcc': 'GCC',
        'clang': 'Clang',
        'apple-clang': 'Apple-Clang',
        'msvc': 'MSVC',
        'mingw': 'MinGW'
    };
    if (compiler in human_compiler_names) {
        return human_compiler_names[compiler]
    }
    return compiler
}

function compilerEmoji(compiler, with_emoji = false) {
    const compiler_emojis = {
        'gcc': '🐧',
        'clang': '🔧',
        'apple-clang': '🍏',
        'msvc': '🪟',
        'mingw': '🪓'
    };
    if (compiler in compiler_emojis) {
        return compiler_emojis[compiler]
    }
    return '🛠️'
}

function generateMatrix(compilerVersions, standards, max_standards, latest_factors, factors) {
    let matrix = []

    const allcxxstds = ['1998.0.0', '2003.0.0', '2011.0.0', '2014.0.0', '2017.0.0', '2020.0.0', '2023.0.0', '2026.0.0']
    const cxxstds = allcxxstds.filter(v => semver.satisfies(v, standards)).map(v => semver.parse(v).major)

    for (const [compiler, range] of Object.entries(compilerVersions)) {
        log(`Generating entry for ${compiler} version ${range}`);
        const earliestIdx = matrix.length
        const name = normalizeCompilerName(compiler)
        const versions = findCompilerVersions(compiler)
        const subranges = splitRanges(range, versions, SubrangePolicies.DEFAULT)
        log(`GCC subranges: ${JSON.stringify(subranges)}`)
        for (let i = 0; i < subranges.length; i++) {
            const subrange = subranges[i]
            let entry = {'compiler': compiler, 'version': subrange}

            // The standards we should test with this compiler
            let compiler_cxxs = []
            const minSubrangeVersion = semver.parse(semver.minSatisfying(versions, subrange))
            const maxSubrangeVersion = semver.parse(semver.maxSatisfying(versions, subrange))
            if (versions.length !== 0) {
                for (const cxxstd of cxxstds) {
                    if (compilerSupportsStd(compiler, minSubrangeVersion, cxxstd)) {
                        compiler_cxxs.push(cxxstd)
                    }
                }
                if (max_standards != null && max_standards !== 0 && compiler_cxxs.length > max_standards) {
                    compiler_cxxs = compiler_cxxs.splice(-max_standards)
                }
                compiler_cxxs = compiler_cxxs.map(v => v.toString().slice(-2))
                entry['cxxstd'] = compiler_cxxs.join(',')
            }

            // usual cxx/cc names (no name usually needed for msvc)
            if (compiler === 'gcc') {
                if (semver.satisfies(minSubrangeVersion, '>=5')) {
                    entry['cxx'] = `g++-${minSubrangeVersion.major}`
                    entry['cc'] = `gcc-${minSubrangeVersion.major}`
                } else {
                    entry['cxx'] = `g++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
                    entry['cc'] = `gcc-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
                }
            } else if (compiler === 'clang') {
                if (semver.satisfies(minSubrangeVersion, '>=7')) {
                    entry['cxx'] = `clang++-${minSubrangeVersion.major}`
                    entry['cc'] = `clang-${minSubrangeVersion.major}`
                } else {
                    entry['cxx'] = `clang++-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
                    entry['cc'] = `clang-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
                }
            } else if (compiler === 'apple-clang') {
                entry['cxx'] = `clang++`
                entry['cc'] = `clang`
            } else if (compiler === 'mingw') {
                entry['cxx'] = `g++`
                entry['cc'] = `gcc`
            }

            // runs-on / container
            if (compiler === 'gcc') {
                if (semver.satisfies(minSubrangeVersion, '>=9')) {
                    entry['runs-on'] = 'ubuntu-22.04'
                } else if (semver.satisfies(minSubrangeVersion, '>=7')) {
                    entry['runs-on'] = 'ubuntu-20.04'
                } else {
                    entry['runs-on'] = 'ubuntu-22.04'
                    entry['container'] = 'ubuntu:18.04'
                }
            } else if (compiler === 'clang') {
                if (semver.satisfies(minSubrangeVersion, '>=12')) {
                    entry['runs-on'] = 'ubuntu-22.04'
                } else if (semver.satisfies(minSubrangeVersion, '>=6')) {
                    entry['runs-on'] = 'ubuntu-20.04'
                } else if (semver.satisfies(minSubrangeVersion, '>=3.9')) {
                    entry['runs-on'] = 'ubuntu-22.04'
                    entry['container'] = 'ubuntu:18.04'
                } else {
                    entry['runs-on'] = 'ubuntu-22.04'
                    entry['container'] = 'ubuntu:16.04'
                }
            } else if (compiler === 'msvc') {
                if (semver.satisfies(minSubrangeVersion, '>=14.30')) {
                    entry['runs-on'] = 'windows-2022'
                } else {
                    entry['runs-on'] = 'windows-2019'
                }
            } else if (compiler === 'apple-clang') {
                entry['runs-on'] = 'macos-11'
            } else if (compiler === 'mingw') {
                entry['runs-on'] = 'windows-2022'
            }

            // Recommended b2-toolset
            if (compiler === 'gcc') {
                entry['b2-toolset'] = `gcc`
                // if (semver.satisfies(minSubrangeVersion, '>=5')) {
                //     entry['b2-toolset'] = `gcc-${minSubrangeVersion.major}`
                // } else {
                //     entry['b2-toolset'] = `gcc-${minSubrangeVersion.major}.${minSubrangeVersion.minor}`
                // }
            } else if (compiler === 'clang' || compiler === 'apple-clang') {
                entry['b2-toolset'] = `clang`
            } else if (compiler === 'msvc') {
                entry['b2-toolset'] = `msvc`
            } else if (compiler === 'mingw') {
                entry['b2-toolset'] = `gcc`
            }

            // Recommended cmake generator
            if (compiler === 'msvc') {
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
            }

            // Latest flag
            entry['is-latest'] = i === subranges.length - 1
            entry['is-main'] = i === subranges.length - 1

            // Earliest flag
            entry['is-earliest'] = i === 0

            // Come up with a name for this entry
            let name = `${humanizeCompilerName(compiler)}`
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

            matrix.push(entry)
        }
        const latestIdx = matrix.length - 1
        log(`${compiler}: ${latestIdx - earliestIdx} basic entries`)

        // Apply latest factors
        if (compiler in latest_factors) {
            for (const factor of latest_factors[compiler]) {
                let latest_copy = {...matrix[latestIdx]};
                latest_copy['is-main'] = false
                latest_copy[factor.toLowerCase()] = true
                latest_copy['name'] += ` (${factor})`
                matrix.push(latest_copy)
            }
            for (let i = earliestIdx; i < matrix.length; i++) {
                for (const factor of latest_factors[compiler]) {
                    if (!(factor.toLowerCase() in matrix[i])) {
                        matrix[i][factor.toLowerCase()] = false
                    }
                }
            }
        }

        // Apply variant factors
        let variantIdx = latestIdx
        if (variantIdx !== earliestIdx) {
            variantIdx--;
        }
        if (compiler in factors) {
            for (const factor of factors[compiler]) {
                if (variantIdx !== earliestIdx) {
                    matrix[variantIdx][factor.toLowerCase()] = true
                    matrix[variantIdx]['name'] += ` (${factor})`
                    variantIdx--
                } else {
                    let latest_copy = {...matrix[latestIdx]};
                    latest_copy['is-main'] = false
                    latest_copy[factor.toLowerCase()] = true
                    latest_copy['name'] += ` (${factor})`
                    matrix.push(latest_copy)
                }
            }
            for (let i = earliestIdx; i < matrix.length; i++) {
                for (const factor of factors[compiler]) {
                    if (!(factor.toLowerCase() in matrix[i])) {
                        matrix[i][factor.toLowerCase()] = false
                    }
                }
            }
        }

        /*
         * We can look at ci.yml to understand what suggestions would make usage
         * simpler.
         *
         * We have to document all this stuff the action does. There's a lot in
         * here. We can get started by looking at each key/value in the entries
         * and ensure they are all documented.
         */

        log(`${compiler}: ${latestIdx - earliestIdx} total entries`)
    }

    // Patch with recommended flags for special factors
    for (let entry of matrix) {
        entry['build-type'] = 'Release'
        entry['cxxflags'] = ''
        entry['ccflags'] = ''
        if ('asan' in entry && entry['asan'] === true) {
            if (entry['compiler'] === 'gcc' || entry['compiler'] === 'clang') {
                entry['cxxflags'] += ' -fsanitize=address'
                entry['ccflags'] += ' -fsanitize=address'
                entry['build-type'] = 'Debug'
            }
        }
        if ('ubsan' in entry && entry['ubsan'] === true) {
            if (entry['compiler'] === 'gcc' || entry['compiler'] === 'clang') {
                entry['cxxflags'] += ' -fsanitize=undefined'
                entry['ccflags'] += ' -fsanitize=undefined'
                entry['build-type'] = 'Debug'
            }
        }
        if ('msan' in entry && entry['msan'] === true) {
            if (entry['compiler'] === 'gcc' || entry['compiler'] === 'clang') {
                entry['cxxflags'] += ' -fsanitize=memory'
                entry['ccflags'] += ' -fsanitize=memory'
                entry['build-type'] = 'Debug'
            }
        }
        if ('tsan' in entry && entry['tsan'] === true) {
            if (entry['compiler'] === 'gcc' || entry['compiler'] === 'clang') {
                entry['cxxflags'] += ' -fsanitize=thread'
                entry['ccflags'] += ' -fsanitize=thread'
                entry['build-type'] = 'Debug'
            }
        }
        if ('coverage' in entry && entry['coverage'] === true) {
            if (entry['compiler'] === 'gcc') {
                entry['cxxflags'] += ' --coverage -fprofile-arcs -ftest-coverage'
                entry['ccflags'] += ' --coverage -fprofile-arcs -ftest-coverage'
            } else if (entry['compiler'] === 'clang') {
                entry['cxxflags'] += ' -fprofile-instr-generate -fcoverage-mapping'
                entry['ccflags'] += ' -fprofile-instr-generate -fcoverage-mapping'
            }
            entry['build-type'] = 'Debug'
        }
        if ('time-trace' in entry && entry['time-trace'] === true) {
            if (entry['compiler'] === 'clang') {
                const v = semver.minSatisfying(findClangVersions(), entry['version'])
                if (semver.satisfies(v, entry['version'])) {
                    entry['cxxflags'] += ' -ftime-trace'
                    entry['ccflags'] += ' -ftime-trace'
                }
            }
        }
        entry['cxxflags'] = entry['cxxflags'].trim()
        entry['ccflags'] = entry['ccflags'].trim()
    }

    // Sort matrix
    const contains_factor = (entry) => {
        let allFactors = []
        if (entry['compiler'] in latest_factors) {
            allFactors.push(...latest_factors[entry['compiler']])
        }
        if (entry['compiler'] in factors) {
            allFactors.push(...factors[entry['compiler']])
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
        return entry["is-latest"] && !entry["is-earliest"] && !contains_factor(entry)
    }

    const is_unique_no_factor = (entry) => {
        return entry["is-latest"] && entry["is-earliest"] && !contains_factor(entry)
    }

    const is_earliest_no_factor = (entry) => {
        return entry["is-earliest"] && !entry["is-latest"] && !contains_factor(entry)
    }

    matrix.reverse()
    matrix.sort(function (a, b) {
        // Latest compilers come first
        const a0 = is_latest_no_factor(a)
        const b0 = is_latest_no_factor(b)
        if (a0 && !b0) {
            return -1;
        } else if (!a0 && b0) {
            return 1;
        }

        // Then compilers with a single version
        const a1 = is_unique_no_factor(a)
        const b1 = is_unique_no_factor(b)
        if (a1 && !b1) {
            return -1;
        } else if (!a1 && b1) {
            return 1;
        }

        // Then the oldest compilers
        const a2 = is_earliest_no_factor(a)
        const b2 = is_earliest_no_factor(b)
        if (a2 && !b2) {
            return -1;
        } else if (!a2 && b2) {
            return 1;
        }

        // Then configurations with special factors
        const a3 = contains_factor(a)
        const b3 = contains_factor(b)
        if (a3 && !b3) {
            return -1;
        } else if (!a3 && b3) {
            return 1;
        }

        // Then, ceteris paribus, compilers with fewer entries come first
        // so that it increases the changes all seeing all compilers on the screen
        const an = matrix.filter(entry => entry.compiler === a.compiler).length;
        const bn = matrix.filter(entry => entry.compiler === b.compiler).length;
        if (an < bn) {
            return -1;
        } else if (an > bn) {
            return 1;
        } else {
            return 0;
        }
    });

    log(JSON.stringify(matrix, null, 2))
    return matrix
}

function factorEmoji(factor) {
    const factor_emojis = {
        'x86': '💻',
        'shared': '📚',
        'ubsan': '🔬',
        'tsan': '🕵️‍♂️',
        'coverage': '📊',
        'asan': '🛡️',
        'time-trace': '⏱️'
    };
    if (factor in factor_emojis) {
        return factor_emojis[factor]
    }
    return '🔢'
}

function buildTypeEmoji(build_type) {
    const build_type_emojis = {
        'debug': '🐞',
        'release': '🚀',
        'relwithdebinfo': '🔍',
        'minsizerel': '💡'
    };
    lc_build_type = build_type.toLowerCase()
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
    };
    lc_os = os.toLowerCase()
    for (const [key, value] of Object.entries(os_emojis)) {
        if (lc_os.startsWith(key)) {
            return value;
        }
    }
    return '🖥️'
}

function generateTable(matrix, latest_factors, factors) {
    if (matrix.length === 0) {
        return [];
    }

    let allFactors = []
    Object.values(latest_factors).forEach(factors => {
        allFactors.push(...factors);
    });
    Object.values(factors).forEach(factors => {
        allFactors.push(...factors);
    });
    allFactors = [...new Set(allFactors)];

    const allFactorKeys = allFactors.map(v => v.toLowerCase())

    const headerEmojis = ['📋', '🖥️', '🔧', '📚', '🏗️', '🔢', '🔨', '🛠️'];
    const headerNames = ['Name', 'Environment', 'Compiler', 'C++ Standard', 'Build Type', 'Factors', 'Generator', 'Toolset'];
    const headerWithEmojis = headerNames.map((element, index) => `${headerEmojis[index]} ${element}`);
    const headerRow = headerWithEmojis.map(key => ({data: key, header: true}))

    let table = [headerRow];

    function transformStdString(inputString) {
        if (inputString === undefined || inputString === null || inputString === '') {
            return "System Default"
        }
        const versions = inputString.split(',');
        const transformedString = versions.map((version, index) => {
            if (index === versions.length - 1) {
                return `C++${version}`;
            } else {
                return `C++${version},`;
            }
        }).join(' ');
        const lastIndex = transformedString.lastIndexOf(',');
        if (lastIndex !== -1) {
            const finalString = transformedString.substring(0, lastIndex) + ' and' + transformedString.substring(lastIndex + 1);
            return finalString;
        }
        return transformedString;
    }


    for (const entry of matrix) {
        let row = []
        // Name
        row.push(`${entry['name']}`)
        // Environment
        if ('container' in entry) {
            row.push(`${osEmoji(entry['container'])} <code>${entry['container']}</code> on <code>${entry['runs-on']}</code>`)
        } else {
            row.push(`${osEmoji(entry['runs-on'])} <code>${entry['runs-on']}</code>`)
        }
        // Compiler
        row.push(`${compilerEmoji(entry['compiler'])} ${humanizeCompilerName(entry['compiler'])} ${entry['version']}`)
        let nameEmojis = [compilerEmoji(entry['compiler'])]
        // Standards
        row.push(`${transformStdString(entry['cxxstd'])}`)

        // Build type
        if ('build-type' in entry) {
            row.push(`${buildTypeEmoji(entry['build-type'])} ${entry['build-type']}`)
        } else {
            row.push('')
        }
        // Factors
        let cxxflags = ''
        if (entry['cxxflags'] === entry['ccflags']) {
            if (entry['cxxflags'].length !== 0) {
                cxxflags = `<code>${entry['cxxflags']}</code>`
            } else {
                cxxflags = ''
            }
        } else {
            if (entry['cxxflags'].length !== 0 || entry['ccflags'].length !== 0) {
                cxxflags = `C++: <code>${entry['cxxflags']}</code>, C: <code>${entry['ccflags']}</code>`
            } else {
                cxxflags = ''
            }
        }

        if (entry['is-main'] === true) {
            if (entry['is-earliest'] === true) {
                // This is latest, earliest, and main
                if (entry['version'] == '*') {
                    row.push(`💻 System ${humanizeCompilerName(entry['compiler'])} version`)
                } else {
                    row.push(`💻 Unique ${humanizeCompilerName(entry['compiler'])} version`)
                }
                nameEmojis.push('💻')
            } else {
                row.push(`🆕 Latest ${humanizeCompilerName(entry['compiler'])} version`)
                nameEmojis.push('🆕')
            }
        } else {
            let factors = []
            for (let i = 0; i < allFactors.length && i < allFactorKeys.length; i++) {
                const fact = allFactors[i];
                const key = allFactorKeys[i];
                if (entry[key] === true) {
                    factors.push(`${factorEmoji(key)} ${fact}`)
                    nameEmojis.push(factorEmoji(key))
                }
            }
            let factors_str = factors.join(', ')
            if (factors_str === '') {
                if (entry['is-earliest'] === true) {
                    factors_str = `🕒 Earliest ${humanizeCompilerName(entry['compiler'])} version`
                    nameEmojis.push('🕒')
                } else {
                    factors_str = `(Intermediary ${humanizeCompilerName(entry['compiler'])} version)`
                }
            }
            if (cxxflags === '') {
                row.push(factors_str)
            } else {
                row.push(`${factors_str} 🚩 ${cxxflags}`)
            }
        }
        // Generator
        if ('generator' in entry) {
            row.push(entry['generator'])
        } else {
            row.push('System Default')
        }
        // Toolset
        if ('b2-toolset' in entry) {
            row.push(entry['b2-toolset'])
        } else {
            row.push('')
        }

        // Apply emojis to name
        row[0] = `${nameEmojis.join('')} ${row[0]}`

        table.push(row)
    }

    return table;
}

function run() {
    try {
        trace_commands = isTruthy(core.getInput('trace-commands'));

        const compiler_versions = parseCompilerRequirements(core.getInput('compilers'));
        log(`compiler_versions: ${JSON.stringify(compiler_versions)}`)

        const standards = normalizeCppVersionRequirement(core.getInput('standards'));
        log(`standards: ${standards}`)

        const max_standards = parseInt(core.getInput('max-standards').trim());
        log(`max_standards: ${max_standards}`)

        compilers = Object.keys(compiler_versions)
        const latest_factors = parseCompilerFactors(core.getInput('latest-factors'), compilers);
        log(`latest_factors: ${JSON.stringify(latest_factors)}`)

        const factors = parseCompilerFactors(core.getInput('factors'), compilers);
        log(`factors: ${JSON.stringify(factors)}`)

        const matrix = generateMatrix(compiler_versions, standards, max_standards, latest_factors, factors)
        core.setOutput("matrix", matrix);

        const generate_summary = isTruthy(core.getInput('generate-summary'));
        if (generate_summary) {
            const table = generateTable(matrix, latest_factors, factors)
            core.summary.addHeading('C++ Test Matrix').addTable(table).write().then(result => {
                log('Table generated', result);
            }).catch(error => {
                log('An error occurred generating the table:', error);
            });
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    isTruthy,
    parseCompilerRequirements,
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