// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Converts Seal-Tools `validation` rows into TypeAgent translation-bench
// records: one `metadata` record (a synthetic `sealtools` schema holding the
// union of all tools) plus one `case` record per row.
//
// The record shapes mirror `synthesizer/benchmark.ts` (imported as types).

import { createHash } from "node:crypto";

import type {
    OpenAIFunctionTool,
    TranslationBenchBenchmarkAction,
    TranslationBenchOrder,
    TranslationBenchParameterScoreSpec,
    TranslationBenchPublicTurnLineage,
    TranslationBenchTargetAction,
} from "../../synthesizer/benchmark.js";

import { SEAL_TOOLS_HF, type SealToolsHfRow } from "./get-dataset.js";
import {
    decodePythonStringContents,
    isPythonNumber,
    parsePythonLiteral,
    type PyValue,
} from "./pythonLiteral.js";
import { getSealToolsTypeAgentOverride } from "./typeAgentOverrides.js";

export const SEAL_SCHEMA_NAME = "sealtools";
export const DATASET_NAME = "seal-tools-validation";

const REF = /^API_call_\d+$/;

// Seal-Tools loose type strings -> JSON-Schema types for the function tool.
const JSON_TYPE: Record<string, string> = {
    str: "string",
    string: "string",
    int: "integer",
    integer: "integer",
    float: "number",
    number: "number",
    double: "number",
    bool: "boolean",
    boolean: "boolean",
    list: "array",
    array: "array",
    dict: "object",
    object: "object",
};

const sha256 = (text: string): string =>
    createHash("sha256").update(text).digest("hex");

interface SealTool {
    api_name: string;
    api_description?: string;
    parameters: Record<string, { type?: string; description?: string }>;
    required: string[];
}

export interface SealToolsGoldAction {
    api: string;
    parameters: Record<string, unknown>;
    responses: string[];
}

type SealCall = SealToolsGoldAction;

function asRecord(value: PyValue): Record<string, PyValue> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("expected an object");
    }
    return value as Record<string, PyValue>;
}

function toSealTool(value: PyValue): SealTool {
    const obj = asRecord(value);
    const params: SealTool["parameters"] = {};
    const rawParams = obj.parameters;
    if (
        typeof rawParams === "object" &&
        rawParams !== null &&
        !Array.isArray(rawParams)
    ) {
        for (const [name, spec] of Object.entries(rawParams)) {
            const s =
                spec && typeof spec === "object" && !Array.isArray(spec)
                    ? (spec as Record<string, PyValue>)
                    : {};
            const paramSpec: { type?: string; description?: string } = {
                type: typeof s.type === "string" ? s.type : "str",
            };
            if (typeof s.description === "string") {
                paramSpec.description = s.description;
            }
            params[name] = paramSpec;
        }
    }
    const required = Array.isArray(obj.required)
        ? obj.required.filter((r): r is string => typeof r === "string")
        : [];
    const tool: SealTool = {
        api_name: String(obj.api_name),
        parameters: params,
        required,
    };
    if (typeof obj.api_description === "string") {
        tool.api_description = obj.api_description;
    }
    return tool;
}

function toFunctionTool(tool: SealTool): OpenAIFunctionTool {
    const properties: Record<string, Record<string, unknown>> = {};
    for (const [name, spec] of Object.entries(tool.parameters)) {
        const jtype =
            JSON_TYPE[String(spec.type ?? "str").toLowerCase()] ?? "string";
        const prop: Record<string, unknown> = { type: jtype };
        if (spec.description) prop.description = spec.description;
        if (jtype === "array") prop.items = { type: "string" };
        properties[name] = prop;
    }
    return {
        type: "function",
        function: {
            name: tool.api_name,
            description: tool.api_description ?? "",
            parameters: {
                type: "object",
                properties,
                required: [...tool.required],
                additionalProperties: false,
            },
        },
    };
}

// Extract the per-row `api_list` catalog and the `task_instruction` utterance
// from the `human` turn.
function parseHumanTurn(value: string): {
    tools: SealTool[];
    utterance: string;
} {
    const apiListMarker = "api_list = ";
    const apiIdx = value.indexOf(apiListMarker);
    if (apiIdx < 0) throw new Error("human turn has no api_list");
    const { value: apiList, end } = parsePythonLiteral(
        value,
        apiIdx + apiListMarker.length,
    );
    if (!Array.isArray(apiList)) throw new Error("api_list is not an array");

    const taskKey = "task_instruction = ";
    const taskIdx = value.indexOf(taskKey, end);
    if (taskIdx < 0) throw new Error("human turn has no task_instruction");
    const instructionStart = taskIdx + taskKey.length;
    const parsed = parsePythonLiteral(value, instructionStart);
    let instruction = parsed.value;
    if (typeof instruction !== "string") {
        throw new Error("task_instruction is not a string");
    }
    const outputIdx = value.indexOf("\nOutput:", parsed.end);
    if (
        outputIdx >= 0 &&
        value.slice(parsed.end, outputIdx).trim().length > 0
    ) {
        const raw = value.slice(instructionStart, outputIdx).trim();
        if (raw[0] !== '"' && raw[0] !== "'") {
            throw new Error("task_instruction has no opening quote");
        }
        instruction = decodePythonStringContents(raw.slice(1));
    }
    return { tools: apiList.map(toSealTool), utterance: instruction };
}

