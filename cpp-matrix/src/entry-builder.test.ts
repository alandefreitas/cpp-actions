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

import * as semver from 'semver';
import { type MatrixEntry, type CompilerSuggestion } from './types';
import {
    setEntrySemverComponents,
    setCompilerExecutableNames,
    setCompilerExecutableNamesNoVersion,
    setCompilerContainerNoVersion,
    isArrayOfObjects,
    setSuggestion,
    appendSuggestion,
    applyForcedFactors,
    setCompilerContainer,
    findBestUbuntuRelease,
    findBestMacOSRunner,
    findBestWindowsRunner,
    findNewestMacOSRunner,
    setCompilerB2Toolset,
    runsOnLabels,
    inferVisualStudioGeneratorFromRunsOn,
    setCompilerCMakeGenerator,
    setEntryVersionFlags,
    setEntryName
} from './entry-builder';

function makeEntry(overrides: Partial<MatrixEntry> = {}): MatrixEntry {
    return {
        name: '',
        compiler: 'gcc',
        version: '12',
        env: {},
        'is-latest': false,
        'is-main': false,
        'is-earliest': false,
        'is-intermediary': false,
        'has-major': true,
        'has-minor': true,
        'has-patch': true,
        'subrange-policy': 'one-per-major',
        ...overrides
    };
}

function makeInputs(overrides: Record<string, unknown> = {}) {
    return { useContainers: false, ...overrides } as any;
}

describe('setEntrySemverComponents', () => {
    test('same major, same minor, same patch', () => {
        const entry = makeEntry();
        const v = semver.parse('12.3.4')!;
        setEntrySemverComponents(entry, v, v);
        expect(entry.major).toBe(12);
        expect(entry.minor).toBe(3);
        expect(entry.patch).toBe(4);
    });

    test('same major, same minor, different patch', () => {
        const entry = makeEntry();
        setEntrySemverComponents(entry, semver.parse('12.3.1')!, semver.parse('12.3.5')!);
        expect(entry.major).toBe(12);
        expect(entry.minor).toBe(3);
        expect(entry.patch).toBe('*');
    });

    test('same major, different minor', () => {
        const entry = makeEntry();
        setEntrySemverComponents(entry, semver.parse('12.1.0')!, semver.parse('12.3.0')!);
        expect(entry.major).toBe(12);
        expect(entry.minor).toBe('*');
        expect(entry.patch).toBe('*');
    });

    test('different major sets all wildcards', () => {
        const entry = makeEntry();
        setEntrySemverComponents(entry, semver.parse('11.0.0')!, semver.parse('12.0.0')!);
        expect(entry.major).toBe('*');
        expect(entry.minor).toBe('*');
        expect(entry.patch).toBe('*');
    });

    test('null versions does nothing', () => {
        const entry = makeEntry();
        setEntrySemverComponents(entry, null, null);
        expect(entry.major).toBeUndefined();
    });
});

describe('setCompilerExecutableNames', () => {
    test('gcc >= 5 uses major only', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'gcc', semver.parse('12.0.0')!);
        expect(entry.cc).toBe('gcc-12');
        expect(entry.cxx).toBe('g++-12');
    });

    test('gcc < 5 uses major.minor', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'gcc', semver.parse('4.8.0')!);
        expect(entry.cc).toBe('gcc-4.8');
        expect(entry.cxx).toBe('g++-4.8');
    });

    test('clang >= 7 uses major only', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'clang', semver.parse('16.0.0')!);
        expect(entry.cc).toBe('clang-16');
        expect(entry.cxx).toBe('clang++-16');
    });

    test('clang < 7 uses major.minor', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'clang', semver.parse('6.0.0')!);
        expect(entry.cc).toBe('clang-6.0');
        expect(entry.cxx).toBe('clang++-6.0');
    });

    test('apple-clang uses plain names', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'apple-clang', semver.parse('14.0.0')!);
        expect(entry.cc).toBe('clang');
        expect(entry.cxx).toBe('clang++');
    });

    test('clang-cl uses clang-cl names', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'clang-cl', semver.parse('16.0.0')!);
        expect(entry.cc).toBe('clang-cl');
        expect(entry.cxx).toBe('clang++-cl');
    });

    test('mingw uses gcc/g++', () => {
        const entry = makeEntry();
        setCompilerExecutableNames(entry, 'mingw', semver.parse('12.0.0')!);
        expect(entry.cc).toBe('gcc');
        expect(entry.cxx).toBe('g++');
    });
});

