import { loadWindowsMsvcDefaults } from './windows-msvc-defaults';

describe('loadWindowsMsvcDefaults', () => {
    it('returns data matching the WindowsMsvcDefaults interface', () => {
        const data = loadWindowsMsvcDefaults();
        expect(data).toHaveProperty('generated');
        expect(data).toHaveProperty('source');
        expect(data).toHaveProperty('runners');
        expect(typeof data.generated).toBe('string');
        expect(typeof data.source).toBe('string');
        expect(typeof data.runners).toBe('object');
    });

    it('has runner entries with expected MSVC structure', () => {
        const data = loadWindowsMsvcDefaults();
        const runnerKeys = Object.keys(data.runners);
        expect(runnerKeys.length).toBeGreaterThan(0);

        for (const key of runnerKeys) {
            const runner = data.runners[key];
            expect(runner).toHaveProperty('msvc_versions');
            expect(Array.isArray(runner.msvc_versions)).toBe(true);
            expect(runner.msvc_versions.length).toBeGreaterThan(0);
        }
    });

    it('has MSVC version entries with all required fields', () => {
        const data = loadWindowsMsvcDefaults();
        for (const runner of Object.values(data.runners)) {
            for (const entry of runner.msvc_versions) {
                expect(typeof entry.version).toBe('string');
                expect(typeof entry.vs_year).toBe('string');
                expect(typeof entry.is_default).toBe('boolean');
            }
        }
    });

    it('has at least one default MSVC version across all runners', () => {
        const data = loadWindowsMsvcDefaults();
        const allDefaults = Object.values(data.runners)
            .flatMap(r => r.msvc_versions)
            .filter(v => v.is_default);
        expect(allDefaults.length).toBeGreaterThan(0);
    });

    it('has expected runners', () => {
        const data = loadWindowsMsvcDefaults();
        expect(data.runners).toHaveProperty('windows-2022');
        expect(data.runners).toHaveProperty('windows-2025');
    });

    it('has mingw_version and llvm_version per runner', () => {
        const data = loadWindowsMsvcDefaults();
        for (const runner of Object.values(data.runners)) {
            expect(typeof runner.mingw_version).toBe('string');
            expect(typeof runner.llvm_version).toBe('string');
        }
    });

    it('has installable_mingw as an array of version strings', () => {
        const data = loadWindowsMsvcDefaults();
        expect(Array.isArray(data.installable_mingw)).toBe(true);
        expect(data.installable_mingw!.length).toBeGreaterThan(0);
        for (const v of data.installable_mingw!) {
            expect(typeof v).toBe('string');
            expect(v).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });

    it('has installable_llvm as an array of version strings', () => {
        const data = loadWindowsMsvcDefaults();
        expect(Array.isArray(data.installable_llvm)).toBe(true);
        expect(data.installable_llvm!.length).toBeGreaterThan(0);
        for (const v of data.installable_llvm!) {
            expect(typeof v).toBe('string');
            expect(v).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });
});
