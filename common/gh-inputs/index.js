const core = require('@actions/core')
const path = require('path')

const defaultOptions = {required: false, trimWhitespace: true, fallbackEnv: undefined, defaultValue: ''}
const defaultSplitRegex = /[,; ]/
const isNonEmptyStr = (s) => s !== ''

function getInput(name, options = defaultOptions) {
    options = {...defaultOptions, ...options}
    const nameArr = Array.isArray(name) ? name : [name]
    for (const n of nameArr) {
        const coreOptions = {...options, required: false}
        const str = core.getInput(n, coreOptions)
        if (str) {
            return str
        }
    }
    if (options.fallbackEnv) {
        const envArray = Array.isArray(options.fallbackEnv) ? options.fallbackEnv : [options.fallbackEnv]
        for (const env of envArray) {
            if (process.env[env]) {
                if (options.trimWhitespace && process.env[env].trim()) {
                    return process.env[env].trim()
                } else {
                    return process.env[env]
                }
            }
        }
    }
    if (options.required) {
        throw new Error(`Input required and not supplied: ${name}`)
    }
    return options.defaultValue
}

function getRegex(name, options = defaultOptions) {
    return new RegExp(getInput(name, options))
}

function getMultilineInput(name, options = defaultOptions) {
    options = {...defaultOptions, ...options}
    const nameArr = Array.isArray(name) ? name : [name]
    for (const n of nameArr) {
        const coreOptions = {...options, required: false}
        const str = core.getMultilineInput(n, coreOptions)
        if (str) {
            return str
        }
    }
    if (options.fallbackEnv) {
        const envArray = Array.isArray(options.fallbackEnv) ? options.fallbackEnv : [options.fallbackEnv]
        for (const env of envArray) {
            if (process.env[env]) {
                if (options.trimWhitespace && process.env[env].trim()) {
                    return [process.env[env].trim()]
                } else {
                    return [process.env[env]]
                }
            }
        }
    }
    if (options.required) {
        throw new Error(`Input required and not supplied: ${name}`)
    }
    if (Array.isArray(options.defaultValue)) {
        return options.defaultValue
    }
    return [options.defaultValue]
}

function getLowerCaseInput(name, options = defaultOptions) {
    return getInput(name, options).toLowerCase()
}

function normalizePath(path) {
    const pathIsString = typeof path === 'string' || path instanceof String
    if (pathIsString && process.platform === 'win32') {
        return path.replace(/\\/g, '/')
    }
    return path
}

function getNormalizedPath(
    name,
    options = defaultOptions) {
    return normalizePath(getInput(name, options))
}

