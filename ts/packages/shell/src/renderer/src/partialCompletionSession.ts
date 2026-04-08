// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import { needsSeparatorInAutoMode } from "agent-dispatcher/helpers/completion";
import {
    AfterWildcard,
    CompletionDirection,
    CompletionGroup,
    SeparatorMode,
} from "@typeagent/agent-sdk";
import {
    SearchMenuItem,
    SearchMenuPosition,
} from "../../preload/electronTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

export interface ISearchMenu {
    setChoices(choices: SearchMenuItem[]): void;
    // Returns true when the prefix uniquely satisfies exactly one entry
    // (exact match that is not a prefix of any other entry).
    updatePrefix(prefix: string, position: SearchMenuPosition): boolean;
    // Returns true when text is an exact match for a completion entry.
    hasExactMatch(text: string): boolean;
    hide(): void;
    isActive(): boolean;
}

export interface ICompletionDispatcher {
    getCommandCompletion(
        input: string,
        direction: CompletionDirection,
    ): Promise<CommandCompletionResult>;
}

// Describes what the shell should do when the local trie has no matches
// for the user's typed prefix.  Computed once from the backend's
// descriptive fields (closedSet, afterWildcard) when a result arrives,
// then used in reuseSession() decisions.
//
//   "accept"  — the completion set is exhaustive; no re-fetch can help.
//               (Derived from closedSet=true, afterWildcard="none".)
//   "refetch" — the set is open-ended; the backend may know more.
//               (Derived from closedSet=false, or afterWildcard="some".)
//   "slide"   — the anchor sits at a sliding wildcard boundary; slide
//               it forward instead of re-fetching or giving up.
//               (Derived from afterWildcard="all", any closedSet.)
type NoMatchPolicy = "accept" | "refetch" | "slide";

function computeNoMatchPolicy(
    closedSet: boolean,
    afterWildcard: AfterWildcard,
): NoMatchPolicy {
    if (afterWildcard === "all") return "slide";
    if (closedSet && afterWildcard === "none") return "accept";
    // Covers closedSet=false (open-ended set) and afterWildcard="some"
    // (mixed wildcard/literal rules — neither sliding nor accepting is safe).
    return "refetch";
}

