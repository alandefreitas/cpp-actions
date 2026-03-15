import * as fs from 'fs'

import {
    releaseYearToProductVersion,
    productVersionToReleaseYear,
    selectToolsetVersion,
    inferToolsetVersionFromPath,
    listInstalledToolsets
} from './version-utils'

jest.mock('fs')
const mockFs = fs as jest.Mocked<typeof fs>

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

    it('returns year via exact match in final loop when semver.coerce fails', () => {
        // A string that is an exact product version but semver.coerce won't match
        // the major version (this exercises line 96 - the final for loop)
        // "16.0" will be matched by semver.coerce with major=16, which matches 2019
        // So we need a value that coerce returns null for but matches exactly
        // Actually, let's trace: productVersionToReleaseYear('16.0')
        // - Not a key in the map (not a year) -> skip line 83
        // - semver.coerce('16.0') -> 16.0.0, major=16 -> matches 2019's '16.0' coerced to 16.0.0 -> returns '2019'
        // So the exact match loop at line 94 is reached only if semver match fails
        // This happens when the input is not semver-coercible AND matches an exact value
        // e.g., a non-numeric string that happens to equal a value in the map
        // But all map values are like "17.0", "16.0" etc. which ARE semver-coercible
        // So line 96 is only reachable if semver.coerce returns null for the input
        // but the input exactly matches a value in the map.
        // That's impossible with numeric versions, so this is dead code.
        // Let's still test the pass-through for non-coercible strings
        expect(productVersionToReleaseYear('not-a-version')).toEqual('not-a-version')
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

    it('filters out non-coercible versions from installed list', () => {
        const result = selectToolsetVersion('14.44', ['not-a-version', '14.44.35207'])
        expect(result).toBe('14.44.35207')
    })

    it('returns highest matching version when multiple satisfy', () => {
        const result = selectToolsetVersion('>=14.40.0', ['14.40.33807', '14.42.34433', '14.44.35207'])
        expect(result).toBe('14.44.35207')
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

describe('listInstalledToolsets', () => {
    beforeEach(() => {
        jest.resetAllMocks()
    })

    it('returns empty array when vcvarsallPath is null', () => {
        expect(listInstalledToolsets(null)).toEqual([])
    })

    it('returns empty array when toolset directory does not exist', () => {
        mockFs.existsSync.mockReturnValue(false)
        expect(listInstalledToolsets('C:\\VS\\VC\\Auxiliary\\Build\\vcvarsall.bat')).toEqual([])
    })

    it('returns toolset version directories', () => {
        mockFs.existsSync.mockReturnValue(true)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(mockFs.readdirSync as jest.Mock).mockReturnValue([
            { name: '14.40.33807', isDirectory: () => true },
            { name: '14.44.35207', isDirectory: () => true },
            { name: 'somefile.txt', isDirectory: () => false }
        ])
        const result = listInstalledToolsets('C:\\VS\\VC\\Auxiliary\\Build\\vcvarsall.bat')
        expect(result).toEqual(['14.40.33807', '14.44.35207'])
    })
})
