// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const ELLIPSIS = "\u2026";

/**
 * Collapse internal whitespace runs to single spaces, trim the ends, and cap
 * the result at `max` characters (replacing the final character with an
 * ellipsis when it overflows). Shared by the tree/webview presenters that
 * render free-form utterances and action text into fixed-width rows.
 */
export function collapseAndTruncate(text: string, max: number): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > max
        ? `${collapsed.slice(0, max - 1)}${ELLIPSIS}`
        : collapsed;
}
