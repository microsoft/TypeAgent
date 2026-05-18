// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared markdown-fence state machine for line-by-line passes.
 * Recognises both backtick (```) and tilde (~~~) fences and pairs
 * openers with closers of the same marker character. Supplied to
 * repair / validation / extraction passes so they all agree on what
 * "inside a fenced block" means.
 *
 * Fences can be longer than three characters in CommonMark; we accept
 * any run of three or more identical fence characters and require the
 * closer to use the same character with a length >= the opener.
 */

const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/u;

export interface FenceLine {
    /** Marker character: '`' or '~'. */
    readonly marker: "`" | "~";
    /** Length of the fence run (>= 3). */
    readonly length: number;
    /** Trailing text after the run (info string for openers; usually empty for closers). */
    readonly info: string;
}

/** Parse a single line and return fence info if it is a fence line. */
export function parseFenceLine(line: string): FenceLine | null {
    const m = FENCE_LINE.exec(line);
    if (!m) return null;
    const run = m[1]!;
    const marker = run.charAt(0) as "`" | "~";
    return { marker, length: run.length, info: (m[2] ?? "").trim() };
}

/**
 * Walk `body` line by line and call `onLine(line, idx, inFence)` for
 * each line. Fence openers and closers are reported with `inFence`
 * reflecting the state DURING that line: opener lines are reported
 * with `inFence=false` (the line is the boundary, not the content);
 * lines inside the block are reported with `inFence=true`; closer
 * lines are reported with `inFence=true` as well so callers can
 * distinguish "I'm at the boundary" via the `isFence` argument.
 *
 * Each invocation receives:
 *   - line: the raw line text (no trailing newline)
 *   - idx:  zero-based line index
 *   - state: { inFence, isFence } where `isFence` is true on the
 *            opener and closer boundary lines themselves.
 */
export function walkLinesWithFences(
    body: string,
    onLine: (
        line: string,
        idx: number,
        state: { readonly inFence: boolean; readonly isFence: boolean },
    ) => void,
): void {
    const lines = body.split(/\r?\n/u);
    let openMarker: "`" | "~" | null = null;
    let openLength = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const fence = parseFenceLine(line);
        if (fence) {
            if (openMarker === null) {
                onLine(line, i, { inFence: false, isFence: true });
                openMarker = fence.marker;
                openLength = fence.length;
                continue;
            }
            if (
                fence.marker === openMarker &&
                fence.length >= openLength &&
                fence.info === ""
            ) {
                onLine(line, i, { inFence: true, isFence: true });
                openMarker = null;
                openLength = 0;
                continue;
            }
            // A fence-shaped line that does not close the current
            // block is treated as content (e.g. a different marker
            // mid-block, or an info string on a non-opener).
            onLine(line, i, { inFence: true, isFence: false });
            continue;
        }
        onLine(line, i, { inFence: openMarker !== null, isFence: false });
    }
}
