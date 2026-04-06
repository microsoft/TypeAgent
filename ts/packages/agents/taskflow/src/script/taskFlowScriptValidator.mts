// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import ts from "typescript";
import { ValidationResult, ValidationError } from "./types.mjs";
import {
    generateSandboxDeclarations,
    generateGenericSandboxDeclarations,
} from "./sandboxDeclarations.mjs";

const BLOCKED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);

const DANGEROUS_CALLS = new Set(["eval", "Function"]);

export const BLOCKED_IDENTIFIERS = new Set([
    "eval",
    "Function",
    "require",
    "import",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "window",
    "document",
    "globalThis",
    "self",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "chrome",
    "process",
    "Buffer",
    "__dirname",
    "__filename",
]);

function createVirtualHost(files: Record<string, string>): ts.CompilerHost {
    const defaultHost = ts.createCompilerHost({
        strict: true,
        target: ts.ScriptTarget.ES2022,
    });

    return {
        ...defaultHost,
        getSourceFile(fileName, languageVersion) {
            if (fileName in files) {
                return ts.createSourceFile(
                    fileName,
                    files[fileName],
                    languageVersion,
                    true,
                );
            }
            return defaultHost.getSourceFile(fileName, languageVersion);
        },
        fileExists(fileName) {
            return fileName in files || defaultHost.fileExists(fileName);
        },
        readFile(fileName) {
            return files[fileName] ?? defaultHost.readFile(fileName);
        },
    };
}

function getLineAndColumn(
    sourceFile: ts.SourceFile,
    pos: number,
): { line: number; column: number } {
    const lc = sourceFile.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character };
}

function createError(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    message: string,
    severity: "error" | "warning" = "error",
): ValidationError {
    const { line, column } = getLineAndColumn(sourceFile, node.getStart());
    return { line, column, message, severity };
}

function walkForSecurityViolations(
    sourceFile: ts.SourceFile,
): ValidationError[] {
    const errors: ValidationError[] = [];

    function visit(node: ts.Node) {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            DANGEROUS_CALLS.has(node.expression.text)
        ) {
            errors.push(
                createError(
                    sourceFile,
                    node,
                    `'${node.expression.text}()' is not allowed`,
                ),
            );
        }

        if (
            ts.isNewExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "Function"
        ) {
            errors.push(
                createError(
                    sourceFile,
                    node,
                    "'new Function()' is not allowed",
                ),
            );
        }

        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
            errors.push(
                createError(
                    sourceFile,
                    node,
                    "Dynamic import() is not allowed",
                ),
            );
        }

        if (ts.isPropertyAccessExpression(node)) {
            if (BLOCKED_PROPERTIES.has(node.name.text)) {
                errors.push(
                    createError(
                        sourceFile,
                        node.name,
                        `Access to '${node.name.text}' is not allowed`,
                    ),
                );
            }
        }

        if (
            ts.isElementAccessExpression(node) &&
            ts.isStringLiteral(node.argumentExpression) &&
            BLOCKED_PROPERTIES.has(node.argumentExpression.text)
        ) {
            errors.push(
                createError(
                    sourceFile,
                    node.argumentExpression,
                    `Computed access to '${node.argumentExpression.text}' is not allowed`,
                ),
            );
        }

        if (ts.isWithStatement(node)) {
            errors.push(
                createError(
                    sourceFile,
                    node,
                    "'with' statement is not allowed",
                ),
            );
        }

        if (node.kind === ts.SyntaxKind.DebuggerStatement) {
            errors.push(
                createError(
                    sourceFile,
                    node,
                    "'debugger' statement is not allowed",
                ),
            );
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return errors;
}

function validateEntryPoint(sourceFile: ts.SourceFile): ValidationError[] {
    const errors: ValidationError[] = [];
    let foundExecute = false;

    for (const statement of sourceFile.statements) {
        if (
            ts.isFunctionDeclaration(statement) &&
            statement.name?.text === "execute"
        ) {
            foundExecute = true;

            if (
                !statement.modifiers?.some(
                    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
                )
            ) {
                errors.push(
                    createError(
                        sourceFile,
                        statement,
                        "execute function must be async",
                    ),
                );
            }

            const params = statement.parameters;
            if (params.length < 2) {
                errors.push(
                    createError(
                        sourceFile,
                        statement,
                        "execute function must have at least two parameters (api, params)",
                    ),
                );
            } else {
                if (
                    ts.isIdentifier(params[0].name) &&
                    params[0].name.text !== "api"
                ) {
                    errors.push(
                        createError(
                            sourceFile,
                            params[0],
                            "First parameter must be named 'api'",
                        ),
                    );
                }
                if (
                    ts.isIdentifier(params[1].name) &&
                    params[1].name.text !== "params"
                ) {
                    errors.push(
                        createError(
                            sourceFile,
                            params[1],
                            "Second parameter must be named 'params'",
                        ),
                    );
                }
            }
            break;
        }
    }

    if (!foundExecute) {
        errors.push({
            line: 1,
            column: 0,
            message: 'Script must define "async function execute(api, params)"',
            severity: "error",
        });
    }

    return errors;
}

const SUPPRESSED_DIAGNOSTICS = new Set([
    2307, // "Cannot find module"
]);

export function validateTaskFlowScript(
    source: string,
    declaredParams: string[],
    flowParameters?: Record<
        string,
        { type: "string" | "number" | "boolean"; required?: boolean }
    >,
): ValidationResult {
    const errors: ValidationError[] = [];

    const sandboxDts = flowParameters
        ? generateSandboxDeclarations(flowParameters)
        : generateGenericSandboxDeclarations();

    const files: Record<string, string> = {
        "sandbox.d.ts": sandboxDts,
        "script.ts": source,
    };

    const host = createVirtualHost(files);

    const program = ts.createProgram(
        ["sandbox.d.ts", "script.ts"],
        {
            strict: true,
            noImplicitAny: false,
            noEmit: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
            moduleResolution: ts.ModuleResolutionKind.Node10,
            types: [],
            skipLibCheck: true,
        },
        host,
    );

    const diagnostics = ts.getPreEmitDiagnostics(program);
    for (const diag of diagnostics) {
        if (SUPPRESSED_DIAGNOSTICS.has(diag.code)) continue;
        if (diag.file && diag.file.fileName !== "script.ts") continue;

        const line =
            diag.file && diag.start !== undefined
                ? diag.file.getLineAndCharacterOfPosition(diag.start).line + 1
                : 0;
        const column =
            diag.file && diag.start !== undefined
                ? diag.file.getLineAndCharacterOfPosition(diag.start).character
                : 0;

        errors.push({
            line,
            column,
            message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
            severity:
                diag.category === ts.DiagnosticCategory.Error
                    ? "error"
                    : "warning",
        });
    }

    const sourceFile = program.getSourceFile("script.ts");
    if (sourceFile) {
        errors.push(...validateEntryPoint(sourceFile));
        errors.push(...walkForSecurityViolations(sourceFile));
    }

    for (const param of declaredParams) {
        const paramPattern = new RegExp(`params\\.${param}\\b`);
        if (!paramPattern.test(source)) {
            errors.push({
                line: 0,
                column: 0,
                message: `Declared parameter '${param}' is never used in the script`,
                severity: "warning",
            });
        }
    }

    return {
        valid: errors.filter((e) => e.severity === "error").length === 0,
        errors,
    };
}

export function transpileScript(source: string): string {
    const result = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ES2022,
            removeComments: true,
        },
    });
    return result.outputText;
}
