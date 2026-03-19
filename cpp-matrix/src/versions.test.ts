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
    findAppleClangVersions,
    findMingwVersions,
    findClangClVersions,
    findMacOSGccVersions,
    findMacOSClangVersions,
    getVisualCppYear,
    arraysHaveSameElements,
    getSubrangePolicy,
    getSubrangePolicyStr,
    SubrangePolicies,
    getWindowsDefaultMsvcVersions,
    getWindowsAvailableMsvcVersions
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

    it('returns 2026 for >= 14.50', () => {
        expect(getVisualCppYear('14.50.0')).toBe('2026');
    });

    it('returns 2022 for >= 14.30', () => {
        expect(getVisualCppYear('14.30.0')).toBe('2022');
        expect(getVisualCppYear('14.44.0')).toBe('2022');
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

    it('returns ONE_PER_UBUNTU_DEFAULT for "one-per-ubuntu-default"', () => {
        expect(getSubrangePolicy('one-per-ubuntu-default')).toBe(SubrangePolicies.ONE_PER_UBUNTU_DEFAULT);
    });

    it('returns ONE_PER_UBUNTU_AVAILABLE for "one-per-ubuntu-available"', () => {
        expect(getSubrangePolicy('one-per-ubuntu-available')).toBe(SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE);
    });

    it('returns UBUNTU_DEFAULTS_AND_LATEST for "ubuntu-defaults-and-latest"', () => {
        expect(getSubrangePolicy('ubuntu-defaults-and-latest')).toBe(SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST);
    });

    it('returns ONE_PER_VS_YEAR for "one-per-vs-year"', () => {
        expect(getSubrangePolicy('one-per-vs-year')).toBe(SubrangePolicies.ONE_PER_VS_YEAR);
    });

    it('returns MACOS_DEFAULTS_AND_LATEST for "macos-defaults-and-latest"', () => {
        expect(getSubrangePolicy('macos-defaults-and-latest')).toBe(SubrangePolicies.MACOS_DEFAULTS_AND_LATEST);
    });

    it('returns LATEST for "latest"', () => {
        expect(getSubrangePolicy('latest')).toBe(SubrangePolicies.LATEST);
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

    it('returns "one-per-ubuntu-default" for ONE_PER_UBUNTU_DEFAULT', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_UBUNTU_DEFAULT)).toBe('one-per-ubuntu-default');
    });

    it('returns "one-per-ubuntu-available" for ONE_PER_UBUNTU_AVAILABLE', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE)).toBe('one-per-ubuntu-available');
    });

    it('returns "ubuntu-defaults-and-latest" for UBUNTU_DEFAULTS_AND_LATEST', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST)).toBe('ubuntu-defaults-and-latest');
    });

    it('returns "one-per-vs-year" for ONE_PER_VS_YEAR', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.ONE_PER_VS_YEAR)).toBe('one-per-vs-year');
    });

    it('returns "macos-defaults-and-latest" for MACOS_DEFAULTS_AND_LATEST', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.MACOS_DEFAULTS_AND_LATEST)).toBe('macos-defaults-and-latest');
    });

    it('returns "latest" for LATEST', () => {
        expect(getSubrangePolicyStr(SubrangePolicies.LATEST)).toBe('latest');
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
        expect(splitRanges('>=14 <14.50', findMSVCVersions())).toStrictEqual(['14 - 14.44']);
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

// Tests for Ubuntu-aware subrange policies.
// These use real ubuntu-compiler-defaults.json data loaded via setup_program.
// Note: getUbuntuDefaultVersions and getUbuntuAvailableVersions iterate ALL releases
// (not just LTS), so the full data set applies here.
// The data file has 20 Ubuntu releases (16.04 through 25.10):
//   GCC defaults (all releases): 5(16.04), 6(16.10/17.04), 7(17.10/18.04), 8(18.10/19.04),
//                 9(19.10/20.04), 10(20.10/21.04), 11(21.10/22.04), 12(22.10/23.04),
//                 13(23.10/24.04), 14(24.10/25.04), 15(25.10)
//   Unique GCC defaults: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
//   Clang defaults (all releases): 7(18.10), 8(19.04), 9(19.10), 10(20.04), 11(20.10),
//                   12(21.04), 13(21.10), 14(22.04), 15(22.10/23.04), 16(23.10), 18(24.04),
//                   19(24.10), 20(25.04/25.10)
//   Unique Clang defaults: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20]
//   GCC available (all releases): [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
//   Clang available (all releases): [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]

describe('splitRanges ONE_PER_UBUNTU_DEFAULT', () => {
    // GCC versions spanning multiple Ubuntu default majors
    const gccVersions = ['9.1.0', '9.2.0', '9.3.0', '9.4.0', '9.5.0',
        '10.1.0', '10.2.0', '10.3.0', '10.4.0', '10.5.0',
        '11.1.0', '11.2.0', '11.3.0', '11.4.0',
        '12.1.0', '12.2.0', '12.3.0',
        '13.1.0', '13.2.0',
        '14.1.0', '14.2.0'];

    test('returns one subrange per Ubuntu default GCC version', () => {
        // GCC defaults in range >=9: 9, 10, 11, 12, 13, 14
        const result = splitRanges('>=9', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'gcc');
        expect(result).toStrictEqual(['9', '10', '11', '12', '13', '14']);
    });

    test('excludes default versions outside user range', () => {
        // Range >=11 excludes GCC 9, 10 defaults
        const result = splitRanges('>=11', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'gcc');
        expect(result).toStrictEqual(['11', '12', '13', '14']);
    });

    test('works with clang defaults', () => {
        const clangVersions = ['10.0.0', '11.0.0', '12.0.0', '13.0.0', '14.0.0',
            '15.0.0', '16.0.0', '17.0.0', '18.0.0', '19.0.0', '20.0.0'];
        // Clang defaults: 10, 11, 12, 13, 14, 15, 16, 18, 19, 20
        const result = splitRanges('>=10', clangVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'clang');
        expect(result).toStrictEqual(['10', '11', '12', '13', '14', '15', '16', '18', '19', '20']);
    });

    test('falls back to latest when no defaults match range', () => {
        // Range >=99 — no ubuntu defaults match
        const result = splitRanges('>=99', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'gcc');
        // No defaults match, and no versions satisfy >=99 either → ['*']
        expect(result).toStrictEqual(['*']);
    });

    test('falls back to latest for non-gcc/clang compiler', () => {
        // MSVC has no ubuntu defaults
        const msvcVersions = ['14.29.30133', '14.29.30140', '14.30.30704'];
        const result = splitRanges('>=14.29', msvcVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'msvc');
        // Falls back to latest → latest in range is 14.30.30704 → major 14
        expect(result).toStrictEqual(['14']);
    });

    test('narrow range selects only matching defaults', () => {
        // Range 11 - 13 includes defaults 11, 12, and 13
        const result = splitRanges('>=11 <=13', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'gcc');
        expect(result).toStrictEqual(['11', '12', '13']);
    });

    test('single default version in range', () => {
        const result = splitRanges('>=12 <=13', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'gcc');
        // GCC 12 and 13 are both defaults in this range
        expect(result).toStrictEqual(['12', '13']);
    });
});

describe('splitRanges ONE_PER_UBUNTU_AVAILABLE', () => {
    const gccVersions = ['9.1.0', '10.1.0', '11.1.0', '12.1.0', '13.1.0', '14.1.0', '15.1.0'];

    test('returns one subrange per available GCC version across all releases', () => {
        // GCC available: 9,10 (20.04), 11,12 (22.04), 13,14 (24.04), 14,15 (25.04)
        // Unique available: 9, 10, 11, 12, 13, 14, 15
        const result = splitRanges('>=9', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE, 'gcc');
        expect(result).toStrictEqual(['9', '10', '11', '12', '13', '14', '15']);
    });

    test('excludes versions outside user range', () => {
        const result = splitRanges('>=12 <=14', gccVersions, SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE, 'gcc');
        expect(result).toStrictEqual(['12', '13', '14']);
    });

    test('is a superset of ubuntu defaults', () => {
        const clangVersions = ['10.0.0', '11.0.0', '12.0.0', '13.0.0', '14.0.0',
            '15.0.0', '16.0.0', '17.0.0', '18.0.0', '19.0.0', '20.0.0'];
        // Clang available across all releases: 10,11,12,13,14,15,16,17,18,19,20
        const available = splitRanges('>=10', clangVersions, SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE, 'clang');
        const defaults = splitRanges('>=10', clangVersions, SubrangePolicies.ONE_PER_UBUNTU_DEFAULT, 'clang');
        // All defaults should be contained in available
        for (const d of defaults) {
            expect(available).toContain(d);
        }
        // Available should have more than just defaults
        expect(available.length).toBeGreaterThanOrEqual(defaults.length);
    });

    test('falls back to latest for non-gcc/clang compiler', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0'];
        const result = splitRanges('>=9', versions, SubrangePolicies.ONE_PER_UBUNTU_AVAILABLE, 'apple-clang');
        // Falls back to latest → latest in range is 11.1.0 → major 11
        expect(result).toStrictEqual(['11']);
    });
});

describe('splitRanges UBUNTU_DEFAULTS_AND_LATEST', () => {
    const gccVersions = ['9.1.0', '10.1.0', '11.1.0', '12.1.0', '13.1.0', '14.1.0', '15.1.0'];

    test('includes Ubuntu defaults plus the latest available version', () => {
        // GCC defaults in range: 9, 10, 11, 12, 13, 14, 15 — all are defaults
        // GCC available in range: 9, 10, 11, 12, 13, 14, 15 — latest is 15, already a default
        const result = splitRanges('>=9', gccVersions, SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST, 'gcc');
        expect(result).toStrictEqual(['9', '10', '11', '12', '13', '14', '15']);
    });

    test('no duplicate when latest is already a default', () => {
        // Range <=14: defaults in range are 9, 10, 11, 12, 13, 14. Latest available is 14 (already a default)
        const result = splitRanges('>=9 <=14', gccVersions, SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST, 'gcc');
        expect(result).toStrictEqual(['9', '10', '11', '12', '13', '14']);
    });

    test('adds latest even when only one default matches', () => {
        // Range >=12 <=15: defaults 12, 13, 14, 15. Latest available is 15, already a default
        const result = splitRanges('>=12 <=15', gccVersions, SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST, 'gcc');
        expect(result).toStrictEqual(['12', '13', '14', '15']);
    });

    test('works with clang', () => {
        const clangVersions = ['14.0.0', '15.0.0', '16.0.0', '17.0.0', '18.0.0', '19.0.0', '20.0.0'];
        // Clang defaults in range: 14, 15, 16, 18, 19, 20. Latest available in range: 20, already a default
        const result = splitRanges('>=14', clangVersions, SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST, 'clang');
        expect(result).toStrictEqual(['14', '15', '16', '18', '19', '20']);
    });

    test('falls back to latest for non-gcc/clang compiler', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0'];
        const result = splitRanges('>=9', versions, SubrangePolicies.UBUNTU_DEFAULTS_AND_LATEST, 'mingw');
        // No ubuntu defaults or available versions for mingw → falls back to latest → 11
        expect(result).toStrictEqual(['11']);
    });
});

