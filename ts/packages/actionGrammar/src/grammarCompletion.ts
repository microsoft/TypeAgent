// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompiledSpacingMode, Grammar, StringPart } from "./grammarTypes.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import {
    type MatchState,
    type PendingWildcard,
    type SeparatorMode,
    separatorRegExpStr,
    requiresSeparator,
    mergeSeparatorMode,
    isBoundarySatisfied,
    nextNonSeparatorIndex,
    getWildcardStr,
    createValue,
    finalizeState,
    finalizeNestedRule,
    matchState,
    initialMatchState,
} from "./grammarMatcher.js";

const debugCompletion = registerDebug("typeagent:grammar:completion");

// True when the substring text[from..to) contains only separator
// characters (whitespace / punctuation).  Used to decide whether
// advancing maxPrefixLength across a gap should preserve or clear
// existing candidates.
function isSeparatorOnlyGap(text: string, from: number, to: number): boolean {
    return to > from && nextNonSeparatorIndex(text, from) >= to;
}

// Strip trailing separator characters from a position, scanning
// backward until a non-separator character is found or the lower
// bound is reached.  Returns the stripped position.
function stripTrailingSeparators(
    text: string,
    position: number,
    lowerBound: number,
): number {
    // nextNonSeparatorIndex(text, i) >= i+1 iff text[i] is a separator.
    while (
        position > lowerBound &&
        nextNonSeparatorIndex(text, position - 1) >= position
    ) {
        position--;
    }
    return position;
}

// Greedily match keyword words against text starting at startIndex.
// Returns the number of fully matched words and cursor positions.
//
// The first word allows an optional non-greedy leading separator
// ([\s\p{P}]*?) so callers don't need to pre-skip whitespace.
// Subsequent words use strict separators based on requiresSeparator.
// isBoundarySatisfied is checked after every word — this is a no-op
// at end-of-text and otherwise prevents partial-word matches
// (e.g. "play" inside "playback").
function matchWordsGreedily(
    words: string[],
    text: string,
    startIndex: number,
    spacingMode: CompiledSpacingMode,
): { matchedWords: number; endIndex: number; prevEndIndex: number } {
    let index = startIndex;
    let prevIndex = startIndex;
    let matchedWords = 0;

    for (let k = 0; k < words.length; k++) {
        const word = words[k];
        const escaped = escapeMatch(word);

        let regExpStr: string;
        if (spacingMode === "none") {
            regExpStr = escaped;
        } else if (k === 0) {
            regExpStr = `[${separatorRegExpStr}]*?${escaped}`;
        } else {
            const sep = requiresSeparator(
                words[k - 1].at(-1)!,
                word[0],
                spacingMode,
            )
                ? `[${separatorRegExpStr}]+`
                : `[${separatorRegExpStr}]*`;
            regExpStr = sep + escaped;
        }

        const re = new RegExp(regExpStr, "iuy");
        re.lastIndex = index;
        const m = re.exec(text);
        if (m === null) break;

        const newIndex = m.index + m[0].length;
        if (!isBoundarySatisfied(text, newIndex, spacingMode)) {
            break;
        }

        prevIndex = index;
        index = newIndex;
        matchedWords++;
    }

    return { matchedWords, endIndex: index, prevEndIndex: prevIndex };
}

// Try matching keyword words forward from startIndex in prefix.
// Returns the position and completion word if a partial match is found,
// or undefined if no match or all words matched fully.
function matchKeywordWordsFrom(
    input: string,
    startIndex: number,
    words: string[],
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const { matchedWords, endIndex } = matchWordsGreedily(
        words,
        input,
        startIndex,
        spacingMode,
    );

    // All words matched fully — not a partial match.
    if (matchedWords >= words.length) return undefined;

    // Consumed to end of prefix with more words remaining.
    if (matchedWords > 0 && endIndex === input.length) {
        return {
            position: input.length,
            completionWord: words[matchedWords],
        };
    }

    // Check if remaining text is a partial prefix of the next word.
    const word = words[matchedWords];
    let textToCheck = input.slice(endIndex);
    if (matchedWords > 0 && spacingMode !== "none") {
        const sepMatch = textToCheck.match(
            new RegExp(`^[${separatorRegExpStr}]+`, "u"),
        );
        if (sepMatch) {
            textToCheck = textToCheck.slice(sepMatch[0].length);
        } else if (
            requiresSeparator(
                words[matchedWords - 1].at(-1)!,
                word[0],
                spacingMode,
            )
        ) {
            return undefined;
        }
    }

    // Partial prefix of the next word, or separator-only remainder
    // after a fully matched word (textToCheck="" ⇒ consumed-to-EOI).
    if (
        textToCheck.length < word.length &&
        word.toLowerCase().startsWith(textToCheck.toLowerCase()) &&
        (textToCheck.length > 0 || matchedWords > 0)
    ) {
        return {
            position: input.length - textToCheck.length,
            completionWord: word,
        };
    }
    return undefined;
}

// When a wildcard has absorbed all remaining input (via finalizeState),
// check whether the absorbed text ends with a separator-delimited prefix
// of the first word of the next keyword part.  Returns the position where
// the partial keyword starts (i.e. the first non-separator character after
// the last separator), or undefined if no partial keyword is found.
//
// Used in both directions (called from Phase B1, not inline in
// Phase A):
//   - Forward: determines the Phase B1 anchor position for deferred
//     wildcard-at-EOI candidates (see forwardPartialKeyword).
//   - Backward: collects a fixed candidate at the partial keyword
//     position, which may advance maxPrefixLength and clear weaker
//     fallback candidates from Phase A.
//
// Handles both single-word and multi-word keyword parts.  For a keyword
// like ["played", "by"], the function recognizes:
//   "p"        → partial of word 0 → completion = "played"
//   "played"   → full word 0       → completion = "by"
//   "played b" → full word 0 + partial of word 1 → completion = "by"
//
// Honors spacingMode between keyword words, using the same separator
// logic as matchStringPart:
//   "none"     → words are directly adjacent (no separators)
//   "required" → [\s\p{P}]+ between words
//   "optional" → [\s\p{P}]* between words
//   auto       → + or * depending on requiresSeparator() for adjacent chars
function findPartialKeywordInWildcard(
    input: string,
    wildcardStart: number,
    part: StringPart,
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const sepCharRe = /[\s\p{P}]/u;
    const minStart = wildcardStart + 1;

    // Scan candidate start positions from right to left.
    for (
        let candidateStart = input.length - 1;
        candidateStart >= minStart;
        candidateStart--
    ) {
        // The candidate position must be a valid boundary between the
        // wildcard content and the keyword fragment.  This mirrors how
        // matchStringPart builds its leading separator regex:
        //   - "none" mode: no separator needed (keywords are adjacent).
        //   - Other modes: a separator is required only when
        //     requiresSeparator returns true for the adjacent characters.
        //     When the keyword starts with punctuation, CJK, or another
        //     non-word-boundary character, no separator is needed — the
        //     character itself creates a natural boundary.
        if (
            spacingMode !== "none" &&
            !sepCharRe.test(input[candidateStart - 1]) &&
            requiresSeparator(
                input[candidateStart - 1],
                part.value[0][0],
                spacingMode,
            )
        ) {
            continue;
        }

        const result = matchKeywordWordsFrom(
            input,
            candidateStart,
            part.value,
            spacingMode,
        );
        if (result === undefined) {
            continue;
        }

        // Verify the wildcard content before the candidate is valid.
        if (
            getWildcardStr(
                input,
                wildcardStart,
                candidateStart,
                spacingMode,
            ) === undefined
        ) {
            continue;
        }

        return result;
    }
    return undefined;
}

