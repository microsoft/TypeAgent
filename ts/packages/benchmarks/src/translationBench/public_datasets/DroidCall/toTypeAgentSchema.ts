// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

import type {
    OpenAIFunctionTool,
    TranslationBenchBenchmarkAction,
    TranslationBenchOrder,
    TranslationBenchParameterScoreSpec,
    TranslationBenchPublicTurnLineage,
    TranslationBenchTargetAction,
} from "../../synthesizer/benchmark.js";

import {
    classifyDroidCalls,
    hasDroidCallResultReference,
    type DroidCall,
} from "./droidCallParser.js";
import { DROIDCALL_HF } from "./get-dataset.js";

export const DROIDCALL_SCHEMA_NAME = "droidcall";
export const DATASET_NAME = "droid-call-multi-action";

const CONTACT_INFO_SCHEMA = {
    type: "object",
    properties: Object.fromEntries(
        ["email", "phone", "name", "company", "address"].map((name) => [
            name,
            { type: "string" },
        ]),
    ),
    required: [],
    additionalProperties: false,
};

const JSON_TYPE = {
    str: { type: "string" },
    int: { type: "integer" },
    bool: { type: "boolean" },
    "List[str]": { type: "array", items: { type: "string" } },
    "list[str]": { type: "array", items: { type: "string" } },
    "Optional[List[str]]": { type: "array", items: { type: "string" } },
    "Dict[str, Any]": CONTACT_INFO_SCHEMA,
    "Optional[Dict[str, Any]]": CONTACT_INFO_SCHEMA,
} satisfies Record<string, Record<string, unknown>>;

const sha256 = (text: string): string =>
    createHash("sha256").update(text).digest("hex");

export interface DroidCallArgumentSpec {
    type: keyof typeof JSON_TYPE;
    description?: string;
    required?: boolean;
    default?: unknown;
    match_type?: "strict" | "semantic" | "ignore";
    reason?: string;
}

export interface DroidCallTool {
    name: string;
    description: string;
    arguments: Record<string, DroidCallArgumentSpec>;
    returns?: unknown;
    examples?: string[];
}

export interface DroidCallSourceRow {
    query: string;
    answers: DroidCall[];
    tools: DroidCallTool[];
}

export interface DroidCallGoldAction {
    id: number;
    name: string;
    arguments: Record<string, unknown>;
}

export interface DroidCallTypeAgentEvalRow {
    id: string;
    utterance: string;
    schemaName: string;
    tools: OpenAIFunctionTool[];
    droidCallGoldActions: DroidCallGoldAction[];
    expectedActions: TranslationBenchBenchmarkAction[];
    order: TranslationBenchOrder;
    parameterScore: TranslationBenchParameterScoreSpec[];
    targetAction: TranslationBenchTargetAction;
    dimensions: Record<string, string | number | boolean>;
    lineage: TranslationBenchPublicTurnLineage;
}

export function toDroidCallFunctionTool(
    tool: DroidCallTool,
): OpenAIFunctionTool {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    for (const [name, spec] of Object.entries(tool.arguments)) {
        const jsonType = JSON_TYPE[spec.type];
        if (jsonType === undefined) {
            throw new Error(
                `Unsupported DroidCall type '${spec.type}' for ${tool.name}.${name}`,
            );
        }
        properties[name] = {
            ...jsonType,
            ...(spec.description !== undefined
                ? { description: spec.description }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(spec, "default")
                ? { default: spec.default }
                : {}),
        };
        if (spec.required === true) required.push(name);
    }
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties,
                required,
                additionalProperties: false,
            },
        },
    };
}

export function createDroidCallParameterScore(
    actions: TranslationBenchBenchmarkAction[],
    tools: OpenAIFunctionTool[],
): TranslationBenchParameterScoreSpec[] {
    const toolsByName = new Map(
        tools.map((tool) => [tool.function.name, tool]),
    );
    return actions.map((action) => {
        const parameters = toolsByName.get(action.actionName)?.function
            .parameters as { required?: unknown } | undefined;
        const required = new Set(
            Array.isArray(parameters?.required)
                ? parameters.required.filter(
                      (field): field is string => typeof field === "string",
                  )
                : [],
        );
        return {
            defaultMode: "normalized",
            fields: Object.fromEntries(
                Object.keys(action.parameters ?? {})
                    .filter((field) => !required.has(field))
                    .map((field) => [field, "optionalNormalized"] as const),
            ),
        };
    });
}

export function toDroidCallTypeAgentEvalRow(
    row: DroidCallSourceRow,
    split: "train" | "test",
    rowIndex: number,
): DroidCallTypeAgentEvalRow | undefined {
    if (row.answers.length < 2) return undefined;

    const tools = row.tools.map(toDroidCallFunctionTool);
    const expectedActions = row.answers.map((answer) => ({
        schemaName: DROIDCALL_SCHEMA_NAME,
        actionName: answer.name,
        parameters: structuredClone(answer.arguments),
    }));
    const order: TranslationBenchOrder = row.answers.some((answer) =>
        hasDroidCallResultReference(answer.arguments),
    )
        ? "strict"
        : "any";
    const id = `droidcall-${split}-${rowIndex}`;
    const canonical = JSON.stringify({
        utterance: row.query,
        expectedActions,
        order,
    });
    const lineage: TranslationBenchPublicTurnLineage = {
        dataset: DROIDCALL_HF.dataset,
        revision: DROIDCALL_HF.revision,
        config: "default",
        split,
        rowIndex,
        rowId: id,
        sourceUrl: `https://huggingface.co/datasets/${DROIDCALL_HF.dataset}`,
        sourcePart: "query+answers+tools",
        rawRowHash: sha256(JSON.stringify(row)),
        sourceSliceHash: sha256(JSON.stringify([row.query, row.answers])),
        canonicalPayloadHash: sha256(canonical),
        transformVersion: 1,
    };
    const shape = classifyDroidCalls(row.answers);
    return {
        id,
        utterance: row.query,
        schemaName: DROIDCALL_SCHEMA_NAME,
        tools,
        droidCallGoldActions: structuredClone(row.answers),
        expectedActions,
        order,
        parameterScore: createDroidCallParameterScore(expectedActions, tools),
        targetAction: {
            schemaName: DROIDCALL_SCHEMA_NAME,
            actionName: expectedActions[0]!.actionName,
        },
        dimensions: {
            source: "droidcall",
            split,
            arity: expectedActions.length,
            shape,
            dependency: order === "strict" ? "sequential" : "parallel",
        },
        lineage,
    };
}

export function buildDroidCallMultiActionRows(
    trainRows: DroidCallSourceRow[],
    testRows: DroidCallSourceRow[],
): DroidCallTypeAgentEvalRow[] {
    return [
        ...trainRows.map((row, index) =>
            toDroidCallTypeAgentEvalRow(row, "train", index),
        ),
        ...testRows.map((row, index) =>
            toDroidCallTypeAgentEvalRow(row, "test", index),
        ),
    ].filter((row): row is DroidCallTypeAgentEvalRow => row !== undefined);
}
