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
    type GrammarMatchOptions,
    separatorRegExpStr,
    requiresSeparator,
    isBoundarySatisfied,
    nextNonSeparatorIndex,
    getWildcardStr,
    createValue,
    finalizeState,
    finalizeNestedRule,
    initialMatchState,
    leadingSpacingMode,
    matchState,
    cloneMatchState,
    suppressBacktracksAfterSuccess,
    tryNextBacktrack,
} from "./grammarMatcher.js";

const debugCompletion = registerDebug("typeagent:grammar:completion");

// Pre-compiled regex for stripping leading separator characters.
const leadingSeparatorRegExp = new RegExp(`^[${separatorRegExpStr}]+`, "u");

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
    suppressLeadingSeparator: boolean = false,
): { matchedWords: number; endIndex: number; prevEndIndex: number } {
    let index = startIndex;
    let prevIndex = startIndex;
    let matchedWords = 0;

    for (let k = 0; k < words.length; k++) {
        const word = words[k];
        const escaped = escapeMatch(word);

        // Separator logic has two independent dimensions:
        //
        //   k === 0 (first word):
        //     Governed by the *caller*, not spacingMode.  The caller
        //     decides whether the leading separator (between the match
        //     start position and the first keyword word) is allowed:
        //       suppressLeadingSeparator=true  → bare word, no prefix
        //         (used when leadingSpacingMode() returns "none")
        //       suppressLeadingSeparator=false → [sep]*? lazy optional
        //         prefix that skips any leading whitespace/punctuation.
        //         The lazy quantifier matches zero-width when the
        //         keyword starts immediately, so this is "allow but
        //         don't require" leading whitespace.
        //     Note: spacingMode is intentionally NOT consulted for
        //     k=0.  Even when spacingMode is "none", callers like
        //     matchKeywordWordsFrom (wildcard scanning) need the
        //     optional leading separator to find keyword candidates
        //     at separator-delimited positions within wildcard text.
        //
        //   k > 0 (subsequent words):
        //     Governed by the rule's spacingMode:
        //       "none"  → bare word, no inter-word separator
        //       other   → separator required or optional per
        //                 requiresSeparator() for the character pair
        let regExpStr: string;
        if (k === 0) {
            regExpStr = suppressLeadingSeparator
                ? escaped
                : `[${separatorRegExpStr}]*?${escaped}`;
        } else if (spacingMode === "none") {
            regExpStr = escaped;
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
        const sepMatch = textToCheck.match(leadingSeparatorRegExp);
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
// Used in both directions (called from finalizeCandidates,
// not inline in Phase 1):
//   - Forward: determines the anchor position for deferred
//     wildcard-at-EOI candidates (see forwardPartialKeyword).
//   - Backward: collects a fixed candidate at the partial keyword
//     position, which may advance maxPrefixLength and clear weaker
//     fallback candidates from Phase 1.
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
    separatorMode: SeparatorMode;
};

// Describes how the grammar rules that produced completions at this
// position relate to wildcards.  See afterWildcard on
// GrammarCompletionResult for the full semantics, and
// docs/architecture/completion.md § Invariants for correctness
// invariants on these fields.
//
// Intentionally duplicated from @typeagent/agent-sdk (command.ts),
// like SeparatorMode in grammarMatcher.ts, because the two packages
// have no dependency relationship.  Keep both definitions in sync.
export type AfterWildcard = "none" | "some" | "all";

export type GrammarCompletionResult = {
    // Per-group completions, partitioned by separator mode.
    // Each group carries its own separatorMode — the shell shows/hides
    // groups based on the user's trailing separator state.
    // When only a single mode is present, there is one group.
    groups: GrammarCompletionGroup[];
    properties?: GrammarCompletionProperty[] | undefined;
    // Number of characters from the input prefix that the grammar consumed
    // before the completion point.  The shell uses this to determine where
    // to insert/filter completions.
    matchedPrefixLength?: number | undefined;
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
    // Describes how the grammar rules that produced completions at
    // this position relate to wildcards.
    //   "none" — no rule reached this position through a wildcard.
    //            The position is structurally pinned.
    //   "some" — some rules used a wildcard, some didn't (mixed).
    //            Position-sensitive literals are mixed with
    //            wildcard-stable completions.
    //   "all"  — every rule reached this position through a wildcard.
    //            The position is ambiguous and can slide forward.
    //
    // A position is **definite** ("none") when it is structurally
    // pinned by matched grammar tokens: no amount of additional typing
    // can change where it falls.
    //
    // A position is **ambiguous** ("some" or "all") when at least one
    // rule has a wildcard whose extent is not fully determined.  The
    // wildcard could absorb more text, moving the boundary forward.
    //
    // Within a single grammar, only "none" and "all" arise.  "some"
    // appears after merging results from multiple rules that disagree.
    afterWildcard: AfterWildcard;
};

// A completion group within a GrammarCompletionResult.
// Intentionally parallel to CompletionGroup in @typeagent/agent-sdk
// but defined here because actionGrammar has no dependency on agentSdk.
// Unlike the SDK's CompletionGroup (where separatorMode is optional,
// defaulting to "space"), the grammar always sets this field.
export type GrammarCompletionGroup = {
    completions: string[];
    separatorMode: SeparatorMode;
};

function getGrammarCompletionProperty(
    state: MatchState,
    valueId: number,
    spacingMode: CompiledSpacingMode,
): GrammarCompletionProperty | undefined {
    const temp = { ...state };

    while (finalizeNestedRule(temp, true)) {}
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
        separatorMode: spacingModeToSeparatorMode(spacingMode),
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
    suppressLeadingSeparator: boolean = false,
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
        suppressLeadingSeparator,
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
 * ## Three-Phase Architecture
 *
 * The function uses a **collect-then-convert** design.  Phase 1 (collect)
 * processes every rule and collects lightweight *candidate descriptors*
 * into two sets — `fixedCandidates` and `rangeCandidates`.
 * Phase 2 (finalize) resolves deferred wildcard anchors, flushes shadow
 * candidates, and filters separator conflicts.  Phase 3 (materialize)
 * converts surviving candidates into the final `completions[]` and
 * `properties[]` arrays.  See the inline "Three-Phase Collect, Finalize,
 * Materialize Architecture" comment for details.
 *
 * ## Phase 1 — Three categories
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
 *    for `finalizeCandidates` to resolve via
 *    `findPartialKeywordInWildcard`.  This prevents wildcard-at-EOI
 *    states from pushing `maxPrefixLength` past more-meaningful
 *    candidates.  See `finalizeCandidates` and
 *    `injectForwardEoiCandidates`.
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
          isAfterWildcard: boolean;
          partialKeywordBackup: boolean;
      }
    | {
          kind: "property";
          valueId: number;
          state: MatchState;
          spacingMode: CompiledSpacingMode;
          isAfterWildcard: boolean;
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
// partial keyword scan is deferred to Phase 2
// (finalizeCandidates).  Phase 1 pushes one descriptor per
// wildcard-at-EOI string state (both forward and backward).
// Phase 2 runs findPartialKeywordInWildcard on each descriptor,
// resolving it into a partial keyword anchor, a fixed candidate,
// or a range candidate.
type WildcardEoiDescriptor = {
    wildcardStart: number;
    nextPart: StringPart;
    spacingMode: CompiledSpacingMode;
};

// Forward partial keyword anchor: populated by
// finalizeCandidates when findPartialKeywordInWildcard finds
// a partial keyword at position P inside a wildcard-at-EOI state.
// injectForwardEoiCandidates uses position to anchor and
// completionWord to emit the completion (tryPartialStringMatch at
// the anchor position cannot reproduce multi-word keyword
// results — e.g. for keyword ["played","by"], the partial keyword
// "by" is found at position 18 from candidateStart=11, but
// tryPartialStringMatch at 18 returns "played" instead).
type ForwardPartialKeywordCandidate = {
    position: number;
    completionWord: string;
    spacingMode: CompiledSpacingMode;
};

type DeferredShadowCandidate = {
    consumedLength: number;
    candidate: FixedCandidate;
};

// Map a compiled spacing mode to the corresponding SeparatorMode.
// Only "autoSpacePunctuation" (undefined) produces a mode that requires per-item
// resolution by the consumer; the other modes map deterministically.
export function spacingModeToSeparatorMode(
    mode: CompiledSpacingMode,
): SeparatorMode {
    switch (mode) {
        case "required":
            return "spacePunctuation";
        case "optional":
            return "optionalSpacePunctuation";
        case "none":
            return "none";
        case undefined: // auto
            return "autoSpacePunctuation";
    }
}

// --- CompletionContext: mutable state shared across completion phases ---
//
// The main loop (Phase 1) collects lightweight candidate descriptors
// (FixedCandidate / RangeCandidate) rather than immediately emitting
// final completion strings and property objects.  Phase 2 (finalize)
// and Phase 3 (materialize) convert surviving candidates into the
// output arrays.
//
// This decouples candidate *discovery* (which rule matched, at what
// position) from candidate *materialization* (building the
// GrammarCompletionProperty, computing separatorMode).  The split is
// essential for backward completion: the main loop evaluates every rule
// at the full input length, but the final completion position
// (maxPrefixLength) is only known after ALL rules have been processed.
// Range candidates exploit this — they defer the "where does the
// wildcard end?" decision until Phase 2/3, when maxPrefixLength is
// settled.
//
// fixedCandidates — single valid position, cleared whenever
//     maxPrefixLength advances.  Produced by all three categories
//     in both forward and backward modes.
//
// rangeCandidates — valid at any wildcard split in
//     [wildcardStart+1, input.length], never cleared.  They
//     arise in Category 2 backward when a wildcard absorbed
//     all remaining input and the next part could match at
//     a flexible position.  Processed in Phase 3 only under
//     the same conditions the old retrigger required.
//
// Phases 2 and 3:
//  Phase 2 — Finalization (finalizeCandidates): resolves
//    deferred wildcardEoiDescriptors via
//    findPartialKeywordInWildcard, flushes shadow candidates,
//    injects forward EOI candidates as fixedCandidates, and
//    filters separator mode conflicts (filterSepConflicts).
//    After Phase 2, fixedCandidates are pre-filtered,
//    rangeCandidates are ready, and maxPrefixLength is finalized.
//  Phase 3 — Materialization (materializeCandidates): converts
//    surviving candidates into the final completions[] and
//    properties[] arrays.  Handles range candidates and
//    deduplication.
type CompletionContext = {
    readonly input: string;
    readonly direction: "forward" | "backward" | undefined;
    maxPrefixLength: number;
    fixedCandidates: FixedCandidate[];
    rangeCandidates: RangeCandidate[];
    wildcardEoiDescriptors: WildcardEoiDescriptor[];
    /** Shadow candidates from backward Cat 3b, deferred until
     *  maxPrefixLength is finalized so the check is order-independent. */
    deferredShadowCandidates: DeferredShadowCandidate[];
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

// Collect a property completion candidate at a given input position.
// Updates maxPrefixLength; skips if position is below max.  The
// candidate is converted to a final GrammarCompletionProperty in Phase 3.
function collectPropertyCandidate(
    ctx: CompletionContext,
    state: MatchState,
    valueId: number,
    prefixPosition: number,
    isAfterWildcard: boolean = false,
): void {
    updateMaxPrefixLength(ctx, prefixPosition);
    if (prefixPosition !== ctx.maxPrefixLength) return;
    // At the leading edge of a nested rule, the separator between
    // the matched prefix and the property slot is governed by the
    // parent's spacing mode, not the nested rule's own mode.
    const effectiveMode = leadingSpacingMode(state);
    ctx.fixedCandidates.push({
        kind: "property",
        valueId,
        state: { ...state },
        spacingMode: effectiveMode,
        isAfterWildcard,
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
    leadingMode: CompiledSpacingMode,
    interWordMode: CompiledSpacingMode,
    part: StringPart,
    isAfterWildcard: boolean,
    startIndex: number,
    dir: "forward" | "backward" | undefined,
    effectivePrefixEnd?: number,
): boolean {
    const partial = tryPartialStringMatch(
        part,
        ctx.input,
        startIndex,
        interWordMode,
        dir,
        effectivePrefixEnd,
        leadingMode === "none",
    );
    if (partial !== undefined) {
        updateMaxPrefixLength(ctx, partial.consumedLength);
        if (partial.consumedLength === ctx.maxPrefixLength) {
            // When no words were consumed (completion is the first
            // word of the part), the separator between the matched
            // prefix and the completion is governed by the leading
            // mode, not the rule's inter-word spacingMode.
            const candidateSpacingMode =
                partial.consumedLength === startIndex
                    ? leadingMode
                    : interWordMode;
            ctx.fixedCandidates.push({
                kind: "string",
                completionText: partial.remainingText,
                spacingMode: candidateSpacingMode,
                isAfterWildcard,
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
// Tags the candidate with isAfterWildcard when backing up to a part that
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
                    leadingSpacingMode(state),
                    info.matchedSpacingMode,
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
// partial keyword scan to finalizeCandidates via
// wildcardEoiDescriptors.
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
    // partial keyword scan to finalizeCandidates.  This
    // applies to both directions under the same condition.
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
        // a partial keyword exists inside the wildcard,
        // finalizeCandidates will find it and may clear
        // this fallback in favor of a higher-position candidate.
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
                leadingSpacingMode(state),
                state.spacingMode,
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
        //  (b) the input was fully consumed before the
        //      wildcard started (state.index >= input.length)
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
                leadingSpacingMode(state),
                state.spacingMode,
                currentPart,
                false,
                state.index,
                direction,
            );
            // In backward mode, tryPartialStringMatch may back up
            // past maxPrefixLength (e.g. spacing=none unconditionally
            // sets couldBackUp=true, causing the candidate to land at
            // a lower P).  The backed-up candidate gets discarded if
            // another rule already set a higher maxPrefixLength.
            //
            // Collect the forward-direction candidate as a deferred
            // shadow.  After the Phase 1 loop finishes and
            // maxPrefixLength is finalized, shadows whose
            // consumedLength matches are flushed into fixedCandidates.
            // This is order-independent — it doesn't matter whether
            // the requiring-mode rule or the none-mode rule is
            // processed first.
            if (direction === "backward") {
                const lMode = leadingSpacingMode(state);
                const fwdPartial = tryPartialStringMatch(
                    currentPart,
                    ctx.input,
                    state.index,
                    state.spacingMode,
                    "forward",
                    undefined,
                    lMode === "none",
                );
                if (fwdPartial !== undefined) {
                    const candidateSpacingMode =
                        fwdPartial.consumedLength === state.index
                            ? lMode
                            : state.spacingMode;
                    ctx.deferredShadowCandidates.push({
                        consumedLength: fwdPartial.consumedLength,
                        candidate: {
                            kind: "string",
                            completionText: fwdPartial.remainingText,
                            spacingMode: candidateSpacingMode,
                            isAfterWildcard: false,
                            partialKeywordBackup: false,
                        },
                    });
                }
            }
        }
    }
}

// --- Phase 1 (collect): process every pending state, collecting candidates ---
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
    matchOptions: GrammarMatchOptions | undefined,
): CompletionContext {
    const ctx: CompletionContext = {
        input,
        direction,
        maxPrefixLength: minPrefixLength ?? 0,
        fixedCandidates: [],
        rangeCandidates: [],
        wildcardEoiDescriptors: [],
        deferredShadowCandidates: [],
    };

    // Seed the live MatchState for rule 0; rules 1..N-1 are
    // pre-pushed onto its `backtracks` chain by
    // `initialMatchState`.  Each fork site (optional skip,
    // nested-rule alternation, repeat continuation) pushes its
    // alternative onto the live state's `backtracks` rather
    // than a global work-list.
    const state = initialMatchState(grammar, input, matchOptions);
    if (state === undefined) {
        return ctx;
    }

    const wildcardShortest = state.wildcardPolicy === "shortest";

    // Single-axis drain: process one match attempt, collect
    // candidates per category, then advance to the next backtrack
    // frame.  Wildcard refinements (origin "wildcard") and
    // structural alternatives (origin "optional"/"alternation"/
    // "repeat") share the same LIFO chain — see
    // `pushBacktrack` / `tryNextBacktrack`.
    //
    // We process every attempt (success and failure), unlike the
    // matcher which only emits results on success — a failed
    // attempt is a partial match that produces completion
    // candidates for the next expected part.
    do {
        const matched = matchState(state, input);
        // Save the pending wildcard before finalizeState clears it.
        // Needed for backward completion of wildcards at the end of a rule.
        const savedPendingWildcard: PendingWildcard | undefined =
            state.pendingWildcard;

        // Snapshot the state BEFORE finalizeState mutates it.  When
        // backward backs up past a wildcard captured by finalizeState,
        // we need the pre-capture state so the property completion
        // does not include the backed-up wildcard's value.  Use
        // `cloneMatchState` to drop `backtracks` — the live
        // chain will be mutated by the next iteration.
        const preFinalizeState: MatchState | undefined =
            savedPendingWildcard !== undefined
                ? cloneMatchState(state)
                : undefined;

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
            } else {
                processCleanPartial(
                    ctx,
                    state,
                    preFinalizeState,
                    savedPendingWildcard,
                );
            }
            // After a successful path through this state, drop
            // backtrack frames whose origin axis is configured to
            // commit on first success.  Under wildcardPolicy:
            // "shortest", this ALSO drops "wildcard"-origin frames
            // belonging to sibling states deeper in the chain —
            // preventing the sibling-rescue spurious completion
            // class of bug.
            // See `suppressBacktracksAfterSuccess`.
            suppressBacktracksAfterSuccess(state);
        } else {
            processDirtyPartial(ctx, state, matched);
            // Even for a dirty partial, if the pending wildcard
            // starts at-or-past the last non-separator character
            // (capture region is separator-only), the state has
            // reached end-of-meaningful-input and any longer-
            // wildcard alternative would re-emit the just-matched
            // literal terminator as a spurious completion.
            // Suppress per-policy frames as if it were a clean
            // success.
            if (
                wildcardShortest &&
                savedPendingWildcard !== undefined &&
                nextNonSeparatorIndex(input, savedPendingWildcard.start) ===
                    input.length
            ) {
                suppressBacktracksAfterSuccess(state);
            }
        }
    } while (tryNextBacktrack(state));

    return ctx;
}

// Flush deferred shadow candidates whose consumedLength matches
// the current maxPrefixLength.  Called after the per-descriptor
// loop in finalizeCandidates (which can advance
// maxPrefixLength for backward wildcard-at-EOI partial keywords)
// so the check uses the final P, not an intermediate value.
function flushShadowCandidates(ctx: CompletionContext): void {
    for (const shadow of ctx.deferredShadowCandidates) {
        if (shadow.consumedLength === ctx.maxPrefixLength) {
            ctx.fixedCandidates.push(shadow.candidate);
        }
    }
}

// --- Forward EOI candidate injection ---
//
// Converts forward wildcard-at-EOI candidates into regular
// FixedCandidates so they participate in the single conflict
// detection pass in filterSepConflicts.  Called from
// finalizeCandidates after the per-descriptor loop.
//
// Operates in one of two modes:
//
//   Displace: anchor > maxPrefixLength AND the gap contains
//     non-separator content — only weaker candidates (e.g.
//     Category 3b) survived Phase 1.  Clear fixedCandidates
//     and set P = anchor, replacing them with EOI candidates.
//
//   Merge: anchor === maxPrefixLength (stripping collapsed any
//     separator-only gap).  Legitimate candidates exist at that
//     position.  Add EOI candidates alongside them.
//
// The anchor is computed to align with keyword behavior: P lands
// before the flex-space (trailing separators stripped), not after
// it.  This makes wildcard→keyword transitions consistent with
// keyword→keyword transitions, where P stays at the last matched
// token boundary.
function injectForwardEoiCandidates(
    ctx: CompletionContext,
    forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined,
    forwardEoiCandidates: WildcardStringRangeCandidate[],
): void {
    const { input, direction } = ctx;

    const hasPartialKeyword =
        forwardPartialKeyword !== undefined &&
        forwardPartialKeyword.position <= input.length;
    if (
        direction === "backward" ||
        (!hasPartialKeyword && forwardEoiCandidates.length === 0)
    ) {
        return;
    }

    // anchor is what becomes matchedPrefixLength for these candidates.
    // Start from the partial keyword position (if any) or
    // input.length, then strip trailing separators so that P
    // lands before the flex-space — consistent with how
    // keyword→keyword P stays at the last matched token boundary.
    // For partial keywords, this strips the separator gap between
    // the wildcard content and the partial keyword start.
    // The strip is bounded by maxPrefixLength: if another rule
    // already consumed content at that position (e.g. via an
    // escaped-space keyword), we must not discard it.
    //
    // Skip stripping when a partial keyword consumed to EOI
    // (position === input.length): the keyword content itself
    // may end with separator characters (e.g. comma in "hello,")
    // that must not be stripped.
    let anchor = hasPartialKeyword
        ? forwardPartialKeyword!.position
        : input.length;
    if (!hasPartialKeyword || anchor < input.length) {
        anchor = stripTrailingSeparators(input, anchor, ctx.maxPrefixLength);
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
            `Phase 2: clear + anchor at ${hasPartialKeyword ? `partial keyword P=${anchor}` : `stripped EOI P=${anchor} (displace)`}`,
        );
        ctx.fixedCandidates.length = 0;
        ctx.maxPrefixLength = anchor;
    } else {
        debugCompletion(`Phase 2: merge at P=${anchor}`);
    }

    // Add the partial keyword itself.  tryPartialStringMatch at
    // the anchor position cannot reproduce multi-word keyword
    // results (e.g. "by" from ["played","by"]), so we use the
    // saved completionWord directly.
    if (hasPartialKeyword) {
        const fpk = forwardPartialKeyword!;
        ctx.fixedCandidates.push({
            kind: "string",
            completionText: fpk.completionWord,
            spacingMode: fpk.spacingMode,
            isAfterWildcard: true,
            partialKeywordBackup: false,
        });
    }

    // Instantiate deferred EOI candidates at the anchor.
    for (const c of forwardEoiCandidates) {
        if (anchor <= c.wildcardStart) continue;
        if (
            getWildcardStr(input, c.wildcardStart, anchor, c.spacingMode) ===
            undefined
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
        if (partial !== undefined) {
            ctx.fixedCandidates.push({
                kind: "string",
                completionText: partial.remainingText,
                spacingMode: c.spacingMode,
                isAfterWildcard: true,
                partialKeywordBackup: false,
            });
        }
    }
}

// --- Phase 2 (finalize): wildcard anchors, shadows, EOI ---
//
// Resolves deferred wildcard-at-EOI descriptors, flushes shadow
// candidates, and injects forward EOI candidates as fixedCandidates.
// After this function returns, fixedCandidates and rangeCandidates
// are ready, and maxPrefixLength is finalized — ready for Phase 3
// (materializeCandidates).
//
// wildcardEoiDescriptors contains all wildcard-at-EOI string
// states from both directions.  findPartialKeywordInWildcard
// is called here (not in Phase 1) so that the scan is decoupled
// from candidate discovery.
//
// For each descriptor, Phase 2 either:
//   - Finds a partial keyword → records the best anchor for
//     forward (forwardPartialKeyword), or collects a fixed
//     candidate for backward.
//   - Does not find a partial keyword → collects a range
//     candidate (backward) or defers to forward EOI injection.
//
// After the per-descriptor loop:
//   1. Forward EOI candidates are injected as fixedCandidates
//      via injectForwardEoiCandidates.
//   2. Shadow candidates are flushed (consumedLength must match
//      the now-settled maxPrefixLength).
function finalizeCandidates(ctx: CompletionContext): void {
    const {
        input,
        direction,
        fixedCandidates,
        rangeCandidates,
        wildcardEoiDescriptors,
    } = ctx;

    // Forward partial keyword: see ForwardPartialKeywordCandidate.
    let forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined;
    // Forward EOI candidates: wildcard-at-EOI states with a string
    // next-part where no partial keyword was found.
    // injectForwardEoiCandidates instantiates them at the
    // appropriate anchor:
    //   - partial keyword position (if one exists from other states)
    //   - input.length (otherwise)
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
                // candidates from Phase 1).
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
                        isAfterWildcard: true,
                        partialKeywordBackup: true,
                    });
                }
            } else {
                // No useful partial keyword — create range
                // candidate for materializeCandidates.
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
                // No partial keyword — defer to EOI injection.
                forwardEoiCandidates.push({
                    kind: "wildcardString",
                    wildcardStart: desc.wildcardStart,
                    nextPart: desc.nextPart,
                    spacingMode: desc.spacingMode,
                });
            }
        }
    }

    // The two post-loop steps MUST run in this order:
    //   1. injectForwardEoiCandidates — may clear fixedCandidates
    //      and advance maxPrefixLength (displace path).
    //   2. flushShadowCandidates — checks maxPrefixLength set by (1).
    // (Steps 1 and 2 are direction-exclusive — forward early-returns
    // in injectForwardEoiCandidates; shadows are only collected during
    // backward — so their internal order is interchangeable.  Forward
    // first keeps the forward flow contiguous with the
    // forwardPartialKeyword / forwardEoiCandidates variables above.)

    // Forward EOI candidate injection: converts wildcard-at-EOI
    // candidates into regular fixedCandidates so they participate
    // in the single conflict detection pass in filterSepConflicts.
    injectForwardEoiCandidates(
        ctx,
        forwardPartialKeyword,
        forwardEoiCandidates,
    );

    // Flush deferred shadow candidates into fixedCandidates.
    flushShadowCandidates(ctx);
}

