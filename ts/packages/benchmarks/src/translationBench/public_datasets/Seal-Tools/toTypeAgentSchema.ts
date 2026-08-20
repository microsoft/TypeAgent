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
    parsePythonLiteral,
    type PyValue,
} from "./pythonLiteral.js";

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
function parseGptTurn(value: string): SealCall[] {
    const trimmed = value.trim();
    if (trimmed === "-1" || trimmed === "") return [];
    const { value: calls } = parsePythonLiteral(trimmed);
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

// Map Seal-Tools calls to ordered expected actions. A parameter value equal to
// an earlier call's `API_call_N` response is a data dependency: it's rewritten
// to a `${stepK.result}` placeholder and returned as a ref field (so the grader
// can score it `ignore` — the opaque handle isn't a value a model can emit).
function toExpectedActions(calls: SealCall[]): {
    actions: TranslationBenchBenchmarkAction[];
    ordered: boolean;
    refFieldsByAction: string[][];
} {
    // Pass 1: map every response name to the step that produces it (handles
    // forward references, not just already-seen ones).
    const producerOf = new Map<string, number>();
    calls.forEach((call, step) => {
        for (const response of call.responses) producerOf.set(response, step);
    });
    const actions: TranslationBenchBenchmarkAction[] = [];
    const refFieldsByAction: string[][] = [];
    let ordered = false;
    calls.forEach((call, step) => {
        const parameters: Record<string, unknown> = {};
        const refFields: string[] = [];
        for (const [key, val] of Object.entries(call.parameters)) {
            const producer =
                typeof val === "string" && REF.test(val)
                    ? producerOf.get(val)
                    : undefined;
            if (producer !== undefined && producer !== step) {
                parameters[key] = `\${step${producer}.result}`;
                refFields.push(key);
                ordered = true;
            } else {
                parameters[key] = val;
            }
        }
        actions.push({
            schemaName: SEAL_SCHEMA_NAME,
            actionName: call.api,
            parameters,
        });
        refFieldsByAction.push(refFields);
    });
    return { actions, ordered, refFieldsByAction };
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
    lineage: TranslationBenchPublicTurnLineage;
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
        calls = parseGptTurn(gpt);
    } catch {
        return undefined;
    }
    if (calls.length === 0) return undefined;

    const { actions, ordered, refFieldsByAction } = toExpectedActions(calls);
    // Drop chained cases: a later action consuming an earlier step's result
    // (`${stepK.result}`) is a data dependency the tools-only eval can't score.
    if (ordered) return undefined;
    const order: TranslationBenchOrder = ordered ? "strict" : "any";
    // Dependency-ref fields carry an opaque `${stepK.result}` handle no model
    // can emit, so score them `ignore`; everything else stays exact.
    const parameterScore: TranslationBenchParameterScoreSpec[] = actions.map(
        (_, i) => {
            const fields: Record<string, "ignore"> = {};
            for (const field of refFieldsByAction[i]!) fields[field] = "ignore";
            return { defaultMode: "exact", fields };
        },
    );
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

    return {
        id: `sealtools-${row.id}`,
        utterance: parsedHuman.utterance,
        schemaName: SEAL_SCHEMA_NAME,
        tools: parsedHuman.tools.map(toFunctionTool),
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
    };
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
