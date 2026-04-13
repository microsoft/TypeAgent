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
//   - `menuAnchorIndex` + `menuSepLevel` (trie matching): the trie receives
//     input[menuAnchorIndex..] directly (no stripping).  Characters between
//     anchor.length and menuAnchorIndex have been consumed as separator.
//     When the trie exhausts, one leading separator char is consumed
//     (menuAnchorIndex += 1), the level is advanced if needed, and the
//     trie is retried — progressive consumption.
//
// Design principles:
//   - Completion result fields (per-group separatorMode, etc.) are stored as-is
//     from the backend response and never mutated.
//   - Per-group separatorMode determines which groups belong to each SepLevel.
//     Non-cumulative: each level has its own set of items.  Loading a new
//     level replaces the trie rather than appending.
//   - reuseSession() follows a decision table: A (session validity),
//     B (narrowing / level shift), C (trie matching), D (progressive consumption).
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
    private menuSepLevel: SepLevel = 0;
    // Position in the input where trie matching starts.  Always
    // >= anchor.length.  The gap between anchor.length and
    // menuAnchorIndex is the "consumed separator".
    private menuAnchorIndex: number = 0;
    // The text that was consumed as separator between anchor.length and
    // menuAnchorIndex.  Stored as the actual string (not just a length)
    // to detect when the consumed region has been overwritten with
    // different separator characters at the same position (e.g. user
    // replaced " ." with "  " — same length but different text,
    // requiring a level re-derivation via B1 NARROW).
    private consumedSep: string = "";
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
    // Shared by reuseSession (narrow/consume), startNewSession (initial load),
    // and explicitHide (level change on dismiss).
    private loadLevel(level: SepLevel): void {
        this.menuSepLevel = level;
        const items = itemsAtLevel(this.partitions, level);
        this.menu.setChoices(items);
        if (items.length === 0) {
            // setChoices does not reset the active state, so hide explicitly
            // when loading an empty level to avoid stale isActive().
            this.menu.hide();
        }
    }

    // Update partitions and recompute levelCounts.
    private setPartitions(partitions: ItemPartition[]): void {
        this.partitions = partitions;
        this.levelCounts = computeLevelCounts(partitions);
    }

    // Compute the menu position and update the trie prefix.  rawPrefix
    // is input[menuAnchorIndex..] — already past the consumed separator.
    // Returns true when the prefix uniquely satisfies one entry; hides
    // the menu when position cannot be determined.
    private positionMenu(
        rawPrefix: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): boolean {
        const position = getPosition(rawPrefix);
        if (position !== undefined) {
            return this.menu.updatePrefix(rawPrefix, position);
        }
        this.menu.hide();
        return false;
    }

    // Slide the anchor forward to the current input, clearing consumed
    // separator state.  Used by "slide" noMatchPolicy when the trie
    // exhausts at a wildcard boundary.
    private slideAnchor(input: string): void {
        this.anchor = input;
        this.menuAnchorIndex = input.length;
        this.consumedSep = "";
        this.menu.hide();
    }

    // Shift the trie to the level implied by the leading separator chars
    // in rawPrefix.  Updates menuAnchorIndex, consumedSep, and loads the
    // target level.  Returns the new SepLevel, or undefined when no level
    // has items at all.
    // Shared by B1 NARROW (backspace or separator text change) and
    // explicitHide (Escape).
    private shiftToSepLevel(rawPrefix: string): SepLevel | undefined {
        const sepLevel = computeSepLevel(rawPrefix);
        const newLevel = targetLevel(this.levelCounts, sepLevel);
        const sepLen = leadingSeparatorLength(rawPrefix);
        this.menuAnchorIndex = this.anchor!.length + sepLen;
        this.consumedSep = rawPrefix.substring(0, sepLen);
        if (newLevel !== undefined) {
            this.loadLevel(newLevel);
        }
        return newLevel;
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
        this.menuAnchorIndex = 0;
        this.consumedSep = "";
        this.explicitCloseAnchor = undefined;
    }

    // Called when the user explicitly dismisses the menu (e.g. Escape key).
    //
    // Four outcomes:
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
                const prevLevel = this.menuSepLevel;
                const newLevel = this.shiftToSepLevel(rawPrefix);
                if (newLevel !== undefined && newLevel !== prevLevel) {
                    this.positionMenu(
                        input.substring(this.menuAnchorIndex),
                        getPosition,
                    );
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

    // Returns the text typed after the menu anchor, or undefined when
    // the input has diverged or no items are loaded.
    public getCompletionPrefix(input: string): string | undefined {
        const anchor = this.anchor;
        if (anchor === undefined || !input.startsWith(anchor)) {
            return undefined;
        }
        if (input.length < this.menuAnchorIndex) {
            return undefined;
        }
        // Deferred — separator not yet consumed; no valid prefix.
        if (this.menuSepLevel > 0 && this.consumedSep === "") {
            return undefined;
        }
        return input.substring(this.menuAnchorIndex);
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
    // B. Narrowing — consumed separator region invalidated?
    //   B1  NARROW     input.length < menuAnchorIndex OR           → shift to level
    //                  consumedSep text mismatch
    //
    // Pre-loop guards (between B and C):
    //   DEFERRED-EMPTY  no items at current level + rawPrefix=""   → hide+keep
    //   DEFERRED-SEP    menuSepLevel>0, consumedSep="", rawPrefix="" → hide+keep
    //   DEFERRED-SLIDE  menuSepLevel>0, consumedSep="", non-sep char, slide → slide
    //   DEFERRED-REFETCH menuSepLevel>0, consumedSep="", non-sep char       → re-fetch
    //
    // C. Trie matching — does the menu have results?
    //   C1  UNIQUE     uniquelySatisfied                           → re-fetch
    //   C2  COMMITTED  committed past boundary                     → re-fetch
    //   C3  ACTIVE     menu.isActive()                             → reuse
    //
    // D. Progressive consumption — consume leading separator, retry
    //   D1  CONSUME    leading char is separator                   → consume, → C
    //   D2  SLIDE      noMatchPolicy=slide                         → slide anchor
    //   D3  REFETCH    noMatchPolicy=refetch                       → re-fetch
    //   D4  ACCEPT     noMatchPolicy=accept                        → reuse (quiet)

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

        // ── B. Narrowing — consumed separator region invalidated? ──

        if (
            input.length < this.menuAnchorIndex ||
            input.substring(anchor.length, this.menuAnchorIndex) !==
                this.consumedSep
        ) {
            // [B1] NARROW — shift to the level implied by the
            // remaining separator chars (symmetric with forward).
            const rawPrefix = input.substring(anchor.length);
            this.shiftToSepLevel(rawPrefix);
            debug(
                `Partial completion narrow: menuAnchorIndex=${this.menuAnchorIndex}, menuSepLevel=${this.menuSepLevel}`,
            );
            // Fall through to C.
        }

        const rawPrefix = input.substring(this.menuAnchorIndex);

        // ── Deferred / empty checks ──────────────────────────────────

        // No items at the current level (error recovery, empty results).
        // This can happen after a fetch error (catch preserves anchor but
        // partitions stay empty) or when the backend returns zero completions.
        // Typing one character forward escapes this — rawPrefix becomes
        // non-empty and the normal C+D path runs.
        if (rawPrefix === "" && this.levelCounts[this.menuSepLevel] === 0) {
            debug(
                `Partial completion deferred: no items at menuSepLevel=${this.menuSepLevel}`,
            );
            this.menu.hide();
            return true;
        }

        // Level requires separator but none consumed — items are pre-
        // loaded but must stay hidden until a separator char is typed.
        if (this.menuSepLevel > 0 && this.consumedSep === "") {
            if (rawPrefix === "") {
                // At the anchor with nothing to consume — hide and wait.
                debug(
                    `Partial completion deferred: separator needed, menuSepLevel=${this.menuSepLevel}`,
                );
                this.menu.hide();
                return true;
            }

            // rawPrefix non-empty: check if first char is separator.
            if (separatorCharLevel(rawPrefix[0]) === undefined) {
                // Non-separator typed where separator was expected.
                // Only slide has special handling — it tracks the user
                // forward past wildcard boundaries.  For accept/refetch,
                // the user may be going in a different direction entirely
                // (e.g. "playx" vs "play song"), so always re-fetch to
                // let the backend re-evaluate the whole input.
                if (this.noMatchPolicy === "slide") {
                    debug(
                        `Partial completion anchor slide: '${anchor}' → '${input}'`,
                    );
                    this.slideAnchor(input);
                    return true;
                }
                debug(
                    `Partial completion re-fetch: non-separator at menuSepLevel=${this.menuSepLevel}`,
                );
                return false;
            }
            // Starts with separator — fall through to C+D for consumption.
        }

        // ── C + D: trie matching with progressive consumption ─────
        return this.matchOrConsume(input, rawPrefix, getPosition);
    }

    // ── A. Session validity ─────────────────────────────────────────
    // Returns the anchor when the session is active and valid for
    // the given input, or `undefined` when a re-fetch is needed.
    // Checks A2 (IDLE), A3 (DIVERGED), A4 (DIR-SENS).
    // Caller must check A1 (PENDING) before calling.
    private getActiveAnchor(
        input: string,
        direction: CompletionDirection,
    ): string | undefined {
        const anchor = this.anchor;

        // [A2] IDLE — no session, must fetch.
        if (anchor === undefined) {
            debug(`Partial completion re-fetch: no active session (IDLE)`);
            return undefined;
        }

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

    // C + D: attempt trie match, then progressively consume leading
    // separator characters and retry.  Returns true to reuse the
    // session, false to trigger a re-fetch.
    private matchOrConsume(
        input: string,
        rawPrefix: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): boolean {
        for (;;) {
            const uniquelySatisfied = this.positionMenu(rawPrefix, getPosition);

            // [C1] UNIQUE — exactly one match, re-fetch for next level.
            if (uniquelySatisfied) {
                debug(`Partial completion re-fetch: uniquely satisfied`);
                return false;
            }

            // [C2] COMMITTED — separator after a valid match.
            const sepMatch = rawPrefix.match(/^(.+?)[\s\p{P}]/u);
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

            // ── D. Progressive consumption ───────────────────────────

            // [D1] CONSUME — leading char is a separator character.
            // Consume it and advance the level if the char is higher.
            // Any separator char is consumable regardless of the current
            // level — e.g. a space after punctuation at L2 is still
            // separator text, not the start of a trie prefix.
            // Guard: menuAnchorIndex strictly increases each iteration,
            // bounded by input.length, so the loop terminates.
            if (rawPrefix.length === 0) break;
            const charLevel = separatorCharLevel(rawPrefix[0]);
            if (charLevel === undefined) break;

            this.consumedSep += rawPrefix[0];
            this.menuAnchorIndex += 1;
            if (charLevel > this.menuSepLevel) {
                this.loadLevel(charLevel);
            }
            rawPrefix = input.substring(this.menuAnchorIndex);
            debug(
                `Partial completion consume: menuAnchorIndex=${this.menuAnchorIndex}, menuSepLevel=${this.menuSepLevel}`,
            );
        }

        // ── D2–D4: no-match policy ──────────────────────────────────

        // [D2] SLIDE — wildcard boundary, slide anchor forward.
        if (this.noMatchPolicy === "slide") {
            debug(
                `Partial completion anchor slide: '${this.anchor}' → '${input}'`,
            );
            this.slideAnchor(input);
            return true;
        }

        // [D3] REFETCH — open-ended set, backend may know more.
        if (this.noMatchPolicy === "refetch") {
            debug(
                `Partial completion re-fetch: noMatchPolicy=refetch, menu exhausted`,
            );
            return false;
        }

        // [D4] ACCEPT — exhaustive set, nothing else to show.
        debug(`Partial completion reuse: noMatchPolicy=accept, menu exhausted`);
        return true;
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
        this.menuAnchorIndex = input.length;
        this.consumedSep = "";
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
                this.menuAnchorIndex = partial.length;
                this.consumedSep = "";
                this.setPartitions(partitions);

                // Start at the lowest non-empty level to avoid
                // parking at an empty L0 that requires consumption.
                const lowest = lowestLevelWithItems(this.levelCounts);
                this.loadLevel(lowest ?? 0);

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
// Three ordered levels describing what separator characters have been
// consumed between anchor and menuAnchorIndex.  Each level defines which
// SeparatorMode values are visible in the trie.
//
// Level 0 (none):      No separator consumed.
// Level 1 (space):     Whitespace consumed.
// Level 2 (spacePunctuation): Whitespace + punctuation consumed.

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
// Each level has its own set of items.  Loading a new level replaces
// the trie (not appends).

type SepLevel = 0 | 1 | 2;

// Cached regexes for separator character classification.
const punctRe = /\p{P}/u;
const whitespaceRe = /\s/;

// Returns the SepLevel corresponding to a single character:
// 2 for Unicode punctuation, 1 for whitespace, undefined otherwise.
function separatorCharLevel(ch: string): SepLevel | undefined {
    if (punctRe.test(ch)) return 2;
    if (whitespaceRe.test(ch)) return 1;
    return undefined;
}

const leadingSepRe = /^[\s\p{P}]+/u;

// Returns the length of the leading separator run in rawPrefix.
function leadingSeparatorLength(rawPrefix: string): number {
    const m = rawPrefix.match(leadingSepRe);
    return m !== null ? m[0].length : 0;
}

function computeSepLevel(rawPrefix: string): SepLevel {
    if (rawPrefix === "") return 0;
    // Check the leading separator portion for whitespace and punctuation.
    const leadingSep = rawPrefix.match(leadingSepRe);
    if (leadingSep === null) return 0;
    const sep = leadingSep[0];
    if (punctRe.test(sep)) return 2;
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