export type GrammarCompletionProperty = {
    match: unknown;
    propertyNames: string[];
};

// See docs/architecture/completion.md § Invariants for the full catalog of
// correctness invariants on these fields and their user-visible impact.
export type GrammarCompletionResult = {
    completions: string[];
    properties?: GrammarCompletionProperty[] | undefined;
    // Number of characters from the input prefix that the grammar consumed
    // before the completion point.  The shell uses this to determine where
    // to insert/filter completions (replacing the space-based heuristic).
    matchedPrefixLength?: number | undefined;
    // What kind of separator is expected between the content at
    // `matchedPrefixLength` and the completion text.  This is a
    // *completion-result* concept (SeparatorMode), derived from the
    // per-rule *match-time* spacing rules (CompiledSpacingMode /
    // spacingMode) but distinct from them.
    //   "spacePunctuation" — whitespace or punctuation required
    //     (Latin "y" → "m" requires a separator).
    //   "optional" — separator accepted but not required
    //     (CJK 再生 → 音楽 does not require a separator).
    //   "none" — no separator at all ([spacing=none] grammars).
    // Omitted when no completions were generated.
    separatorMode?: SeparatorMode | undefined;
    // True when `completions` is the closed set of valid
    // continuations after the matched prefix — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  False or undefined means the parser can continue
    // past unrecognized input and find more completions (e.g.
    // wildcard/entity slots whose values are external to the grammar).
    closedSet?: boolean | undefined;
    // True when completion(input[0..P], "backward") would differ from
    // completion(input[0..P], "forward"), where P = matchedPrefixLength.
    // When false, the caller can skip re-fetching on direction change.
    //
    // In this implementation, computed as `P > 0`.  P is always
    // placed at a part or sub-part (word) boundary by
    // updateMaxPrefixLength, so P > 0 guarantees a preceding
    // part exists for backward to back up to.
    // Re-invoking at input[0..P]:
    //   - Forward: re-matches up to P, stays at or near P.
    //   - Backward: backs up to the preceding part, producing
    //     matchedPrefixLength < P.
    // When P = 0 no part boundary was crossed and both
    // directions are identical.
    directionSensitive: boolean;
    // True when the completion's `matchedPrefixLength` position is
    // *ambiguous* — it could shift forward as the user types more.
    //
    // A position is **definite** when it is structurally pinned by
    // matched grammar tokens: no amount of additional typing can
    // change where it falls.  Examples: the start of a wildcard
    // (pinned by the preceding keyword), or a keyword matched
    // without a preceding wildcard.
    //
    // A position is **ambiguous** when it sits at the boundary of a
    // wildcard whose extent is not fully determined.  The wildcard
    // could absorb more text, moving the boundary forward.  This
    // happens in two cases:
    //   - **Forward:** a keyword completion follows a wildcard that
    //     was finalized at end-of-input (via `finalizeState`).  The
    //     wildcard consumed everything up to EOI, but the user may
    //     still be typing within it.
    //   - **Backward:** completion backs up to a keyword that was
    //     matched after a captured wildcard (`afterWildcard`).  The
    //     wildcard's end was pinned by this keyword, but backing up
    //     un-pins it — the wildcard could extend to absorb the
    //     keyword text.
    //
    // When true, the caller should allow its anchor to slide forward
    // (the "slide" policy) rather than re-fetching or giving up.
    openWildcard: boolean;
};

function getGrammarCompletionProperty(
    state: MatchState,
    valueId: number,
): GrammarCompletionProperty | undefined {
    const temp = { ...state };

    while (finalizeNestedRule(temp, undefined, true)) {}
    if (temp.valueIds === null) {
        // valueId would have been undefined
        throw new Error(
            "Internal Error: state for getGrammarCompletionProperty should not have valueIds be null",
        );
    }
    const wildcardPropertyNames: string[] = [];
    const match = createValue(
        temp.value,
        temp.valueIds,
        temp.values,
        "",
        wildcardPropertyNames,
        valueId,
    );

    return {
        match,
        propertyNames: wildcardPropertyNames,
    };
}

/**
 * Try to partially match leading words of a multi-word string part
 * against the prefix starting at `startIndex`.  Returns the consumed
 * length and the remaining (unmatched) words as the completion text.
 *
 * - All words matched → returns undefined (caller should treat as
 *   a full match, not a completion candidate).
 * - Some words matched → returns consumed length + next word.
 * - No words matched → returns startIndex + first word.
 *
 * When returning a non-undefined result, it contains exactly one
 * word as the completion text, providing one-word-at-a-time
 * progression.
 */
function tryPartialStringMatch(
    part: StringPart,
    input: string,
    startIndex: number,
    spacingMode: CompiledSpacingMode,
    direction?: "forward" | "backward",
    effectivePrefixEnd?: number,
):
    | {
          consumedLength: number;
          remainingText: string;
          /** True when at least one full word matched without a trailing
           *  separator, so backward could reconsider the last matched word. */
          couldBackUp: boolean;
      }
    | undefined {
    const words = part.value;
    const { matchedWords, endIndex, prevEndIndex } = matchWordsGreedily(
        words,
        input,
        startIndex,
        spacingMode,
    );

    // Direction matters when at least one word fully matched and no
    // trailing separator follows the last matched word.
    // When effectivePrefixEnd is set and endIndex has reached it,
    // characters beyond that point are logically absent (Category 1
    // trailing-separator stripping) — treat as uncommitted.
    const couldBackUp =
        matchedWords > 0 &&
        (spacingMode === "none" ||
            (effectivePrefixEnd !== undefined &&
                endIndex >= effectivePrefixEnd) ||
            nextNonSeparatorIndex(input, endIndex) === endIndex);

    if (direction === "backward" && couldBackUp) {
        return {
            consumedLength: prevEndIndex,
            remainingText: words[matchedWords - 1],
            couldBackUp: true,
        };
    }
    // Forward (default), or backward with no words fully matched
    // (nothing to reconsider — e.g. input "pl" still offers "play").
    // Return undefined when all words matched (exact match).
    if (matchedWords >= words.length) {
        return undefined;
    }

    return {
        consumedLength: endIndex,
        remainingText: words[matchedWords],
        couldBackUp,
    };
}

