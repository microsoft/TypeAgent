// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invalidArgument } from "./errors.js";
import type { ScopeId, TermId, TurnId } from "./ids.js";
import { requireAbsoluteTimestamp, requireText } from "./metadata.js";

export type Term = {
    termId: TermId;
    scopeId: ScopeId;
    canonicalText: string;
    displayText: string;
    createdAt: string;
};

export type TermAlias = {
    termId: TermId;
    normalizedAlias: string;
    displayAlias: string;
    createdAt: string;
};

export type TermRole = "subject" | "method" | "artifact" | "person" | "place";

export type TurnTerm = {
    turnId: TurnId;
    termId: TermId;
    role?: TermRole;
};

export function createTerm(
    termId: TermId,
    scopeId: ScopeId,
    displayText: string,
    createdAt: string,
): Term {
    const normalizedDisplayText = requireText(displayText, "displayText");
    requireAbsoluteTimestamp(createdAt, "createdAt");

    return Object.freeze({
        termId,
        scopeId,
        canonicalText: normalizeTerm(normalizedDisplayText),
        displayText: normalizedDisplayText,
        createdAt,
    });
}

export function createTermAlias(
    termId: TermId,
    displayAlias: string,
    createdAt: string,
): TermAlias {
    const normalizedDisplayAlias = requireText(displayAlias, "displayAlias");
    requireAbsoluteTimestamp(createdAt, "createdAt");

    return Object.freeze({
        termId,
        normalizedAlias: normalizeTerm(normalizedDisplayAlias),
        displayAlias: normalizedDisplayAlias,
        createdAt,
    });
}

export function normalizeTerm(value: string): string {
    const normalized = value.normalize("NFKC").trim().toLocaleLowerCase("en");
    if (normalized.length === 0) {
        return invalidArgument("Term must not be empty");
    }
    return normalized.replace(/\s+/g, " ");
}
