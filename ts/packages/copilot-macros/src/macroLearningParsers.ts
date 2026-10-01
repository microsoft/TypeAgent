// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MacroExecutionRecipe,
    MacroInput,
    MacroLearningBuild,
    MacroPostcondition,
    MacroStep,
    MacroValueType,
    ValueExpression,
} from "./contracts.js";
import {
    assertLearningJson,
    assertLearningRequests,
    assertLearningValue,
} from "./macroLearningValidation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
    if (
        !isRecord(value) ||
        Object.keys(value).some((key) => !keys.includes(key))
    ) {
        throw new Error(
            "Expected a learning JSON object with supported fields.",
        );
    }
    return value;
}

function text(value: unknown, field: string, limit = 32_000): string {
    if (typeof value !== "string" || !value.trim() || value.length > limit) {
        throw new Error(
            `Learning ${field} must be a non-empty bounded string.`,
        );
    }
    assertLearningValue(value);
    return value;
}

function list(
    value: unknown,
    field: string,
    min: number,
    max: number,
): unknown[] {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
        throw new Error(`Learning ${field} must contain ${min}-${max} items.`);
    }
    return value;
}

function valueType(value: unknown): MacroValueType {
    switch (value) {
        case "null":
        case "array":
        case "object":
        case "string":
        case "number":
        case "boolean":
            return value;
        default:
            throw new Error("Unsupported learning value type.");
    }
}

function parseInput(value: unknown): MacroInput {
    const input = record(value, [
        "name",
        "description",
        "required",
        "secret",
        "valueType",
    ]);
    const name = text(input.name, "input name", 2_000);
    if (
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
        typeof input.required !== "boolean" ||
        input.secret !== false ||
        typeof input.description !== "string"
    ) {
        throw new Error("Invalid or secret learning input.");
    }
    return {
        name,
        description: input.description,
        required: input.required,
        secret: false,
        valueType: valueType(input.valueType),
    };
}

function parsePath(value: unknown, allowEmpty: boolean): string[] {
    return list(value, "expression path", allowEmpty ? 0 : 1, 30).map(
        (part) => {
            if (
                typeof part !== "string" ||
                ["__proto__", "constructor", "prototype"].includes(part)
            ) {
                throw new Error("Invalid learning expression path.");
            }
            return part;
        },
    );
}

type BoundExpression = Exclude<ValueExpression, { kind: "template" }>;

function parseBoundExpression(value: unknown): BoundExpression {
    const expression = record(value, [
        "kind",
        "value",
        "name",
        "stepId",
        "path",
    ]);
    switch (expression.kind) {
        case "literal":
            record(value, ["kind", "value"]);
            assertLearningValue(expression.value);
            return { kind: "literal", value: expression.value };
        case "input":
            record(value, ["kind", "name"]);
            return {
                kind: "input",
                name: text(expression.name, "input reference", 2_000),
            };
        case "stepResult":
            record(value, ["kind", "stepId", "path"]);
            return {
                kind: "stepResult",
                stepId: text(expression.stepId, "result reference", 2_000),
                ...(expression.path === undefined
                    ? {}
                    : { path: parsePath(expression.path, true) }),
            };
        default:
            throw new Error("Unsupported learning expression kind.");
    }
}

function parseExpression(value: unknown): ValueExpression {
    if (!isRecord(value) || value.kind !== "template") {
        return parseBoundExpression(value);
    }
    const expression = record(value, ["kind", "value", "bindings"]);
    assertLearningValue(expression.value);
    return {
        kind: "template",
        value: expression.value,
        bindings: list(expression.bindings, "template bindings", 1, 100).map(
            (value) => {
                const binding = record(value, ["path", "expression"]);
                return {
                    path: parsePath(binding.path, false),
                    expression: parseBoundExpression(binding.expression),
                };
            },
        ),
    };
}

function parsePostcondition(value: unknown): MacroPostcondition {
    const condition = record(value, ["kind", "valueType", "path"]);
    if (condition.kind === "resultType") {
        record(value, ["kind", "valueType"]);
        return {
            kind: "resultType",
            valueType: valueType(condition.valueType),
        };
    }
    if (condition.kind === "resultPathExists") {
        record(value, ["kind", "path"]);
        return {
            kind: "resultPathExists",
            path: parsePath(condition.path, false),
        };
    }
    throw new Error("Unsupported learning result guard.");
}

