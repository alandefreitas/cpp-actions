jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    exportVariable: jest.fn()
}))

jest.mock('child_process', () => ({
    execSync: jest.fn()
}))

jest.mock('@actions/io', () => ({
    which: jest.fn()
}))

jest.mock('@actions/exec', () => ({
    getExecOutput: jest.fn()
}))

jest.mock('./discovery', () => ({
    findVcvarsall: jest.fn(),
    VSWHERE_PATH: 'C:\\MockVswhere'
}))

jest.mock('./version-utils', () => ({
    listInstalledToolsets: jest.fn(),
    selectToolsetVersion: jest.fn(),
    releaseYearToProductVersion: jest.fn(),
    productVersionToReleaseYear: jest.fn((v: string) => v),
    inferToolsetVersionFromPath: jest.fn(),
    YEARS: ['2026', '2022', '2019']
}))

jest.mock('./compiler', () => ({
    findMSVCCompilerExecutable: jest.fn(),
    getMSVCCompilerVersion: jest.fn(),
    buildMSVCOutputs: jest.fn()
}))

jest.mock('./environment', () => ({
    isPathVariable: jest.fn(),
    deduplicatePathValue: jest.fn((v: string) => v)
}))

import * as child_process from 'child_process'
import { main } from './index'
import type { Inputs } from './index'
import { findVcvarsall } from './discovery'
import { listInstalledToolsets, selectToolsetVersion } from './version-utils'
import { findMSVCCompilerExecutable, getMSVCCompilerVersion, buildMSVCOutputs } from './compiler'
import { describePrettyErrors } from 'pretty-errors/test-helper'

const mockFindVcvarsall = findVcvarsall as jest.MockedFunction<typeof findVcvarsall>
const mockListInstalledToolsets = listInstalledToolsets as jest.MockedFunction<typeof listInstalledToolsets>
const mockSelectToolsetVersion = selectToolsetVersion as jest.MockedFunction<typeof selectToolsetVersion>
const mockFindMSVCCompilerExecutable = findMSVCCompilerExecutable as jest.MockedFunction<typeof findMSVCCompilerExecutable>
const mockGetMSVCCompilerVersion = getMSVCCompilerVersion as jest.MockedFunction<typeof getMSVCCompilerVersion>
const mockBuildMSVCOutputs = buildMSVCOutputs as jest.MockedFunction<typeof buildMSVCOutputs>
const mockExecSync = child_process.execSync as jest.MockedFunction<typeof child_process.execSync>

const originalPlatform = process.platform
const originalEnv = { ...process.env }

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
        version: '*',
        arch: 'x64',
        sdk: '',
        toolset: '',
        visualStudioVersion: '',
        uwp: false,
        spectre: false,
        traceCommands: false,
        ...overrides
    }
}

const mockOutputs = {
    cc: 'C:\\VS\\cl.exe',
    cxx: 'C:\\VS\\cl.exe',
    bindir: 'C:\\VS\\bin',
    dir: 'C:\\VS',
    release: '14.44.0',
    versionMajor: 14,
    versionMinor: 44,
    versionPatch: 0,
    msvcToolsetVersion: '14.44.35207',
    msvcProductVersion: '17.0',
    msvcReleaseYear: '2022',
    msvcCompilerVersion: '19.44.35219'
}

function setupSuccessfulRun(): void {
    mockFindVcvarsall.mockReturnValue('C:\\VS\\vcvarsall.bat')
    mockListInstalledToolsets.mockReturnValue(['14.44.35207'])
    mockSelectToolsetVersion.mockReturnValue(null)
    // vcvarsall exec: set && cls && vcvarsall ... && cls && set
    // Output: old env \f vcvars output \f new env
    mockExecSync.mockReturnValue(Buffer.from(
        'PATH=C:\\old\r\n' +
        '\f' +
        '** Visual C++ ...\r\n' +
        '\f' +
        'PATH=C:\\new\r\n'
    ))
    mockFindMSVCCompilerExecutable.mockResolvedValue('C:\\VS\\cl.exe')
    mockGetMSVCCompilerVersion.mockResolvedValue('19.44.35219')
    mockBuildMSVCOutputs.mockReturnValue(mockOutputs)
}

beforeEach(() => {
    jest.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.PROCESSOR_ARCHITECTURE = 'AMD64'
    process.env.PATH = 'C:\\original'
})

afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env = { ...originalEnv }
})

test('main is exported', () => {
    expect(main).toBeDefined()
})

describePrettyErrors('msvc boom', 'Setup MSVC failed')

