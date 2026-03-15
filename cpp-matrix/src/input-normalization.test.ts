jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import { normalizeCompilerNameKeys, normalizeCompilerNameSuggestions, parseKeyValues } from './input-normalization';

describe('normalizeCompilerNameKeys', () => {
    it('normalizes non-canonical compiler name keys', () => {
        const obj: Record<string, unknown> = { 'g++': '>=10', clang: '>=14' };
        normalizeCompilerNameKeys(obj);
        expect(obj).toHaveProperty('gcc');
        expect(obj).not.toHaveProperty('g++');
        expect(obj).toHaveProperty('clang');
    });

    it('leaves canonical names unchanged', () => {
        const obj: Record<string, unknown> = { gcc: '>=10', clang: '>=14', msvc: '>=19' };
        normalizeCompilerNameKeys(obj);
        expect(obj).toEqual({ gcc: '>=10', clang: '>=14', msvc: '>=19' });
    });

    it('handles empty object', () => {
        const obj: Record<string, unknown> = {};
        normalizeCompilerNameKeys(obj);
        expect(obj).toEqual({});
    });

    it('preserves values during normalization', () => {
        const obj: Record<string, unknown> = { 'g++': [1, 2, 3] };
        normalizeCompilerNameKeys(obj);
        expect(obj['gcc']).toEqual([1, 2, 3]);
    });
});

describe('normalizeCompilerNameSuggestions', () => {
    it('normalizes compiler names in suggestions', () => {
        const suggestions = [
            { compiler: 'g++', value: '-Wall' },
            { compiler: 'clang++', value: '-Wextra' }
        ];
        normalizeCompilerNameSuggestions(suggestions);
        expect(suggestions[0].compiler).toBe('gcc');
        expect(suggestions[1].compiler).toBe('clang');
    });

    it('leaves canonical names unchanged', () => {
        const suggestions = [
            { compiler: 'gcc', value: '-O2' },
            { compiler: 'msvc', value: '/W4' }
        ];
        normalizeCompilerNameSuggestions(suggestions);
        expect(suggestions[0].compiler).toBe('gcc');
        expect(suggestions[1].compiler).toBe('msvc');
    });

    it('handles empty array', () => {
        const suggestions: { compiler: string; value: string }[] = [];
        normalizeCompilerNameSuggestions(suggestions);
        expect(suggestions).toEqual([]);
    });
});

describe('parseKeyValues', () => {
    it('parses key-value pairs from lines', () => {
        const result = parseKeyValues(['name: value', 'key: data']);
        expect(result).toEqual([
            { key: 'name', value: 'value' },
            { key: 'key', value: 'data' }
        ]);
    });

    it('returns undefined for empty array', () => {
        expect(parseKeyValues([])).toBeUndefined();
    });

    it('returns undefined when no valid pairs found', () => {
        expect(parseKeyValues(['no colon here', 'also none'])).toBeUndefined();
    });

    it('skips lines without colons', () => {
        const result = parseKeyValues(['valid: pair', 'no colon']);
        expect(result).toEqual([{ key: 'valid', value: 'pair' }]);
    });

    it('handles colon at start of line (empty key)', () => {
        // colonIndex === 0, so this line is skipped
        const result = parseKeyValues([': value']);
        expect(result).toBeUndefined();
    });

    it('trims whitespace from keys and values', () => {
        const result = parseKeyValues(['  key  :  value  ']);
        expect(result).toEqual([{ key: 'key', value: 'value' }]);
    });

    it('handles multiple colons (uses first colon)', () => {
        const result = parseKeyValues(['key: value: extra']);
        expect(result).toEqual([{ key: 'key', value: 'value: extra' }]);
    });

    it('handles empty value after colon', () => {
        const result = parseKeyValues(['key:']);
        expect(result).toEqual([{ key: 'key', value: '' }]);
    });
});
