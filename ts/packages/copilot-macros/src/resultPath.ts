// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro, ValueExpression } from "./contracts.js";

export function validateResultSuffix(
    suffix: unknown,
): asserts suffix is string {
    if (
        typeof suffix !== "string" ||
        (suffix !== "/content" &&
            !/^\?\$select=[A-Za-z][A-Za-z0-9]*(?:,[A-Za-z][A-Za-z0-9]*){0,19}(?![\s\S])/.test(
                suffix,
            ))
    ) {
        throw new Error("Unsupported result-path suffix.");
    }
}

export function constructResultPath(base: unknown, suffix: string): string {
    validateResultSuffix(suffix);
    if (
        typeof base !== "string" ||
        base.length > 2000 ||
        !/^\/drives\/[A-Za-z0-9!_-]+\/items\/[A-Za-z0-9_-]+(?![\s\S])/.test(
            base,
        )
    ) {
        throw new Error(
            "Result-path base must be an exact relative drive item path.",
        );
    }
    return base + suffix;
}

export function hasResultPath(expression: ValueExpression): boolean {
    if (
        !expression ||
        !["literal", "input", "stepResult", "resultPath", "template"].includes(
            expression.kind,
        )
    )
        throw new Error("Unsupported macro expression.");
    const allowed = {
        literal: ["kind", "value"],
        input: ["kind", "name"],
        stepResult: ["kind", "stepId", "path"],
        resultPath: ["kind", "stepId", "path", "suffix"],
        template: ["kind", "value", "bindings"],
    }[expression.kind];
    if (Object.keys(expression).some((key) => !allowed.includes(key)))
        throw new Error("Unsupported macro expression fields.");
    if (expression.kind === "resultPath") {
        validateResultSuffix(expression.suffix);
        if (
            !Array.isArray(expression.path) ||
            expression.path.length > 30 ||
            expression.path.some(
                (part) =>
                    typeof part !== "string" ||
                    part.length > 2000 ||
                    ["__proto__", "constructor", "prototype"].includes(part),
            )
        )
            throw new Error("Invalid result-path reference path.");
    }
    return (
        expression.kind === "resultPath" ||
        (expression.kind === "template" &&
            expression.bindings
                .map((binding) => hasResultPath(binding.expression))
                .includes(true))
    );
}

export function setMacroCapabilities(macro: CopilotToolMacro): void {
    if (
        macro.steps.map((step) => hasResultPath(step.arguments)).includes(true)
    ) {
        macro.schemaVersion = 2;
        macro.capabilities = ["result-path-v1"];
    } else {
        macro.schemaVersion = 1;
        delete macro.capabilities;
    }
}

export function assertMacroCapabilities(macro: CopilotToolMacro): void {
    if (!Array.isArray(macro.steps))
        throw new Error("Unsupported macro procedure.");
    const extended = macro.steps
        .map((step) => hasResultPath(step.arguments))
        .includes(true);
    const capabilities = macro.capabilities;
    if (macro.schemaVersion === 1) {
        if (extended || capabilities !== undefined)
            throw new Error("Macro v1 does not support new capabilities.");
    } else if (
        macro.schemaVersion !== 2 ||
        !extended ||
        !Array.isArray(capabilities) ||
        capabilities.length !== 1 ||
        capabilities[0] !== "result-path-v1"
    ) {
        throw new Error("Unsupported macro schema or capabilities.");
    }
}
