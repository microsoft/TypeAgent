// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createScriptValidator,
    transpileScript as sharedTranspileScript,
} from "@typeagent/agent-flows";
import ts from "typescript";
import {
    exploreFlowParameters,
    generateSandboxDeclarations,
} from "./sandboxDeclarations.js";

const baseValidator = createExploreValidator(false);
const lspValidator = createExploreValidator(true);

export function validateExploreScript(
    source: string,
    enableLsp = false,
): {
    valid: boolean;
    errors: string[];
} {
    const result = (enableLsp ? lspValidator : baseValidator).validate(
        source,
        Object.keys(exploreFlowParameters),
        exploreFlowParameters,
    );
    return {
        valid: result.valid,
        errors: result.errors
            .filter((error) => error.severity === "error")
            .map((error) =>
                `${error.line}:${error.column} ${error.message}`.trim(),
            ),
    };
}

export function hasExploreRepositoryCall(
    source: string,
    method: "read" | "lsp",
): boolean {
    const sourceFile = ts.createSourceFile(
        "explore-program.ts",
        source,
        ts.ScriptTarget.ES2022,
        true,
    );
    const aliases = collectRepositoryMethodAliases(sourceFile, method);
    let called = false;
    const findCall = (node: ts.Node): void => {
        if (called) {
            return;
        }
        if (
            ts.isCallExpression(node) &&
            (isRepositoryMethodExpression(node.expression, method) ||
                isAliasCallExpression(node.expression, aliases))
        ) {
            called = true;
            return;
        }
        ts.forEachChild(node, findCall);
    };
    findCall(sourceFile);
    return called;
}

function collectRepositoryMethodAliases(
    sourceFile: ts.SourceFile,
    method: "read" | "lsp",
): Set<string> {
    const aliases = new Set<string>();
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
            if (
                ts.isIdentifier(node.name) &&
                isRepositoryMethodExpression(node.initializer, method)
            ) {
                aliases.add(node.name.text);
            } else if (
                ts.isObjectBindingPattern(node.name) &&
                isRepositoryExpression(node.initializer)
            ) {
                for (const element of node.name.elements) {
                    const property = element.propertyName ?? element.name;
                    if (
                        ts.isIdentifier(property) &&
                        property.text === method &&
                        ts.isIdentifier(element.name)
                    ) {
                        aliases.add(element.name.text);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return aliases;
}

function isAliasCallExpression(
    expression: ts.Expression,
    aliases: Set<string>,
): boolean {
    const unwrapped = unwrapExpression(expression);
    return ts.isIdentifier(unwrapped) && aliases.has(unwrapped.text);
}

function isRepositoryExpression(expression: ts.Expression): boolean {
    const unwrapped = unwrapExpression(expression);
    return ts.isIdentifier(unwrapped) && unwrapped.text === "repo";
}

function isRepositoryMethodExpression(
    rawExpression: ts.Expression,
    method: "read" | "lsp",
): boolean {
    const expression = unwrapExpression(rawExpression);
    if (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression)
    ) {
        return (
            expression.expression.text === "repo" &&
            expression.name.text === method
        );
    }
    return (
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "repo" &&
        ts.isStringLiteral(expression.argumentExpression) &&
        expression.argumentExpression.text === method
    );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current)) {
        current = current.expression;
    }
    return current;
}

function createExploreValidator(enableLsp: boolean) {
    return createScriptValidator({
        apiParamName: "repo",
        getSandboxDeclarations: (parameters) =>
            generateSandboxDeclarations(parameters, enableLsp),
    });
}

export const transpileExploreScript = sharedTranspileScript;
