import * as actionSchema from './index';
import { parseInputs, createInputParser } from './parser';
import {
    generateInputsSection,
    generateOutputsSection,
    updateActionYml,
    updateMultipleActionYmls
} from './generators/action-yml';
import { createActionRunner, createActionMain, runAction } from './runner';
import { ExpectedError } from 'pretty-errors';
import {
    createSetupInputs,
    createCompilerPrefixRemover,
    createCompilerOutputs
} from './shared-schemas';
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
    reportAndSetFailed: jest.fn(),
    ExpectedError: jest.requireActual('pretty-errors').ExpectedError
}));

// Mock fs for action-yml tests
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn()
}));

import * as ghInputs from 'gh-inputs';
import * as core from '@actions/core';
import * as fs from 'fs';

const mockedGhInputs = ghInputs as jest.Mocked<typeof ghInputs>;
const mockedFs = fs as jest.Mocked<typeof fs>;

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

    describe('createActionRunner', () => {
        const schema = {
            traceCommands: {
                type: 'boolean' as const,
                default: false,
                description: 'Trace commands'
            },
            version: {
                type: 'string' as const,
                default: '*',
                description: 'Version'
            }
        } satisfies ActionInputsSchema;

        it('should parse inputs, log them, call main, and set outputs', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);
            mockedGhInputs.getInput.mockReturnValue('1.2.3');

            const mainFn = jest.fn().mockResolvedValue({ cc: '/usr/bin/gcc', cxx: '/usr/bin/g++' });

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: mainFn
            });

            await run();

            expect(core.startGroup).toHaveBeenCalledWith('📥 Action Inputs');
            expect(mockedGhInputs.printInputObject).toHaveBeenCalled();
            expect(core.endGroup).toHaveBeenCalledTimes(2);
            expect(mainFn).toHaveBeenCalledWith(expect.objectContaining({ version: '1.2.3' }));
            expect(core.startGroup).toHaveBeenCalledWith('📤 Action Outputs');
            expect(mockedGhInputs.setOutputObject).toHaveBeenCalledWith({ cc: '/usr/bin/gcc', cxx: '/usr/bin/g++' });
        });

        it('should enable trace commands when traceCommands input is true', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(true);
            mockedGhInputs.getInput.mockReturnValue('*');

            const traceCommandsMock = require('trace-commands');

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: jest.fn().mockResolvedValue({})
            });

            await run();

            expect(traceCommandsMock.setTraceCommands).toHaveBeenCalledWith(true);
        });

        it('should not enable trace commands when traceCommands input is false', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);
            mockedGhInputs.getInput.mockReturnValue('*');

            const traceCommandsMock = require('trace-commands');

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: jest.fn().mockResolvedValue({})
            });

            await run();

            expect(traceCommandsMock.setTraceCommands).not.toHaveBeenCalled();
        });

        it('should throw ExpectedError when validateOutputs returns false', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);
            mockedGhInputs.getInput.mockReturnValue('*');

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: jest.fn().mockResolvedValue({ cc: '' }),
                validateOutputs: () => false
            });

            await expect(run()).rejects.toThrow(ExpectedError);
            await expect(run()).rejects.toThrow('Test Action failed: output validation failed');
            expect(mockedGhInputs.setOutputObject).not.toHaveBeenCalled();
        });

        it('should use custom failureMessage when validateOutputs returns false', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);
            mockedGhInputs.getInput.mockReturnValue('*');

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: jest.fn().mockResolvedValue({}),
                validateOutputs: () => false,
                failureMessage: 'Custom failure message'
            });

            await expect(run()).rejects.toThrow(ExpectedError);
            await expect(run()).rejects.toThrow('Custom failure message');
        });

        it('should proceed normally when validateOutputs returns true', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);
            mockedGhInputs.getInput.mockReturnValue('*');

            const run = createActionRunner({
                inputsSchema: schema,
                title: 'Test Action',
                main: jest.fn().mockResolvedValue({ result: 'ok' }),
                validateOutputs: () => true
            });

            await expect(run()).resolves.not.toThrow();
            expect(mockedGhInputs.setOutputObject).toHaveBeenCalledWith({ result: 'ok' });
        });
    });

    describe('runAction', () => {
        const schema = {
            traceCommands: {
                type: 'boolean' as const,
                default: false,
                description: 'Trace commands'
            }
        } satisfies ActionInputsSchema;

        it('should skip execution when callerModule is not the main module', () => {
            const mainFn = jest.fn();

            runAction({
                inputsSchema: schema,
                title: 'Test Action',
                main: mainFn,
                callerModule: { id: 'not-main' } as NodeModule
            });

            expect(mainFn).not.toHaveBeenCalled();
        });

        it('should execute when callerModule is not provided', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const mainFn = jest.fn().mockResolvedValue({});

            runAction({
                inputsSchema: schema,
                title: 'Test Action',
                main: mainFn
            });

            // Wait for async execution
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mainFn).toHaveBeenCalled();
        });

        it('should call reportAndSetFailed when main throws', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const error = new Error('Action failed');
            const mainFn = jest.fn().mockRejectedValue(error);
            const prettyErrors = require('pretty-errors');

            runAction({
                inputsSchema: schema,
                title: 'My Action',
                main: mainFn
            });

            // Wait for async execution
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(prettyErrors.reportAndSetFailed).toHaveBeenCalledWith(
                error,
                { title: 'My Action failed' }
            );
        });
    });

    describe('createActionMain', () => {
        const schema = {
            traceCommands: {
                type: 'boolean' as const,
                default: false,
                description: 'Trace commands'
            }
        } satisfies ActionInputsSchema;

        it('should return a callable async function', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const mainFn = jest.fn().mockResolvedValue({ result: 'ok' });

            const main = createActionMain({
                inputsSchema: schema,
                title: 'Test Action',
                main: mainFn
            });

            expect(typeof main).toBe('function');
            await main();

            expect(mainFn).toHaveBeenCalled();
        });

        it('should catch errors and call reportAndSetFailed', async () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const error = new Error('Boom');
            const mainFn = jest.fn().mockRejectedValue(error);
            const prettyErrors = require('pretty-errors');

            const main = createActionMain({
                inputsSchema: schema,
                title: 'My Action',
                main: mainFn
            });

            await main();

            expect(prettyErrors.reportAndSetFailed).toHaveBeenCalledWith(
                error,
                { title: 'My Action failed' }
            );
        });
    });

    describe('createSetupInputs', () => {
        it('should customize descriptions with tool name', () => {
            const inputs = createSetupInputs('CMake');

            expect(inputs.version.description).toContain('CMake');
            expect(inputs.path.description).toContain('CMake');
            expect(inputs.checkLatest.description).toContain('CMake');
        });

        it('should preserve base input types and defaults', () => {
            const inputs = createSetupInputs('GCC');

            expect(inputs.traceCommands.type).toBe('boolean');
            expect(inputs.traceCommands.default).toBe(false);
            expect(inputs.version.type).toBe('string');
            expect(inputs.version.default).toBe('*');
            expect(inputs.path.type).toBe('string[]');
            expect(inputs.checkLatest.type).toBe('boolean');
            expect(inputs.checkLatest.default).toBe(false);
            expect(inputs.updateEnvironment.type).toBe('boolean');
            expect(inputs.updateEnvironment.default).toBe(true);
        });
    });

    describe('createCompilerPrefixRemover', () => {
        it('should remove cc prefix with dash', () => {
            const remove = createCompilerPrefixRemover('gcc', 'g++');
            expect(remove('gcc-12')).toBe('12');
        });

        it('should remove cxx prefix with dash', () => {
            const remove = createCompilerPrefixRemover('gcc', 'g++');
            expect(remove('g++-12')).toBe('12');
        });

        it('should remove cc prefix with space', () => {
            const remove = createCompilerPrefixRemover('gcc', 'g++');
            expect(remove('gcc 12')).toBe('12');
        });

        it('should remove cxx prefix with space', () => {
            const remove = createCompilerPrefixRemover('gcc', 'g++');
            expect(remove('g++ 12')).toBe('12');
        });

        it('should return version unchanged when no prefix matches', () => {
            const remove = createCompilerPrefixRemover('gcc', 'g++');
            expect(remove('14')).toBe('14');
        });

        it('should work with clang prefixes', () => {
            const remove = createCompilerPrefixRemover('clang', 'clang++');
            expect(remove('clang-15')).toBe('15');
            expect(remove('clang++-15')).toBe('15');
            expect(remove('clang 16')).toBe('16');
            expect(remove('clang++ 16')).toBe('16');
            expect(remove('17')).toBe('17');
        });
    });

    describe('createCompilerOutputs', () => {
        it('should customize descriptions with tool and compiler names', () => {
            const outputs = createCompilerOutputs('GCC', 'gcc', 'g++');

            expect(outputs.cc.description).toContain('gcc');
            expect(outputs.cxx.description).toContain('g++');
            expect(outputs.dir.description).toContain('GCC');
            expect(outputs.version.description).toContain('GCC');
            expect(outputs.versionMajor.description).toContain('GCC');
            expect(outputs.versionMinor.description).toContain('GCC');
            expect(outputs.versionPatch.description).toContain('GCC');
        });

        it('should return all required output fields', () => {
            const outputs = createCompilerOutputs('Clang', 'clang', 'clang++');

            expect(outputs).toHaveProperty('cc');
            expect(outputs).toHaveProperty('cxx');
            expect(outputs).toHaveProperty('dir');
            expect(outputs).toHaveProperty('version');
            expect(outputs).toHaveProperty('versionMajor');
            expect(outputs).toHaveProperty('versionMinor');
            expect(outputs).toHaveProperty('versionPatch');
        });
    });

    describe('parseInputs - multiline type', () => {
        it('should parse multiline inputs', () => {
            mockedGhInputs.getMultilineInput.mockReturnValue(['line1', 'line2', 'line3']);

            const schema = {
                content: {
                    type: 'multiline' as const,
                    default: [] as string[],
                    description: 'Multiline content'
                }
            } satisfies ActionInputsSchema;

            const result = parseInputs(schema);

            expect(result.content).toEqual(['line1', 'line2', 'line3']);
            expect(mockedGhInputs.getMultilineInput).toHaveBeenCalledWith(
                'content',
                expect.any(Object)
            );
        });
    });

    describe('createInputParser', () => {
        it('should return a reusable parser function', () => {
            mockedGhInputs.getInput.mockReturnValue('hello');

            const schema = {
                name: {
                    type: 'string' as const,
                    default: '',
                    description: 'Name'
                }
            } satisfies ActionInputsSchema;

            const parser = createInputParser(schema);
            expect(typeof parser).toBe('function');

            const result = parser();
            expect(result.name).toBe('hello');
        });
    });

    describe('generateInputsSection - additional types', () => {
        it('should handle number defaults', () => {
            const schema = {
                retries: {
                    type: 'number' as const,
                    default: 3,
                    description: 'Number of retries'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.retries.default).toBe('3');
        });

        it('should handle map defaults', () => {
            const schema = {
                env: {
                    type: 'map' as const,
                    default: { CC: 'gcc', CXX: 'g++' } as Record<string, string>,
                    description: 'Environment variables'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.env.default).toBe('CC: gcc\nCXX: g++');
        });

        it('should handle empty map defaults', () => {
            const schema = {
                env: {
                    type: 'map' as const,
                    default: {} as Record<string, string>,
                    description: 'Environment variables'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.env.default).toBe('');
        });

        it('should handle multiline defaults', () => {
            const schema = {
                lines: {
                    type: 'multiline' as const,
                    default: ['first', 'second'],
                    description: 'Lines'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.lines.default).toBe('first\nsecond');
        });

        it('should handle tribool defaults', () => {
            const schema = {
                flag: {
                    type: 'tribool' as const,
                    default: true,
                    description: 'A tribool flag'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.flag.default).toBe('true');
        });

        it('should handle path defaults', () => {
            const schema = {
                dir: {
                    type: 'path' as const,
                    default: '/usr/local',
                    description: 'Directory'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.dir.default).toBe('/usr/local');
        });

        it('should omit default when undefined', () => {
            const schema = {
                name: {
                    type: 'string' as const,
                    required: true,
                    description: 'Required input with no default'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result.name.default).toBeUndefined();
            expect(result.name.required).toBe(true);
        });
    });

    describe('updateActionYml', () => {
        const sampleActionYml = `name: 'Test Action'
description: 'A test action'
inputs:
  old-input:
    description: 'Old input'
    required: false
    default: 'old'
outputs:
  old-output:
    description: 'Old output'
runs:
  using: 'node20'
  main: 'dist/index.js'
`;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should update inputs section from schema', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleActionYml);

            const inputsSchema = {
                version: {
                    type: 'string' as const,
                    default: '*',
                    description: 'Version to use'
                }
            } satisfies ActionInputsSchema;

            const result = await updateActionYml({
                actionYmlPath: '/test/action.yml',
                inputsSchema
            });

            expect(result.inputsCount).toBe(1);
            expect(result.modified).toBe(true);
            expect(result.content).toContain('version');
            expect(mockedFs.writeFileSync).toHaveBeenCalled();
        });

        it('should update outputs section from schema', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleActionYml);

            const outputsSchema = {
                path: {
                    description: 'Installation path'
                }
            } satisfies ActionOutputsSchema;

            const result = await updateActionYml({
                actionYmlPath: '/test/action.yml',
                outputsSchema
            });

            expect(result.outputsCount).toBe(1);
            expect(result.modified).toBe(true);
            expect(result.content).toContain('path');
        });

        it('should perform dry run without writing', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleActionYml);

            const inputsSchema = {
                newInput: {
                    type: 'string' as const,
                    default: 'val',
                    description: 'New input'
                }
            } satisfies ActionInputsSchema;

            const result = await updateActionYml({
                actionYmlPath: '/test/action.yml',
                inputsSchema,
                dryRun: true
            });

            expect(result.modified).toBe(true);
            expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
        });

        it('should throw when file does not exist', async () => {
            mockedFs.existsSync.mockReturnValue(false);

            await expect(
                updateActionYml({ actionYmlPath: '/nonexistent/action.yml' })
            ).rejects.toThrow('action.yml not found');
        });

        it('should report not modified when content is unchanged', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleActionYml);

            // No schemas provided, so nothing changes
            const result = await updateActionYml({
                actionYmlPath: '/test/action.yml'
            });

            expect(result.inputsCount).toBe(0);
            expect(result.outputsCount).toBe(0);
            expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
        });

        it('should update both inputs and outputs together', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleActionYml);

            const inputsSchema = {
                version: {
                    type: 'string' as const,
                    default: '*',
                    description: 'Version'
                },
                checkLatest: {
                    type: 'boolean' as const,
                    default: false,
                    description: 'Check latest'
                }
            } satisfies ActionInputsSchema;

            const outputsSchema = {
                cc: { description: 'C compiler' },
                cxx: { description: 'C++ compiler' }
            } satisfies ActionOutputsSchema;

            const result = await updateActionYml({
                actionYmlPath: '/test/action.yml',
                inputsSchema,
                outputsSchema
            });

            expect(result.inputsCount).toBe(2);
            expect(result.outputsCount).toBe(2);
            expect(result.modified).toBe(true);
        });
    });

    describe('updateMultipleActionYmls', () => {
        const sampleYml = `name: 'Action'
description: 'An action'
inputs: {}
outputs: {}
runs:
  using: 'node20'
  main: 'dist/index.js'
`;

        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('should update multiple action.yml files', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleYml);

            const actions = [
                {
                    actionYmlPath: '/action1/action.yml',
                    inputsSchema: {
                        version: {
                            type: 'string' as const,
                            default: '*',
                            description: 'Version'
                        }
                    } satisfies ActionInputsSchema
                },
                {
                    actionYmlPath: '/action2/action.yml',
                    outputsSchema: {
                        result: { description: 'Result' }
                    } satisfies ActionOutputsSchema
                }
            ];

            const results = await updateMultipleActionYmls(actions);

            expect(results).toHaveLength(2);
            expect(results[0].inputsCount).toBe(1);
            expect(results[1].outputsCount).toBe(1);
        });

        it('should support dry run for multiple files', async () => {
            mockedFs.existsSync.mockReturnValue(true);
            mockedFs.readFileSync.mockReturnValue(sampleYml);

            const actions = [
                {
                    actionYmlPath: '/action1/action.yml',
                    inputsSchema: {
                        v: { type: 'string' as const, default: '', description: 'V' }
                    } satisfies ActionInputsSchema
                }
            ];

            const results = await updateMultipleActionYmls(actions, true);

            expect(results).toHaveLength(1);
            expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
        });
    });
});
