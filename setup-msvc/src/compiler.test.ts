import { buildMSVCOutputs } from './compiler'

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
})
