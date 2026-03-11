/**
 * Stack collapsing for Chrome trace data.
 *
 * Converts Chrome trace events into a collapsed stack format suitable
 * for flame graph generation.
 *
 * @module stack-collapse
 */

import * as traceCommands from 'trace-commands';

import { type Trace } from './types';

/**
 * Represents a trace event with timing information.
 */
export class Event {
    label: string;
    timestamp: number;
    duration: number;
    totalDuration: number;

    constructor(label: string, timestamp: number, dur: number) {
        this.label = label;
        this.timestamp = timestamp;
        this.duration = dur;
        this.totalDuration = dur;
    }

    /**
     * Gets the stop timestamp for this event.
     *
     * @returns End timestamp (start + duration)
     */
    getStopTimestamp(): number {
        return this.timestamp + this.duration;
    }
}

/**
 * Combines two numbers into a unique number using Cantor pairing.
 *
 * @param a - First number
 * @param b - Second number
 * @returns Unique combined value
 */
function cantorPairing(a: number, b: number): number {
    const s = a + b;
    return s * (s + 1) / 2 + b;
}

/**
 * Gets the trace events from the combined trace object.
 *
 * @param combinedTrace - Combined trace data
 * @param eventsDict - Dictionary to populate with events
 */
function getTraceEvents(combinedTrace: Trace, eventsDict: Record<string, Event[]>): void {
    const fnlog = traceCommands.scoped('getTraceEvents');
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Get ${combinedTrace.traceEvents.length} trace events as {Event}`);

    for (const entry of combinedTrace.traceEvents) {
        if (entry.ph === 'X') {
            const cantorVal = String(cantorPairing(entry.tid || 0, entry.pid || 0));
            if (!entry.dur) continue;
            if (!eventsDict[cantorVal]) eventsDict[cantorVal] = [];
            eventsDict[cantorVal].push(new Event(entry.name, parseFloat(String(entry.ts)), parseFloat(String(entry.dur))));
        }
    }
}

/**
 * Loads events from the combined trace.
 *
 * @param combinedTrace - Combined trace data
 * @returns Dictionary mapping cantor values to event arrays
 */
function loadEvents(combinedTrace: Trace): Record<string, Event[]> {
    const fnlog = traceCommands.scoped('loadEvents');

    fnlog(`Load events from combined trace`);
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    const events: Record<string, Event[]> = {};
    getTraceEvents(combinedTrace, events);
    for (const cantorVal in events) {
        events[cantorVal].sort((a, b) => a.timestamp - b.timestamp);
    }
    return events;
}

/**
 * A Map implementation that uses arrays as keys, comparing by value equality.
 *
 * Standard JavaScript Maps compare object keys by reference. This class provides
 * value-based comparison for string array keys, useful for tracking call stacks.
 */
export class ArrayMap {
    private map: Map<string[], number>;

    constructor() {
        this.map = new Map();
    }

    /**
     * Compares two string arrays for value equality.
     *
     * @param arr1 - First array to compare
     * @param arr2 - Second array to compare
     * @returns True if arrays have identical elements in the same order
     */
    private arraysEqual(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) return false;
        return arr1.every((value, index) => value === arr2[index]);
    }

    /**
     * Sets a value for the given array key.
     *
     * @param keyArray - Array key to set
     * @param value - Numeric value to associate with the key
     */
    set(keyArray: string[], value: number): void {
        for (const [key] of this.map) {
            if (this.arraysEqual(key, keyArray)) {
                this.map.set(key, value);
                return;
            }
        }
        this.map.set(keyArray, value);
    }

    /**
     * Gets the value associated with the given array key.
     *
     * @param keyArray - Array key to look up
     * @returns The associated value, or undefined if not found
     */
    get(keyArray: string[]): number | undefined {
        for (const [key] of this.map) {
            if (this.arraysEqual(key, keyArray)) {
                return this.map.get(key);
            }
        }
        return undefined;
    }

    /**
     * Checks if an array key exists in the map.
     *
     * @param keyArray - Array key to check
     * @returns True if the key exists in the map
     */
    has(keyArray: string[]): boolean {
        for (const key of this.map.keys()) {
            if (this.arraysEqual(key, keyArray)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns an iterator over key-value pairs.
     *
     * @returns Iterator yielding [key, value] tuples
     */
    [Symbol.iterator](): IterableIterator<[string[], number]> {
        return this.map[Symbol.iterator]();
    }

    /**
     * Returns an iterator over key-value pairs.
     *
     * @returns Iterator yielding [key, value] tuples
     */
    entries(): IterableIterator<[string[], number]> {
        return this.map.entries();
    }

    /**
     * Returns an iterator over the keys.
     *
     * @returns Iterator yielding array keys
     */
    keys(): IterableIterator<string[]> {
        return this.map.keys();
    }

    /**
     * Returns an iterator over the values.
     *
     * @returns Iterator yielding numeric values
     */
    values(): IterableIterator<number> {
        return this.map.values();
    }

    /**
     * Removes all entries from the map.
     */
    clear(): void {
        this.map.clear();
    }

    // Optional: Get the size of the map
    get size(): number {
        return this.map.size;
    }
}

/**
 * Saves a stack to the stack identifiers map.
 *
 * @param stack - Array of events representing the call stack
 * @param stackIdentifiers - Map to store stack durations
 */
function saveStack(stack: Event[], stackIdentifiers: ArrayMap): void {
    let event: Event | null = null;
    const identifiers: string[] = [];

    for (event of stack) {
        identifiers.push(event.label);
    }

    const existingDuration = stackIdentifiers.has(identifiers) ? stackIdentifiers.get(identifiers)! : 0;
    stackIdentifiers.set(identifiers, existingDuration + event!.totalDuration);
}

/**
 * Loads stack identifiers from the events.
 *
 * @param events - Array of events to process
 * @param stackIdentifiers - Map to populate with stack durations
 */
function loadStackIdentifiers(events: Event[], stackIdentifiers: ArrayMap): void {
    const eventStack: Event[] = [];

    for (const e of events) {
        if (!eventStack.length) {
            eventStack.push(e);
        } else {
            while (eventStack.length && eventStack[eventStack.length - 1].getStopTimestamp() <= e.timestamp) {
                saveStack(eventStack, stackIdentifiers);
                eventStack.pop();
            }

            if (eventStack.length) {
                eventStack[eventStack.length - 1].totalDuration -= e.duration;
            }

            eventStack.push(e);
        }
    }

    while (eventStack.length) {
        saveStack(eventStack, stackIdentifiers);
        eventStack.pop();
    }
}

/**
 * Generates a stack-collapsed representation from Chrome trace data.
 *
 * @param combinedTrace - Combined trace data to process
 * @returns Map of call stacks to their total durations
 */
export function stackCollapseChromeTracing(combinedTrace: Trace): ArrayMap {
    // Adapted from https://github.com/brendangregg/FlameGraph/blob/master/stackcollapse-chrome-tracing.py
    const fnlog = traceCommands.scoped('stackCollapseChromeTracing');

    fnlog(`Generate stack collapse from combined trace`);
    fnlog(`combinedTrace: ${combinedTrace}`);
    fnlog(`Combined trace has ${combinedTrace.traceEvents.length} trace events`);

    const stackIdentifiers = new ArrayMap();
    const allEvents = loadEvents(combinedTrace);
    for (const tidPidCantor in allEvents) {
        loadStackIdentifiers(allEvents[tidPidCantor], stackIdentifiers);
    }
    return stackIdentifiers;
}