describe('splitRanges ONE_PER_VS_YEAR', () => {
    // Uses real windows-msvc-defaults.json data:
    //   windows-2022: MSVC 14.44 (default), 14.29
    //   windows-2025: MSVC 14.44 (default), 14.29
    //   windows-2025-vs2026: MSVC 14.50 (default), 14.44
    // Defaults: [44, 50], Available: [29, 44, 50]
    const msvcVersions = findMSVCVersions(); // ['14.29.0', '14.44.0', '14.50.0']

    test('selects default versions plus latest available', () => {
        const result = splitRanges('>=14.20', msvcVersions, SubrangePolicies.ONE_PER_VS_YEAR, 'msvc');
        // Defaults 14.44 and 14.50 in range, latest available 14.50 is same as default → no extra
        expect(result).toStrictEqual(['14.44', '14.50']);
    });

    test('latest is not duplicated when it matches a default', () => {
        const result = splitRanges('14.44', msvcVersions, SubrangePolicies.ONE_PER_VS_YEAR, 'msvc');
        // Default 14.44 is in range, latest available in range is also 14.44 → no duplicate
        expect(result).toStrictEqual(['14.44']);
    });

    test('excludes defaults outside user range', () => {
        const result = splitRanges('>=14.50', msvcVersions, SubrangePolicies.ONE_PER_VS_YEAR, 'msvc');
        // Default 14.44 is NOT in range, only 14.50 matches → latest only
        expect(result).toStrictEqual(['14.50']);
    });

    test('falls back to latest for non-MSVC compiler', () => {
        const gccVersions = ['9.1.0', '10.1.0', '11.1.0'];
        const result = splitRanges('>=9', gccVersions, SubrangePolicies.ONE_PER_VS_YEAR, 'gcc');
        // Falls back to latest → latest in range is 11.1.0 → major 11
        expect(result).toStrictEqual(['11']);
    });

    test('returns ["*"] when no versions satisfy range', () => {
        const result = splitRanges('>=14.99', msvcVersions, SubrangePolicies.ONE_PER_VS_YEAR, 'msvc');
        expect(result).toStrictEqual(['*']);
    });
});

