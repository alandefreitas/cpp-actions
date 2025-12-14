import { DeclarationInfo, LintIssue, Severity } from './types';

/**
 * Rule definition interface.
 */
interface Rule {
    /** Unique identifier for the rule */
    id: string;
    /** Human-readable description of the rule */
    description: string;
    /** Default severity */
    severity: Severity;
    /** Function to check the rule */
    check: (decl: DeclarationInfo, file: string) => LintIssue[];
}

/**
 * Checks if a description is "lazy" - too short or just restates the function name.
 *
 * @param name - The function/class/interface name
 * @param description - The JSDoc description
 * @returns True if the description is considered lazy
 */
function isLazyDescription(name: string, description: string): boolean {
    if (!description || description.trim().length === 0) {
        return true;
    }

    const normalized = description.toLowerCase().trim();

    // Too short to be meaningful
    if (normalized.length < 10) {
        return true;
    }

    // Split camelCase/PascalCase into words
    const nameWords = name
        .replace(/([A-Z])/g, ' $1')
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2);

    // Split description into words
    const descWords = normalized.split(/\s+/).filter(w => w.length > 2);

    // If description has very few words, it's likely lazy
    if (descWords.length <= 3) {
        // Check for lazy patterns
        const lazyPatterns = [
            /^gets?\s+/i,
            /^sets?\s+/i,
            /^returns?\s+/i,
            /^the\s+/i,
            /^a\s+/i,
            /^an\s+/i,
            /^this\s+(function|method|class)/i,
        ];

        if (lazyPatterns.some(p => p.test(normalized))) {
            return true;
        }
    }

    // If description just restates the function name
    if (descWords.length <= 4) {
        const overlap = descWords.filter(w => nameWords.includes(w)).length;
        if (overlap >= descWords.length * 0.8) {
            return true;
        }
    }

    return false;
}

/**
 * Creates a lint issue.
 *
 * @param decl - The declaration info
 * @param file - The file path
 * @param rule - The rule ID
 * @param severity - The severity level
 * @param message - The issue message
 * @returns A lint issue object
 */
function createIssue(
    decl: DeclarationInfo,
    file: string,
    rule: string,
    severity: Severity,
    message: string
): LintIssue {
    return {
        file,
        line: decl.line,
        column: decl.column,
        rule,
        severity,
        message,
        symbol: decl.name,
        declarationType: decl.type,
    };
}

/**
 * All validation rules for JSDoc checking.
 */
