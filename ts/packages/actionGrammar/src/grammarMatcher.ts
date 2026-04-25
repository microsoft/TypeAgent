// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CompiledSpacingMode, CompiledValueNode } from "./grammarTypes.js";
import { evaluateValueExpr } from "./grammarValueExprEvaluator.js";
import registerDebug from "debug";
// REVIEW: switch to RegExp.escape() when it becomes available.
import escapeMatch from "regexp.escape";
import {
    Grammar,
    GrammarPart,
    GrammarRule,
    RulesPart,
    StringPart,
    StringPartRegExpEntry,
    VarNumberPart,
    VarStringPart,
} from "./grammarTypes.js";

// Separator mode for completion results.  Structurally identical to
// SeparatorMode from @typeagent/agent-sdk (command.ts); independently
// defined here so actionGrammar does not depend on agentSdk.  Keep
// both definitions in sync.
export type SeparatorMode =
    | "space"
    | "spacePunctuation"
    | "optionalSpacePunctuation"
    | "optionalSpace"
    | "none"
    | "autoSpacePunctuation";

const debugMatchRaw = registerDebug("typeagent:grammar:match");

// Treats spaces and punctuation as word separators
export const separatorRegExpStr = "\\s\\p{P}";
const separatorRegExp = new RegExp(`[${separatorRegExpStr}]+`, "yu");
const wildcardTrimRegExp = new RegExp(
    `[${separatorRegExpStr}]*([^${separatorRegExpStr}](?:.*[^${separatorRegExpStr}])?)[${separatorRegExpStr}]*$`,
    "yu",
);

// Scripts that use explicit word-space boundaries (Latin, Cyrillic, Greek,
// Armenian, Georgian, Hangul, Arabic, Hebrew, Devanagari, Bengali, Tamil,
// Telugu, Kannada, Malayalam, Gujarati, Gurmukhi, Oriya, Sinhala, Ethiopic,
// Mongolian). In "auto" mode, a separator is required between two adjacent
// characters only when BOTH belong to one of these scripts. Unknown/unlisted
// scripts (e.g. CJK) default to no separator needed.
const wordBoundaryScriptRe =
    /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Armenian}|\p{Script=Georgian}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Tamil}|\p{Script=Telugu}|\p{Script=Kannada}|\p{Script=Malayalam}|\p{Script=Gujarati}|\p{Script=Gurmukhi}|\p{Script=Oriya}|\p{Script=Sinhala}|\p{Script=Ethiopic}|\p{Script=Mongolian}/u;

// Decimal digits are not part of any word-space script, but two adjacent
// digit characters must still be separated: "123456" is a different token from
// "123 456", so concatenating two digit segments without a separator is ambiguous.
const digitRe = /[0-9]/;

// In auto mode (undefined), a separator is required between two segments only
// if both adjacent characters belong to a word-boundary script. This allows users
// to omit separators when the scripts differ (e.g. Latin followed by CJK),
// while still requiring them when both sides use word spaces
// (e.g. Latin followed by Latin).
function isWordBoundaryScript(c: string): boolean {
    // Fast path: all ASCII characters are handled here without the regex.
    // ASCII letters are Latin-script (boundary required).
    // ASCII digits, punctuation, and space return false
    // (digits are handled separately by digitRe, punctuation/space never need a boundary).
    const code = c.charCodeAt(0);
    if (code < 128) {
        return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // A-Z, a-z
    }
    return wordBoundaryScriptRe.test(c);
}
export function needsSeparatorInAutoMode(a: string, b: string): boolean {
    if (digitRe.test(a) && digitRe.test(b)) {
        return true;
    }
    return isWordBoundaryScript(a) && isWordBoundaryScript(b);
}
export function requiresSeparator(
    a: string,
    b: string,
    mode: CompiledSpacingMode,
): boolean {
    switch (mode) {
        case "required":
            return true;
        case "optional":
            return false;
        case "none":
            // "none" mode is handled directly by the caller (matchStringPart
            // short-circuits with an empty separator string).  If we ever
            // reach this branch it indicates a logic error.
            throw new Error(
                "Internal error: requiresSeparator should not be called for 'none' mode",
            );
        case undefined: // auto
            return needsSeparatorInAutoMode(a, b);
    }
}

export function isBoundarySatisfied(
    request: string,
    index: number,
    mode: CompiledSpacingMode,
) {
    if (index === 0 || index === request.length) {
        return true;
    }
    switch (mode) {
        case "required":
            // In "required" mode, the input at `index` must begin with a
            // separator sequence ([\s\p{P}]+).  Separators already consumed
            // *inside* the match pattern (e.g. the infix [\s\p{P}]+ between
            // tokens) do not satisfy this trailing-edge check; one or more
            // separator characters must immediately follow the entire matched
            // phrase in the input.
            separatorRegExp.lastIndex = index;
            return separatorRegExp.test(request);
        case "optional":
        case "none":
            // In both "optional" and "none" modes there is no constraint on
            // the outer boundary.  For top-level "none" rules, leading
            // whitespace is rejected (via leadingSpacingMode) and trailing
            // content is rejected (via finalizeState).  For nested rules,
            // the nearest ancestor with a flex-space boundary — or the
            // top-level rule if none — controls leading/trailing spacing
            // around the nested match (see leadingSpacingMode).  The
            // boundary check itself always passes.
            return true;
        case undefined: // auto: requires a separator only when BOTH characters
            // adjacent to the boundary belong to word-boundary scripts.  If
            // either side is punctuation, CJK, or another no-space script, no
            // separator is required.
            return !needsSeparatorInAutoMode(
                request[index - 1],
                request[index],
            );
    }
}

type MatchedValue =
    | string
    | number
    | undefined
    // Value from nested rule
    | {
          node: CompiledValueNode | undefined;
          valueIds: ValueIdNode | undefined;
      };

type MatchedValueEntry = {
    valueId: number;
    value: MatchedValue;
    wildcard: boolean;
    prev: MatchedValueEntry | undefined;
};

type ValueIdNode = {
    name?: string | undefined;
    valueId: number;
    wildcardTypeName?: string | undefined;
    prev?: ValueIdNode | undefined;
};

type ParentMatchState = {
    name: string; // For debugging
    parts: GrammarPart[];
    value: CompiledValueNode | undefined; // the value to be assigned after finishing the nested rule.
    partIndex: number; // the part index after the nested rule.
    variable: string | undefined;
    valueIds: ValueIdNode | undefined | null; // null means we don't need any value
    parent: ParentMatchState | undefined;
    repeatPartIndex?: number | undefined; // defined for ()* / )+ — holds the part index to loop back to
    spacingMode: CompiledSpacingMode; // parent rule's spacingMode, restored in MatchState on return from nested rule
};

// A wildcard slot awaiting its capture value.  Used on MatchState.pendingWildcard
// and saved across finalizeState calls for backward completion.
export type PendingWildcard = {
    readonly start: number;
    readonly valueId: number | undefined;
};

// Per-axis exploration policies.  Each policy controls how the
// matcher resolves an ambiguity along a single axis: what to do
// when more than one parse is viable at a given fork point.
//
// All three default to `"exhaustive"` so callers receive every
// valid parse.  The non-default values are first-success
// commitments — the matcher picks one branch and abandons the
// other(s) without enumerating them.

/**
 * Wildcard capture-length policy.
 *
 * Wildcards (`<name>`, `$(name)`) are inherently ambiguous: a
 * wildcard followed by a literal can absorb any prefix of the
 * remaining input that still leaves the literal matchable.  This
 * policy decides whether to enumerate every viable length or
 * commit to the shortest.
 *
 *   - `"exhaustive"` (default): emit a separate result for every
 *     viable wildcard capture length.  Callers rank the results
 *     (e.g. by `wildcardCharCount` or `matchedValueCount`).
 *   - `"shortest"`: each traversal path commits to the shortest
 *     viable wildcard capture; longer-wildcard alternatives for
 *     that path are not enumerated.  Other axes (alternation,
 *     optional, repeat) are still explored normally — only the
 *     wildcard-length axis is collapsed.
 */
