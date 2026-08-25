// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonNumber } from "../pythonLiteral.js";

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

const PENDING_ACTION_NAME = "pendingRequestAction";
const MAX_RAW_RESPONSE_DEPTH = 100;

export interface SealToolsRawAction {
    actionName: string;
    parameters?: unknown;
}

export interface SealToolsTranslationResult {
    chosenActions: readonly SealToolsRawAction[];
    rawChosenActions?: readonly SealToolsRawAction[];
    error?: unknown;
}

export interface SealToolsRawActionCandidates {
    actions: SealToolsRawAction[];
    finalizedActionNames: string[];
}

// Return the end of one balanced object or array candidate.
function findJsonEnd(text: string, start: number): number | undefined {
    const stack: string[] = [];
    let quote = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const character = text[index]!;
        if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quote = false;
            continue;
        }
        if (character === '"') {
            quote = true;
            continue;
        }
        if (character === "{" || character === "[") {
            stack.push(character);
            continue;
        }
        if (character !== "}" && character !== "]") continue;

        const opener = stack.pop();
        const matches =
            (opener === "{" && character === "}") ||
            (opener === "[" && character === "]");
        if (!matches) return undefined;
        if (stack.length === 0) return index + 1;
    }
    return undefined;
}

// Preserve JSON number lexemes because Seal compares their Python spellings.
function parseJsonWithNumberLexemes(text: string): unknown {
    const parse = JSON.parse as unknown as (
        source: string,
        reviver: (
            key: string,
            value: unknown,
            context?: { source?: string },
        ) => unknown,
    ) => unknown;
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "{" && text[start] !== "[") continue;
        const end = findJsonEnd(text, start);
        if (end === undefined) continue;
        try {
            return parse(text.slice(start, end), (_key, value, context) => {
                if (typeof value !== "number") return value;
                if (context?.source === undefined) {
                    throw new Error(
                        "JSON.parse does not expose number lexemes",
                    );
                }
                return new PythonNumber(context.source);
            });
        } catch {
            // A balanced prose fragment may precede the actual JSON document.
        }
    }
    throw new SyntaxError("Response does not contain valid JSON");
}

// Add one action and the name produced after dispatcher finalization.
function addAction(
    action: Readonly<Record<string, unknown>>,
    finalizedName: string,
    result: SealToolsRawActionCandidates,
): void {
    if (typeof action.actionName !== "string") return;
    result.actions.push({
        actionName: action.actionName,
        ...(Object.prototype.hasOwnProperty.call(action, "parameters")
            ? { parameters: action.parameters }
            : {}),
    });
    result.finalizedActionNames.push(finalizedName);
}

// Flatten direct actions and the dispatcher's multiple-action envelope.
function collectRawActions(
    value: unknown,
    result: SealToolsRawActionCandidates,
    depth = 0,
): void {
    if (depth > MAX_RAW_RESPONSE_DEPTH) {
        throw new SyntaxError("Response exceeds maxDepth");
    }
    if (Array.isArray(value)) {
        for (const item of value) collectRawActions(item, result, depth + 1);
        return;
    }
    if (
        typeof value !== "object" ||
        value === null ||
        value instanceof PythonNumber
    ) {
        return;
    }

    const record = value as Record<string, unknown>;
    if (record.actionName === "multiple") {
        const parameters = parameterRecord(record.parameters);
        const requests = parameters.requests;
        if (Array.isArray(requests)) {
            for (const request of requests) {
                const entry = parameterRecord(request);
                const nestedAction = parameterRecord(entry.action);
                if (typeof nestedAction.actionName === "string") {
                    addAction(
                        nestedAction,
                        "pendingResultEntityId" in entry
                            ? PENDING_ACTION_NAME
                            : nestedAction.actionName,
                        result,
                    );
                } else if (typeof entry.actionName === "string") {
                    addAction(entry, entry.actionName, result);
                } else if ("pendingResultEntityId" in entry) {
                    result.finalizedActionNames.push(PENDING_ACTION_NAME);
                }
            }
        }

        // Pending requests finalize without a provider tool action.
        const pendingRequests = parameters.pendingRequests;
        if (Array.isArray(pendingRequests)) {
            result.finalizedActionNames.push(
                ...pendingRequests.map(() => PENDING_ACTION_NAME),
            );
        }
        return;
    }

    if (typeof record.actionName === "string") {
        addAction(record, record.actionName, result);
        return;
    }
    for (const item of Object.values(record)) {
        collectRawActions(item, result, depth + 1);
    }
}

// Parse one response without consulting runner state.
export function parseSealToolsRawResponse(
    text: string,
): SealToolsRawActionCandidates {
    const result: SealToolsRawActionCandidates = {
        actions: [],
        finalizedActionNames: [],
    };
    collectRawActions(parseJsonWithNumberLexemes(text), result);
    return result;
}

// Compare action-name multisets because Seal does not require call order.
function hasSameActionNames(
    expected: readonly SealToolsRawAction[],
    actual: readonly string[],
): boolean {
    if (expected.length !== actual.length) return false;
    const remaining = [...actual];
    for (const action of expected) {
        const index = remaining.indexOf(action.actionName);
        if (index < 0) return false;
        remaining.splice(index, 1);
    }
    return remaining.length === 0;
}

// Recover the newest complete raw response accepted by the translation runner.
export function restoreSealToolsRawActions(
    translation: SealToolsTranslationResult,
    responses: readonly string[] | undefined,
): SealToolsRawAction[] | undefined {
    if (responses === undefined) return undefined;
    const accepted = translation.rawChosenActions ?? translation.chosenActions;

    // Repair and retry responses are appended, so inspect them newest first.
    for (let index = responses.length - 1; index >= 0; index--) {
        let raw: SealToolsRawActionCandidates;
        try {
            raw = parseSealToolsRawResponse(responses[index]!);
        } catch {
            continue;
        }

        // Failed translations still expose parseable provider actions.
        if (translation.error !== undefined && raw.actions.length > 0) {
            return raw.actions;
        }
        if (hasSameActionNames(accepted, raw.finalizedActionNames)) {
            return raw.actions;
        }
    }
    return undefined;
}
