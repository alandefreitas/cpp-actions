import * as actionSchema from './index';
import { parseInputs } from './parser';
import { generateInputsSection, generateOutputsSection } from './generators/action-yml';
import type { ActionInputsSchema, ActionOutputsSchema, InferInputs } from './types';

// Mock gh-inputs
jest.mock('gh-inputs', () => ({
    getInput: jest.fn(),
    getBoolean: jest.fn(),
    getInt: jest.fn(),
    getArray: jest.fn(),
    getSet: jest.fn(),
    getNormalizedPath: jest.fn(),
    getMultilineInput: jest.fn(),
    getTribool: jest.fn(),
    getMap: jest.fn(),
    printInputObject: jest.fn(),
    setOutputObject: jest.fn()
}));

// Mock trace-commands
jest.mock('trace-commands', () => ({
    setTraceCommands: jest.fn()
}));

// Mock @actions/core
jest.mock('@actions/core', () => ({
    startGroup: jest.fn(),
    endGroup: jest.fn(),
    setFailed: jest.fn(),
    info: jest.fn()
}));

// Mock pretty-errors
jest.mock('pretty-errors', () => ({
    reportAndSetFailed: jest.fn()
}));

import * as ghInputs from 'gh-inputs';

const mockedGhInputs = ghInputs as jest.Mocked<typeof ghInputs>;