describe('setCompilerExecutableNamesNoVersion', () => {
    test('apple-clang sets clang/clang++', () => {
        const entry = makeEntry();
        setCompilerExecutableNamesNoVersion(entry, 'apple-clang');
        expect(entry.cc).toBe('clang');
        expect(entry.cxx).toBe('clang++');
    });

    test('clang-cl sets clang-cl names', () => {
        const entry = makeEntry();
        setCompilerExecutableNamesNoVersion(entry, 'clang-cl');
        expect(entry.cc).toBe('clang-cl');
        expect(entry.cxx).toBe('clang++-cl');
    });

    test('mingw sets gcc/g++', () => {
        const entry = makeEntry();
        setCompilerExecutableNamesNoVersion(entry, 'mingw');
        expect(entry.cc).toBe('gcc');
        expect(entry.cxx).toBe('g++');
    });

    test('gcc does not set names', () => {
        const entry = makeEntry();
        setCompilerExecutableNamesNoVersion(entry, 'gcc');
        expect(entry.cc).toBeUndefined();
        expect(entry.cxx).toBeUndefined();
    });
});

describe('setCompilerContainerNoVersion', () => {
    test('apple-clang uses newest runner from data', () => {
        const entry = makeEntry();
        setCompilerContainerNoVersion(entry, 'apple-clang');
        // Newest runner in data is macos-15
        expect(entry['runs-on']).toBe('macos-15');
    });

    test('mingw sets windows-2022', () => {
        const entry = makeEntry();
        setCompilerContainerNoVersion(entry, 'mingw');
        expect(entry['runs-on']).toBe('windows-2022');
    });

    test('clang-cl sets windows-2022', () => {
        const entry = makeEntry();
        setCompilerContainerNoVersion(entry, 'clang-cl');
        expect(entry['runs-on']).toBe('windows-2022');
    });

    test('gcc does not set runs-on', () => {
        const entry = makeEntry();
        setCompilerContainerNoVersion(entry, 'gcc');
        expect(entry['runs-on']).toBeUndefined();
    });
});

describe('isArrayOfObjects', () => {
    test('array of objects returns true', () => {
        expect(isArrayOfObjects([{ a: 1 }])).toBe(true);
    });

    test('empty array returns false', () => {
        expect(isArrayOfObjects([])).toBe(false);
    });

    test('array of strings returns false', () => {
        expect(isArrayOfObjects(['a', 'b'])).toBe(false);
    });

    test('non-array returns false', () => {
        expect(isArrayOfObjects('test')).toBe(false);
    });
});

describe('setSuggestion', () => {
    test('matches by factor', () => {
        const entry = makeEntry({ compiler: 'gcc', asan: true });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' }
        ];
        const result = setSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(result).toBe(true);
        expect(entry.cxxflags).toBe('-fsanitize=address');
    });

    test('factor not present skips', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' }
        ];
        const result = setSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(result).toBe(false);
    });

    test('matches by range', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=10', value: 'ubuntu-22.04' }
        ];
        const result = setSuggestion(entry, 'runs-on', suggestions, '12');
        expect(result).toBe(true);
        expect(entry['runs-on']).toBe('ubuntu-22.04');
    });

    test('range not matching returns false', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=15', value: 'ubuntu-24.04' }
        ];
        const result = setSuggestion(entry, 'runs-on', suggestions, '12');
        expect(result).toBe(false);
    });

    test('wrong compiler skips', () => {
        const entry = makeEntry({ compiler: 'clang' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=10', value: 'ubuntu-22.04' }
        ];
        const result = setSuggestion(entry, 'runs-on', suggestions, '12');
        expect(result).toBe(false);
    });

    test('empty array returns false', () => {
        const entry = makeEntry();
        expect(setSuggestion(entry, 'runs-on', [] as any, '12')).toBe(false);
    });
});

describe('appendSuggestion', () => {
    test('appends by factor to existing value', () => {
        const entry = makeEntry({ compiler: 'gcc', asan: true, cxxflags: '-Wall' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' }
        ];
        const result = appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(result).toBe(true);
        expect(entry.cxxflags).toBe('-Wall -fsanitize=address');
    });

    test('appends by factor to empty value', () => {
        const entry = makeEntry({ compiler: 'gcc', asan: true });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' }
        ];
        appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(entry.cxxflags).toBe('-fsanitize=address');
    });

    test('appends by range to existing value', () => {
        const entry = makeEntry({ compiler: 'gcc', cxxflags: '-Wall' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=10', value: '-Wextra' }
        ];
        const result = appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(result).toBe(true);
        expect(entry.cxxflags).toBe('-Wall -Wextra');
    });

    test('appends by range to empty', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=10', value: '-Wextra' }
        ];
        appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(entry.cxxflags).toBe('-Wextra');
    });

    test('factor not present skips', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' }
        ];
        const result = appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(result).toBe(false);
    });

    test('empty array returns false', () => {
        const entry = makeEntry();
        expect(appendSuggestion(entry, 'cxxflags', [] as any, '12')).toBe(false);
    });

    test('appends both factor and range matches', () => {
        const entry = makeEntry({ compiler: 'gcc', asan: true });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: '-fsanitize=address' },
            { compiler: 'gcc', range: '>=10', value: '-Werror' }
        ];
        appendSuggestion(entry, 'cxxflags', suggestions, '12');
        expect(entry.cxxflags).toBe('-fsanitize=address -Werror');
    });
});

