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

    it('has mingw_version and llvm_version on at least one runner', () => {
        const data = loadWindowsMsvcDefaults();
        const runners = Object.values(data.runners);
        // Both fields are optional per schema (some special runners like
        // windows-2025-vs2026 omit them), but at least one runner should have them.
        expect(runners.some(r => typeof r.mingw_version === 'string')).toBe(true);
        expect(runners.some(r => typeof r.llvm_version === 'string')).toBe(true);
        for (const runner of runners) {
            if (runner.mingw_version !== undefined) {
                expect(typeof runner.mingw_version).toBe('string');
            }
            if (runner.llvm_version !== undefined) {
                expect(typeof runner.llvm_version).toBe('string');
            }
        }
    });

    it('has installable_mingw as an array of version strings', () => {
        const data = loadWindowsMsvcDefaults();
        expect(Array.isArray(data.installable_mingw)).toBe(true);
        expect(data.installable_mingw!.length).toBeGreaterThan(0);
        for (const v of data.installable_mingw!) {
            expect(typeof v).toBe('string');
            // Chocolatey ships some entries with extra date-coded suffixes
            // (e.g. "11.2.0.07112021"), so accept extra dot-separated segments.
            expect(v).toMatch(/^\d+\.\d+\.\d+(\.\d+)*$/);
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
