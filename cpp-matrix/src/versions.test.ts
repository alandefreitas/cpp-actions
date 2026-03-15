jest.mock('@actions/core', () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warning: jest.fn(),
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn()
}));

jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import * as path from 'path';
import * as process from 'process';

const cacheDir = path.join(__dirname, '..', 'test-data', 'cache');
process.env.CPP_MATRIX_CACHE_DIR = cacheDir;

import * as setup_program from 'setup-program';
setup_program.setVersionsCacheDir(cacheDir);

import {
    splitRanges,
    findMSVCVersions,
    findCompilerVersions,
    getVisualCppYear,
    arraysHaveSameElements,
    getSubrangePolicy,
    getSubrangePolicyStr,
    SubrangePolicies
} from './versions';

describe('setup_program.findGCCVersions', () => {
    test('contains valid versions', async () => {
        expect(await setup_program.findGCCVersions()).toContain('4.8.0');
        expect(await setup_program.findGCCVersions()).toContain('13.1.0');
    });
});

describe('findClangVersions', () => {
    test('Contains valid versions', async () => {
        expect(await setup_program.findClangVersions()).toContain('2.6.0');
        expect(await setup_program.findClangVersions()).toContain('16.0.0');
    });
});

describe('findCompilerVersions', () => {
    it('returns gcc versions', async () => {
        const versions = await findCompilerVersions('gcc');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('13.1.0');
    });

    it('returns clang versions', async () => {
        const versions = await findCompilerVersions('clang');
        expect(versions.length).toBeGreaterThan(0);
    });

    it('returns msvc versions', async () => {
        const versions = await findCompilerVersions('msvc');
        expect(versions.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown compiler', async () => {
        expect(await findCompilerVersions('unknown')).toEqual([]);
    });
});

describe('getVisualCppYear', () => {
    it('returns undefined for invalid version', () => {
        expect(getVisualCppYear('not-a-version')).toBeUndefined();
    });

    it('returns 2022 for >= 14.30', () => {
        expect(getVisualCppYear('14.30.0')).toBe('2022');
    });

    it('returns 2019 for >= 14.20', () => {
        expect(getVisualCppYear('14.20.0')).toBe('2019');
    });

    it('returns 2017 for >= 14.1', () => {
        expect(getVisualCppYear('14.1.0')).toBe('2017');
    });

    it('returns 2015 for >= 14.0', () => {
        expect(getVisualCppYear('14.0.0')).toBe('2015');
    });

    it('returns 2013 for >= 12.0', () => {
        expect(getVisualCppYear('12.0.0')).toBe('2013');
    });

    it('returns 2012 for >= 11.0', () => {
        expect(getVisualCppYear('11.0.0')).toBe('2012');
    });

    it('returns 2010 for >= 10.0', () => {
        expect(getVisualCppYear('10.0.0')).toBe('2010');
    });

    it('returns 2008 for >= 9.0', () => {
        expect(getVisualCppYear('9.0.0')).toBe('2008');
    });

    it('returns 2005 for >= 8.0', () => {
        expect(getVisualCppYear('8.0.0')).toBe('2005');
    });

    it('returns 2003 for >= 7.1', () => {
        expect(getVisualCppYear('7.1.0')).toBe('2003');
    });

    it('returns 2002 for >= 7.0', () => {
        expect(getVisualCppYear('7.0.0')).toBe('2002');
    });

    it('returns 2001 for >= 6.0', () => {
        expect(getVisualCppYear('6.0.0')).toBe('2001');
    });

    it('returns 1997 for >= 5.0', () => {
        expect(getVisualCppYear('5.0.0')).toBe('1997');
    });

    it('returns 1995 for >= 4.0', () => {
        expect(getVisualCppYear('4.0.0')).toBe('1995');
    });

    it('returns 1994 for >= 2.0', () => {
        expect(getVisualCppYear('2.0.0')).toBe('1994');
    });

    it('returns 1993 for >= 1.0', () => {
        expect(getVisualCppYear('1.0.0')).toBe('1993');
    });

    it('returns 1989 for >= 0.0.0', () => {
        expect(getVisualCppYear('0.0.0')).toBe('1989');
    });
});

describe('arraysHaveSameElements', () => {
    it('returns true for identical arrays', () => {
        expect(arraysHaveSameElements([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('returns true for same elements in different order', () => {
        expect(arraysHaveSameElements([3, 1, 2], [1, 2, 3])).toBe(true);
    });

    it('returns false for different lengths', () => {
        expect(arraysHaveSameElements([1, 2], [1, 2, 3])).toBe(false);
    });

    it('returns false for different elements', () => {
        expect(arraysHaveSameElements([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('returns true for empty arrays', () => {
        expect(arraysHaveSameElements([], [])).toBe(true);
    });
});

describe('getSubrangePolicy', () => {
    it('returns ONE_PER_MAJOR for "one-per-major"', () => {
        expect(getSubrangePolicy('one-per-major')).toBe(SubrangePolicies.ONE_PER_MAJOR);
    });

    it('returns ONE_PER_MINOR for "one-per-minor"', () => {
        expect(getSubrangePolicy('one-per-minor')).toBe(SubrangePolicies.ONE_PER_MINOR);
    });

    it('returns ONE_PER_MAJOR_OR_MINOR for "one-per-major-or-minor"', () => {
        expect(getSubrangePolicy('one-per-major-or-minor')).toBe(SubrangePolicies.ONE_PER_MAJOR_OR_MINOR);
    });

    it('defaults to ONE_PER_MAJOR for unknown policy', () => {
        expect(getSubrangePolicy('unknown')).toBe(SubrangePolicies.ONE_PER_MAJOR);
    });
});

describe('getSubrangePolicyStr', () => {
    it('returns "one-per-major" for ONE_PER_MAJOR', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_MAJOR)).toBe('one-per-major');
    });

    it('returns "one-per-minor" for ONE_PER_MINOR', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_MINOR)).toBe('one-per-minor');
    });

    it('returns "one-per-major-or-minor" for ONE_PER_MAJOR_OR_MINOR', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_MAJOR_OR_MINOR)).toBe('one-per-major-or-minor');
    });

    it('defaults to "one-per-major" for unknown value', () => {
        expect(getSubrangePolicyStr(99 as never)).toBe('one-per-major');
    });
});

describe('splitRanges', () => {
    test('should split ranges correctly', async () => {
        expect(splitRanges('9.2 - 11', await setup_program.findGCCVersions())).toStrictEqual(['^9.2', '10', '11']);
        expect(splitRanges('9.2 - 9.4 || 11', await setup_program.findGCCVersions())).toStrictEqual(['9.2 - 9.4', '11']);
        expect(splitRanges('>=8 <9.100', await setup_program.findGCCVersions())).toStrictEqual(['8', '9']);
        expect(splitRanges('>=14 <14.50', findMSVCVersions())).toStrictEqual(['14']);
        expect(splitRanges('<=9.2', ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0'], SubrangePolicies.ONE_PER_MAJOR)).toStrictEqual(['9 - 9.2']);
        expect(splitRanges('>14.29.4 <14.40', ['14.29.30139', '14.29.30140'])).toStrictEqual(['14']);
        expect(splitRanges('>14.29.30140 <14.40', ['14.29.30139', '14.29.30150'])).toStrictEqual(['^14.29.30150']);
        expect(splitRanges('>14.0.0 <14.29.30140', ['14.29.30139', '14.29.30150'])).toStrictEqual(['14 - 14.29.30139']);
    });

    test('returns ["*"] when versions is empty', () => {
        expect(splitRanges('>=10', [])).toStrictEqual(['*']);
    });

    test('returns ["*"] when no version satisfies the range', () => {
        expect(splitRanges('>=99', ['1.0.0', '2.0.0'])).toStrictEqual(['*']);
    });

    test('ONE_PER_MINOR policy splits by minor versions', () => {
        const versions = ['9.1.0', '9.2.0', '9.3.0', '9.4.0'];
        const result = splitRanges('>=9.1 <=9.4', versions, SubrangePolicies.ONE_PER_MINOR);
        expect(result).toStrictEqual(['9.1', '9.2', '9.3', '9.4']);
    });

    test('ONE_PER_MINOR with partial range match', () => {
        // Range matches 9.3 and 9.4 but not 9.1 and 9.2
        const versions = ['9.1.0', '9.2.0', '9.3.0', '9.4.0'];
        const result = splitRanges('>=9.3 <=9.4', versions, SubrangePolicies.ONE_PER_MINOR);
        expect(result).toStrictEqual(['9.3', '9.4']);
    });

    test('ONE_PER_MAJOR_OR_MINOR uses MINOR when same major', () => {
        const versions = ['9.1.0', '9.2.0', '9.3.0'];
        const result = splitRanges('>=9.1 <=9.3', versions, SubrangePolicies.ONE_PER_MAJOR_OR_MINOR);
        // same major (9) → effective policy is ONE_PER_MINOR
        expect(result).toStrictEqual(['9.1', '9.2', '9.3']);
    });

    test('ONE_PER_MAJOR_OR_MINOR uses MAJOR when different majors', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0'];
        const result = splitRanges('>=9 <=11', versions, SubrangePolicies.ONE_PER_MAJOR_OR_MINOR);
        // different majors → effective policy is ONE_PER_MAJOR
        expect(result).toStrictEqual(['9', '10', '11']);
    });

    test('ONE_PER_MINOR with latest patch subset (tilde range)', () => {
        // Range matches only the latest patches of each minor
        const versions = ['9.1.0', '9.1.1', '9.2.0', '9.2.1'];
        const result = splitRanges('>=9.1.1 <=9.2.1', versions, SubrangePolicies.ONE_PER_MINOR);
        // 9.1: only 9.1.1 matches (latest of minor), 9.2: both match (all match)
        expect(result).toStrictEqual(['~9.1.1', '9.2']);
    });

    test('ONE_PER_MINOR with earliest patch subset (range)', () => {
        const versions = ['9.1.0', '9.1.1', '9.1.2'];
        const result = splitRanges('>=9.1.0 <=9.1.1', versions, SubrangePolicies.ONE_PER_MINOR);
        // earliest 2 patches: 9.1.0 and 9.1.1
        expect(result).toStrictEqual(['9.1 - 9.1.1']);
    });

    test('ONE_PER_MINOR with arbitrary interval', () => {
        const versions = ['9.1.0', '9.1.1', '9.1.2', '9.1.3'];
        const result = splitRanges('>=9.1.1 <=9.1.2', versions, SubrangePolicies.ONE_PER_MINOR);
        expect(result).toStrictEqual(['9.1.1 - 9.1.2']);
    });

    test('ONE_PER_MAJOR arbitrary interval (from/to with different minors)', () => {
        // Versions spanning minors where the subset is in the middle
        const versions = ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0'];
        const result = splitRanges('>=9.2 <=9.4', versions, SubrangePolicies.ONE_PER_MAJOR);
        // from 9.2 to 9.4 is the middle — arbitrary interval
        expect(result).toStrictEqual(['9.2 - 9.4']);
    });

    test('ONE_PER_MAJOR skips majors with no versions in range', () => {
        // Range spans majors 9-11, but only 9 and 11 have versions
        // Major 10 has no versions at all, so loop skips it via majorVersions.length === 0
        const versions = ['9.1.0', '11.1.0'];
        const result = splitRanges('>=9 <=11', versions, SubrangePolicies.ONE_PER_MAJOR);
        // 10 is still iterated but skipped since parsedVersions has no major=10
        expect(result).toStrictEqual(['9', '10', '11']);
    });

    test('ONE_PER_MINOR skips minors with no versions in range', () => {
        // Range excludes 9.2.0 — only 9.1.0 and 9.3.0 match
        const versions = ['9.1.0', '9.2.0', '9.3.0'];
        const result = splitRanges('9.1.0 || 9.3.0', versions, SubrangePolicies.ONE_PER_MINOR);
        expect(result).toStrictEqual(['9.1', '9.3']);
    });

    test('ONE_PER_MAJOR with from having same minor as excluded version', () => {
        // from has same minor as an excluded version before it
        const versions = ['9.1.0', '9.1.1', '9.2.0', '9.3.0', '9.4.0'];
        const result = splitRanges('>=9.1.1 <=9.3', versions, SubrangePolicies.ONE_PER_MAJOR);
        // from 9.1.1 (needs full version since 9.1.0 has same minor) to 9.3
        expect(result).toStrictEqual(['9.1.1 - 9.3']);
    });

    test('ONE_PER_MAJOR with to having same minor as excluded version', () => {
        // to has same minor as an excluded version after it
        const versions = ['9.1.0', '9.2.0', '9.2.1', '9.3.0'];
        const result = splitRanges('>=9.1 <=9.2.0', versions, SubrangePolicies.ONE_PER_MAJOR);
        // from 9.1 to 9.2.0 (needs full version since 9.2.1 has same minor)
        expect(result).toStrictEqual(['9 - 9.2.0']);
    });

    test('ONE_PER_MAJOR with caret range where minor has excluded version', () => {
        // Latest minor versions match, but minor has an excluded version with same minor number
        const versions = ['9.1.0', '9.1.1', '9.2.0', '9.2.1'];
        const result = splitRanges('>=9.1.1', versions, SubrangePolicies.ONE_PER_MAJOR);
        // 9.1.1 and 9.2.x match; this is a "latest" subset — caret range
        // 9.1 minor has 9.1.0 outside range, so needs full version
        expect(result).toStrictEqual(['^9.1.1']);
    });

    test('ONE_PER_MAJOR earliest subset with minor having excluded version', () => {
        // Earliest versions match, but last minor has excluded version
        const versions = ['9.1.0', '9.2.0', '9.2.1'];
        const result = splitRanges('>=9.1.0 <=9.2.0', versions, SubrangePolicies.ONE_PER_MAJOR);
        // earliest 2: 9.1.0 and 9.2.0; but 9.2.1 is same minor as last match
        expect(result).toStrictEqual(['9 - 9.2.0']);
    });

    test('ONE_PER_MAJOR skips major with no parsedVersions (line 242)', () => {
        // Range 9 || 11 spans majors 9-11 in the loop, but 10 is not a subset of "9 || 11"
        // and parsedVersions has no major=10 entries → majorVersions.length === 0 → continue
        const versions = ['9.1.0', '11.1.0'];
        const result = splitRanges('9 || 11', versions, SubrangePolicies.ONE_PER_MAJOR);
        expect(result).toStrictEqual(['9', '11']);
    });

    test('ONE_PER_MINOR skips minor where no versions satisfy range (line 327-328)', () => {
        // Range >=9.1.1 <=9.3 — 9.1.0 exists but does not satisfy the range
        // uniqueMinors includes 9.1, 9.2, 9.3
        // For minor 9.1: minorVersions = [9.1.0], rangeMinorVersions = [] (9.1.0 < 9.1.1) → skip
        const versions = ['9.1.0', '9.2.0', '9.3.0'];
        const result = splitRanges('>=9.1.1 <=9.3', versions, SubrangePolicies.ONE_PER_MINOR);
        expect(result).toStrictEqual(['9.2', '9.3']);
    });
});
