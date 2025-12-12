const path = require('path')
const main = require('./index')
const gh_inputs = require('../common/gh-inputs')

test('parseExtraArgsEntry', async () => {
    // const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    // expect(semver.valid(pkg.version)).toBeTruthy()
    expect(gh_inputs.parseBashArguments(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master'])
})

test('resolveInputParameters normalizes Windows package_dir to avoid escape sequences', async () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', {value: 'win32'})
    const resolveSpy = jest.spyOn(path, 'resolve').mockImplementation(path.win32.resolve)

    const inputs = {
        preset: '',
        build_type: '',
        build_dir: 'build',
        cmake_path: 'cmake',
        generator: 'Ninja',
        generator_toolset: '',
        generator_architecture: '',
        cc: '',
        ccflags: '',
        cxx: '',
        cxxflags: '',
        cxxstd: [],
        export_compile_commands: undefined,
        run_tests: undefined,
        configure_tests_flag: '',
        shared: false,
        toolchain: '',
        source_dir: 'D:/a/mrdocs/mrdocs',
        install_prefix: 'install',
        package_dir: 'packages',
        package_name: '',
        package_vendor: '',
        package_generators: [],
        extra_args: [],
        extra_args_key: undefined
    }

    const setupCMakeOutputs = {
        path: 'cmake',
        dir: 'C:/Program Files/CMake/bin',
        supported_presets_version: 7
    }

    try {
        await main._resolveInputParameters(inputs, setupCMakeOutputs)
        expect(inputs.install_prefix.includes('\\')).toBe(false)
        expect(inputs.package_dir).toBe('D:/a/mrdocs/mrdocs/build/packages')
    } finally {
        resolveSpy.mockRestore()
        Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
})

test('deriveGeneratorArchitectureFromArch maps Visual Studio targets', () => {
    expect(main._deriveGeneratorArchitectureFromArch('x86', 'Visual Studio 17 2022')).toBe('Win32')
    expect(main._deriveGeneratorArchitectureFromArch('arm64', 'Visual Studio 17 2022')).toBe('ARM64')
    expect(main._deriveGeneratorArchitectureFromArch('x64', 'Ninja')).toBe('')
})

describe('pretty errors', () => {
    it('formats mapped errors with context and marks failure once', async () => {
        let runPromise
        jest.isolateModules(() => {
            jest.doMock('../common/pretty-errors/node_modules/@actions/core', () => ({
                error: jest.fn(),
                setFailed: jest.fn()
            }))
            const corePretty = require('../common/pretty-errors/node_modules/@actions/core')
            const {reportAndSetFailed} = require('../common/pretty-errors')

            runPromise = reportAndSetFailed(new Error('workflow boom'), {
                title: 'CMake workflow failed',
                hint: 'hint',
                locals: () => ({foo: 'bar'})
            }).then(() => {
                expect(corePretty.error).toHaveBeenCalledTimes(1)
                const payload = corePretty.error.mock.calls[0][0]
                expect(payload).toContain('CMake workflow failed')
                expect(payload).toContain('workflow boom')
                expect(payload).toContain('Locals')
                expect(corePretty.setFailed).toHaveBeenCalledWith('workflow boom')
            })
        })

        await runPromise
    })
})
