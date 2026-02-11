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
    getNormalizedPath: jest.fn(),
    getMultilineInput: jest.fn(),
    getTribool: jest.fn(),
    getMap: jest.fn(),
    printInputObject: jest.fn(),
    setOutputObject: jest.fn()
}));

// Mock trace-commands
jest.mock('trace-commands', () => ({
    set_trace_commands: jest.fn()
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

        it('should convert snake_case to kebab-case', () => {
            mockedGhInputs.getBoolean.mockReturnValue(false);

            const schema = {
                check_latest: {
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
                check_latest: {
                    type: 'boolean' as const,
                    default: false,
                    description: 'Check latest'
                }
            } satisfies ActionInputsSchema;

            const result = generateInputsSection(schema);

            expect(result['check-latest']).toBeDefined();
            expect(result['check_latest']).toBeUndefined();
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
                version_major: {
                    description: 'Major version'
                }
            } satisfies ActionOutputsSchema;

            const result = generateOutputsSection(schema);

            expect(result['version-major']).toBeDefined();
        });
    });

    describe('shared schemas', () => {
        it('should export baseInputs with trace_commands', () => {
            expect(actionSchema.baseInputs.trace_commands).toBeDefined();
            expect(actionSchema.baseInputs.trace_commands.type).toBe('boolean');
            expect(actionSchema.baseInputs.trace_commands.default).toBe(false);
        });

        it('should export setupInputs with common fields', () => {
            expect(actionSchema.setupInputs.version).toBeDefined();
            expect(actionSchema.setupInputs.path).toBeDefined();
            expect(actionSchema.setupInputs.check_latest).toBeDefined();
            expect(actionSchema.setupInputs.update_environment).toBeDefined();
            expect(actionSchema.setupInputs.trace_commands).toBeDefined();
        });

        it('should export compilerOutputs', () => {
            expect(actionSchema.compilerOutputs.cc).toBeDefined();
            expect(actionSchema.compilerOutputs.cxx).toBeDefined();
            expect(actionSchema.compilerOutputs.version).toBeDefined();
        });
    });

    describe('type inference', () => {
        it('should correctly infer types from schema', () => {
            const schema = {
                name: { type: 'string' as const, default: '', description: '' },
                enabled: { type: 'boolean' as const, default: false, description: '' },
                count: { type: 'number' as const, description: '' },
                items: { type: 'string[]' as const, default: [] as string[], description: '' }
            } satisfies ActionInputsSchema;

            // This is a compile-time check - if types are wrong, this won't compile
            type Inputs = InferInputs<typeof schema>;

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
    });
});