/**
 * Given a grammar and a user-typed prefix string, determine what completions
 * are available.  The algorithm greedily matches as many grammar parts as
 * possible against the prefix (the "longest completable prefix"), then
 * reports completions from the *next* unmatched part.
 *
 * ## Two-Phase Architecture
 *
 * The function uses a **collect-then-convert** design.  Phase A (the main
 * loop) processes every rule and collects lightweight *candidate
 * descriptors* into two sets — `fixedCandidates` and `rangeCandidates`.
 * Phase B (post-loop) converts surviving candidates into the final
 * `completions[]` and `properties[]` arrays.  See the inline "Two-Phase
 * Collect then Convert Architecture" comment for details.
 *
 * ## Phase A — Three categories
 *
 * The function explores every alternative rule/state in the grammar (via the
 * `pending` work-list).  Each state is run through `matchState` which
 * consumes as many parts as the prefix allows.  The state then falls into
 * one of three categories:
 *
 * 1. **Exact match** — the prefix satisfies every part in the rule.
 *    The function backs up to the last matched term (keyword, wildcard,
 *    or number) and offers it as a completion — `maxPrefixLength` is set
 *    to the backed-up position so that candidates from shorter partial
 *    matches are eagerly discarded (via `updateMaxPrefixLength`).
 *
 * 2. **Partial match, finalized** — the prefix was consumed (possibly with
 *    trailing separators) but the rule still has remaining parts.
 *    `matchState` returns `false` (could not match the next part) and
 *    `finalizeState` returns `true` (no trailing non-separator junk).
 *    The next unmatched part produces a completion candidate:
 *      - String part → literal keyword completion (e.g. "music").
 *      - Wildcard / number → property completion (handled elsewhere).
 *
 *    **Wildcard-at-EOI deferral:** when a pending wildcard absorbed all
 *    input to end-of-string, string-part candidates are *not* processed
 *    inline.  Instead, lightweight `WildcardEoiDescriptor`s are saved
 *    for Phase B1 to resolve via `findPartialKeywordInWildcard`.  This
 *    prevents wildcard-at-EOI states from pushing `maxPrefixLength`
 *    past more-meaningful candidates.  See the Phase B1/B2 blocks.
 *
 * 3. **Partial match, NOT finalized** — either:
 *      a. A pending wildcard could not be finalized (trailing text is only
 *         separators with no wildcard content) → collect a property
 *         candidate for the wildcard's entity type.
 *      b. Trailing text remains that didn't match any part →
 *         attempt word-by-word matching of the current string part
 *         against that text (via `tryPartialStringMatch`).  If some
 *         leading words match they advance the consumed prefix; the
 *         next unmatched word is collected as a completion candidate.
 *         Candidates from shorter partial matches are automatically
 *         discarded when a longer match updates `maxPrefixLength`.
 *
 * During processing, whenever `maxPrefixLength` advances, all
 * previously accumulated fixed candidates are cleared.  Only candidates
 * whose prefix length equals the current maximum are kept.  This
 * ensures completions from shorter partial matches are discarded
 * when a longer (or exact) match consumed more input.
 *
 * ## Backward completion
 *
 * When `direction` is `"backward"`, the function backs up to the last
 * matched item (keyword, wildcard, or number) and offers it as a
 * completion — allowing the user to revise the most recently typed
 * element.  Range candidates handle the case where a wildcard's end
 * position is flexible (determined by other rules' `maxPrefixLength`).
 *
 * ## Output fields
 *
 * `matchedPrefixLength` tracks the furthest point consumed across all
 * states (via `updateMaxPrefixLength`).  This tells the caller where
 * the completable portion of the input ends, so it can position the
 * completion insertion point correctly (especially important for
 * non-space-separated scripts like CJK).
 *
 * `separatorMode` (a {@link SeparatorMode}) indicates what kind of
 * separator is needed between the content at `matchedPrefixLength` and the
 * completion text.  It is determined by the spacing rules (the per-rule
 * {@link CompiledSpacingMode}) between the last character of the matched
 * prefix and the first character of the completion.
 *
 * Architecture: docs/architecture/completion.md — §1 Grammar Matcher
 */

type FixedCandidate =
    | {
          kind: "string";
          completionText: string;
          spacingMode: CompiledSpacingMode;
          openWildcard: boolean;
          partialKeywordBackup: boolean;
      }
    | {
          kind: "property";
          valueId: number;
          state: MatchState;
          spacingMode: CompiledSpacingMode;
          openWildcard: boolean;
          partialKeywordBackup: boolean;
      };

type WildcardStringRangeCandidate = {
    kind: "wildcardString";
    wildcardStart: number;
    nextPart: StringPart;
    spacingMode: CompiledSpacingMode;
};

type RangeCandidate =
    | WildcardStringRangeCandidate
    | {
          kind: "wildcardProperty";
          wildcardStart: number;
          valueId: number;
          state: MatchState;
          spacingMode: CompiledSpacingMode;
      };

// Lightweight descriptor for wildcard-at-EOI states whose
// partial keyword scan is deferred to Phase B1.  Phase A pushes
// one descriptor per wildcard-at-EOI string state (both forward
// and backward).  Phase B1 runs findPartialKeywordInWildcard on
// each descriptor, resolving it into either a partial keyword
// anchor or a deferred candidate for Phase B2.
type WildcardEoiDescriptor = {
    wildcardStart: number;
    nextPart: StringPart;
    spacingMode: CompiledSpacingMode;
};

// Forward partial keyword anchor: populated by Phase B1 when
// findPartialKeywordInWildcard finds a partial keyword at
// position P inside a wildcard-at-EOI state.  Phase B2 uses
// position to anchor and completionWord to emit the completion
// (tryPartialStringMatch at the anchor position cannot reproduce
// multi-word keyword results — e.g. for keyword ["played","by"],
// the partial keyword "by" is found at position 18 from
// candidateStart=11, but tryPartialStringMatch at 18 returns
// "played" instead).
type ForwardPartialKeywordCandidate = {
    position: number;
    completionWord: string;
    spacingMode: CompiledSpacingMode;
};

