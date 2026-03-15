import { SVG, namehash, sumNamehash, randomNamehash, getColor, colorScale, colorMap, flow } from './svg-utils';

describe('svg-utils', () => {
    describe('SVG', () => {
        let svg: SVG;

        beforeEach(() => {
            svg = new SVG();
        });

        it('should create an empty SVG', () => {
            expect(svg.getSVG()).toBe('</svg>\n');
        });

        it('should generate header without encoding', () => {
            svg.header(100, 200);
            const result = svg.getSVG();
            expect(result).toContain('<?xml version="1.0" standalone="no"?>');
            expect(result).toContain('width="100" height="200"');
            expect(result).toContain('<!-- NOTES:  -->');
        });

        it('should generate header with encoding', () => {
            svg.header(100, 200, 'UTF-8');
            const result = svg.getSVG();
            expect(result).toContain('encoding="UTF-8"');
        });

        it('should generate header with notes text', () => {
            svg.header(100, 200, undefined, 'some notes');
            const result = svg.getSVG();
            expect(result).toContain('<!-- NOTES: some notes -->');
        });

        it('should include raw content', () => {
            svg.include('<rect/>');
            expect(svg.getSVG()).toContain('<rect/>');
        });

        it('should allocate colors', () => {
            expect(svg.colorAllocate(255, 128, 0)).toBe('rgb(255,128,0)');
        });

        it('should create group with id and class', () => {
            svg.groupStart({ id: 'myid', class: 'myclass' });
            const result = svg.getSVG();
            expect(result).toContain('id="myid"');
            expect(result).toContain('class="myclass"');
            expect(result).toContain('<g ');
        });

        it('should create group with g_extra', () => {
            svg.groupStart({ id: 'test', g_extra: 'data-foo="bar"' });
            const result = svg.getSVG();
            expect(result).toContain('data-foo="bar"');
        });

        it('should create anchor group with href', () => {
            svg.groupStart({ href: 'http://example.com' });
            const result = svg.getSVG();
            expect(result).toContain('<a ');
            expect(result).toContain('xlink:href="http://example.com"');
            expect(result).toContain('target="_top"');
        });

        it('should create anchor with custom target', () => {
            svg.groupStart({ href: 'http://example.com', target: '_blank' });
            const result = svg.getSVG();
            expect(result).toContain('target="_blank"');
        });

        it('should create anchor with a_extra', () => {
            svg.groupStart({ href: 'http://example.com', a_extra: 'rel="noopener"' });
            const result = svg.getSVG();
            expect(result).toContain('rel="noopener"');
        });

        it('should add title in group', () => {
            svg.groupStart({ title: 'My Title' });
            expect(svg.getSVG()).toContain('<title>My Title</title>');
        });

        it('should end group', () => {
            svg.groupEnd({});
            expect(svg.getSVG()).toContain('</g>');
        });

        it('should end anchor group', () => {
            svg.groupEnd({ href: 'http://example.com' });
            expect(svg.getSVG()).toContain('</a>');
        });

        it('should draw filled rectangle', () => {
            svg.filledRectangle(10, 20, 100, 50, 'red');
            const result = svg.getSVG();
            expect(result).toContain("<rect x='10.0' y='20' width='90.0' height='30.0' fill='red'");
        });

        it('should draw filled rectangle with extra', () => {
            svg.filledRectangle(0, 0, 50, 50, 'blue', 'rx="2"');
            const result = svg.getSVG();
            expect(result).toContain('rx="2"');
        });

        it('should draw text', () => {
            svg.stringTTF('mytext', 10, 20, 'Hello');
            const result = svg.getSVG();
            expect(result).toContain('id="mytext"');
            expect(result).toContain('>Hello</text>');
        });

        it('should draw text without id', () => {
            svg.stringTTF(undefined, 10, 20, 'World');
            const result = svg.getSVG();
            expect(result).not.toContain('id=');
            expect(result).toContain('>World</text>');
        });

        it('should draw text with extra attributes', () => {
            svg.stringTTF('id1', 10, 20, 'Test', 'font-size="12"');
            expect(svg.getSVG()).toContain('font-size="12"');
        });
    });

    describe('namehash', () => {
        it('should return consistent hash for same name', () => {
            const h1 = namehash('myFunction');
            const h2 = namehash('myFunction');
            expect(h1).toBe(h2);
        });

        it('should return value between 0 and 1', () => {
            const h = namehash('testFunction');
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(1);
        });

        it('should truncate module prefix', () => {
            const h1 = namehash('m.abc`rest');
            const h2 = namehash('m`rest');
            expect(h1).toBe(h2);
        });

        it('should handle short names', () => {
            expect(namehash('a')).toBeGreaterThanOrEqual(0);
        });

        it('should handle long names by stopping at mod > 12', () => {
            const h = namehash('abcdefghijklmnopqrstuvwxyz');
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(1);
        });
    });

    describe('sumNamehash', () => {
        it('should return consistent hash for same name', () => {
            expect(sumNamehash('test')).toBe(sumNamehash('test'));
        });

        it('should return unsigned 32-bit integer', () => {
            const h = sumNamehash('hello');
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(2 ** 32);
        });

        it('should return 0 for empty string', () => {
            expect(sumNamehash('')).toBe(0);
        });
    });

    describe('randomNamehash', () => {
        it('should return consistent value for same name', () => {
            expect(randomNamehash('test')).toBe(randomNamehash('test'));
        });

        it('should return value between 0 and 1', () => {
            const h = randomNamehash('myFunc');
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(1);
        });
    });

    describe('getColor', () => {
        it('should return hot color', () => {
            const c = getColor('hot', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should return mem color', () => {
            const c = getColor('mem', false, 'func', false);
            expect(c).toMatch(/^rgb\(0,\d+,\d+\)$/);
        });

        it('should return io color', () => {
            const c = getColor('io', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should use hash-based coloring', () => {
            const c = getColor('hot', true, 'myFunc', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should use random coloring', () => {
            const c = getColor('hot', false, 'func', true);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        // Java multi-palette
        it('should classify java JIT as green', () => {
            const c = getColor('java', false, 'func_[j]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java interpreted as aqua', () => {
            const c = getColor('java', false, 'func_[i]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java package as green', () => {
            const c = getColor('java', false, 'java/lang/String', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java triple-colon as green', () => {
            const c = getColor('java', false, 'module:::func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java double-colon as yellow', () => {
            const c = getColor('java', false, 'Class::method', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java kernel as orange', () => {
            const c = getColor('java', false, 'func_[k]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify java default as red', () => {
            const c = getColor('java', false, 'plainFunc', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        // Perl multi-palette
        it('should classify perl double-colon as yellow', () => {
            const c = getColor('perl', false, 'Module::func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify perl .pl as green', () => {
            const c = getColor('perl', false, 'script.pl', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify perl Perl match as green', () => {
            const c = getColor('perl', false, 'PerlIO_read', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify perl kernel as orange', () => {
            const c = getColor('perl', false, 'func_[k]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify perl default as red', () => {
            const c = getColor('perl', false, 'plainFunc', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        // JS multi-palette
        it('should classify js JIT with path as green', () => {
            const c = getColor('js', false, 'path/to/func_[j]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js JIT without path as aqua', () => {
            const c = getColor('js', false, 'func_[j]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js double-colon as yellow', () => {
            const c = getColor('js', false, 'Class::method', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js file path as green', () => {
            const c = getColor('js', false, '/path/to/file.js', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js colon as aqua', () => {
            const c = getColor('js', false, 'module:func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js space as green', () => {
            const c = getColor('js', false, ' ', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js kernel as orange', () => {
            const c = getColor('js', false, 'func_[k]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should classify js default as red', () => {
            const c = getColor('js', false, 'plainFunc', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        // Other types
        it('should map wakeup to aqua', () => {
            const c = getColor('wakeup', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should map chain wakeup to aqua', () => {
            const c = getColor('chain', false, 'func_[w]', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should map chain non-wakeup to blue', () => {
            const c = getColor('chain', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        // Direct color palettes
        it('should return red palette', () => {
            const c = getColor('red', false, 'func', false);
            expect(c).toMatch(/^rgb\(2\d\d,\d+,\d+\)$/);
        });

        it('should return green palette', () => {
            const c = getColor('green', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,2\d\d,\d+\)$/);
        });

        it('should return blue palette', () => {
            const c = getColor('blue', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,2\d\d\)$/);
        });

        it('should return yellow palette', () => {
            const c = getColor('yellow', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should return purple palette', () => {
            const c = getColor('purple', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should return aqua palette', () => {
            const c = getColor('aqua', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        });

        it('should return orange palette', () => {
            const c = getColor('orange', false, 'func', false);
            expect(c).toMatch(/^rgb\(\d+,\d+,0\)$/);
        });

        it('should return black for unknown type', () => {
            expect(getColor('unknown', false, 'func', false)).toBe('rgb(0,0,0)');
        });
    });

    describe('colorScale', () => {
        it('should return white for zero value', () => {
            expect(colorScale(0, 100)).toBe('rgb(255,255,255)');
        });

        it('should return red-ish for positive value', () => {
            const c = colorScale(50, 100);
            expect(c).toMatch(/^rgb\(255,\d+,\d+\)$/);
        });

        it('should return blue-ish for negative value', () => {
            const c = colorScale(-50, 100);
            expect(c).toMatch(/^rgb\(\d+,\d+,255\)$/);
        });

        it('should negate value when negate is true', () => {
            const normal = colorScale(50, 100);
            const negated = colorScale(-50, 100, true);
            expect(normal).toBe(negated);
        });
    });

    describe('colorMap', () => {
        it('should return cached color from palette map', () => {
            const paletteMap: Record<string, string> = { myFunc: 'rgb(1,2,3)' };
            expect(colorMap('hot', 'myFunc', paletteMap, false, false)).toBe('rgb(1,2,3)');
        });

        it('should generate and cache new color', () => {
            const paletteMap: Record<string, string> = {};
            const c = colorMap('hot', 'newFunc', paletteMap, false, false);
            expect(c).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
            expect(paletteMap['newFunc']).toBe(c);
        });
    });

    describe('flow', () => {
        it('should handle transition from empty stack', () => {
            const Node: Record<string, { stime?: number; delta?: number }> = {};
            const Tmp: Record<string, { stime?: number; delta?: number }> = {};
            const result = flow([], ['a', 'b'], 0, undefined, Node, Tmp);
            expect(result).toEqual(['a', 'b']);
            expect(Tmp['a;0']).toBeDefined();
            expect(Tmp['a;0'].stime).toBe(0);
            expect(Tmp['b;1']).toBeDefined();
            expect(Tmp['b;1'].stime).toBe(0);
        });

        it('should merge common prefix and close diverging frames', () => {
            const Node: Record<string, { stime?: number; delta?: number }> = {};
            const Tmp: Record<string, { stime?: number; delta?: number }> = {};

            flow([], ['a', 'b'], 0, undefined, Node, Tmp);
            const result = flow(['a', 'b'], ['a', 'c'], 10, undefined, Node, Tmp);
            expect(result).toEqual(['a', 'c']);

            // b should be closed in Node with etime=10
            expect(Node['b;1;10']).toBeDefined();
            expect(Node['b;1;10'].stime).toBe(0);

            // c should be open in Tmp
            expect(Tmp['c;1']).toBeDefined();
            expect(Tmp['c;1'].stime).toBe(10);
        });

        it('should handle delta values', () => {
            const Node: Record<string, { stime?: number; delta?: number }> = {};
            const Tmp: Record<string, { stime?: number; delta?: number }> = {};

            flow([], ['a', 'b'], 0, 5, Node, Tmp);
            expect(Tmp['b;1'].delta).toBe(5);
            // Non-leaf frames get delta 0
            expect(Tmp['a;0'].delta).toBe(0);
        });

        it('should close all frames when transitioning to empty stack', () => {
            const Node: Record<string, { stime?: number; delta?: number }> = {};
            const Tmp: Record<string, { stime?: number; delta?: number }> = {};

            flow([], ['a', 'b'], 0, undefined, Node, Tmp);
            flow(['a', 'b'], [], 10, undefined, Node, Tmp);

            expect(Node['b;1;10']).toBeDefined();
            expect(Node['a;0;10']).toBeDefined();
        });

        it('should propagate delta from Tmp to Node on close', () => {
            const Node: Record<string, { stime?: number; delta?: number }> = {};
            const Tmp: Record<string, { stime?: number; delta?: number }> = {};

            flow([], ['a'], 0, 5, Node, Tmp);
            flow(['a'], [], 10, undefined, Node, Tmp);

            expect(Node['a;0;10'].delta).toBe(5);
        });
    });
});
