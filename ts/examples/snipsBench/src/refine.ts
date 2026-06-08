// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SlotSpan } from "./data.js";
import { tagToken, isFunctionWord } from "./pos.js";

/**
 * Title-aware NP boundary refinement.
 *
 * M1 showed that a *strict* content/function NP rule destroys recall on
 * title-like slots (playlist / track / book names), because titles legitimately
 * begin with determiners ("this is selena"), contain medial function words
 * ("don't drink the water"), and abut structural keywords ("... playlist").
 *
 * The fix needs positional context, which the per-token self-loop validator
 * lacks. So we apply the boundary rule here, over a high-recall greedy capture,
 * with the whole span in hand:
 *
 *   - KEEP leading determiners / possessives (part of the title NP).
 *   - KEEP medial function words (titles are arbitrary text).
 *   - TRIM trailing function words (a slot should not end on glue).
 *   - TRIM a trailing structural keyword (e.g. the word "playlist").
 *   - TRIM leading non-determiner glue (a slot should not start on "to"/"of").
 *
 * This is exactly the rule a position-aware, engine-integrated bounded wildcard
 * (M4) would enforce; doing it as a post-pass lets us measure the signal first.
 */

/** Structural keywords that delimit a slot when they trail it. */
const STRUCTURAL_KEYWORDS: ReadonlySet<string> = new Set(["playlist", "list"]);

/** Leading function tags that may legitimately open a title NP. */
const ALLOWED_LEADING: ReadonlySet<string> = new Set(["DET", "PRON"]);

/** Refine one [start,end) span; returns the trimmed span or undefined if empty. */
export function refineSpan(
    tokens: string[],
    span: SlotSpan,
): SlotSpan | undefined {
    let { start, end } = span;

    // Trim trailing glue and trailing structural keywords.
    while (end > start) {
        const t = tokens[end - 1];
        if (isFunctionWord(t) || STRUCTURAL_KEYWORDS.has(t.toLowerCase())) {
            end--;
        } else {
            break;
        }
    }

    // Trim leading glue that cannot open a noun phrase (keep determiners).
    while (start < end) {
        const t = tokens[start];
        if (isFunctionWord(t) && !ALLOWED_LEADING.has(tagToken(t))) {
            start++;
        } else {
            break;
        }
    }

    if (start >= end) return undefined;
    return { label: span.label, start, end };
}

/** Apply {@link refineSpan} to every span, dropping any that empty out. */
export function refineSpans(tokens: string[], spans: SlotSpan[]): SlotSpan[] {
    const out: SlotSpan[] = [];
    for (const s of spans) {
        const r = refineSpan(tokens, s);
        if (r) out.push(r);
    }
    return out;
}
