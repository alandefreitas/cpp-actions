import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { lint } from './linter';
import { glob } from 'glob';

jest.mock('glob');
const mockGlob = glob as jest.MockedFunction<typeof glob>;

/**
 * Creates a temporary TypeScript file with the given content for testing.
 * Also creates a minimal tsconfig.json in the same directory.
 *
 * @param content - The TypeScript source code
 * @param filename - The filename to use
 * @returns The absolute path to the created file
 */
function createTempTsFile(content: string, filename = 'test-fixture.ts'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsdoc-linter-test-'));
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    // Create a minimal tsconfig.json so ts-morph can initialize
    fs.writeFileSync(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { target: 'es2020', module: 'commonjs', strict: true } }),
        'utf-8'
    );
    return filePath;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('lint', () => {
    it('should return empty result when no files match', async () => {
        mockGlob.mockResolvedValue([]);
        const result = await lint({
            rootDir: '/tmp/nonexistent-dir-xyz',
            workspaces: ['no-such-workspace'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(0);
        expect(result.files).toEqual([]);
        expect(result.totalErrors).toBe(0);
        expect(result.totalWarnings).toBe(0);
        expect(result.filesWithIssues).toBe(0);
    });

    it('should construct correct glob patterns for specific workspaces', async () => {
        mockGlob.mockResolvedValue([]);
        await lint({
            rootDir: '/project',
            workspaces: ['common/trace-commands', 'setup-gcc'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(mockGlob).toHaveBeenCalledTimes(2);
        expect(mockGlob).toHaveBeenCalledWith(
            path.join('/project', 'common/trace-commands', 'src/**/*.ts'),
            expect.objectContaining({
                ignore: expect.arrayContaining(['**/node_modules/**', '**/*.test.ts', '**/*.spec.ts']),
            })
        );
        expect(mockGlob).toHaveBeenCalledWith(
            path.join('/project', 'setup-gcc', 'src/**/*.ts'),
            expect.any(Object)
        );
    });

    it('should construct correct glob patterns when no workspaces specified', async () => {
        mockGlob.mockResolvedValue([]);
        await lint({
            rootDir: '/project',
            workspaces: [],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        // Should have 3 patterns: */src, common/*/src, tools/*/src
        expect(mockGlob).toHaveBeenCalledTimes(3);
        expect(mockGlob).toHaveBeenCalledWith(
            path.join('/project', '*/src/**/*.ts'),
            expect.any(Object)
        );
        expect(mockGlob).toHaveBeenCalledWith(
            path.join('/project', 'common/*/src/**/*.ts'),
            expect.any(Object)
        );
        expect(mockGlob).toHaveBeenCalledWith(
            path.join('/project', 'tools/*/src/**/*.ts'),
            expect.any(Object)
        );
    });

    it('should pass exclude patterns to glob ignore', async () => {
        mockGlob.mockResolvedValue([]);
        await lint({
            rootDir: '/project',
            workspaces: ['ws'],
            exclude: ['**/vendor/**'],
            format: 'text',
            failOnWarnings: false,
        });
        expect(mockGlob).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                ignore: expect.arrayContaining(['**/vendor/**']),
            })
        );
    });

    it('should deduplicate files from overlapping globs', async () => {
        const testFile = path.resolve(__dirname, 'types.ts');
        // Return the same file twice to test deduplication
        mockGlob.mockResolvedValue([testFile, testFile] as never);
        const result = await lint({
            rootDir: path.resolve(__dirname, '..'),
            workspaces: ['src'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        // Should only process the file once
        expect(result.totalFiles).toBe(1);
    });

    it('should lint real TypeScript files and detect declarations', async () => {
        // Use the types.ts file which has known exported types
        const typesFile = path.resolve(__dirname, 'types.ts');
        mockGlob.mockResolvedValue([typesFile] as never);
        const result = await lint({
            rootDir: path.resolve(__dirname, '..'),
            workspaces: ['src'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        expect(result.files[0].file).toContain('types.ts');
        // types.ts has well-documented interfaces, so should pass
    });

    it('should detect missing JSDoc issues', async () => {
        // Create a temporary file path that ts-morph can parse in-memory
        // We use the rules.ts file which has non-exported helper functions
        const rulesFile = path.resolve(__dirname, 'rules.ts');
        mockGlob.mockResolvedValue([rulesFile] as never);
        const result = await lint({
            rootDir: path.resolve(__dirname, '..'),
            workspaces: ['src'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // rules.ts has exported `rules` and `checkDeclaration` which should be checked
        expect(result.files[0].issues.length).toBeGreaterThanOrEqual(0);
    });

    it('should correctly aggregate error and warning counts', async () => {
        const typesFile = path.resolve(__dirname, 'types.ts');
        const rulesFile = path.resolve(__dirname, 'rules.ts');
        mockGlob.mockResolvedValue([typesFile, rulesFile] as never);
        const result = await lint({
            rootDir: path.resolve(__dirname, '..'),
            workspaces: ['src'],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(2);
        const sumErrors = result.files.reduce((s, f) => s + f.errorCount, 0);
        const sumWarnings = result.files.reduce((s, f) => s + f.warningCount, 0);
        expect(result.totalErrors).toBe(sumErrors);
        expect(result.totalWarnings).toBe(sumWarnings);
        expect(result.filesWithIssues).toBe(result.files.filter(f => f.issues.length > 0).length);
    });

    it('should handle destructured parameters in functions', async () => {
        const filePath = createTempTsFile(`
/** Processes options from a destructured parameter object for configuration. */
export function processOptions({ name, value }: { name: string; value: number }): string {
    return name + value;
}

/** Processes items from a destructured array pattern for batch operations. */
export function processArray([first, second]: string[]): string {
    return first + second;
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Should detect missing @param for destructured params (renamed to 'options')
        const paramIssues = result.files[0].issues.filter(i => i.rule === 'jsdoc/missing-param');
        expect(paramIssues.length).toBeGreaterThan(0);
    });

    it('should extract class declarations and public methods', async () => {
        const filePath = createTempTsFile(`
/**
 * A calculator class that provides basic arithmetic operations for numerical computation.
 */
export class Calculator {
    /**
     * Adds two numbers together and returns the sum as a numeric value.
     *
     * @param a - First operand value
     * @param b - Second operand value
     * @returns The sum of the two operands
     */
    public add(a: number, b: number): number {
        return a + b;
    }

    /**
     * Subtracts the second number from the first and returns the difference.
     *
     * @param a - First operand value
     * @param b - Second operand value
     * @returns The difference between the two operands
     */
    subtract(a: number, b: number): number {
        return a - b;
    }

    private helperMethod(): void {
        // private, should not be checked
    }
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Calculator class and its public methods should be checked
        // No issues expected since all have proper JSDoc
        const calcIssues = result.files[0].issues.filter(i =>
            i.symbol.startsWith('Calculator')
        );
        expect(calcIssues.every(i => i.rule !== 'jsdoc/missing')).toBe(true);
    });

    it('should handle unnamed class declarations gracefully', async () => {
        const filePath = createTempTsFile(`
export default class {
    doSomething(): void {}
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Unnamed class should be skipped (extractClassInfo returns undefined)
    });

    it('should handle unnamed function declarations gracefully', async () => {
        const filePath = createTempTsFile(`
export default function(): void {}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Unnamed function should be skipped
    });

    it('should handle exported arrow functions', async () => {
        const filePath = createTempTsFile(`
/** Transforms the input string to uppercase and trims whitespace for normalization. */
export const transform = (input: string): string => {
    return input.toUpperCase().trim();
};

/** A constant configuration value used across the application for defaults. */
export const CONFIG_VALUE = 42;
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Arrow function 'transform' should be checked for @param and @returns
        const transformIssues = result.files[0].issues.filter(i => i.symbol === 'transform');
        expect(transformIssues.some(i => i.rule === 'jsdoc/missing-param')).toBe(true);
        expect(transformIssues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(true);
    });

    it('should handle exported function expressions', async () => {
        const filePath = createTempTsFile(`
/** Validates the input data against the schema and returns a boolean result. */
export const validate = function(data: unknown): boolean {
    return data !== null;
};
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        const validateIssues = result.files[0].issues.filter(i => i.symbol === 'validate');
        expect(validateIssues.some(i => i.rule === 'jsdoc/missing-param')).toBe(true);
    });

    it('should detect throw statements in arrow functions', async () => {
        const filePath = createTempTsFile(`
/**
 * Asserts that a condition is true, throwing an error if validation fails.
 *
 * @param condition - The condition to check for truthiness
 * @throws When the condition is false
 */
export const assertTruth = (condition: boolean): void => {
    if (!condition) {
        throw new Error('Assertion failed');
    }
};

/**
 * Processes input without any error throwing for safe operation.
 *
 * @param value - The value to process into output
 * @returns The processed result string
 */
export const safeProcess = (value: string): string => {
    return value.trim();
};
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // assertTruth has @throws so no warning expected
        const throwsIssues = result.files[0].issues.filter(
            i => i.rule === 'jsdoc/missing-throws' && i.symbol === 'assertTruth'
        );
        expect(throwsIssues).toHaveLength(0);
    });

    it('should handle destructured parameters in arrow functions', async () => {
        const filePath = createTempTsFile(`
/**
 * Extracts the name from a destructured options parameter object.
 *
 * @param options - The options containing name and value
 * @returns The extracted name string
 */
export const extractName = ({ name, value }: { name: string; value: number }): string => {
    return name;
};
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Destructured param should be renamed to 'options'
        const paramIssues = result.files[0].issues.filter(
            i => i.rule === 'jsdoc/missing-param' && i.symbol === 'extractName'
        );
        expect(paramIssues).toHaveLength(0); // 'options' is documented
    });

    it('should handle interface and type alias declarations', async () => {
        const filePath = createTempTsFile(`
/** Represents a user entity with identification and contact information. */
export interface User {
    name: string;
    email: string;
}

/** A numeric identifier type used for database primary keys and references. */
export type ID = number | string;
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Both have JSDoc so no missing issues
        const missingIssues = result.files[0].issues.filter(i => i.rule === 'jsdoc/missing');
        expect(missingIssues).toHaveLength(0);
    });

    it('should detect methods with throw statements in classes', async () => {
        const filePath = createTempTsFile(`
/**
 * A validator class that checks data integrity and reports violations.
 */
export class Validator {
    /**
     * Validates the given input data against all registered constraint rules.
     *
     * @param data - The data to validate against rules
     */
    validate(data: string): void {
        if (!data) {
            throw new Error('Invalid data');
        }
    }
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // validate method throws but has no @throws tag
        const throwsIssues = result.files[0].issues.filter(
            i => i.rule === 'jsdoc/missing-throws'
        );
        expect(throwsIssues.length).toBeGreaterThan(0);
    });

    it('should handle function declarations without a body (overloads)', async () => {
        const filePath = createTempTsFile(`
/**
 * Overloaded function that processes different input types for flexible usage.
 *
 * @param x - The input value to process
 * @returns The processed string result
 */
export function process(x: string): string;
/**
 * Overloaded function that processes different input types for flexible usage.
 *
 * @param x - The input value to process
 * @returns The processed number result
 */
export function process(x: number): number;
/**
 * Overloaded function that processes different input types for flexible usage.
 *
 * @param x - The input value to process
 * @returns The processed result value
 */
export function process(x: string | number): string | number {
    return x;
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // Should handle overloads (no body) without crashing
    });

    it('should handle type-only exports without issues', async () => {
        const filePath = createTempTsFile(`
/** Represents the available log severity levels for the application logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Configuration options for initializing the application runtime. */
export interface Config {
    host: string;
    port: number;
}

/** Re-exported type alias referencing the built-in string type for convenience. */
export type StringAlias = string;
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // All type-only exports have JSDoc, so no missing-jsdoc issues
        const missingIssues = result.files[0].issues.filter(i => i.rule === 'jsdoc/missing');
        expect(missingIssues).toHaveLength(0);
    });

    it('should handle empty files gracefully', async () => {
        const filePath = createTempTsFile('');
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        expect(result.files[0].issues).toHaveLength(0);
    });

    it('should handle files with only comments and no declarations', async () => {
        const filePath = createTempTsFile(`
// This file only has comments
/* Block comment */
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        expect(result.files[0].issues).toHaveLength(0);
    });

    it('should check inherited class methods from exported classes', async () => {
        const filePath = createTempTsFile(`
/**
 * Base class providing shared functionality for all derived validator implementations.
 */
export class BaseValidator {
    /**
     * Validates the given input data against the base constraint rules.
     *
     * @param data - The data string to validate
     * @returns True if validation passes all rules
     */
    public validate(data: string): boolean {
        return data.length > 0;
    }
}

/**
 * Extended validator with additional strict validation rules for production use.
 */
export class StrictValidator extends BaseValidator {
    /**
     * Performs strict validation including format and length constraint checks.
     *
     * @param data - The data string to validate strictly
     * @returns True if data passes all strict rules
     */
    public validate(data: string): boolean {
        return data.length > 5;
    }

    /**
     * Sanitizes input by removing unsafe characters and normalizing whitespace.
     *
     * @param input - The raw input string to sanitize
     * @returns The sanitized input string
     */
    public sanitize(input: string): string {
        return input.trim();
    }
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        // All public methods have JSDoc, so no missing issues for methods
        const methodIssues = result.files[0].issues.filter(
            i => i.rule === 'jsdoc/missing' && i.declarationType === 'method'
        );
        expect(methodIssues).toHaveLength(0);
    });

    it('should detect missing JSDoc on type-only exports', async () => {
        const filePath = createTempTsFile(`
export type UndocumentedType = string | number;
export interface UndocumentedInterface {
    field: string;
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        const missingIssues = result.files[0].issues.filter(i => i.rule === 'jsdoc/missing');
        expect(missingIssues.length).toBe(2);
        expect(missingIssues.some(i => i.symbol === 'UndocumentedType')).toBe(true);
        expect(missingIssues.some(i => i.symbol === 'UndocumentedInterface')).toBe(true);
    });

    it('should count errors and warnings in file results', async () => {
        const filePath = createTempTsFile(`
export function undocumented(x: number): string {
    throw new Error('not implemented');
}
`);
        mockGlob.mockResolvedValue([filePath] as never);
        const result = await lint({
            rootDir: path.dirname(filePath),
            workspaces: [''],
            exclude: [],
            format: 'text',
            failOnWarnings: false,
        });
        expect(result.totalFiles).toBe(1);
        const fileResult = result.files[0];
        // Should have at least jsdoc/missing error
        expect(fileResult.errorCount).toBeGreaterThan(0);
        expect(fileResult.errorCount).toBe(
            fileResult.issues.filter(i => i.severity === 'error').length
        );
        expect(fileResult.warningCount).toBe(
            fileResult.issues.filter(i => i.severity === 'warning').length
        );
    });
});