describe('applyForcedFactors', () => {
    test('applies factor match', () => {
        const entry = makeEntry({ compiler: 'gcc', coverage: true });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'coverage', value: 'Asan' }
        ];
        const result = applyForcedFactors(entry, suggestions, '12');
        expect(result).toBe(true);
        expect(entry.asan).toBe(true);
    });

    test('applies range match', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', range: '>=10', value: 'Ubsan' }
        ];
        const result = applyForcedFactors(entry, suggestions, '12');
        expect(result).toBe(true);
        expect(entry.ubsan).toBe(true);
    });

    test('factor not present skips to range', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'gcc', factor: 'asan', value: 'Ubsan' },
            { compiler: 'gcc', range: '>=10', value: 'Tsan' }
        ];
        const result = applyForcedFactors(entry, suggestions, '12');
        expect(result).toBe(true);
        expect(entry.tsan).toBe(true);
    });

    test('empty array returns false', () => {
        const entry = makeEntry();
        expect(applyForcedFactors(entry, [] as any, '12')).toBe(false);
    });

    test('no match returns false', () => {
        const entry = makeEntry({ compiler: 'gcc' });
        const suggestions: CompilerSuggestion[] = [
            { compiler: 'clang', range: '>=10', value: 'Asan' }
        ];
        expect(applyForcedFactors(entry, suggestions, '12')).toBe(false);
    });
});