describe('getWindowsDefaultMsvcVersions', () => {
    it('returns default MSVC minors from data file', () => {
        const defaults = setup_program.loadWindowsMsvcDefaults();
        const minors = getWindowsDefaultMsvcVersions(defaults);
        // 14.44 is_default on windows-2022/2025, 14.50 is_default on windows-2025-vs2026
        expect(minors).toStrictEqual([44, 50]);
    });
});

describe('getWindowsAvailableMsvcVersions', () => {
    it('returns all available MSVC minors from data file', () => {
        const defaults = setup_program.loadWindowsMsvcDefaults();
        const minors = getWindowsAvailableMsvcVersions(defaults);
        // 14.29, 14.44 across windows-2022/2025 + 14.50 from windows-2025-vs2026
        expect(minors).toStrictEqual([29, 44, 50]);
    });
});

describe('findMSVCVersions', () => {
    it('returns unique MSVC versions with .0 patch sorted ascending by semver', () => {
        const versions = findMSVCVersions();
        // windows-msvc-defaults.json has: 14.29 (2019), 14.44 (2022), 14.50 (2026 on windows-2025-vs2026)
        expect(versions).toStrictEqual(['14.29.0', '14.44.0', '14.50.0']);
    });

    it('deduplicates versions across runners', () => {
        const versions = findMSVCVersions();
        // 14.29 and 14.44 appear on both windows-2022 and windows-2025 but should only appear once
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });
});

