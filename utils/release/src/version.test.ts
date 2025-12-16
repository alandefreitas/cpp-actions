import {
    isValidSemver,
    normalizeTag,
    extractVersion,
    parseSemver,
    formatSemver
} from './version';

describe('version utilities', () => {
    describe('isValidSemver', () => {
        it('should accept valid semver without v prefix', () => {
            expect(isValidSemver('1.2.3')).toBe(true);
            expect(isValidSemver('0.0.1')).toBe(true);
            expect(isValidSemver('10.20.30')).toBe(true);
        });

        it('should accept valid semver with v prefix', () => {
            expect(isValidSemver('v1.2.3')).toBe(true);
            expect(isValidSemver('v0.0.1')).toBe(true);
        });

        it('should reject invalid formats', () => {
            expect(isValidSemver('1.2')).toBe(false);
            expect(isValidSemver('1')).toBe(false);
            expect(isValidSemver('invalid')).toBe(false);
            expect(isValidSemver('1.2.3.4')).toBe(false);
            expect(isValidSemver('1.2.x')).toBe(false);
        });
    });

    describe('normalizeTag', () => {
        it('should add v prefix if missing', () => {
            expect(normalizeTag('1.2.3')).toBe('v1.2.3');
        });

        it('should keep v prefix if present', () => {
            expect(normalizeTag('v1.2.3')).toBe('v1.2.3');
        });
    });

    describe('extractVersion', () => {
        it('should remove v prefix', () => {
            expect(extractVersion('v1.2.3')).toBe('1.2.3');
        });

        it('should return as-is if no v prefix', () => {
            expect(extractVersion('1.2.3')).toBe('1.2.3');
        });
    });

    describe('parseSemver', () => {
        it('should parse version components', () => {
            expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
            expect(parseSemver('v10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
        });
    });

    describe('formatSemver', () => {
        it('should format with v prefix by default', () => {
            expect(formatSemver({ major: 1, minor: 2, patch: 3 })).toBe('v1.2.3');
        });

        it('should format without v prefix when specified', () => {
            expect(formatSemver({ major: 1, minor: 2, patch: 3 }, false)).toBe('1.2.3');
        });
    });
});