// Parse the `gpt` turn: a Python-repr list of {api, parameters, responses}.
function parseGptTurn(
    value: string,
    preserveNumberLexemes = false,
): SealCall[] {
    const trimmed = value.trim();
    if (trimmed === "-1" || trimmed === "") return [];
    const { value: calls } = parsePythonLiteral(
        trimmed,
        0,
        preserveNumberLexemes,
    );
    if (!Array.isArray(calls)) return [];
    return calls.map((raw) => {
        const obj = asRecord(raw);
        const parameters: Record<string, unknown> = {};
        if (
            typeof obj.parameters === "object" &&
            obj.parameters !== null &&
            !Array.isArray(obj.parameters)
        ) {
            for (const [k, v] of Object.entries(obj.parameters)) {
                parameters[k] = v; // keep structured values (lists/objects) intact
            }
        }
        const responses = Array.isArray(obj.responses)
            ? obj.responses.filter((r): r is string => typeof r === "string")
            : [];
        return { api: String(obj.api), parameters, responses };
    });
}

function unwrapPythonNumbers(value: unknown): unknown {
    if (isPythonNumber(value)) return Number(value.__pythonNumber);
    if (Array.isArray(value)) return value.map(unwrapPythonNumbers);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                unwrapPythonNumbers(item),
            ]),
        );
    }
    return value;
}

// Map Seal-Tools calls to expected actions. A parameter value equal to another
// call's `API_call_N` response marks the row as ordered, but the literal gold
// value is preserved. The benchmark must not introduce synthetic `${...}`
// placeholders that the Seal grader never sees.
function toExpectedActions(calls: SealCall[]): {
    actions: TranslationBenchBenchmarkAction[];
    ordered: boolean;
} {
    // Pass 1: map every response name to the step that produces it (handles
    // forward references, not just already-seen ones).
    const producerOf = new Map<string, number>();
    calls.forEach((call, step) => {
        for (const response of call.responses) producerOf.set(response, step);
    });
    const actions: TranslationBenchBenchmarkAction[] = [];
    let ordered = false;
    calls.forEach((call, step) => {
        const parameters: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(call.parameters)) {
            const producer =
                typeof val === "string" && REF.test(val)
                    ? producerOf.get(val)
                    : undefined;
            if (producer !== undefined && producer !== step) {
                ordered = true;
            }
            parameters[key] = val;
        }
        actions.push({
            schemaName: SEAL_SCHEMA_NAME,
            actionName: call.api,
            parameters,
        });
    });
    return { actions, ordered };
}

