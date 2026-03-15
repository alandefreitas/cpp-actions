import { parseStackTrace } from './stack-parser';

describe('stack-parser', () => {
    describe('parseStackTrace', () => {
        it('parses standard V8 stack frames', () => {
            const stack = [
                'Error: test',
                '    at functionName (/path/to/file.ts:10:5)',
                '    at /path/to/other.ts:20:10'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(2);
            expect(frames[0].callee).toBe('functionName');
            expect(frames[0].file).toBe('/path/to/file.ts');
            expect(frames[0].line).toBe(10);
            expect(frames[0].column).toBe(5);
            expect(frames[1].callee).toBe('anonymous');
            expect(frames[1].line).toBe(20);
        });

        it('parses native frames', () => {
            const stack = [
                'Error: test',
                '    at Array.forEach (native)',
                '    at Object.keys (native)'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(2);
            expect(frames[0].callee).toBe('Array.forEach');
            expect(frames[0].calleeShort).toBe('forEach');
            expect(frames[0].native).toBe(true);
            expect(frames[0].line).toBe(0);
            expect(frames[0].column).toBe(0);
            expect(frames[1].callee).toBe('Object.keys');
            expect(frames[1].calleeShort).toBe('keys');
            expect(frames[1].native).toBe(true);
        });

        it('parses eval/anonymous frames', () => {
            const stack = [
                'Error: test',
                '    at eval (<anonymous>)'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(1);
            expect(frames[0].callee).toBe('eval');
            expect(frames[0].calleeShort).toBe('eval');
            expect(frames[0].line).toBe(0);
        });

        it('identifies node_modules as third party', () => {
            const stack = [
                'Error: test',
                '    at fn (/project/node_modules/lib/index.js:1:1)'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames[0].thirdParty).toBe(true);
        });

        it('identifies node: prefix as native', () => {
            const stack = [
                'Error: test',
                '    at fn (node:internal/process:1:1)'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames[0].native).toBe(true);
        });

        it('skips non-frame lines', () => {
            const stack = [
                'Error: some error message',
                'some random text',
                '    at fn (/file.ts:1:1)'
            ].join('\n');

            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(1);
        });

        it('returns empty array for empty string', () => {
            expect(parseStackTrace('')).toEqual([]);
        });

        it('parses async frames', () => {
            const stack = '    at async myFunction (/path/file.ts:5:3)';
            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(1);
            expect(frames[0].callee).toBe('myFunction');
            expect(frames[0].line).toBe(5);
        });

        it('parses native frame with single-word callee', () => {
            const stack = '    at toString (native)';
            const frames = parseStackTrace(stack);
            expect(frames).toHaveLength(1);
            expect(frames[0].callee).toBe('toString');
            expect(frames[0].calleeShort).toBe('toString');
            expect(frames[0].native).toBe(true);
        });
    });
});
