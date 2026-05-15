// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { maskInlineCode } from "./linkExtraction.js";

/**
 * Transform a markdown body so that every `[text](target)` link
 * pointing at one of the supplied broken targets is replaced with
 * just its visible text. The URL/path is dropped; the surrounding
 * prose is preserved.
 *
 * Used by the docs-autogen pipeline to recover gracefully from
 * link-validation failures: rather than refusing to write the file
 * (which loses every other improvement in the run), we strip the
 * broken links and surface a diagnostic so contributors know to
 * either fix the path or accept the cleanup.
 *
 * Repo-internal targets (e.g. `../../packages/agents/missing/README.md`)
 * and absolute URLs (`https://stale.example.com/...`) are both
 * handled uniformly because the broken-target set is supplied by
 * the caller (link validator) and we just match string-equality.
 *
 * Fenced code blocks and inline code spans are skipped so literal
 * `[x](missing.md)` examples shown in code samples or prose are not
 * destructively rewritten.
 */
export interface StripBrokenLinksResult {
    /** Body with broken links rewritten to bare text. */
    readonly body: string;
    /**
     * Number of `[text](broken-target)` occurrences rewritten.
     * One broken target may map to multiple occurrences (the same
     * file linked from several places); each occurrence counts.
     */
    readonly strippedCount: number;
}

export function stripBrokenLinks(
    body: string,
    brokenTargets: ReadonlySet<string> | readonly string[],
): StripBrokenLinksResult {
    const targets =
        brokenTargets instanceof Set
            ? brokenTargets
            : new Set<string>(brokenTargets as readonly string[]);
    if (targets.size === 0) {
        return { body, strippedCount: 0 };
    }

    let stripped = 0;
    // Match `[text](target)` allowing an optional `"title"`; capture
    // text and the target separately so we can decide whether to
    // strip based on exact target equality (same as
    // extractMarkdownLinks's view of the target).
    const linkRegex = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
    const lines = body.split(/\r?\n/u);
    let inFence = false;
    let fenceMarker = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();
        const fenceMatch = /^(```|~~~)/u.exec(trimmed);
        if (fenceMatch !== null) {
            const marker = fenceMatch[1]!;
            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
            } else if (trimmed.startsWith(fenceMarker)) {
                inFence = false;
                fenceMarker = "";
            }
            continue;
        }
        if (inFence) continue;
        // Build a mask so we know which character offsets are inside
        // an inline code span; only rewrite link matches that lie
        // wholly outside any masked region.
        const masked = maskInlineCode(line);
        lines[i] = line.replace(
            linkRegex,
            (match, text: string, target: string, offset: number) => {
                if (!targets.has(target)) return match;
                // If any character of the match is inside an inline
                // code span (where masked has spaces in place of the
                // interior), leave the literal alone.
                const slice = masked.slice(offset, offset + match.length);
                if (slice !== match) return match;
                stripped++;
                return text;
            },
        );
    }
    return { body: lines.join("\n"), strippedCount: stripped };
}