describe('action-schema', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('parseInputs', () => {
        it('should parse string inputs', () => {
            mockedGhInputs.getInput.mockReturnValue('test-value');

            const schema = {
                my_input: {
                    type: 'string' as const,
                    default: '',
                    description: 'Test input'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.my_input).toBe('test-value');
            expect(mockedGhInputs.getInput).toHaveBeenCalledWith(
                'my-input',
                expect.objectContaining({ defaultValue: '' })
            );
        });

        it('should parse boolean inputs', () => {
            mockedGhInputs.getBoolean.mockReturnValue(true);

            const schema = {
                enabled: {
                    type: 'boolean' as const,
                    default: false,
                    description: 'Enable feature'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.enabled).toBe(true);
            expect(mockedGhInputs.getBoolean).toHaveBeenCalledWith(
                'enabled',
                expect.objectContaining({ defaultValue: false })
            );
        });

        it('should parse array inputs with splitter', () => {
            mockedGhInputs.getArray.mockReturnValue(['a', 'b', 'c']);

            const schema = {
                items: {
                    type: 'string[]' as const,
                    splitter: /,/,
                    default: [] as string[],
                    description: 'List of items'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.items).toEqual(['a', 'b', 'c']);
            expect(mockedGhInputs.getArray).toHaveBeenCalledWith(
                'items',
                /,/,
                undefined,
                expect.any(Object)
            );
        });

        it('should parse regex inputs', () => {
            mockedGhInputs.getInput.mockReturnValue('foo.*bar');

            const schema = {
                pattern: {
                    type: 'regex' as const,
                    default: /(?:)/,
                    description: 'Regex pattern'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.pattern).toBeInstanceOf(RegExp);
            expect(result.pattern.source).toBe('foo.*bar');
            expect(mockedGhInputs.getInput).toHaveBeenCalledWith(
                'pattern',
                expect.objectContaining({ defaultValue: /(?:)/ })
            );
        });

        it('should parse regex inputs with empty string default', () => {
            mockedGhInputs.getInput.mockReturnValue('');

            const schema = {
                filter: {
                    type: 'regex' as const,
                    default: new RegExp(''),
                    description: 'Filter pattern'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.filter).toBeInstanceOf(RegExp);
            expect(result.filter.source).toBe('(?:)');
            expect('anything'.match(result.filter)).toBeTruthy();
        });

        it('should apply type-changing transform (string → RegExp)', () => {
            mockedGhInputs.getInput.mockReturnValue('foo.*bar');

            const schema = {
                pattern: {
                    type: 'string' as const,
                    default: '',
                    description: 'Pattern',
                    transform: (v) => new RegExp(v as string)
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.pattern).toBeInstanceOf(RegExp);
            expect(result.pattern.source).toBe('foo.*bar');
        });

        it('should apply type-changing transform (string[] → Record)', () => {
            mockedGhInputs.getArray.mockReturnValue(['a:1', 'b:2']);

            const schema = {
                pairs: {
                    type: 'string[]' as const,
                    default: [] as string[],
                    description: 'Key-value pairs',
                    transform: (v) => {
                        const record: Record<string, string> = {};
                        for (const item of v as string[]) {
                            const [key, val] = item.split(':');
                            record[key] = val;
                        }
                        return record;
                    }
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.pairs).toEqual({ a: '1', b: '2' });
        });

        it('should apply transform function', () => {
            mockedGhInputs.getInput.mockReturnValue('gcc-12');

            const schema: ActionInputsSchema = {
                version: {
                    type: 'string',
                    default: '*',
                    description: 'Version',
                    transform: (v) => (v as string).replace(/^gcc-/, '')
                }
            };

            const result = parseInputs(schema);

            expect(result.version).toBe('12');
        });

        it('should apply transform to already-clean values', () => {
            mockedGhInputs.getInput.mockReturnValue('12');

            const schema: ActionInputsSchema = {
                version: {
                    type: 'string',
                    default: '*',
                    description: 'Version',
                    transform: (v) => (v as string).replace(/^gcc-/, '')
                }
            };

            const result = parseInputs(schema);

            expect(result.version).toBe('12');
        });

        it('should apply transform to empty strings', () => {
            mockedGhInputs.getInput.mockReturnValue('');

            const schema: ActionInputsSchema = {
                version: {
                    type: 'string',
                    default: '*',
                    description: 'Version',
                    transform: (v) => (v as string).trim().toLowerCase()
                }
            };

            const result = parseInputs(schema);

            expect(result.version).toBe('');
        });

        it('should apply transform to boolean values', () => {
            mockedGhInputs.getBoolean.mockReturnValue(true);

            const schema: ActionInputsSchema = {
                enabled: {
                    type: 'boolean',
                    default: false,
                    description: 'Enable feature',
                    transform: (v) => !(v as boolean)
                }
            };

            const result = parseInputs(schema);

            expect(result.enabled).toBe(false);
        });

        it('should apply transform to array values', () => {
            mockedGhInputs.getArray.mockReturnValue(['  Path1  ', 'PATH2', '  path3']);

            const schema: ActionInputsSchema = {
                paths: {
                    type: 'string[]',
                    splitter: /,/,
                    default: [] as string[],
                    description: 'Paths',
                    transform: (v) => (v as string[]).map(p => p.trim().toLowerCase())
                }
            };

            const result = parseInputs(schema);

            expect(result.paths).toEqual(['path1', 'path2', 'path3']);
        });

        it('should handle transform with multiple prefix patterns', () => {
            mockedGhInputs.getInput.mockReturnValue('g++-12');

            const removeGccPrefix = (version: string): string => {
                return version
                    .replace(/^gcc-/, '')
                    .replace(/^g\+\+-/, '');
            };

            const schema: ActionInputsSchema = {
                version: {
                    type: 'string',
                    default: '*',
                    description: 'Version',
                    transform: (v) => removeGccPrefix(v as string)
                }
            };

            const result = parseInputs(schema);

            expect(result.version).toBe('12');
        });

        it('should apply cross-field transform (path resolution)', () => {
            mockedGhInputs.getInput.mockImplementation(((name: string) => {
                if (name === 'source-dir') return '/home/user/project';
                if (name === 'output-path') return 'dist/output.txt';
                return '';
            }) as typeof mockedGhInputs.getInput);

            const schema = {
                sourceDir: {
                    type: 'string' as const,
                    default: '.',
                    description: 'Source directory'
                },
                outputPath: {
                    type: 'string' as const,
                    default: 'output.txt',
                    description: 'Output path',
                    crossTransform: (v: unknown, inputs: Record<string, unknown>) => {
                        const path = require('path');
                        return path.posix.resolve(inputs.sourceDir as string, v as string);
                    }
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.sourceDir).toBe('/home/user/project');
            expect(result.outputPath).toBe('/home/user/project/dist/output.txt');
        });

        it('should apply cross-field conditional transform', () => {
            mockedGhInputs.getInput.mockImplementation(((name: string) => {
                if (name === 'build-variant') return 'release';
                if (name === 'build-type') return 'debug';
                return '';
            }) as typeof mockedGhInputs.getInput);

            const schema = {
                buildVariant: {
                    type: 'string' as const,
                    default: '',
                    description: 'Build variant (preferred)'
                },
                buildType: {
                    type: 'string' as const,
                    default: '',
                    description: 'Build type (fallback)',
                    crossTransform: (v: unknown, inputs: Record<string, unknown>) =>
                        ((inputs.buildVariant as string) || (v as string)).toLowerCase()
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.buildType).toBe('release');
        });

        it('should convert snake_case to kebab-case', () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const schema = {
                checkLatest: {
                    type: 'boolean' as const,
                    default: false,
                    description: 'Check latest'
                }
            } satisfies ActionInputsSchema;

            parseInputs(schema);

            expect(mockedGhInputs.getBoolean).toHaveBeenCalledWith(
                'check-latest',
                expect.any(Object)
            );
        });

        it('should pass fallbackEnv to options', () => {
            mockedGhInputs.getNormalizedPath.mockReturnValue('/usr/bin/gcc');

            const schema = {
                cc: {
                    type: 'path' as const,
                    default: '',
                    fallbackEnv: 'CC',
                    description: 'C compiler'
                }
            } satisfies ActionInputsSchema;

            parseInputs(schema);

            expect(mockedGhInputs.getNormalizedPath).toHaveBeenCalledWith(
                'cc',
                expect.objectContaining({ fallbackEnv: 'CC' })
            );
        });

        it('should parse number inputs', () => {
            mockedGhInputs.getInt.mockReturnValue(42);

            const schema = {
                count: {
                    type: 'number' as const,
                    default: 0,
                    description: 'Count'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.count).toBe(42);
        });

        it('should parse tribool inputs', () => {
            mockedGhInputs.getTribool.mockReturnValue(undefined);

            const schema = {
                maybe: {
                    type: 'tribool' as const,
                    description: 'Maybe enabled'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.maybe).toBeUndefined();
        });

        it('should parse map inputs', () => {
            mockedGhInputs.getMap.mockReturnValue({ key: 'value' });

            const schema = {
                config: {
                    type: 'map' as const,
                    description: 'Configuration'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.config).toEqual({ key: 'value' });
        });

        it('should parse set inputs', () => {
            mockedGhInputs.getSet.mockReturnValue(new Set(['a', 'b', 'c']));

            const schema = {
                items: {
                    type: 'set' as const,
                    default: new Set<string>(),
                    description: 'Unique items'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.items).toEqual(new Set(['a', 'b', 'c']));
            expect(mockedGhInputs.getSet).toHaveBeenCalledWith(
                'items',
                undefined,
                undefined,
                expect.objectContaining({ defaultValue: [] })
            );
        });

        it('should parse multilineSet inputs', () => {
            mockedGhInputs.getMultilineInput.mockReturnValue(['x', 'y', 'x']);

            const schema = {
                dirs: {
                    type: 'multilineSet' as const,
                    default: new Set(['.']) as Set<string>,
                    description: 'Directories'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.dirs).toEqual(new Set(['x', 'y']));
            expect(mockedGhInputs.getMultilineInput).toHaveBeenCalledWith(
                'dirs',
                expect.objectContaining({ defaultValue: ['.'] })
            );
        });

        it('should apply transform to set inputs', () => {
            mockedGhInputs.getSet.mockReturnValue(new Set(['  A  ', 'B']));

            const schema: ActionInputsSchema = {
                tags: {
                    type: 'set',
                    default: new Set<string>(),
                    description: 'Tags',
                    transform: (s) => new Set([...(s as Set<string>)].map(v => v.trim().toLowerCase()))
                }
            };

            const result = parseInputs(schema);

            expect(result.tags).toEqual(new Set(['a', 'b']));
        });

        it('should pass through valid values with validValues', () => {
            mockedGhInputs.getInput.mockReturnValue('git');

            const schema = {
                strategy: {
                    type: 'string' as const,
                    default: 'auto' as const,
                    validValues: ['auto', 'git', 'archive'] as const,
                    description: 'Strategy'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.strategy).toBe('git');
        });

        it('should fall back to default for invalid validValues', () => {
            mockedGhInputs.getInput.mockReturnValue('invalid');

            const schema = {
                strategy: {
                    type: 'string' as const,
                    default: 'auto' as const,
                    validValues: ['auto', 'git', 'archive'] as const,
                    description: 'Strategy'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.strategy).toBe('auto');
        });
    });

    describe('generateInputsSection', () => {
        it('should generate inputs for action.yml', () => {
            const schema = {
                version: {
                    type: 'string' as const,
                    default: '*',
                    description: 'Version to use'
                },
                enabled: {
                    type: 'boolean' as const,
                    default: true,
                    required: false,
                    description: 'Enable feature'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result).toEqual({
                version: {
                    description: 'Version to use',
                    required: false,
                    default: '*'
                },
                enabled: {
                    description: 'Enable feature',
                    required: false,
                    default: 'true'
                }
            });
        });

        it('should convert snake_case to kebab-case in output', () => {
            const schema = {
                checkLatest: {
                    type: 'boolean' as const,
                    default: false,
                    description: 'Check latest'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result['check-latest']).toBeDefined();
            expect(result['checkLatest']).toBeUndefined();
        });

        it('should mark required inputs', () => {
            const schema = {
                name: {
                    type: 'string' as const,
                    required: true,
                    description: 'Required name'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.name.required).toBe(true);
        });

        it('should handle array defaults', () => {
            const schema = {
                items: {
                    type: 'string[]' as const,
                    default: ['a', 'b'],
                    description: 'Items'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.items.default).toBe('a\nb');
        });

        it('should handle set defaults', () => {
            const schema = {
                items: {
                    type: 'set' as const,
                    default: new Set(['x', 'y']),
                    description: 'Set items'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.items.default).toBe('x\ny');
        });

        it('should handle regex defaults', () => {
            const schema = {
                pattern: {
                    type: 'regex' as const,
                    default: /v\d+\.\d+/,
                    description: 'Version pattern'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.pattern.default).toBe('v\\d+\\.\\d+');
        });

        it('should handle empty set defaults', () => {
            const schema = {
                items: {
                    type: 'multilineSet' as const,
                    default: new Set<string>(),
                    description: 'Multiline set'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.items.default).toBe('');
        });
    });

    describe('generateOutputsSection', () => {
        it('should generate outputs for action.yml', () => {
            const schema = {
                version: {
                    description: 'Installed version'
                },
                path: {
                    description: 'Installation path'
                }
            } satisfies ActionOutputsSchema;

            const result = generateOutputsSection(schema);

            expect(result).toEqual({
                version: { description: 'Installed version' },
                path: { description: 'Installation path' }
            });
        });

        it('should convert snake_case to kebab-case', () => {
            const schema = {
                versionMajor: {
                    description: 'Major version'
                }
            } satisfies ActionOutputsSchema;

            const result = generateOutputsSection(schema);

            expect(result['version-major']).toBeDefined();
        });
    });

    describe('shared schemas', () => {
        it('should export baseInputs with traceCommands', () => {
            expect(actionSchema.baseInputs.traceCommands).toBeDefined();
            expect(actionSchema.baseInputs.traceCommands.type).toBe('boolean');
            expect(actionSchema.baseInputs.traceCommands.default).toBe(false);
        });

        it('should export setupInputs with common fields', () => {
            expect(actionSchema.setupInputs.version).toBeDefined();
            expect(actionSchema.setupInputs.path).toBeDefined();
            expect(actionSchema.setupInputs.checkLatest).toBeDefined();
            expect(actionSchema.setupInputs.updateEnvironment).toBeDefined();
            expect(actionSchema.setupInputs.traceCommands).toBeDefined();
        });

        it('should export compilerOutputs', () => {
            expect(actionSchema.compilerOutputs.cc).toBeDefined();
            expect(actionSchema.compilerOutputs.cxx).toBeDefined();
            expect(actionSchema.compilerOutputs.version).toBeDefined();
        });
    });

    describe('type inference', () => {
        it('should correctly infer types from schema', () => {
            const _schema = {
                name: { type: 'string' as const, default: '', description: '' },
                enabled: { type: 'boolean' as const, default: false, description: '' },
                count: { type: 'number' as const, description: '' },
                items: { type: 'string[]' as const, default: [] as string[], description: '' }
            } satisfies ActionInputsSchema;

            // This is a compile-time check - if types are wrong, this won't compile
            type Inputs = InferInputs<typeof _schema>;

            // Verify the type structure (runtime check for test purposes)
            const example: Inputs = {
                name: 'test',
                enabled: true,
                count: 42,
                items: ['a', 'b']
            };

            expect(example.name).toBe('test');
            expect(example.enabled).toBe(true);
            expect(example.count).toBe(42);
            expect(example.items).toEqual(['a', 'b']);
        });

        it('should infer set and multilineSet types', () => {
            const _schema = {
                tags: { type: 'set' as const, default: new Set<string>(), description: '' },
                dirs: { type: 'multilineSet' as const, default: new Set(['.']) as Set<string>, description: '' }
            } satisfies ActionInputsSchema;

            type Inputs = InferInputs<typeof _schema>;

            const example: Inputs = {
                tags: new Set(['a']),
                dirs: new Set(['.', 'src'])
            };

            expect(example.tags).toBeInstanceOf(Set);
            expect(example.dirs).toBeInstanceOf(Set);
        });

        it('should infer regex type', () => {
            const _schema = {
                pattern: { type: 'regex' as const, default: /.*/, description: '' }
            } satisfies ActionInputsSchema;

            type Inputs = InferInputs<typeof _schema>;

            const example: Inputs = { pattern: /test/ };
            expect(example.pattern).toBeInstanceOf(RegExp);
        });

        it('should infer transformed types from type-changing transforms', () => {
            const _schema = {
                pattern: {
                    type: 'string' as const,
                    default: '',
                    description: '',
                    transform: (v) => new RegExp(v as string)
                },
                pairs: {
                    type: 'string[]' as const,
                    default: [] as string[],
                    description: '',
                    transform: (v) => {
                        const record: Record<string, string> = {};
                        for (const item of v as string[]) {
                            const [key, val] = item.split(':');
                            record[key] = val;
                        }
                        return record;
                    }
                },
                name: {
                    type: 'string' as const,
                    default: '',
                    description: '',
                    transform: (v) => (v as string).trim()
                }
            } satisfies ActionInputsSchema;

            // Compile-time check: pattern is RegExp, pairs is Record, name is string
            type Inputs = InferInputs<typeof _schema>;

            const example: Inputs = {
                pattern: /test/,
                pairs: { key: 'value' },
                name: 'hello'
            };

            expect(example.pattern).toBeInstanceOf(RegExp);
            expect(example.pairs).toEqual({ key: 'value' });
            expect(example.name).toBe('hello');
        });

        it('should infer cross-transform return types', () => {
            const _schema = {
                sourceDir: {
                    type: 'string' as const,
                    default: '.',
                    description: ''
                },
                outputPath: {
                    type: 'string' as const,
                    default: 'out',
                    description: '',
                    crossTransform: (v: unknown, inputs: Record<string, unknown>) =>
                        require('path').resolve(inputs.sourceDir as string, v as string) as string
                },
                pattern: {
                    type: 'string' as const,
                    default: '',
                    description: '',
                    crossTransform: (v: unknown) => new RegExp(v as string)
                }
            } satisfies ActionInputsSchema;

            type Inputs = InferInputs<typeof _schema>;

            // Compile-time: sourceDir is string, outputPath is string, pattern is RegExp
            const example: Inputs = {
                sourceDir: '/home',
                outputPath: '/home/out',
                pattern: /test/
            };

            expect(example.sourceDir).toBe('/home');
            expect(example.outputPath).toBe('/home/out');
            expect(example.pattern).toBeInstanceOf(RegExp);
        });

        it('should narrow types with validValues as const', () => {
            const _schema = {
                strategy: {
                    type: 'string' as const,
                    default: 'auto' as const,
                    validValues: ['auto', 'git', 'archive'] as const,
                    description: ''
                }
            } satisfies ActionInputsSchema;

            type Inputs = InferInputs<typeof _schema>;

            // Compile-time: strategy is 'auto' | 'git' | 'archive', not string
            const example: Inputs = { strategy: 'git' };

            expect(example.strategy).toBe('git');
        });
    });
});