export const rules: Rule[] = [
    {
        id: 'jsdoc/missing',
        description: 'Exported declarations must have JSDoc comments',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported) return [];
            if (decl.jsdoc) return [];

            return [
                createIssue(
                    decl,
                    file,
                    'jsdoc/missing',
                    'error',
                    `Exported ${decl.type} '${decl.name}' is missing JSDoc documentation`
                ),
            ];
        },
    },
    {
        id: 'jsdoc/missing-description',
        description: 'JSDoc comments must have a description',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];
            if (decl.jsdoc.description && decl.jsdoc.description.trim().length > 0) return [];

            return [
                createIssue(
                    decl,
                    file,
                    'jsdoc/missing-description',
                    'error',
                    `JSDoc for ${decl.type} '${decl.name}' is missing a description`
                ),
            ];
        },
    },
    {
        id: 'jsdoc/lazy-description',
        description: 'JSDoc descriptions must be meaningful, not just restate the name',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];
            if (!decl.jsdoc.description) return [];

            if (isLazyDescription(decl.name, decl.jsdoc.description)) {
                return [
                    createIssue(
                        decl,
                        file,
                        'jsdoc/lazy-description',
                        'error',
                        `JSDoc description for ${decl.type} '${decl.name}' is too brief or just restates the name. Provide a meaningful description.`
                    ),
                ];
            }

            return [];
        },
    },
    {
        id: 'jsdoc/missing-param',
        description: 'All parameters must have @param tags',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];
            if (decl.type !== 'function' && decl.type !== 'method') return [];
            if (decl.parameters.length === 0) return [];

            const issues: LintIssue[] = [];
            const documentedParams = new Set(
                decl.jsdoc.tags
                    .filter(t => t.tagName === 'param')
                    .map(t => t.name)
            );

            for (const param of decl.parameters) {
                if (!documentedParams.has(param.name)) {
                    issues.push(
                        createIssue(
                            decl,
                            file,
                            'jsdoc/missing-param',
                            'error',
                            `Parameter '${param.name}' of ${decl.type} '${decl.name}' is not documented with @param`
                        )
                    );
                }
            }

            return issues;
        },
    },
    {
        id: 'jsdoc/param-description',
        description: '@param tags must have descriptions',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];

            const issues: LintIssue[] = [];
            const paramTags = decl.jsdoc.tags.filter(t => t.tagName === 'param');

            for (const tag of paramTags) {
                if (!tag.comment || tag.comment.trim().length === 0) {
                    issues.push(
                        createIssue(
                            decl,
                            file,
                            'jsdoc/param-description',
                            'error',
                            `@param '${tag.name}' in ${decl.type} '${decl.name}' is missing a description`
                        )
                    );
                }
            }

            return issues;
        },
    },
    {
        id: 'jsdoc/missing-returns',
        description: 'Non-void functions must have @returns tag',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];
            if (decl.type !== 'function' && decl.type !== 'method') return [];

            // Skip if return type is void or undefined
            const returnType = decl.returnType?.toLowerCase() || '';
            if (
                returnType === 'void' ||
                returnType === 'undefined' ||
                returnType === 'never' ||
                returnType === '' ||
                returnType === 'promise<void>'
            ) {
                return [];
            }

            const hasReturnsTag = decl.jsdoc.tags.some(
                t => t.tagName === 'returns' || t.tagName === 'return'
            );

            if (!hasReturnsTag) {
                return [
                    createIssue(
                        decl,
                        file,
                        'jsdoc/missing-returns',
                        'error',
                        `${decl.type} '${decl.name}' returns '${decl.returnType}' but is missing @returns documentation`
                    ),
                ];
            }

            return [];
        },
    },
    {
        id: 'jsdoc/returns-description',
        description: '@returns tags must have descriptions',
        severity: 'error',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];

            const issues: LintIssue[] = [];
            const returnsTags = decl.jsdoc.tags.filter(
                t => t.tagName === 'returns' || t.tagName === 'return'
            );

            for (const tag of returnsTags) {
                if (!tag.comment || tag.comment.trim().length === 0) {
                    issues.push(
                        createIssue(
                            decl,
                            file,
                            'jsdoc/returns-description',
                            'error',
                            `@returns in ${decl.type} '${decl.name}' is missing a description`
                        )
                    );
                }
            }

            return issues;
        },
    },
    {
        id: 'jsdoc/missing-throws',
        description: 'Functions with throw statements should document @throws',
        severity: 'warning',
        check: (decl, file) => {
            if (!decl.isExported || !decl.jsdoc) return [];
            if (decl.type !== 'function' && decl.type !== 'method') return [];
            if (!decl.hasThrowStatements) return [];

            const hasThrowsTag = decl.jsdoc.tags.some(
                t => t.tagName === 'throws' || t.tagName === 'throw'
            );

            if (!hasThrowsTag) {
                return [
                    createIssue(
                        decl,
                        file,
                        'jsdoc/missing-throws',
                        'warning',
                        `${decl.type} '${decl.name}' contains throw statements but is missing @throws documentation`
                    ),
                ];
            }

            return [];
        },
    },
];

/**
 * Runs all rules against a declaration and returns all issues found.
 *
 * @param decl - The declaration to check
 * @param file - The file path
 * @returns Array of lint issues found
 */
export function checkDeclaration(decl: DeclarationInfo, file: string): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const rule of rules) {
        issues.push(...rule.check(decl, file));
    }

    return issues;
}
