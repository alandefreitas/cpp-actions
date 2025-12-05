const {semverGteLoose} = require('./index')

describe('semverGteLoose', () => {
    test('handles four-part versions without throwing', () => {
        expect(semverGteLoose('0.96.24.20', '0.96.24.20')).toBe(true)
        expect(semverGteLoose('0.96.24.21', '0.96.24.20')).toBe(true)
        expect(semverGteLoose('0.96.24.19', '0.96.24.20')).toBe(false)
    })

    test('coerces distro-suffixed versions without throwing', () => {
        expect(() => semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).not.toThrow()
        expect(semverGteLoose('0.96.24ubuntu1', '0.96.24.20')).toBe(false)
    })
})