export function createSealToolsParameterScore(
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

export function hasSealToolsApiCallReference(
    row: Pick<TypeAgentEvalRow, "expectedActions">,
): boolean {
    return /API_call_\d+/.test(JSON.stringify(row.expectedActions));
}

function difficultyOf(id: string): string {
    if (id.includes("easy")) return "easy";
    if (id.includes("difficult")) return "difficult";
    return "unknown";
}

// A self-contained TypeAgent eval row: the utterance plus ONLY the tools that
// row is allowed to choose from (its Seal-Tools `api_list`), and the gold
// ordered actions. Tools live on the row so each case keeps its own candidate
// set instead of a shared global catalog.
export interface TypeAgentEvalRow {
    id: string;
    utterance: string;
    schemaName: string;
    tools: OpenAIFunctionTool[];
    sealToolsGoldActions: SealToolsGoldAction[];
    expectedActions: TranslationBenchBenchmarkAction[];
    order: TranslationBenchOrder;
    parameterScore: TranslationBenchParameterScoreSpec[];
    targetAction: TranslationBenchTargetAction;
    dimensions: Record<string, string | number | boolean>;
    typeAgentScoring?: {
        overrideReason: string;
        excluded: boolean;
    };
    lineage: TranslationBenchPublicTurnLineage;
}

export function applySealToolsTypeAgentOverride(
    row: TypeAgentEvalRow,
): TypeAgentEvalRow {
    const override = getSealToolsTypeAgentOverride(row.id);
    if (override === undefined) return row;
    const expectedActions = override.expectedActions ?? row.expectedActions;
    const parameterScore = createSealToolsParameterScore(
        expectedActions,
        row.tools,
    ).map((spec, index) => {
        const actionOverride =
            override.parameterScoreByAction?.[
                expectedActions[index]!.actionName
            ];
        return {
            ...spec,
            fields: {
                ...spec.fields,
                ...override.parameterScore?.[index]?.fields,
                ...actionOverride?.fields,
            },
            acceptedValues: {
                ...spec.acceptedValues,
                ...override.parameterScore?.[index]?.acceptedValues,
                ...actionOverride?.acceptedValues,
            },
        };
    });
    const canonicalPayloadHash = sha256(
        JSON.stringify({
            utterance: row.utterance,
            expectedActions,
            order: row.order,
        }),
    );
    return {
        ...row,
        expectedActions,
        parameterScore,
        targetAction: {
            schemaName: SEAL_SCHEMA_NAME,
            actionName: expectedActions[0]!.actionName,
        },
        typeAgentScoring: {
            overrideReason: override.reason,
            excluded: override.excludeFromScoring === true,
        },
        lineage: {
            ...row.lineage,
            canonicalPayloadHash,
            transformVersion: 2,
        },
    };
}

// Convert one Seal-Tools row into a TypeAgent eval row, or `undefined` when the
// row is unparseable or has no gold calls.
export function toTypeAgentEvalRow(
    row: SealToolsHfRow,
    rowIndex: number,
): TypeAgentEvalRow | undefined {
    const human = row.conversations.find((c) => c.from === "human")?.value;
    const gpt = row.conversations.find((c) => c.from === "gpt")?.value;
    if (human === undefined || gpt === undefined) return undefined;

    let parsedHuman: { tools: SealTool[]; utterance: string };
    let calls: SealCall[];
    try {
        parsedHuman = parseHumanTurn(human);
        calls = parseGptTurn(gpt, true);
    } catch {
        return undefined;
    }
    if (calls.length === 0) return undefined;

    const plainCalls = calls.map((call) => ({
        ...call,
        parameters: unwrapPythonNumbers(call.parameters) as Record<
            string,
            unknown
        >,
    }));
    const { actions, ordered } = toExpectedActions(plainCalls);
    const order: TranslationBenchOrder = ordered ? "strict" : "any";
    const tools = parsedHuman.tools.map(toFunctionTool);
    const parameterScore = createSealToolsParameterScore(actions, tools);
    const targetAction: TranslationBenchTargetAction = {
        schemaName: SEAL_SCHEMA_NAME,
        actionName: actions[0]!.actionName,
    };
    const difficulty = difficultyOf(row.id);
    const canonical = JSON.stringify({
        utterance: parsedHuman.utterance,
        expectedActions: actions,
        order,
    });
    const lineage: TranslationBenchPublicTurnLineage = {
        dataset: SEAL_TOOLS_HF.dataset,
        revision: SEAL_TOOLS_HF.revision,
        config: SEAL_TOOLS_HF.config,
        split: SEAL_TOOLS_HF.split,
        rowIndex,
        rowId: row.id,
        sourceUrl: `https://huggingface.co/datasets/${SEAL_TOOLS_HF.dataset}`,
        sourcePart: "conversations",
        rawRowHash: sha256(JSON.stringify(row)),
        sourceSliceHash: sha256(human),
        canonicalPayloadHash: sha256(canonical),
        transformVersion: 1,
    };

    return applySealToolsTypeAgentOverride({
        id: `sealtools-${row.id}`,
        utterance: parsedHuman.utterance,
        schemaName: SEAL_SCHEMA_NAME,
        tools,
        sealToolsGoldActions: structuredClone(calls),
        expectedActions: actions,
        order,
        parameterScore,
        targetAction,
        dimensions: {
            source: "seal-tools",
            split: "validation",
            arity: actions.length,
            shape: actions.length > 1 ? "multi" : "simple",
            dependency: ordered ? "sequential" : "parallel",
            difficulty,
        },
        lineage,
    });
}

export interface SealToolsEvalRows {
    rows: TypeAgentEvalRow[];
    skipped: number;
}

export function buildSealToolsValidationRows(
    hfRows: SealToolsHfRow[],
): SealToolsEvalRows {
    const rows: TypeAgentEvalRow[] = [];
    let skipped = 0;
    hfRows.forEach((hfRow, rowIndex) => {
        const evalRow = toTypeAgentEvalRow(hfRow, rowIndex);
        if (evalRow === undefined) {
            skipped++;
            return;
        }
        rows.push(evalRow);
    });
    return { rows, skipped };
}