export type WildcardPolicy = "exhaustive" | "shortest";

/**
 * Optional-group take-vs-skip policy for `(...)?`.
 *
 *   - `"exhaustive"` (default): try both taking and skipping the
 *     optional group; return all parses.
 *   - `"preferTake"`: try take first; if it succeeds, do not
 *     enumerate the skip alternative.  Equivalent to regex `?`.
 *   - `"preferSkip"`: try skip first; if it succeeds, do not
 *     enumerate the take alternative.  Equivalent to regex `??`.
 */
export type OptionalPolicy = "exhaustive" | "preferTake" | "preferSkip";

/**
 * Repetition-count policy for `(...)*` / `(...)+`.
 *
 *   - `"exhaustive"` (default): return all valid repetition counts.
 *   - `"greedy"`: take the longest match first; if a parse
 *     succeeds at that count, do not enumerate shorter counts.
 *     Equivalent to regex `+`.
 *   - `"nonGreedy"`: take the shortest valid match first; if a
 *     parse succeeds at that count, do not enumerate longer
 *     counts.  Equivalent to regex `+?`.
 */
export type RepeatPolicy = "exhaustive" | "greedy" | "nonGreedy";

export type GrammarMatchOptions = {
    /** See {@link WildcardPolicy}.  Defaults to `"exhaustive"`. */
    wildcardPolicy?: WildcardPolicy;

    /** See {@link OptionalPolicy}.  Defaults to `"exhaustive"`. */
    optionalPolicy?: OptionalPolicy;

    /** See {@link RepeatPolicy}.  Defaults to `"exhaustive"`. */
    repeatPolicy?: RepeatPolicy;
};

// Origin tag carried on each Backtrack frame.  Used by
// `suppressBacktracksAfterSuccess` to apply per-axis policy
// (`wildcardPolicy` / `optionalPolicy` / `repeatPolicy`) when
// pruning unexplored siblings after a successful parse.  The tag
// does NOT affect drain order — that is purely LIFO push order.
//
// `"wildcard"` frames are pushed by `captureWildcard` to enable
// extending a wildcard capture to a strictly longer length.
// `"optional"`, `"alternation"`, and `"repeat"` frames are pushed
// at structural fork points (skip-vs-take, alternation rules,
// repeat continue-vs-stop).
//
// All four origins live on the SAME LIFO chain so a single drain
// loop services every kind of backtrack uniformly.  Within a
// single rule, a wildcard captured at part i lands BELOW any
// frames pushed by parts > i, so DFS naturally exhausts (or
// abandons) downstream alternatives before reconsidering the
// upstream wildcard length.
export type BacktrackOrigin =
    | "wildcard"
    | "optional"
    | "alternation"
    | "repeat";

// Persistent linked-list of unexplored DFS branches (most recent
// push at head).  Each frame snapshots a sibling parse path or a
// wildcard refinement point.  Restoring a frame replaces the live
// state via `Object.assign` (see `tryNextBacktrack`).
//
// This IS the explicit DFS stack: `matchState` walks parts
// left-to-right mutating the live state in place; whenever a fork
// is encountered, all-but-one branch are pushed here and
// `tryNextBacktrack` pops them in right-to-left (LIFO) order
// to backtrack.  Per-fork sibling ORDER (which branch goes live
// vs. onto the stack) is policy-controlled (see
// `optionalPolicy` / `repeatPolicy`).
//
// Single-owner invariant: only the live state may own frames;
// `PendingMatchState` omits this field.
//
// Discriminated union by `origin`:
//   - `"alternation"` frames are COMPRESSED: a single cursor frame
//     represents all N-1 sibling alternatives at one fork point.
//     Restoring the cursor overlays a per-rule override
//     (`name/parts/value/spacingMode`) onto a shared `base`
//     snapshot and advances `cursor`; the frame stays at the head
//     of the chain until all alternatives have been restored, then
//     unlinks.
//   - The other three origins (`wildcard`/`optional`/`repeat`)
//     each carry a full `SnapshotState` and unlink on restore.
// See `pushBacktrack` / `pushAlternation` / `tryNextBacktrack`.
type SingleBacktrack = {
    readonly snapshot: SnapshotState;
    readonly origin: "wildcard" | "optional" | "repeat";
    readonly prev: Backtrack | undefined;
};

// Per-alternative state at one alternation fork point is fully
// derivable from the rule itself (`parts`/`value`/`spacingMode`)
// plus a debug `name` — nothing else differs across siblings.
// The cursor frame stores a direct reference to the existing
// `GrammarRule[]` (no copy) and a single `namePrefix` string;
// `tryNextBacktrack` builds `namePrefix + "[" + cursor + "]"` and
// reads `rules[cursor].parts/value/spacingMode` lazily on restore.
// Eliminates per-alternative allocation entirely — N-way alternation
// pushes 1 frame + 1 base snapshot regardless of N.
type AlternationBacktrack = {
    readonly origin: "alternation";
    readonly base: SnapshotState;
    readonly rules: ReadonlyArray<GrammarRule>;
    readonly namePrefix: string; // debug name = `${namePrefix}[${cursor}]`
    // Mutable cursor advanced by `tryNextBacktrack` on each restore;
    // single-owner contract on the chain guarantees no other state
    // observes intermediate values.  Starts at 1 (rule 0 is the
    // live alternative); the frame unlinks once `cursor` reaches
    // `rules.length`.
    cursor: number;
    readonly prev: Backtrack | undefined;
};

type Backtrack = SingleBacktrack | AlternationBacktrack;

// Strict variant of `PendingMatchState` used as the snapshot payload
// inside `Backtrack`.  The `-?` mapped modifier forces every
// optional field to be a required own property so that
// `Object.assign` in `tryNextBacktrack` reliably resets fields
// that may have been assigned AFTER the snapshot was taken (e.g.
// `values` after the captured wildcard is committed, or `parent`
// after entering a nested rule).
//
// `captureSnapshot` returns this type, so adding a new field to
// `PendingMatchState` without listing it in `captureSnapshot` is a
// compile error.
//
// Audit points when adding a new MatchState field:
//   1. `captureSnapshot` (this file) — must list the new field;
//      this mapped type makes omitting it a compile error.
//   2. `wildcardFrameSnapshot.spec.ts` — extend coverage if the
//      field can be assigned AFTER a wildcard frame is pushed.
type SnapshotState = { [K in keyof PendingMatchState]-?: PendingMatchState[K] };

// Snapshot shape used as the payload of `Backtrack` frames
// and as the return type of `forkMatchState` / `captureSnapshot`.
// This is the base shape of a match state; the live `MatchState`
// extends it with the mutating `backtracks` chain plus the
// per-axis policy fields.
//
// Single-owner backtrack-chain invariant is enforced at the type
// level: `PendingMatchState` has no `backtracks` field, so
// snapshots cannot smuggle a parallel chain into a restored state.
// Use `forkMatchState` (returns `SnapshotState`) at every push
// site.
export type PendingMatchState = {
    // Current context
    name: string; // For debugging
    parts: GrammarPart[];
    value: CompiledValueNode | undefined; // the value to be assigned after finishing the current rule if the rule has only one part.
    partIndex: number;
    valueIds?: ValueIdNode | undefined | null; // null means we don't need any value

    // Match state
    nextValueId: number;
    values?: MatchedValueEntry | undefined;
    parent?: ParentMatchState | undefined;

    nestedLevel: number; // for debugging

    // Single-use suppression flag for the optional-fork block in
    // `matchState`.  Set on snapshots whose restore must skip the
    // optional take/skip fork for the part at `partIndex` because
    // the take/skip decision has already been made by the snapshot
    // creator (repeat-continue re-entry, or a `preferSkip` take
    // frame).  `matchState` clears it immediately after the fork
    // block, so the flag never influences a subsequent part.
    suppressOptionalFork?: boolean | undefined;

    spacingMode: CompiledSpacingMode; // active spacing mode for this rule

    index: number;
    pendingWildcard?: PendingWildcard | undefined;

    // Completion support: tracks the last matched non-wildcard part
    // (string or number).  Used by backward completion to back up to
    // the most recently matched item.
    //
    // `afterWildcard` indicates the part was matched via wildcard
    // scanning (matchStringPartWithWildcard / matchVarNumberPartWithWildcard)
    // — i.e., a wildcard preceded this part and the part's position
    // was determined by scanning forward through the wildcard region.
    // When backward backs up to such a part, the position is ambiguous
    // (see afterWildcard on GrammarCompletionResult in grammarCompletion.ts).
    lastMatchedPartInfo?:
        | {
              readonly type: "string";
              readonly start: number;
              readonly part: StringPart;
              readonly afterWildcard: boolean;
              readonly matchedSpacingMode: CompiledSpacingMode;
          }
        | {
              readonly type: "number";
              readonly start: number;
              readonly valueId: number;
              readonly afterWildcard: boolean;
              readonly matchedSpacingMode: CompiledSpacingMode;
          }
        | undefined;
};

