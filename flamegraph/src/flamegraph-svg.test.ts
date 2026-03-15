jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import { generateFlameGraph, ArrayMap } from './flamegraph-svg';

describe('generateFlameGraph', () => {
    test('returns error SVG when given empty input (time === 0)', () => {
        const empty = new ArrayMap();
        const svg = generateFlameGraph(empty);
        expect(svg).toContain('ERROR: No valid input provided.');
        expect(svg).toContain('<svg');
    });

    test('handles low sample count (time < 100)', () => {
        const map = new ArrayMap();
        map.set(['funcA'], 50);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('<svg');
        // Should still generate valid SVG
        expect(svg).toContain('Flame Graph');
    });

    test('handles stacks with -- separator function name', () => {
        const map = new ArrayMap();
        map.set(['--'], 500);
        map.set(['funcB'], 500);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('<svg');
    });

    test('handles stacks with - separator function name', () => {
        const map = new ArrayMap();
        map.set(['-'], 500);
        map.set(['funcC'], 500);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('<svg');
    });

    test('ignores entries with zero or negative duration', () => {
        const map = new ArrayMap();
        map.set(['ignored'], 0);
        map.set(['also_ignored'], -10);
        const svg = generateFlameGraph(map);
        // Both entries ignored, time stays 0 → error SVG
        expect(svg).toContain('ERROR: No valid input provided.');
    });

    test('generates valid SVG with multiple stacks', () => {
        const map = new ArrayMap();
        map.set(['main', 'parseFile'], 300);
        map.set(['main', 'compile'], 500);
        map.set(['main', 'link'], 200);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('<svg');
        expect(svg).toContain('Flame Graph');
        expect(svg).toContain('frames');
    });

    test('HTML-escapes function names with special characters', () => {
        const map = new ArrayMap();
        map.set(['std::vector<int>&'], 500);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('&amp;');
        expect(svg).toContain('&lt;');
        expect(svg).toContain('&gt;');
    });

    test('handles stacks with _[k] suffix (kernel annotations)', () => {
        const map = new ArrayMap();
        map.set(['syscall_[k]'], 500);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('<svg');
        // The _[k] suffix should be stripped in the info text
        expect(svg).toContain('syscall');
    });

    test('generates frames group in SVG output', () => {
        const map = new ArrayMap();
        map.set(['funcA', 'funcB'], 1000);
        const svg = generateFlameGraph(map);
        expect(svg).toContain('id="frames"');
    });
});
