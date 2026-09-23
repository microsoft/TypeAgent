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
    TranslationBenchPublicTurnLineage,
    TranslationBenchTargetAction,
} from "../../synthesizer/benchmark.js";

import {
    parseSealToolsRow,
    sealToolsSource,
    toSealToolsFunctionTool,
    type SealToolsCall,
    type SealToolsSourceRow,
} from "./getDataset.js";
import { PythonNumber } from "../pythonLiteral.js";
import {
    getSealToolsTypeAgentOverride,
    type SealToolsParameterScoreSpec,
} from "./typeAgentOverrides.js";

export const SEAL_SCHEMA_NAME = "sealtools";
export const DATASET_NAME = "seal-tools-validation";

const REF = /^API_call_\d+$/;

const sha256 = (text: string): string =>
    createHash("sha256").update(text).digest("hex");

// Seal gold as serialized in the eval row; numbers keep their Python `str()`
// spelling as `{ __pythonNumber }` so exact Seal scoring can be replayed.
export interface SealToolsGoldCall {
    api: string;
    parameters: Record<string, unknown>;
    responses: string[];
}

// Python `str()` spelling of a numeric lexeme (e.g. `1.50` -> `1.5`).
function toPythonNumberString(lexeme: string): string {
    const value = Number(lexeme);
    const isFloat = /[.eE]/.test(lexeme);
    if (!isFloat) return BigInt(lexeme).toString();
    if (Object.is(value, -0)) return "-0.0";
    const absolute = Math.abs(value);
    if (Number.isInteger(value) && absolute < 1e16) {
        return `${String(value)}.0`;
    }
    const text =
        absolute !== 0 && (absolute < 1e-4 || absolute >= 1e16)
            ? value.toExponential()
            : String(value);
    return text.replace(/e([+-])(\d)$/, "e$10$2");
}

function mapPythonNumbers(
    value: unknown,
    map: (lexeme: string) => unknown,
): unknown {
    if (value instanceof PythonNumber) return map(value.lexeme);
    if (Array.isArray(value)) {
        return value.map((item) => mapPythonNumbers(item, map));
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                mapPythonNumbers(item, map),
            ]),
        );
    }
    return value;
}

function toGoldCall(
    call: SealToolsCall,
    map: (lexeme: string) => unknown,
): SealToolsGoldCall {
    return {
        api: call.api,
        parameters: mapPythonNumbers(call.parameters, map) as Record<
            string,
            unknown
        >,
        responses: [...call.responses],
    };
}

// Map Seal-Tools calls to expected actions. A parameter value equal to another
// call's `API_call_N` response marks the row as ordered, but the literal gold
// value is preserved. The benchmark must not introduce synthetic `${...}`
// placeholders that the Seal grader never sees.
function toExpectedActions(calls: SealToolsGoldCall[]): {
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
): SealToolsParameterScoreSpec[] {
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
    sealToolsGoldActions: SealToolsGoldCall[];
    expectedActions: TranslationBenchBenchmarkAction[];
    order: TranslationBenchOrder;
    parameterScore: SealToolsParameterScoreSpec[];
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
        dimensions: {
            ...row.dimensions,
            arity: expectedActions.length,
            shape: expectedActions.length > 1 ? "multi" : "simple",
        },
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
    row: SealToolsSourceRow,
    rowIndex: number,
): TypeAgentEvalRow | undefined {
    const human = row.conversations.find((c) => c.from === "human")?.value;
    if (human === undefined) return undefined;

    let parsed: ReturnType<typeof parseSealToolsRow>;
    let tools: OpenAIFunctionTool[];
    try {
        parsed = parseSealToolsRow(row);
        tools = parsed?.tools.map(toSealToolsFunctionTool) ?? [];
    } catch {
        return undefined;
    }
    if (parsed === undefined) return undefined;

    const { actions, ordered } = toExpectedActions(
        parsed.calls.map((call) => toGoldCall(call, Number)),
    );
    const order: TranslationBenchOrder = ordered ? "strict" : "any";
    const parameterScore = createSealToolsParameterScore(actions, tools);
    const targetAction: TranslationBenchTargetAction = {
        schemaName: SEAL_SCHEMA_NAME,
        actionName: actions[0]!.actionName,
    };
    const difficulty = difficultyOf(row.id);
    const canonical = JSON.stringify({
        utterance: parsed.utterance,
        expectedActions: actions,
        order,
    });
    const lineage: TranslationBenchPublicTurnLineage = {
        dataset: sealToolsSource.dataset,
        revision: sealToolsSource.revision,
        config: sealToolsSource.config,
        split: sealToolsSource.split,
        rowIndex,
        rowId: row.id,
        sourceUrl: `https://huggingface.co/datasets/${sealToolsSource.dataset}`,
        sourcePart: "conversations",
        rawRowHash: sha256(JSON.stringify(row)),
        sourceSliceHash: sha256(human),
        canonicalPayloadHash: sha256(canonical),
        transformVersion: 1,
    };

    return applySealToolsTypeAgentOverride({
        id: `sealtools-${row.id}`,
        utterance: parsed.utterance,
        schemaName: SEAL_SCHEMA_NAME,
        tools,
        sealToolsGoldActions: parsed.calls.map((call) =>
            toGoldCall(call, (lexeme) => ({
                __pythonNumber: toPythonNumberString(lexeme),
            })),
        ),
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
    hfRows: SealToolsSourceRow[],
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
