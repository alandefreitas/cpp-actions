import { Project, SourceFile, Node, SyntaxKind, FunctionDeclaration, ClassDeclaration, InterfaceDeclaration, TypeAliasDeclaration, MethodDeclaration, JSDoc, VariableStatement, PropertySignature, MethodSignature } from 'ts-morph';
import * as path from 'path';
import { glob } from 'glob';
import { DeclarationInfo, FileLintResult, LintResult, LinterOptions, ParsedJSDoc, JSDocTag, ParameterInfo } from './types';
import { checkDeclaration } from './rules';

/**
 * Extracts parameter information from a function-like declaration.
 *
 * Handles destructured parameters by using a simplified name like "options"
 * instead of the full destructure pattern.
 *
 * @param node - The function or method declaration
 * @returns Array of parameter information
 */
function extractParameters(node: FunctionDeclaration | MethodDeclaration | MethodSignature): ParameterInfo[] {
    const params: ParameterInfo[] = [];

    for (const param of node.getParameters()) {
        let paramName = param.getName();

        // Handle destructured parameters - use "options" as the param name
        // Destructured params start with { or [ and contain complex patterns
        if (paramName.startsWith('{') || paramName.startsWith('[')) {
            paramName = 'options';
        }

        params.push({
            name: paramName,
            type: param.getType().getText(param),
            optional: param.isOptional(),
            hasDefault: param.hasInitializer(),
        });
    }

    return params;
}

/**
 * Parses JSDoc comments from a node.
 *
 * @param jsdocs - Array of JSDoc nodes
 * @returns Parsed JSDoc information or undefined
 */
function parseJSDoc(jsdocs: JSDoc[]): ParsedJSDoc | undefined {
    if (jsdocs.length === 0) return undefined;

    // Use the last JSDoc comment (closest to the declaration)
    const jsdoc = jsdocs[jsdocs.length - 1];
    const tags: JSDocTag[] = [];

    for (const tag of jsdoc.getTags()) {
        const tagName = tag.getTagName();
        let name: string | undefined;
        let comment: string | undefined;

        // Handle @param tags specially to extract parameter name
        if (tagName === 'param') {
            const text = tag.getText();
            // Parse @param {type} name - description or @param name - description
            const paramMatch = text.match(/@param\s+(?:\{[^}]*\}\s+)?(\w+)\s*[-:]?\s*(.*)/s);
            if (paramMatch) {
                name = paramMatch[1];
                comment = paramMatch[2]?.trim();
            }
        } else {
            comment = tag.getCommentText()?.trim();
        }

        tags.push({
            tagName,
            name,
            comment,
        });
    }

    return {
        description: jsdoc.getDescription().trim(),
        tags,
    };
}

/**
 * Checks if a function body contains throw statements.
 *
 * @param node - The function or method declaration
 * @returns True if the function contains throw statements
 */
function hasThrowStatements(node: FunctionDeclaration | MethodDeclaration): boolean {
    const body = node.getBody();
    if (!body) return false;

    return body.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0;
}

/**
 * Checks if a declaration is exported.
 *
 * @param node - The node to check
 * @returns True if the declaration is exported
 */
function isExported(node: Node): boolean {
    if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node) ||
        Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)) {
        return node.isExported();
    }

    if (Node.isVariableStatement(node)) {
        return node.isExported();
    }

    return false;
}

/**
 * Extracts declaration info from a function declaration.
 *
 * @param node - The function declaration
 * @returns Declaration information
 */
function extractFunctionInfo(node: FunctionDeclaration): DeclarationInfo | undefined {
    const name = node.getName();
    if (!name) return undefined;

    return {
        name,
        type: 'function',
        isExported: node.isExported(),
        line: node.getStartLineNumber(),
        column: node.getStart() - node.getStartLinePos() + 1,
        parameters: extractParameters(node),
        returnType: node.getReturnType().getText(node),
        hasThrowStatements: hasThrowStatements(node),
        jsdoc: parseJSDoc(node.getJsDocs()),
    };
}

/**
 * Extracts declaration info from a class declaration.
 *
 * @param node - The class declaration
 * @returns Declaration information
 */
