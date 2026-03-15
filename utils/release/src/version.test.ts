import {
    isValidSemver,
    normalizeTag,
    extractVersion,
    parseSemver,
    formatSemver,
    compareSemver,
    getPackageVersion,
    getLatestTag,
    getFeatureCommitsSince,
    determineVersion
} from './version';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as prompt from './prompt';

jest.mock('child_process');
jest.mock('fs');
jest.mock('./prompt');

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

    describe('compareSemver', () => {
        it('should return 1 when a > b (major)', () => {
            expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
        });

        it('should return -1 when a < b (major)', () => {
            expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
        });

        it('should return 1 when a > b (minor)', () => {
            expect(compareSemver('1.2.0', '1.1.0')).toBe(1);
        });

        it('should return -1 when a < b (minor)', () => {
            expect(compareSemver('1.1.0', '1.2.0')).toBe(-1);
        });

        it('should return 1 when a > b (patch)', () => {
            expect(compareSemver('1.0.2', '1.0.1')).toBe(1);
        });

        it('should return -1 when a < b (patch)', () => {
            expect(compareSemver('1.0.1', '1.0.2')).toBe(-1);
        });

        it('should return 0 when equal', () => {
            expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
        });

        it('should handle v prefix', () => {
            expect(compareSemver('v2.0.0', 'v1.0.0')).toBe(1);
        });
    });

    describe('getPackageVersion', () => {
        const mockReadFileSync = fs.readFileSync as jest.Mock;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return version with v prefix from package.json', () => {
            mockReadFileSync.mockReturnValue('{"version": "1.2.3"}');
            expect(getPackageVersion('/test')).toBe('v1.2.3');
        });

        it('should return version when already has v prefix', () => {
            mockReadFileSync.mockReturnValue('{"version": "v1.2.3"}');
            expect(getPackageVersion('/test')).toBe('v1.2.3');
        });

        it('should return null when version is not a string', () => {
            mockReadFileSync.mockReturnValue('{"version": 123}');
            expect(getPackageVersion('/test')).toBeNull();
        });

        it('should return null when version is invalid semver', () => {
            mockReadFileSync.mockReturnValue('{"version": "not-semver"}');
            expect(getPackageVersion('/test')).toBeNull();
        });

        it('should return null when package.json does not exist', () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            expect(getPackageVersion('/test')).toBeNull();
        });

        it('should return null when package.json is invalid JSON', () => {
            mockReadFileSync.mockReturnValue('not json');
            expect(getPackageVersion('/test')).toBeNull();
        });

        it('should return null when version field is missing', () => {
            mockReadFileSync.mockReturnValue('{"name": "test"}');
            expect(getPackageVersion('/test')).toBeNull();
        });
    });

    describe('getLatestTag', () => {
        const mockExecSync = execSync as unknown as jest.Mock;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return the latest semver tag', () => {
            mockExecSync.mockReturnValue(
                'abc123\trefs/tags/v1.0.0\ndef456\trefs/tags/v1.1.0\nghi789\trefs/tags/v1.0.5\n'
            );
            expect(getLatestTag('/test')).toBe('v1.1.0');
        });

        it('should sort by major version descending', () => {
            mockExecSync.mockReturnValue(
                'abc\trefs/tags/v1.0.0\ndef\trefs/tags/v2.0.0\nghi\trefs/tags/v3.0.0\n'
            );
            expect(getLatestTag('/test')).toBe('v3.0.0');
        });

        it('should sort by patch version descending', () => {
            mockExecSync.mockReturnValue(
                'abc\trefs/tags/v1.0.1\ndef\trefs/tags/v1.0.3\nghi\trefs/tags/v1.0.2\n'
            );
            expect(getLatestTag('/test')).toBe('v1.0.3');
        });

        it('should return null when no tags found', () => {
            mockExecSync.mockReturnValue('');
            expect(getLatestTag('/test')).toBeNull();
        });

        it('should ignore non-semver tags', () => {
            mockExecSync.mockReturnValue(
                'abc\trefs/tags/latest\ndef\trefs/tags/v1.0.0\nghi\trefs/tags/release\n'
            );
            expect(getLatestTag('/test')).toBe('v1.0.0');
        });

        it('should return null on git error', () => {
            mockExecSync.mockImplementation(() => { throw new Error('git error'); });
            expect(getLatestTag('/test')).toBeNull();
        });

        it('should return null when only non-semver tags exist', () => {
            mockExecSync.mockReturnValue('abc\trefs/tags/latest\ndef\trefs/tags/nightly\n');
            expect(getLatestTag('/test')).toBeNull();
        });
    });

    describe('getFeatureCommitsSince', () => {
        const mockExecSync = execSync as unknown as jest.Mock;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should return feature commits matching feat( or feat:', () => {
            mockExecSync.mockReturnValue(
                'feat: add login\nfix: bug\nfeat(auth): add oauth\nchore: cleanup\n'
            );
            const result = getFeatureCommitsSince('v1.0.0', '/test');
            expect(result).toEqual(['feat: add login', 'feat(auth): add oauth']);
        });

        it('should return empty array when no feature commits', () => {
            mockExecSync.mockReturnValue('fix: bug\nchore: cleanup\n');
            expect(getFeatureCommitsSince('v1.0.0', '/test')).toEqual([]);
        });

        it('should return empty array on git error', () => {
            mockExecSync.mockImplementation(() => { throw new Error('git error'); });
            expect(getFeatureCommitsSince('v1.0.0', '/test')).toEqual([]);
        });

        it('should filter out empty lines', () => {
            mockExecSync.mockReturnValue('feat: something\n\n\n');
            expect(getFeatureCommitsSince('v1.0.0', '/test')).toEqual(['feat: something']);
        });
    });

    describe('determineVersion', () => {
        const mockExecSync = execSync as unknown as jest.Mock;
        const mockReadFileSync = fs.readFileSync as jest.Mock;
        const mockAskChoice = prompt.askChoice as jest.Mock;
        const mockAskInput = prompt.askInput as jest.Mock;

        beforeEach(() => {
            jest.clearAllMocks();
            jest.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            (console.log as jest.Mock).mockRestore();
        });

        it('should return package.json version when it is ahead of latest tag', async () => {
            mockReadFileSync.mockReturnValue('{"version": "2.0.0"}');
            mockExecSync.mockReturnValue('abc\trefs/tags/v1.0.0\n');
            const result = await determineVersion('/test');
            expect(result).toBe('v2.0.0');
        });

        it('should return package.json version when no remote tags exist', async () => {
            mockReadFileSync.mockReturnValue('{"version": "1.0.0"}');
            mockExecSync.mockReturnValue('');
            const result = await determineVersion('/test');
            expect(result).toBe('v1.0.0');
        });

        it('should default to v0.1.0 when no tags and no package.json version', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockReturnValue('');
            mockAskInput.mockResolvedValue('v0.1.0');
            const result = await determineVersion('/test');
            expect(result).toBe('v0.1.0');
            expect(mockAskInput).toHaveBeenCalledWith(
                expect.stringContaining('v0.1.0'),
                'v0.1.0'
            );
        });

        it('should suggest patch bump when no feature commits', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            // getLatestTag returns v1.2.3
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.2.3\n';
                }
                // getFeatureCommitsSince returns no feature commits
                return 'fix: something\nchore: cleanup\n';
            });
            mockAskInput.mockResolvedValue('y');
            const result = await determineVersion('/test');
            expect(result).toBe('v1.2.4');
        });

        it('should allow custom version when user declines patch bump', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.0.0\n';
                }
                return 'fix: bug\n';
            });
            mockAskInput
                .mockResolvedValueOnce('n')
                .mockResolvedValueOnce('v2.0.0');
            const result = await determineVersion('/test');
            expect(result).toBe('v2.0.0');
        });

        it('should accept custom tag directly when user enters it instead of y/n', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.0.0\n';
                }
                return 'fix: bug\n';
            });
            mockAskInput.mockResolvedValue('3.0.0');
            const result = await determineVersion('/test');
            expect(result).toBe('v3.0.0');
        });

        it('should offer minor/patch/custom choice when feature commits exist', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.2.0\n';
                }
                return 'feat: new feature\nfix: bug\n';
            });
            mockAskChoice.mockResolvedValue(0); // minor bump
            const result = await determineVersion('/test');
            expect(result).toBe('v1.3.0');
        });

        it('should return patch bump when user selects patch with feature commits', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.2.0\n';
                }
                return 'feat: new feature\n';
            });
            mockAskChoice.mockResolvedValue(1); // patch bump
            const result = await determineVersion('/test');
            expect(result).toBe('v1.2.1');
        });

        it('should allow custom version when user selects custom with feature commits', async () => {
            mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.0.0\n';
                }
                return 'feat: something\n';
            });
            mockAskChoice.mockResolvedValue(2); // custom
            mockAskInput.mockResolvedValue('5.0.0');
            const result = await determineVersion('/test');
            expect(result).toBe('v5.0.0');
        });

        it('should return package.json version when equal to latest tag', async () => {
            mockReadFileSync.mockReturnValue('{"version": "1.0.0"}');
            mockExecSync.mockImplementation((cmd: string) => {
                if (cmd.includes('ls-remote')) {
                    return 'abc\trefs/tags/v1.0.0\n';
                }
                return '';
            });
            // packageVersion (v1.0.0) compareSemver latestTag (v1.0.0) = 0, not >= 1
            // So it falls through to the tag-based path
            mockAskInput.mockResolvedValue('y');
            const result = await determineVersion('/test');
            expect(result).toBe('v1.0.1');
        });
    });
});
