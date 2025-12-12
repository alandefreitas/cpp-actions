const core = require('@actions/core')
const youchTerminal = require('youch-terminal')
const StackTracey = require('stacktracey')
const fs = require('fs')
const {fileURLToPath} = require('url')

function isNodeFrame(frame) {
    if (frame.native) return true
    const filename = frame.file || ''
    if (filename.startsWith('node:')) return true
    return false
}

function readContext(frame, {pre = 5, post = 5} = {}) {
    return new Promise((resolve) => {
        let filePath = frame.file
        if (!filePath) return resolve(null)

        try {
            filePath = filePath.startsWith('file:') ? fileURLToPath(filePath) : filePath
        } catch {
            // keep original path if URL conversion fails
        }

        fs.readFile(filePath, 'utf-8', (err, contents) => {
            if (err) return resolve(null)
            const lines = contents.split(/\r?\n/)
            const lineNumber = frame.line
            resolve({
                pre: lines.slice(Math.max(0, lineNumber - (pre + 1)), lineNumber - 1),
                line: lines[lineNumber - 1],
                post: lines.slice(lineNumber, lineNumber + post)
            })
        })
    })
}

async function buildYouchLikePayload(error) {
    const stack = new StackTracey(error?.stack || '')
    const frames = await Promise.all(
        stack.items
            .filter((frame) => frame.file)
            .map(async (frame) => {
                const context = await readContext(frame)
                return {
                    file: frame.fileRelative || frame.file,
                    filePath: frame.file.startsWith('file:')
                        ? fileURLToPath(frame.file).replaceAll('\\', '/')
                        : frame.file,
                    line: frame.line,
                    column: frame.column,
                    callee: frame.callee || frame.calleeShort || 'anonymous',
                    calleeShort: frame.calleeShort || frame.callee || 'anonymous',
                    context: context || {pre: [], line: '', post: []},
                    isModule: !!frame.thirdParty,
                    isNative: !!frame.native,
                    isApp: !isNodeFrame(frame)
                }
            })
    )

    return {
        error: {
            message: error?.message,
            name: error?.name,
            status: error?.status,
            frames
        }
    }
}

async function renderTerminal(error) {
    if (!error) {
        return '<no error>'
    }

    try {
        const payload = await buildYouchLikePayload(error)
        return youchTerminal(payload)
    } catch (renderErr) {
        const fallbackStack = error.stack || String(error)
        return `Pretty renderer failed: ${renderErr.message}\n${fallbackStack}`
    }
}

/**
 * Render a human-friendly, source-aware stack and fail the action once.
 * This implementation is self-contained and avoids external templates/files.
 */
async function reportAndSetFailed(error, options = {}) {
    const {
        title = 'Action failed',
        hint: providedHint,
        locals,
        includeStackInSetFailed = false
    } = options

    const defaultHint = 'Tip: enable trace-commands (INPUT_TRACE_COMMANDS=true or ACTIONS_STEP_DEBUG=true) for more logs. If this keeps happening, please open an issue at github.com/alandefreitas/cpp-actions.'
    const hint = providedHint === undefined ? defaultHint : providedHint

    const rendered = await renderTerminal(error)

    let localsBlock = ''
    const resolvedLocals = typeof locals === 'function' ? locals() : locals
    if (resolvedLocals) {
        try {
            localsBlock = `\nLocals: ${JSON.stringify(resolvedLocals, null, 2)}`
        } catch (jsonErr) {
            localsBlock = `\nLocals: <unserializable: ${jsonErr.message}>`
        }
    }

    const hintBlock = hint ? `\n${hint}` : ''
    const message = `${title}: ${error.message}\n${rendered}${localsBlock}${hintBlock}`
    core.error(message)

    if (includeStackInSetFailed) {
        core.setFailed(`${error.message}\n${error.stack}`)
    } else {
        core.setFailed(error.message)
    }
}

module.exports = {
    reportAndSetFailed,
    // withPrettyErrors is retained for backward compatibility but simply
    // delegates; actions should prefer direct try/catch with reportAndSetFailed.
    withPrettyErrors: async function (fn, options = {}) {
        try {
            return await fn()
        } catch (error) {
            await reportAndSetFailed(error, options)
        }
    }
}
