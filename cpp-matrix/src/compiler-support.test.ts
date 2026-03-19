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

import * as core from '@actions/core';
import {
    compilerSupportsStd,
    humanizeCompilerName,
    compilerEmoji,
    versionToString,
    formatVersionList,
    formatStandardLabel,
    warnEmptyCompilerEntries,
    getCompilerCxxStds
} from './compiler-support';
import type { MatrixEntry } from './types';
import type { Inputs } from './schema';
import * as semver from 'semver';

describe('compilerSupportsStd', () => {
    test('returns false for unknown compiler', () => {
        expect(compilerSupportsStd('unknown-compiler', '10.0.0', 2020)).toBe(false);
    });

    test('mingw delegates to gcc thresholds', () => {
        expect(compilerSupportsStd('mingw', '11.1.0', 2023)).toBe(true);
        expect(compilerSupportsStd('mingw', '4.0.0', 2023)).toBe(false);
        expect(compilerSupportsStd('mingw', '5.1.0', 2017)).toBe(true);
    });

    test('macos-gcc delegates to gcc thresholds', () => {
        expect(compilerSupportsStd('macos-gcc', '11.1.0', 2023)).toBe(true);
        expect(compilerSupportsStd('macos-gcc', '4.0.0', 2023)).toBe(false);
        expect(compilerSupportsStd('macos-gcc', '10.1.0', 2020)).toBe(true);
    });

    test('clang-cl delegates to clang thresholds', () => {
        expect(compilerSupportsStd('clang-cl', '17.0.0', 2023)).toBe(true);
        expect(compilerSupportsStd('clang-cl', '10.0.0', 2020)).toBe(true);
        expect(compilerSupportsStd('clang-cl', '5.0.0', 2020)).toBe(false);
    });

    test('macos-clang delegates to clang thresholds', () => {
        expect(compilerSupportsStd('macos-clang', '17.0.0', 2023)).toBe(true);
        expect(compilerSupportsStd('macos-clang', '10.0.0', 2020)).toBe(true);
        expect(compilerSupportsStd('macos-clang', '5.0.0', 2020)).toBe(false);
    });

    test('gcc supports c++03 for any version', () => {
        expect(compilerSupportsStd('gcc', '4.0.0', 2003)).toBe(true);
    });

    test('clang supports c++03 for any version', () => {
        expect(compilerSupportsStd('clang', '3.0.0', 2003)).toBe(true);
    });

    test('msvc supports c++03 for any version', () => {
        expect(compilerSupportsStd('msvc', '14.0.0', 2003)).toBe(true);
    });

    test('apple-clang supports c++03 for any version', () => {
        expect(compilerSupportsStd('apple-clang', '13.0.0', 2003)).toBe(true);
    });

    describe('apple-clang C++ standard thresholds', () => {
        // Apple Clang 13 supports C++11, C++14, C++17 but not C++20 or C++23
        test('apple-clang 13 supports C++11', () => {
            expect(compilerSupportsStd('apple-clang', '13.0.0', 2011)).toBe(true);
        });
        test('apple-clang 13 supports C++14', () => {
            expect(compilerSupportsStd('apple-clang', '13.0.0', 2014)).toBe(true);
        });
        test('apple-clang 13 supports C++17', () => {
            expect(compilerSupportsStd('apple-clang', '13.0.0', 2017)).toBe(true);
        });
        test('apple-clang 13 does not support C++20', () => {
            expect(compilerSupportsStd('apple-clang', '13.0.0', 2020)).toBe(false);
        });
        test('apple-clang 13 does not support C++23', () => {
            expect(compilerSupportsStd('apple-clang', '13.0.0', 2023)).toBe(false);
        });

        // Apple Clang 14 adds C++20 support
        test('apple-clang 14 supports C++20', () => {
            expect(compilerSupportsStd('apple-clang', '14.0.0', 2020)).toBe(true);
        });
        test('apple-clang 14 does not support C++23', () => {
            expect(compilerSupportsStd('apple-clang', '14.0.0', 2023)).toBe(false);
        });

        // Apple Clang 15 same as 14
        test('apple-clang 15 supports C++20', () => {
            expect(compilerSupportsStd('apple-clang', '15.0.0', 2020)).toBe(true);
        });
        test('apple-clang 15 does not support C++23', () => {
            expect(compilerSupportsStd('apple-clang', '15.0.0', 2023)).toBe(false);
        });

        // Apple Clang 16 adds C++23 support
        test('apple-clang 16 supports C++23', () => {
            expect(compilerSupportsStd('apple-clang', '16.0.0', 2023)).toBe(true);
        });

        // Apple Clang 17 supports all
        test('apple-clang 17 supports C++23', () => {
            expect(compilerSupportsStd('apple-clang', '17.0.0', 2023)).toBe(true);
        });
        test('apple-clang 17 supports C++11', () => {
            expect(compilerSupportsStd('apple-clang', '17.0.0', 2011)).toBe(true);
        });
    });
});

describe('humanizeCompilerName', () => {
    test('returns human name for known compilers', () => {
        expect(humanizeCompilerName('gcc')).toBe('GCC');
        expect(humanizeCompilerName('clang')).toBe('Clang');
        expect(humanizeCompilerName('msvc')).toBe('MSVC');
        expect(humanizeCompilerName('macos-gcc')).toBe('macOS-GCC');
        expect(humanizeCompilerName('macos-clang')).toBe('macOS-Clang');
    });

    test('returns input for unknown compiler', () => {
        expect(humanizeCompilerName('unknown-compiler')).toBe('unknown-compiler');
    });
});

