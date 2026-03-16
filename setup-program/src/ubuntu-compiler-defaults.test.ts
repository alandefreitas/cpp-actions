import { loadUbuntuCompilerDefaults } from './ubuntu-compiler-defaults';

describe('loadUbuntuCompilerDefaults', () => {
    it('returns data matching the UbuntuCompilerDefaults interface', () => {
        const data = loadUbuntuCompilerDefaults();
        expect(data).toHaveProperty('generated');
        expect(data).toHaveProperty('source');
        expect(data).toHaveProperty('releases');
        expect(typeof data.generated).toBe('string');
        expect(typeof data.source).toBe('string');
        expect(typeof data.releases).toBe('object');
    });

    it('has release entries with expected compiler structure', () => {
        const data = loadUbuntuCompilerDefaults();
        const releaseKeys = Object.keys(data.releases);
        expect(releaseKeys.length).toBeGreaterThan(0);

        for (const key of releaseKeys) {
            const release = data.releases[key];
            expect(release).toHaveProperty('codename');
            expect(release).toHaveProperty('gcc');
            expect(release).toHaveProperty('clang');
            expect(release.gcc).toHaveProperty('default_version');
            expect(release.gcc).toHaveProperty('available_versions');
            expect(release.clang).toHaveProperty('default_version');
            expect(release.clang).toHaveProperty('available_versions');
        }
    });
});