// --- Phase 3 (materialize): Convert candidates to final completions/properties ---
//
// Fixed candidates are converted directly — they are already
// at maxPrefixLength and pre-filtered for separator conflicts
// (candidates at shorter positions or with incompatible separator
// modes were removed by earlier phases).
//
// Range candidates are only converted when the "retrigger"
// conditions are met (see the range-candidate block below).
//
// Global string deduplication: multiple rules (or repeat-
// expansion states of the same rule) can produce the same
// completion text at the same maxPrefixLength.  Showing
// duplicates in the menu is unhelpful, so we deduplicate
// globally within each separator mode group.

function materializeCandidates(
    ctx: CompletionContext,
): GrammarCompletionResult {
    const { input, direction, fixedCandidates, rangeCandidates } = ctx;

    // Per-mode buckets for string completions (deduplicated).
    const modeCompletions = new Map<SeparatorMode, Set<string>>();
    const properties: GrammarCompletionProperty[] = [];

    let closedSet = true;
    let anyAfterWildcard = false;
    let hasNonWildcardCompletion = false;
    let partialKeywordBackup = false;

    // Helper: add a string completion to its mode bucket.
    function addCompletion(text: string, mode: SeparatorMode): void {
        let bucket = modeCompletions.get(mode);
        if (bucket === undefined) {
            bucket = new Set<string>();
            modeCompletions.set(mode, bucket);
        }
        bucket.add(text);
    }

    // Helper: check global dedup across all mode buckets.
    function hasCompletion(text: string): boolean {
        for (const bucket of modeCompletions.values()) {
            if (bucket.has(text)) return true;
        }
        return false;
    }

    for (const c of fixedCandidates) {
        if (c.isAfterWildcard) {
            anyAfterWildcard = true;
        } else if (c.kind === "string") {
            hasNonWildcardCompletion = true;
        }
        if (c.partialKeywordBackup) {
            partialKeywordBackup = true;
        }
        if (c.kind === "string") {
            addCompletion(
                c.completionText,
                spacingModeToSeparatorMode(c.spacingMode),
            );
        } else {
            const completionProperty = getGrammarCompletionProperty(
                c.state,
                c.valueId,
                c.spacingMode,
            );
            if (completionProperty !== undefined) {
                properties.push(completionProperty);
                closedSet = false;
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
    //  (a) the position is definite (!anyAfterWildcard) — no wildcard
    //      boundary ambiguity; forward re-parsing would land at
    //      the same position, or
    //  (b) the position is anchored by a partial keyword
    //      (partialKeywordBackup) — the keyword fragment pins the
    //      position even though a wildcard boundary is open.
    //
    // Invariant: partialKeywordBackup implies anyAfterWildcard.
    const rangeCandidateGateOpen = !anyAfterWildcard || partialKeywordBackup;
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
                    !hasCompletion(partial.remainingText)
                ) {
                    addCompletion(
                        partial.remainingText,
                        spacingModeToSeparatorMode(c.spacingMode),
                    );
                    anyAfterWildcard = true;
                }
            } else {
                const completionProperty = getGrammarCompletionProperty(
                    c.state,
                    c.valueId,
                    c.spacingMode,
                );
                if (completionProperty !== undefined) {
                    properties.push(completionProperty);
                    anyAfterWildcard = true;
                    closedSet = false;
                }
            }
        }
    }

    // See the directionSensitive field comment on
    // GrammarCompletionResult for why P > 0 is correct.
    // minPrefixLength (caller-supplied search lower bound) is
    // not consulted — it constrains the search, not the result.
    const directionSensitive = ctx.maxPrefixLength > 0;

    // Combine the two accumulation booleans into the output
    // tri-state.  Order-independent: each boolean was set by
    // any candidate that matched its condition.
    const afterWildcard: AfterWildcard = !anyAfterWildcard
        ? "none"
        : hasNonWildcardCompletion
          ? "some"
          : "all";

    // Build per-mode groups.
    const groups: GrammarCompletionGroup[] = [];
    for (const [mode, bucket] of modeCompletions) {
        groups.push({
            completions: [...bucket],
            separatorMode: mode,
        });
    }

    return {
        groups,
        properties,
        matchedPrefixLength: ctx.maxPrefixLength,
        closedSet,
        directionSensitive,
        afterWildcard,
    };
}

// Alias for `GrammarMatchOptions` from `grammarMatcher`.  Re-exported
// here so completion callers don't need to reach across modules for
// what is structurally the same option set, but kept as a distinct
// type alias so the two surfaces can diverge without churning
// callers.  Use this when a partial match against the full input is
// sufficient and the caller does not need ambiguous wildcard
// placements enumerated.
export type GrammarCompletionOptions = GrammarMatchOptions;

export function matchGrammarCompletion(
    grammar: Grammar,
    input: string,
    minPrefixLength?: number,
    direction?: "forward" | "backward",
    options?: GrammarCompletionOptions,
): GrammarCompletionResult {
    debugCompletion(
        `Start completion for input ${direction ?? "forward"}: "${input}"`,
    );

    // Phase 1 (collect)
    const ctx = collectCandidates(
        grammar,
        input,
        minPrefixLength,
        direction,
        options,
    );
    // Phase 2 (finalize): wildcard anchors, shadows, EOI
    finalizeCandidates(ctx);
    // Phase 3 (materialize): convert candidates to final completions/properties
    const result = materializeCandidates(ctx);

    debugCompletion(`Completed. ${JSON.stringify(result)}`);
    return result;
}