// Compute whether a separator is needed between the character at
// `position` in `prefix` and `firstCompletionChar`, then merge the
// result into the running `current` separator mode.
function mergeSepMode(
    input: string,
    current: SeparatorMode | undefined,
    position: number,
    firstCompletionChar: string,
    spacingMode: CompiledSpacingMode,
): SeparatorMode | undefined {
    const needsSep =
        position > 0 &&
        spacingMode !== "none" &&
        requiresSeparator(
            input[position - 1],
            firstCompletionChar,
            spacingMode,
        );
    return mergeSeparatorMode(current, needsSep, spacingMode);
}

// --- CompletionContext: mutable state shared across completion phases ---
//
// The main loop (Phase A) collects lightweight candidate descriptors
// (FixedCandidate / RangeCandidate) rather than immediately emitting
// final completion strings and property objects.  A post-loop Phase B
// converts surviving candidates into the output arrays.
//
// This decouples candidate *discovery* (which rule matched, at what
// position) from candidate *materialization* (building the
// GrammarCompletionProperty, computing separatorMode).  The split is
// essential for backward completion: the main loop evaluates every rule
// at the full prefix length, but the final completion position
// (maxPrefixLength) is only known after ALL rules have been processed.
// Range candidates exploit this — they defer the "where does the
// wildcard end?" decision until Phase B, when maxPrefixLength is
// settled.
//
// fixedCandidates — single valid position, cleared whenever
//     maxPrefixLength advances.  Produced by all three categories
//     in both forward and backward modes.
//
// rangeCandidates — valid at any wildcard split in
//     [wildcardStart+1, prefix.length], never cleared.  They
//     arise in Category 2 backward when a wildcard absorbed
//     all remaining input and the next part could match at
//     a flexible position.  Processed in Phase B only under
//     the same conditions the old retrigger required.
//
// Phase B is split into two sub-phases:
//  B1 — Anchor resolution: runs findPartialKeywordInWildcard
//    on deferred wildcardEoiDescriptors, populating
//    forwardPartialKeyword / forwardEoiCandidates (forward) or
//    fixedCandidates / rangeCandidates (backward).
//  B2 — Materialization: converts surviving candidates into
//    the final completions[] and properties[] arrays.
//    Also handles EOI instantiation, range candidates,
//    and deduplication.
type CompletionContext = {
    readonly input: string;
    readonly direction: "forward" | "backward" | undefined;
    maxPrefixLength: number;
    fixedCandidates: FixedCandidate[];
    rangeCandidates: RangeCandidate[];
    wildcardEoiDescriptors: WildcardEoiDescriptor[];
};

// Update maxPrefixLength.  When it increases, all previously
// accumulated fixed-point candidates from shorter matches are
// irrelevant — clear them.
// Range candidates are NOT cleared because their valid position
// is a range that may include the new maxPrefixLength.
function updateMaxPrefixLength(
    ctx: CompletionContext,
    prefixLength: number,
): void {
    if (prefixLength > ctx.maxPrefixLength) {
        ctx.maxPrefixLength = prefixLength;
        ctx.fixedCandidates.length = 0;
    }
}

// Collect a property completion candidate at a given prefix position.
// Updates maxPrefixLength; skips if position is below max.  The
// candidate is converted to a final GrammarCompletionProperty in Phase B.
function collectPropertyCandidate(
    ctx: CompletionContext,
    state: MatchState,
    valueId: number,
    prefixPosition: number,
    candidateOpenWildcard: boolean = false,
): void {
    updateMaxPrefixLength(ctx, prefixPosition);
    if (prefixPosition !== ctx.maxPrefixLength) return;
    ctx.fixedCandidates.push({
        kind: "property",
        valueId,
        state: { ...state },
        spacingMode: state.spacingMode,
        openWildcard: candidateOpenWildcard,
        partialKeywordBackup: false,
    });
}

// Try partial string match and collect the result as a literal string
// completion candidate.  Updates maxPrefixLength; skips if position is
// below max.  Used by Category 2 forward, Category 3b, and backward
// candidate collection.  Returns true if a partial match was found (the
// candidate may still be discarded by the maxPrefixLength filter).
function tryCollectStringCandidate(
    ctx: CompletionContext,
    state: MatchState,
    part: StringPart,
    candidateOpenWildcard: boolean,
    startIndex: number,
    dir: "forward" | "backward" | undefined,
    effectivePrefixEnd?: number,
): boolean {
    const partial = tryPartialStringMatch(
        part,
        ctx.input,
        startIndex,
        state.spacingMode,
        dir,
        effectivePrefixEnd,
    );
    if (partial !== undefined) {
        updateMaxPrefixLength(ctx, partial.consumedLength);
        if (partial.consumedLength === ctx.maxPrefixLength) {
            ctx.fixedCandidates.push({
                kind: "string",
                completionText: partial.remainingText,
                spacingMode: state.spacingMode,
                openWildcard: candidateOpenWildcard,
                partialKeywordBackup: false,
            });
        }
        return true;
    }
    return false;
}

// Backward completion — back up to the last matched item (wildcard,
// literal word, or number).  If a wildcard was captured after the last
// matched part, prefer it; otherwise back up to the last matched part
// via tryPartialStringMatch (for strings) or collectPropertyCandidate
// (for numbers).
//
// Tags the candidate with openWildcard when backing up to a part that
// was matched after a captured wildcard (afterWildcard) — that position
// is ambiguous because the wildcard could extend.
function tryCollectBackwardCandidate(
    ctx: CompletionContext,
    state: MatchState,
    savedWildcard: PendingWildcard | undefined,
    effectivePrefixEnd?: number,
): boolean {
    const wildcardStart = savedWildcard?.start;
    const partStart = state.lastMatchedPartInfo?.start;
    if (
        savedWildcard !== undefined &&
        savedWildcard.valueId !== undefined &&
        (partStart === undefined ||
            (wildcardStart !== undefined && wildcardStart >= partStart))
    ) {
        collectPropertyCandidate(
            ctx,
            state,
            savedWildcard.valueId,
            savedWildcard.start,
        );
        return true;
    } else if (state.lastMatchedPartInfo !== undefined) {
        const info = state.lastMatchedPartInfo;
        if (info.type === "string") {
            if (
                tryCollectStringCandidate(
                    ctx,
                    state,
                    info.part,
                    info.afterWildcard,
                    info.start,
                    "backward",
                    effectivePrefixEnd,
                )
            ) {
                return true;
            } else {
                updateMaxPrefixLength(ctx, state.index);
            }
        } else {
            // Number part — offer property completion for the
            // number slot so the user can re-enter a value.
            collectPropertyCandidate(
                ctx,
                state,
                info.valueId,
                info.start,
                info.afterWildcard,
            );
            return true;
        }
    }
    return false;
}

