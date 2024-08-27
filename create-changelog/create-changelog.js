const {
    main,
    set_trace_commands,
    toIntegerInput,
    normalizePath,
    run
} = require('./index')

function parseArgs() {
    const args = process.argv.slice(2)
    const inputs = {
        source_dir: normalizePath(process.cwd()),
        version_pattern: '^v\\d+\\.\\d+\\.\\d+$',
        tag_pattern: '^v\\d+\\.\\d+\\.\\d+$',
        output_path: 'CHANGELOG.md',
        limit: undefined,
        thank_non_regular: true,
        check_unconventional: true,
        link_commits: true,
        github_token: process.env.GITHUB_TOKEN,
        update_summary: false,
        trace_commands: true
    }

    let sink = []
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--source_dir':
                inputs.source_dir = normalizePath(args[++i])
                break
            case '--version_pattern':
                inputs.version_pattern = args[++i]
                break
            case '--tag_pattern':
                inputs.tag_pattern = args[++i]
                break
            case '--output_path':
                inputs.output_path = normalizePath(args[++i])
                break
            case '-o':
                inputs.output_path = normalizePath(args[++i])
                break
            case '--limit':
                inputs.limit = toIntegerInput(args[++i])
                break
            case '--thank_non_regular':
                inputs.thank_non_regular = args[++i] === 'true'
                break
            case '--check_unconventional':
                inputs.check_unconventional = args[++i] === 'true'
                break
            case '--link_commits':
                inputs.link_commits = args[++i] === 'true'
                break
            case '--github_token':
                inputs.github_token = args[++i]
                break
            case '--update_summary':
                inputs.update_summary = args[++i] === 'true'
                break
            case '--trace_commands':
                inputs.trace_commands = args[++i] === 'true'
                break
            default:
                sink.push(args[i])
        }
    }

    if (sink.length > 0) {
        const sinkDir = normalizePath(sink[0])
        const dirExists = fs.existsSync(sinkDir)
        const isDir = dirExists && fs.lstatSync(sinkDir).isDirectory()
        if (dirExists && !isDir) {
            inputs.source_dir = sinkDir
        }
    }

    inputs.version_pattern = new RegExp(inputs.version_pattern)
    inputs.tag_pattern = new RegExp(inputs.tag_pattern)

    return inputs
}

async function runLocal() {
    const inputs = parseArgs()
    set_trace_commands(true)
    try {
        await main(inputs)
    } catch (error) {
        console.error('Error:', error)
    }
}

runLocal()