function parseStep(value: unknown): MacroStep {
    const step = record(value, [
        "id",
        "toolName",
        "mcpServerName",
        "arguments",
        "executionClass",
        "sourceToolCallId",
        "schemaFingerprint",
        "postconditions",
    ]);
    const id = text(step.id, "step ID", 2_000);
    if (
        !/^[a-zA-Z0-9_-]+$/.test(id) ||
        (step.executionClass !== "replayable" &&
            step.executionClass !== "agentRequired")
    ) {
        throw new Error("Invalid learning step identity or execution class.");
    }
    const postconditions = list(
        step.postconditions,
        "result guards",
        1,
        51,
    ).map(parsePostcondition);
    if (!postconditions.some((condition) => condition.kind === "resultType")) {
        throw new Error("Learning steps require a recorded result type guard.");
    }
    return {
        id,
        toolName: text(step.toolName, "tool name", 2_000),
        ...(step.mcpServerName === undefined
            ? {}
            : {
                  mcpServerName: text(
                      step.mcpServerName,
                      "MCP server name",
                      2_000,
                  ),
              }),
        arguments: parseExpression(step.arguments),
        executionClass: step.executionClass,
        sourceToolCallId: text(
            step.sourceToolCallId,
            "source tool call ID",
            2_000,
        ),
        ...(step.schemaFingerprint === undefined
            ? {}
            : {
                  schemaFingerprint: text(
                      step.schemaFingerprint,
                      "schema fingerprint",
                      2_000,
                  ),
              }),
        postconditions,
    };
}

export function parseMacroExecutionRecipe(
    value: unknown,
): MacroExecutionRecipe {
    assertLearningValue(value);
    const recipe = record(value, [
        "schemaVersion",
        "traceId",
        "request",
        "toolCallIds",
        "description",
        "uncertainties",
    ]);
    if (recipe.schemaVersion !== 1)
        throw new Error("Unsupported execution recipe schema version.");
    const toolCallIds = list(
        recipe.toolCallIds,
        "source tool call IDs",
        1,
        100,
    ).map((id) => text(id, "source tool call ID", 2_000));
    if (new Set(toolCallIds).size !== toolCallIds.length) {
        throw new Error("Execution recipe repeats source tool call IDs.");
    }
    return {
        schemaVersion: 1,
        traceId: text(recipe.traceId, "trace ID", 2_000),
        request: text(recipe.request, "canonical request", 8_000),
        toolCallIds,
        description: text(recipe.description, "recipe description"),
        uncertainties: list(
            recipe.uncertainties,
            "recipe uncertainties",
            0,
            100,
        ).map((item) => text(item, "recipe uncertainty")),
    };
}

export function parseMacroLearningBuild(value: unknown): MacroLearningBuild {
    // Input-schema secret:false is metadata, not a secret-bearing argument.
    assertLearningJson(value);
    const build = record(value, [
        "name",
        "description",
        "inputs",
        "steps",
        "exampleInputs",
        "requests",
        "unsupportedOutputs",
    ]);
    const inputs = list(build.inputs, "inputs", 0, 100).map(parseInput);
    if (new Set(inputs.map((input) => input.name)).size !== inputs.length) {
        throw new Error("Learning build repeats input names.");
    }
    if (!isRecord(build.exampleInputs))
        throw new Error("Learning example inputs must be a JSON object.");
    const requests = list(
        build.requests,
        "original request and variants",
        4,
        6,
    ).map((request) => text(request, "request variant", 8_000));
    assertLearningRequests(requests);
    const parsed: MacroLearningBuild = {
        name: text(build.name, "macro name", 2_000),
        description: text(build.description, "macro description"),
        inputs,
        steps: list(build.steps, "source steps", 1, 100).map(parseStep),
        exampleInputs: build.exampleInputs,
        requests,
        ...(build.unsupportedOutputs === undefined
            ? {}
            : {
                  unsupportedOutputs: list(
                      build.unsupportedOutputs,
                      "unsupported outputs",
                      0,
                      100,
                  ).map((item) => text(item, "unsupported output")),
              }),
    };
    assertLearningValue({
        ...parsed,
        inputs: inputs.map(({ secret: _secret, ...input }) => input),
    });
    return structuredClone(parsed);
}