describe('SetupMsvcRunner via main()', () => {
    it('runs the full pipeline successfully', async () => {
        setupSuccessfulRun()
        const result = await main(makeInputs())
        expect(result).toEqual({ ...mockOutputs, version: '14.44.0' })
        expect(mockFindVcvarsall).toHaveBeenCalledWith('')
        expect(mockFindMSVCCompilerExecutable).toHaveBeenCalled()
    })

    it('throws on non-Windows platform', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' })
        await expect(main(makeInputs())).rejects.toThrow('only supported on Windows')
    })

    it('uses PROCESSOR_ARCHITECTURE when arch input is empty', async () => {
        setupSuccessfulRun()
        process.env.PROCESSOR_ARCHITECTURE = 'ARM64'
        await main(makeInputs({ arch: '' }))
        // vcvarsall should be called with ARM64 architecture
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('ARM64'),
            expect.anything()
        )
    })

    it('defaults arch to x64 when PROCESSOR_ARCHITECTURE is unset', async () => {
        setupSuccessfulRun()
        delete process.env.PROCESSOR_ARCHITECTURE
        await main(makeInputs({ arch: '' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('x64'),
            expect.anything()
        )
    })

    it('normalizes win32 arch alias to x86', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ arch: 'win32' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('x86'),
            expect.anything()
        )
    })

    it('normalizes win64 arch alias to x64', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ arch: 'win64' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining(' x64'),
            expect.anything()
        )
    })

    it('normalizes x86_64 arch alias to x64', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ arch: 'x86_64' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining(' x64'),
            expect.anything()
        )
    })

    it('appends uwp to vcvars args when uwp is true', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ uwp: true }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('uwp'),
            expect.anything()
        )
    })

    it('appends sdk to vcvars args when provided', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ sdk: '10.0.19041.0' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('10.0.19041.0'),
            expect.anything()
        )
    })

    it('appends spectre flag when spectre is true', async () => {
        setupSuccessfulRun()
        mockSelectToolsetVersion.mockReturnValue(null)
        await main(makeInputs({ spectre: true }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('-vcvars_spectre_libs=spectre'),
            expect.anything()
        )
    })

    it('appends toolset version arg when resolved', async () => {
        setupSuccessfulRun()
        mockSelectToolsetVersion.mockReturnValue('14.44.35207')
        await main(makeInputs({ toolset: '14.44' }))
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('-vcvars_ver=14.44.35207'),
            expect.anything()
        )
    })

    it('uses version input as toolset when toolset is empty', async () => {
        setupSuccessfulRun()
        mockSelectToolsetVersion.mockReturnValue('14.42.34433')
        await main(makeInputs({ version: '14.42', toolset: '' }))
        expect(mockSelectToolsetVersion).toHaveBeenCalledWith('14.42', expect.any(Array))
    })

    it('does not use version as toolset when version is wildcard', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ version: '*', toolset: '' }))
        expect(mockSelectToolsetVersion).toHaveBeenCalledWith('', expect.any(Array))
    })

    it('throws when vcvarsall outputs ERROR lines', async () => {
        mockFindVcvarsall.mockReturnValue('C:\\VS\\vcvarsall.bat')
        mockListInstalledToolsets.mockReturnValue([])
        mockSelectToolsetVersion.mockReturnValue(null)
        mockExecSync.mockReturnValue(Buffer.from(
            'PATH=C:\\old\r\n' +
            '\f' +
            '[ERROR:test] Something went wrong\r\n' +
            '\f' +
            'PATH=C:\\new\r\n'
        ))
        await expect(main(makeInputs())).rejects.toThrow('invalid parameters')
    })

    it('does not throw on ERROR line that matches usage pattern', async () => {
        setupSuccessfulRun()
        mockExecSync.mockReturnValue(Buffer.from(
            'PATH=C:\\old\r\n' +
            '\f' +
            '[ERROR:test] Error in script usage. The correct usage is:\r\n' +
            '\f' +
            'PATH=C:\\new\r\n'
        ))
        // Should not throw — the usage error is filtered out
        await main(makeInputs())
    })

    it('throws when compiler is not found after environment setup', async () => {
        setupSuccessfulRun()
        mockFindMSVCCompilerExecutable.mockResolvedValue(null)
        await expect(main(makeInputs())).rejects.toThrow('Cannot find cl.exe')
    })

    it('passes visualStudioVersion to findVcvarsall', async () => {
        setupSuccessfulRun()
        await main(makeInputs({ visualStudioVersion: '2019' }))
        expect(mockFindVcvarsall).toHaveBeenCalledWith('2019')
    })

    it('adds VSWHERE_PATH to PATH', async () => {
        setupSuccessfulRun()
        await main(makeInputs())
        expect(process.env.PATH).toContain('MockVswhere')
    })

    it('handles environment variables without equals sign in new env', async () => {
        setupSuccessfulRun()
        mockExecSync.mockReturnValue(Buffer.from(
            'PATH=C:\\old\r\n' +
            '\f' +
            'output\r\n' +
            '\f' +
            'no-equals-line\r\nPATH=C:\\new\r\n'
        ))
        // Should not throw — lines without = are skipped
        await main(makeInputs())
    })
})
