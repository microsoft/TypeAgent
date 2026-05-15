// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HASH_PREFIX, HASH_SUFFIX } from "./contentHash.js";
import { stripStalenessFooter } from "./renderStaleness.js";

/**
 * Comparison verdict between an old README on disk and a freshly
 * regenerated one. Used by the workflow to decide whether to commit
 * a change for a given package.
 *
 * - `unchanged`: no functional difference; do not commit.
 * - `footer-only`: only the staleness footer (timestamp/SHA) and/or
 *   the embedded content-hash differ. The actual prose & references
 *   are byte-identical, so committing would be churn. Do not commit.
 * - `content-changed`: meaningful difference; commit and include in PR.
 */
export type DiffVerdict = "unchanged" | "footer-only" | "content-changed";

export interface DiffResult {
    verdict: DiffVerdict;
    /** The normalized form of the old README, useful for logging. */
    normalizedOld: string;
    /** The normalized form of the new README. */
    normalizedNew: string;
}

/**
 * Compare two READMEs after stripping the parts of the AUTOGEN block
 * that are guaranteed to change every run by design (footer + hash
 * comment). If they're identical post-strip, we treat the new file
 * as "footer-only" (or fully unchanged when the original strings
 * matched too).
 *
 * Whitespace at end of lines and trailing newlines are normalized
 * because prettier may rewrite either side.
 */
export function compareReadmes(oldText: string, newText: string): DiffResult {
    const normalizedOld = normalize(oldText);
    const normalizedNew = normalize(newText);

    if (oldText === newText) {
        return {
            verdict: "unchanged",
            normalizedOld,
            normalizedNew,
        };
    }
    if (normalizedOld === normalizedNew) {
        return {
            verdict: "footer-only",
            normalizedOld,
            normalizedNew,
        };
    }
    return {
        verdict: "content-changed",
        normalizedOld,
        normalizedNew,
    };
}

function normalize(text: string): string {
    let out = stripStalenessFooter(text);
    out = stripHashComment(out);
    out = out.replace(/[ \t]+$/gmu, "");
    out = out.replace(/\r\n/gu, "\n");
    out = out.replace(/\n+$/u, "\n");
    return out;
}

function stripHashComment(text: string): string {
    const lines = text.split(/\r?\n/u);
    const kept: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith(HASH_PREFIX) && trimmed.endsWith(HASH_SUFFIX)) {
            continue;
        }
        kept.push(line);
    }
    return kept.join("\n");
}