function extractClassInfo(node: ClassDeclaration): DeclarationInfo | undefined {
    const name = node.getName();
    if (!name) return undefined;

    return {
        name,
        type: 'class',
        isExported: node.isExported(),
        line: node.getStartLineNumber(),
        column: node.getStart() - node.getStartLinePos() + 1,
        parameters: [],
        hasThrowStatements: false,
        jsdoc: parseJSDoc(node.getJsDocs()),
    };
}

/**
 * Extracts declaration info from an interface declaration.
 *
 * @param node - The interface declaration
 * @returns Declaration information
 */
function extractInterfaceInfo(node: InterfaceDeclaration): DeclarationInfo {
    return {
        name: node.getName(),
        type: 'interface',
        isExported: node.isExported(),
        line: node.getStartLineNumber(),
        column: node.getStart() - node.getStartLinePos() + 1,
        parameters: [],
        hasThrowStatements: false,
        jsdoc: parseJSDoc(node.getJsDocs()),
    };
}

/**
 * Extracts declaration info from a type alias declaration.
 *
 * @param node - The type alias declaration
 * @returns Declaration information
 */
function extractTypeAliasInfo(node: TypeAliasDeclaration): DeclarationInfo {
    return {
        name: node.getName(),
        type: 'type',
        isExported: node.isExported(),
        line: node.getStartLineNumber(),
        column: node.getStart() - node.getStartLinePos() + 1,
        parameters: [],
        hasThrowStatements: false,
        jsdoc: parseJSDoc(node.getJsDocs()),
    };
}

/**
 * Extracts declarations from a source file.
 *
 * @param sourceFile - The source file to analyze
 * @returns Array of declaration information
 */
function extractDeclarations(sourceFile: SourceFile): DeclarationInfo[] {
    const declarations: DeclarationInfo[] = [];

    // Get all function declarations
    for (const func of sourceFile.getFunctions()) {
        const info = extractFunctionInfo(func);
        if (info) declarations.push(info);
    }

    // Get all class declarations
    for (const cls of sourceFile.getClasses()) {
        const info = extractClassInfo(cls);
        if (info) declarations.push(info);

        // Also check methods within the class
        for (const method of cls.getMethods()) {
            if (method.getScope() === 'public' || !method.getScope()) {
                const methodInfo: DeclarationInfo = {
                    name: `${cls.getName()}.${method.getName()}`,
                    type: 'method',
                    isExported: cls.isExported(),
                    line: method.getStartLineNumber(),
                    column: method.getStart() - method.getStartLinePos() + 1,
                    parameters: extractParameters(method),
                    returnType: method.getReturnType().getText(method),
                    hasThrowStatements: hasThrowStatements(method),
                    jsdoc: parseJSDoc(method.getJsDocs()),
                };
                declarations.push(methodInfo);
            }
        }
    }

    // Get all interface declarations
    for (const iface of sourceFile.getInterfaces()) {
        declarations.push(extractInterfaceInfo(iface));
    }

    // Get all type alias declarations
    for (const typeAlias of sourceFile.getTypeAliases()) {
        declarations.push(extractTypeAliasInfo(typeAlias));
    }

    // Get exported variable declarations (often used for constants or arrow functions)
    for (const statement of sourceFile.getVariableStatements()) {
        if (statement.isExported()) {
            for (const decl of statement.getDeclarations()) {
                const name = decl.getName();
                const init = decl.getInitializer();

                // Check if it's an arrow function or function expression
                const isFunction = init && (
                    Node.isArrowFunction(init) ||
                    Node.isFunctionExpression(init)
                );

                if (isFunction) {
                    const arrowFunc = init;
                    const params: ParameterInfo[] = [];

                    if (Node.isArrowFunction(arrowFunc) || Node.isFunctionExpression(arrowFunc)) {
                        for (const param of arrowFunc.getParameters()) {
                            let paramName = param.getName();
                            // Handle destructured parameters
                            if (paramName.startsWith('{') || paramName.startsWith('[')) {
                                paramName = 'options';
                            }
                            params.push({
                                name: paramName,
                                type: param.getType().getText(param),
                                optional: param.isOptional(),
                                hasDefault: param.hasInitializer(),
                            });
                        }
                    }

                    // Check for throw statements in the function body
                    let hasThrows = false;
                    if (Node.isArrowFunction(arrowFunc) || Node.isFunctionExpression(arrowFunc)) {
                        const body = arrowFunc.getBody();
                        if (body && Node.isBlock(body)) {
                            hasThrows = body.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0;
                        }
                    }

                    declarations.push({
                        name,
                        type: 'function',
                        isExported: true,
                        line: decl.getStartLineNumber(),
                        column: decl.getStart() - decl.getStartLinePos() + 1,
                        parameters: params,
                        returnType: decl.getType().getText(decl),
                        hasThrowStatements: hasThrows,
                        jsdoc: parseJSDoc(statement.getJsDocs()),
                    });
                } else {
                    // Regular exported variable/constant
                    declarations.push({
                        name,
                        type: 'variable',
                        isExported: true,
                        line: decl.getStartLineNumber(),
                        column: decl.getStart() - decl.getStartLinePos() + 1,
                        parameters: [],
                        hasThrowStatements: false,
                        jsdoc: parseJSDoc(statement.getJsDocs()),
                    });
                }
            }
        }
    }

    return declarations;
}

