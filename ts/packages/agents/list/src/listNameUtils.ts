// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Determiners / bare "list" captured as listName by listSchema.agr
 * ("add ham to the list" → listName="the", "put cheese on the list" → "list").
 * Not a real list identity — reject so grammar falls through to the LLM,
 * which can clarify or resolve the active list from history.
 */
export function isPlaceholderListName(listName: string): boolean {
    const normalized = listName.trim().toLowerCase();
    if (normalized.length === 0) {
        return true;
    }

    // Single-token placeholders (incl. possessive determiners + bare "list")
    const placeholders = new Set([
        "the",
        "a",
        "an",
        "this",
        "that",
        "these",
        "those",
        "my",
        "your",
        "our",
        "his",
        "her",
        "their",
        "list",
    ]);
    if (placeholders.has(normalized)) {
        return true;
    }

    // "the list", "my list", "that list", …
    const words = normalized.split(/\s+/).filter((w) => w.length > 0);
    if (
        words.length === 2 &&
        words[1] === "list" &&
        placeholders.has(words[0]!)
    ) {
        return true;
    }

    return false;
}
