// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared word-boundary script tables used by the matcher
 * (`grammarMatcher.ts`) and the dispatch optimizer
 * (`grammarOptimizer.ts`).
 *
 * Word-boundary scripts are scripts whose adjacent characters
 * always need a separator under "auto" spacing mode (Latin,
 * Cyrillic, Greek, Hangul, Arabic, Hebrew, and major Brahmic /
 * Ethiopic / Mongolian).  Other scripts (CJK, digits,
 * punctuation, ...) do not require an "auto" separator between
 * neighbors.
 *
 * Single source of truth for both the matcher's runtime decisions
 * and the optimizer's compile-time bucket-key derivation; keeping
 * them in one place ensures they cannot drift apart.
 */

/**
 * Single word-boundary-script character class.  Used by the
 * matcher's `needsSeparatorInAutoMode` runtime check.
 */
export const wordBoundaryScriptRe =
    /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Armenian}|\p{Script=Georgian}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Gujarati}|\p{Script=Gurmukhi}|\p{Script=Oriya}|\p{Script=Sinhala}|\p{Script=Ethiopic}|\p{Script=Mongolian}/u;

/**
 * Anchored "leading run of word-boundary-script chars" - re-used by
 * `peekNextToken` (auto-mode dispatch lookup) and the dispatch
 * optimizer (bucket-key derivation).  In auto mode the StringPart's
 * implicit token boundary lies at the first script transition;
 * `peekNextToken` truncates at that boundary so peek and the
 * matcher's StringPart regex agree on what the leading "word" is.
 */
export const leadingWordBoundaryScriptRe = new RegExp(
    `^(?:${wordBoundaryScriptRe.source})+`,
    "u",
);

/**
 * Maximal leading run of word-boundary-script characters in `s`.
 * Returns `""` when the first character is not a word-boundary-script
 * char (CJK, digits, punctuation, etc.).  Used by the dispatch
 * optimizer to derive bucket keys; matches the run that
 * `peekNextToken` will return for an input starting at the same
 * position in auto mode.
 */
export function leadingWordBoundaryScriptPrefix(s: string): string {
    const m = leadingWordBoundaryScriptRe.exec(s);
    return m === null ? "" : m[0];
}
