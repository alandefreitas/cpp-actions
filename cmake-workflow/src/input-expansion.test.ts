import * as gh_inputs from 'gh-inputs';
import { normalizePath, sanitizeKey, generateFactorSuffix } from './input-expansion';

describe('parseBashArguments (used by parseExtraArgs)', () => {
    it('splits quoted arguments correctly', () => {
        expect(gh_inputs.parseBashArguments(['-D BOOST_SRC_DIR="/__t/boost/master"'])).toEqual(['-D', 'BOOST_SRC_DIR=/__t/boost/master']);
    });
});

describe('normalizePath', () => {
    it('returns path unchanged on non-Windows', () => {
        if (process.platform !== 'win32') {
            expect(normalizePath('/usr/local/bin')).toBe('/usr/local/bin');
        }
    });

    it('is defined and callable', () => {
        expect(typeof normalizePath).toBe('function');
    });
});

describe('sanitizeKey', () => {
    it('replaces invalid characters with underscores', () => {
        expect(sanitizeKey('foo bar/baz')).toBe('foo_bar_baz');
    });

    it('collapses consecutive underscores', () => {
        expect(sanitizeKey('foo///bar')).toBe('foo_bar');
    });

    it('trims leading and trailing underscores', () => {
        expect(sanitizeKey('!hello!')).toBe('hello');
    });

    it('preserves valid characters', () => {
        expect(sanitizeKey('foo-bar_baz123')).toBe('foo-bar_baz123');
    });
});

describe('generateFactorSuffix', () => {
    it('returns empty string for main entry', () => {
        expect(generateFactorSuffix(undefined, '20', '20', true)).toBe('');
    });

    it('returns cxxstd suffix when not main standard', () => {
        expect(generateFactorSuffix(undefined, '23', '20', true)).toBe('-cxx23');
    });

    it('returns extraArgs key suffix for non-first key', () => {
        expect(generateFactorSuffix('asan', '20', '20', false)).toBe('-asan');
    });

    it('combines extraArgs key and cxxstd suffixes', () => {
        expect(generateFactorSuffix('asan', '23', '20', false)).toBe('-asan-cxx23');
    });

    it('returns empty string when extraArgs key is first and cxxstd matches main', () => {
        expect(generateFactorSuffix('default', '20', '20', true)).toBe('');
    });
});