describe('setCompilerContainer', () => {
    test('gcc >= 15 uses non-LTS where it is the default (25.10)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'gcc', semver.parse('15.0.0')!, '15');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        // GCC 15 is default on 25.10 — apt install gcc works there without PPA
        expect(entry.container).toBe('ubuntu:25.10');
    });

    test('gcc >= 14 uses ubuntu 24.04 container (available on LTS)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'gcc', semver.parse('14.0.0')!, '14');
        // GCC 14 is available on 24.04 (LTS) but not default; newest available LTS = 24.04
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('gcc >= 13 uses ubuntu 24.04 container', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'gcc', semver.parse('13.0.0')!, '13');
        // GCC 13 is default on 23.10 and 24.04; newest default is 24.04
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('gcc 12 uses ubuntu 24.04 container (newest LTS where available)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'gcc', semver.parse('12.0.0')!, '12');
        // GCC 12 is available on 22.04 and 24.04 (LTS); not default on any LTS
        // Newest available LTS = 24.04; releaseNum 24.04 > 22.04 means a container is always used
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('gcc 12 with containers uses ubuntu 24.04', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'gcc', semver.parse('12.0.0')!, '12');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('gcc 8 without containers uses ubuntu-20.04', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'gcc', semver.parse('8.0.0')!, '8');
        // GCC 8 is available on 18.04 and 20.04 (LTS); not default on any LTS
        // Newest available LTS = 20.04; releaseNum 20.04 < 22.04, useContainers false
        expect(entry['runs-on']).toBe('ubuntu-20.04');
        expect(entry.container).toBeUndefined();
    });

    test('gcc 8 with containers uses ubuntu:20.04 (no volumes, major >= 20)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'gcc', semver.parse('8.0.0')!, '8');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        // ubuntu:20.04 major is 20 (>= 20), so no volumes needed
        expect(entry.container).toBe('ubuntu:20.04');
    });

    test('gcc 6 without containers uses ubuntu-18.04', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'gcc', semver.parse('6.0.0')!, '6');
        // GCC 6 is available on 18.04 (LTS); not default on any LTS
        // releaseNum 18.04 < 22.04, useContainers false → runs-on = ubuntu-18.04
        expect(entry['runs-on']).toBe('ubuntu-18.04');
        expect(entry.container).toBeUndefined();
    });

    test('clang 17 uses ubuntu 24.04 container (newest LTS where available)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'clang', semver.parse('17.0.0')!, '17');
        // Clang 17 is available on 24.04 (LTS); not default on any LTS
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 16 uses ubuntu 24.04 container (available on LTS)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'clang', semver.parse('16.0.0')!, '16');
        // Clang 16 is available on 24.04 (LTS); not default on any LTS
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 15 always uses container (24.04 > 22.04)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'clang', semver.parse('15.0.0')!, '15');
        // Clang 15 is available on 24.04 (LTS); not default on any LTS
        // releaseNum 24.04 > 22.04 means a container is always used
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 15 with containers also uses ubuntu 24.04', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'clang', semver.parse('15.0.0')!, '15');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 14 forces container even without useContainers (libstdc++ compat)', () => {
        const entry = makeEntry();
        // Clang 14 is default on 22.04; the special clang 12-14 check forces
        // container isolation due to incompatible libstdc++ on the runner image
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'clang', semver.parse('14.0.0')!, '14');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:22.04');
    });

    test('clang 10 without containers uses ubuntu-20.04', () => {
        const entry = makeEntry();
        // Clang 10 is default on 20.04; releaseNum=20.04 < 22.04
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'clang', semver.parse('10.0.0')!, '10');
        expect(entry['runs-on']).toBe('ubuntu-20.04');
    });

    test('clang 10 with containers uses ubuntu:20.04', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'clang', semver.parse('10.0.0')!, '10');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        // ubuntu:20.04 major >= 20, no volumes
        expect(entry.container).toBe('ubuntu:20.04');
    });

    test('clang 7 available on LTS 20.04, with containers uses ubuntu:20.04', () => {
        const entry = makeEntry();
        // Clang 7 is available on 20.04 (LTS); not default on any LTS
        // releaseNum=20.04 < 22.04, useContainers=true
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'clang', semver.parse('7.0.0')!, '7');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        // ubuntu:20.04 major is 20 (>= 20), so no volumes needed
        expect(entry.container).toBe('ubuntu:20.04');
    });

    test('clang 7 without containers uses ubuntu-20.04', () => {
        const entry = makeEntry();
        // Clang 7 is available on 20.04 (LTS); not default on any LTS
        // useContainers:false → runs-on = ubuntu-20.04
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'clang', semver.parse('7.0.0')!, '7');
        expect(entry['runs-on']).toBe('ubuntu-20.04');
    });

    test('clang 14 with containers on 22.04 sets container', () => {
        const entry = makeEntry();
        // Clang 14 is default on 22.04; releaseNum=22.04, useContainers:true
        // The special clang 12-14 check requires bestRelease === '22.04' (exact),
        // but raw key is "22.04", so it falls through to releaseNum === 22.04 with useContainers
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'clang', semver.parse('14.0.0')!, '14');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:22.04');
    });

    test('gcc 16 uses newest release (not in any release)', () => {
        const entry = makeEntry();
        // GCC 16 is not in any release → falls back to newest release (25.10)
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'gcc', semver.parse('16.0.0')!, '16');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('gcc 16 with containers uses newest release', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'gcc', semver.parse('16.0.0')!, '16');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 6 uses newest release (not in any release)', () => {
        const entry = makeEntry();
        // Clang 6 is not available on any release in the data → newest release (25.10)
        setCompilerContainer(entry, makeInputs({ useContainers: false }), 'clang', semver.parse('6.0.0')!, '6');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 6 with containers uses newest release', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'clang', semver.parse('6.0.0')!, '6');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 5 uses newest release (not in any release)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'clang', semver.parse('5.0.0')!, '5');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('clang 3.5 uses newest release (not in any release)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'clang', semver.parse('3.5.0')!, '3.5');
        expect(entry['runs-on']).toBe('ubuntu-22.04');
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('msvc >= 14.42 uses windows-2025', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'msvc', semver.parse('14.42.0')!, '14.42');
        expect(entry['runs-on']).toBe('windows-2025');
    });

    test('msvc 14.29 uses data-driven runner (newest with version)', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'msvc', semver.parse('14.29.0')!, '14.29');
        // 14.29 is available on both windows-2022 and windows-2025; newest wins
        expect(entry['runs-on']).toBe('windows-2025');
    });

    test('apple-clang uses data-driven runner selection', () => {
        const entry = makeEntry();
        // Apple Clang 15 is default on macos-14
        setCompilerContainer(entry, makeInputs(), 'apple-clang', semver.parse('15.0.0')!, '15');
        expect(entry['runs-on']).toBe('macos-14');
    });

    test('mingw uses windows-2022', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'mingw', semver.parse('12.0.0')!, '12');
        expect(entry['runs-on']).toBe('windows-2022');
    });

    test('clang-cl uses windows-2022', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'clang-cl', semver.parse('16.0.0')!, '16');
        expect(entry['runs-on']).toBe('windows-2022');
    });

    test('container with object config gets overwritten by data-driven selection', () => {
        const entry = makeEntry({ container: { image: 'ubuntu:22.04' } });
        setCompilerContainer(entry, makeInputs({ useContainers: true }), 'gcc', semver.parse('12.0.0')!, '12');
        // GCC 12 is available on 24.04 (LTS, > 22.04), so data-driven selection sets container to ubuntu:24.04
        expect(entry.container).toBe('ubuntu:24.04');
    });

    test('container object with old ubuntu gets volumes added', () => {
        // Pre-existing object container with old ubuntu — the object branch of line 326
        const entry = makeEntry({ container: { image: 'ubuntu:18.04' } });
        // apple-clang doesn't overwrite container, so the pre-existing object survives
        setCompilerContainer(entry, makeInputs(), 'apple-clang', semver.parse('15.0.0')!, '15');
        expect(entry.container).toEqual({
            image: 'ubuntu:18.04',
            volumes: ['/node20217:/node20217:rw,rshared', '/node20217:/__e/node20:ro,rshared']
        });
    });
});

