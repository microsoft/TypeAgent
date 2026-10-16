// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro } from "@typeagent/copilot-macros";
import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import {
    recipeDigest,
    sealRecipeArtifact,
    type JsonValue,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";

export function macroProgramFixture(
    macro: CopilotToolMacro,
    inputs: Record<string, JsonValue> = Object.fromEntries(
        macro.inputs.map((input) => [input.name, "package.json"]),
    ),
) {
    const text =
        "async function execute(api: RecipeApi, params: JsonValue): Promise<JsonValue> { return params; }";
    const inputSchema: RuntimeJsonSchema = {
        type: "object",
        properties: Object.fromEntries(
            Object.entries(inputs).map(([key, value]) => [
                key,
                valueSchema(value),
            ]),
        ),
        required: macro.inputs
            .filter((input) => input.required)
            .map((input) => input.name),
        additionalProperties: false,
    };
    return sealRecipeArtifact({
        schemaVersion: 1,
        kind: "program",
        recipeId: macro.macroId,
        name: macro.name,
        description: macro.description,
        execution: "symbolic",
        authorization: "live_host",
        source: { language: "typescript", text, digest: recipeDigest(text) },
        executable: compileRecipeProgram(text),
        inputSchema,
        outputSchema: inputSchema,
        output: {
            kind: "value",
            requirements: ["Return current input"],
            identity: "current_run",
        },
        capabilities: [],
        semanticFunctions: [],
        applicability: { assumptions: [], unsupported: [] },
        generalization: [],
        specification: {
            id: "test",
            revision: "1",
            intent: macro.description,
            outputRequirements: ["Return current input"],
            rubric: "Exact input",
            counterexamples: ["Delete"],
        },
        matching: {
            grammar: ["<Start> = fixture -> {};"],
            examples: [
                { request: "fixture", input: inputs, evidenceIds: ["test"] },
            ],
            negatives: ["delete"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: macro.sourceTraceId,
            taskId: macro.sourceTraceId,
            tokenId: macro.sourceTraceId,
            evidenceIds: ["test"],
            legacySource: { macroId: macro.macroId, version: macro.version },
        },
        fixtures: [
            {
                id: "test",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: macro.createdAt,
    });
}

function valueSchema(value: JsonValue): RuntimeJsonSchema {
    if (value === null) return { type: "null" };
    if (typeof value === "string") return { type: "string" };
    if (typeof value === "boolean") return { type: "boolean" };
    if (typeof value === "number") return { type: "number" };
    if (Array.isArray(value))
        return { type: "array", items: valueSchema(value[0] ?? null) };
    return {
        type: "object",
        properties: Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                key,
                valueSchema(child),
            ]),
        ),
        required: Object.keys(value),
        additionalProperties: false,
    };
}
