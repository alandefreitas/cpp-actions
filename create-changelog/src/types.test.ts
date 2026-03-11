import { parseSortByOption } from './types';

describe('parseSortByOption', () => {
    it('should parse valid sort options', () => {
        expect(parseSortByOption('most-changes-first')).toBe('most-changes-first');
        expect(parseSortByOption('latest-first')).toBe('latest-first');
        expect(parseSortByOption('oldest-first')).toBe('oldest-first');
    });

    it('should handle case insensitivity', () => {
        expect(parseSortByOption('LATEST-FIRST')).toBe('latest-first');
        expect(parseSortByOption('MOST-CHANGES-FIRST')).toBe('most-changes-first');
    });

    it('should default to most-changes-first for invalid values', () => {
        expect(parseSortByOption('invalid')).toBe('most-changes-first');
        expect(parseSortByOption('')).toBe('most-changes-first');
        expect(parseSortByOption('  ')).toBe('most-changes-first');
    });
});
