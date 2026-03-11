import { getPackagePreferenceTier, PackagePreferenceTier } from './apt-utils';

describe('getPackagePreferenceTier', () => {
    it('returns UNVERSIONED tier for exact base name match', () => {
        expect(getPackagePreferenceTier('clang', ['clang'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('cmake', ['cmake'])).toBe(PackagePreferenceTier.UNVERSIONED);
    });

    it('returns RAW_VERSIONED tier for base name with version suffix', () => {
        expect(getPackagePreferenceTier('clang-14', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('cmake-3.24', ['cmake'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
        expect(getPackagePreferenceTier('clang-14.0', ['clang'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });

    it('returns OTHER_VERSIONED tier for packages with additional suffixes', () => {
        expect(getPackagePreferenceTier('clang-14-tools', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-format-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('clang-tidy-14', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
        expect(getPackagePreferenceTier('libclang-14-dev', ['clang'])).toBe(PackagePreferenceTier.OTHER_VERSIONED);
    });

    it('handles multiple base names correctly', () => {
        expect(getPackagePreferenceTier('gcc', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('g++', ['gcc', 'g++'])).toBe(PackagePreferenceTier.UNVERSIONED);
        expect(getPackagePreferenceTier('gcc-12', ['gcc', 'g++'])).toBe(PackagePreferenceTier.RAW_VERSIONED);
    });
});