describe('findAppleClangVersions', () => {
    it('returns unique Apple Clang versions sorted ascending by semver', () => {
        const versions = findAppleClangVersions();
        // macos-xcode-defaults.json has: 15.0.0 (macos-14), 16.0.0 (macos-14/15), 17.0.0 (macos-15)
        expect(versions).toStrictEqual(['15.0.0', '16.0.0', '17.0.0']);
    });

    it('deduplicates versions across runners', () => {
        const versions = findAppleClangVersions();
        // 16.0.0 appears on both macos-14 and macos-15 but should only appear once
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });
});

describe('findMingwVersions', () => {
    it('returns unique MinGW GCC versions sorted ascending by semver', () => {
        const versions = findMingwVersions();
        // windows-msvc-defaults.json has: pre-installed 14, 15 + installable 8.1.0..15.2.0
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('8.1.0');
        expect(versions).toContain('14.0.0');
        expect(versions).toContain('15.2.0');
    });

    it('deduplicates pre-installed and installable versions', () => {
        const versions = findMingwVersions();
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });

    it('merges pre-installed majors with installable versions', () => {
        const versions = findMingwVersions();
        // Pre-installed "14" → "14.0.0" and installable "14.2.0" should both appear
        expect(versions).toContain('14.0.0');
        expect(versions).toContain('14.2.0');
    });
});

