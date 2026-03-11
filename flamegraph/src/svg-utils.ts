/**
 * SVG rendering utilities for flame graph generation.
 *
 * Provides the SVG builder class, color palette functions, and
 * frame merging logic used by the flame graph generator.
 *
 * @module svg-utils
 */

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
export function namehash(name: string): number {
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
export function sumNamehash(name: string): number {
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
export function randomNamehash(name: string): number {
    // Generate a random hash for the name string.
    // This ensures that functions with the same name have the same color,
    // both within a flamegraph and across multiple flamegraphs.

    // Seed random number generator using the hash
    let seed = sumNamehash(name);

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
export function getColor(type: string, hash: boolean, name: string, rand: boolean): string {
    let v1: number, v2: number, v3: number;

    if (hash) {
        v1 = namehash(name);
        v2 = v3 = namehash([...name].reverse().join(''));
    } else if (rand) {
        v1 = Math.random();
        v2 = Math.random();
        v3 = Math.random();
    } else {
        v1 = randomNamehash(name);
        v2 = randomNamehash(name);
        v3 = randomNamehash(name);
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
export function colorScale(value: number, max: number, negate = false): string {
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
export function colorMap(colors: string, func: string, paletteMap: Record<string, string>, hash: boolean, rand: boolean): string {
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
export function flow(last: string[], thisStack: string[], v: number, d: number | undefined, Node: Record<string, { stime?: number; delta?: number }>, Tmp: Record<string, { stime?: number; delta?: number }>): string[] {
    const lenA = last.length - 1;
    const lenB = thisStack.length - 1;

    let i = 0;

    for (; i <= lenA; i++) {
        if (i > lenB || last[i] !== thisStack[i]) {
            break;
        }
    }
    const lenSame = i;

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