describe('setCompilerB2Toolset', () => {
    test('gcc sets b2-toolset to gcc', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'gcc', '12');
        expect(entry['b2-toolset']).toBe('gcc');
    });

    test('mingw sets b2-toolset to gcc', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'mingw', '12');
        expect(entry['b2-toolset']).toBe('gcc');
    });

    test('clang sets b2-toolset to clang', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'clang', '16');
        expect(entry['b2-toolset']).toBe('clang');
    });

    test('apple-clang sets b2-toolset to clang', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'apple-clang', '14');
        expect(entry['b2-toolset']).toBe('clang');
    });

    test('msvc sets b2-toolset to msvc', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'msvc', '14.29');
        expect(entry['b2-toolset']).toBe('msvc');
    });

    test('clang-cl sets b2-toolset to clang-win', () => {
        const entry = makeEntry();
        setCompilerB2Toolset(entry, makeInputs(), 'clang-cl', '16');
        expect(entry['b2-toolset']).toBe('clang-win');
    });
});

describe('runsOnLabels', () => {
    test('string runs-on returns array', () => {
        const entry = makeEntry({ 'runs-on': 'ubuntu-22.04' });
        expect(runsOnLabels(entry)).toEqual(['ubuntu-22.04']);
    });

    test('array runs-on returns lowercase', () => {
        const entry = makeEntry({ 'runs-on': ['Windows-2022', 'self-hosted'] });
        expect(runsOnLabels(entry)).toEqual(['windows-2022', 'self-hosted']);
    });

    test('no runs-on returns empty', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        expect(runsOnLabels(entry)).toEqual([]);
    });

    test('filters non-string labels', () => {
        const entry = makeEntry({ 'runs-on': [42, 'ubuntu-22.04'] as any });
        expect(runsOnLabels(entry)).toEqual(['ubuntu-22.04']);
    });
});

describe('inferVisualStudioGeneratorFromRunsOn', () => {
    test('windows-2022 returns VS 17 2022', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2022' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBe('Visual Studio 17 2022');
    });

    test('windows-2025 returns VS 17 2022', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2025' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBe('Visual Studio 17 2022');
    });

    test('windows-2019 returns VS 16 2019', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2019' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBe('Visual Studio 16 2019');
    });

    test('windows-2016 returns VS 15 2017', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2016' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBe('Visual Studio 15 2017');
    });

    test('windows-2017 returns VS 15 2017', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2017' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBe('Visual Studio 15 2017');
    });

    test('ubuntu returns null', () => {
        const entry = makeEntry({ 'runs-on': 'ubuntu-22.04' });
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBeNull();
    });

    test('no runs-on returns null', () => {
        const entry = makeEntry();
        expect(inferVisualStudioGeneratorFromRunsOn(entry)).toBeNull();
    });
});

