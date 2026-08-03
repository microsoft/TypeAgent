// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createScriptValidator,
    transpileScript as sharedTranspileScript,
} from "@typeagent/agent-flows";
import {
    exploreFlowParameters,
    generateSandboxDeclarations,
} from "./sandboxDeclarations.js";
import ts from "typescript";

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

export function callsRepositoryTool(source: string, tool: string): boolean {
    const sourceFile = ts.createSourceFile(
        "script.ts",
        source,
        ts.ScriptTarget.ES2022,
        true,
    );
    let found = false;
    const visit = (node: ts.Node): void => {
        if (found) {
            return;
        }
        if (ts.isCallExpression(node)) {
            const expression = node.expression;
            if (
                (ts.isPropertyAccessExpression(expression) &&
                    ts.isIdentifier(expression.expression) &&
                    expression.expression.text === "repo" &&
                    expression.name.text === tool) ||
                (ts.isElementAccessExpression(expression) &&
                    ts.isIdentifier(expression.expression) &&
                    expression.expression.text === "repo" &&
                    ts.isStringLiteralLike(expression.argumentExpression) &&
                    expression.argumentExpression.text === tool)
            ) {
                found = true;
                return;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

function createExploreValidator(enableLsp: boolean) {
    return createScriptValidator({
        apiParamName: "repo",
        getSandboxDeclarations: (parameters) =>
            generateSandboxDeclarations(parameters, enableLsp),
    });
}

export const transpileExploreScript = sharedTranspileScript;
