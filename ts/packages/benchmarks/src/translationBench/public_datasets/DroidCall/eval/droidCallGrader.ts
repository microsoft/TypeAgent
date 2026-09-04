// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TranslationBenchRow } from "../../../runner/runner.js";
import type { DroidCallGoldAction } from "../toTypeAgentSchema.js";
import {
    isPythonNumber,
    toPythonNumberString,
} from "../../Seal-Tools/pythonLiteral.js";

export interface DroidCallMetric {
    precision: number | undefined;
    recall: number | undefined;
    f1: number | undefined;
}

export interface DroidCallScore {
    formatAccuracy: number | undefined;
    tool: DroidCallMetric;
    parameter: DroidCallMetric;
    counts: {
        formatted: number;
        rows: number;
        correctTools: number;
        predictedTools: number;
        goldTools: number;
        correctParameters: number;
        predictedParameters: number;
        goldParameters: number;
    };
}

type DroidCallScoredRow = Pick<
    TranslationBenchRow,
    "caseId" | "chosenActions" | "error"
> &
    Partial<Pick<TranslationBenchRow, "rawChosenActions">>;

export interface DroidCallScoreOptions {
    ignoreStringCase?: boolean;
    rawResponsesByCase?: ReadonlyMap<string, readonly string[]>;
}

function metric(
    correct: number,
    predicted: number,
    gold: number,
): DroidCallMetric {
    if (correct * predicted * gold === 0) {
        return { precision: undefined, recall: undefined, f1: undefined };
    }
    const precision = correct / predicted;
    const recall = correct / gold;
    return {
        precision,
        recall,
        f1: (2 * precision * recall) / (precision + recall),
    };
}

function pythonString(value: unknown): string {
    if (isPythonNumber(value)) return value.__pythonNumber;
    if (typeof value === "string") return value;
    if (value === null) return "None";
    if (value === true) return "True";
    if (value === false) return "False";
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
        return `[${value.map(pythonRepr).join(", ")}]`;
    }
    if (typeof value === "object") {
        return `{${Object.entries(value)
            .map(([key, item]) => `${pythonRepr(key)}: ${pythonRepr(item)}`)
            .join(", ")}}`;
    }
    return String(value);
}

function parameterRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function pythonRepr(value: unknown): string {
    if (typeof value !== "string") return pythonString(value);
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function foldStringCase(value: unknown): unknown {
    if (isPythonNumber(value)) return value;
    if (typeof value === "string") return value.toLocaleLowerCase("en-US");
    if (Array.isArray(value)) return value.map(foldStringCase);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key.toLocaleLowerCase("en-US"),
                foldStringCase(item),
            ]),
        );
    }
    return value;
}

function comparableString(value: unknown, ignoreStringCase: boolean): string {
    return pythonString(ignoreStringCase ? foldStringCase(value) : value);
}

function parseJsonWithNumberLexemes(text: string): unknown {
    // TypeChat 0.1.1 parses from the first opening brace through the last
    // closing brace, which also accepts markdown-fenced JSON.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
        throw new Error("Response does not contain a JSON object");
    }
    const jsonText = text.slice(start, end + 1);
    return (
        JSON.parse as unknown as (
            text: string,
            reviver: (
                key: string,
                value: unknown,
                context?: { source?: string },
            ) => unknown,
        ) => unknown
    )(jsonText, (_key, value, context) =>
        typeof value === "number" && context?.source
            ? { __pythonNumber: toPythonNumberString(context.source) }
            : value,
    );
}

interface RawActionCandidates {
    actions: Record<string, unknown>[];
    officialActions: Record<string, unknown>[];
    finalizedNames: string[];
}

