// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CopilotToolMacro,
    MacroValueType,
    ValueExpression,
} from "./contracts.js";
import { constructResultPath } from "./resultPath.js";

export class MacroExpressionError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export function resolveMacroExpression(
    expression: ValueExpression,
    inputs: Record<string, unknown>,
    results: ReadonlyMap<string, unknown>,
): unknown {
    if (expression.kind === "literal") return expression.value;
    if (expression.kind === "template") {
        const value = structuredClone(expression.value);
        for (const binding of expression.bindings) {
            let parent = value as Record<string, unknown>;
            for (const segment of binding.path.slice(0, -1)) {
                const child = parent[segment];
                if (
                    !Object.prototype.hasOwnProperty.call(parent, segment) ||
                    child === null ||
                    typeof child !== "object"
                ) {
                    throw new MacroExpressionError(
                        "invalidTemplatePath",
                        `Template path is unavailable: ${binding.path.join(".")}`,
                    );
                }
                parent = child as Record<string, unknown>;
            }
            Object.defineProperty(parent, binding.path.at(-1)!, {
                value: resolveMacroExpression(
                    binding.expression,
                    inputs,
                    results,
                ),
                configurable: true,
                enumerable: true,
                writable: true,
            });
        }
        return value;
    }
    if (expression.kind === "input") {
        if (!Object.prototype.hasOwnProperty.call(inputs, expression.name)) {
            throw new MacroExpressionError(
                "missingInput",
                `Required macro input is missing: ${expression.name}`,
            );
        }
        return inputs[expression.name];
    }
    if (!results.has(expression.stepId)) {
        throw new MacroExpressionError(
            "missingStepResult",
            `Step result is unavailable: ${expression.stepId}`,
        );
    }
    if (expression.kind !== "stepResult" && expression.kind !== "resultPath")
        throw new MacroExpressionError(
            "unsupportedExpression",
            "Unsupported macro expression.",
        );
    let value = results.get(expression.stepId);
    for (const segment of expression.path ?? []) {
        if (value === null || typeof value !== "object") {
            throw new MacroExpressionError(
                "invalidStepResultPath",
                `Step result path is unavailable: ${expression.stepId}.${segment}`,
            );
        }
        const record = value as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(record, segment)) {
            throw new MacroExpressionError(
                "invalidStepResultPath",
                `Step result path is unavailable: ${expression.stepId}.${segment}`,
            );
        }
        value = record[segment];
    }
    return expression.kind === "resultPath"
        ? constructResultPath(value, expression.suffix)
        : value;
}

function getValueType(value: unknown): MacroValueType {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value as Exclude<MacroValueType, "null" | "array">;
}

function referencedInputs(expression: ValueExpression): string[] {
    if (expression.kind === "input") return [expression.name];
    if (expression.kind !== "template") return [];
    return expression.bindings.flatMap((binding) =>
        referencedInputs(binding.expression),
    );
}

export function validateMacroInputs(
    macro: CopilotToolMacro,
    inputs: Record<string, unknown>,
): void {
    for (const input of macro.inputs) {
        if (
            input.required &&
            !Object.prototype.hasOwnProperty.call(inputs, input.name)
        ) {
            throw new MacroExpressionError(
                "missingInput",
                `Required macro input is missing: ${input.name}`,
            );
        }
        if (
            Object.prototype.hasOwnProperty.call(inputs, input.name) &&
            input.valueType !== undefined &&
            getValueType(inputs[input.name]) !== input.valueType
        ) {
            throw new MacroExpressionError(
                "invalidInputType",
                `Macro input '${input.name}' must be ${input.valueType}.`,
            );
        }
    }
    for (const step of macro.steps) {
        for (const inputName of referencedInputs(step.arguments)) {
            if (!Object.prototype.hasOwnProperty.call(inputs, inputName)) {
                throw new MacroExpressionError(
                    "missingInput",
                    `Required macro input is missing: ${inputName}`,
                );
            }
        }
    }
}