describe('compilerEmoji', () => {
    test('returns emoji for known compilers', () => {
        expect(compilerEmoji('gcc')).toBe('🐧');
        expect(compilerEmoji('clang')).toBe('🐉');
        expect(compilerEmoji('macos-gcc')).toBe('🍺');
        expect(compilerEmoji('macos-clang')).toBe('🍺');
    });

    test('returns default emoji for unknown compiler', () => {
        expect(compilerEmoji('unknown-compiler')).toBe('🛠️');
    });
});

describe('versionToString', () => {
    test('returns string input as-is', () => {
        expect(versionToString('1.2.3')).toBe('1.2.3');
    });

    test('returns unknown for null', () => {
        expect(versionToString(null)).toBe('unknown');
    });

    test('returns unknown for undefined', () => {
        expect(versionToString(undefined)).toBe('unknown');
    });

    test('returns version string from SemVer object', () => {
        const sv = semver.parse('10.2.1')!;
        expect(versionToString(sv)).toBe('10.2.1');
    });

    test('returns unknown for SemVer-like object with no version and no parts', () => {
        const obj = { major: undefined, minor: undefined, patch: undefined, version: '' } as unknown as semver.SemVer;
        expect(versionToString(obj)).toBe('unknown');
    });

    test('builds version from major/minor/patch when version string is empty', () => {
        const obj = { major: 5, minor: 3, patch: 1, version: '' } as unknown as semver.SemVer;
        expect(versionToString(obj)).toBe('5.3.1');
    });
});

describe('formatVersionList', () => {
    test('returns none for empty array', () => {
        expect(formatVersionList([])).toBe('none');
    });

    test('returns comma-separated versions', () => {
        expect(formatVersionList(['1.0', '2.0'])).toBe('1.0, 2.0');
    });

    test('deduplicates versions', () => {
        expect(formatVersionList(['1.0', '1.0', '2.0'])).toBe('1.0, 2.0');
    });
});

describe('formatStandardLabel', () => {
    test('formats number as C++ label', () => {
        expect(formatStandardLabel(2020)).toBe('C++2020');
    });

    test('returns string as-is', () => {
        expect(formatStandardLabel('latest')).toBe('latest');
    });
});

describe('warnEmptyCompilerEntries', () => {
    const warnSpy = jest.mocked(core.warning);

    beforeEach(() => {
        warnSpy.mockClear();
    });

    test('warns immediately when no known versions', () => {
        warnEmptyCompilerEntries('gcc', '>=10', [], [2020], '>=20');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('no published GCC versions are known');
    });

    test('warns with detail when versions exist but standards empty', () => {
        warnEmptyCompilerEntries('gcc', '>=10', ['10.0.0', '11.0.0'], [], '');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain('resolved to an empty set');
    });

    test('warns with combined matches when standards provided', () => {
        warnEmptyCompilerEntries('clang', '>=5 <6', ['5.0.0', '6.0.0'], [2023], '>=23');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain('Combined matches');
    });

    test('warns with invalid range', () => {
        warnEmptyCompilerEntries('gcc', 'invalid-range!!!', ['10.0.0'], [2020], '>=20');
        expect(warnSpy).toHaveBeenCalled();
    });

    test('matchesRange returns true for wildcard range', () => {
        warnEmptyCompilerEntries('gcc', '*', ['10.0.0'], [2020], '>=20');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain('Version requirement');
    });

    test('matchesRange returns true for empty range', () => {
        warnEmptyCompilerEntries('gcc', '', ['10.0.0'], [2020], '>=20');
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});

describe('getCompilerCxxStds', () => {
    function makeEntry(): MatrixEntry {
        return {
            name: 'GCC', compiler: 'gcc', version: '>=10',
            env: {}, 'is-latest': false, 'is-main': false,
            'is-earliest': false, 'is-intermediary': false,
            'has-major': false, 'has-minor': false, 'has-patch': false,
            'subrange-policy': ''
        };
    }

    test('returns undefined when no standards supported', () => {
        const entry = makeEntry();
        const inputs = { maxStandards: undefined } as unknown as Inputs;
        const result = getCompilerCxxStds(entry, inputs, ['4.0.0'], [2023], 'gcc', semver.parse('4.0.0')!);
        expect(result).toBeUndefined();
    });

    test('limits standards to maxStandards', () => {
        const entry = makeEntry();
        const inputs = { maxStandards: 1 } as unknown as Inputs;
        const result = getCompilerCxxStds(entry, inputs, ['11.1.0'], [2011, 2014, 2017, 2020, 2023], 'gcc', semver.parse('11.1.0')!);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
        expect(entry['cxxstd']).toBe('23');
    });

    test('returns empty array when no known versions', () => {
        const entry = makeEntry();
        const inputs = { maxStandards: undefined } as unknown as Inputs;
        const result = getCompilerCxxStds(entry, inputs, [], [2020], 'gcc', semver.parse('10.0.0')!);
        expect(result).toEqual([]);
    });
});
