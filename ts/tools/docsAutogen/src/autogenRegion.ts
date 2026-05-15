// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * AUTOGEN region markers. These are the single source of truth for
 * the bot's writable area inside a README.
 */
export const START_MARKER = "<!-- AUTOGEN:DOCS:START -->";
export const END_MARKER = "<!-- AUTOGEN:DOCS:END -->";

/**
 * Result of locating the AUTOGEN region inside a README.
 */
export interface AutogenRegion {
    /** Index of the start marker (line-aligned). */
    readonly startLine: number;
    /** Index of the end marker (line-aligned). */
    readonly endLine: number;
    /** Body between the markers (no markers, no surrounding blanks). */
    readonly body: string;
}

/**
 * Split content into lines, preserving line-ending information so we
 * can rejoin without changing existing newline conventions.
 */
function splitLines(text: string): { lines: string[]; eol: string } {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/u);
    return { lines, eol };
}

/**
 * Locate the AUTOGEN region inside a README. Returns null when no
 * START marker is found. Throws when START is found but no matching
 * END.
 */
export function findAutogenRegion(content: string): AutogenRegion | null {
    const { lines } = splitLines(content);
    let startLine = -1;
    let endLine = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (line === START_MARKER) {
            startLine = i;
        } else if (line === END_MARKER) {
            endLine = i;
            break;
        }
    }
    if (startLine === -1) return null;
    if (endLine === -1) {
        throw new Error(
            "AUTOGEN region malformed: START marker found without matching END marker.",
        );
    }
    if (endLine < startLine) {
        throw new Error(
            "AUTOGEN region malformed: END marker appears before START marker.",
        );
    }
    const bodyLines = lines.slice(startLine + 1, endLine);
    return {
        startLine,
        endLine,
        body: trimSurroundingBlanks(bodyLines).join("\n"),
    };
}

/**
 * Replace (or insert) the AUTOGEN region with the given body. Hash
 * embedding is left to the caller — body should already include the
 * hash comment.
 *
 * When the region is absent, it is inserted at a stable location:
 *   - immediately after the H1 line (and any blank lines following it),
 *   - before `## Trademarks` if present,
 *   - otherwise at the end of the file.
 */
export function writeAutogenRegion(content: string, body: string): string {
    const { lines, eol } = splitLines(content);
    const trimmedBody = trimSurroundingBlanks(body.split(/\r?\n/u));
    const block = [START_MARKER, "", ...trimmedBody, "", END_MARKER];

    const existing = (() => {
        try {
            return findAutogenRegion(content);
        } catch {
            return null;
        }
    })();

    if (existing !== null) {
        const before = lines.slice(0, existing.startLine);
        const after = lines.slice(existing.endLine + 1);
        return [...before, ...block, ...after].join(eol);
    }

    const insertAt = chooseInsertionPoint(lines);
    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);
    const padBefore = before.length > 0 && before[before.length - 1] !== "";
    const padAfter = after.length > 0 && after[0] !== "";
    const merged = [
        ...before,
        ...(padBefore ? [""] : []),
        ...block,
        ...(padAfter ? [""] : []),
        ...after,
    ];
    return merged.join(eol);
}

function chooseInsertionPoint(lines: readonly string[]): number {
    const trademarksIdx = lines.findIndex((l) =>
        /^##\s+Trademarks\s*$/u.test(l),
    );
    if (trademarksIdx !== -1) {
        // Insert one blank line above ## Trademarks.
        let i = trademarksIdx;
        while (i > 0 && lines[i - 1] === "") i--;
        return i;
    }
    const h1Idx = lines.findIndex((l) => /^#\s+\S/u.test(l));
    if (h1Idx !== -1) {
        let i = h1Idx + 1;
        while (i < lines.length && lines[i] === "") i++;
        return i;
    }
    return lines.length;
}

function trimSurroundingBlanks(lines: readonly string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start]!.trim() === "") start++;
    while (end > start && lines[end - 1]!.trim() === "") end--;
    return lines.slice(start, end);
}
