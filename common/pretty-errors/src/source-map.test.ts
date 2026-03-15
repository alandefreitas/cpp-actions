jest.mock('fs', () => ({
    readFileSync: jest.fn()
}));

jest.mock('url', () => ({
    fileURLToPath: jest.fn()
}));

jest.mock('source-map', () => {
    const MockSourceMapConsumer: jest.Mock & { GREATEST_LOWER_BOUND: number } =
        Object.assign(jest.fn(), { GREATEST_LOWER_BOUND: 2 });
    return { SourceMapConsumer: MockSourceMapConsumer };
});

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SourceMapConsumer } from 'source-map';
import {
    resolveFilePath,
    readFileSync,
    loadSourceMap,
    isAppSource,
    resolveSourceMapLocation
} from './source-map';

const mockedFsRead = fs.readFileSync as jest.Mock;
const mockedFileURLToPath = fileURLToPath as jest.Mock;
const MockedConsumer = SourceMapConsumer as unknown as jest.Mock;

/**
 * Normalize a Unix-style path to the platform's native format.
 * On Windows, '/load/ext1/file.js' becomes 'D:\load\ext1\file.js'.
 *
 * @param p - Unix-style path
 * @returns Platform-native path
 */
function np(p: string): string {
    return path.resolve(p);
}

/**
 * Helper: set up fs mock to return content for given path mappings.
 * Registers both the raw path and the platform-normalized path so mocks
 * match regardless of whether the caller uses the raw or resolved form.
 *
 * @param files - Map of file path to file content
 */
function mockFileSystem(files: Record<string, string>): void {
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) {
        entries[k] = v;
        entries[np(k)] = v;
    }
    mockedFsRead.mockImplementation(((filePath: unknown) => {
        const content = entries[filePath as string];
        if (content !== undefined) return content;
        throw new Error(`ENOENT: no such file '${filePath}'`);
    }) as typeof fs.readFileSync);
}

/**
 * Helper: create a mock SourceMapConsumer.
 *
 * @param overrides - Partial overrides for consumer methods
 * @returns Mock consumer object
 */
function createMockConsumer(overrides: {
    originalPositionFor?: jest.Mock;
    sourceContentFor?: jest.Mock;
    destroy?: jest.Mock;
} = {}) {
    return {
        originalPositionFor: jest.fn().mockReturnValue({
            source: 'src/index.ts',
            line: 10,
            column: 5,
            name: 'myFunc'
        }),
        sourceContentFor: jest.fn().mockReturnValue('// source content'),
        destroy: jest.fn(),
        ...overrides
    };
}

