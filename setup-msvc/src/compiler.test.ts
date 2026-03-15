import * as io from '@actions/io'
import * as exec from '@actions/exec'

import { buildMSVCOutputs, findMSVCCompilerExecutable, getMSVCCompilerVersion } from './compiler'

jest.mock('@actions/io')
jest.mock('@actions/exec')
jest.mock('@actions/core')

const mockIo = io as jest.Mocked<typeof io>
const mockExec = exec as jest.Mocked<typeof exec>

describe('buildMSVCOutputs', () => {
    it('computes outputs from a compiler path and environment', () => {
        const env: NodeJS.ProcessEnv = {
            VCToolsVersion: '14.44.35207',
            VisualStudioVersion: '17.0',
            VCINSTALLDIR: 'C:\\VS\\VC\\'
        }
        const result = buildMSVCOutputs(
            'C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe',
            env
        )
        expect(result.cc).toContain('cl.exe')
        expect(result.cxx).toContain('cl.exe')
        expect(result.bindir).toContain('Hostx64')
        expect(result.versionMajor).toBe(14)
        expect(result.versionMinor).toBe(44)
        expect(result.msvcReleaseYear).toBe('2022')
        expect(result.msvcToolsetVersion).toBe('14.44.35207')
        expect(result.msvcProductVersion).toBe('17.0')
    })

    it('throws when compilerPath is empty', () => {
        expect(() => buildMSVCOutputs('')).toThrow('compilerPath is required')
    })

    it('falls back gracefully when environment variables are missing', () => {
        const result = buildMSVCOutputs(
            'C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe',
            {}
        )
        expect(result.msvcProductVersion).toBe('')
        expect(result.msvcToolsetVersion).toBe('14.44.35207')
    })

    it('includes compilerVersion from metadata when provided', () => {
        const result = buildMSVCOutputs(
            'C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe',
            {},
            { compilerVersion: '19.44.35219' }
        )
        expect(result.msvcCompilerVersion).toBe('19.44.35219')
    })

    it('falls back dir to dirname(bindir) when VCINSTALLDIR normalizes to "."', () => {
        const result = buildMSVCOutputs(
            'C:\\VS\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe',
            { VCINSTALLDIR: '.', VCToolsVersion: '14.44.35207' }
        )
        // dir should fall back to dirname(bindir) rather than staying as "."
        expect(result.dir).not.toBe('.')
        expect(result.dir).toContain('Hostx64')
    })

    it('uses 0.0.0 fallback when toolset version is not coercible', () => {
        const result = buildMSVCOutputs(
            'C:\\bin\\cl.exe',
            { VCToolsVersion: 'not-a-version' }
        )
        expect(result.release).toBe('not-a-version')
        expect(result.versionMajor).toBe(0)
        expect(result.versionMinor).toBe(0)
        expect(result.versionPatch).toBe(0)
    })

    it('uses 0.0.0 fallback when no toolset version is available from env or path', () => {
        const result = buildMSVCOutputs(
            'C:\\bin\\cl.exe',
            {}
        )
        expect(result.release).toBe('0.0.0')
        expect(result.versionMajor).toBe(0)
        expect(result.versionMinor).toBe(0)
        expect(result.versionPatch).toBe(0)
        expect(result.msvcToolsetVersion).toBe('')
    })
})

describe('findMSVCCompilerExecutable', () => {
    beforeEach(() => {
        jest.resetAllMocks()
    })

    it('returns the path when cl.exe is found on PATH', async () => {
        mockIo.which.mockResolvedValueOnce('C:\\VS\\bin\\cl.exe')
        const result = await findMSVCCompilerExecutable()
        expect(result).toBe('C:\\VS\\bin\\cl.exe')
        expect(mockIo.which).toHaveBeenCalledWith('cl.exe')
    })

    it('tries "cl" if "cl.exe" returns empty', async () => {
        mockIo.which.mockResolvedValueOnce('')
        mockIo.which.mockResolvedValueOnce('C:\\VS\\bin\\cl')
        const result = await findMSVCCompilerExecutable()
        expect(result).toBe('C:\\VS\\bin\\cl')
        expect(mockIo.which).toHaveBeenCalledTimes(2)
    })

    it('returns null when no candidate is found', async () => {
        mockIo.which.mockResolvedValue('')
        const result = await findMSVCCompilerExecutable()
        expect(result).toBeNull()
    })

    it('handles io.which throwing and continues to next candidate', async () => {
        mockIo.which.mockRejectedValueOnce(new Error('not found'))
        mockIo.which.mockResolvedValueOnce('C:\\VS\\bin\\cl')
        const result = await findMSVCCompilerExecutable()
        expect(result).toBe('C:\\VS\\bin\\cl')
    })

    it('returns null when all candidates throw', async () => {
        mockIo.which.mockRejectedValue(new Error('not found'))
        const result = await findMSVCCompilerExecutable()
        expect(result).toBeNull()
    })
})

describe('getMSVCCompilerVersion', () => {
    beforeEach(() => {
        jest.resetAllMocks()
    })

    it('returns null for empty compilerPath', async () => {
        const result = await getMSVCCompilerVersion('')
        expect(result).toBeNull()
    })

    it('parses version from cl /Bv output', async () => {
        mockExec.getExecOutput.mockResolvedValueOnce({
            stdout: 'Microsoft (R) C/C++ Optimizing Compiler Version 19.44.35219\nCompiler Version 19.44.35219\n',
            stderr: '',
            exitCode: 0
        })
        const result = await getMSVCCompilerVersion('C:\\VS\\bin\\cl.exe')
        expect(result).toBe('19.44.35219')
        expect(mockExec.getExecOutput).toHaveBeenCalledWith(
            'C:\\VS\\bin\\cl.exe',
            ['/Bv'],
            { ignoreReturnCode: true }
        )
    })

    it('returns null when stdout does not contain version pattern', async () => {
        mockExec.getExecOutput.mockResolvedValueOnce({
            stdout: 'Some other output without version info',
            stderr: '',
            exitCode: 0
        })
        const result = await getMSVCCompilerVersion('C:\\VS\\bin\\cl.exe')
        expect(result).toBeNull()
    })

    it('returns null when exec throws', async () => {
        mockExec.getExecOutput.mockRejectedValueOnce(new Error('exec failed'))
        const result = await getMSVCCompilerVersion('C:\\VS\\bin\\cl.exe')
        expect(result).toBeNull()
    })
})
