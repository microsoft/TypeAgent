// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TranslationBenchRow } from "../../../runner/runner.js";
import type { SealToolsGoldAction } from "../toTypeAgentSchema.js";
import { isPythonNumber, toPythonNumberString } from "../pythonLiteral.js";

export interface SealToolsMetric {
    precision: number | undefined;
    recall: number | undefined;
    f1: number | undefined;
}

export interface SealToolsOfficialScore {
    formatAccuracy: number | undefined;
    tool: SealToolsMetric;
    parameter: SealToolsMetric;
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

type SealToolsScoredRow = Pick<
    TranslationBenchRow,
    "caseId" | "chosenActions" | "error"
> &
    Partial<Pick<TranslationBenchRow, "rawChosenActions">>;

export interface SealToolsScoreOptions {
    ignoreStringCase?: boolean;
    rawResponsesByCase?: ReadonlyMap<string, readonly string[]>;
}

function metric(
    correct: number,
    predicted: number,
    gold: number,
): SealToolsMetric {
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
    // Accept TypeAgent's object envelope and Seal's top-level action array.
    // Taking the first opener through its matching final delimiter also
    // accepts markdown-fenced JSON, like both evaluation harnesses do.
    const objectStart = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const useArray =
        arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
    const start = useArray ? arrayStart : objectStart;
    const end = useArray ? text.lastIndexOf("]") : text.lastIndexOf("}");
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
    finalizedNames: string[];
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
            for (const request of requests) {
                const entry = parameterRecord(request);
                const action = parameterRecord(entry.action);
                if (typeof action.actionName === "string") {
                    result.actions.push(action);
                    result.finalizedNames.push(
                        "pendingResultEntityId" in entry
                            ? "pendingRequestAction"
                            : action.actionName,
                    );
                } else if (typeof entry.actionName === "string") {
                    const flattenedAction = {
                        actionName: entry.actionName,
                        ...(Object.prototype.hasOwnProperty.call(
                            entry,
                            "parameters",
                        )
                            ? { parameters: entry.parameters }
                            : {}),
                    };
                    result.actions.push(flattenedAction);
                    result.finalizedNames.push(entry.actionName);
                } else if ("pendingResultEntityId" in entry) {
                    // The dispatcher finalizes an actionless dependency as a
                    // pendingRequestAction, but Seal does not score it as a
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
        result.finalizedNames.push(record.actionName);
        return;
    }
    for (const item of Object.values(record)) collectRawActions(item, result);
}

function predictedActions(
    row: SealToolsScoredRow,
): TranslationBenchRow["chosenActions"] {
    return row.rawChosenActions ?? row.chosenActions;
}

export function restoreSealToolsRawActions(
    row: SealToolsScoredRow,
    responses: readonly string[] | undefined,
): TranslationBenchRow["chosenActions"] | undefined {
    if (responses === undefined) return undefined;
    const predicted = predictedActions(row);
    // TypeChat repair and runner retries append calls in order. Accept only a
    // single response whose complete action list matches the accepted result.
    for (let i = responses.length - 1; i >= 0; i--) {
        const raw: RawActionCandidates = { actions: [], finalizedNames: [] };
        try {
            collectRawActions(parseJsonWithNumberLexemes(responses[i]!), raw);
        } catch {
            continue;
        }
        if (row.error !== undefined && raw.actions.length > 0) {
            return raw.actions.map((action) => ({
                schemaName: "seal",
                actionName: action.actionName as string,
                ...(Object.prototype.hasOwnProperty.call(action, "parameters")
                    ? { parameters: action.parameters as never }
                    : {}),
            }));
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
                schemaName: "seal",
                actionName: action.actionName as string,
                ...(Object.prototype.hasOwnProperty.call(action, "parameters")
                    ? { parameters: action.parameters as never }
                    : {}),
            }));
        }
    }
    return undefined;
}

export function scoreSealToolsOfficial(
    rows: readonly SealToolsScoredRow[],
    goldByCaseId: ReadonlyMap<string, readonly SealToolsGoldAction[]>,
    options: SealToolsScoreOptions = {},
): SealToolsOfficialScore {
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
            goldParameters += Object.keys(action.parameters).length;
        }
        const predictions =
            options.rawResponsesByCase === undefined
                ? row.error === undefined
                    ? predictedActions(row)
                    : undefined
                : restoreSealToolsRawActions(
                      row,
                      options.rawResponsesByCase.get(row.caseId),
                  );
        if (predictions === undefined) {
            if (row.error !== undefined) continue;
            throw new Error(
                `Successful case '${row.caseId}' has no parseable complete raw response`,
            );
        }
        formatted++;
        for (const predicted of predictions) {
            predictedTools++;
            const parameters = parameterRecord(predicted.parameters);
            predictedParameters += Object.keys(parameters).length;
            const matchedGold = gold.find(
                (action) =>
                    comparableString(action.api, ignoreStringCase) ===
                    comparableString(predicted.actionName, ignoreStringCase),
            );
            if (matchedGold === undefined) continue;
            correctTools++;
            for (const [key, value] of Object.entries(parameters)) {
                const matchedKey = Object.keys(matchedGold.parameters).find(
                    (goldKey) =>
                        comparableString(goldKey, ignoreStringCase) ===
                        comparableString(key, ignoreStringCase),
                );
                if (
                    matchedKey !== undefined &&
                    comparableString(value, ignoreStringCase) ===
                        comparableString(
                            matchedGold.parameters[matchedKey],
                            ignoreStringCase,
                        )
                ) {
                    correctParameters++;
                }
            }
        }
    }

    return {
        formatAccuracy: formatted > 0 ? formatted / rows.length : undefined,
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
