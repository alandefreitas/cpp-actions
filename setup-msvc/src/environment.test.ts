import { isPathVariable, deduplicatePathValue } from './environment'

describe('isPathVariable', () => {
    it('returns true for PATH', () => {
        expect(isPathVariable('PATH')).toBe(true)
    })

    it('returns true for LIB (case-insensitive)', () => {
        expect(isPathVariable('lib')).toBe(true)
    })

    it('returns true for INCLUDE', () => {
        expect(isPathVariable('INCLUDE')).toBe(true)
    })

    it('returns true for LIBPATH', () => {
        expect(isPathVariable('LIBPATH')).toBe(true)
    })

    it('returns false for non-path variables', () => {
        expect(isPathVariable('TEMP')).toBe(false)
        expect(isPathVariable('HOME')).toBe(false)
    })
})

describe('deduplicatePathValue', () => {
    it('removes duplicate entries preserving order', () => {
        expect(deduplicatePathValue('C:\\bin;C:\\bin;D:\\bin')).toBe('C:\\bin;D:\\bin')
    })

    it('returns unchanged when there are no duplicates', () => {
        expect(deduplicatePathValue('C:\\bin;D:\\bin')).toBe('C:\\bin;D:\\bin')
    })

    it('handles a single entry', () => {
        expect(deduplicatePathValue('C:\\bin')).toBe('C:\\bin')
    })
})