export type MatchState = PendingMatchState & {
    // Head of the linked-list stack of resumable backtrack frames
    // (most recent first).  See `Backtrack` above.  Single
    // chain covers both wildcard refinement (origin "wildcard")
    // and structural alternatives (origin "optional" |
    // "alternation" | "repeat").
    //
    // Mutation contract: external callers that clone a MatchState
    // and expect it to remain stable across later matcher operations
    // MUST drop this field on the clone.  Use `cloneMatchState`
    // rather than spreading directly to enforce this at one site.
    //
    // Single-owner invariant: only the live state currently being
    // driven by `matchGrammar`/`matchGrammarCompletion` may own
    // frames.  States queued on a `PendingMatchState[]` work-list
    // statically cannot — enforced by the `PendingMatchState` type
    // (which omits this field).
    backtracks?: Backtrack | undefined;

    // Per-axis policies.  Set once at `initialMatchState` time and
    // never changed.  Deliberately NOT in `PendingMatchState` /
    // `SnapshotState` — `Object.assign` of a snapshot won't overwrite
    // them, so they persist across `tryNextBacktrack` restores.
    wildcardPolicy: WildcardPolicy;
    optionalPolicy: OptionalPolicy;
    repeatPolicy: RepeatPolicy;
};

// Explicit per-field copy of `state`.  Single source of truth
// shared by every backtrack-frame push site (`captureWildcard`,
// optional skip/take, alternation, repeat continue) and by the
// public `cloneMatchState`.  Returns the strict `SnapshotState`
// (every field required as an own property) so a missing field is
// a compile error — the fork/clone helpers widen back to
// `PendingMatchState`.
function captureSnapshot(state: MatchState): SnapshotState {
    return {
        name: state.name,
        parts: state.parts,
        value: state.value,
        partIndex: state.partIndex,
        valueIds: state.valueIds,
        nextValueId: state.nextValueId,
        values: state.values,
        parent: state.parent,
        nestedLevel: state.nestedLevel,
        suppressOptionalFork: state.suppressOptionalFork,
        spacingMode: state.spacingMode,
        index: state.index,
        pendingWildcard: state.pendingWildcard,
        lastMatchedPartInfo: state.lastMatchedPartInfo,
    };
}

// Clone `state` into an independent MatchState that is safe to
// retain across later matcher operations on the live state.  The
// returned clone has no `backtracks` (live-state-only and
// would be mutated by `tryNextBacktrack`); per-axis policies
// are carried over (they are runtime constants).
//
// The result is typed as `MatchState`: `backtracks` is
// optional on that type, so the clone is directly usable wherever
// a MatchState is expected (e.g. read-only inspection, or as a
// starting point for an independent matcher run).
//
// Use this for READ-ONLY views — e.g. the pre-finalize clone in
// `grammarCompletion` that must survive subsequent matcher
// mutation of the live state.  For fork sites (optional-skip,
// nested-rule alternatives, repeat continuation, wildcard
// extension) use `forkMatchState` instead — that returns a
// `SnapshotState` with no policies, suitable for restoration via
// `Object.assign` without disturbing the live state's policies.
export function cloneMatchState(state: MatchState): MatchState {
    // Single-allocation clone: drop only `backtracks` (live-state
    // mutation surface) and keep everything else — including the
    // three policy fields — by spreading once.
    const { backtracks: _backtracks, ...rest } = state;
    return rest;
}

// Fork a `state` into a sibling that is about to be pushed onto the
// `backtracks` chain.  The return type omits `backtracks`
// — only the live state retains ownership of the existing chain.
// This makes the single-owner invariant a compile-time guarantee:
// two siblings cannot independently pop the same chain.
//
// Behaviorally identical to `captureSnapshot` (and currently just
// delegates to it).  Kept as a separate name so fork sites
// (optional skip/take, alternation, repeat continue, wildcard
// extension) read as "fork a sibling" rather than "snapshot for
// internal use".  `captureSnapshot` stays private as the shared
// per-field copy primitive used by `captureWildcard`,
// `cloneMatchState`, and this function.
export function forkMatchState(state: MatchState): SnapshotState {
    return captureSnapshot(state);
}

// Push a single-snapshot backtrack frame onto the live state's chain.
//
// Used for:
//   - structural forks at degree-2 fan-outs (origin "optional" /
//     "repeat") — `alternative` is built via `forkMatchState` and
//     mutated to reflect the alternative branch's choice.
//   - wildcard refinement (origin "wildcard") — pushed by
//     `captureWildcard` to enable extending the wildcard.
//
// Alternation uses `pushAlternation` instead — see that helper.
//
// Single-owner invariant: SnapshotState omits the `backtracks`
// field, so the snapshot cannot smuggle a parallel chain in.  When
// `tryNextBacktrack` restores via `Object.assign`, the live
// state's `backtracks` is preserved (and explicitly advanced
// to `frame.prev`).
export function pushBacktrack(
    state: MatchState,
    alternative: SnapshotState,
    origin: SingleBacktrack["origin"],
) {
    state.backtracks = {
        snapshot: alternative,
        origin,
        prev: state.backtracks,
    };
}

// Push a compressed alternation cursor frame.  Replaces the
// historical pattern of pushing N-1 individual snapshots at one
// alternation fork — the live state takes rule 0, and a single
// cursor frame carries the shared `base` snapshot plus a direct
// reference to the existing `GrammarRule[]` (no per-alternative
// copy).  The debug name for `rules[i]` is built lazily as
// `${namePrefix}[${i}]` inside `tryNextBacktrack`;
// `parts`/`value`/`spacingMode` are read directly from `rules[i]`.
//
// Cursor starts at 1 (rule 0 is the live alternative) and advances
// forward through `rules.length-1`, restoring the lowest-index
// alternative first — matching the prior reverse-push order of one
// frame per rule.  Caller must ensure `rules.length > 1`.
//
// `base` MUST be captured AFTER the live state has been set up for
// rule 0 (the live alternative): every field other than the four
// per-rule fields is identical across all alternatives at one fork
// point, so reusing `base` for each restore is sound.  The shared
// linked-list heads (`values`, `valueIds`, `parent`) are immutable,
// so multiple restores from the same `base` cannot leak mutations
// between alternatives.
function pushAlternation(
    state: MatchState,
    base: SnapshotState,
    rules: ReadonlyArray<GrammarRule>,
    namePrefix: string,
) {
    state.backtracks = {
        origin: "alternation",
        base,
        rules,
        namePrefix,
        cursor: 1,
        prev: state.backtracks,
    };
}

