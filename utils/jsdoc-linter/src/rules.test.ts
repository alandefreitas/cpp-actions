import { checkDeclaration, rules } from './rules';
import { type DeclarationInfo, type ParsedJSDoc } from './types';

/**
 * Helper to create a base declaration for testing.
 *
 * @param overrides - Properties to override on the default declaration
 * @returns A DeclarationInfo object
 */
function makeDecl(overrides: Partial<DeclarationInfo> = {}): DeclarationInfo {
    return {
        name: 'myFunction',
        type: 'function',
        isExported: true,
        line: 10,
        column: 1,
        parameters: [],
        hasThrowStatements: false,
        ...overrides,
    };
}

/**
 * Helper to create a parsed JSDoc object.
 *
 * @param description - The JSDoc description
 * @param tags - Array of JSDoc tags
 * @returns A ParsedJSDoc object
 */
function makeJSDoc(description: string, tags: ParsedJSDoc['tags'] = []): ParsedJSDoc {
    return { description, tags };
}

describe('rules', () => {
    it('should export an array of rules', () => {
        expect(Array.isArray(rules)).toBe(true);
        expect(rules.length).toBeGreaterThan(0);
    });

    it('each rule should have id, description, severity, and check', () => {
        for (const rule of rules) {
            expect(rule.id).toBeDefined();
            expect(rule.description).toBeDefined();
            expect(rule.severity).toMatch(/^(error|warning)$/);
            expect(typeof rule.check).toBe('function');
        }
    });
});

