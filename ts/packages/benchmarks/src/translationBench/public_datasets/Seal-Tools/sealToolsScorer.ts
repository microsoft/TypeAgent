// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface SealToolsGoldAction {
    api: string;
    parameters: Readonly<Record<string, unknown>>;
}

export interface SealToolsPrediction {
    actionName: string;
    parameters?: unknown;
}

export interface SealToolsScoredCase {
    gold: readonly SealToolsGoldAction[];
    predictions?: readonly SealToolsPrediction[];
}

export interface SealToolsMetric {
    precision: number | undefined;
    recall: number | undefined;
    f1: number | undefined;
}

export interface SealToolsScore {
    formatAccuracy: number | undefined;
    tool: SealToolsMetric;
    parameter: SealToolsMetric;
    counts: {
        formatted: number;
        cases: number;
        correctTools: number;
        predictedTools: number;
        goldTools: number;
        correctParameters: number;
        predictedParameters: number;
        goldParameters: number;
    };
}

export interface SealToolsScoreOptions {
    ignoreStringCase?: boolean;
}

function metric(
    correct: number,
    predicted: number,
    gold: number,
): SealToolsMetric {
    const precision = predicted === 0 ? undefined : correct / predicted;
    const recall = gold === 0 ? undefined : correct / gold;
    const f1 =
        precision === undefined || recall === undefined
            ? undefined
            : precision + recall === 0
              ? 0
              : (2 * precision * recall) / (precision + recall);
    return { precision, recall, f1 };
}

function parameterRecord(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};
}

function validateCase(
    scoredCase: SealToolsScoredCase,
    caseIndex: number,
): void {
    if (typeof scoredCase !== "object" || scoredCase === null) {
        throw new TypeError(`Case ${caseIndex} must be an object`);
    }
    if (!Array.isArray(scoredCase.gold)) {
        throw new TypeError(`Case ${caseIndex} gold must be an array`);
    }
    if (
        scoredCase.predictions !== undefined &&
        !Array.isArray(scoredCase.predictions)
    ) {
        throw new TypeError(`Case ${caseIndex} predictions must be an array`);
    }
    for (const [actionIndex, action] of scoredCase.gold.entries()) {
        if (typeof action !== "object" || action === null) {
            throw new TypeError(
                `Case ${caseIndex} gold action ${actionIndex} must be an object`,
            );
        }
        if (typeof action.api !== "string") {
            throw new TypeError(
                `Case ${caseIndex} gold action ${actionIndex} api must be a string`,
            );
        }
        if (parameterRecord(action.parameters) !== action.parameters) {
            throw new TypeError(
                `Case ${caseIndex} gold action ${actionIndex} parameters must be an object`,
            );
        }
    }
    for (const [actionIndex, action] of (
        scoredCase.predictions ?? []
    ).entries()) {
        if (typeof action !== "object" || action === null) {
            throw new TypeError(
                `Case ${caseIndex} prediction ${actionIndex} must be an object`,
            );
        }
        if (typeof action.actionName !== "string") {
            throw new TypeError(
                `Case ${caseIndex} prediction ${actionIndex} actionName must be a string`,
            );
        }
        if (
            Object.prototype.hasOwnProperty.call(action, "parameters") &&
            parameterRecord(action.parameters) !== action.parameters
        ) {
            throw new TypeError(
                `Case ${caseIndex} prediction ${actionIndex} parameters must be an object`,
            );
        }
    }
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

export function scoreSealTools(
    cases: readonly SealToolsScoredCase[],
    options: SealToolsScoreOptions = {},
): SealToolsScore {
    const ignoreStringCase = options.ignoreStringCase ?? false;
    let formatted = 0;
    let correctTools = 0;
    let predictedTools = 0;
    let goldTools = 0;
    let correctParameters = 0;
    let predictedParameters = 0;
    let goldParameters = 0;

    for (const [caseIndex, scoredCase] of cases.entries()) {
        validateCase(scoredCase, caseIndex);
        goldTools += scoredCase.gold.length;
        for (const action of scoredCase.gold) {
            goldParameters += Object.keys(action.parameters).length;
        }

        if (scoredCase.predictions === undefined) continue;
        formatted++;
        for (const predicted of scoredCase.predictions) {
            predictedTools++;
            const parameters = parameterRecord(predicted.parameters);
            predictedParameters += Object.keys(parameters).length;
            // Seal scores each prediction against the first gold API match.
            // Gold actions are not consumed, so duplicate predictions count.
            const matchedGold = scoredCase.gold.find(
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
        formatAccuracy:
            cases.length === 0 ? undefined : formatted / cases.length,
        tool: metric(correctTools, predictedTools, goldTools),
        parameter: metric(
            correctParameters,
            predictedParameters,
            goldParameters,
        ),
        counts: {
            formatted,
            cases: cases.length,
            correctTools,
            predictedTools,
            goldTools,
            correctParameters,
            predictedParameters,
            goldParameters,
        },
    };
}