// --- Category 1: Exact match ---
// All parts matched AND prefix was fully consumed.
// Back up to the last matched term (string keyword,
// number, or wildcard).  The processing is direction-
// agnostic — this function always backs up, producing
// the same candidate regardless of ctx.direction.
// (The caller re-invoking at input[0..P] will see
// different results for forward vs backward, but that
// difference is handled by the re-invocation, not here.)
function processExactMatch(
    ctx: CompletionContext,
    state: MatchState,
    preFinalizeState: MatchState | undefined,
    savedPendingWildcard: PendingWildcard | undefined,
): void {
    const { input } = ctx;
    if (
        state.lastMatchedPartInfo !== undefined ||
        savedPendingWildcard?.valueId !== undefined
    ) {
        // Category 1 processing is direction-agnostic:
        // always back up to the last matched term.
        // (Forward vs backward divergence occurs when
        // the caller re-invokes at input[0..P].)
        // Ignore trailing separators: in an exact
        // match, trailing whitespace/punctuation
        // carries no structural meaning — all parts
        // are satisfied.  Without the end-index limit,
        // tryPartialStringMatch sees the trailing
        // separator and sets couldBackUp=false,
        // incorrectly blocking the backup.
        const effectivePrefixEnd =
            state.index < input.length ? state.index : undefined;
        tryCollectBackwardCandidate(
            ctx,
            preFinalizeState ?? state,
            savedPendingWildcard,
            effectivePrefixEnd,
        );
    } else {
        debugCompletion("Matched. Nothing to complete.");
        updateMaxPrefixLength(ctx, state.index);
    }
}

// --- Category 2: Partial match (clean finalization) ---
// matchState stopped at state.partIndex because it couldn't
// match the next part against the (exhausted) prefix.
// That next part is what we offer as a completion.
//
// Wildcard-at-EOI with a string next part: defer the
// partial keyword scan to Phase B1 via wildcardEoiDescriptors.
//
// Non-string next parts (wildcard, number, rules) don't produce
// completions here — wildcards are handled by Category 3a
// (pending wildcard) and nested rules are expanded by matchState
// into separate pending states.
function processCleanPartial(
    ctx: CompletionContext,
    state: MatchState,
    preFinalizeState: MatchState | undefined,
    savedPendingWildcard: PendingWildcard | undefined,
): void {
    const { input, direction, wildcardEoiDescriptors, rangeCandidates } = ctx;
    const nextPart = state.parts[state.partIndex];

    // Wildcard-at-EOI with a string next part: defer the
    // partial keyword scan to Phase B1.  This applies to
    // both directions under the same condition.
    const deferredToEoi =
        savedPendingWildcard?.valueId !== undefined &&
        state.index >= input.length &&
        nextPart.type === "string";
    if (deferredToEoi) {
        wildcardEoiDescriptors.push({
            wildcardStart: savedPendingWildcard.start,
            nextPart,
            spacingMode: state.spacingMode,
        });
    }

    // Does this state have a matched part that backward could
    // reconsider?  True when the prefix was fully consumed and
    // there is a matched part (string/number) or wildcard to
    // back up to.  (Per-state condition, not the final output
    // directionSensitive — that is computed after all states.)
    const hasPartToReconsider =
        state.index >= input.length &&
        (savedPendingWildcard?.valueId !== undefined ||
            state.lastMatchedPartInfo !== undefined);

    if (direction === "backward" && hasPartToReconsider) {
        // Backward: collect a fallback candidate (backs up
        // to the wildcard start or last matched part).  If
        // a partial keyword exists inside the wildcard, Phase
        // B1 will find it and may clear this fallback in
        // favor of a higher-position candidate.
        tryCollectBackwardCandidate(
            ctx,
            preFinalizeState ?? state,
            savedPendingWildcard,
        );
        // Range candidates for non-string next parts
        // (wildcard/number) — these don't involve partial
        // keyword scans so they're pushed directly.
        if (
            savedPendingWildcard?.valueId !== undefined &&
            (nextPart.type === "wildcard" || nextPart.type === "number")
        ) {
            // preFinalizeState is always defined here:
            // the guard `savedPendingWildcard?.valueId !== undefined`
            // implies `savedPendingWildcard !== undefined`, which is
            // the same condition that created preFinalizeState.
            rangeCandidates.push({
                kind: "wildcardProperty",
                wildcardStart: savedPendingWildcard.start,
                valueId: savedPendingWildcard.valueId,
                state: preFinalizeState!,
                spacingMode: state.spacingMode,
            });
        }
    } else {
        debugCompletion(`Completing ${nextPart.type} part ${state.name}`);
        if (nextPart.type === "string" && !deferredToEoi) {
            tryCollectStringCandidate(
                ctx,
                state,
                nextPart,
                savedPendingWildcard?.valueId !== undefined,
                state.index,
                direction,
            );
        } else if (nextPart.type !== "string") {
            debugCompletion(
                `No completion for ${nextPart.type} part (handled by Category 3a or matchState expansion)`,
            );
        }
    }
}

// --- Category 3: finalizeState failed ---
// Either (a) a pending wildcard couldn't capture meaningful
// content, or (b) trailing non-separator text remains that
// didn't match any grammar part.
function processDirtyPartial(
    ctx: CompletionContext,
    state: MatchState,
    matched: boolean,
): void {
    const { direction } = ctx;
    const pendingWildcard = state.pendingWildcard;

    if (
        pendingWildcard !== undefined &&
        pendingWildcard.valueId !== undefined
    ) {
        // --- Category 3a: Unfinalizable pending wildcard ---
        // The grammar reached a wildcard slot but it is
        // unfinalizable (capture region empty, separator-only,
        // or not yet started — e.g. prefix="play " with
        // wildcard starting at index 4).
        // Backward reconsidering is appropriate when:
        //  (a) the last matched part followed a captured
        //      wildcard — wildcard-keyword boundary fork, OR
        //  (b) the prefix was fully consumed before the
        //      wildcard started (state.index >= prefix.length)
        //      — the user hasn't typed into the wildcard yet
        //      and may want to reconsider the preceding part
        //      (e.g., alternation-prefix overlap:
        //      (play | player) <song>, input "play").
        const canReconsider3a =
            state.lastMatchedPartInfo !== undefined &&
            (state.lastMatchedPartInfo.afterWildcard ||
                state.index >= ctx.input.length);
        if (direction === "backward" && canReconsider3a) {
            // Backward: back up to the last matched keyword
            // instead of offering property completion for the
            // unfilled wildcard — the user hasn't started
            // typing into the unfilled slot yet.
            const didBackUp = tryCollectBackwardCandidate(
                ctx,
                state,
                undefined,
            );
            if (!didBackUp) {
                // tryCollectBackwardCandidate returned false
                // (e.g. all keyword words fully matched with
                // trailing separator).  Fall back to the
                // forward path so the property completion is
                // still collected.
                debugCompletion("Completing wildcard part");
                collectPropertyCandidate(
                    ctx,
                    state,
                    pendingWildcard.valueId,
                    pendingWildcard.start,
                );
            }
        } else {
            // Forward (or backward with nothing to
            // reconsider): report a property completion
            // describing the wildcard's type so the caller can
            // provide entity-specific suggestions.
            debugCompletion("Completing wildcard part");
            collectPropertyCandidate(
                ctx,
                state,
                pendingWildcard.valueId,
                pendingWildcard.start,
            );
        }
    } else if (!matched) {
        // --- Category 3b: Completion after consumed prefix ---
        // The grammar stopped at a string part it could not
        // match.  Report the string part as a completion
        // candidate regardless of any trailing text — the
        // caller can use matchedPrefixLength to determine how
        // much of the input was successfully consumed and
        // filter completions by any trailing text beyond that
        // point.  Candidates from shorter partial matches are
        // automatically discarded when a longer match updates
        // maxPrefixLength.
        const currentPart = state.parts[state.partIndex];
        if (currentPart !== undefined && currentPart.type === "string") {
            tryCollectStringCandidate(
                ctx,
                state,
                currentPart,
                false,
                state.index,
                direction,
            );
        }
    }
}

