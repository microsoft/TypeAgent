// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PythonNumber } from "../pythonLiteral.js";

const PENDING_ACTION_NAME = "pendingRequestAction";

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

// Return objects as named records while rejecting arrays and scalar values.
function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

// Find one complete JSON object or array inside a model response.
function findJsonDocument(text: string): string {
    const objectStart = text.indexOf("{");
    const arrayStart = text.indexOf("[");
    const start =
        objectStart < 0
            ? arrayStart
            : arrayStart < 0
              ? objectStart
              : Math.min(objectStart, arrayStart);
    if (start < 0) {
        throw new SyntaxError("Response does not contain JSON");
    }

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
        if (!matches) throw new SyntaxError("Response contains invalid JSON");
        if (stack.length === 0) return text.slice(start, index + 1);
    }
    throw new SyntaxError("Response contains incomplete JSON");
}

// Preserve JSON number lexemes because Seal compares their Python spellings.
function parseJsonWithNumberLexemes(text: string): unknown {
    const document = findJsonDocument(text);
    return (
        JSON.parse as unknown as (
            source: string,
            reviver: (
                key: string,
                value: unknown,
                context?: { source?: string },
            ) => unknown,
        ) => unknown
    )(document, (_key, value, context) =>
        typeof value === "number" && context?.source !== undefined
            ? new PythonNumber(context.source)
            : value,
    );
}

// Add one action and the name produced after dispatcher finalization.
function addAction(
    action: Record<string, unknown>,
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
): void {
    if (Array.isArray(value)) {
        for (const item of value) collectRawActions(item, result);
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
                const nestedAction = asRecord(entry.action);
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
    for (const item of Object.values(record)) collectRawActions(item, result);
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
