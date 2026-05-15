// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    const repaired = body.replace(
        linkRegex,
        (match, text: string, target: string) => {
            if (!targets.has(target)) return match;
            stripped++;
            return text;
        },
    );
    return { body: repaired, strippedCount: stripped };
}