// --- Phase A: process every pending state, collecting candidates ---
//
// Explores every alternative rule/state in the grammar (via the pending
// work-list).  Each state is run through matchState which consumes as
// many parts as the prefix allows.  The state then falls into one of
// three categories:
//
// 1. **Exact match** — the prefix satisfies every part in the rule.
// 2. **Partial match, finalized** — the prefix was consumed but parts
//    remain.  The next unmatched part produces a completion candidate.
// 3. **Partial match, NOT finalized** — either a pending wildcard
//    couldn't be finalized, or trailing text didn't match any part.
//
// See matchGrammarCompletion JSDoc for full category descriptions.
function collectCandidates(
    grammar: Grammar,
    input: string,
    minPrefixLength: number | undefined,
    direction: "forward" | "backward" | undefined,
): CompletionContext {
    const ctx: CompletionContext = {
        input,
        direction,
        maxPrefixLength: minPrefixLength ?? 0,
        fixedCandidates: [],
        rangeCandidates: [],
        wildcardEoiDescriptors: [],
    };

    // Seed the work-list with one MatchState per top-level grammar rule.
    // matchState may push additional states (for nested rules, optional
    // parts, wildcard extensions, repeat groups) during processing.
    const pending = initialMatchState(grammar);

    while (pending.length > 0) {
        const state = pending.pop()!;

        // Attempt to greedily match as many grammar parts as possible
        // against the prefix.  `matched` is true only when ALL parts in
        // the rule (including nested rules) were satisfied.  matchState
        // may also push new derivative states onto `pending` (e.g. for
        // alternative nested rules, optional-skip paths, wildcard
        // extensions, repeat iterations).
        const matched = matchState(state, input, pending);

        // Save the pending wildcard before finalizeState clears it.
        // Needed for backward completion of wildcards at the end of a rule.
        const savedPendingWildcard: PendingWildcard | undefined =
            state.pendingWildcard;

        // Snapshot the state BEFORE finalizeState mutates it.  When
        // backward backs up past a wildcard captured by finalizeState,
        // we need the pre-capture state so the property completion
        // does not include the backed-up wildcard's value.
        // Shallow copy is sufficient: finalizeState only reassigns
        // primitive fields (pendingWildcard, index) and appends to the
        // .values linked list.  The linked-list nodes themselves are
        // immutable once created, so the snapshot and the mutated state
        // share .values/.parent chains safely.
        const preFinalizeState: MatchState | undefined =
            savedPendingWildcard !== undefined ? { ...state } : undefined;

        // finalizeState does two things:
        //   1. If a wildcard is pending at the end, attempt to capture
        //      all remaining input as its value.
        //   2. Reject states that leave trailing non-separator characters
        //      un-consumed (those states don't represent valid parses).
        // It returns true when the state is "clean" — all input was
        // consumed (or only trailing separators remain).
        if (finalizeState(state, input)) {
            if (matched) {
                processExactMatch(
                    ctx,
                    state,
                    preFinalizeState,
                    savedPendingWildcard,
                );
                continue;
            }
            processCleanPartial(
                ctx,
                state,
                preFinalizeState,
                savedPendingWildcard,
            );
        } else {
            processDirtyPartial(ctx, state, matched);
        }
    }
    return ctx;
}

// --- Phase B1: Resolve partial keyword anchors ---
//
// wildcardEoiDescriptors contains all wildcard-at-EOI string
// states from both directions.  findPartialKeywordInWildcard
// is called here (not in Phase A) so that the scan is decoupled
// from candidate discovery.
//
// For each descriptor, B1 either:
//   - Finds a partial keyword → records the best anchor for
//     forward (forwardPartialKeyword), or collects a fixed
//     candidate for backward.
//   - Does not find a partial keyword → defers to Phase B2 via
//     forwardEoiCandidates (forward) or rangeCandidates
//     (backward).
function resolveWildcardAnchors(ctx: CompletionContext): {
    forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined;
    forwardEoiCandidates: WildcardStringRangeCandidate[];
} {
    const {
        input,
        direction,
        fixedCandidates,
        rangeCandidates,
        wildcardEoiDescriptors,
    } = ctx;

    // Forward partial keyword: see ForwardPartialKeywordCandidate.
    let forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined;
    // Forward EOI candidates: wildcard-at-EOI string states where
    // B1 did NOT find a partial keyword.  B2 instantiates them at
    // the appropriate anchor:
    //   - partial keyword position (if one exists from other states)
    //   - prefix.length (otherwise)
    const forwardEoiCandidates: WildcardStringRangeCandidate[] = [];

    for (const desc of wildcardEoiDescriptors) {
        const partialResult = findPartialKeywordInWildcard(
            input,
            desc.wildcardStart,
            desc.nextPart,
            desc.spacingMode,
        );
        if (direction === "backward") {
            if (
                partialResult !== undefined &&
                // Equivalent to the old `< state.index`: deferredToEoi
                // guarantees state.index >= input.length, and
                // state.index never exceeds input.length.
                partialResult.position < input.length
            ) {
                // Partial keyword found strictly inside the prefix.
                // Collect as a fixed candidate (may advance
                // maxPrefixLength, clearing weaker fallback
                // candidates from Phase A).
                //
                // When the gap between maxPrefixLength and the
                // partial keyword is separator-only, P stays at
                // maxPrefixLength (merge — the separator is
                // flex-space, not consumed).  Otherwise, strip
                // trailing separators and advance (displace —
                // the gap has real content).
                if (partialResult.position >= ctx.maxPrefixLength) {
                    if (
                        !isSeparatorOnlyGap(
                            input,
                            ctx.maxPrefixLength,
                            partialResult.position,
                        )
                    ) {
                        updateMaxPrefixLength(
                            ctx,
                            stripTrailingSeparators(
                                input,
                                partialResult.position,
                                ctx.maxPrefixLength,
                            ),
                        );
                    }
                    // Candidate is valid at the (possibly updated)
                    // maxPrefixLength: completionWord is position-
                    // independent and mergeSepMode uses maxPrefixLength.
                    fixedCandidates.push({
                        kind: "string",
                        completionText: partialResult.completionWord,
                        spacingMode: desc.spacingMode,
                        openWildcard: true,
                        partialKeywordBackup: true,
                    });
                }
            } else {
                // No useful partial keyword — create range
                // candidate for Phase B2.
                rangeCandidates.push({
                    kind: "wildcardString",
                    wildcardStart: desc.wildcardStart,
                    nextPart: desc.nextPart,
                    spacingMode: desc.spacingMode,
                });
            }
        } else {
            // Forward direction.
            if (partialResult !== undefined) {
                // Partial keyword found — update best anchor.
                // Don't push to forwardEoiCandidates:
                // tryPartialStringMatch at the anchor can't
                // reproduce multi-word keyword results.
                if (
                    forwardPartialKeyword === undefined ||
                    partialResult.position > forwardPartialKeyword.position
                ) {
                    forwardPartialKeyword = {
                        position: partialResult.position,
                        completionWord: partialResult.completionWord,
                        spacingMode: desc.spacingMode,
                    };
                }
            } else {
                // No partial keyword — defer to Phase B2.
                forwardEoiCandidates.push({
                    kind: "wildcardString",
                    wildcardStart: desc.wildcardStart,
                    nextPart: desc.nextPart,
                    spacingMode: desc.spacingMode,
                });
            }
        }
    }

    return { forwardPartialKeyword, forwardEoiCandidates };
}