describe('source-map', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('resolveFilePath', () => {
        it('returns regular paths unchanged', () => {
            expect(resolveFilePath('/some/path.js')).toBe('/some/path.js');
        });

        it('converts file: URLs via fileURLToPath', () => {
            mockedFileURLToPath.mockReturnValue(np('/resolved/file.js'));
            expect(resolveFilePath('file:///resolved/file.js')).toBe(np('/resolved/file.js'));
            expect(mockedFileURLToPath).toHaveBeenCalledWith('file:///resolved/file.js');
        });

        it('returns original path when fileURLToPath throws', () => {
            mockedFileURLToPath.mockImplementation(() => { throw new Error('bad url'); });
            expect(resolveFilePath('file:bad')).toBe('file:bad');
        });
    });

    describe('readFileSync', () => {
        it('reads a file and caches the result', () => {
            mockedFsRead.mockReturnValue('file content');

            expect(readFileSync('/cache/read1.js')).toBe('file content');
            // Second call should use cache
            expect(readFileSync('/cache/read1.js')).toBe('file content');
            expect(mockedFsRead).toHaveBeenCalledTimes(1);
        });

        it('returns null and caches when read fails', () => {
            mockedFsRead.mockImplementation(() => { throw new Error('ENOENT'); });

            expect(readFileSync('/cache/missing1.js')).toBeNull();
            // Second call should use cache
            expect(readFileSync('/cache/missing1.js')).toBeNull();
            expect(mockedFsRead).toHaveBeenCalledTimes(1);
        });
    });

    describe('isAppSource', () => {
        it('returns false for null', () => {
            expect(isAppSource(null)).toBe(false);
        });

        it('returns false for node_modules paths', () => {
            expect(isAppSource('node_modules/pkg/index.js')).toBe(false);
        });

        it('returns true for application source paths', () => {
            expect(isAppSource('src/index.ts')).toBe(true);
        });
    });

    describe('loadSourceMap', () => {
        it('returns null when file is unreadable', async () => {
            mockedFsRead.mockImplementation(() => { throw new Error('ENOENT'); });

            const result = await loadSourceMap('/load/missing1.js');
            expect(result).toBeNull();
        });

        it('returns null when no source map URL found', async () => {
            mockFileSystem({ '/load/nourl1.js': 'plain code without source map comment' });

            const result = await loadSourceMap('/load/nourl1.js');
            expect(result).toBeNull();
        });

        it('loads an external source map file', async () => {
            const rawMap = { version: 3, sources: ['src/a.ts'], mappings: 'AAAA' };
            const mockConsumer = createMockConsumer();

            mockFileSystem({
                '/load/ext1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/load/ext1/file.js.map': JSON.stringify(rawMap)
            });
            MockedConsumer.mockReturnValue(Promise.resolve(mockConsumer));

            const result = await loadSourceMap('/load/ext1/file.js');
            expect(result).toBe(mockConsumer);
            expect(MockedConsumer).toHaveBeenCalledWith(rawMap);
        });

        it('loads an inline data: source map', async () => {
            const rawMap = { version: 3, sources: ['src/b.ts'], mappings: 'AAAA' };
            const base64 = Buffer.from(JSON.stringify(rawMap)).toString('base64');
            const mockConsumer = createMockConsumer();

            mockFileSystem({
                '/load/inline1/file.js': `code\n//# sourceMappingURL=data:application/json;base64,${base64}`
            });
            MockedConsumer.mockReturnValue(Promise.resolve(mockConsumer));

            const result = await loadSourceMap('/load/inline1/file.js');
            expect(result).toBe(mockConsumer);
            expect(MockedConsumer).toHaveBeenCalledWith(rawMap);
        });

        it('loads inline data: source map with charset=utf-8', async () => {
            const rawMap = { version: 3, sources: ['src/c.ts'], mappings: 'AAAA' };
            const base64 = Buffer.from(JSON.stringify(rawMap)).toString('base64');
            const mockConsumer = createMockConsumer();

            mockFileSystem({
                '/load/inline2/file.js': `code\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64}`
            });
            MockedConsumer.mockReturnValue(Promise.resolve(mockConsumer));

            const result = await loadSourceMap('/load/inline2/file.js');
            expect(result).toBe(mockConsumer);
        });

        it('returns null when inline data URL does not match base64 pattern', async () => {
            mockFileSystem({
                '/load/baddata1/file.js': 'code\n//# sourceMappingURL=data:application/json;nobase64here'
            });

            const result = await loadSourceMap('/load/baddata1/file.js');
            expect(result).toBeNull();
        });

        it('returns null when external map file is unreadable', async () => {
            mockFileSystem({
                '/load/nomap1/file.js': 'code\n//# sourceMappingURL=file.js.map'
                // file.js.map is NOT in the file system
            });

            const result = await loadSourceMap('/load/nomap1/file.js');
            expect(result).toBeNull();
        });

        it('returns null when SourceMapConsumer constructor rejects', async () => {
            const rawMap = { version: 3, sources: [], mappings: '' };

            mockFileSystem({
                '/load/bad1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/load/bad1/file.js.map': JSON.stringify(rawMap)
            });
            const rejected = Promise.reject(new Error('invalid map'));
            rejected.catch(() => {});
            MockedConsumer.mockReturnValue(rejected);

            const result = await loadSourceMap('/load/bad1/file.js');
            expect(result).toBeNull();
        });

        it('returns cached consumer on second call', async () => {
            const rawMap = { version: 3, sources: ['src/d.ts'], mappings: 'AAAA' };
            const mockConsumer = createMockConsumer();

            mockFileSystem({
                '/load/cache1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/load/cache1/file.js.map': JSON.stringify(rawMap)
            });
            MockedConsumer.mockReturnValue(Promise.resolve(mockConsumer));

            const first = await loadSourceMap('/load/cache1/file.js');
            const second = await loadSourceMap('/load/cache1/file.js');

            expect(first).toBe(mockConsumer);
            expect(second).toBe(mockConsumer);
            expect(MockedConsumer).toHaveBeenCalledTimes(1);
        });

        it('resolves file: URL before loading', async () => {
            const rawMap = { version: 3, sources: ['src/e.ts'], mappings: 'AAAA' };
            const mockConsumer = createMockConsumer();

            mockedFileURLToPath.mockReturnValue(np('/load/fileurl1/file.js'));
            mockFileSystem({
                [np('/load/fileurl1/file.js')]: 'code\n//# sourceMappingURL=file.js.map',
                [np('/load/fileurl1/file.js.map')]: JSON.stringify(rawMap)
            });
            MockedConsumer.mockReturnValue(Promise.resolve(mockConsumer));

            const result = await loadSourceMap('file:///load/fileurl1/file.js');
            expect(result).toBe(mockConsumer);
        });
    });

    describe('resolveSourceMapLocation', () => {
        /**
         * Helper to set up a loadable source map for a given base path.
         *
         * @param basePath - Base directory path
         * @param consumer - Mock consumer to return
         */
        function setupLoadableMap(basePath: string, consumer: unknown) {
            const rawMap = JSON.stringify({ version: 3, sources: ['src/index.ts'], mappings: 'AAAA' });
            mockFileSystem({
                [`${basePath}/file.js`]: 'code\n//# sourceMappingURL=file.js.map',
                [`${basePath}/file.js.map`]: rawMap
            });
            MockedConsumer.mockReturnValue(Promise.resolve(consumer));
        }

        it('returns null when maxDepth is 0', async () => {
            const result = await resolveSourceMapLocation('/any/path.js', 1, 0, 0);
            expect(result).toBeNull();
        });

        it('returns null when no source map is available', async () => {
            mockedFsRead.mockImplementation(() => { throw new Error('ENOENT'); });

            const result = await resolveSourceMapLocation('/resolve/none1/file.js', 1, 0);
            expect(result).toBeNull();
        });

        it('resolves location through exact match', async () => {
            const consumer = createMockConsumer();
            setupLoadableMap('/resolve/exact1', consumer);

            const result = await resolveSourceMapLocation('/resolve/exact1/file.js', 1, 0);

            expect(result).toEqual({
                file: 'src/index.ts',
                line: 10,
                column: 5,
                name: 'myFunc',
                sourceContent: '// source content'
            });
        });

        it('falls back to GREATEST_LOWER_BOUND when exact match has no source', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn()
                    .mockReturnValueOnce({ source: null, line: null, column: null, name: null })
                    .mockReturnValueOnce({ source: 'src/fallback.ts', line: 20, column: 0, name: null })
            });
            setupLoadableMap('/resolve/glb1', consumer);

            const result = await resolveSourceMapLocation('/resolve/glb1/file.js', 1, 0);

            expect(consumer.originalPositionFor).toHaveBeenCalledTimes(2);
            expect(consumer.originalPositionFor).toHaveBeenLastCalledWith({
                line: 1,
                column: 0,
                bias: 2 // GREATEST_LOWER_BOUND
            });
            expect(result?.file).toBe('src/fallback.ts');
            expect(result?.line).toBe(20);
        });

        it('falls back to GREATEST_LOWER_BOUND when exact match is node_modules', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn()
                    .mockReturnValueOnce({ source: 'node_modules/pkg/index.js', line: 1, column: 0, name: null })
                    .mockReturnValueOnce({ source: 'src/app.ts', line: 15, column: 3, name: 'handler' })
            });
            setupLoadableMap('/resolve/glb2', consumer);

            const result = await resolveSourceMapLocation('/resolve/glb2/file.js', 1, 0);
            expect(result?.file).toBe('src/app.ts');
            expect(result?.name).toBe('handler');
        });

        it('returns null when both matches fail', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn()
                    .mockReturnValue({ source: null, line: null, column: null, name: null })
            });
            setupLoadableMap('/resolve/noresult1', consumer);

            const result = await resolveSourceMapLocation('/resolve/noresult1/file.js', 1, 0);
            expect(result).toBeNull();
        });

        it('returns null when both matches resolve to node_modules', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn()
                    .mockReturnValue({ source: 'node_modules/lib/index.js', line: 1, column: 0, name: null })
            });
            setupLoadableMap('/resolve/nm1', consumer);

            const result = await resolveSourceMapLocation('/resolve/nm1/file.js', 1, 0);
            expect(result).toBeNull();
        });

        it('returns null when source is found but line is null', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn()
                    .mockReturnValue({ source: 'src/index.ts', line: null, column: null, name: null })
            });
            setupLoadableMap('/resolve/nullline1', consumer);

            const result = await resolveSourceMapLocation('/resolve/nullline1/file.js', 1, 0);
            expect(result).toBeNull();
        });

        it('handles sourceContentFor throwing', async () => {
            const consumer = createMockConsumer({
                sourceContentFor: jest.fn().mockImplementation(() => {
                    throw new Error('source not found');
                })
            });
            setupLoadableMap('/resolve/throws1', consumer);

            const result = await resolveSourceMapLocation('/resolve/throws1/file.js', 1, 0);

            expect(result).toEqual({
                file: 'src/index.ts',
                line: 10,
                column: 5,
                name: 'myFunc',
                sourceContent: null
            });
        });

        it('strips webpack:// prefix from display path', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'webpack://my-app/src/utils.ts',
                    line: 5,
                    column: 0,
                    name: null
                })
            });
            setupLoadableMap('/resolve/webpack1', consumer);

            const result = await resolveSourceMapLocation('/resolve/webpack1/file.js', 1, 0);
            expect(result?.file).toBe('src/utils.ts');
        });

        it('strips leading ../ from display path', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: '../../../src/main.ts',
                    line: 8,
                    column: 0,
                    name: null
                })
            });
            setupLoadableMap('/resolve/dotdot1', consumer);

            const result = await resolveSourceMapLocation('/resolve/dotdot1/file.js', 1, 0);
            expect(result?.file).toBe('src/main.ts');
        });

        it('defaults column to 0 when original column is null', async () => {
            const consumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'src/no-col.ts',
                    line: 3,
                    column: null,
                    name: null
                })
            });
            setupLoadableMap('/resolve/nullcol1', consumer);

            const result = await resolveSourceMapLocation('/resolve/nullcol1/file.js', 1, 0);
            expect(result?.column).toBe(0);
        });

        it('follows chained inline source maps', async () => {
            // Create an inner source map embedded in the lib content
            const innerMap = { version: 3, sources: ['../src/original.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `lib code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: '../lib/file.js',
                    line: 10,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: '../src/original.ts',
                    line: 20,
                    column: 5,
                    name: 'origFunc'
                }),
                sourceContentFor: jest.fn().mockReturnValue('// original TS'),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['../lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/chain1/dist/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/chain1/dist/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/chain1/dist/file.js', 1, 0);

            expect(result).toEqual({
                file: 'src/original.ts',
                line: 20,
                column: 5,
                name: 'origFunc',
                sourceContent: '// original TS'
            });
            expect(innerConsumer.destroy).toHaveBeenCalled();
        });

        it('cleans up inner consumer when chained resolution fails', async () => {
            const innerMap = { version: 3, sources: ['inner.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `lib code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: 0,
                    name: 'outerFn'
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: null, line: null, column: null, name: null
                }),
                sourceContentFor: jest.fn(),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/chain2/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/chain2/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/chain2/file.js', 1, 0);

            // Falls back to outer consumer result
            expect(result?.file).toBe('lib/file.js');
            expect(result?.name).toBe('outerFn');
            expect(innerConsumer.destroy).toHaveBeenCalled();
        });

        it('handles webpack:// prefix in chained source map paths', async () => {
            const innerMap = { version: 3, sources: ['webpack://app/src/deep.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/bundle.js',
                    line: 5,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'webpack://app/src/deep.ts',
                    line: 30,
                    column: 2,
                    name: 'deepFn'
                }),
                sourceContentFor: jest.fn().mockReturnValue('// deep source'),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/bundle.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/wpchain1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/wpchain1/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/wpchain1/file.js', 1, 0);

            expect(result?.file).toBe('src/deep.ts');
            expect(innerConsumer.destroy).toHaveBeenCalled();
        });

        it('does not follow chained maps when maxDepth is 1', async () => {
            const innerMap = { version: 3, sources: ['inner.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const consumer = createMockConsumer({
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });
            setupLoadableMap('/resolve/depth1', consumer);

            const result = await resolveSourceMapLocation('/resolve/depth1/file.js', 1, 0, 1);

            // Should NOT create inner consumer (maxDepth <= 1 skips chaining)
            expect(MockedConsumer).toHaveBeenCalledTimes(1);
            expect(result?.file).toBe('src/index.ts');
        });

        it('uses outer name when nested name is null', async () => {
            const innerMap = { version: 3, sources: ['src/file.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: 0,
                    name: 'outerName'
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'src/file.ts',
                    line: 20,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue('// ts source'),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/namefallback1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/namefallback1/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/namefallback1/file.js', 1, 0);
            expect(result?.name).toBe('outerName');
        });

        it('handles sourceContentFor throwing in nested consumer', async () => {
            const innerMap = { version: 3, sources: ['src/file.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'src/file.ts',
                    line: 20,
                    column: 0,
                    name: 'fn'
                }),
                sourceContentFor: jest.fn().mockImplementation(() => {
                    throw new Error('not found');
                }),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/innerthrow1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/innerthrow1/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/innerthrow1/file.js', 1, 0);
            expect(result?.sourceContent).toBeNull();
            expect(result?.file).toBe('src/file.ts');
        });

        it('defaults nested column to 0 when null', async () => {
            const innerMap = { version: 3, sources: ['src/file.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: null,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'src/file.ts',
                    line: 20,
                    column: null,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue('// ts'),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/nestedcol1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/nestedcol1/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/nestedcol1/file.js', 1, 0);
            expect(result?.column).toBe(0);
            // Also verify the outer column 0 was passed to inner consumer
            expect(innerConsumer.originalPositionFor).toHaveBeenCalledWith({
                line: 10,
                column: 0
            });
        });

        it('skips chaining when inline consumer construction fails', async () => {
            const innerMap = { version: 3, sources: ['src/file.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: 0,
                    name: 'outerFn'
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/innerfail1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/innerfail1/file.js.map': rawMap
            });

            // First call for outer consumer succeeds, second (inline) rejects
            const rejected = Promise.reject(new Error('bad inline map'));
            rejected.catch(() => {});
            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(rejected);

            const result = await resolveSourceMapLocation('/resolve/innerfail1/file.js', 1, 0);

            // Falls back to outer consumer result
            expect(result?.file).toBe('lib/file.js');
            expect(result?.name).toBe('outerFn');
        });

        it('strips leading ../ from chained source map paths', async () => {
            const innerMap = { version: 3, sources: ['../../src/file.ts'], mappings: 'AAAA' };
            const base64InnerMap = Buffer.from(JSON.stringify(innerMap)).toString('base64');
            const libContent = `code\n//# sourceMappingURL=data:application/json;base64,${base64InnerMap}`;

            const outerConsumer = createMockConsumer({
                originalPositionFor: jest.fn().mockReturnValue({
                    source: 'lib/file.js',
                    line: 10,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue(libContent)
            });

            const innerConsumer = {
                originalPositionFor: jest.fn().mockReturnValue({
                    source: '../../src/file.ts',
                    line: 30,
                    column: 0,
                    name: null
                }),
                sourceContentFor: jest.fn().mockReturnValue('// ts'),
                destroy: jest.fn()
            };

            const rawMap = JSON.stringify({ version: 3, sources: ['lib/file.js'], mappings: 'AAAA' });
            mockFileSystem({
                '/resolve/chaindots1/file.js': 'code\n//# sourceMappingURL=file.js.map',
                '/resolve/chaindots1/file.js.map': rawMap
            });

            MockedConsumer
                .mockReturnValueOnce(Promise.resolve(outerConsumer))
                .mockReturnValueOnce(Promise.resolve(innerConsumer));

            const result = await resolveSourceMapLocation('/resolve/chaindots1/file.js', 1, 0);
            expect(result?.file).toBe('src/file.ts');
        });

        it('skips chaining when source content has no inline map', async () => {
            const consumer = createMockConsumer({
                sourceContentFor: jest.fn().mockReturnValue('plain source code, no inline map')
            });
            setupLoadableMap('/resolve/noinline1', consumer);

            const result = await resolveSourceMapLocation('/resolve/noinline1/file.js', 1, 0);

            expect(result?.file).toBe('src/index.ts');
            // Only one SourceMapConsumer created (no inline consumer)
            expect(MockedConsumer).toHaveBeenCalledTimes(1);
        });
    });
});