// Pop the most-recently-pushed (rightmost / deepest in DFS order)
// unexplored sibling and restore it onto `state`, mutating in
// place via `Object.assign`.  Returns true if a frame was
// restored, false if the chain is empty.
//
// This is the backtrack step of the explicit-stack DFS: the live
// state walks parts left-to-right; when its current path fails
// (or yields a result that the caller wants more alternatives
// after), this function rewinds to the most recent unexplored
// branch and lets matching resume from there.
//
// Restoration semantics by origin:
//   - `wildcard`: the snapshot has `pendingWildcard` set;
//     re-running matchState extends the wildcard to a longer
//     capture.
//   - `optional` / `alternation` / `repeat`: the snapshot is a
//     sibling parse path at a structural fork.
//
// Callers drive enumeration with the pattern:
//
//   do {
//       const matched = matchState(state, request);
//       // ...process attempt...
//   } while (tryNextBacktrack(state));
export function tryNextBacktrack(state: MatchState): boolean {
    const frame = state.backtracks;
    if (frame === undefined) {
        return false;
    }
    if (frame.origin === "alternation") {
        // Cursor frame: restore the shared base, then overlay the
        // next per-rule fields read directly from `rules[cursor]`.
        // The frame stays at the head of the chain until all
        // alternatives have been consumed; new frames pushed during
        // the restored alternative's matching sit on top of (and
        // resolve before) this cursor.
        const i = frame.cursor;
        const rule = frame.rules[i];
        Object.assign(state, frame.base);
        state.name = `${frame.namePrefix}[${i}]`;
        state.parts = rule.parts;
        state.value = rule.value;
        state.spacingMode = rule.spacingMode;
        frame.cursor = i + 1;
        if (frame.cursor >= frame.rules.length) {
            // All alternatives restored — unlink the cursor.
            state.backtracks = frame.prev;
        }
        debugMatch(state, `Restoring local backtrack (alternation)`);
        return true;
    }
    // The snapshot omits `backtracks`, so Object.assign won't
    // overwrite it — explicitly advance the head pointer to `prev`.
    Object.assign(state, frame.snapshot);
    state.backtracks = frame.prev;
    debugMatch(
        state,
        frame.origin === "wildcard"
            ? `Extending wildcard from frame`
            : `Restoring local backtrack (${frame.origin})`,
    );
    return true;
}

// After a successful match, drop ALL backtrack frames in the chain
// whose origin axis is configured to commit on first success —
// the caller has said it doesn't want extra parses along that
// axis once one has been found.
//
// Per-axis policy mapping:
//   - origin "wildcard"  + wildcardPolicy === "shortest"
//   - origin "optional"  + optionalPolicy !== "exhaustive"
//   - origin "repeat"    + repeatPolicy   !== "exhaustive"
//   - origin "alternation"                 — always retained
//
// Frames with non-suppressed origins are SKIPPED OVER (their own
// `prev` is preserved through), so suppression walks the entire
// chain rather than just the trailing prefix.  This is critical
// for wildcard-axis suppression: a successful match in the live
// state must invalidate wildcard refinements pushed by SIBLING
// states (which sit deeper in the chain, below alternation
// frames), not just the current state's own wildcards.
export function suppressBacktracksAfterSuccess(state: MatchState) {
    const wildcardSuppress = state.wildcardPolicy === "shortest";
    const optionalSuppress = state.optionalPolicy !== "exhaustive";
    const repeatSuppress = state.repeatPolicy !== "exhaustive";
    if (!wildcardSuppress && !optionalSuppress && !repeatSuppress) {
        return;
    }
    const isSuppressed = (origin: BacktrackOrigin): boolean => {
        switch (origin) {
            case "wildcard":
                return wildcardSuppress;
            case "optional":
                return optionalSuppress;
            case "repeat":
                return repeatSuppress;
            case "alternation":
                return false;
        }
    };

    // Skip suppressed frames at the head.
    while (
        state.backtracks !== undefined &&
        isSuppressed(state.backtracks.origin)
    ) {
        state.backtracks = state.backtracks.prev;
    }
    // Walk the rest, splicing out any suppressed frame deeper in
    // the chain.  Mutates `prev` pointers in place — the chain is
    // single-owner, so no other state shares this view.
    let kept = state.backtracks;
    while (kept !== undefined) {
        let next = kept.prev;
        while (next !== undefined && isSuppressed(next.origin)) {
            next = next.prev;
        }
        (kept as { prev: Backtrack | undefined }).prev = next;
        kept = next;
    }
}

type GrammarMatchStat = {
    matchedValueCount: number;
    wildcardCharCount: number;
    entityWildcardPropertyNames: string[];
};
export type GrammarMatchResult = GrammarMatchStat & {
    match: unknown;
};

// Non-entity wildcard type names - these should NOT be treated as entity wildcards
const nonEntityWildcardTypes = new Set([
    "string",
    "wildcard",
    "word",
    "number",
]);

function createMatchedValue(
    valueIdNode: ValueIdNode,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    const { name, valueId, wildcardTypeName } = valueIdNode;

    // Only add to entityWildcardPropertyNames if it's an actual entity type
    // (not basic wildcard types like "string", "wildcard", "word", "number")
    if (
        valueId === partialValueId ||
        (wildcardTypeName !== undefined &&
            !nonEntityWildcardTypes.has(wildcardTypeName) &&
            partialValueId === undefined)
    ) {
        wildcardPropertyNames.push(propertyName);
    }

    let entry: MatchedValueEntry | undefined = values;
    while (entry !== undefined && entry.valueId !== valueId) {
        entry = entry.prev;
    }
    if (entry === undefined) {
        if (partialValueId !== undefined) {
            // Partial match, missing variable is ok
            return undefined;
        }
        throw new Error(
            `Internal error: Missing value for variable: ${name} id: ${valueId} property: ${propertyName}`,
        );
    }

    const value = entry.value;
    if (typeof value === "object") {
        return createValue(
            value.node,
            value.valueIds,
            values,
            propertyName,
            wildcardPropertyNames,
            partialValueId,
            stat,
        );
    }

    if (stat !== undefined) {
        // undefined means optional, don't count
        if (value !== undefined) {
            stat.matchedValueCount++;
        }

        if (entry.wildcard) {
            if (typeof value !== "string") {
                throw new Error(
                    `Internal error: Wildcard has non-string value for variable: ${name} id: ${valueId} property: ${propertyName}`,
                );
            }
            stat.wildcardCharCount += value.length;
        }
    }
    return value;
}

/**
 * Find a variable by name in the valueIds linked list and create its matched value
 */
function createValueForVariable(
    variableName: string,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    let valueIdNode: ValueIdNode | undefined = valueIds;
    while (valueIdNode !== undefined && valueIdNode.name !== variableName) {
        valueIdNode = valueIdNode.prev;
    }
    if (valueIdNode === undefined) {
        if (partialValueId !== undefined) {
            // Partial match, missing variable is ok
            return undefined;
        }
        throw new Error(
            `Internal error: No value for variable '${variableName}'. Values: ${JSON.stringify(valueIds)}'`,
        );
    }

    return createMatchedValue(
        valueIdNode,
        values,
        propertyName,
        wildcardPropertyNames,
        partialValueId,
        stat,
    );
}