// PartialCompletionSession manages the state machine for command completion.
//
// States:
//   IDLE        anchor === undefined
//   PENDING     anchor !== undefined && completionP !== undefined
//   ACTIVE      anchor !== undefined && completionP === undefined
//
// Two-anchor model:
//   - `anchor` (data validity): the prefix for which the backend result was
//     computed.  Past it → re-fetch.
//   - `menuSepLevel` (trie matching level): items in the trie correspond to
//     one SepLevel (0/1/2).  The trie is only reloaded when the user narrows
//     past the menu anchor or the menu is exhausted and a higher level exists.
//
// Design principles:
//   - Completion result fields (per-group separatorMode, etc.) are stored as-is
//     from the backend response and never mutated.
//   - Per-group separatorMode determines which groups belong to each SepLevel.
//     Non-cumulative: each level has its own set of items.  Widening replaces
//     the trie rather than appending.
//   - reuseSession() follows a decision table: A (session validity),
//     B (menu anchor), C (trie matching), D (exhaustion cascade).
//     See the method comment for the full table.
//   - The `noMatchPolicy` controls the no-match fallthrough at D2–D4:
//       "accept"  → exhaustive set, stay quiet
//       "refetch" → open-ended, backend may know more
//       "slide"   → wildcard boundary, slide anchor forward
//
// Architecture: docs/architecture/completion.md — §5 Shell — Completion Session
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private anchor: string | undefined = undefined;

    // Items partitioned by separatorMode from the last result.
    private partitions: ItemPartition[] = [];
    // Precomputed item counts per SepLevel.  Updated whenever
    // partitions change (setPartitions / resetToIdle).
    private levelCounts: LevelCounts = [0, 0, 0];
    // The SepLevel at which the trie is currently loaded.
    // Items in the trie correspond to itemsAtLevel(partitions, menuSepLevel).
    // The trie is only reloaded when: (a) the user narrows past the
    // menu anchor (sepLevel < menuSepLevel), or (b) the menu is
    // exhausted and a higher level is available (widen).
    private menuSepLevel: SepLevel = 0;
    // Computed from the backend's closedSet + afterWildcard fields.
    // Controls what happens when the local trie has no matches.
    private noMatchPolicy: NoMatchPolicy = "refetch";
    // True when completions differ between forward and backward.
    private directionSensitive: boolean = false;

    // The in-flight completion request, or undefined when settled.
    private completionP: Promise<CommandCompletionResult> | undefined;

    // Set when the user explicitly closes the menu (e.g. Escape).
    // startNewSession uses this to suppress reopening if the refetch returns
    // the same anchor — meaning the completions are unchanged and the user
    // already dismissed them.
    private explicitCloseAnchor: string | undefined = undefined;

    constructor(
        private readonly menu: ISearchMenu,
        private readonly dispatcher: ICompletionDispatcher,
    ) {}

    // Load the trie with items for the given level and set menuSepLevel.
    // Shared by reuseSession (narrow/widen), startNewSession (initial load),
    // and explicitHide (level change on dismiss).
    private loadLevel(level: SepLevel): void {
        this.menuSepLevel = level;
        this.menu.setChoices(itemsAtLevel(this.partitions, level));
    }

    // Update partitions and recompute levelCounts.
    private setPartitions(partitions: ItemPartition[]): void {
        this.partitions = partitions;
        this.levelCounts = computeLevelCounts(partitions);
    }

    // Strip the separator from rawPrefix at the current menuSepLevel,
    // compute the menu position, and update the trie prefix.  Returns
    // true when the prefix uniquely satisfies one entry; hides the menu
    // when position cannot be determined.
    private positionMenu(
        rawPrefix: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): boolean {
        const completionPrefix = stripAtLevel(rawPrefix, this.menuSepLevel);
        const position = getPosition(completionPrefix);
        if (position !== undefined) {
            return this.menu.updatePrefix(completionPrefix, position);
        }
        this.menu.hide();
        return false;
    }

    // Main entry point.  Called by PartialCompletion.update() after DOM checks pass.
    //   input:       trimmed input text (ghost text stripped, leading whitespace stripped)
    //   direction:   host-provided signal: "forward" (user is moving ahead) or
    //                "backward" (user is reconsidering, e.g. backspaced)
    //   getPosition: DOM callback that computes the menu anchor position; returns
    //                undefined when position cannot be determined (hides menu).
    public update(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
        direction: CompletionDirection = "forward",
    ): void {
        if (this.reuseSession(input, getPosition, direction)) {
            return;
        }

        this.startNewSession(input, getPosition, direction);
    }

    // Hide the menu and cancel any in-flight fetch, but preserve session
    // state so reuseSession() can still match the anchor if the user
    // returns (e.g. cursor moved away then back without typing).
    public hide(): void {
        // Cancel any in-flight request but preserve anchor and config
        // so reuseSession() can still match on re-focus.
        this.completionP = undefined;
        this.menu.hide();
    }

    // Reset state to IDLE without hiding the menu (used after handleSelect inserts text).
    public resetToIdle(): void {
        this.anchor = undefined;
        this.completionP = undefined;
        this.setPartitions([]);
        this.menuSepLevel = 0;
        this.explicitCloseAnchor = undefined;
    }

    // Called when the user explicitly dismisses the menu (e.g. Escape key).
    //
    // Three outcomes:
    //   1. Level shift — a different SepLevel has items the user hasn't
    //      seen.  Shift the trie and show the new items (no backend call).
    //   2. No advance — IDLE or input equals anchor.  A refetch would
    //      return identical data.  Just hide the menu.
    //   3. Hide/slide — noMatchPolicy is "accept" or "slide" and the
    //      input still extends the anchor.  No refetch can help.
    //   4. Refetch — input advanced past the anchor at the same level
    //      and noMatchPolicy allows it.  When the backend returns the
    //      same anchor (startIndex unchanged), reopening is suppressed.
    public explicitHide(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
        direction: CompletionDirection,
    ): void {
        this.completionP = undefined; // cancel any in-flight fetch

        // IDLE — no session data, nothing to shift or refetch.
        if (this.anchor === undefined) {
            this.menu.hide();
            return;
        }

        // If a different SepLevel is reachable, shift to it — the user
        // sees new items without a backend round-trip.
        if (input.startsWith(this.anchor)) {
            const rawPrefix = input.substring(this.anchor.length);
            const sepLevel = computeSepLevel(rawPrefix);
            if (sepLevel !== this.menuSepLevel) {
                const newLevel = targetLevel(this.levelCounts, sepLevel);
                if (newLevel !== undefined && newLevel !== this.menuSepLevel) {
                    this.loadLevel(newLevel);
                    this.positionMenu(rawPrefix, getPosition);
                    return;
                }
            }
        }

        // No level shift available.  If input hasn't advanced past
        // the anchor, a refetch would return identical results — just hide.
        if (input === this.anchor || this.noMatchPolicy !== "refetch") {
            this.menu.hide();
            return;
        }

        // Save anchor so startNewSession can compare after the result arrives.
        this.explicitCloseAnchor = this.anchor;
        this.startNewSession(input, getPosition, direction);
    }

    // Returns the text typed after the anchor, or undefined when
    // the input has diverged past the anchor or no items are loaded.
    public getCompletionPrefix(input: string): string | undefined {
        const anchor = this.anchor;
        if (anchor === undefined || !input.startsWith(anchor)) {
            return undefined;
        }
        const rawPrefix = input.substring(anchor.length);
        if (computeSepLevel(rawPrefix) < this.menuSepLevel) {
            return undefined;
        }
        if (this.levelCounts[this.menuSepLevel] === 0) {
            return undefined;
        }
        return stripAtLevel(rawPrefix, this.menuSepLevel);
    }

    // Decides whether the current session can service `input` without a new
    // backend fetch.  Returns true to reuse, false to trigger a re-fetch.
    //
    // Decision table (two-anchor model — see docs/architecture/completion.md):
    //
    // A. Session validity — is the data still usable?
    //   A1  PENDING    completionP !== undefined                   → wait
    //   A2  IDLE       anchor === undefined                        → re-fetch
    //   A3  DIVERGED   !input.startsWith(anchor)                   → re-fetch
    //   A4  DIR-SENS   backward + dirSensitive + input===anchor    → re-fetch
    //
    // B. Menu anchor — is the trie at the right level?
    //   B1  NARROW     sepLevel < menuSepLevel + items at sepLevel → narrow, → C
    //   B2  BEFORE-MENU  sepLevel < menuSepLevel + no items        → hide+keep
    //
    // C. Trie matching — does the menu have results?
    //   C1  UNIQUE     uniquelySatisfied                           → re-fetch
    //   C2  COMMITTED  committed past boundary                     → re-fetch
    //   C3  ACTIVE     menu.isActive()                             → reuse
    //
    // D. Exhaustion cascade — menu has no matches
    //   D1  WIDEN      sepLevel > menuSepLevel                     → widen, → C
    //   D2  SLIDE      noMatchPolicy=slide                         → slide anchor
    //   D3  REFETCH    noMatchPolicy=refetch                       → re-fetch
    //   D4  ACCEPT     noMatchPolicy=accept                        → reuse (quiet)
    // ── A. Session validity ─────────────────────────────────────────
    // Returns the anchor when the session is active and valid for
    // the given input, or `undefined` when a re-fetch is needed.
    // Checks A2 (IDLE), A3 (DIVERGED), A4 (DIR-SENS).
    // Caller must check A1 (PENDING) before calling.
    private getActiveAnchor(
        input: string,
        direction: CompletionDirection,
    ): string | undefined {
        // [A2] IDLE — no session, must fetch.
        if (this.anchor === undefined) {
            debug(`Partial completion re-fetch: no active session (IDLE)`);
            return undefined;
        }

        const { anchor } = this;

        // [A3] DIVERGED — input moved past the anchor.
        if (!input.startsWith(anchor)) {
            debug(
                `Partial completion re-fetch: anchor diverged (anchor='${anchor}', input='${input}')`,
            );
            return undefined;
        }

        // [A4] DIR-SENS — backward at a direction-sensitive anchor.
        if (
            direction === "backward" &&
            this.directionSensitive &&
            input === anchor
        ) {
            debug(
                `Partial completion re-fetch: backward at anchor, directionSensitive`,
            );
            return undefined;
        }

        return anchor;
    }

    private reuseSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
        direction: CompletionDirection,
    ): boolean {
        // ── A. Session validity ──────────────────────────────────────
        // [A1] PENDING — a fetch is already in flight, wait.
        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${this.anchor}`);
            return true;
        }

        // [A2] - [A4]
        const anchor = this.getActiveAnchor(input, direction);
        if (anchor === undefined) {
            return false;
        }
        const { noMatchPolicy } = this;

        const rawPrefix = input.substring(anchor.length);
        const sepLevel = computeSepLevel(rawPrefix);

        // ── B. Menu anchor — is the trie at the right level? ─────────

        if (sepLevel < this.menuSepLevel) {
            if (this.levelCounts[sepLevel] > 0) {
                // [B1] NARROW — user backed into a lower level that has items.
                this.loadLevel(sepLevel);
                // Fall through to C.
            } else if (rawPrefix === "") {
                // [B2] BEFORE-MENU — at anchor, waiting for separator.
                debug(
                    `Partial completion deferred: sepLevel=${sepLevel} < menuSepLevel=${this.menuSepLevel}, no items`,
                );
                this.menu.hide();
                return true;
            } else if (noMatchPolicy === "slide") {
                // Separator expected but non-separator typed; slide anchor.
                debug(
                    `Partial completion anchor slide: '${anchor}' → '${input}'`,
                );
                this.anchor = input;
                this.menu.hide();
                return true;
            } else {
                // Separator expected but non-separator typed; re-fetch.
                debug(
                    `Partial completion re-fetch: non-separator at sepLevel=${sepLevel}, menuSepLevel=${this.menuSepLevel}`,
                );
                return false;
            }
        }

        // At the anchor with no items loaded — hide and wait.
        // Covers error-recovery (anchor preserved but no data) and
        // genuinely empty results at rawPrefix="".
        if (rawPrefix === "" && this.levelCounts[this.menuSepLevel] === 0) {
            debug(
                `Partial completion deferred: no items at menuSepLevel=${this.menuSepLevel}`,
            );
            this.menu.hide();
            return true;
        }

        // ── C + D loop: trie matching with exhaustion cascade ────────

        for (;;) {
            const uniquelySatisfied = this.positionMenu(rawPrefix, getPosition);

            // [C1] UNIQUE — exactly one match, re-fetch for next level.
            if (uniquelySatisfied) {
                debug(`Partial completion re-fetch: uniquely satisfied`);
                return false;
            }

            // [C2] COMMITTED — separator after a valid match.
            const completionPrefix = stripAtLevel(rawPrefix, this.menuSepLevel);
            const sepMatch = completionPrefix.match(/^(.+?)[\s\p{P}]/u);
            if (sepMatch !== null && this.menu.hasExactMatch(sepMatch[1])) {
                debug(
                    `Partial completion re-fetch: '${sepMatch[1]}' committed with separator`,
                );
                return false;
            }

            // [C3] ACTIVE — trie has matches, menu visible.
            if (this.menu.isActive()) {
                debug(`Partial completion reuse: menuActive=true`);
                return true;
            }

            // ── D. Exhaustion cascade ────────────────────────────────

            // [D1] WIDEN — higher level available, reload trie.
            // Guard: menuSepLevel can only increase (0→1→2) and sepLevel
            // is at most 2, so the loop terminates in ≤2 iterations.
            if (sepLevel > this.menuSepLevel && this.menuSepLevel < 2) {
                this.loadLevel((this.menuSepLevel + 1) as SepLevel);
                debug(
                    `Partial completion widen: menuSepLevel=${this.menuSepLevel}`,
                );
                continue; // loop back to C
            }

            // [D2] SLIDE — wildcard boundary, slide anchor forward.
            if (noMatchPolicy === "slide") {
                debug(
                    `Partial completion anchor slide: '${anchor}' → '${input}'`,
                );
                this.anchor = input;
                this.menu.hide();
                return true;
            }

            // [D3] REFETCH — open-ended set, backend may know more.
            if (noMatchPolicy === "refetch") {
                debug(
                    `Partial completion re-fetch: noMatchPolicy=refetch, menu exhausted`,
                );
                return false;
            }

            // [D4] ACCEPT — exhaustive set, nothing else to show.
            debug(
                `Partial completion reuse: noMatchPolicy=accept, menu exhausted`,
            );
            return true;
        }
    }

    // Start a new completion session: issue backend request and process result.
    private startNewSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
        direction: CompletionDirection,
    ): void {
        debug(`Partial completion start: '${input}' direction=${direction}`);
        this.menu.hide();
        this.menu.setChoices([]);
        this.anchor = input;
        this.setPartitions([]);
        this.menuSepLevel = 0;
        this.noMatchPolicy = "refetch";
        const completionP = this.dispatcher.getCommandCompletion(
            input,
            direction,
        );
        this.completionP = completionP;
        completionP
            .then((result) => {
                if (this.completionP !== completionP) {
                    debug(`Partial completion canceled: '${input}'`);
                    return;
                }

                this.completionP = undefined;
                debug(`Partial completion result: `, result);

                this.noMatchPolicy = computeNoMatchPolicy(
                    result.closedSet,
                    result.afterWildcard,
                );
                this.directionSensitive = result.directionSensitive;

                const partitions = toPartitions(
                    result.completions,
                    input,
                    result.startIndex,
                );

                if (partitions.length === 0) {
                    debug(
                        `Partial completion skipped: No completions for '${input}'`,
                    );
                    this.setPartitions([]);
                    return;
                }

                // Anchor the session at the resolved prefix so
                // subsequent keystrokes filter within the trie.
                const partial =
                    result.startIndex >= 0 && result.startIndex <= input.length
                        ? input.substring(0, result.startIndex)
                        : input;
                this.anchor = partial;
                this.setPartitions(partitions);

                // Pick the best trie level for the caller's input:
                // highest level ≤ inputSepLevel with items, falling
                // back to lowestLevelWithItems for skip-ahead.
                // When no level has items (shouldn't happen — we
                // checked partitions.length > 0), default to level 0.
                const rawPrefix = input.substring(partial.length);
                this.loadLevel(
                    targetLevel(this.levelCounts, computeSepLevel(rawPrefix)) ??
                        0,
                );

                // If triggered by an explicit close, only reopen when the
                // anchor advanced.  Same anchor means the same completions at
                // the same position — the user already dismissed them.
                const explicitCloseAnchor = this.explicitCloseAnchor;
                this.explicitCloseAnchor = undefined;
                if (
                    explicitCloseAnchor !== undefined &&
                    partial === explicitCloseAnchor
                ) {
                    debug(
                        `Partial completion explicit-hide: anchor unchanged ('${partial}'), suppressing reopen`,
                    );
                    return;
                }

                // Re-run update with captured input to show the menu (or defer
                // if no items are visible yet).
                this.reuseSession(input, getPosition, direction);
            })
            .catch((e) => {
                debugError(`Partial completion error: '${input}' ${e}`);
                // On error, clear the in-flight promise but preserve the
                // anchor so that identical input reuses the session (no
                // re-fetch) while diverged input still triggers a new fetch.
                this.completionP = undefined;
                this.explicitCloseAnchor = undefined;
            });
    }
}

// ── SepLevel: separator progression model ────────────────────────────────
//
// Three ordered levels describing the leading separator characters in
// rawPrefix (text typed after the anchor).  Each level defines which
// SeparatorMode values are visible and how to strip the separator
// before passing the remainder to the trie.
//
// Level 0 (none):      No separator.  Items needing no separator.
// Level 1 (space):     Whitespace present.  Strip whitespace only.
// Level 2 (spacePunc): Whitespace + punctuation.  Strip both.

// SeparatorMode after "autoSpacePunctuation" has been resolved per-item
// and undefined has been defaulted to "space".  Partitions always use
// this type — no deferred or missing modes at the shell level.
type ResolvedSeparatorMode = Exclude<SeparatorMode, "autoSpacePunctuation">;

// Visibility matrix (non-cumulative, per-level):
//
//   ResolvedSeparatorMode       Lv0  Lv1  Lv2
//   "none"                       ✓    —    —
//   "optionalSpace"              ✓    ✓    —
//   "optionalSpacePunctuation"   ✓    ✓    ✓
//   "space"                      —    ✓    —
//   "spacePunctuation"           —    ✓    ✓
//
// Each level has its own set of items.  Widening replaces the trie
// (not appends).

type SepLevel = 0 | 1 | 2;

function computeSepLevel(rawPrefix: string): SepLevel {
    if (rawPrefix === "") return 0;
    // Check the leading separator portion for whitespace and punctuation.
    const leadingSep = rawPrefix.match(/^[\s\p{P}]+/u);
    if (leadingSep === null) return 0;
    const sep = leadingSep[0];
    if (/\p{P}/u.test(sep)) return 2;
    // Only whitespace in the leading separator portion.
    return 1;
}

// Returns true when a partition's separatorMode belongs to the given
// level per the visibility matrix.  Non-cumulative.
function isModeAtLevel(mode: ResolvedSeparatorMode, level: SepLevel): boolean {
    switch (level) {
        case 0:
            return (
                mode === "none" ||
                mode === "optionalSpace" ||
                mode === "optionalSpacePunctuation"
            );
        case 1:
            return (
                mode === "space" ||
                mode === "optionalSpace" ||
                mode === "optionalSpacePunctuation" ||
                mode === "spacePunctuation"
            );
        case 2:
            return (
                mode === "optionalSpacePunctuation" ||
                mode === "spacePunctuation"
            );
    }
}

// Returns items from partitions whose separatorMode belongs to the
// given level.  Non-cumulative — each level has its own item set.
// Only called by loadLevel (which needs the actual items).
function itemsAtLevel(
    partitions: ItemPartition[],
    level: SepLevel,
): SearchMenuItem[] {
    const result: SearchMenuItem[] = [];
    for (const p of partitions) {
        if (isModeAtLevel(p.mode, level)) {
            for (const item of p.items) {
                result.push(item);
            }
        }
    }
    return result;
}

// Precomputed item counts per SepLevel.  Avoids rebuilding arrays
// on every keystroke for the many count-only checks.
type LevelCounts = [number, number, number];

function computeLevelCounts(partitions: ItemPartition[]): LevelCounts {
    const counts: LevelCounts = [0, 0, 0];
    for (const p of partitions) {
        for (let level = 0; level <= 2; level++) {
            if (isModeAtLevel(p.mode, level as SepLevel)) {
                counts[level] += p.items.length;
            }
        }
    }
    return counts;
}

// Returns the lowest SepLevel that has items, or undefined when all
// counts are zero.
function lowestLevelWithItems(counts: LevelCounts): SepLevel | undefined {
    for (let level = 0; level <= 2; level++) {
        if (counts[level] > 0) {
            return level as SepLevel;
        }
    }
    return undefined;
}

// Returns the highest SepLevel ≤ maxLevel that has items, falling back
// to lowestLevelWithItems when nothing exists at or below maxLevel
// (e.g. entities that only appear at level 1+).  Returns undefined when
// no level has items at all.
function targetLevel(
    counts: LevelCounts,
    maxLevel: SepLevel,
): SepLevel | undefined {
    for (let l = maxLevel; l > 0; l--) {
        if (counts[l] > 0) {
            return l as SepLevel;
        }
    }
    return lowestLevelWithItems(counts);
}

// Strip leading separator characters from rawPrefix based on the level.
function stripAtLevel(rawPrefix: string, level: SepLevel): string {
    switch (level) {
        case 0:
            return rawPrefix;
        case 1:
            return rawPrefix.trimStart();
        case 2:
            return rawPrefix.replace(/^[\s\p{P}]+/u, "");
    }
}

// An items-by-mode bucket.  Each partition holds the items from one or more
// CompletionGroups that share the same separatorMode.
type ItemPartition = {
    mode: ResolvedSeparatorMode;
    items: SearchMenuItem[];
};

// Convert backend CompletionGroups into partitions keyed by separatorMode,
// preserving group order and sorting within each group.
//
// Groups with separatorMode="autoSpacePunctuation" are resolved per-item:
// each completion is assigned "spacePunctuation" or
// "optionalSpacePunctuation" based on the character pair
// (input[startIndex-1], completion[0]).  This preserves the agent's
// original ordering across the resulting partitions via sortIndex.
function toPartitions(
    groups: CompletionGroup[],
    input: string,
    startIndex: number,
): ItemPartition[] {
    const map = new Map<ResolvedSeparatorMode, SearchMenuItem[]>();
    let sortIndex = 0;

    function addItem(
        mode: ResolvedSeparatorMode,
        choice: string,
        group: CompletionGroup,
    ): void {
        let bucket = map.get(mode);
        if (bucket === undefined) {
            bucket = [];
            map.set(mode, bucket);
        }
        bucket.push({
            matchText: choice,
            selectedText: choice,
            sortIndex: sortIndex++,
            needQuotes: group.needQuotes,
            emojiChar: group.emojiChar,
        });
    }

    for (const group of groups) {
        const sorted = group.sorted
            ? group.completions
            : [...group.completions].sort();
        if (group.separatorMode === "autoSpacePunctuation") {
            // Resolve per-item: inspect character pair to determine
            // whether a separator is needed.
            for (const choice of sorted) {
                const needsSep =
                    startIndex > 0 &&
                    choice.length > 0 &&
                    needsSeparatorInAutoMode(input[startIndex - 1], choice[0]);
                addItem(
                    needsSep ? "spacePunctuation" : "optionalSpacePunctuation",
                    choice,
                    group,
                );
            }
        } else {
            // Resolve undefined → "space" (the default separatorMode).
            const mode: ResolvedSeparatorMode = group.separatorMode ?? "space";
            for (const choice of sorted) {
                addItem(mode, choice, group);
            }
        }
    }
    return Array.from(map, ([mode, items]) => ({ mode, items }));
}
