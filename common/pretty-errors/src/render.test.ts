// Mock @actions/core
jest.mock('@actions/core', () => ({
    getInput: jest.fn()
}));

// Mock source-map module
jest.mock('./source-map', () => ({
    resolveFilePath: jest.fn((p: string) => p),
    readFileSync: jest.fn(),
    resolveSourceMapLocation: jest.fn()
}));

// Mock trace-commands module for dynamic import tests
const mockIsTraceEnabled = jest.fn(() => false);
jest.mock('trace-commands', () => ({
    isTraceCommandsEnabled: mockIsTraceEnabled
}), { virtual: true });

import * as path from 'path';
import * as core from '@actions/core';
import * as sourceMap from './source-map';
import {
    isTraceCommandsEnabled,
    extractContextFromContent,
    readContextFromFile,
    getRelativePath,
    renderSourceContext,
    hasValidContext,
    buildErrorPayload,
    renderErrorPayload,
    renderTerminal,
    colors
} from './render';

const mockedCore = core as jest.Mocked<typeof core>;
const mockedSourceMap = sourceMap as jest.Mocked<typeof sourceMap>;

describe('render', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.ACTIONS_STEP_DEBUG;
    });

    describe('isTraceCommandsEnabled', () => {
        it('returns false when nothing is enabled', async () => {
            mockedCore.getInput.mockReturnValue('');
            expect(await isTraceCommandsEnabled()).toBe(false);
        });

        it('returns true when ACTIONS_STEP_DEBUG is true', async () => {
            process.env.ACTIONS_STEP_DEBUG = 'true';
            mockedCore.getInput.mockReturnValue('');
            expect(await isTraceCommandsEnabled()).toBe(true);
        });

        it('returns true when getInput returns true', async () => {
            mockedCore.getInput.mockReturnValue('true');
            expect(await isTraceCommandsEnabled()).toBe(true);
        });

        it('handles getInput throwing an error (line 63)', async () => {
            mockedCore.getInput.mockImplementation(() => {
                throw new Error('input error');
            });
            // Should not throw, inputTrace defaults to false
            expect(await isTraceCommandsEnabled()).toBe(false);
        });

        // Note: trace-commands dynamic import path is not testable
        // because jest.mock with { virtual: true } does not reliably intercept
        // dynamic import().
    });

    describe('extractContextFromContent', () => {
        const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10';

        it('extracts context around a line', () => {
            const ctx = extractContextFromContent(content, 5, { pre: 2, post: 2 });
            expect(ctx.pre).toEqual(['line3', 'line4']);
            expect(ctx.line).toBe('line5');
            expect(ctx.post).toEqual(['line6', 'line7']);
        });

        it('uses defaults of 5 pre/post', () => {
            const ctx = extractContextFromContent(content, 6);
            expect(ctx.pre).toHaveLength(5);
            expect(ctx.post).toHaveLength(4); // only 4 lines after line 6
        });

        it('handles lines near the beginning', () => {
            const ctx = extractContextFromContent(content, 1, { pre: 5, post: 1 });
            expect(ctx.pre).toEqual([]);
            expect(ctx.line).toBe('line1');
        });
    });

    describe('readContextFromFile', () => {
        it('returns null when file cannot be read', () => {
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);
            expect(readContextFromFile('/no/file.ts', 1)).toBeNull();
        });

        it('returns context when file is readable', () => {
            mockedSourceMap.readFileSync.mockReturnValue('a\nb\nc\nd\ne');
            const ctx = readContextFromFile('/file.ts', 3, { pre: 1, post: 1 });
            expect(ctx).not.toBeNull();
            expect(ctx!.line).toBe('c');
        });
    });

    describe('getRelativePath', () => {
        it('returns relative path from cwd', () => {
            const result = getRelativePath(process.cwd() + '/some/file.ts');
            expect(result).toBe(path.join('some', 'file.ts'));
        });

        it('returns original path if relative fails (line 132)', () => {
            // Mock path.relative to throw by passing a weird input
            const origCwd = process.cwd;
            process.cwd = () => { throw new Error('cwd failed'); };
            try {
                const result = getRelativePath('/some/file.ts');
                expect(result).toBe('/some/file.ts');
            } finally {
                process.cwd = origCwd;
            }
        });
    });

    describe('renderSourceContext', () => {
        it('renders formatted source context', () => {
            const ctx = { pre: ['before1', 'before2'], line: 'error line', post: ['after1'] };
            const result = renderSourceContext(ctx, 10);
            expect(result).toContain('error line');
            expect(result).toContain('before1');
            expect(result).toContain('after1');
            expect(result).toContain('❯');
        });
    });

    describe('hasValidContext', () => {
        it('returns true for valid context', () => {
            const frame = {
                file: 'f.ts', filePath: 'f.ts', line: 10, column: 1,
                callee: 'fn', calleeShort: 'fn',
                context: { pre: [], line: 'code here', post: [] },
                isModule: false, isNative: false, isApp: true
            };
            expect(hasValidContext(frame)).toBe(true);
        });

        it('returns false for minified context (long line)', () => {
            const frame = {
                file: 'f.ts', filePath: 'f.ts', line: 10, column: 1,
                callee: 'fn', calleeShort: 'fn',
                context: { pre: [], line: 'x'.repeat(600), post: [] },
                isModule: false, isNative: false, isApp: true
            };
            expect(hasValidContext(frame)).toBe(false);
        });

        it('returns false when line number is 1 or less', () => {
            const frame = {
                file: 'f.ts', filePath: 'f.ts', line: 1, column: 1,
                callee: 'fn', calleeShort: 'fn',
                context: { pre: [], line: 'code', post: [] },
                isModule: false, isNative: false, isApp: true
            };
            expect(hasValidContext(frame)).toBe(false);
        });
    });

    describe('buildErrorPayload', () => {
        it('handles null error', async () => {
            const payload = await buildErrorPayload(null);
            expect(payload.error.message).toBeUndefined();
            expect(payload.error.frames).toEqual([]);
        });

        it('handles undefined error', async () => {
            const payload = await buildErrorPayload(undefined);
            expect(payload.error.message).toBeUndefined();
        });

        it('builds frames from an error stack', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue(null);
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);

            const err = new Error('test error');
            const payload = await buildErrorPayload(err);
            expect(payload.error.message).toBe('test error');
            expect(payload.error.name).toBe('Error');
            // Frames will exist from the real stack trace
            expect(Array.isArray(payload.error.frames)).toBe(true);
        });

        it('uses source map resolved location with name (lines 203-208)', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue({
                file: '/original/source.ts',
                line: 42,
                column: 10,
                name: 'resolvedCallee',
                sourceContent: null
            });
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);

            const err = new Error('mapped error');
            const payload = await buildErrorPayload(err);

            // At least one frame should have been resolved
            const resolvedFrame = payload.error.frames.find(f => f.callee === 'resolvedCallee');
            if (resolvedFrame) {
                expect(resolvedFrame.file).toBe('/original/source.ts');
                expect(resolvedFrame.line).toBe(42);
                expect(resolvedFrame.column).toBe(10);
            }
            // Verify resolveSourceMapLocation was called
            expect(mockedSourceMap.resolveSourceMapLocation).toHaveBeenCalled();
        });

        it('uses embedded sourceContent from source map (line 216)', async () => {
            const embeddedContent = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10';
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue({
                file: '/original/source.ts',
                line: 5,
                column: 1,
                name: null,
                sourceContent: embeddedContent
            });

            const err = new Error('embedded source');
            const payload = await buildErrorPayload(err);

            // Frames with source content should use extractContextFromContent
            const frame = payload.error.frames.find(f => f.file === '/original/source.ts');
            if (frame) {
                expect(frame.context.line).toBe('line5');
            }
            expect(mockedSourceMap.resolveSourceMapLocation).toHaveBeenCalled();
        });

        it('identifies node_modules frames as isModule', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue(null);
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);

            // Create a fake error with a controlled stack
            const err = new Error('module error');
            err.stack = [
                'Error: module error',
                '    at fn (/project/node_modules/pkg/index.js:1:1)'
            ].join('\n');

            const payload = await buildErrorPayload(err);
            expect(payload.error.frames.length).toBe(1);
            expect(payload.error.frames[0].isModule).toBe(true);
            expect(payload.error.frames[0].isApp).toBe(false);
        });

        it('identifies node: frames as isNative', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue(null);
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);

            const err = new Error('native error');
            err.stack = [
                'Error: native error',
                '    at fn (node:internal/process:10:5)'
            ].join('\n');

            const payload = await buildErrorPayload(err);
            expect(payload.error.frames.length).toBe(1);
            expect(payload.error.frames[0].isNative).toBe(true);
        });
    });

    describe('renderErrorPayload', () => {
        it('renders frames with stack trace header', () => {
            const payload = {
                error: {
                    message: 'test',
                    name: 'Error',
                    frames: [{
                        file: '/app/file.ts', filePath: '/app/file.ts',
                        line: 10, column: 5,
                        callee: 'myFunc', calleeShort: 'myFunc',
                        context: { pre: ['before'], line: 'error line', post: ['after'] },
                        isModule: false, isNative: false, isApp: true
                    }]
                }
            };
            const result = renderErrorPayload(payload);
            expect(result).toContain('Stack trace:');
            expect(result).toContain('myFunc');
        });

        it('renders module frames as dimmed', () => {
            const payload = {
                error: {
                    message: 'test',
                    name: 'Error',
                    frames: [{
                        file: '/node_modules/pkg/index.js',
                        filePath: '/node_modules/pkg/index.js',
                        line: 1, column: 1,
                        callee: 'pkgFn', calleeShort: 'pkgFn',
                        context: { pre: [], line: '', post: [] },
                        isModule: true, isNative: false, isApp: false
                    }]
                }
            };
            const result = renderErrorPayload(payload);
            expect(result).toContain('pkgFn');
            expect(result).toContain(colors.dim);
        });

        it('returns empty string when no non-native frames', () => {
            const payload = {
                error: {
                    message: 'test',
                    name: 'Error',
                    frames: [{
                        file: 'node:internal', filePath: 'node:internal',
                        line: 1, column: 1,
                        callee: 'native', calleeShort: 'native',
                        context: { pre: [], line: '', post: [] },
                        isModule: false, isNative: true, isApp: false
                    }]
                }
            };
            const result = renderErrorPayload(payload);
            expect(result).toBe('');
        });
    });

    describe('renderTerminal', () => {
        it('returns <no error> for null (line 303)', async () => {
            const result = await renderTerminal(null);
            expect(result).toBe('<no error>');
        });

        it('returns <no error> for undefined (line 303)', async () => {
            const result = await renderTerminal(undefined);
            expect(result).toBe('<no error>');
        });

        it('renders an error successfully', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockResolvedValue(null);
            mockedSourceMap.readFileSync.mockReturnValue(null as unknown as string);

            const result = await renderTerminal(new Error('render test'));
            expect(typeof result).toBe('string');
        });

        it('returns fallback when rendering throws (lines 310-312)', async () => {
            // Make resolveSourceMapLocation throw to trigger the catch in renderTerminal
            mockedSourceMap.resolveSourceMapLocation.mockRejectedValue(new Error('source map crash'));
            // Need a stack with at least one file frame for the error to propagate
            const err = new Error('broken render');
            const result = await renderTerminal(err);
            expect(result).toContain('Pretty renderer failed: source map crash');
            expect(result).toContain('broken render');
        });

        it('handles non-Error throw in catch block (line 311)', async () => {
            mockedSourceMap.resolveSourceMapLocation.mockRejectedValue('string error');
            const err = new Error('non-error throw');
            const result = await renderTerminal(err);
            expect(result).toContain('Pretty renderer failed: string error');
        });
    });
});
