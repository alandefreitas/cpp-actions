import { routePackages, mergePackages } from './packages-routing';

describe('routePackages', () => {
    describe('platform routing', () => {
        it('routes to apt on Linux', () => {
            const result = routePackages(['cmake', 'ninja'], 'linux');

            expect(result.apt).toEqual(['cmake', 'ninja']);
            expect(result.brew).toEqual([]);
            expect(result.choco).toEqual([]);
        });

        it('routes to brew on macOS', () => {
            const result = routePackages(['cmake', 'ninja'], 'darwin');

            expect(result.apt).toEqual([]);
            expect(result.brew).toEqual(['cmake', 'ninja']);
            expect(result.choco).toEqual([]);
        });

        it('routes to choco on Windows', () => {
            const result = routePackages(['cmake', 'ninja'], 'win32');

            expect(result.apt).toEqual([]);
            expect(result.brew).toEqual([]);
            expect(result.choco).toEqual(['cmake', 'ninja']);
        });

        it('returns empty lists for unknown platform', () => {
            const result = routePackages(['cmake'], 'freebsd');

            expect(result.apt).toEqual([]);
            expect(result.brew).toEqual([]);
            expect(result.choco).toEqual([]);
        });
    });

    describe('empty packages list', () => {
        it('returns empty lists for all PMs', () => {
            const result = routePackages([], 'linux');

            expect(result.apt).toEqual([]);
            expect(result.brew).toEqual([]);
            expect(result.choco).toEqual([]);
        });
    });

    describe('@version translation', () => {
        it('translates pkg@version to pkg-version for apt (Linux)', () => {
            const result = routePackages(['gcc@14', 'clang@18'], 'linux');

            expect(result.apt).toEqual(['gcc-14', 'clang-18']);
        });

        it('passes pkg@version through as-is for brew (macOS)', () => {
            const result = routePackages(['gcc@14', 'llvm@18'], 'darwin');

            expect(result.brew).toEqual(['gcc@14', 'llvm@18']);
        });

        it('translates pkg@version to pkg --version=version for choco (Windows)', () => {
            const result = routePackages(['cmake@3.28.0', 'gcc@14'], 'win32');

            expect(result.choco).toEqual(['cmake --version=3.28.0', 'gcc --version=14']);
        });

        it('passes packages without @version unchanged on all platforms', () => {
            expect(routePackages(['cmake'], 'linux').apt).toEqual(['cmake']);
            expect(routePackages(['cmake'], 'darwin').brew).toEqual(['cmake']);
            expect(routePackages(['cmake'], 'win32').choco).toEqual(['cmake']);
        });

        it('handles mixed versioned and unversioned packages', () => {
            const result = routePackages(['cmake', 'gcc@14', 'ninja'], 'linux');

            expect(result.apt).toEqual(['cmake', 'gcc-14', 'ninja']);
        });
    });
});

describe('mergePackages', () => {
    it('merges routed packages into existing list', () => {
        const result = mergePackages(['cmake', 'ninja'], ['gcc', 'clang']);

        expect(result).toEqual(['cmake', 'ninja', 'gcc', 'clang']);
    });

    it('deduplicates packages', () => {
        const result = mergePackages(['cmake', 'ninja'], ['cmake', 'gcc']);

        expect(result).toEqual(['cmake', 'ninja', 'gcc']);
    });

    it('returns existing list when routed is empty', () => {
        const result = mergePackages(['cmake'], []);

        expect(result).toEqual(['cmake']);
    });

    it('returns routed list when existing is empty', () => {
        const result = mergePackages([], ['cmake', 'ninja']);

        expect(result).toEqual(['cmake', 'ninja']);
    });

    it('returns empty list when both are empty', () => {
        const result = mergePackages([], []);

        expect(result).toEqual([]);
    });

    it('preserves order with existing first', () => {
        const result = mergePackages(['b', 'a'], ['c', 'a']);

        expect(result).toEqual(['b', 'a', 'c']);
    });
});