describe('setCompilerCMakeGenerator', () => {
    test('msvc with windows-2022 runs-on uses VS 17', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2022' });
        const v = semver.parse('14.29.30133')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.29');
        expect(entry.generator).toBe('Visual Studio 17 2022');
    });

    test('msvc 14.29 on windows-2025 uses runner VS (compat toolset)', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2025' });
        const v = semver.parse('14.29.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.29');
        expect(entry.generator).toBe('Visual Studio 17 2022');
    });

    test('msvc 14.50 on windows-2025 overrides to VS 18 2026', () => {
        const entry = makeEntry({ 'runs-on': 'windows-2025' });
        const v = semver.parse('14.50.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.50');
        expect(entry.generator).toBe('Visual Studio 18 2026');
    });

    test('msvc with no runs-on uses year-based generator for 2022', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('14.30.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.30');
        expect(entry.generator).toBe('Visual Studio 17 2022');
    });

    test('msvc with 2019 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('14.20.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.20');
        expect(entry.generator).toBe('Visual Studio 16 2019');
    });

    test('msvc with 2017 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('14.1.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.1');
        expect(entry.generator).toBe('Visual Studio 15 2017');
    });

    test('msvc with 2015 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('14.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '14.0');
        expect(entry.generator).toBe('Visual Studio 14 2015');
    });

    test('msvc with 2013 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('12.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '12');
        expect(entry.generator).toBe('Visual Studio 12 2013');
    });

    test('msvc with 2012 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('11.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '11');
        expect(entry.generator).toBe('Visual Studio 11 2012');
    });

    test('msvc with 2010 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('10.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '10');
        expect(entry.generator).toBe('Visual Studio 10 2010');
    });

    test('msvc with 2008 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('9.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '9');
        expect(entry.generator).toBe('Visual Studio 9 2008');
    });

    test('msvc with 2005 version', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const v = semver.parse('8.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', v, v, '8');
        expect(entry.generator).toBe('Visual Studio 8 2005');
    });

    test('msvc with different min/max years does not set generator', () => {
        const entry = makeEntry();
        delete entry['runs-on'];
        const min = semver.parse('14.0.0')!;
        const max = semver.parse('14.30.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'msvc', min, max, '14');
        expect(entry.generator).toBeUndefined();
    });

    test('mingw sets MinGW Makefiles', () => {
        const entry = makeEntry();
        const v = semver.parse('12.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'mingw', v, v, '12');
        expect(entry.generator).toBe('MinGW Makefiles');
    });

    test('clang-cl sets ClangCL toolset', () => {
        const entry = makeEntry();
        const v = semver.parse('16.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'clang-cl', v, v, '16');
        expect(entry['generator-toolset']).toBe('ClangCL');
    });

    test('gcc does not set generator', () => {
        const entry = makeEntry();
        const v = semver.parse('12.0.0')!;
        setCompilerCMakeGenerator(entry, makeInputs(), 'gcc', v, v, '12');
        expect(entry.generator).toBeUndefined();
    });
});

describe('setEntryVersionFlags', () => {
    test('latest entry in list', () => {
        const entry = makeEntry({ major: 12, minor: 0, patch: 0 });
        setEntryVersionFlags(entry, 2, ['10', '11', '12'], semver.parse('12.0.0')!, semver.parse('12.0.0')!);
        expect(entry['is-latest']).toBe(true);
        expect(entry['is-main']).toBe(true);
        expect(entry['is-earliest']).toBe(false);
        expect(entry['is-intermediary']).toBe(false);
    });

    test('earliest entry in list', () => {
        const entry = makeEntry({ major: 10, minor: 0, patch: 0 });
        setEntryVersionFlags(entry, 0, ['10', '11', '12'], semver.parse('10.0.0')!, semver.parse('10.0.0')!);
        expect(entry['is-latest']).toBe(false);
        expect(entry['is-earliest']).toBe(true);
        expect(entry['is-intermediary']).toBe(false);
    });

    test('intermediary entry', () => {
        const entry = makeEntry({ major: 11, minor: 0, patch: 0 });
        setEntryVersionFlags(entry, 1, ['10', '11', '12'], semver.parse('11.0.0')!, semver.parse('11.0.0')!);
        expect(entry['is-intermediary']).toBe(true);
    });

    test('wildcard major sets system-version policy', () => {
        const entry = makeEntry({ major: '*' });
        setEntryVersionFlags(entry, 0, ['*'], null, null);
        expect(entry['subrange-policy']).toBe('system-version');
        expect(entry['has-major']).toBe(false);
    });

    test('single subrange sets one-per-major', () => {
        const entry = makeEntry({ major: 12, minor: 0, patch: 0 });
        setEntryVersionFlags(entry, 0, ['12'], semver.parse('12.0.0')!, semver.parse('12.0.0')!);
        expect(entry['subrange-policy']).toBe('one-per-major');
    });

    test('different major in min/max sets one-per-major', () => {
        const entry = makeEntry({ major: 10, minor: '*', patch: '*' });
        setEntryVersionFlags(entry, 0, ['10', '12'], semver.parse('10.0.0')!, semver.parse('12.0.0')!);
        expect(entry['subrange-policy']).toBe('one-per-major');
    });

    test('same major sets one-per-minor', () => {
        const entry = makeEntry({ major: 14, minor: '*', patch: '*' });
        setEntryVersionFlags(entry, 0, ['14.29', '14.30'], semver.parse('14.29.0')!, semver.parse('14.30.0')!);
        expect(entry['subrange-policy']).toBe('one-per-minor');
    });

    test('null versions with has-major true sets one-per-major', () => {
        const entry = makeEntry({ major: 12 });
        setEntryVersionFlags(entry, 0, ['12', '13'], null, null);
        expect(entry['subrange-policy']).toBe('one-per-major');
    });
});

describe('setEntryName', () => {
    test('compiler only', () => {
        const entry = makeEntry();
        setEntryName(entry, 'gcc', '*', []);
        expect(entry.name).toBe('GCC');
    });

    test('compiler with version', () => {
        const entry = makeEntry();
        setEntryName(entry, 'gcc', '12', []);
        expect(entry.name).toBe('GCC 12');
    });

    test('compiler with version and single cxx', () => {
        const entry = makeEntry();
        setEntryName(entry, 'clang', '16', ['20']);
        expect(entry.name).toBe('Clang 16: C++20');
    });

    test('compiler with version and multiple cxx', () => {
        const entry = makeEntry();
        setEntryName(entry, 'msvc', '14.29', ['14', '17', '20']);
        expect(entry.name).toBe('MSVC 14.29: C++14-20');
    });
});

// Tests for findBestUbuntuRelease auto-select logic.
// Uses real ubuntu-compiler-defaults.json data, but only LTS releases are considered.
// LTS releases: 16.04, 18.04, 20.04, 22.04, 24.04
// Note: some releases have point versions in their keys (e.g. "16.04", "18.04",
// "20.04", "22.04", "24.04"), and findBestUbuntuRelease returns the raw key.
//   GCC defaults (LTS only): 5(16.04), 7(18.04), 9(20.04), 11(22.04), 13(24.04)
//   GCC available (LTS only): 5,6,7,8(18.04), 7,8,9,10(20.04),
//                              9,10,11,12(22.04), 9,10,11,12,13,14(24.04)
//   Unique GCC available: [5,6,7,8,9,10,11,12,13,14]
//   Clang defaults (LTS only): 10(20.04), 14(22.04), 18(24.04)
//   Clang available (LTS only): 7,8,9,10(20.04), 11,12,13,14(22.04),
//                                14,15,16,17,18(24.04)
//   Unique Clang available: [7,8,9,10,11,12,13,14,15,16,17,18]

describe('findBestUbuntuRelease', () => {
    test('returns release where GCC version is the default', () => {
        // GCC 11 is the default on 21.10 and 22.04; newest default is 22.04
        expect(findBestUbuntuRelease('gcc', 11)).toBe('22.04');
    });

    test('returns release where GCC version is the default (24.04)', () => {
        // GCC 13 is the default on 23.10 and 24.04; newest default is 24.04
        expect(findBestUbuntuRelease('gcc', 13)).toBe('24.04');
    });

    test('returns newest LTS where version is available (not default on any LTS)', () => {
        // GCC 14 is available on 24.04 (LTS) but not default there (13 is default)
        // Not default on any LTS → returns newest available LTS = 24.04
        expect(findBestUbuntuRelease('gcc', 14)).toBe('24.04');
    });

    test('returns newest LTS where version is available when not default on any LTS', () => {
        // GCC 10 is available on 20.04, 22.04, 24.04 (LTS) but not default on any
        // Newest available LTS = 24.04
        expect(findBestUbuntuRelease('gcc', 10)).toBe('24.04');
    });

    test('returns newest available LTS for non-default version', () => {
        // GCC 12 is available on 22.04 and 24.04 (LTS) but not default on any
        // Newest available LTS = 24.04
        expect(findBestUbuntuRelease('gcc', 12)).toBe('24.04');
    });

    test('returns newest LTS when no LTS has the version', () => {
        // GCC 99 is not in any LTS → falls back to newest LTS (24.04)
        expect(findBestUbuntuRelease('gcc', 99)).toBe('24.04');
    });

    test('works with clang', () => {
        // Clang 14 is default on 22.04
        expect(findBestUbuntuRelease('clang', 14)).toBe('22.04');
    });

    test('clang version available in multiple releases prefers default', () => {
        // Clang 18 is default on 24.04, available (non-default) on 24.10, 25.04, 25.10
        expect(findBestUbuntuRelease('clang', 18)).toBe('24.04');
    });

    test('clang version available on LTS but not default on any LTS', () => {
        // Clang 16 is available on 24.04 (LTS) but not default (18 is default)
        // Not default on any LTS → returns newest available LTS = 24.04
        expect(findBestUbuntuRelease('clang', 16)).toBe('24.04');
    });

    test('returns newest LTS for non-gcc/clang compilers', () => {
        expect(findBestUbuntuRelease('msvc', 14)).toBe('24.04');
        expect(findBestUbuntuRelease('apple-clang', 14)).toBe('24.04');
        expect(findBestUbuntuRelease('mingw', 12)).toBe('24.04');
    });

    test('returns newest LTS for unknown compiler', () => {
        expect(findBestUbuntuRelease('unknown', 11)).toBe('24.04');
    });

    test('newest default release wins when multiple have it as default', () => {
        // GCC 9 is default on 19.10 and 20.04; newest default is 20.04
        expect(findBestUbuntuRelease('gcc', 9)).toBe('20.04');
    });
});

// Tests for findBestMacOSRunner / findNewestMacOSRunner auto-select logic.
// Uses real macos-xcode-defaults.json data:
//   macos-14: Apple Clang 15 (default via Xcode 15.4), 16 (Xcode 16.0)
//   macos-15: Apple Clang 16 (default via Xcode 16.2), 17 (Xcode 16.3)
describe('findBestMacOSRunner', () => {
    test('Apple Clang 15 selects macos-14 (default Xcode)', () => {
        // Apple Clang 15 is_default on macos-14 (Xcode 15.4)
        expect(findBestMacOSRunner(15)).toBe('macos-14');
    });

    test('Apple Clang 16 selects macos-15 (default Xcode on newest runner)', () => {
        // Apple Clang 16 is available on both macos-14 and macos-15
        // It is_default on macos-15 (Xcode 16.2), so macos-15 wins
        expect(findBestMacOSRunner(16)).toBe('macos-15');
    });

    test('Apple Clang 17 selects macos-15 (only runner with it)', () => {
        // Apple Clang 17 is only available on macos-15 (Xcode 16.3, not default)
        expect(findBestMacOSRunner(17)).toBe('macos-15');
    });

    test('unknown version falls back to newest runner', () => {
        // Apple Clang 99 is not in any runner → newest runner = macos-15
        expect(findBestMacOSRunner(99)).toBe('macos-15');
    });

    test('setCompilerContainer routes apple-clang 16 to macos-15', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'apple-clang', semver.parse('16.0.0')!, '16');
        expect(entry['runs-on']).toBe('macos-15');
    });

    test('setCompilerContainer routes apple-clang 17 to macos-15', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'apple-clang', semver.parse('17.0.0')!, '17');
        expect(entry['runs-on']).toBe('macos-15');
    });
});