/**
 * Lints a single source file.
 *
 * @param sourceFile - The source file to lint
 * @param relativePath - The relative path for display
 * @returns Lint result for the file
 */
function lintFile(sourceFile: SourceFile, relativePath: string): FileLintResult {
    const declarations = extractDeclarations(sourceFile);
    const issues = declarations.flatMap(decl => checkDeclaration(decl, relativePath));

    return {
        file: relativePath,
        issues,
        errorCount: issues.filter(i => i.severity === 'error').length,
        warningCount: issues.filter(i => i.severity === 'warning').length,
    };
}

/**
 * Finds all TypeScript source files in the workspaces.
 *
 * @param rootDir - The root directory of the project
 * @param workspaces - Specific workspaces to lint (empty = all)
 * @param exclude - Patterns to exclude
 * @returns Array of file paths
 */
async function findSourceFiles(
    rootDir: string,
    workspaces: string[],
    exclude: string[]
): Promise<string[]> {
    const patterns: string[] = [];

    if (workspaces.length > 0) {
        // Lint specific workspaces
        for (const workspace of workspaces) {
            patterns.push(path.join(rootDir, workspace, 'src/**/*.ts'));
        }
    } else {
        // Lint all workspaces
        patterns.push(path.join(rootDir, '*/src/**/*.ts'));
        patterns.push(path.join(rootDir, 'common/*/src/**/*.ts'));
        patterns.push(path.join(rootDir, 'tools/*/src/**/*.ts'));
    }

    const allFiles: string[] = [];
    for (const pattern of patterns) {
        const files = await glob(pattern, {
            ignore: [
                '**/node_modules/**',
                '**/*.test.ts',
                '**/*.spec.ts',
                '**/dist/**',
                '**/lib/**',
                ...exclude,
            ],
        });
        allFiles.push(...files);
    }

    return [...new Set(allFiles)]; // Remove duplicates
}

/**
 * Main linting function that processes all files in the project.
 *
 * @param options - Linting options
 * @returns Overall lint result
 */
export async function lint(options: LinterOptions): Promise<LintResult> {
    const files = await findSourceFiles(options.rootDir, options.workspaces, options.exclude);

    if (files.length === 0) {
        return {
            files: [],
            totalErrors: 0,
            totalWarnings: 0,
            totalFiles: 0,
            filesWithIssues: 0,
        };
    }

    // Create a project with the TypeScript compiler
    const project = new Project({
        tsConfigFilePath: path.join(options.rootDir, 'tsconfig.json'),
        skipAddingFilesFromTsConfig: true,
    });

    // Add the files to analyze
    for (const file of files) {
        project.addSourceFileAtPath(file);
    }

    const results: FileLintResult[] = [];

    for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();
        const relativePath = path.relative(options.rootDir, filePath);
        const result = lintFile(sourceFile, relativePath);
        results.push(result);
    }

    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);

    return {
        files: results,
        totalErrors,
        totalWarnings,
        totalFiles: results.length,
        filesWithIssues: results.filter(r => r.issues.length > 0).length,
    };
}