export function createValue(
    node: CompiledValueNode | undefined,
    valueIds: ValueIdNode | undefined,
    values: MatchedValueEntry | undefined,
    propertyName: string,
    wildcardPropertyNames: string[],
    partialValueId?: number,
    stat?: GrammarMatchStat,
): unknown {
    if (node === undefined) {
        if (valueIds === undefined) {
            if (partialValueId !== undefined) {
                // Partial match, missing variable is ok
                return undefined;
            }
            throw new Error("Internal error: missing value for default");
        }
        if (valueIds.prev !== undefined) {
            throw new Error("Internal error: multiple values for default");
        }
        return createMatchedValue(
            valueIds,
            values,
            propertyName,
            wildcardPropertyNames,
            partialValueId,
            stat,
        );
    }

    switch (node.type) {
        case "literal":
            return node.value;
        case "object": {
            const obj: Record<string, any> = {};

            for (const elem of node.value) {
                if (elem.type === "spread") {
                    // Spread: evaluate the argument and merge into the object.
                    const inner = createValue(
                        elem.argument,
                        valueIds,
                        values,
                        propertyName,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                    if (inner === undefined) {
                        // Partial match — the spread argument's variable
                        // hasn't been captured yet.  Skip silently.
                    } else if (typeof inner === "object") {
                        Object.assign(obj, inner);
                    } else {
                        throw new Error(
                            `Internal error: spread argument must produce an object, got ${typeof inner}`,
                        );
                    }
                } else if (elem.value === null) {
                    // Shorthand form: { k } means { k: k }
                    obj[elem.key] = createValueForVariable(
                        elem.key,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${elem.key}` : elem.key,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                } else {
                    obj[elem.key] = createValue(
                        elem.value,
                        valueIds,
                        values,
                        propertyName ? `${propertyName}.${elem.key}` : elem.key,
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                }
            }
            return obj;
        }
        case "array": {
            const arr: any[] = [];
            for (const [index, v] of node.value.entries()) {
                if (v.type === "spreadElement") {
                    // Spread: evaluate the argument and flatten into the array.
                    const inner = createValue(
                        v.argument,
                        valueIds,
                        values,
                        propertyName
                            ? `${propertyName}.${index}`
                            : index.toString(),
                        wildcardPropertyNames,
                        partialValueId,
                        stat,
                    );
                    if (Array.isArray(inner)) {
                        arr.push(...inner);
                    } else {
                        arr.push(inner);
                    }
                } else {
                    arr.push(
                        createValue(
                            v,
                            valueIds,
                            values,
                            propertyName
                                ? `${propertyName}.${index}`
                                : index.toString(),
                            wildcardPropertyNames,
                            partialValueId,
                            stat,
                        ),
                    );
                }
            }
            return arr;
        }
        case "variable": {
            return createValueForVariable(
                node.name,
                valueIds,
                values,
                propertyName,
                wildcardPropertyNames,
                partialValueId,
                stat,
            );
        }
        default: {
            // Expression node (binaryExpression, unaryExpression, etc.).
            // All expression node types are handled by evaluateValueExpr,
            // which throws on unknown types — no silent fallthrough risk.
            // The evalBase callback routes base nodes (literal, variable,
            // object, array) back through createValue so variable resolution
            // and wildcard extraction work correctly.
            return evaluateValueExpr(node, (baseNode) =>
                createValue(
                    baseNode,
                    valueIds,
                    values,
                    propertyName,
                    wildcardPropertyNames,
                    partialValueId,
                    stat,
                ),
            );
        }
    }
}

// Extract and trim a wildcard capture from `request[start..end)`.  In the
// default spacing modes the result is stripped of leading/trailing separators
// (whitespace and punctuation).  Returns `undefined` when the capture is empty
// or consists *entirely* of separator characters — e.g. a lone " " — so that
// the matcher rejects wildcard slots that contain no meaningful content.
// In "none" mode no trimming is performed; only a truly zero-length capture
// is rejected.
export function getWildcardStr(
    request: string,
    start: number,
    end: number,
    spacingMode?: CompiledSpacingMode,
) {
    const string = request.substring(start, end);
    if (spacingMode === "none") {
        // In "none" mode there are no flex-space separator positions, so any
        // whitespace or punctuation between tokens belongs to the wildcard
        // value itself.  Only reject truly empty wildcards.
        return string.length > 0 ? string : undefined;
    }
    wildcardTrimRegExp.lastIndex = 0;
    const match = wildcardTrimRegExp.exec(string);
    return match?.[1];
}

function captureWildcard(
    state: MatchState,
    request: string,
    wildcardEnd: number,
    newIndex: number,
) {
    const { start: wildcardStart, valueId } = state.pendingWildcard!;
    const wildcardStr = getWildcardStr(
        request,
        wildcardStart,
        wildcardEnd,
        state.spacingMode,
    );
    if (wildcardStr === undefined) {
        return false;
    }
    state.index = newIndex;

    // Push a "wildcard"-origin backtrack so we can later resume
    // scanning for a strictly longer wildcard capture (used by
    // `tryNextBacktrack` on downstream failure, and on success
    // in default mode).  The frame is taken BEFORE we clear
    // pendingWildcard / commit the captured value so that restoring
    // it puts the state back into the wildcard-scanning dispatch
    // path with pendingWildcard still set.
    pushBacktrack(state, captureSnapshot(state), "wildcard");

    // Update current state
    state.pendingWildcard = undefined;
    if (valueId !== undefined) {
        addValueWithId(state, valueId, wildcardStr, true);
    }
    return true;
}

function addValueId(
    state: PendingMatchState,
    name: string | undefined,
    wildcardTypeName?: string,
) {
    const valueIds = state.valueIds;
    if (valueIds === null) {
        // No need to track values
        return;
    }
    const valueId = state.nextValueId++;
    state.valueIds = { name, valueId, prev: valueIds, wildcardTypeName };
    return valueId;
}

function addValueWithId(
    state: PendingMatchState,
    valueId: number,
    matchedValue: MatchedValue,
    wildcard: boolean,
) {
    state.values = {
        valueId,
        value: matchedValue,
        wildcard,
        prev: state.values,
    };
}

function addValue(
    state: PendingMatchState,
    name: string | undefined,
    matchedValue: MatchedValue,
) {
    const valueId = addValueId(state, name);
    if (valueId !== undefined) {
        addValueWithId(state, valueId, matchedValue, false);
    }
}

// True when this rule/state would synthesize its result from the lone
// captured value of its single part (no explicit value expression and
// exactly one part).
type ImplicitDefaultCarrier = Pick<MatchState, "value" | "parts">;
function usesImplicitDefault(s: ImplicitDefaultCarrier): boolean {
    return s.value === undefined && s.parts.length === 1;
}

export function nextNonSeparatorIndex(request: string, index: number) {
    if (request.length <= index) {
        return request.length;
    }

    // Detect trailing separators
    separatorRegExp.lastIndex = index;
    const match = separatorRegExp.exec(request);
    return match === null ? index : index + match[0].length;
}

// Finalize the state to capture the last wildcard if any
// and make sure to reject any trailing un-matched non-separator characters.
export function finalizeState(state: MatchState, request: string) {
    const pendingWildcard = state.pendingWildcard;
    if (pendingWildcard !== undefined) {
        const value = getWildcardStr(
            request,
            pendingWildcard.start,
            request.length,
            state.spacingMode,
        );
        if (value === undefined) {
            return false;
        }
        state.pendingWildcard = undefined;
        state.index = request.length;
        if (pendingWildcard.valueId !== undefined) {
            addValueWithId(state, pendingWildcard.valueId, value, true);
        }
    }
    if (state.index < request.length) {
        // In "none" mode the match must be exact — no trailing content
        // is tolerated.  This applies to the top-level rule's spacing
        // mode (by the time finalizeState runs, nested rules have been
        // unwound and the spacing mode has been restored to the
        // top-level rule's mode).
        if (state.spacingMode === "none") {
            debugMatch(
                state,
                `Reject trailing content in none mode at ${state.index}: ${request.slice(state.index)}`,
            );
            return false;
        }

        // Detect trailing separators
        const nonSepIndex = nextNonSeparatorIndex(request, state.index);
        if (nonSepIndex < request.length) {
            debugMatch(
                state,
                `Reject with trailing non-separator text at ${nonSepIndex}: ${request.slice(
                    nonSepIndex,
                )}`,
            );
            return false;
        }

        debugMatch(state, `Consume trailing separators to ${request.length}}`);
    }
    return true;
}

function finalizeMatch(
    state: MatchState,
    request: string,
    results: GrammarMatchResult[],
): boolean {
    if (state.valueIds === null) {
        throw new Error(
            "Internal Error: state for finalizeMatch should not have valueIds be null",
        );
    }

    if (!finalizeState(state, request)) {
        return false;
    }
    debugMatch(
        state,
        `Matched at end of input. Matched ids: ${JSON.stringify(state.valueIds)}, values: ${JSON.stringify(state.values)}'`,
    );

    const wildcardPropertyNames: string[] = [];
    const matchResult: GrammarMatchResult = {
        match: undefined,
        matchedValueCount: 0,
        wildcardCharCount: 0,
        entityWildcardPropertyNames: wildcardPropertyNames,
    };

    matchResult.match = createValue(
        state.value,
        state.valueIds,
        state.values,
        "",
        wildcardPropertyNames,
        undefined,
        matchResult, // stats
    );
    results.push(matchResult);
    return true;
}

export function finalizeNestedRule(
    state: MatchState,
    partial: boolean = false,
) {
    const parent = state.parent;
    if (parent !== undefined) {
        debugMatch(state, `finished nested`);

        // Reuse state
        const { valueIds, value: value } = state;

        state.nestedLevel--;
        state.parent = parent.parent;

        if (
            // Only process values if the parent rule is tracking values
            parent.valueIds !== null &&
            (parent.variable !== undefined || !usesImplicitDefault(parent))
        ) {
            state.value = parent.value;
            state.valueIds = parent.valueIds;
            if (parent.variable !== undefined) {
                if (valueIds === null) {
                    throw new Error(
                        "Internal Error: should not have valueIds be null when variable is defined",
                    );
                }

                if (valueIds === undefined && value === undefined) {
                    // Variable should have a value
                    if (!partial) {
                        // Should be detected by the grammar compiler
                        throw new Error(
                            `Internal error: No value assign to variable '${parent.variable}'`,
                        );
                    }
                } else {
                    addValue(state, parent.variable, {
                        node: value,
                        valueIds,
                    });
                }
            }
        }

        state.name = parent.name;
        state.parts = parent.parts;
        state.partIndex = parent.partIndex;
        state.spacingMode = parent.spacingMode;

        // For repeat parts ()*  or )+: after each successful match, queue a state
        // that tries to match the same group again.  suppressOptionalFork
        // suppresses the optional-skip push so we don't generate duplicate
        // "done" states.
        if (parent.repeatPartIndex !== undefined) {
            // Build the CONTINUE alternative (re-enter the group).
            const continueState: SnapshotState = {
                ...forkMatchState(state),
                partIndex: parent.repeatPartIndex,
                suppressOptionalFork: true,
            };
            if (state.repeatPolicy === "greedy") {
                // Live = continue (drill deeper); backtrack = stop
                // (snapshot of state past the repeat).
                const stopSnapshot = forkMatchState(state);
                Object.assign(state, continueState);
                pushBacktrack(state, stopSnapshot, "repeat");
            } else {
                // Default / nonGreedy: live = stop; backtrack = continue.
                pushBacktrack(state, continueState, "repeat");
            }
        }

        return true;
    }

    return false;
}

function matchStringPartWithWildcard(
    regExp: RegExp,
    request: string,
    part: StringPart,
    state: MatchState,
) {
    regExp.lastIndex = state.index;
    while (true) {
        const match = regExp.exec(request);
        if (match === null) {
            return false;
        }
        const wildcardEnd = match.index;
        const newIndex = wildcardEnd + match[0].length;
        if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
            debugMatch(
                state,
                `Rejected non-separated matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            continue;
        }

        if (captureWildcard(state, request, wildcardEnd, newIndex)) {
            // If the StringPart has an explicit capture variable, write the
            // joined matched tokens into that named slot.  Otherwise fall
            // through to the implicit-default rule for single-part rules
            // without a value expression — same logic as the non-wildcard
            // path in matchStringPartWithoutWildcard.  Without this, a
            // pending wildcard from a parent rule that leaks into a
            // single-part child rule would bypass the default value
            // assignment and cause "No value assign to variable" at
            // finalizeNestedRule time.
            if (
                state.valueIds !== null &&
                (part.variable !== undefined || usesImplicitDefault(state))
            ) {
                addValue(state, part.variable, part.value.join(" "));
            }
            state.lastMatchedPartInfo = {
                type: "string",
                start: wildcardEnd,
                part,
                afterWildcard: true,
                matchedSpacingMode: state.spacingMode,
            };
            debugMatch(
                state,
                `Matched string '${part.value.join(" ")}' at ${wildcardEnd}`,
            );
            return true;
        }
        debugMatch(
            state,
            `Rejected matched string '${part.value.join(" ")}' at ${wildcardEnd} with empty wildcard`,
        );
    }
}

function matchStringPartWithoutWildcard(
    regExp: RegExp,
    request: string,
    part: StringPart,
    state: MatchState,
) {
    const curr = state.index;
    regExp.lastIndex = curr;
    const match = regExp.exec(request);
    if (match === null) {
        return false;
    }
    const newIndex = match.index + match[0].length;
    if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
        debugMatch(
            state,
            `Rejected non-separated matched string ${part.value.join(" ")}`,
        );
        return false;
    }

    debugMatch(state, `Matched string ${part.value.join(" ")} to ${newIndex}`);

    if (
        state.valueIds !== null &&
        (part.variable !== undefined || usesImplicitDefault(state))
    ) {
        // Explicit capture variable on the StringPart — write the joined
        // matched tokens into that named slot.  Otherwise fall through to
        // the implicit-default rule for single-part rules without a value
        // expression.
        addValue(state, part.variable, part.value.join(" "));
    }
    state.lastMatchedPartInfo = {
        type: "string",
        start: curr,
        part,
        afterWildcard: false,
        matchedSpacingMode: state.spacingMode,
    };
    state.index = newIndex;
    return true;
}

// Determine the spacing mode that governs the leading separator prefix
// ([\s\p{P}]*?) for a part at the current position.
//
// For subsequent parts within a rule (partIndex > 0), the rule's own
// spacingMode applies — there is a flex-space boundary between the
// previous part and this one.
//
// For the first part of a nested rule (partIndex === 0, parent exists),
// we walk up the parent chain looking for the nearest ancestor that has
// a flex-space boundary before the rule reference (parent.partIndex > 1
// means the rule ref was not the first part).  That ancestor's spacing
// mode controls the separator.  If no ancestor has a preceding
// flex-space, we've reached the top-level rule — its spacing mode
// determines the leading/trailing behavior (all modes except "none"
// allow leading whitespace at the top level).
export function leadingSpacingMode(state: MatchState): CompiledSpacingMode {
    if (state.partIndex !== 0 || state.parent === undefined) {
        return state.spacingMode;
    }
    let parent: ParentMatchState | undefined = state.parent;
    while (parent !== undefined) {
        if (parent.partIndex > 1) {
            // The rule reference had a preceding part in this ancestor
            // — use this ancestor's spacing mode for the flex-space.
            return parent.spacingMode;
        }
        if (parent.parent === undefined) {
            // Reached the top-level rule with no preceding flex-space.
            return parent.spacingMode;
        }
        parent = parent.parent;
    }
    // Should not reach here (the loop terminates when parent.parent is undefined).
    return state.spacingMode;
}

/**
 * Build the regex pattern string for a StringPart given the spacing mode and
 * whether leading separators should be suppressed ("none" leading mode).
 */
function buildStringPartRegExpStr(
    part: StringPart,
    spacingMode: CompiledSpacingMode,
    leadingIsNone: boolean,
): string {
    const escaped = part.value.map(escapeMatch);
    // Build the joined regex string using an array to avoid O(N²) string concatenation.
    // "required" → [\s\p{P}]+, "optional" → [\s\p{P}]*.
    // In "auto" mode, + is used only when both adjacent characters belong to
    // word-space scripts; otherwise * allows zero separators (e.g. when a
    // segment ends/starts with punctuation, or the neighboring script does
    // not use word spaces such as CJK).
    const regexpSegments: string[] = [escaped[0]];
    for (let i = 1; i < escaped.length; i++) {
        // In "none" mode flex-space positions must match exactly zero
        // characters — tokens are directly adjacent.  Any literal spaces
        // (e.g. from "\ ") are already part of the segment text and will
        // be matched by the regex itself.
        const sep =
            spacingMode === "none"
                ? ""
                : requiresSeparator(
                        // Invariant: segments are always non-empty (guaranteed by the parser).
                        part.value[i - 1].at(-1)!,
                        part.value[i][0],
                        spacingMode,
                    )
                  ? `[${separatorRegExpStr}]+`
                  : `[${separatorRegExpStr}]*`;
        regexpSegments.push(sep, escaped[i]);
    }
    const joined = regexpSegments.join("");
    // Whether to add a leading separator prefix is determined by
    // leadingSpacingMode: for the first part of a nested rule, the
    // parent's spacing mode decides; otherwise the rule's own mode.
    // In "none" mode no leading separator is consumed; the match must
    // start exactly at the current position.
    return leadingIsNone ? joined : `[${separatorRegExpStr}]*?${joined}`;
}

/**
 * Get or create cached RegExp objects for a StringPart.  The cache
 * has exactly 4 (`CompiledSpacingMode`) \u00d7 2 (`leadingIsNone`) = 8
 * possible (spacingMode, leadingIsNone) keys, so it is stored as a
 * fixed 8-slot sparse array indexed directly by
 * `(modeIndex << 1) | leadingIsNone`.  This avoids the per-call
 * template-string + `Map.get(string)` allocation incurred by the
 * previous string-keyed Map on every match attempt.
 */
// Maps each CompiledSpacingMode value to a 0..3 slot index used to
// build the regex-cache key.  Order is fixed so cache keys remain
// stable across matcher invocations.
const spacingModeIndex: Record<"required" | "optional" | "none", number> = {
    required: 0,
    optional: 1,
    none: 2,
    // "auto" (undefined) handled separately as index 3.
};

function getStringPartRegExp(
    part: StringPart,
    spacingMode: CompiledSpacingMode,
    leadingIsNone: boolean,
): StringPartRegExpEntry {
    const modeIdx =
        spacingMode === undefined ? 3 : spacingModeIndex[spacingMode];
    const key = (modeIdx << 1) | (leadingIsNone ? 1 : 0);
    if (part.regexpCache === undefined) {
        // Sparse 8-slot array; unset slots remain `undefined`.
        part.regexpCache = new Array(8);
    }
    let entry = part.regexpCache[key];
    if (entry === undefined) {
        const regExpStr = buildStringPartRegExpStr(
            part,
            spacingMode,
            leadingIsNone,
        );
        entry = {
            global: new RegExp(regExpStr, "iug"),
            sticky: new RegExp(regExpStr, "iuy"),
        };
        part.regexpCache[key] = entry;
    }
    return entry;
}

function matchStringPart(request: string, state: MatchState, part: StringPart) {
    debugMatch(
        state,
        `Checking string expr "${part.value.join(" ")}" with${state.pendingWildcard ? "" : "out"} wildcard`,
    );
    const leadingIsNone = leadingSpacingMode(state) === "none";
    const entry = getStringPartRegExp(part, state.spacingMode, leadingIsNone);
    return state.pendingWildcard !== undefined
        ? matchStringPartWithWildcard(entry.global, request, part, state)
        : matchStringPartWithoutWildcard(entry.sticky, request, part, state);
}

const matchNumberPartWithWildcardRegExp =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
// "none" mode variant: no leading separator allowed.
const matchNumberPartWithWildcardNoSepRegExp =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/giu;
function matchVarNumberPartWithWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
) {
    const curr = state.index;
    const re =
        leadingSpacingMode(state) === "none"
            ? matchNumberPartWithWildcardNoSepRegExp
            : matchNumberPartWithWildcardRegExp;
    re.lastIndex = curr;
    while (true) {
        const match = re.exec(request);
        if (match === null) {
            return false;
        }
        const n = Number(match[1]);
        if (isNaN(n)) {
            continue;
        }

        const wildcardEnd = match.index;
        const newIndex = wildcardEnd + match[0].length;

        if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
            debugMatch(
                state,
                `Rejected non-separated matched number at ${wildcardEnd}`,
            );
            continue;
        }

        if (captureWildcard(state, request, wildcardEnd, newIndex)) {
            debugMatch(
                state,
                `Matched number at ${wildcardEnd} to ${newIndex}`,
            );

            const valueId = addValueId(state, part.variable);
            if (valueId !== undefined) {
                addValueWithId(state, valueId, n, false);
                state.lastMatchedPartInfo = {
                    type: "number",
                    start: wildcardEnd,
                    valueId,
                    afterWildcard: true,
                    matchedSpacingMode: state.spacingMode,
                };
            }
            return true;
        }
        debugMatch(
            state,
            `Rejected match number at ${wildcardEnd} to ${newIndex} with empty wildcard`,
        );
    }
}

const matchNumberPartRegexp =
    /[\s\p{P}]*?(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
// "none" mode variant: no leading separator allowed.
const matchNumberPartNoSepRegexp =
    /(0o[0-7]+|0x[0-9a-f]+|0b[01]+|([+-]?[0-9]+)(\.[0-9]+)?(e[+-]?[1-9][0-9]*)?)/iuy;
function matchVarNumberPartWithoutWildcard(
    request: string,
    state: MatchState,
    part: VarNumberPart,
) {
    const curr = state.index;
    const re =
        leadingSpacingMode(state) === "none"
            ? matchNumberPartNoSepRegexp
            : matchNumberPartRegexp;
    re.lastIndex = curr;
    const m = re.exec(request);
    if (m === null) {
        return false;
    }
    const n = Number(m[1]);
    if (isNaN(n)) {
        return false;
    }

    const newIndex = curr + m[0].length;

    if (!isBoundarySatisfied(request, newIndex, state.spacingMode)) {
        debugMatch(state, `Rejected non-separated matched number`);
        return false;
    }

    debugMatch(state, `Matched number to ${newIndex}`);

    const valueId = addValueId(state, part.variable);
    if (valueId !== undefined) {
        addValueWithId(state, valueId, n, false);
        state.lastMatchedPartInfo = {
            type: "number",
            start: curr,
            valueId,
            afterWildcard: false,
            matchedSpacingMode: state.spacingMode,
        };
    }
    state.index = newIndex;
    return true;
}

function matchVarNumberPart(
    request: string,
    state: MatchState,
    part: VarNumberPart,
) {
    debugMatch(
        state,
        `Checking number expr at with${state.pendingWildcard ? "" : "out"} wildcard`,
    );
    return state.pendingWildcard !== undefined
        ? matchVarNumberPartWithWildcard(request, state, part)
        : matchVarNumberPartWithoutWildcard(request, state, part);
}

function matchVarStringPart(state: MatchState, part: VarStringPart) {
    // string variable, wildcard
    if (state.pendingWildcard !== undefined) {
        return false;
    }

    const valueId = addValueId(state, part.variable, part.typeName);
    state.pendingWildcard = {
        valueId,
        start: state.index,
    };
    return true;
}

export function matchState(state: MatchState, request: string) {
    while (true) {
        const { parts, partIndex } = state;
        if (partIndex >= parts.length) {
            if (!finalizeNestedRule(state)) {
                // Finish matching this state.
                return true;
            }

            // Check the trailing boundary after the nested rule using the
            // parent's (now-restored) spacingMode, but only if the
            // parent still has parts remaining.  If the parent is also
            // exhausted, skip the check here: the loop will call
            // finalizeNestedRule again and the check will fire once we
            // reach an ancestor that actually has a following part — using
            // that ancestor's mode instead of an intermediate pass-through
            // rule's mode.
            if (
                state.partIndex < state.parts.length &&
                state.pendingWildcard === undefined &&
                !isBoundarySatisfied(request, state.index, state.spacingMode)
            ) {
                return false;
            }

            continue;
        }

        const part = parts[partIndex];
        debugMatch(
            state,
            `matching type=${JSON.stringify(part.type)} pendingWildcard=${JSON.stringify(state.pendingWildcard)}`,
        );

        // Consume the single-use suppression flag exactly once per
        // part iteration: read it into a local and clear immediately.
        // The flag's sole purpose is to gate the optional-fork block
        // below; clearing here (before any early-continue path) makes
        // it impossible for the flag to leak onto a subsequent part
        // even if future code adds new branches inside the loop body.
        const suppressOptionalFork = state.suppressOptionalFork;
        state.suppressOptionalFork = undefined;

        if (part.optional && !suppressOptionalFork) {
            // Build the SKIP alternative (advance past the optional
            // part, with `undefined` recorded for any variable).
            const skipState: SnapshotState = {
                ...forkMatchState(state),
                partIndex: state.partIndex + 1,
            };
            if (part.variable) {
                addValue(skipState, part.variable, undefined);
            }
            if (state.optionalPolicy === "preferSkip") {
                // Live = skip; backtrack = take (snapshot of current
                // state continues with the optional part).  The take
                // snapshot is marked `suppressOptionalFork: true` so
                // that on restore the optional-fork block at the top
                // of this loop is suppressed — otherwise the same
                // optional part would re-fork and we would push
                // another take frame in an infinite loop.  The flag
                // is consumed by the local capture above on the next
                // iteration, so it cannot leak onto subsequent parts.
                const takeSnapshot: SnapshotState = {
                    ...forkMatchState(state),
                    suppressOptionalFork: true,
                };
                Object.assign(state, skipState);
                pushBacktrack(state, takeSnapshot, "optional");
                continue;
            }
            // Default / preferTake: live = take; backtrack = skip.
            pushBacktrack(state, skipState, "optional");
        }

        switch (part.type) {
            case "string":
                if (!matchStringPart(request, state, part)) {
                    return false;
                }
                break;

            case "number":
                if (!matchVarNumberPart(request, state, part)) {
                    return false;
                }
                break;
            case "wildcard":
                // string variable, wildcard
                if (!matchVarStringPart(state, part)) {
                    return false;
                }
                break;
            case "rules": {
                const rules = part.rules;
                debugMatch(state, `expanding ${rules.length} rules`);

                // Save the current state to be restored after finishing the nested rule.
                const parent: ParentMatchState = {
                    name: state.name,
                    variable: part.variable,
                    parts: state.parts,
                    value: state.value,
                    partIndex: state.partIndex + 1,
                    valueIds: state.valueIds,
                    parent: state.parent,
                    repeatPartIndex: part.repeat ? state.partIndex : undefined,
                    spacingMode: state.spacingMode,
                };

                // The nested rule needs to track values if the current rule is tracking value AND
                // - the current part has variable
                // - the current rule has not explicit value and only has one part (default)
                const requireValue =
                    state.valueIds !== null &&
                    (part.variable !== undefined || usesImplicitDefault(state));

                // Update the current state to consider the first nested rule.
                state.name = getNestedStateName(state, part, 0);
                state.parts = rules[0].parts;
                state.value = rules[0].value;
                state.partIndex = 0;
                state.valueIds = requireValue ? undefined : null;
                state.parent = parent;
                state.nestedLevel++;
                state.suppressOptionalFork = undefined; // entering nested rules, clear suppression flag
                state.spacingMode = rules[0].spacingMode;

                // Push a single compressed alternation cursor frame
                // covering rules 1..N-1.  The shared `base` is the
                // live state right after rule 0 setup — every
                // alternative starts from the same fork-point
                // context with only the four per-rule fields
                // overlaid (read directly from `rules[i]` on
                // restore).  The name prefix is computed once;
                // `tryNextBacktrack` builds the per-rule debug name
                // lazily as `${namePrefix}[${i}]`.
                // `forkMatchState` enforces the single-owner
                // invariant on the chain (the snapshot omits
                // `backtracks`).
                if (rules.length > 1) {
                    const base = forkMatchState(state);
                    const namePrefix = part.name
                        ? `<${part.name}>`
                        : getStateName(state);
                    pushAlternation(state, base, rules, namePrefix);
                }
                // continue the loop (without incrementing partIndex)
                continue;
            }
        }
        state.partIndex++;
    }
}

// Build the initial live MatchState for `matchGrammar` /
// `matchGrammarCompletion`.  The returned state is initialized for
// rule 0 (the live DFS path); rules 1..N-1 are pre-pushed onto
// its `backtracks` chain as `"alternation"`-origin frames —
// the same mechanism a nested-rule alternation uses.  Pushed in
// reverse order so rule 1 is on top of the stack and gets
// restored first by `tryNextBacktrack`, matching source
// order.  Returns `undefined` for an empty grammar (no rules).
export function initialMatchState(
    grammar: Grammar,
    options?: GrammarMatchOptions,
): MatchState | undefined {
    const rules = grammar.rules;
    if (rules.length === 0) {
        return undefined;
    }
    const wildcardPolicy = options?.wildcardPolicy ?? "exhaustive";
    const optionalPolicy = options?.optionalPolicy ?? "exhaustive";
    const repeatPolicy = options?.repeatPolicy ?? "exhaustive";

    const state: MatchState = {
        name: `<Start>[0]`,
        parts: rules[0].parts,
        value: rules[0].value,
        partIndex: 0,
        valueIds: undefined,
        nextValueId: 0,
        values: undefined,
        parent: undefined,
        nestedLevel: 0,
        suppressOptionalFork: undefined,
        spacingMode: rules[0].spacingMode,
        index: 0,
        pendingWildcard: undefined,
        lastMatchedPartInfo: undefined,
        wildcardPolicy,
        optionalPolicy,
        repeatPolicy,
    };
    // Top-level alternation: push a single compressed cursor frame
    // covering rules 1..N-1.  The cursor advances forward (rule 1
    // first, then rule 2, ...) — same source order as the prior
    // reverse-push of one frame per rule.  `base` is rule-0's
    // initial state; per-rule `parts/value/spacingMode` are read
    // from `rules[i]` directly on restore, and the debug name is
    // built lazily as `<Start>[i]`.
    if (rules.length > 1) {
        pushAlternation(state, forkMatchState(state), rules, "<Start>");
    }
    return state;
}

function debugMatch(state: MatchState, msg: string) {
    if (state.nestedLevel < 0) {
        throw new Error(
            `Internal error: nestedLevel went negative (${state.nestedLevel}) at "${msg}"`,
        );
    }
    debugMatchRaw(
        `${" ".repeat(state.nestedLevel)}${getStateName(state)}: @${state.index}: ${msg}`,
    );
}
function getStateName(state: MatchState): string {
    return `${state.name}{${state.partIndex}}`;
}

function getNestedStateName(state: MatchState, part: RulesPart, index: number) {
    return `${part.name ? `<${part.name}>` : getStateName(state)}[${index}]`;
}

export function matchGrammar(
    grammar: Grammar,
    request: string,
    options?: GrammarMatchOptions,
) {
    const state = initialMatchState(grammar, options);
    const results: GrammarMatchResult[] = [];
    if (state === undefined) {
        return results;
    }
    // Explicit-stack DFS over the parse forest: `matchState` walks
    // the live state's parts left-to-right; on success collect the
    // result and prune any per-policy first-success frames; then
    // pop the most-recently-pushed unexplored sibling and resume.
    do {
        debugMatch(state, `resume state`);
        if (
            matchState(state, request) &&
            finalizeMatch(state, request, results)
        ) {
            suppressBacktracksAfterSuccess(state);
        }
    } while (tryNextBacktrack(state));

    return results;
}
