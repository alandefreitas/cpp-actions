jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}))

jest.mock('child_process', () => ({
    execSync: jest.fn()
}))

jest.mock('fs', () => ({
    existsSync: jest.fn()
}))

import * as child_process from 'child_process'
import * as fs from 'fs'
import { findWithVswhere, findVcvarsall } from './discovery'

const mockExecSync = child_process.execSync as jest.MockedFunction<typeof child_process.execSync>
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>

beforeEach(() => {
    jest.clearAllMocks()
})

describe('findWithVswhere', () => {
    it('returns path when vswhere succeeds', () => {
        mockExecSync.mockReturnValue(Buffer.from('C:\\VS\\2022\\Enterprise'))
        const result = findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', '-latest')
        expect(result).toBe('C:\\VS\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvarsall.bat')
        expect(mockExecSync).toHaveBeenCalledWith(
            'vswhere -products * -latest -prerelease -property installationPath'
        )
    })

    it('returns null and warns when vswhere throws', () => {
        mockExecSync.mockImplementation(() => { throw new Error('vswhere not found') })
        const result = findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', '-latest')
        expect(result).toBeNull()
    })

    it('trims whitespace from vswhere output', () => {
        mockExecSync.mockReturnValue(Buffer.from('  C:\\VS\\2022  \n'))
        const result = findWithVswhere('test.bat', '-latest')
        expect(result).toBe('C:\\VS\\2022\\test.bat')
    })
})

describe('findVcvarsall', () => {
    it('returns path from vswhere when found', () => {
        const vcvarsPath = 'C:\\VS\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvarsall.bat'
        mockExecSync.mockReturnValue(Buffer.from('C:\\VS\\2022\\Enterprise'))
        mockExistsSync.mockReturnValue(true)

        const result = findVcvarsall('2022')
        expect(result).toBe(vcvarsPath)
    })

    it('uses version range when vsversion is a known year', () => {
        mockExecSync.mockReturnValue(Buffer.from('C:\\VS'))
        mockExistsSync.mockReturnValue(true)

        findVcvarsall('2022')
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('-version "17.0,17.9"')
        )
    })

    it('uses -latest when vsversion is empty', () => {
        mockExecSync.mockReturnValue(Buffer.from('C:\\VS'))
        mockExistsSync.mockReturnValue(true)

        findVcvarsall('')
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('-latest')
        )
    })

    it('falls back to standard locations when vswhere fails', () => {
        // vswhere fails
        mockExecSync.mockImplementation(() => { throw new Error('not found') })
        // Standard location exists
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            return String(p).includes('Enterprise')
        })

        const result = findVcvarsall('')
        expect(result).toContain('Enterprise')
        expect(result).toContain('vcvarsall.bat')
    })

    it('falls back to VS 2015 location when standard locations fail', () => {
        mockExecSync.mockImplementation(() => { throw new Error('not found') })
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            return String(p).includes('vcbuildtools.bat')
        })

        const result = findVcvarsall('')
        expect(result).toContain('vcbuildtools.bat')
    })

    it('throws when no installation is found', () => {
        mockExecSync.mockImplementation(() => { throw new Error('not found') })
        mockExistsSync.mockReturnValue(false)

        expect(() => findVcvarsall('')).toThrow('Microsoft Visual Studio not found')
    })

    it('falls through vswhere result when file does not exist', () => {
        mockExecSync.mockReturnValue(Buffer.from('C:\\VS\\NonExistent'))
        // vswhere path doesn't exist, but standard location does
        let callCount = 0
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            callCount++
            // First call is for vswhere result, return false
            if (callCount === 1) return false
            // Second call onwards, check for standard location
            return String(p).includes('Enterprise')
        })

        const result = findVcvarsall('')
        expect(result).toContain('Enterprise')
    })

    it('tries specific year when vsversion provided for standard locations', () => {
        mockExecSync.mockImplementation(() => { throw new Error('not found') })
        let checkedPath = ''
        mockExistsSync.mockImplementation((p: fs.PathLike) => {
            const pathStr = String(p)
            if (pathStr.includes('2022') && pathStr.includes('Enterprise')) {
                checkedPath = pathStr
                return true
            }
            return false
        })

        const result = findVcvarsall('17.0')
        expect(result).toContain('2022')
        expect(checkedPath).toContain('2022')
    })
})
