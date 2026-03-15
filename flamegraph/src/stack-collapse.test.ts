jest.mock('trace-commands', () => ({
    log: jest.fn(),
    scoped: jest.fn(() => jest.fn()),
    setTraceCommands: jest.fn()
}));

import { ArrayMap, Event, stackCollapseChromeTracing } from './stack-collapse';
import type { Trace } from './types';

describe('ArrayMap', () => {
    let map: ArrayMap;

    beforeEach(() => {
        map = new ArrayMap();
    });

    test('get returns undefined for non-existent key', () => {
        expect(map.get(['nonexistent'])).toBeUndefined();
    });

    test('has returns false for non-existent key', () => {
        expect(map.has(['nonexistent'])).toBe(false);
    });

    test('set and get with array key', () => {
        map.set(['a', 'b'], 42);
        expect(map.get(['a', 'b'])).toBe(42);
        expect(map.has(['a', 'b'])).toBe(true);
    });

    test('set overwrites existing key', () => {
        map.set(['a'], 1);
        map.set(['a'], 2);
        expect(map.get(['a'])).toBe(2);
        expect(map.size).toBe(1);
    });

    test('entries returns iterator of key-value pairs', () => {
        map.set(['x'], 10);
        map.set(['y'], 20);
        const entries = [...map.entries()];
        expect(entries).toHaveLength(2);
        expect(entries).toEqual(expect.arrayContaining([
            [['x'], 10],
            [['y'], 20]
        ]));
    });

    test('keys returns iterator of keys', () => {
        map.set(['a', 'b'], 1);
        map.set(['c'], 2);
        const keys = [...map.keys()];
        expect(keys).toHaveLength(2);
    });

    test('values returns iterator of values', () => {
        map.set(['a'], 10);
        map.set(['b'], 20);
        const values = [...map.values()];
        expect(values).toEqual(expect.arrayContaining([10, 20]));
    });

    test('clear removes all entries', () => {
        map.set(['a'], 1);
        map.set(['b'], 2);
        expect(map.size).toBe(2);
        map.clear();
        expect(map.size).toBe(0);
        expect(map.has(['a'])).toBe(false);
    });

    test('size returns number of entries', () => {
        expect(map.size).toBe(0);
        map.set(['a'], 1);
        expect(map.size).toBe(1);
    });

    test('Symbol.iterator works', () => {
        map.set(['x'], 100);
        const items = [...map];
        expect(items).toEqual([[['x'], 100]]);
    });
});

describe('Event', () => {
    test('getStopTimestamp returns start + duration', () => {
        const e = new Event('test', 100, 50);
        expect(e.getStopTimestamp()).toBe(150);
    });

    test('totalDuration equals duration initially', () => {
        const e = new Event('test', 0, 200);
        expect(e.totalDuration).toBe(200);
    });
});

describe('stackCollapseChromeTracing', () => {
    test('handles trace with nested events', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'outer', ph: 'X', ts: 0, dur: 100, pid: 0, tid: 0 },
                { name: 'inner', ph: 'X', ts: 10, dur: 30, pid: 0, tid: 0 },
                { name: 'inner2', ph: 'X', ts: 50, dur: 20, pid: 0, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBeGreaterThan(0);
    });

    test('handles trace with sequential non-overlapping events', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'first', ph: 'X', ts: 0, dur: 50, pid: 0, tid: 0 },
                { name: 'second', ph: 'X', ts: 100, dur: 50, pid: 0, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBe(2);
    });

    test('handles trace with deeply nested events to cover loadStackIdentifiers', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'root', ph: 'X', ts: 0, dur: 1000, pid: 0, tid: 0 },
                { name: 'child1', ph: 'X', ts: 10, dur: 200, pid: 0, tid: 0 },
                { name: 'grandchild', ph: 'X', ts: 20, dur: 50, pid: 0, tid: 0 },
                { name: 'child2', ph: 'X', ts: 300, dur: 200, pid: 0, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBeGreaterThan(0);
        // Verify stacks were properly collapsed
        let foundNested = false;
        for (const [key] of result) {
            if (key.length >= 3) {
                foundNested = true;
            }
        }
        expect(foundNested).toBe(true);
    });

    test('skips events without duration', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'valid', ph: 'X', ts: 0, dur: 100, pid: 0, tid: 0 },
                { name: 'no-dur', ph: 'X', ts: 50, pid: 0, tid: 0 },
                { name: 'metadata', ph: 'M', ts: 0, pid: 0, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBe(1);
    });

    test('handles multiple pid/tid combinations', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'thread0', ph: 'X', ts: 0, dur: 100, pid: 0, tid: 0 },
                { name: 'thread1', ph: 'X', ts: 0, dur: 100, pid: 1, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBe(2);
    });

    test('handles empty trace', () => {
        const trace: Trace = { traceEvents: [] };
        const result = stackCollapseChromeTracing(trace);
        expect(result.size).toBe(0);
    });

    test('accumulates duration for identical stacks', () => {
        const trace: Trace = {
            traceEvents: [
                { name: 'func', ph: 'X', ts: 0, dur: 100, pid: 0, tid: 0 },
                { name: 'func', ph: 'X', ts: 200, dur: 100, pid: 0, tid: 0 }
            ]
        };
        const result = stackCollapseChromeTracing(trace);
        // Both events have the same label, so durations should accumulate
        const val = result.get(['func']);
        expect(val).toBe(200);
    });
});
