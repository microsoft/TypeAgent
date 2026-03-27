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

// When `index` is followed only by separator characters (whitespace /
// punctuation) until end-of-string, return `text.length` so that the
// trailing separators are included in the consumed prefix.  Otherwise
// return `index` unchanged.
//
// This makes completion trailing-space-sensitive: "play music " reports
// matchedPrefixLength=11 (including the space) instead of 10.  The
// dispatcher no longer strips trailing whitespace, so the grammar must
// include it when the user has already typed it.
function consumeTrailingSeparators(text: string, index: number): number {
    if (index >= text.length) {
        return index;
    }
    return nextNonSeparatorIndex(text, index) >= text.length
        ? text.length
        : index;
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
    prefix: string,
    startIndex: number,
    words: string[],
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const { matchedWords, endIndex } = matchWordsGreedily(
        words,
        prefix,
        startIndex,
        spacingMode,
    );

    // All words matched fully — not a partial match.
    if (matchedWords >= words.length) return undefined;

    // Consumed to end of prefix with more words remaining.
    if (matchedWords > 0 && endIndex === prefix.length) {
        return {
            position: prefix.length,
            completionWord: words[matchedWords],
        };
    }

    // Check if remaining text is a partial prefix of the next word.
    const word = words[matchedWords];
    let textToCheck = prefix.slice(endIndex);
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

    if (
        textToCheck.length > 0 &&
        textToCheck.length < word.length &&
        word.toLowerCase().startsWith(textToCheck.toLowerCase())
    ) {
        return {
            position: prefix.length - textToCheck.length,
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
// Used in both directions:
//   - Forward Category 2: determines the Phase B anchor position for
//     deferred wildcard-at-EOI candidates (see forwardPartialKeyword).
//   - Backward Category 2: offers the keyword at the partial keyword
//     position instead of backing up to the wildcard start.
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
    prefix: string,
    wildcardStart: number,
    part: StringPart,
    spacingMode: CompiledSpacingMode,
): { position: number; completionWord: string } | undefined {
    const sepCharRe = /[\s\p{P}]/u;
    const minStart = wildcardStart + 1;

    // Scan candidate start positions from right to left.
    for (
        let candidateStart = prefix.length - 1;
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
            !sepCharRe.test(prefix[candidateStart - 1]) &&
            requiresSeparator(
                prefix[candidateStart - 1],
                part.value[0][0],
                spacingMode,
            )
        ) {
            continue;
        }

        const result = matchKeywordWordsFrom(
            prefix,
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
                prefix,
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
    // True when the result would differ if queried with the opposite
    // direction.  When false, the caller can skip re-fetching on
    // direction change.
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
    prefix: string,
    startIndex: number,
    spacingMode: CompiledSpacingMode,
    direction?: "forward" | "backward",
):
    | {
          consumedLength: number;
          remainingText: string;
          directionSensitive: boolean;
      }
    | undefined {
    const words = part.value;
    const { matchedWords, endIndex, prevEndIndex } = matchWordsGreedily(
        words,
        prefix,
        startIndex,
        spacingMode,
    );

    // Direction matters when at least one word fully matched and no
    // trailing separator commits the last matched word.
    const couldBackUp =
        matchedWords > 0 &&
        (spacingMode === "none" ||
            nextNonSeparatorIndex(prefix, endIndex) === endIndex);

    if (direction === "backward" && couldBackUp) {
        return {
            consumedLength: prevEndIndex,
            remainingText: words[matchedWords - 1],
            directionSensitive: true,
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
        directionSensitive: couldBackUp,
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
 *    No completion is needed, but `maxPrefixLength` is updated to
 *    the full input length so that completion candidates from shorter
 *    partial matches are eagerly discarded (via `updateMaxPrefixLength`).
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
 *    input to end-of-string, forward string-part candidates are *not*
 *    processed inline.  Instead they are saved to `forwardEoiCandidates`
 *    and instantiated in Phase B at the appropriate anchor position
 *    (partial keyword position or `prefix.length`).  This prevents
 *    wildcard-at-EOI states from pushing `maxPrefixLength` past
 *    more-meaningful candidates.  See the Phase B EOI block.
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
          needsSep: boolean;
          spacingMode: CompiledSpacingMode;
          openWildcard: boolean;
          partialKeywordBackup: boolean;
          partialKeywordBackupAgreesWithForward: boolean;
      }
    | {
          kind: "property";
          valueId: number;
          state: MatchState;
          needsSep: boolean;
          spacingMode: CompiledSpacingMode;
          openWildcard: boolean;
          partialKeywordBackup: boolean;
          partialKeywordBackupAgreesWithForward: boolean;
      };

type RangeCandidate =
    | {
          kind: "wildcardString";
          wildcardStart: number;
          nextPart: StringPart;
          spacingMode: CompiledSpacingMode;
      }
    | {
          kind: "wildcardProperty";
          wildcardStart: number;
          valueId: number;
          state: MatchState;
          spacingMode: CompiledSpacingMode;
      };
// Forward partial keyword anchor: when
// findPartialKeywordInWildcard finds a partial keyword at
// position P < state.index inside a wildcard-at-EOI state,
// the result is saved here.  Phase B uses position to anchor
// and completionWord to emit the completion (tryPartialStringMatch
// at the anchor position cannot reproduce multi-word keyword
// results — e.g. for keyword ["played","by"], the partial
// keyword "by" is found at position 18 from candidateStart=11,
// but tryPartialStringMatch at 18 returns "played" instead).
type ForwardPartialKeywordCandidate = {
    position: number;
    completionWord: string;
    spacingMode: CompiledSpacingMode;
};

// Callers pass either a literal char ("a" for property candidates) or
// completionText[0] from tryPartialStringMatch, which always returns
// non-empty grammar words.  firstCompletionChar is therefore always
// a single character.
function computeNeedsSep(
    prefix: string,
    position: number,
    firstCompletionChar: string,
    spacingMode: CompiledSpacingMode,
): boolean {
    return (
        position > 0 &&
        spacingMode !== "none" &&
        requiresSeparator(
            prefix[position - 1],
            firstCompletionChar,
            spacingMode,
        )
    );
}

export function matchGrammarCompletion(
    grammar: Grammar,
    prefix: string,
    minPrefixLength?: number,
    direction?: "forward" | "backward",
): GrammarCompletionResult {
    debugCompletion(
        `Start completion for prefix ${direction ?? "forward"}: "${prefix}"`,
    );

    // Seed the work-list with one MatchState per top-level grammar rule.
    // matchState may push additional states (for nested rules, optional
    // parts, wildcard extensions, repeat groups) during processing.
    const pending = initialMatchState(grammar);

    // --- Two-Phase "Collect then Convert" Architecture ---
    //
    // The main loop (Phase A) collects lightweight candidate
    // descriptors (FixedCandidate / RangeCandidate, defined at
    // module scope) rather than immediately emitting final completion
    // strings and property objects.  A post-loop Phase B converts
    // surviving candidates into the output arrays.
    //
    // This decouples candidate *discovery* (which rule matched, at
    // what position) from candidate *materialization* (building the
    // GrammarCompletionProperty, computing separatorMode).  The split
    // is essential for backward completion: the main loop evaluates
    // every rule at the full prefix length, but the final completion
    // position (maxPrefixLength) is only known after ALL rules have
    // been processed.  Range candidates exploit this — they defer
    // the "where does the wildcard end?" decision until Phase B,
    // when maxPrefixLength is settled.
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
    // Phase B also handles:
    //  • Forward EOI candidate instantiation at the appropriate
    //    anchor (partial keyword position or prefix.length).
    //  • Global string deduplication via Set.
    //  • Range candidate gating (only under retrigger conditions).
    //  • Trailing-separator advancement (forward only).
    //  • directionSensitive recomputation for backed-up positions.
    const fixedCandidates: FixedCandidate[] = [];
    const rangeCandidates: RangeCandidate[] = [];
    // Forward partial keyword: see ForwardPartialKeywordCandidate.
    let forwardPartialKeyword: ForwardPartialKeywordCandidate | undefined;
    // Forward EOI candidates: when a wildcard absorbed all input
    // (state.index >= prefix.length) and the next part is a string,
    // the candidate is deferred here instead of being processed
    // inline.  States where findPartialKeywordInWildcard found a
    // partial keyword are NOT added here (tryPartialStringMatch
    // at the anchor can't reproduce multi-word results); only
    // the anchor position is saved in forwardPartialKeyword.
    //
    // This is part of a uniform rule: wildcard consumed to EOI =
    // ambiguous boundary = defer.  Category 1 exact matches with
    // EOI wildcards are also deferred (via forwardEoiExactMatch)
    // for the same reason.
    //
    // Phase B fires when this array is non-empty OR
    // forwardPartialKeyword is set OR forwardEoiExactMatch is
    // true, and instantiates candidates at the appropriate anchor:
    //   - partial keyword position (if one exists)
    //   - prefix.length (otherwise)
    const forwardEoiCandidates: RangeCandidate[] = [];
    // True when a Category 1 exact match consumed to EOI via a
    // wildcard.  Deferred like forwardEoiCandidates: the wildcard
    // boundary is ambiguous, so Phase B decides the final anchor.
    let forwardEoiExactMatch = false;

    // Track the furthest point the grammar consumed across all
    // states (including exact matches).  This tells the caller where
    // the "filter text" begins so it doesn't have to guess from
    // whitespace (which breaks for CJK and other non-space scripts).
    let maxPrefixLength = minPrefixLength ?? 0;

    // Whether direction influenced the accumulated results.  Reset
    // whenever maxPrefixLength advances (old candidates discarded).
    let directionSensitive = false;

    // Whether backward actually collected a backed-up candidate (via
    // collectBackwardCandidate or findPartialKeywordInWildcard).  When
    // false, backward fell through to forward behavior — range
    // candidate processing, the trailing-separator-advancement guard,
    // and the directionSensitive override are all skipped so the
    // result is identical to forward.
    //
    // Invariant: these three post-loop behaviors always coincide
    // because they all depend on the same condition — backward
    // produced a backed-up position different from forward.  When
    // backward falls through (no backup), the result must be
    // identical to forward, so none of the three should fire.
    let backwardEmitted = false;

    // Helper: update maxPrefixLength.  When it increases, all previously
    // accumulated fixed-point candidates from shorter matches are
    // irrelevant — clear them.  Range candidates are NOT cleared
    // because their valid position is a range that may include the
    // new maxPrefixLength.
    function updateMaxPrefixLength(prefixLength: number): void {
        if (prefixLength > maxPrefixLength) {
            maxPrefixLength = prefixLength;
            fixedCandidates.length = 0;
            directionSensitive = false;
        }
    }

    // Helper: collect a property completion candidate at a given
    // prefix position.  Updates maxPrefixLength; skips if position
    // is below max.  The candidate is converted to a final
    // GrammarCompletionProperty in Phase B.
    function collectPropertyCandidate(
        state: MatchState,
        valueId: number,
        prefixPosition: number,
        candidateOpenWildcard: boolean = false,
    ): void {
        updateMaxPrefixLength(prefixPosition);
        if (prefixPosition !== maxPrefixLength) return;
        const candidateNeedsSep = computeNeedsSep(
            prefix,
            prefixPosition,
            "a",
            state.spacingMode,
        );
        fixedCandidates.push({
            kind: "property",
            valueId,
            state: { ...state },
            needsSep: candidateNeedsSep,
            spacingMode: state.spacingMode,
            openWildcard: candidateOpenWildcard,
            partialKeywordBackup: false,
            partialKeywordBackupAgreesWithForward: false,
        });
    }

    // Helper: collect a literal string completion candidate at a
    // given prefix position.  Updates maxPrefixLength; skips if
    // position is below max.  Converted in Phase B.
    function collectStringCandidate(
        state: MatchState,
        candidatePrefixLength: number,
        completionText: string,
        candidateOpenWildcard: boolean = false,
        candidatePartialKeywordBackup: boolean = false,
        candidatePartialKeywordBackupAgreesWithForward: boolean = false,
    ): void {
        updateMaxPrefixLength(candidatePrefixLength);
        if (candidatePrefixLength !== maxPrefixLength) return;
        const candidateNeedsSep = computeNeedsSep(
            prefix,
            candidatePrefixLength,
            completionText[0],
            state.spacingMode,
        );
        fixedCandidates.push({
            kind: "string",
            completionText,
            needsSep: candidateNeedsSep,
            spacingMode: state.spacingMode,
            openWildcard: candidateOpenWildcard,
            partialKeywordBackup: candidatePartialKeywordBackup,
            partialKeywordBackupAgreesWithForward:
                candidatePartialKeywordBackupAgreesWithForward,
        });
    }

    // Helper: backward completion — back up to the last matched item
    // (wildcard, literal word, or number).  If a wildcard was captured
    // after the last matched part, prefer it; otherwise back up to
    // the last matched part via tryPartialStringMatch (for strings)
    // or collectPropertyCandidate (for numbers).
    //
    // Tags the candidate with openWildcard when backing up to a part
    // that was matched after a captured wildcard (afterWildcard) —
    // that position is ambiguous because the wildcard could extend.
    function collectBackwardCandidate(
        state: MatchState,
        savedWildcard: PendingWildcard | undefined,
    ): void {
        const wildcardStart = savedWildcard?.start;
        const partStart = state.lastMatchedPartInfo?.start;
        if (
            savedWildcard !== undefined &&
            savedWildcard.valueId !== undefined &&
            (partStart === undefined ||
                (wildcardStart !== undefined && wildcardStart >= partStart))
        ) {
            collectPropertyCandidate(
                state,
                savedWildcard.valueId,
                savedWildcard.start,
            );
            backwardEmitted = true;
        } else if (state.lastMatchedPartInfo !== undefined) {
            const info = state.lastMatchedPartInfo;
            if (info.type === "string") {
                const backResult = tryPartialStringMatch(
                    info.part,
                    prefix,
                    info.start,
                    state.spacingMode,
                    "backward",
                );
                if (backResult !== undefined) {
                    collectStringCandidate(
                        state,
                        backResult.consumedLength,
                        backResult.remainingText,
                        info.afterWildcard,
                    );
                    backwardEmitted = true;
                } else {
                    updateMaxPrefixLength(state.index);
                }
            } else {
                // Number part — offer property completion for the
                // number slot so the user can re-enter a value.
                collectPropertyCandidate(
                    state,
                    info.valueId,
                    info.start,
                    info.afterWildcard,
                );
                backwardEmitted = true;
            }
        }
    }

    // --- Main loop: process every pending state ---
    while (pending.length > 0) {
        const state = pending.pop()!;

        // Attempt to greedily match as many grammar parts as possible
        // against the prefix.  `matched` is true only when ALL parts in
        // the rule (including nested rules) were satisfied.  matchState
        // may also push new derivative states onto `pending` (e.g. for
        // alternative nested rules, optional-skip paths, wildcard
        // extensions, repeat iterations).
        const matched = matchState(state, prefix, pending);

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
        if (finalizeState(state, prefix)) {
            // Would backward produce different results than forward?
            // True when the prefix was fully consumed and there is a
            // matched part (string/number) or wildcard to back up to.
            const hasPartToReconsider =
                state.index >= prefix.length &&
                (savedPendingWildcard?.valueId !== undefined ||
                    state.lastMatchedPartInfo !== undefined);

            // --- Category 1: Exact match ---
            // All parts matched AND prefix was fully consumed.
            if (matched) {
                if (direction === "backward" && hasPartToReconsider) {
                    collectBackwardCandidate(
                        preFinalizeState ?? state,
                        savedPendingWildcard,
                    );
                } else if (
                    direction !== "backward" &&
                    savedPendingWildcard?.valueId !== undefined &&
                    state.index >= prefix.length
                ) {
                    // Wildcard consumed to EOI — defer instead of
                    // pushing maxPrefixLength inline.  Phase B will
                    // decide the final anchor.
                    debugCompletion("Matched (EOI wildcard). Deferring.");
                    forwardEoiExactMatch = true;
                } else {
                    debugCompletion("Matched. Nothing to complete.");
                    updateMaxPrefixLength(state.index);
                }
                if (hasPartToReconsider) {
                    directionSensitive = true;
                }
                continue;
            }

            // --- Category 2: Partial match (clean finalization) ---
            // matchState stopped at state.partIndex because it couldn't
            // match the next part against the (exhausted) prefix.
            // That next part is what we offer as a completion.
            const nextPart = state.parts[state.partIndex];

            // Track whether findPartialKeywordInWildcard produced a
            // result that forward would also use (position strictly
            // inside the wildcard, i.e. < state.index).  When both
            // directions agree, the state is not direction-sensitive.
            // When the partial keyword position equals state.index
            // (the wildcard absorbed a complete first keyword word),
            // forward would NOT use it (tryPartialStringMatch gives
            // the first keyword word instead), so the directions
            // differ and it IS direction-sensitive.
            let partialKeywordAgreesWithForward = false;

            if (direction === "backward" && hasPartToReconsider) {
                // When a wildcard absorbed text ending with a partial
                // keyword prefix (e.g. "Never b" where "b" prefixes
                // "by"), offer the keyword at the partial keyword
                // position instead of backing up to the wildcard start.
                // The partial keyword position has a higher
                // matchedPrefixLength and is more useful to the user.
                let partialKeywordForThisState = false;
                if (
                    savedPendingWildcard?.valueId !== undefined &&
                    nextPart.type === "string"
                ) {
                    const partialResult = findPartialKeywordInWildcard(
                        prefix,
                        savedPendingWildcard.start,
                        nextPart,
                        state.spacingMode,
                    );
                    if (partialResult !== undefined) {
                        collectStringCandidate(
                            state,
                            partialResult.position,
                            partialResult.completionWord,
                            true,
                            true,
                            partialResult.position < state.index,
                        );
                        backwardEmitted = true;
                        partialKeywordForThisState = true;
                        if (partialResult.position < state.index) {
                            partialKeywordAgreesWithForward = true;
                        }
                    } else {
                        collectBackwardCandidate(
                            preFinalizeState ?? state,
                            savedPendingWildcard,
                        );
                    }
                } else {
                    collectBackwardCandidate(
                        preFinalizeState ?? state,
                        savedPendingWildcard,
                    );
                }
                // Save a range candidate for the wildcard-nextPart
                // split — the wildcard end is flexible and may match
                // the final maxPrefixLength determined by other rules.
                // Skip only for the state where
                // findPartialKeywordInWildcard already found the
                // optimal position — other alternatives still need
                // their range candidates so Phase B can contribute
                // their keywords at the settled maxPrefixLength.
                if (
                    savedPendingWildcard?.valueId !== undefined &&
                    !partialKeywordForThisState
                ) {
                    if (nextPart.type === "string") {
                        rangeCandidates.push({
                            kind: "wildcardString",
                            wildcardStart: savedPendingWildcard.start,
                            nextPart,
                            spacingMode: state.spacingMode,
                        });
                    } else if (
                        nextPart.type === "wildcard" ||
                        nextPart.type === "number"
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
                }
                // When findPartialKeywordInWildcard resolved this
                // state AND the result backs up into the wildcard
                // (position < state.index), forward would also
                // find the same result.  Skip directionSensitive.
                if (!partialKeywordAgreesWithForward) {
                    directionSensitive = true;
                }
            } else {
                debugCompletion(
                    `Completing ${nextPart.type} part ${state.name}`,
                );
                if (nextPart.type === "string") {
                    if (
                        savedPendingWildcard?.valueId !== undefined &&
                        state.index >= prefix.length
                    ) {
                        // Wildcard absorbed all input to EOI.
                        // Check for a partial keyword to determine
                        // the Phase B anchor, then defer.
                        const partialResult = findPartialKeywordInWildcard(
                            prefix,
                            savedPendingWildcard.start,
                            nextPart,
                            state.spacingMode,
                        );
                        let partialKeywordForThisState = false;
                        if (
                            partialResult !== undefined &&
                            partialResult.position < state.index
                        ) {
                            if (
                                forwardPartialKeyword === undefined ||
                                partialResult.position >
                                    forwardPartialKeyword.position
                            ) {
                                forwardPartialKeyword = {
                                    position: partialResult.position,
                                    completionWord:
                                        partialResult.completionWord,
                                    spacingMode: state.spacingMode,
                                };
                            }
                            partialKeywordAgreesWithForward = true;
                            partialKeywordForThisState = true;
                        }
                        // Defer to Phase B.  Skip when
                        // findPartialKeywordInWildcard resolved
                        // this state — Phase B adds the correct
                        // multi-word completionWord explicitly;
                        // tryPartialStringMatch at the anchor
                        // can't reproduce it.
                        if (!partialKeywordForThisState) {
                            forwardEoiCandidates.push({
                                kind: "wildcardString",
                                wildcardStart: savedPendingWildcard.start,
                                nextPart,
                                spacingMode: state.spacingMode,
                            });
                        }
                    } else {
                        const partial = tryPartialStringMatch(
                            nextPart,
                            prefix,
                            state.index,
                            state.spacingMode,
                            direction,
                        );
                        if (partial !== undefined) {
                            collectStringCandidate(
                                state,
                                partial.consumedLength,
                                partial.remainingText,
                                savedPendingWildcard?.valueId !== undefined,
                            );
                            if (partial.directionSensitive) {
                                directionSensitive = true;
                                if (direction === "backward") {
                                    backwardEmitted = true;
                                }
                            }
                        }
                    }
                } else {
                    debugCompletion(
                        `No completion for ${nextPart.type} part (handled by Category 3a or matchState expansion)`,
                    );
                }
                if (hasPartToReconsider && !partialKeywordAgreesWithForward) {
                    directionSensitive = true;
                }
            }
            // Note: non-string next parts (wildcard, number, rules) in
            // Category 2 don't produce completions here — wildcards are
            // handled by Category 3a (pending wildcard) and nested rules
            // are expanded by matchState into separate pending states.
        } else {
            // --- Category 3: finalizeState failed ---
            // Either (a) a pending wildcard couldn't capture meaningful
            // content, or (b) trailing non-separator text remains that
            // didn't match any grammar part.
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
                        state.index >= prefix.length);
                if (direction === "backward" && canReconsider3a) {
                    // Backward: back up to the last matched keyword
                    // instead of offering property completion for the
                    // unfilled wildcard — the user hasn't started
                    // typing into the unfilled slot yet.
                    collectBackwardCandidate(state, undefined);
                } else {
                    // Forward (or backward with nothing to
                    // reconsider): report a property completion
                    // describing the wildcard's type so the caller can
                    // provide entity-specific suggestions.
                    debugCompletion("Completing wildcard part");
                    collectPropertyCandidate(
                        state,
                        pendingWildcard.valueId,
                        pendingWildcard.start,
                    );
                }
                if (canReconsider3a) {
                    directionSensitive = true;
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
                if (
                    currentPart !== undefined &&
                    currentPart.type === "string"
                ) {
                    const partial = tryPartialStringMatch(
                        currentPart,
                        prefix,
                        state.index,
                        state.spacingMode,
                        direction,
                    );
                    if (partial !== undefined) {
                        collectStringCandidate(
                            state,
                            partial.consumedLength,
                            partial.remainingText,
                        );
                        if (partial.directionSensitive) {
                            directionSensitive = true;
                            if (direction === "backward") {
                                backwardEmitted = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Phase B: Convert candidates to final completions/properties ---
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
    let partialKeywordBackupAgreesWithForward = false;

    for (const c of fixedCandidates) {
        if (c.openWildcard) {
            openWildcard = true;
        }
        if (c.partialKeywordBackup) {
            partialKeywordBackup = true;
        }
        if (c.partialKeywordBackupAgreesWithForward) {
            partialKeywordBackupAgreesWithForward = true;
        }
        if (c.kind === "string") {
            completions.add(c.completionText);
            separatorMode = mergeSeparatorMode(
                separatorMode,
                c.needsSep,
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
                separatorMode = mergeSeparatorMode(
                    separatorMode,
                    c.needsSep,
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
    // Gating: range candidates are processed when backward backed
    // up and trailing text remains.
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
        backwardEmitted &&
        maxPrefixLength < prefix.length &&
        rangeCandidateGateOpen;
    if (processRangeCandidates) {
        for (const c of rangeCandidates) {
            if (maxPrefixLength <= c.wildcardStart) continue;
            if (
                getWildcardStr(
                    prefix,
                    c.wildcardStart,
                    maxPrefixLength,
                    c.spacingMode,
                ) === undefined
            ) {
                continue;
            }
            if (c.kind === "wildcardString") {
                const partial = tryPartialStringMatch(
                    c.nextPart,
                    prefix,
                    maxPrefixLength,
                    c.spacingMode,
                    "forward",
                );
                if (
                    partial !== undefined &&
                    !completions.has(partial.remainingText)
                ) {
                    completions.add(partial.remainingText);
                    const candidateNeedsSep = computeNeedsSep(
                        prefix,
                        maxPrefixLength,
                        partial.remainingText[0],
                        c.spacingMode,
                    );
                    separatorMode = mergeSeparatorMode(
                        separatorMode,
                        candidateNeedsSep,
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
                    closedSet = false;
                    const candidateNeedsSep = computeNeedsSep(
                        prefix,
                        maxPrefixLength,
                        "a",
                        c.spacingMode,
                    );
                    separatorMode = mergeSeparatorMode(
                        separatorMode,
                        candidateNeedsSep,
                        c.spacingMode,
                    );
                    openWildcard = true;
                }
            }
        }
    }

    // Forward EOI candidate instantiation and partial keyword recovery.
    //
    // Wildcard-at-EOI results are uniformly deferred during Phase A
    // — both Category 2 string candidates (forwardEoiCandidates)
    // and Category 1 exact matches (forwardEoiExactMatch).  The
    // wildcard boundary is ambiguous, so Phase A never pushes
    // maxPrefixLength for them; Phase B decides the final anchor.
    //
    // Phase B operates in one of three modes:
    //
    //   Clear + anchor at partial keyword position P:
    //     findPartialKeywordInWildcard found a partial keyword at
    //     P < prefix.length.  Reset everything and anchor there.
    //
    //   Clear + anchor at prefix.length (displace):
    //     maxPrefixLength < prefix.length means only weaker
    //     candidates (e.g. Category 3b) survived Phase A.  Replace
    //     them with EOI instantiations at prefix.length.
    //
    //   Merge at prefix.length:
    //     maxPrefixLength is already at prefix.length — legitimate
    //     candidates (e.g. property completions for a wildcard slot
    //     following a matched keyword) exist at that position.
    //     Preserve them and add EOI instantiations alongside.
    const hasPartialKeyword =
        forwardPartialKeyword !== undefined &&
        forwardPartialKeyword.position < prefix.length;
    if (
        direction !== "backward" &&
        (forwardEoiCandidates.length > 0 ||
            hasPartialKeyword ||
            forwardEoiExactMatch)
    ) {
        const anchor = hasPartialKeyword
            ? forwardPartialKeyword!.position
            : prefix.length;

        // Clear when the anchor differs from the current
        // maxPrefixLength (partial keyword recovery or displacing
        // weaker candidates).  When the anchor matches
        // maxPrefixLength (already at prefix.length), merge by
        // keeping existing candidates.
        if (anchor !== maxPrefixLength) {
            completions.clear();
            properties.length = 0;
            maxPrefixLength = anchor;
            closedSet = true;
            separatorMode = undefined;
            openWildcard = false;
            // At the partial keyword anchor both directions agree.
            // When displacing to prefix.length the wildcard can be
            // reconsidered → directions differ.
            directionSensitive = !hasPartialKeyword;
        }

        // Wildcard boundary is ambiguous only when Phase B is
        // actually instantiating candidates (partial keyword or
        // deferred EOI candidates).  A pure exact-match deferral
        // (forwardEoiExactMatch only) produces no candidates, so
        // the position is definite.
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
            const fpkNeedsSep = computeNeedsSep(
                prefix,
                anchor,
                fpk.completionWord[0],
                fpk.spacingMode,
            );
            separatorMode = mergeSeparatorMode(
                separatorMode,
                fpkNeedsSep,
                fpk.spacingMode,
            );
        }

        // Instantiate deferred EOI candidates at the anchor.
        for (const c of forwardEoiCandidates) {
            if (c.kind !== "wildcardString") continue;
            if (anchor <= c.wildcardStart) continue;
            if (
                getWildcardStr(
                    prefix,
                    c.wildcardStart,
                    anchor,
                    c.spacingMode,
                ) === undefined
            ) {
                continue;
            }
            const partial = tryPartialStringMatch(
                c.nextPart,
                prefix,
                anchor,
                c.spacingMode,
                "forward",
            );
            if (
                partial !== undefined &&
                !completions.has(partial.remainingText)
            ) {
                completions.add(partial.remainingText);
                const candidateNeedsSep = computeNeedsSep(
                    prefix,
                    anchor,
                    partial.remainingText[0],
                    c.spacingMode,
                );
                separatorMode = mergeSeparatorMode(
                    separatorMode,
                    candidateNeedsSep,
                    c.spacingMode,
                );
            }
        }
    }

    // Advance past trailing separators so the reported prefix length
    // includes any trailing whitespace the user typed.  This makes
    // completion trailing-space-sensitive: "play music " reports
    // matchedPrefixLength=11 (with the space) rather than 10.
    //
    // When advancing, demote separatorMode to "optional" — the
    // trailing space is already consumed, so no additional separator
    // is required between the anchor and the completion text.
    //
    // Skip advancement when backward backed up (backwardEmitted):
    // the backed-up position P is where backward intentionally wants
    // completions to anchor.  Advancing P past trailing separators
    // would move the anchor forward, defeating the backup.
    if (!backwardEmitted) {
        const advanced = consumeTrailingSeparators(prefix, maxPrefixLength);
        if (advanced > maxPrefixLength) {
            maxPrefixLength = advanced;
            separatorMode = "optional";
        }
    }

    // Recompute directionSensitive for the backed-up case.
    //
    // During the main loop, directionSensitive is accumulated at
    // the *full* prefix length — but when backward backed up, the
    // effective completion position is maxPrefixLength (< prefix.
    // length), and directionSensitive must reflect THAT position.
    //
    // At P > 0 at least one keyword was matched before the
    // completion point, so hasPartToReconsider is true in a
    // forward pass at P → directionSensitive.  At P = 0 nothing
    // was matched → not direction-sensitive.
    //
    // Guard: if minPrefixLength filtered out all candidates, the
    // result is empty regardless of direction → not sensitive.
    //
    // Skip when partialKeywordBackupAgreesWithForward: both
    // directions used findPartialKeywordInWildcard and produced the
    // same result, so the per-state directionSensitive (already
    // computed in the main loop) is correct — don't override it.
    if (
        direction === "backward" &&
        backwardEmitted &&
        maxPrefixLength < prefix.length &&
        !partialKeywordBackupAgreesWithForward
    ) {
        directionSensitive =
            maxPrefixLength > 0 &&
            (completions.size > 0 || properties.length > 0);
    }

    // When a partial keyword backup agrees with forward AND range
    // candidates contributed additional completions at the same
    // position, the forward path also anchored those competing
    // candidates at the partial keyword position (via the forward
    // EOI candidate instantiation in Phase B).  Both directions
    // produced the same set at the same anchor → not
    // direction-sensitive.
    //
    // Without this, per-state directionSensitive=true from the
    // backward collectBackwardCandidate path survives the post-loop
    // recomputation (which is skipped when
    // partialKeywordBackupAgreesWithForward) and incorrectly claims
    // the directions differ.
    if (
        direction === "backward" &&
        partialKeywordBackupAgreesWithForward &&
        processRangeCandidates
    ) {
        directionSensitive = false;
    }

    const result: GrammarCompletionResult = {
        completions: [...completions],
        properties,
        matchedPrefixLength: maxPrefixLength,
        separatorMode,
        closedSet,
        directionSensitive,
        openWildcard,
    };
    debugCompletion(`Completed. ${JSON.stringify(result)}`);
    return result;
}
