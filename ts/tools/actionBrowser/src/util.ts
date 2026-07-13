// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Join a run of schema comment lines into a single trimmed description. */
export function joinComments(comments: string[] | undefined): string {
    if (comments === undefined) {
        return "";
    }
    return comments
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .join(" ");
}

/** Lowercase only the first character (used to turn a RuleName into a slot). */
export function lowerFirst(name: string): string {
    return name.length === 0 ? name : name[0].toLowerCase() + name.slice(1);
}

/** Collapse internal whitespace and tidy spacing before punctuation. */
export function normalizeSpaces(text: string): string {
    return text
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
}

/** Escape text for safe inclusion in HTML element content. */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Escape text for safe inclusion in an HTML attribute value (double-quoted). */
export function escapeAttr(text: string): string {
    return escapeHtml(text).replace(/"/g, "&quot;");
}
