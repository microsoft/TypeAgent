// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildSnapshot, ViewCitation } from "./viewTypes.js";

export interface ViewPassage extends ViewCitation {
    passageId: string;
}

function paragraphs(content: string) {
    return [...content.matchAll(/[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g)].map(
        (match) => ({
            locator: `chars:${match.index}-${match.index! + match[0].length}`,
            excerpt: match[0],
        }),
    );
}
export function retainedPassages(input: ViewBuildSnapshot): ViewPassage[] {
    return input.inputs.flatMap((source, sourceIndex) =>
        paragraphs(source.content).map((passage, index) => ({
            ...passage,
            passageId: `p${sourceIndex}-${index}`,
            sourceId: source.sourceId,
            revisionId: source.revisionId,
        })),
    );
}
export function labelViewInput(
    input: ViewBuildSnapshot,
    passages: ViewPassage[],
) {
    return {
        ...input,
        inputs: input.inputs.map((source) => ({
            ...source,
            passages: passages.filter(
                (passage) =>
                    passage.sourceId === source.sourceId &&
                    passage.revisionId === source.revisionId,
            ),
        })),
    };
}
export function evidenceRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Evidence response must contain an object");
    return value as Record<string, unknown>;
}
export function evidenceArray(value: unknown, limit = 2000): unknown[] {
    if (!Array.isArray(value) || value.length > limit)
        throw new Error("Evidence response requires a bounded array");
    return value;
}
export function evidenceText(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 120000)
        throw new Error("Evidence response requires bounded nonempty text");
    return value;
}
export function evidenceChoice<T extends string>(
    value: unknown,
    choices: readonly T[],
): T {
    const choice = choices.find((entry) => entry === value);
    if (!choice) throw new Error("Unsupported evidence classification");
    return choice;
}
export function resolvePassages(
    value: unknown,
    passages: ViewPassage[],
): ViewPassage[] {
    return evidenceArray(value).map((id) => {
        const passage = passages.find(
            (entry) => entry.passageId === evidenceText(id),
        );
        if (!passage) throw new Error("Unknown retained passage reference");
        return passage;
    });
}
export function exactEvidenceCoverage<T>(
    entries: T[],
    ids: string[],
    key: (entry: T) => string,
    message = "Evidence audit omitted or duplicated required identities",
): void {
    const actual = new Set(entries.map(key));
    if (
        actual.size !== entries.length ||
        actual.size !== ids.length ||
        ids.some((id) => !actual.has(id))
    )
        throw new Error(message);
}
