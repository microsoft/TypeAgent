// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Deterministic gold-parameter hygiene for the translation-bench synthesizer.
 *
 * No per-action hardcodes. Gold should not store "unset" placeholders:
 * empty strings, empty arrays, null. Prefer omit. Non-empty values (including
 * boolean false / 0) are left alone — utterance grounding is the labeler's job.
 */

export function isEmptyGoldPlaceholder(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string" && value.trim() === "") {
        return true;
    }
    if (Array.isArray(value) && value.length === 0) {
        return true;
    }
    return false;
}

/**
 * Drop empty placeholder values from gold parameters.
 * Returns the same object reference when nothing changes; omits `parameters`
 * entirely when nothing remains.
 */
export function stripEmptyGoldPlaceholders(
    parameters: Record<string, unknown> | undefined,
): {
    parameters: Record<string, unknown> | undefined;
    removed: string[];
} {
    if (parameters === undefined) {
        return { parameters: undefined, removed: [] };
    }
    const removed: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parameters)) {
        if (isEmptyGoldPlaceholder(value)) {
            removed.push(key);
            continue;
        }
        next[key] = value;
    }
    if (removed.length === 0) {
        return { parameters, removed };
    }
    return {
        parameters: Object.keys(next).length > 0 ? next : undefined,
        removed,
    };
}