function normalizeResultReferences(
    value: unknown,
    resultIndexes: ReadonlyMap<string, number>,
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) =>
            normalizeResultReferences(item, resultIndexes),
        );
    }
    if (typeof value !== "object" || value === null || isPythonNumber(value)) {
        return value;
    }
    const entries = Object.entries(value);
    if (
        entries.length === 1 &&
        entries[0]![0] === "$result" &&
        typeof entries[0]![1] === "string"
    ) {
        const index = resultIndexes.get(entries[0]![1]);
        if (index !== undefined) return `#${index}`;
    }
    return Object.fromEntries(
        entries.map(([key, item]) => [
            key,
            normalizeResultReferences(item, resultIndexes),
        ]),
    );
}

function collectRawActions(value: unknown, result: RawActionCandidates): void {
    if (Array.isArray(value)) {
        for (const item of value) collectRawActions(item, result);
        return;
    }
    if (typeof value !== "object" || value === null || isPythonNumber(value)) {
        return;
    }
    const record = value as Record<string, unknown>;
    if (record.actionName === "multiple") {
        const parameters = parameterRecord(record.parameters);
        const requests = parameters.requests;
        if (Array.isArray(requests)) {
            const resultIndexes = new Map<string, number>();
            for (const [index, request] of requests.entries()) {
                const resultEntityId = parameterRecord(request).resultEntityId;
                if (typeof resultEntityId === "string") {
                    resultIndexes.set(resultEntityId, index);
                }
            }
            for (const request of requests) {
                const entry = parameterRecord(request);
                const action = parameterRecord(entry.action);
                if (typeof action.actionName === "string") {
                    result.actions.push(action);
                    result.officialActions.push({
                        ...action,
                        ...(Object.prototype.hasOwnProperty.call(
                            action,
                            "parameters",
                        )
                            ? {
                                  parameters: normalizeResultReferences(
                                      action.parameters,
                                      resultIndexes,
                                  ),
                              }
                            : {}),
                    });
                    result.finalizedNames.push(
                        "pendingResultEntityId" in entry
                            ? "pendingRequestAction"
                            : action.actionName,
                    );
                } else if ("pendingResultEntityId" in entry) {
                    // The dispatcher finalizes an actionless dependency as a
                    // pendingRequestAction, but DroidCall does not score it as a
                    // provider tool prediction.
                    result.finalizedNames.push("pendingRequestAction");
                }
            }
        }
        const pendingRequests = parameters.pendingRequests;
        if (Array.isArray(pendingRequests)) {
            result.finalizedNames.push(
                ...pendingRequests.map(() => "pendingRequestAction"),
            );
        }
        return;
    }
    if (typeof record.actionName === "string") {
        result.actions.push(record);
        result.officialActions.push(record);
        result.finalizedNames.push(record.actionName);
        return;
    }
    for (const item of Object.values(record)) collectRawActions(item, result);
}

function predictedActions(
    row: DroidCallScoredRow,
): TranslationBenchRow["chosenActions"] {
    return row.rawChosenActions ?? row.chosenActions;
}

export function restoreDroidCallRawActions(
    row: DroidCallScoredRow,
    responses: readonly string[] | undefined,
): TranslationBenchRow["chosenActions"] | undefined {
    if (responses === undefined) return undefined;
    const predicted = predictedActions(row);
    // TypeChat repair and runner retries append calls in order. Accept only a
    // single response whose complete action list matches the accepted result.
    for (let i = responses.length - 1; i >= 0; i--) {
        const raw: RawActionCandidates = {
            actions: [],
            officialActions: [],
            finalizedNames: [],
        };
        try {
            collectRawActions(parseJsonWithNumberLexemes(responses[i]!), raw);
        } catch {
            continue;
        }
        if (raw.finalizedNames.length !== predicted.length) continue;
        const remaining = [...raw.finalizedNames];
        const complete = predicted.every((action) => {
            const index = remaining.findIndex(
                (name) => name === action.actionName,
            );
            if (index < 0) return false;
            remaining.splice(index, 1);
            return true;
        });
        if (complete && remaining.length === 0) {
            return raw.actions.map((action) => ({
                schemaName: "droidcall",
                actionName: action.actionName as string,
                ...(Object.prototype.hasOwnProperty.call(action, "parameters")
                    ? { parameters: action.parameters as never }
                    : {}),
            }));
        }
    }
    return undefined;
}

