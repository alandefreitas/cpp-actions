/**
 * SVG flame graph generation for flamegraph action.
 *
 * Provides classes and functions for generating interactive SVG flame graphs
 * from Chrome trace data.
 *
 * @module flamegraph-svg
 */

import * as trace_commands from 'trace-commands';

import { Trace } from './types';

/**
 * Represents a trace event with timing information.
 */
export class Event {
    label: string;
    timestamp: number;
    duration: number;
    total_duration: number;

    constructor(label: string, timestamp: number, dur: number) {
        this.label = label;
        this.timestamp = timestamp;
        this.duration = dur;
        this.total_duration = dur;
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
    const fnlog = trace_commands.scoped('getTraceEvents');
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
    const fnlog = trace_commands.scoped('loadEvents');

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
    stackIdentifiers.set(identifiers, existingDuration + event!.total_duration);
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
                eventStack[eventStack.length - 1].total_duration -= e.duration;
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
    const fnlog = trace_commands.scoped('stackCollapseChromeTracing');

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

/**
 * Helper class for building SVG documents.
 */
export class SVG {
    private svg: string;

    constructor() {
        this.svg = '';
    }

    /**
     * Writes the SVG header.
     *
     * @param w - Width of the SVG
     * @param h - Height of the SVG
     * @param encoding - Character encoding
     * @param notestext - Notes text to include in comments
     */
    header(w: number, h: number, encoding?: string, notestext = ''): void {
        let encAttr = '';
        if (typeof encoding !== 'undefined') {
            encAttr = ` encoding="${encoding}"`;
        }
        this.svg += `<?xml version="1.0"${encAttr} standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" width="${w}" height="${h}" onload="init(evt)" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<!-- Flame graph stack visualization. See https://github.com/brendangregg/FlameGraph for latest version, and http://www.brendangregg.com/flamegraphs.html for examples. -->
<!-- NOTES: ${notestext} -->`;
    }

    /**
     * Includes raw content in the SVG.
     *
     * @param content - Raw SVG content to include
     */
    include(content: string): void {
        this.svg += content;
    }

    /**
     * Creates an RGB color string.
     *
     * @param r - Red component (0-255)
     * @param g - Green component (0-255)
     * @param b - Blue component (0-255)
     * @returns RGB color string
     */
    colorAllocate(r: number, g: number, b: number): string {
        return `rgb(${r},${g},${b})`;
    }

    /**
     * Starts a group or anchor element.
     *
     * @param attr - Attributes for the group or anchor
     */
    groupStart(attr: Record<string, string>): void {
        const gAttr = Object.keys(attr).filter(key => ['id', 'class'].includes(key))
            .map(key => `${key}="${attr[key]}"`);

        if (attr.g_extra) {
            gAttr.push(attr.g_extra);
        }

        if (attr.href) {
            const aAttr: string[] = [];
            aAttr.push(`xlink:href="${attr.href}"`);
            aAttr.push(`target="${attr.target || '_top'}"`);
            if (attr.a_extra) {
                aAttr.push(attr.a_extra);
            }
            this.svg += `<a ${aAttr.concat(gAttr).join(' ')}>\n`;
        } else {
            this.svg += `<g ${gAttr.join(' ')}>\n`;
        }

        if (attr.title) {
            this.svg += `<title>${attr.title}</title>\n`;
        }
    }

    /**
     * Ends a group or anchor element.
     *
     * @param attr - Attributes from the corresponding groupStart
     */
    groupEnd(attr: Record<string, string>): void {
        this.svg += attr && attr.href ? `</a>\n` : `</g>\n`;
    }

    /**
     * Draws a filled rectangle.
     *
     * @param x1 - Left edge X coordinate
     * @param y1 - Top edge Y coordinate
     * @param x2 - Right edge X coordinate
     * @param y2 - Bottom edge Y coordinate
     * @param fill - Fill color
     * @param extra - Additional SVG attributes
     */
    filledRectangle(x1: number, y1: number, x2: number, y2: number, fill: string, extra = ''): void {
        const x1Str = x1.toFixed(1);
        const w = (x2 - x1).toFixed(1);
        const h = (y2 - y1).toFixed(1);
        this.svg += `<rect x='${x1Str}' y='${y1}' width='${w}' height='${h}' fill='${fill}' ${extra} />\n`;
    }

    /**
     * Draws text at the specified position.
     *
     * @param id - Optional element ID
     * @param x - X coordinate
     * @param y - Y coordinate
     * @param str - Text content
     * @param extra - Additional SVG attributes
     */
    stringTTF(id: string | undefined, x: number, y: number, str: string, extra?: string): void {
        const xStr = x.toFixed(2);
        const idStr = id ? `id="${id}"` : '';
        const extraStr = extra || '';
        this.svg += `<text ${idStr} x='${xStr}' y='${y}' ${extraStr}>${str}</text>\n`;
    }

    /**
     * Returns the complete SVG document.
     *
     * @returns Complete SVG string with closing tag
     */
    getSVG(): string {
        return `${this.svg}</svg>\n`;
    }
}

/**
 * Generates a hash for a function name for color selection.
 *
 * @param name - Function name to hash
 * @returns Numeric hash value
 */
function namehash(name: string): number {
    // Generate a vector hash for the name string, weighting early over
    // later characters. We want to pick the same colors for function
    // names across different flame graphs.
    let vector = 0;
    let weight = 1;
    let max = 1;
    let mod = 10;

    // If module name present, truncate to 1st char
    name = name.replace(/.(.*?)`/, '');

    for (let i = 0; i < name.length; i++) {
        const c = name[i];
        const val = c.charCodeAt(0) % mod;
        vector += (val / (mod++ - 1)) * weight;
        max += weight;
        weight *= 0.70;
        if (mod > 12) break;
    }

    return (1 - vector / max);
}

/**
 * Generates a basic hash for a name string.
 *
 * @param name - Name to hash
 * @returns Unsigned 32-bit integer hash
 */
function sum_namehash(name: string): number {
    // Generate a basic hash for the name string
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char; // Simple hash function
        hash |= 0; // Convert to 32-bit integer
    }
    return hash >>> 0; // Return an unsigned 32-bit integer
}

/**
 * Generates a seeded random hash for a name string.
 *
 * @param name - Name to hash
 * @returns Random value between 0 and 1, consistent for the same name
 */
function random_namehash(name: string): number {
    // Generate a random hash for the name string.
    // This ensures that functions with the same name have the same color,
    // both within a flamegraph and across multiple flamegraphs.

    // Seed random number generator using the hash
    let seed = sum_namehash(name);

    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }

    return seededRandom();
}

/**
 * Determines the color for a flame graph element based on type and name.
 *
 * @param type - Color scheme type (hot, mem, io, java, perl, js, etc.)
 * @param hash - Whether to use hash-based coloring
 * @param name - Function name for color hashing
 * @param rand - Whether to use random coloring
 * @returns RGB color string
 */
function getColor(type: string, hash: boolean, name: string, rand: boolean): string {
    let v1: number, v2: number, v3: number;

    if (hash) {
        v1 = namehash(name);
        v2 = v3 = namehash([...name].reverse().join(''));
    } else if (rand) {
        v1 = Math.random();
        v2 = Math.random();
        v3 = Math.random();
    } else {
        v1 = random_namehash(name);
        v2 = random_namehash(name);
        v3 = random_namehash(name);
    }

    // theme palettes
    if (type === 'hot') {
        const r = 205 + Math.floor(50 * v3);
        const g = Math.floor(230 * v1);
        const b = Math.floor(55 * v2);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'mem') {
        const r = 0;
        const g = 190 + Math.floor(50 * v2);
        const b = Math.floor(210 * v1);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'io') {
        const r = 80 + Math.floor(60 * v1);
        const g = r;
        const b = 190 + Math.floor(55 * v2);
        return `rgb(${r},${g},${b})`;
    }

    // multi palettes
    if (type === 'java') {
        if (name.match(/_\[j]$/)) {
            type = 'green';
        } else if (name.match(/_\[i]$/)) {
            type = 'aqua';
        } else if (name.match(/^L?(java|javax|jdk|net|org|com|io|sun)\//)) {
            type = 'green';
        } else if (name.includes(':::')) {
            type = 'green';
        } else if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/_\[k]$/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'perl') {
        if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/Perl/) || name.match(/\.pl/)) {
            type = 'green';
        } else if (name.match(/_\[k]$/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'js') {
        if (name.match(/_\[j]$/)) {
            if (name.includes('/')) {
                type = 'green';
            } else {
                type = 'aqua';
            }
        } else if (name.includes('::')) {
            type = 'yellow';
        } else if (name.match(/\/.*\.js/)) {
            type = 'green';
        } else if (name.match(/:/)) {
            type = 'aqua';
        } else if (name.match(/^ $/)) {
            type = 'green';
        } else if (name.match(/_\[k]/)) {
            type = 'orange';
        } else {
            type = 'red';
        }
    }
    if (type === 'wakeup') {
        type = 'aqua';
    }
    if (type === 'chain') {
        if (name.match(/_\[w\]/)) {
            type = 'aqua';
        } else {
            type = 'blue';
        }
    }

    // color palettes
    if (type === 'red') {
        const r = 200 + Math.floor(55 * v1);
        const x = 50 + Math.floor(80 * v1);
        return `rgb(${r},${x},${x})`;
    }
    if (type === 'green') {
        const g = 200 + Math.floor(55 * v1);
        const x = 50 + Math.floor(60 * v1);
        return `rgb(${x},${g},${x})`;
    }
    if (type === 'blue') {
        const b = 205 + Math.floor(50 * v1);
        const x = 80 + Math.floor(60 * v1);
        return `rgb(${x},${x},${b})`;
    }
    if (type === 'yellow') {
        const x = 175 + Math.floor(55 * v1);
        const b = 50 + Math.floor(20 * v1);
        return `rgb(${x},${x},${b})`;
    }
    if (type === 'purple') {
        const x = 190 + Math.floor(65 * v1);
        const g = 80 + Math.floor(60 * v1);
        return `rgb(${x},${g},${x})`;
    }
    if (type === 'aqua') {
        const r = 50 + Math.floor(60 * v1);
        const g = 165 + Math.floor(55 * v1);
        const b = 165 + Math.floor(55 * v1);
        return `rgb(${r},${g},${b})`;
    }
    if (type === 'orange') {
        const r = 190 + Math.floor(65 * v1);
        const g = 90 + Math.floor(65 * v1);
        return `rgb(${r},${g},0)`;
    }

    return 'rgb(0,0,0)';
}

/**
 * Generates a color on a red-blue scale based on value.
 *
 * @param value - Value to convert to color
 * @param max - Maximum value for scaling
 * @param negate - Whether to negate the value
 * @returns RGB color string
 */
function color_scale(value: number, max: number, negate = false): string {
    let r = 255, g = 255, b = 255;
    if (negate) {
        value = -value;
    }
    if (value > 0) {
        g = b = Math.floor(210 * (max - value) / max);
    } else if (value < 0) {
        r = g = Math.floor(210 * (max + value) / max);
    }
    return `rgb(${r},${g},${b})`;
}

/**
 * Gets or creates a color mapping for a function.
 *
 * @param colors - Color scheme type
 * @param func - Function name
 * @param paletteMap - Map of function names to colors
 * @param hash - Whether to use hash-based coloring
 * @param rand - Whether to use random coloring
 * @returns RGB color string
 */
function color_map(colors: string, func: string, paletteMap: Record<string, string>, hash: boolean, rand: boolean): string {
    if (paletteMap[func]) {
        return paletteMap[func];
    } else {
        paletteMap[func] = getColor(colors, hash, func, rand);
        return paletteMap[func];
    }
}

/**
 * Merges two stacks and stores the merged frames and value data in Node.
 *
 * @param last - Previous stack frames
 * @param thisStack - Current stack frames
 * @param v - Value/time for this frame
 * @param d - Delta value
 * @param Node - Node storage object
 * @param Tmp - Temporary storage object
 * @returns The current stack
 */
function flow(last: string[], thisStack: string[], v: number, d: number | undefined, Node: Record<string, { stime?: number; delta?: number }>, Tmp: Record<string, { stime?: number; delta?: number }>): string[] {
    const lenA = last.length - 1;
    const lenB = thisStack.length - 1;

    let i = 0;
    let lenSame;

    for (; i <= lenA; i++) {
        if (i > lenB || last[i] !== thisStack[i]) {
            break;
        }
    }
    lenSame = i;

    for (i = lenA; i >= lenSame; i--) {
        const key = `${last[i]};${i}`;
        // Construct a unique ID from "func;depth;etime"
        // func-depth isn't unique, it may be repeated later.
        if (!Node[`${key};${v}`]) {
            Node[`${key};${v}`] = {};
        }
        Node[`${key};${v}`].stime = Tmp[key]?.stime;
        if (Tmp[key]?.delta !== undefined) {
            Node[`${key};${v}`].delta = Tmp[key].delta;
        }
        delete Tmp[key];
    }

    for (i = lenSame; i <= lenB; i++) {
        const key = `${thisStack[i]};${i}`;
        if (!Tmp[key]) {
            Tmp[key] = {};
        }
        Tmp[key].stime = v;
        if (d !== undefined) {
            Tmp[key].delta = (Tmp[key].delta || 0) + (i === lenB ? d : 0);
        }
    }

    return thisStack;
}

/**
 * Generates a flame graph SVG from stack identifiers.
 *
 * @param stackIdentifiers - Map of call stacks to durations
 * @returns SVG string for the flame graph
 * @throws Error if there are too few samples for the flame graph
 */
export function generateFlameGraph(stackIdentifiers: ArrayMap): string {
    const fnlog = trace_commands.scoped('generateFlameGraph');

    const interactive = true;

    // font type (default "Verdana")
    const fonttype = 'Verdana';

    // max width, pixels / width of image (default 1200)
    const imagewidth = 1200;

    // max height is dynamic / height of each frame (default 16)
    const frameheight = 16;

    // base text size / font size (default 12)
    const fontsize = 12;

    // avg width relative to fontsize
    const fontwidth = 0.59;

    // min function width, pixels or percentage of time
    // omit smaller functions. In pixels or use "%" for
    // percentage of time (default 0.1 pixels)
    const minwidth = 0.1;

    // name type label (default "Function:")
    // what are the names in the data?
    const nametype = 'Time:';

    // count type label (default "samples")
    // what are the counts in the data?
    const countname = 'µs';

    // set color palette. choices are = hot (default), mem
    // io, wakeup, chain, java, js, perl, red, green, blue
    // aqua, yellow, purple, orange
    // color theme
    let colors: string = 'hot';

    // set background colors. gradient choices are yellow,
    // blue, green, grey; flat colors use "#rrggbb"
    // By default, the background color matches the colors
    let bgcolors = '';

    // factor to scale counts by
    const factor = 1;

    // colors are keyed by function name hash
    // color by function name
    const hash = false;

    // colors are randomly generated
    // color randomly
    const rand = false;

    // use consistent palette
    // if we use consistent palettes (default off)
    const palette = false;

    // change title text
    // centered heading
    const titletext = 'Flame Graph';

    // second level title (optional)
    const subtitletext = '';

    // color for search highlighting
    const searchcolor = 'rgb(230,0,230)';

    // add notes comment in SVG (for debugging)
    // embedded notes in SVG
    const notestext = '';
    if (/[<>]/.test(notestext)) {
        throw new Error('Notes string can\'t contain < or >');
    }

    // pad top, include title
    const ypad1 = fontsize * 3;

    // pad bottom, include labels
    const ypad2 = fontsize * 2 + 10;

    // pad top, include subtitle (optional)
    const ypad3 = fontsize * 2;

    // pad left and right
    const xpad = 10;

    // vertical padding for frames
    const framepad = 1;
    let depthmax = 0;

    // Background colors:
    // - yellow gradient: default (hot, java, js, perl)
    // - green gradient: mem
    // - blue gradient: io, wakeup, chain
    // - gray gradient: flat colors (red, green, blue, ...)
    if (bgcolors === '') {
        // Choose a default
        if (colors === 'mem') {
            bgcolors = 'green';
        } else if (/^(io|wakeup|chain)$/.test(colors)) {
            bgcolors = 'blue';
        } else if (/^(red|green|blue|aqua|yellow|purple|orange)$/.test(colors)) {
            bgcolors = 'grey';
        } else {
            bgcolors = 'yellow';
        }
    }

    let bgcolor1: string, bgcolor2: string;
    if (bgcolors === 'yellow') {
        // background color gradient start
        bgcolor1 = '#eeeeee';
        // background color gradient stop
        bgcolor2 = '#eeeeb0';
    } else if (bgcolors === 'blue') {
        bgcolor1 = '#eeeeee';
        bgcolor2 = '#e0e0ff';
    } else if (bgcolors === 'green') {
        bgcolor1 = '#eef2ee';
        bgcolor2 = '#e0ffe0';
    } else if (bgcolors === 'grey') {
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    } else if (/^#[0-9a-fA-F]{6}$/.test(bgcolors)) {
        bgcolor1 = bgcolor2 = bgcolors;
    } else {
        // Default to grey if unrecognized
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    }

    // parse input
    interface DataEntry {
        stack: string;
        duration: number;
    }
    const Data: DataEntry[] = [];
    let SortedData: DataEntry[];
    let last: string[] = [];
    let time = 0;
    const delta = undefined;
    const maxdelta = 1;
    // Hash of merged frame data
    const Node: Record<string, { stime?: number; delta?: number }> = {};
    const Tmp: Record<string, { stime?: number; delta?: number }> = {};

    // Convert stackIdentifiers directly into Data array
    for (const [stack, duration] of stackIdentifiers) {
        const stackString = stack.join(';');
        Data.push({ stack: stackString, duration: duration });
    }

    // Process Data array
    SortedData = Data.slice().sort((a, b) => a.stack.localeCompare(b.stack));

    // process and merge frames
    let ignored = 0;
    for (let i = 0; i < SortedData.length; i++) {
        const entry = SortedData[i];
        let stack = entry.stack;
        const samples = entry.duration;

        if (samples === undefined || stack === undefined || samples <= 0) {
            ignored++;
            continue;
        }

        // For chain graphs, annotate waker frames with "_[w]", for later
        // coloring. This is a hack, but has a precedent ("_[k]" from perf).
        if (colors === 'chain') {
            const parts = stack.split(';--;');
            const newparts: string[] = [];
            stack = parts.shift()!;
            stack += ';--;';
            for (let j = 0; j < parts.length; j++) {
                let part = parts[j];
                part = part.replace(/;/g, '_[w];');
                part += '_[w]';
                newparts.push(part);
            }
            stack += newparts.join(';--;');
        }

        // Merge frames and populate Node
        last = flow(last, ['', ...stack.split(';')], time, delta, Node, Tmp);

        time += samples;
    }

    // Final flow call to merge remaining frames
    flow(last, [], time, delta, Node, Tmp);

    if (time < 100) {
        fnlog(`Stack count is low (${time}). Did something go wrong?`);
    }

    if (ignored > 0) {
        fnlog(`Ignored ${ignored} lines with invalid format`);
    }

    if (time === 0) {
        fnlog('ERROR: No stack counts found');
        const im = new SVG();
        const imageheight = fontsize * 5;
        im.header(imagewidth, imageheight);
        im.stringTTF(undefined, imagewidth / 2, fontsize * 2, 'ERROR: No valid input provided.');
        return im.getSVG();
    }

    const timemax = time;

    const widthpertime = (imagewidth - 2 * xpad) / timemax;

    // Treat as a percentage of time if the string ends in a "%".
    const minwidth_time = minwidth / widthpertime;

    // Sort "Node" by keys
    const sortedNode = Object.keys(Node).sort().reduce((acc, key) => {
        acc[key] = Node[key];
        return acc;
    }, {} as Record<string, { stime?: number; delta?: number }>);

    // Prune blocks that are too narrow and determine max depth
    for (const [id, node] of Object.entries(sortedNode)) {
        const idParts = id.split(';');
        const depth = idParts[1];
        const etime = idParts[2];
        const etimeNum = parseFloat(etime);
        const stime = node.stime;
        if (stime === undefined) {
            throw new Error(`missing start for ${id}`);
        }

        if ((etimeNum - stime) < minwidth_time) {
            delete sortedNode[id];
            continue;
        }
        depthmax = Math.max(parseInt(depth), depthmax);
    }

    let imageheight = ((depthmax + 1) * frameheight) + ypad1 + ypad2;
    if (subtitletext !== '') {
        imageheight += ypad3;
    }

    // Define variables
    const titlesize = fontsize + 5;

    // Create a new SVG instance
    const im = new SVG();

    // Allocate colors using the SVG instance
    // RGB(0, 0, 0)
    const black = im.colorAllocate(0, 0, 0);
    // RGB(160, 160, 160)
    const vdgrey = im.colorAllocate(160, 160, 160);
    // RGB(200, 200, 200)
    const dgrey = im.colorAllocate(200, 200, 200);

    // Set the dimensions of the SVG image
    im.header(imagewidth, imageheight);

    const inc = `
<defs>
	<linearGradient id="background" y1="0" y2="1" x1="0" x2="0" >
		<stop stop-color="${bgcolor1}" offset="5%" />
		<stop stop-color="${bgcolor2}" offset="95%" />
	</linearGradient>
</defs>
<style type="text/css">
	text { font-family:${fonttype}; font-size:${fontsize}px; fill:${black}; }
	#search, #ignorecase { opacity:0.1; cursor:pointer; }
	#search:hover, #search.show, #ignorecase:hover, #ignorecase.show { opacity:1; }
	#subtitle { text-anchor:middle; font-color:${vdgrey}; }
	#title { text-anchor:middle; font-size:${titlesize}px}
	#unzoom { cursor:pointer; }
	#frames > *:hover { stroke:black; stroke-width:0.5; cursor:pointer; }
	.hide { display:none; }
	.parent { opacity:0.5; }
</style>
<script type="text/ecmascript">
<![CDATA[
	"use strict";
	var details, searchbtn, unzoombtn, matchedtxt, svg, searching, currentSearchTerm, ignorecase, ignorecaseBtn;
	function init(evt) {
		details = document.getElementById("details").firstChild;
		searchbtn = document.getElementById("search");
		ignorecaseBtn = document.getElementById("ignorecase");
		unzoombtn = document.getElementById("unzoom");
		matchedtxt = document.getElementById("matched");
		svg = document.getElementsByTagName("svg")[0];
		searching = 0;
		currentSearchTerm = null;

		// use GET parameters to restore a flamegraphs state.
		var params = get_params();
		if (params.x && params.y)
			zoom(find_group(document.querySelector('[x="' + params.x + '"][y="' + params.y + '"]')));
                if (params.s) search(params.s);
	}

	// event listeners
	window.addEventListener("click", function(e) {
		var target = find_group(e.target);
		if (target) {
			if (target.nodeName == "a") {
				if (e.ctrlKey === false) return;
				e.preventDefault();
			}
			if (target.classList.contains("parent")) unzoom(true);
			zoom(target);
			if (!document.querySelector('.parent')) {
				// we have basically done a clearzoom so clear the url
				var params = get_params();
				if (params.x) delete params.x;
				if (params.y) delete params.y;
				history.replaceState(null, null, parse_params(params));
				unzoombtn.classList.add("hide");
				return;
			}

			// set parameters for zoom state
			var el = target.querySelector("rect");
			if (el && el.attributes && el.attributes.y && el.attributes._orig_x) {
				var params = get_params()
				params.x = el.attributes._orig_x.value;
				params.y = el.attributes.y.value;
				history.replaceState(null, null, parse_params(params));
			}
		}
		else if (e.target.id == "unzoom") clearzoom();
		else if (e.target.id == "search") search_prompt();
		else if (e.target.id == "ignorecase") toggle_ignorecase();
	}, false)

	// mouse-over for info
	// show
	window.addEventListener("mouseover", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = "${nametype} " + g_to_text(target);
	}, false)

	// clear
	window.addEventListener("mouseout", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = ' ';
	}, false)

	// ctrl-F for search
	// ctrl-I to toggle case-sensitive search
	window.addEventListener("keydown",function (e) {
		if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 70)) {
			e.preventDefault();
			search_prompt();
		}
		else if (e.ctrlKey && e.keyCode === 73) {
			e.preventDefault();
			toggle_ignorecase();
		}
	}, false)

	// functions
	function get_params() {
		var params = {};
		var paramsarr = window.location.search.substr(1).split('&');
		for (var i = 0; i < paramsarr.length; ++i) {
			var tmp = paramsarr[i].split("=");
			if (!tmp[0] || !tmp[1]) continue;
			params[tmp[0]]  = decodeURIComponent(tmp[1]);
		}
		return params;
	}
	function parse_params(params) {
		var uri = "?";
		for (var key in params) {
			uri += key + '=' + encodeURIComponent(params[key]) + '&';
		}
		if (uri.slice(-1) == "&")
			uri = uri.substring(0, uri.length - 1);
		if (uri == '?')
			uri = window.location.href.split('?')[0];
		return uri;
	}
	function find_child(node, selector) {
		var children = node.querySelectorAll(selector);
		if (children.length) return children[0];
	}
	function find_group(node) {
		var parent = node.parentElement;
		if (!parent) return;
		if (parent.id == "frames") return node;
		return find_group(parent);
	}
	function orig_save(e, attr, val) {
		if (e.attributes["_orig_" + attr] != undefined) return;
		if (e.attributes[attr] == undefined) return;
		if (val == undefined) val = e.attributes[attr].value;
		e.setAttribute("_orig_" + attr, val);
	}
	function orig_load(e, attr) {
		if (e.attributes["_orig_"+attr] == undefined) return;
		e.attributes[attr].value = e.attributes["_orig_" + attr].value;
		e.removeAttribute("_orig_"+attr);
	}
	function g_to_text(e) {
		var text = find_child(e, "title").firstChild.nodeValue;
		return (text)
	}
	function g_to_func(e) {
		var func = g_to_text(e);
		// if there's any manipulation we want to do to the function
		// name before it's searched, do it here before returning.
		return (func);
	}
	function update_text(e) {
		var r = find_child(e, "rect");
		var t = find_child(e, "text");
		var w = parseFloat(r.attributes.width.value) -3;
		var txt = find_child(e, "title").textContent.replace(/\\([^(]*\\)\$/,"");
		t.attributes.x.value = parseFloat(r.attributes.x.value) + 3;

		// Smaller than this size won't fit anything
		if (w < 2 * ${fontsize} * ${fontwidth}) {
			t.textContent = "";
			return;
		}

		t.textContent = txt;
		var sl = t.getSubStringLength(0, txt.length);
		// check if only whitespace or if we can fit the entire string into width w
		if (/^ *\$/.test(txt) || sl < w)
			return;

		// this isn't perfect, but gives a good starting point
		// and avoids calling getSubStringLength too often
		var start = Math.floor((w/sl) * txt.length);
		for (var x = start; x > 0; x = x-2) {
			if (t.getSubStringLength(0, x + 2) <= w) {
				t.textContent = txt.substring(0, x) + "..";
				return;
			}
		}
		t.textContent = "";
	}

	// zoom
	function zoom_reset(e) {
		if (e.attributes != undefined) {
			orig_load(e, "x");
			orig_load(e, "width");
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_reset(c[i]);
		}
	}
	function zoom_child(e, x, ratio) {
		if (e.attributes != undefined) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = (parseFloat(e.attributes.x.value) - x - ${xpad}) * ratio + ${xpad};
				if (e.tagName == "text")
					e.attributes.x.value = find_child(e.parentNode, "rect[x]").attributes.x.value + 3;
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseFloat(e.attributes.width.value) * ratio;
			}
		}

		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_child(c[i], x - ${xpad}, ratio);
		}
	}
	function zoom_parent(e) {
		if (e.attributes) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = ${xpad};
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseInt(svg.width.baseVal.value) - (${xpad} * 2);
			}
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_parent(c[i]);
		}
	}
	function zoom(node) {
		var attr = find_child(node, "rect").attributes;
		var width = parseFloat(attr.width.value);
		var xmin = parseFloat(attr.x.value);
		var xmax = parseFloat(xmin + width);
		var ymin = parseFloat(attr.y.value);
		var ratio = (svg.width.baseVal.value - 2 * ${xpad}) / width;

		// XXX: Workaround for JavaScript float issues (fix me)
		var fudge = 0.0001;

		unzoombtn.classList.remove("hide");

		var el = document.getElementById("frames").children;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var a = find_child(e, "rect").attributes;
			var ex = parseFloat(a.x.value);
			var ew = parseFloat(a.width.value);
			var upstack;
			// Is it an ancestor
            upstack = parseFloat(a.y.value) > ymin;
			if (upstack) {
				// Direct ancestor
				if (ex <= xmin && (ex+ew+fudge) >= xmax) {
					e.classList.add("parent");
					zoom_parent(e);
					update_text(e);
				}
				// not in current path
				else
					e.classList.add("hide");
			}
			// Children maybe
			else {
				// no common path
				if (ex < xmin || ex + fudge >= xmax) {
					e.classList.add("hide");
				}
				else {
					zoom_child(e, xmin, ratio);
					update_text(e);
				}
			}
		}
		search();
	}
	function unzoom(dont_update_text) {
		unzoombtn.classList.add("hide");
		var el = document.getElementById("frames").children;
		for(var i = 0; i < el.length; i++) {
			el[i].classList.remove("parent");
			el[i].classList.remove("hide");
			zoom_reset(el[i]);
			if(!dont_update_text) update_text(el[i]);
		}
		search();
	}
	function clearzoom() {
		unzoom();

		// remove zoom state
		var params = get_params();
		if (params.x) delete params.x;
		if (params.y) delete params.y;
		history.replaceState(null, null, parse_params(params));
	}

	// search
	function toggle_ignorecase() {
		ignorecase = !ignorecase;
		if (ignorecase) {
			ignorecaseBtn.classList.add("show");
		} else {
			ignorecaseBtn.classList.remove("show");
		}
		reset_search();
		search();
	}
	function reset_search() {
		var el = document.querySelectorAll("#frames rect");
		for (var i = 0; i < el.length; i++) {
			orig_load(el[i], "fill")
		}
		var params = get_params();
		delete params.s;
		history.replaceState(null, null, parse_params(params));
	}
	function search_prompt() {
		if (!searching) {
			var term = prompt("Enter a search term (regexp " +
			    "allowed, eg: ^ext4_)"
			    + (ignorecase ? ", ignoring case" : "")
			    + "\\nPress Ctrl-i to toggle case sensitivity", "");
			if (term != null) search(term);
		} else {
			reset_search();
			searching = 0;
			currentSearchTerm = null;
			searchbtn.classList.remove("show");
			searchbtn.firstChild.nodeValue = "Search"
			matchedtxt.classList.add("hide");
			matchedtxt.firstChild.nodeValue = ""
		}
	}
	function search(term) {
		if (term) currentSearchTerm = term;

		var re = new RegExp(currentSearchTerm, ignorecase ? 'i' : '');
		var el = document.getElementById("frames").children;
		var matches = new Object();
		var maxwidth = 0;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var func = g_to_func(e);
			var rect = find_child(e, "rect");
			if (func == null || rect == null)
				continue;

			// Save max width. Only works as we have a root frame
			var w = parseFloat(rect.attributes.width.value);
			if (w > maxwidth)
				maxwidth = w;

			if (func.match(re)) {
				// highlight
				var x = parseFloat(rect.attributes.x.value);
				orig_save(rect, "fill");
				rect.attributes.fill.value = "${searchcolor}";

				// remember matches
				if (matches[x] == undefined) {
					matches[x] = w;
				} else {
					if (w > matches[x]) {
						// overwrite with parent
						matches[x] = w;
					}
				}
				searching = 1;
			}
		}
		if (!searching)
			return;
		var params = get_params();
		params.s = currentSearchTerm;
		history.replaceState(null, null, parse_params(params));

		searchbtn.classList.add("show");
		searchbtn.firstChild.nodeValue = "Reset Search";

		// calculate percent matched, excluding vertical overlap
		var count = 0;
		var lastx = -1;
		var lastw = 0;
		var keys = Array();
		for (k in matches) {
			if (matches.hasOwnProperty(k))
				keys.push(k);
		}
		// sort the matched frames by their x location
		// ascending, then width descending
		keys.sort(function(a, b){
			return a - b;
		});
		// Step through frames saving only the biggest bottom-up frames
		// thanks to the sort order. This relies on the tree property
		// where children are always smaller than their parents.
		var fudge = 0.0001;	// JavaScript floating point
		for (var k in keys) {
			var x = parseFloat(keys[k]);
			var w = matches[keys[k]];
			if (x >= lastx + lastw - fudge) {
				count += w;
				lastx = x;
				lastw = w;
			}
		}
		// display matched percent
		matchedtxt.classList.remove("hide");
		var pct = 100 * count / maxwidth;
		if (pct != 100) pct = pct.toFixed(1)
		matchedtxt.firstChild.nodeValue = "Matched: " + pct + "%";
	}
]]>
</script>
`;

    if (interactive) {
        im.include(inc);
    }

    // Fill the background with a gradient
    im.filledRectangle(0, 0, imagewidth, imageheight, 'url(#background)');

    // Draw title text
    im.stringTTF('title', Math.floor(imagewidth / 2), fontsize * 2, titletext, '');

    // Draw subtitle text if it exists
    if (subtitletext !== '') {
        im.stringTTF('subtitle', Math.floor(imagewidth / 2), fontsize * 4, subtitletext, '');
    }

    if (interactive) {
        // Draw details text
        im.stringTTF('details', xpad, imageheight - (ypad2 / 2), ' ', '');

        // Draw unzoom button with class "hide"
        im.stringTTF('unzoom', xpad, fontsize * 2, 'Reset Zoom', 'class="hide"');

        // Draw search text
        im.stringTTF('search', imagewidth - xpad - 100, fontsize * 2, 'Search', '');

        // Draw ignore case text
        im.stringTTF('ignorecase', imagewidth - xpad - 16, fontsize * 2, 'ic', '');

        // Draw matched text
        im.stringTTF('matched', imagewidth - xpad - 100, imageheight - (ypad2 / 2), ' ', '');
    }

    // Draw frames
    im.groupStart({ id: 'frames' });

    // Iterate over Node objects
    for (const [id, node] of Object.entries(sortedNode)) {
        const [func, depth, etime] = id.split(';');
        const depthNum = parseInt(depth);
        const etimeNum = parseFloat(etime);
        const stime = node.stime!;
        const deltaVal = node.delta;

        const adjustedEtime = (func === '' && depthNum === 0) ? timemax : etimeNum;
        const x1 = xpad + stime * widthpertime;
        const x2 = xpad + adjustedEtime * widthpertime;

        const y1 = imageheight - ypad2 - (depthNum + 1) * frameheight + framepad;
        const y2 = imageheight - ypad2 - depthNum * frameheight;

        // Format samples with commas
        const samples = Math.round((adjustedEtime - stime) * factor);

        const formatWithCommas = (number: number) => {
            return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        };

        const samplesTxt = formatWithCommas(samples);

        let info: string;
        if (func === '' && parseInt(depth) === 0) {
            info = `all (${samplesTxt} ${countname}, 100%)`;
        } else {
            const pct = ((100 * samples) / (timemax * factor)).toFixed(2);
            let escapedFunc = func
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/_\[[kwij]\]$/, '');
            if (deltaVal === undefined) {
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%)`;
            } else {
                const d = deltaVal;
                const deltPct = ((100 * d) / (timemax * factor)).toFixed(2);
                const signDeltPct = d > 0 ? `+${deltPct}` : deltPct;
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%; ${signDeltPct}%)`;
            }
        }

        // Create name attributes
        const nameAttr: Record<string, string> = {};
        nameAttr.title = info;
        im.groupStart(nameAttr);

        // Determine color
        let color: string;
        if (func === '--') {
            color = vdgrey;
        } else if (func === '-') {
            color = dgrey;
        } else if (deltaVal !== undefined) {
            color = color_scale(deltaVal, maxdelta);
        } else if (palette) {
            const paletteMap: Record<string, string> = {};
            color = color_map(colors, func, paletteMap, hash, rand);
        } else {
            color = getColor(colors, hash, func, rand);
        }
        im.filledRectangle(x1, y1, x2, y2, color, 'rx="2" ry="2"');

        // Draw text
        const chars = Math.floor((x2 - x1) / (fontsize * fontwidth));
        let text = '';
        // room for one char plus two dots
        if (chars >= 3) {
            const truncatedFunc = func.replace(/_\[[kwij]\]$/, '');
            text = truncatedFunc.substring(0, chars);
            if (chars < truncatedFunc.length) {
                text = text.substring(0, text.length - 2) + '..';
            }
            text = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        im.stringTTF(undefined, x1 + 3, 3 + (y1 + y2) / 2, text, '');

        im.groupEnd(nameAttr);
    }
    im.groupEnd({});

    return im.getSVG();
}

/**
 * Result of generating an SVG flame graph.
 */
export interface GenerateSVGFlameGraphResult {
    /** Stack identifiers for the flame graph */
    stackIdentifiers: ArrayMap;
    /** Generated SVG content */
    SVGContent: string;
}