describe('findNewestMacOSRunner', () => {
    test('returns newest runner from data', () => {
        expect(findNewestMacOSRunner()).toBe('macos-15');
    });
});

// Tests for findBestWindowsRunner auto-select logic.
// Uses real windows-msvc-defaults.json data:
//   windows-2022: MSVC 14.44 (default), 14.29
//   windows-2025: MSVC 14.50, 14.44 (default), 14.29
describe('findBestWindowsRunner', () => {
    test('MSVC 14.44 selects windows-2025 (default on newest runner)', () => {
        // 14.44 is_default on both windows-2022 and windows-2025
        // windows-2025 is newer, so it wins
        expect(findBestWindowsRunner(44)).toBe('windows-2025');
    });

    test('MSVC 14.29 selects windows-2025 (newest runner with it)', () => {
        // 14.29 is available on both runners but not default on either
        // Newest runner (windows-2025) wins
        expect(findBestWindowsRunner(29)).toBe('windows-2025');
    });

    test('MSVC 14.50 selects windows-2025 (only runner with it)', () => {
        // 14.50 is only on windows-2025
        expect(findBestWindowsRunner(50)).toBe('windows-2025');
    });

    test('unknown version falls back to newest runner', () => {
        // MSVC 14.99 is not in any runner → newest runner = windows-2025
        expect(findBestWindowsRunner(99)).toBe('windows-2025');
    });

    test('setCompilerContainer routes msvc 14.44 to windows-2025', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'msvc', semver.parse('14.44.0')!, '14.44');
        expect(entry['runs-on']).toBe('windows-2025');
    });

    test('setCompilerContainer routes msvc 14.29 to windows-2025', () => {
        const entry = makeEntry();
        setCompilerContainer(entry, makeInputs(), 'msvc', semver.parse('14.29.0')!, '14.29');
        expect(entry['runs-on']).toBe('windows-2025');
    });
});