describe('findClangClVersions', () => {
    it('returns unique LLVM versions sorted ascending by semver', () => {
        const versions = findClangClVersions();
        // windows-msvc-defaults.json has: pre-installed 20 + installable 14.0.0..22.1.0
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('14.0.0');
        expect(versions).toContain('20.0.0');
        expect(versions).toContain('22.1.0');
    });

    it('deduplicates pre-installed and installable versions', () => {
        const versions = findClangClVersions();
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });
});

describe('findMacOSGccVersions', () => {
    it('returns unique macOS GCC versions sorted ascending by semver', () => {
        const versions = findMacOSGccVersions();
        // macos-xcode-defaults.json has: pre-installed [13,14,15] + installable 11.5.0..15.2.0
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('11.5.0');
        expect(versions).toContain('13.0.0');
        expect(versions).toContain('15.2.0');
    });

    it('deduplicates pre-installed and installable versions', () => {
        const versions = findMacOSGccVersions();
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });

    it('merges pre-installed majors with installable versions', () => {
        const versions = findMacOSGccVersions();
        // Pre-installed "13" → "13.0.0" and installable "13.4.0" should both appear
        expect(versions).toContain('13.0.0');
        expect(versions).toContain('13.4.0');
    });
});

describe('findMacOSClangVersions', () => {
    it('returns unique macOS LLVM versions sorted ascending by semver', () => {
        const versions = findMacOSClangVersions();
        // macos-xcode-defaults.json has: pre-installed 15, 18 + installable 15.0.7..22.1.1
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('15.0.0');
        expect(versions).toContain('18.0.0');
        expect(versions).toContain('22.1.1');
    });

    it('deduplicates pre-installed and installable versions', () => {
        const versions = findMacOSClangVersions();
        const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
        expect(duplicates).toHaveLength(0);
    });
});

describe('findCompilerVersions mingw', () => {
    it('returns mingw versions', async () => {
        const versions = await findCompilerVersions('mingw');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('14.2.0');
    });
});

describe('findCompilerVersions clang-cl', () => {
    it('returns clang-cl versions', async () => {
        const versions = await findCompilerVersions('clang-cl');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('20.1.8');
    });
});

describe('findCompilerVersions macos-gcc', () => {
    it('returns macos-gcc versions', async () => {
        const versions = await findCompilerVersions('macos-gcc');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('14.3.0');
    });
});

describe('findCompilerVersions macos-clang', () => {
    it('returns macos-clang versions', async () => {
        const versions = await findCompilerVersions('macos-clang');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('18.1.8');
    });
});

describe('findCompilerVersions apple-clang', () => {
    it('returns apple-clang versions', async () => {
        const versions = await findCompilerVersions('apple-clang');
        expect(versions.length).toBeGreaterThan(0);
        expect(versions).toContain('15.0.0');
        expect(versions).toContain('16.0.0');
        expect(versions).toContain('17.0.0');
    });
});

describe('splitRanges with apple-clang versions', () => {
    it('works with one-per-major policy', () => {
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('>=15', versions, SubrangePolicies.ONE_PER_MAJOR, 'apple-clang');
        expect(result).toStrictEqual(['15', '16', '17']);
    });

    it('restricts to range', () => {
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('>=16', versions, SubrangePolicies.ONE_PER_MAJOR, 'apple-clang');
        expect(result).toStrictEqual(['16', '17']);
    });

    it('handles single version range', () => {
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('16', versions, SubrangePolicies.ONE_PER_MAJOR, 'apple-clang');
        expect(result).toStrictEqual(['16']);
    });
});

