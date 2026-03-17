import { loadMacOSXcodeDefaults } from './macos-xcode-defaults';

describe('loadMacOSXcodeDefaults', () => {
    it('returns data matching the MacOSXcodeDefaults interface', () => {
        const data = loadMacOSXcodeDefaults();
        expect(data).toHaveProperty('generated');
        expect(data).toHaveProperty('source');
        expect(data).toHaveProperty('runners');
        expect(typeof data.generated).toBe('string');
        expect(typeof data.source).toBe('string');
        expect(typeof data.runners).toBe('object');
    });

    it('has runner entries with expected Xcode structure', () => {
        const data = loadMacOSXcodeDefaults();
        const runnerKeys = Object.keys(data.runners);
        expect(runnerKeys.length).toBeGreaterThan(0);

        for (const key of runnerKeys) {
            const runner = data.runners[key];
            expect(runner).toHaveProperty('default_xcode');
            expect(runner).toHaveProperty('xcode_versions');
            expect(typeof runner.default_xcode).toBe('string');
            expect(Array.isArray(runner.xcode_versions)).toBe(true);
            expect(runner.xcode_versions.length).toBeGreaterThan(0);
        }
    });

    it('has Xcode version entries with all required fields', () => {
        const data = loadMacOSXcodeDefaults();
        for (const runner of Object.values(data.runners)) {
            for (const entry of runner.xcode_versions) {
                expect(typeof entry.xcode).toBe('string');
                expect(typeof entry.build).toBe('string');
                expect(typeof entry.apple_clang).toBe('string');
                expect(typeof entry.clang_build).toBe('string');
                expect(typeof entry.is_default).toBe('boolean');
            }
        }
    });

    it('has exactly one default Xcode per runner', () => {
        const data = loadMacOSXcodeDefaults();
        for (const [_runnerName, runner] of Object.entries(data.runners)) {
            const defaults = runner.xcode_versions.filter(v => v.is_default);
            expect(defaults.length).toBe(1);
            expect(defaults[0].xcode).toContain(runner.default_xcode);
        }
    });
});
