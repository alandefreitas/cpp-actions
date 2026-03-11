import { getUbuntuVersionOrder, buildVersionCandidates } from './gcc-download';

describe('getUbuntuVersionOrder', () => {
    it('returns 20.04 first when current version is 20.04', () => {
        const result = getUbuntuVersionOrder('20.04');
        expect(result[0]).toBe('20.04');
        expect(result).toHaveLength(7);
    });

    it('returns 18.04 first when current version is 18.04', () => {
        const result = getUbuntuVersionOrder('18.04');
        expect(result[0]).toBe('18.04');
    });

    it('returns 22.04 first when current version is unknown', () => {
        const result = getUbuntuVersionOrder(null);
        expect(result[0]).toBe('22.04');
    });

    it('returns 22.04 first when current version is 22.04', () => {
        const result = getUbuntuVersionOrder('22.04');
        expect(result[0]).toBe('22.04');
    });

    it('returns 16.04 first when current version is 16.04', () => {
        const result = getUbuntuVersionOrder('16.04');
        expect(result[0]).toBe('16.04');
    });
});

describe('buildVersionCandidates', () => {
    const allVersions = [
        '10.1.0', '10.2.0', '10.3.0',
        '11.1.0', '11.2.0', '11.3.0',
        '12.1.0', '12.2.0'
    ];

    it('returns the release version first', () => {
        const result = buildVersionCandidates('11.2.0', allVersions);
        expect(result[0]).toBe('11.2.0');
    });

    it('includes same-major-same-minor versions after the target', () => {
        const result = buildVersionCandidates('10.1.0', allVersions);
        expect(result).toContain('10.1.0');
    });

    it('includes same-major-different-minor versions', () => {
        const result = buildVersionCandidates('11.1.0', allVersions);
        expect(result).toContain('11.2.0');
        expect(result).toContain('11.3.0');
    });

    it('returns empty array for unparseable version', () => {
        const result = buildVersionCandidates('not-a-version', allVersions);
        expect(result).toEqual([]);
    });
});