describe('checkDeclaration', () => {
    describe('jsdoc/missing', () => {
        it('should report error when JSDoc is missing', () => {
            const decl = makeDecl({ jsdoc: undefined });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing')).toBe(true);
        });

        it('should not report when JSDoc is present', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('A meaningful description of the function that does something useful.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing')).toBe(false);
        });
    });

    describe('jsdoc/missing-description', () => {
        it('should report error when JSDoc has empty description', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-description')).toBe(true);
        });

        it('should report error when JSDoc has whitespace-only description', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('   ') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-description')).toBe(true);
        });

        it('should not report when JSDoc has description', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('A meaningful description of the function for testing purposes.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-description')).toBe(false);
        });
    });

    describe('jsdoc/lazy-description', () => {
        it('should report error for too-short descriptions', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('short') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error for "Gets X" patterns', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('Gets the value') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error for "Sets X" patterns', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('Sets the value') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error for "Returns X" patterns', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('Returns the data') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error for "The X" patterns', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('The function result') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error for "This function" patterns', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('This function does') });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error when description restates the function name', () => {
            const decl = makeDecl({
                name: 'getUserData',
                jsdoc: makeJSDoc('get user data'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should report error when 4-word description overlaps heavily with function name', () => {
            const decl = makeDecl({
                name: 'processUserInputData',
                jsdoc: makeJSDoc('process user input data'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(true);
        });

        it('should not report when 4-word description has low overlap with name', () => {
            const decl = makeDecl({
                name: 'processData',
                jsdoc: makeJSDoc('validates input configuration settings thoroughly'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(false);
        });

        it('should not report for meaningful descriptions', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Parses the configuration file and validates all required fields against the schema.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(false);
        });

        it('should not report when there is no jsdoc', () => {
            const decl = makeDecl({ jsdoc: undefined });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(false);
        });

        it('should not report when description is absent', () => {
            const decl = makeDecl({ jsdoc: makeJSDoc('', [{ tagName: 'param', name: 'x', comment: 'val' }]) });
            const issues = checkDeclaration(decl, 'test.ts');
            // jsdoc/missing-description will fire, but lazy-description should not
            expect(issues.some(i => i.rule === 'jsdoc/lazy-description')).toBe(false);
        });
    });

    describe('jsdoc/missing-param', () => {
        it('should report error for undocumented parameters', () => {
            const decl = makeDecl({
                parameters: [{ name: 'x', type: 'number', optional: false, hasDefault: false }],
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(true);
        });

        it('should not report when all params are documented', () => {
            const decl = makeDecl({
                parameters: [{ name: 'x', type: 'number', optional: false, hasDefault: false }],
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'param', name: 'x', comment: 'The input value' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(false);
        });

        it('should not check params for non-function types', () => {
            const decl = makeDecl({
                type: 'class',
                parameters: [{ name: 'x', type: 'number', optional: false, hasDefault: false }],
                jsdoc: makeJSDoc('A class that manages configuration state and provides validation.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(false);
        });

        it('should not check when there are no parameters', () => {
            const decl = makeDecl({
                parameters: [],
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(false);
        });

        it('should not check when there is no jsdoc', () => {
            const decl = makeDecl({
                parameters: [{ name: 'x', type: 'number', optional: false, hasDefault: false }],
                jsdoc: undefined,
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(false);
        });

        it('should work for method type', () => {
            const decl = makeDecl({
                type: 'method',
                parameters: [{ name: 'value', type: 'string', optional: false, hasDefault: false }],
                jsdoc: makeJSDoc('Sets the internal configuration value for the given property key.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-param')).toBe(true);
        });
    });

    describe('jsdoc/param-description', () => {
        it('should report error when @param has no description', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'param', name: 'x', comment: '' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/param-description')).toBe(true);
        });

        it('should report error when @param has undefined comment', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'param', name: 'x' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/param-description')).toBe(true);
        });

        it('should not report when @param has description', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'param', name: 'x', comment: 'The input value' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/param-description')).toBe(false);
        });
    });

    describe('jsdoc/missing-returns', () => {
        it('should report error when non-void function lacks @returns', () => {
            const decl = makeDecl({
                returnType: 'string',
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(true);
        });

        it('should not report when function returns void', () => {
            const decl = makeDecl({
                returnType: 'void',
                jsdoc: makeJSDoc('Processes the input value and updates the internal state accordingly.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not report when function returns Promise<void>', () => {
            const decl = makeDecl({
                returnType: 'Promise<void>',
                jsdoc: makeJSDoc('Processes the input value and updates the internal state accordingly.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not report when function returns undefined', () => {
            const decl = makeDecl({
                returnType: 'undefined',
                jsdoc: makeJSDoc('Processes the input value and updates the internal state accordingly.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not report when function returns never', () => {
            const decl = makeDecl({
                returnType: 'never',
                jsdoc: makeJSDoc('Throws an error to halt execution and propagate the failure to callers.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not report when @returns tag is present', () => {
            const decl = makeDecl({
                returnType: 'string',
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'returns', comment: 'The result string' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should accept @return as alias for @returns', () => {
            const decl = makeDecl({
                returnType: 'string',
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'return', comment: 'The result string' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not check for non-function types', () => {
            const decl = makeDecl({
                type: 'interface',
                returnType: 'string',
                jsdoc: makeJSDoc('Defines the contract for a data provider with generic type support.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });

        it('should not report when return type is empty string', () => {
            const decl = makeDecl({
                returnType: '',
                jsdoc: makeJSDoc('Processes the input value and updates the internal state accordingly.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-returns')).toBe(false);
        });
    });

    describe('jsdoc/returns-description', () => {
        it('should report error when @returns has no description', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'returns', comment: '' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/returns-description')).toBe(true);
        });

        it('should report error when @returns has undefined comment', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'returns' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/returns-description')).toBe(true);
        });

        it('should not report when @returns has description', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'returns', comment: 'The computed value' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/returns-description')).toBe(false);
        });

        it('should check @return alias too', () => {
            const decl = makeDecl({
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.', [
                    { tagName: 'return', comment: '' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/returns-description')).toBe(true);
        });
    });

    describe('jsdoc/missing-throws', () => {
        it('should report warning when function throws but has no @throws', () => {
            const decl = makeDecl({
                hasThrowStatements: true,
                jsdoc: makeJSDoc('Validates the input and throws when the value is out of acceptable range.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            const throwsIssue = issues.find(i => i.rule === 'jsdoc/missing-throws');
            expect(throwsIssue).toBeDefined();
            expect(throwsIssue!.severity).toBe('warning');
        });

        it('should not report when @throws is present', () => {
            const decl = makeDecl({
                hasThrowStatements: true,
                jsdoc: makeJSDoc('Validates the input and throws when the value is out of acceptable range.', [
                    { tagName: 'throws', comment: 'When input is invalid' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-throws')).toBe(false);
        });

        it('should accept @throw as alias', () => {
            const decl = makeDecl({
                hasThrowStatements: true,
                jsdoc: makeJSDoc('Validates the input and throws when the value is out of acceptable range.', [
                    { tagName: 'throw', comment: 'When input is invalid' },
                ]),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-throws')).toBe(false);
        });

        it('should not report when function has no throw statements', () => {
            const decl = makeDecl({
                hasThrowStatements: false,
                jsdoc: makeJSDoc('Processes the input value and returns the computed result for downstream use.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-throws')).toBe(false);
        });

        it('should not check for non-function types', () => {
            const decl = makeDecl({
                type: 'class',
                hasThrowStatements: true,
                jsdoc: makeJSDoc('A class that manages configuration state and provides validation.'),
            });
            const issues = checkDeclaration(decl, 'test.ts');
            expect(issues.some(i => i.rule === 'jsdoc/missing-throws')).toBe(false);
        });
    });

    describe('issue metadata', () => {
        it('should include correct file, line, column, and symbol in issues', () => {
            const decl = makeDecl({
                name: 'testFn',
                line: 42,
                column: 5,
                jsdoc: undefined,
            });
            const issues = checkDeclaration(decl, 'src/module.ts');
            const issue = issues.find(i => i.rule === 'jsdoc/missing');
            expect(issue).toBeDefined();
            expect(issue!.file).toBe('src/module.ts');
            expect(issue!.line).toBe(42);
            expect(issue!.column).toBe(5);
            expect(issue!.symbol).toBe('testFn');
            expect(issue!.declarationType).toBe('function');
        });
    });
});