// --- Phase B2: Convert candidates to final completions/properties ---
//
// Fixed candidates are converted directly — they are already
// guaranteed to be at maxPrefixLength (candidates at shorter
// positions were discarded when maxPrefixLength advanced).
//
// Range candidates are only converted when the "retrigger"
// conditions are met (see the range-candidate block below).
//
// Global string deduplication: multiple rules (or repeat-
// expansion states of the same rule) can produce the same
// completion text at the same maxPrefixLength.  Showing
// duplicates in the menu is unhelpful, so we deduplicate
// globally.
function materializeCandidates(
    ctx: CompletionContext,
    forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined,
    forwardEoiCandidates: WildcardStringRangeCandidate[],
): GrammarCompletionResult {
    const { input, direction, fixedCandidates, rangeCandidates } = ctx;
    const completions = new Set<string>();
    const properties: GrammarCompletionProperty[] = [];

    // Derive output fields from surviving fixed candidates — only
    // candidates at the final maxPrefixLength contribute.  The
    // implicit reset when updateMaxPrefixLength clears fixedCandidates
    // is automatic (no surviving candidate ⇒ default value).
    // separatorMode, closedSet, and openWildcard may be updated by
    // range candidates and forward EOI candidates below.
    let separatorMode: SeparatorMode | undefined;
    let closedSet = true;
    let openWildcard = false;
    let partialKeywordBackup = false;

    for (const c of fixedCandidates) {
        if (c.openWildcard) {
            openWildcard = true;
        }
        if (c.partialKeywordBackup) {
            partialKeywordBackup = true;
        }
        if (c.kind === "string") {
            completions.add(c.completionText);
            separatorMode = mergeSepMode(
                input,
                separatorMode,
                ctx.maxPrefixLength,
                c.completionText[0],
                c.spacingMode,
            );
        } else {
            const completionProperty = getGrammarCompletionProperty(
                c.state,
                c.valueId,
            );
            if (completionProperty !== undefined) {
                properties.push(completionProperty);
                closedSet = false;
                separatorMode = mergeSepMode(
                    input,
                    separatorMode,
                    ctx.maxPrefixLength,
                    "a",
                    c.spacingMode,
                );
            }
        }
    }

    // Range candidates replace the old two-pass backward retrigger
    // (which recursively called matchGrammarCompletion(forward) at
    // the backed-up position).  Each range candidate records a
    // wildcard-to-nextPart relationship from Category 2 backward;
    // here we check whether maxPrefixLength falls inside the
    // candidate's valid range and whether the wildcard text at that
    // split is well-formed (via getWildcardStr).  If so, we run
    // tryPartialStringMatch forward at maxPrefixLength to produce
    // the completion — exactly what the old forward re-invocation
    // would have done for that rule's wildcard-keyword boundary.
    //
    // Gating: range candidates are processed when backward has
    // range candidates and trailing text remains.
    //
    // rangeCandidateGateOpen: the backed-up position is usable for
    // range candidate processing.  True when either:
    //  (a) the position is definite (!openWildcard) — no wildcard
    //      boundary ambiguity; forward re-parsing would land at
    //      the same position, or
    //  (b) the position is anchored by a partial keyword
    //      (partialKeywordBackup) — the keyword fragment pins the
    //      position even though a wildcard boundary is open.
    //
    // Invariant: partialKeywordBackup implies openWildcard.
    const rangeCandidateGateOpen = !openWildcard || partialKeywordBackup;
    const processRangeCandidates =
        direction === "backward" &&
        rangeCandidates.length > 0 &&
        ctx.maxPrefixLength < input.length &&
        rangeCandidateGateOpen;
    if (processRangeCandidates) {
        // Truncate once so range candidates don't peek at trailing
        // input beyond maxPrefixLength (invariant #3).
        const truncatedInput = input.substring(0, ctx.maxPrefixLength);
        for (const c of rangeCandidates) {
            if (ctx.maxPrefixLength <= c.wildcardStart) continue;
            if (
                getWildcardStr(
                    input,
                    c.wildcardStart,
                    ctx.maxPrefixLength,
                    c.spacingMode,
                ) === undefined
            ) {
                continue;
            }
            if (c.kind === "wildcardString") {
                const partial = tryPartialStringMatch(
                    c.nextPart,
                    truncatedInput,
                    ctx.maxPrefixLength,
                    c.spacingMode,
                    "forward",
                );
                if (
                    partial !== undefined &&
                    !completions.has(partial.remainingText)
                ) {
                    completions.add(partial.remainingText);
                    separatorMode = mergeSepMode(
                        input,
                        separatorMode,
                        ctx.maxPrefixLength,
                        partial.remainingText[0],
                        c.spacingMode,
                    );
                    openWildcard = true;
                }
            } else {
                const completionProperty = getGrammarCompletionProperty(
                    c.state,
                    c.valueId,
                );
                if (completionProperty !== undefined) {
                    properties.push(completionProperty);
                    separatorMode = mergeSepMode(
                        input,
                        separatorMode,
                        ctx.maxPrefixLength,
                        "a",
                        c.spacingMode,
                    );
                    openWildcard = true;
                    closedSet = false;
                }
            }
        }
    }

    // Forward EOI candidate instantiation and partial keyword recovery.
    //
    // Category 2 wildcard-at-EOI string candidates are deferred
    // during Phase A (via wildcardEoiDescriptors) and resolved by
    // Phase B1 into forwardPartialKeyword / forwardEoiCandidates.
    // The wildcard boundary is ambiguous, so Phase A never pushes
    // maxPrefixLength for them; Phase B1/B2 decides the final anchor.
    //
    // Phase B2 operates in one of two modes:
    //
    //   Clear + anchor (displace):
    //     anchor > maxPrefixLength AND the gap contains non-separator
    //     content — only weaker candidates (e.g. Category 3b)
    //     survived Phase A.  Replace them with EOI instantiations.
    //
    //   Merge at anchor:
    //     anchor matches maxPrefixLength (stripping collapsed any
    //     separator-only gap).  Legitimate candidates exist at that
    //     position.  Preserve them and add EOI instantiations alongside.
    //
    // The anchor is computed to align with keyword behavior: P lands
    // before the flex-space (trailing separators stripped), not after
    // it.  This makes wildcard→keyword transitions consistent with
    // keyword→keyword transitions, where P stays at the last matched
    // token boundary.
    const hasPartialKeyword =
        forwardPartialKeyword !== undefined &&
        forwardPartialKeyword.position <= input.length;
    if (
        // Defensive: forwardEoiCandidates is only populated in the
        // forward direction, but the guard makes the intent explicit.
        direction !== "backward" &&
        (forwardEoiCandidates.length > 0 || hasPartialKeyword)
    ) {
        // anchor is what becomes matchedPrefixLength for these candidates.
        // Start from the partial keyword position (if any) or
        // prefix.length, then strip trailing separators so that P
        // lands before the flex-space — consistent with how
        // keyword→keyword P stays at the last matched token boundary.
        // For partial keywords, this strips the separator gap between
        // the wildcard content and the partial keyword start.
        // The strip is bounded by maxPrefixLength: if another rule
        // already consumed content at that position (e.g. via an
        // escaped-space keyword), we must not discard it.
        //
        // Skip stripping when a partial keyword consumed to EOI
        // (position === prefix.length): the keyword content itself
        // may end with separator characters (e.g. comma in "hello,")
        // that must not be stripped.
        let anchor = hasPartialKeyword
            ? forwardPartialKeyword!.position
            : input.length;
        if (!hasPartialKeyword || anchor < input.length) {
            anchor = stripTrailingSeparators(
                input,
                anchor,
                ctx.maxPrefixLength,
            );
        }

        // Decide whether to clear existing candidates (displace)
        // or keep them (merge).
        //
        // After stripping, anchor either equals maxPrefixLength
        // (natural merge — stripping consumed the entire gap) or
        // lands on a non-separator character above maxPrefixLength.
        // In the latter case the gap necessarily contains that
        // non-separator, so it's always a displace.
        //
        // (A separator-only gap between maxPrefixLength and the
        // raw position is fully consumed by stripping, collapsing
        // anchor to maxPrefixLength — the merge case.)
        if (anchor !== ctx.maxPrefixLength) {
            debugCompletion(
                `Phase B: clear + anchor at ${hasPartialKeyword ? `partial keyword P=${anchor}` : `stripped EOI P=${anchor} (displace)`}`,
            );
            completions.clear();
            properties.length = 0;
            ctx.maxPrefixLength = anchor;
            closedSet = true;
            separatorMode = undefined;
            openWildcard = false;
        } else {
            debugCompletion(`Phase B: merge at P=${anchor}`);
        }

        // Wildcard boundary is ambiguous when Phase B is
        // actually instantiating candidates (partial keyword or
        // deferred EOI candidates).
        if (hasPartialKeyword || forwardEoiCandidates.length > 0) {
            openWildcard = true;
        }

        // Add the partial keyword itself when it determined
        // the anchor.  tryPartialStringMatch at the anchor
        // position cannot reproduce multi-word keyword results
        // (e.g. "by" from ["played","by"]), so we use the
        // saved completionWord directly.
        if (hasPartialKeyword) {
            const fpk = forwardPartialKeyword!;
            completions.add(fpk.completionWord);
            separatorMode = mergeSepMode(
                input,
                separatorMode,
                anchor,
                fpk.completionWord[0],
                fpk.spacingMode,
            );
        }

        // Instantiate deferred EOI candidates at the anchor.
        for (const c of forwardEoiCandidates) {
            if (anchor <= c.wildcardStart) continue;
            if (
                getWildcardStr(
                    input,
                    c.wildcardStart,
                    anchor,
                    c.spacingMode,
                ) === undefined
            ) {
                continue;
            }
            const partial = tryPartialStringMatch(
                c.nextPart,
                input,
                anchor,
                c.spacingMode,
                "forward",
            );
            if (
                partial !== undefined &&
                !completions.has(partial.remainingText)
            ) {
                completions.add(partial.remainingText);
                separatorMode = mergeSepMode(
                    input,
                    separatorMode,
                    anchor,
                    partial.remainingText[0],
                    c.spacingMode,
                );
            }
        }
    }

    // See the directionSensitive field comment on
    // GrammarCompletionResult for why P > 0 is correct.
    // minPrefixLength (caller-supplied search lower bound) is
    // not consulted — it constrains the search, not the result.
    const directionSensitive = ctx.maxPrefixLength > 0;

    return {
        completions: [...completions],
        properties,
        matchedPrefixLength: ctx.maxPrefixLength,
        separatorMode,
        closedSet,
        directionSensitive,
        openWildcard,
    };
}

export function matchGrammarCompletion(
    grammar: Grammar,
    input: string,
    minPrefixLength?: number,
    direction?: "forward" | "backward",
): GrammarCompletionResult {
    debugCompletion(
        `Start completion for input ${direction ?? "forward"}: "${input}"`,
    );

    // Phase A
    const ctx = collectCandidates(grammar, input, minPrefixLength, direction);
    // Phase B1
    const { forwardPartialKeyword, forwardEoiCandidates } =
        resolveWildcardAnchors(ctx);

    // Phase B2
    const result = materializeCandidates(
        ctx,
        forwardPartialKeyword,
        forwardEoiCandidates,
    );

    debugCompletion(`Completed. ${JSON.stringify(result)}`);
    return result;
}