export function restoreDroidCallOfficialActions(
    row: DroidCallScoredRow,
    responses: readonly string[] | undefined,
): TranslationBenchRow["chosenActions"] | undefined {
    if (responses === undefined) return undefined;
    const predicted = predictedActions(row);
    for (let i = responses.length - 1; i >= 0; i--) {
        const raw: RawActionCandidates = {
            actions: [],
            officialActions: [],
            finalizedNames: [],
        };
        try {
            collectRawActions(parseJsonWithNumberLexemes(responses[i]!), raw);
        } catch {
            continue;
        }
        if (raw.finalizedNames.length !== predicted.length) continue;
        const remaining = [...raw.finalizedNames];
        const complete = predicted.every((action) => {
            const index = remaining.findIndex(
                (name) => name === action.actionName,
            );
            if (index < 0) return false;
            remaining.splice(index, 1);
            return true;
        });
        if (complete && remaining.length === 0) {
            return raw.officialActions.map((action) => ({
                schemaName: "droidcall",
                actionName: action.actionName as string,
                ...(Object.prototype.hasOwnProperty.call(action, "parameters")
                    ? { parameters: action.parameters as never }
                    : {}),
            }));
        }
    }
    return undefined;
}

export function scoreDroidCall(
    rows: readonly DroidCallScoredRow[],
    goldByCaseId: ReadonlyMap<string, readonly DroidCallGoldAction[]>,
    options: DroidCallScoreOptions = {},
): DroidCallScore {
    const ignoreStringCase = options.ignoreStringCase ?? false;
    let formatted = 0;
    let correctTools = 0;
    let predictedTools = 0;
    let goldTools = 0;
    let correctParameters = 0;
    let predictedParameters = 0;
    let goldParameters = 0;

    for (const row of rows) {
        const gold = goldByCaseId.get(row.caseId) ?? [];
        goldTools += gold.length;
        for (const action of gold) {
            goldParameters += Object.keys(action.arguments).length;
        }
        if (row.error !== undefined) continue;
        const predictions =
            options.rawResponsesByCase === undefined
                ? predictedActions(row)
                : restoreDroidCallRawActions(
                      row,
                      options.rawResponsesByCase.get(row.caseId),
                  );
        if (predictions === undefined) {
            continue;
        }
        formatted++;
        for (const predicted of predictions) {
            predictedTools++;
            const parameters = parameterRecord(predicted.parameters);
            predictedParameters += Object.keys(parameters).length;
            const matchedGold = gold.find(
                (action) =>
                    comparableString(action.name, ignoreStringCase) ===
                    comparableString(predicted.actionName, ignoreStringCase),
            );
            if (matchedGold === undefined) continue;
            correctTools++;
            for (const [key, value] of Object.entries(parameters)) {
                const matchedKey = Object.keys(matchedGold.arguments).find(
                    (goldKey) =>
                        comparableString(goldKey, ignoreStringCase) ===
                        comparableString(key, ignoreStringCase),
                );
                if (
                    matchedKey !== undefined &&
                    comparableString(value, ignoreStringCase) ===
                        comparableString(
                            matchedGold.arguments[matchedKey],
                            ignoreStringCase,
                        )
                ) {
                    correctParameters++;
                }
            }
        }
    }

    return {
        formatAccuracy: rows.length > 0 ? formatted / rows.length : undefined,
        tool: metric(correctTools, predictedTools, goldTools),
        parameter: metric(
            correctParameters,
            predictedParameters,
            goldParameters,
        ),
        counts: {
            formatted,
            rows: rows.length,
            correctTools,
            predictedTools,
            goldTools,
            correctParameters,
            predictedParameters,
            goldParameters,
        },
    };
}
