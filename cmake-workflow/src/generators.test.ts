import { deriveGeneratorArchitectureFromArch } from './generators';

describe('deriveGeneratorArchitectureFromArch', () => {
    it('maps x86 to Win32 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x86', 'Visual Studio 17 2022')).toBe('Win32');
    });

    it('maps arm64 to ARM64 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('arm64', 'Visual Studio 17 2022')).toBe('ARM64');
    });

    it('returns empty string for non-Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x64', 'Ninja')).toBe('');
    });

    it('maps x64 to x64 for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('x64', 'Visual Studio 17 2022')).toBe('x64');
    });

    it('maps arm to ARM for Visual Studio generators', () => {
        expect(deriveGeneratorArchitectureFromArch('arm', 'Visual Studio 17 2022')).toBe('ARM');
    });

    it('returns empty string for empty arch', () => {
        expect(deriveGeneratorArchitectureFromArch('', 'Visual Studio 17 2022')).toBe('');
    });

    it('returns empty string for empty generator', () => {
        expect(deriveGeneratorArchitectureFromArch('x86', '')).toBe('');
    });
});