function getResolvedPath(
    name,
    options = defaultOptions) {
    return path.resolve(normalizePath(getInput(name, options)))
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

function getTribool(name, options = defaultOptions) {
    return toTriboolInput(getInput(name, options))
}

function getBoolOrString(input, options = defaultOptions) {
    const asBool = getTribool(input, options)
    if (typeof asBool !== 'boolean') {
        return getInput(input, options)
    }
    return asBool
}


function getArray(name, splitter = defaultSplitRegex, filterFn = isNonEmptyStr, options = defaultOptions) {
    if (splitter === undefined) {
        splitter = defaultSplitRegex
    } else if (typeof splitter === 'string') {
        splitter = new RegExp(splitter)
    }
    if (filterFn === undefined) {
        filterFn = isNonEmptyStr
    }
    return getInput(name, options).split(splitter).filter(filterFn)
}

function getSet(name, splitter = defaultSplitRegex, filterFn = isNonEmptyStr, options = defaultOptions) {
    return new Set(getArray(name, splitter, filterFn, options))
}

function toIntegerInput(input) {
    const parsedInt = parseInt(input)
    if (isNaN(parsedInt)) {
        return undefined
    } else {
        return parsedInt
    }
}

function getInt(name, options = defaultOptions) {
    return toIntegerInput(getInput(name, options))
}

function getBool(name, options = defaultOptions) {
    const tribool = getTribool(name, options)
    if (typeof tribool === 'boolean') {
        return tribool
    }
    if (options.defaultValue !== undefined) {
        return options.defaultValue
    }
    return false
}

function parseBashArguments(extra_args) {
    if (!Array.isArray(extra_args)) {
        extra_args = [extra_args]
    }

    // The extra_args input is a multiline string. Each element in the array
    // is a line in the string. We need to split each line into arguments
    // and then join them into a single array. It's not as simple as splitting
    // on spaces because arguments can be quoted.

    function extractIdentifier(i, line, char, curArg) {
        const nextChar = i < line.length - 1 ? line[i + 1] : undefined
        if (nextChar && nextChar.match(/^[a-zA-Z_]/)) {
            let identifier = nextChar
            let j = i + 2
            for (; j < line.length; j++) {
                const idChar = line[j]
                // check if idChar is alphanum or underscore
                if (idChar.match(/^[a-zA-Z0-9_]/)) {
                    identifier += char
                } else {
                    break
                }
            }
            // Replace $ with the value of the environment variable
            // if it exists
            const envValue = process.env[identifier]
            if (envValue) {
                curArg += envValue
            }
            // Advance i to the last character of the identifier
            i = j - 1
        } else {
            // No valid identifier after $. Just output $.
            curArg += char
        }
        return {i, curArg}
    }

    let args = []
    for (const line of extra_args) {
        let curQuote = undefined
        let curArg = ''
        for (let i = 0; i < line.length; i++) {
            const char = line[i]
            const inQuote = curQuote !== undefined
            const curIsQuote = ['"', '\''].includes(char)
            const curIsEscaped = i > 0 && line[i - 1] === '\\'
            if (!inQuote) {
                if (!curIsEscaped) {
                    if (curIsQuote) {
                        curQuote = char
                    } else if (char === ' ') {
                        if (curArg !== '') {
                            args.push(curArg)
                            curArg = ''
                        }
                    } else if (char === '$') {
                        const __ret = extractIdentifier(i, line, char, curArg)
                        i = __ret.i
                        curArg = __ret.curArg
                    } else if (char !== '\\') {
                        curArg += char
                    }
                } else {
                    curArg += char
                }
            } else if (curQuote === '"') {
                // Preserve the literal value of all characters except for
                // ($), (`), ("), (\), and the (!) character
                if (!curIsEscaped) {
                    if (char === curQuote) {
                        curQuote = undefined
                    } else if (char === '$') {
                        const __ret = extractIdentifier(i, line, char, curArg)
                        i = __ret.i
                        curArg = __ret.curArg
                    } else if (char !== '\\') {
                        curArg += char
                    }
                } else {
                    if (!['$', '`', '"', '\\'].includes(char)) {
                        curArg += '\\'
                    }
                    curArg += char
                }
            } else if (curQuote === '\'') {
                // Preserve the literal value of each character within the
                // quotes
                if (char !== curQuote) {
                    curArg += char
                } else {
                    curQuote = undefined
                }
            }
        }
        if (curArg !== '') {
            args.push(curArg)
            curArg = ''
        }
    }
    return args
}

function getBashArguments(name, options = defaultOptions) {
    return parseBashArguments(core.getMultilineInput(name, options))
}

function parseKeyValues(lines, delimiter = ':') {
    const keyValues = []
    for (const line of lines) {
        const [key, value] = line.split(delimiter)
        if (key && value) {
            keyValues.push({key: key.trim(), value: value.trim()})
        } else if (key) {
            keyValues.push({key: '', value: key.trim()})
        }
    }
    return keyValues
}

function getKeyValues(name, delimiter = ':', options = defaultOptions) {
    return parseKeyValues(getMultilineInput(name, options), delimiter)
}

function parseMap(lines, delimiter = ':') {
    return parseKeyValues(lines, delimiter).reduce((acc, {key, value}) => {
        acc[key] = value
        return acc
    })
}

function getMap(name, delimiter = ':', options = defaultOptions) {
    return parseMap(getMultilineInput(name, options), delimiter)
}

// Make a string representation of a value suitable for logging
function makeValueString(value) {
    if (value instanceof Set) {
        return JSON.stringify(Array.from(value)).replace(/^\[/, '{').replace(/]$/, '}')
    }
    if (value instanceof Map) {
        return JSON.stringify(Object.fromEntries(value))
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false'
    }
    if (!value) {
        return '<empty>'
    }
    return JSON.stringify(value)
}

function makeKebabName(name) {
    return name.replaceAll('_', '-')
}

function printInputObject(inputObject) {
    for (const [name, value] of Object.entries(inputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`)
    }
}

function setOutputObject(outputObject) {
    for (const [name, value] of Object.entries(outputObject)) {
        core.info(`🧩 ${makeKebabName(name)}: ${makeValueString(value)}`)
        core.setOutput(makeKebabName(name), value)
    }
}

module.exports = {
    getInput,
    getLowerCaseInput,
    getNormalizedPath,
    getRegex,
    getResolvedPath,
    getTribool,
    getArray,
    getSet,
    getBoolOrString,
    getInt,
    getBoolean: getBool,
    getMap,
    getKeyValues,
    getBashArguments,
    parseBashArguments,
    printInputObject,
    setOutputObject,
    getMultilineInput,
    makeValueString
}