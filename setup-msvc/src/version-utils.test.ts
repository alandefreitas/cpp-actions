import {
    releaseYearToProductVersion,
    productVersionToReleaseYear,
    selectToolsetVersion,
    inferToolsetVersionFromPath
} from './version-utils'

describe('releaseYearToProductVersion', () => {
    it('maps a known release year to its product version', () => {
        expect(releaseYearToProductVersion('2022')).toEqual('17.0')
    })

    it('passes through an already-valid product version', () => {
        expect(releaseYearToProductVersion('17.0')).toEqual('17.0')
    })

    it('passes through an unknown string unchanged', () => {
        expect(releaseYearToProductVersion('99.9')).toEqual('99.9')
    })
})

describe('productVersionToReleaseYear', () => {
    it('maps a known product version to its release year', () => {
        expect(productVersionToReleaseYear('17.0')).toEqual('2022')
    })

    it('passes through an already-valid release year', () => {
        expect(productVersionToReleaseYear('2022')).toEqual('2022')
    })

    it('matches by major version for minor variants', () => {
        expect(productVersionToReleaseYear('17.5')).toEqual('2022')
    })

    it('passes through an unrecognized string unchanged', () => {
        expect(productVersionToReleaseYear('99.9')).toEqual('99.9')
    })
})

describe('selectToolsetVersion', () => {
    const installed = ['14.40.33807', '14.42.34433', '14.44.35207']

    it('returns null for empty requested version', () => {
        expect(selectToolsetVersion('', installed)).toBeNull()
    })

    it('returns null for wildcard version', () => {
        expect(selectToolsetVersion('*', installed)).toBeNull()
    })

    it('selects a matching toolset version', () => {
        const result = selectToolsetVersion('14.42', installed)
        expect(result).toBe('14.42.34433')
    })

    it('returns null when no version matches', () => {
        expect(selectToolsetVersion('14.99', installed)).toBeNull()
    })
})

describe('inferToolsetVersionFromPath', () => {
    it('extracts version from a typical cl.exe path', () => {
        expect(inferToolsetVersionFromPath(
            'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\cl.exe'
        )).toBe('14.44.35207')
    })

    it('returns null for a non-MSVC path', () => {
        expect(inferToolsetVersionFromPath('C:\\bin\\cl.exe')).toBeNull()
    })

    it('returns null for empty input', () => {
        expect(inferToolsetVersionFromPath('')).toBeNull()
    })
})
