// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";

import { PythonNumber } from "../../pythonLiteral.js";

const PENDING_ACTION_NAME = "pendingRequestAction";
const MAX_RAW_RESPONSE_DEPTH = 100;
const MAX_RAW_RESPONSE_LENGTH = 1_000_000;
const MAX_JSON_CANDIDATES = 16;

export interface DroidCallRawAction {
    actionName: string;
    parameters?: unknown;
}

export interface DroidCallTranslationResult {
    chosenActions: readonly DroidCallRawAction[];
    rawChosenActions?: readonly DroidCallRawAction[];
}

export interface DroidCallRawActionCandidates {
    actions: DroidCallRawAction[];
    finalizedActionNames: string[];
}

// Return objects as named records while rejecting arrays and scalar values.
function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

// Return the end of one balanced JSON object or array candidate.
function findJsonEnd(text: string, start: number): number | undefined {
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const character = text[index]!;
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') {
            quoted = true;
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

// Preserve number spellings because the official grader compares Python values.
function parseJsonWithNumberLexemes(text: string): unknown[] {
    if (text.length > MAX_RAW_RESPONSE_LENGTH) {
        throw new SyntaxError("Response exceeds maxLength");
    }
    const values: unknown[] = [];
    let candidateCount = 0;
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
        candidateCount++;
        if (candidateCount > MAX_JSON_CANDIDATES) {
            throw new SyntaxError("Response exceeds maxJsonCandidates");
        }
        const end = findJsonEnd(text, start);
        if (end === undefined) continue;
        try {
            values.push(
                parse(text.slice(start, end), (_key, value, context) => {
                    if (typeof value !== "number") return value;
                    if (context?.source === undefined) {
                        throw new Error(
                            "JSON.parse does not expose number lexemes",
                        );
                    }
                    return new PythonNumber(context.source);
                }),
            );
            start = end - 1;
        } catch {
            // A balanced prose fragment may precede the JSON response.
        }
    }
    if (values.length === 0) {
        throw new SyntaxError("Response does not contain valid JSON");
    }
    return values;
}

// Reject action parameters that exceed the parser's nesting limit.
function assertRawValueDepth(value: unknown, depth = 0): void {
    if (depth > MAX_RAW_RESPONSE_DEPTH) {
        throw new SyntaxError("Response exceeds maxDepth");
    }
    if (Array.isArray(value)) {
        for (const item of value) assertRawValueDepth(item, depth + 1);
    } else if (typeof value === "object" && value !== null) {
        for (const item of Object.values(value)) {
            assertRawValueDepth(item, depth + 1);
        }
    }
}

// Preserve a provider action and its finalized dispatcher name.
function addAction(
    action: Readonly<Record<string, unknown>>,
    finalizedName: string,
    result: DroidCallRawActionCandidates,
): void {
    if (typeof action.actionName !== "string") return;
    const parameters = Object.prototype.hasOwnProperty.call(
        action,
        "parameters",
    )
        ? action.parameters
        : undefined;
    assertRawValueDepth(parameters);
    result.actions.push({
        actionName: action.actionName,
        ...(parameters !== undefined ? { parameters } : {}),
    });
    result.finalizedActionNames.push(finalizedName);
}

// Flatten direct actions and the dispatcher's multiple-action envelope.
function collectRawActions(
    value: unknown,
    result: DroidCallRawActionCandidates,
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
        const parameters = asRecord(record.parameters);
        const requests = parameters.requests;
        if (Array.isArray(requests)) {
            for (const request of requests) {
                const entry = asRecord(request);
                const action = asRecord(entry.action);
                if (typeof action.actionName === "string") {
                    addAction(
                        action,
                        "pendingResultEntityId" in entry
                            ? PENDING_ACTION_NAME
                            : action.actionName,
                        result,
                    );
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

// Parse one model response without consulting benchmark runner state.
export function parseDroidCallRawResponse(
    text: string,
): DroidCallRawActionCandidates {
    let selected: DroidCallRawActionCandidates | undefined;
    for (const value of parseJsonWithNumberLexemes(text)) {
        const result: DroidCallRawActionCandidates = {
            actions: [],
            finalizedActionNames: [],
        };
        collectRawActions(value, result);
        if (result.finalizedActionNames.length > 0) selected = result;
    }
    if (selected === undefined) {
        throw new SyntaxError("Response does not contain actions");
    }
    return selected;
}

// Compare action-name multisets because dispatcher finalization may reorder them.
function hasSameActionNames(
    expected: readonly DroidCallRawAction[],
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

// Compare parsed numbers with the runner's ordinary JSON number values.
function comparableRawValue(value: unknown): unknown {
    if (value instanceof PythonNumber) return Number(value.lexeme);
    if (Array.isArray(value)) return value.map(comparableRawValue);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                comparableRawValue(item),
            ]),
        );
    }
    return value;
}

// Match raw parameters when the runner retained the provider actions.
function hasSameRawActions(
    expected: readonly DroidCallRawAction[],
    actual: readonly DroidCallRawAction[],
): boolean {
    const remaining = [...actual];
    for (const action of expected) {
        if (action.actionName === PENDING_ACTION_NAME) continue;
        const index = remaining.findIndex(
            (candidate) =>
                candidate.actionName === action.actionName &&
                isDeepStrictEqual(
                    comparableRawValue(candidate.parameters),
                    action.parameters,
                ),
        );
        if (index < 0) return false;
        remaining.splice(index, 1);
    }
    return true;
}

// Recover the newest complete raw response accepted by the translation runner.
function restoreActions(
    translation: DroidCallTranslationResult,
    responses: readonly string[] | undefined,
): DroidCallRawAction[] | undefined {
    if (responses === undefined) return undefined;
    const accepted = translation.rawChosenActions ?? translation.chosenActions;
    for (let index = responses.length - 1; index >= 0; index--) {
        let raw: DroidCallRawActionCandidates;
        try {
            raw = parseDroidCallRawResponse(responses[index]!);
        } catch {
            continue;
        }
        if (
            hasSameActionNames(accepted, raw.finalizedActionNames) &&
            (translation.rawChosenActions === undefined ||
                hasSameRawActions(translation.rawChosenActions, raw.actions))
        ) {
            return raw.actions;
        }
    }
    return undefined;
}

export function restoreDroidCallRawActions(
    translation: DroidCallTranslationResult,
    responses: readonly string[] | undefined,
): DroidCallRawAction[] | undefined {
    return restoreActions(translation, responses);
}