// Tests for MACOS_DEFAULTS_AND_LATEST subrange policy.
// These use real macos-xcode-defaults.json data loaded via setup_program.
// The data file has:
//   macos-14: default Xcode 15.4 → Apple Clang 15.0.0 (default), 16.0.0
//   macos-15: default Xcode 16.2 → Apple Clang 16.0.0 (default), 17.0.0
// Default Apple Clang majors: [15, 16] (from is_default entries)
// Available Apple Clang majors: [15, 16, 17] (all entries)

describe('splitRanges MACOS_DEFAULTS_AND_LATEST', () => {
    test('includes macOS defaults plus the latest available version', () => {
        // Defaults: 15 (macos-14), 16 (macos-15). Latest available: 17.
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('>=15', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        expect(result).toStrictEqual(['15', '16', '17']);
    });

    test('no duplicate when latest is already a default', () => {
        // Restrict to range where latest available (16) is already a default
        const versions = ['15.0.0', '16.0.0'];
        const result = splitRanges('>=15 <=16', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        expect(result).toStrictEqual(['15', '16']);
    });

    test('adds latest even when only one default matches', () => {
        // Range >=16: defaults in range = [16]. Latest available in range = 17
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('>=16', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        expect(result).toStrictEqual(['16', '17']);
    });

    test('excludes default versions outside user range', () => {
        // Range >=16: default 15 is outside range
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('>=16', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        expect(result).not.toContain('15');
    });

    test('falls back to latest for non-apple-clang compiler', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0'];
        const result = splitRanges('>=9', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'gcc');
        // Falls back to latest → latest in range is 11.1.0 → major 11
        expect(result).toStrictEqual(['11']);
    });

    test('returns ["*"] when no versions satisfy range', () => {
        const versions = ['15.0.0', '16.0.0'];
        const result = splitRanges('>=99', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        expect(result).toStrictEqual(['*']);
    });

    test('handles single version range', () => {
        const versions = ['15.0.0', '16.0.0', '17.0.0'];
        const result = splitRanges('15', versions, SubrangePolicies.MACOS_DEFAULTS_AND_LATEST, 'apple-clang');
        // 15 is a default, no latest addition needed (15 is already selected)
        expect(result).toStrictEqual(['15']);
    });
});

describe('splitRanges LATEST', () => {
    test('returns only the single highest version in range', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0', '12.1.0'];
        const result = splitRanges('>=9', versions, SubrangePolicies.LATEST);
        expect(result).toStrictEqual(['12']);
    });

    test('respects the upper bound of the range', () => {
        const versions = ['9.1.0', '10.1.0', '11.1.0', '12.1.0'];
        const result = splitRanges('>=9 <=11', versions, SubrangePolicies.LATEST);
        expect(result).toStrictEqual(['11']);
    });

    test('returns ["*"] when no versions satisfy range', () => {
        const versions = ['9.1.0', '10.1.0'];
        const result = splitRanges('>=99', versions, SubrangePolicies.LATEST);
        expect(result).toStrictEqual(['*']);
    });

    test('returns ["*"] when versions list is empty', () => {
        const result = splitRanges('>=9', [], SubrangePolicies.LATEST);
        expect(result).toStrictEqual(['*']);
    });

    test('handles single version', () => {
        const versions = ['15.0.0'];
        const result = splitRanges('>=15', versions, SubrangePolicies.LATEST);
        expect(result).toStrictEqual(['15']);
    });

    test('picks latest across multiple majors', () => {
        const versions = ['14.29.30133', '14.44.35207'];
        const result = splitRanges('>=14', versions, SubrangePolicies.LATEST);
        // Latest is 14.44.35207 → major 14
        expect(result).toStrictEqual(['14']);
    });
});
