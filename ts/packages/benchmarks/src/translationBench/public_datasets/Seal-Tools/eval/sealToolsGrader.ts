// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TranslationBenchRow } from "../../../runner/runner.js";
import type { SealToolsGoldAction } from "../toTypeAgentSchema.js";

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
>;

export interface SealToolsScoreOptions {
    ignoreStringCase?: boolean;
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

function toOfficialParameterValue(
    value: unknown,
    key: string,
    gold: SealToolsGoldAction,
    allGold: readonly SealToolsGoldAction[],
): unknown {
    if (typeof value !== "string") return value;
    const match = /^\$\{step(\d+)\.result\}$/.exec(value);
    if (match === null) return value;
    const expected = gold.parameters[key];
    const producer = allGold[Number(match[1])];
    return typeof expected === "string" &&
        producer?.responses.includes(expected)
        ? expected
        : value;
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
        if (row.error !== undefined) continue;
        formatted++;
        for (const predicted of row.chosenActions) {
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
                    comparableString(
                        toOfficialParameterValue(
                            value,
                            matchedKey,
                            matchedGold,
                            gold,
                        ),
                        ignoreStringCase,
                    ) ===
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
