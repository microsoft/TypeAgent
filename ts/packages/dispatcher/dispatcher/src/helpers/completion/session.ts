// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "@typeagent/dispatcher-types";
import { needsSeparatorInAutoMode } from "action-grammar/completion";
import {
    AfterWildcard,
    CompletionDirection,
    CompletionGroup,
    SeparatorMode,
} from "@typeagent/agent-sdk";
import {
    SearchMenuItem,
    TSTSearchMenuIndex,
    isUniquelySatisfied,
} from "./searchMenu.js";
import registerDebug from "debug";
import type { CompletionController } from "./controller.js";

const debug = registerDebug("typeagent:completion:session");
const debugError = registerDebug("typeagent:completion:session:error");

// C2 COMMITTED: matches a trie-entry followed by a separator character.
// Cached at module scope to avoid per-keystroke regex allocation.
const committedSepRe = /^(.+?)[\s\p{P}]/u;

export type CompletionState = {
    items: SearchMenuItem[];
    prefix: string;
    anchorIndex: number;
    // Monotonically increasing counter, bumped whenever the trie is
    // reloaded (level change, new session result).  Lets callers detect
    // item-set changes even when prefix and anchorIndex are unchanged.
    generation: number;
};

export interface ICompletionDispatcher {
    getCommandCompletion(
        input: string,
        direction: CompletionDirection,
    ): Promise<CommandCompletionResult>;
}

// Describes what the host should do when the local trie has no matches
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
// Architecture: docs/architecture/completion.md — §5 Completion Session
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession implements CompletionController {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private anchor: string | undefined = undefined;

    // Items partitioned by separatorMode from the last result.
    private partitions: ItemPartition[] = [];
    // Precomputed item counts per SepLevel.  Updated whenever
    // partitions change (setPartitions / accept).
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

    // Set when the user dismisses completions (e.g. Escape).
    // startNewSession uses this to suppress reopening if the refetch returns
    // the same anchor — meaning the completions are unchanged and the user
    // already dismissed them.
    private dismissAnchor: string | undefined = undefined;

    // The input text from the most recent update() or dismiss() call.
    // Used to compute the cached completionState.
    // Safe to read in async callbacks (.then/.catch) without synchronization
    // because JavaScript is single-threaded — the value is always set
    // synchronously before any async operation begins, and microtask
    // callbacks see the latest value.
    private lastInput: string = "";

    // The direction from the most recent update() or dismiss() call.
    // Used by async callbacks to reconcile with the latest user intent.
    // Same single-threaded safety guarantee as lastInput.
    private lastDirection: CompletionDirection = "forward";

    // Cached completion state, recomputed at every mutation point.
    // Callers retrieve this via getCompletionState().
    private completionState: CompletionState | undefined = undefined;

    // Internal trie backing the SearchMenuIndex interface.
    private readonly searchMenuIndex = new TSTSearchMenuIndex();

    // Monotonically increasing counter, bumped on every loadLevel() call.
    // Exposed via CompletionState.generation so callers can detect
    // item-set changes without comparing items by reference.
    private generation: number = 0;

    // Callback fired whenever completion state changes.
    private onUpdate: () => void;

    constructor(
        private readonly dispatcher: ICompletionDispatcher,
        onUpdate?: () => void,
    ) {
        this.onUpdate = onUpdate ?? (() => {});
    }

    public setOnUpdate(onUpdate: () => void): void {
        this.onUpdate = onUpdate;
    }

    // Load the trie with items for the given level and set menuSepLevel.
    // Shared by reuseSession (narrow/consume), startNewSession (initial load),
    // and dismiss (level change on dismiss).
    private loadLevel(level: SepLevel): void {
        this.menuSepLevel = level;
        const items = itemsAtLevel(this.partitions, level);
        this.searchMenuIndex.setItems(items);
        this.generation++;
    }

    // Update partitions and recompute levelCounts.
    private setPartitions(partitions: ItemPartition[]): void {
        this.partitions = partitions;
        this.levelCounts = computeLevelCounts(partitions);
    }

    // Update the cached completionState and fire the onUpdate callback.
    // Skips firing when transitioning from undefined to undefined (no
    // visible change — avoids redundant hide() calls in the renderer).
    private setCompletionState(state: CompletionState | undefined): void {
        if (state === undefined && this.completionState === undefined) {
            return;
        }
        this.completionState = state;
        this.onUpdate();
    }

    // Slide the anchor forward to the current input, clearing consumed
    // separator state.  Used by "slide" noMatchPolicy when the trie
    // exhausts at a wildcard boundary.
    private slideAnchor(input: string): void {
        this.anchor = input;
        this.menuAnchorIndex = input.length;
        this.consumedSep = "";
        // After sliding, prefix is "".  If the trie is loaded at a
        // level that requires separator (menuSepLevel > 0), items must
        // stay hidden until a separator char is typed (deferred state).
        this.setCompletionState(
            this.menuSepLevel > 0
                ? undefined
                : this.filterForState("", input.length),
        );
    }

    // Shift the trie to the level implied by the leading separator chars
    // in rawPrefix.  Updates menuAnchorIndex, consumedSep, and loads the
    // target level.  Returns the new SepLevel, or undefined when no level
    // has items at all.
    // Shared by B1 NARROW (backspace or separator text change) and
    // dismiss (Escape).
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

    // Main entry point.  Called on each keystroke after the host validates cursor position.
    public update(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.lastInput = input;
        this.lastDirection = direction;
        if (this.reuseSession(input, direction)) {
            return;
        }

        this.fetchNewSession(input, direction);
    }

    // Hide completions and cancel any in-flight fetch, but preserve session
    // state so reuseSession() can still match the anchor if the user
    // returns (e.g. cursor moved away then back without typing).
    public hide(): void {
        // Cancel any in-flight request but preserve anchor and config
        // so reuseSession() can still match on re-focus.
        this.completionP = undefined;
        this.setCompletionState(undefined);
    }

    /** Accept the current completion (Tab/Enter). Resets session to idle. */
    public accept(): void {
        this.anchor = undefined;
        this.completionP = undefined;
        this.setPartitions([]);
        this.menuSepLevel = 0;
        this.menuAnchorIndex = 0;
        this.consumedSep = "";
        this.dismissAnchor = undefined;
        this.lastInput = "";
        this.lastDirection = "forward";
        this.setCompletionState(undefined);
    }

    /**
     * Permanently shut down this session.  Clears all state, detaches
     * the onUpdate callback, and prevents further fetches.  After
     * dispose() the instance should not be reused.
     */
    public dispose(): void {
        this.accept();
        this.onUpdate = () => {};
    }

    /**
     * Dismiss completions (Escape key). Performs smart level-shift or refetch.
     *
     * Four outcomes:
     *   1. Level shift — a different SepLevel has items the user hasn't
     *      seen.  Shift the trie and show the new items (no backend call).
     *   2. No advance — IDLE or input equals anchor.  A refetch would
     *      return identical data.  Just hide the menu.
     *   3. Hide/slide — noMatchPolicy is "accept" or "slide" and the
     *      input still extends the anchor.  No refetch can help.
     *   4. Refetch — input advanced past the anchor at the same level
     *      and noMatchPolicy allows it.  When the backend returns the
     *      same anchor (startIndex unchanged), reopening is suppressed.
     *
     * @param input      Current input text
     * @param direction  Direction hint for the session
     */
    public dismiss(
        input: string,
        direction: CompletionDirection = "forward",
    ): void {
        this.lastInput = input;
        this.lastDirection = direction;
        this.completionP = undefined; // cancel any in-flight fetch

        // IDLE — no session data, nothing to shift or refetch.
        if (this.anchor === undefined) {
            this.setCompletionState(undefined);
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
                    // shiftToSepLevel loaded a new trie; filter with
                    // the post-separator prefix.
                    const prefix = input.substring(this.menuAnchorIndex);
                    this.setCompletionState(
                        this.filterForState(
                            prefix,
                            input.length - prefix.length,
                        ),
                    );
                    return;
                }
            }
        }

        // No level shift available.  If input hasn't advanced past
        // the anchor, a refetch would return identical results — just hide.
        if (input === this.anchor || this.noMatchPolicy !== "refetch") {
            this.setCompletionState(undefined);
            return;
        }

        // Save anchor so fetchNewSession can compare after the result arrives.
        this.dismissAnchor = this.anchor;
        this.fetchNewSession(input, direction);
    }

    // Returns the cached completion state, or undefined when there are
    // no completions to show.  Recomputed at every mutation point.
    public getCompletionState(): CompletionState | undefined {
        return this.completionState;
    }

    /**
     * @internal Test-only — returns all items currently loaded in the trie.
     * Not part of the {@link CompletionController} public API.
     */
    public getLoadedItems(): SearchMenuItem[] {
        return this.searchMenuIndex.filterItems("");
    }

    // Filter the trie and build a CompletionState, or return undefined
    // when items are empty or uniquely satisfied.  Used by cold paths
    // (slideAnchor, dismiss level-shift) where the caller knows the
    // prefix and anchorIndex but hasn't filtered yet.  The hot path
    // (C3 in matchOrConsume) inlines this to avoid a redundant filter.
    private filterForState(
        prefix: string,
        anchorIndex: number,
    ): CompletionState | undefined {
        const items = this.searchMenuIndex.filterItems(prefix);
        if (items.length === 0 || isUniquelySatisfied(items, prefix)) {
            return undefined;
        }
        return {
            items,
            prefix,
            anchorIndex,
            generation: this.generation,
        };
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
    //   C3  ACTIVE     trie has matches                            → reuse
    //
    // D. Progressive consumption — consume leading separator, retry
    //   D1  CONSUME    leading char is separator                   → consume, → C
    //   D2  SLIDE      noMatchPolicy=slide                         → slide anchor
    //   D3  REFETCH    noMatchPolicy=refetch                       → re-fetch
    //   D4  ACCEPT     noMatchPolicy=accept                        → reuse (quiet)

    private reuseSession(
        input: string,
        direction: CompletionDirection,
    ): boolean {
        // ── A. Session validity ──────────────────────────────────────
        // [A1] PENDING — a fetch is already in flight, wait.
        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${this.anchor}`);
            // Trie is empty (startNewSession clears it before setting
            // completionP), so filterForState would return
            // undefined — skip the redundant trie filter.
            this.setCompletionState(undefined);
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
            // Trie is empty at this level — filterItems would return []
            // and filterForState would return undefined.
            this.setCompletionState(undefined);
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
                // filterForState would return undefined
                // (menuSepLevel > 0 with no separator consumed).
                this.setCompletionState(undefined);
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
        return this.matchOrConsume(input, rawPrefix);
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
    private matchOrConsume(input: string, rawPrefix: string): boolean {
        for (;;) {
            const items = this.searchMenuIndex.filterItems(rawPrefix);

            // [C1] UNIQUE — exactly one match, re-fetch for next level.
            if (isUniquelySatisfied(items, rawPrefix)) {
                debug(`Partial completion re-fetch: uniquely satisfied`);
                return false;
            }

            // [C2] COMMITTED — separator after a valid match.
            const sepMatch = rawPrefix.match(committedSepRe);
            if (
                sepMatch !== null &&
                this.searchMenuIndex.hasExactMatch(sepMatch[1])
            ) {
                debug(
                    `Partial completion re-fetch: '${sepMatch[1]}' committed with separator`,
                );
                return false;
            }

            // [C3] ACTIVE — trie has matches for this prefix.
            // Build CompletionState inline — items and rawPrefix are
            // already computed, and all filterForState guards
            // (anchor, startsWith, menuAnchorIndex, deferred) are
            // satisfied by A/B/deferred checks above.
            if (items.length > 0) {
                debug(`Partial completion reuse: trie has matches`);
                this.setCompletionState({
                    items,
                    prefix: rawPrefix,
                    anchorIndex: input.length - rawPrefix.length,
                    generation: this.generation,
                });
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
        // Items are empty (loop exited on items.length===0), so
        // filterForState would return undefined — hide directly.
        debug(`Partial completion reuse: noMatchPolicy=accept, menu exhausted`);
        this.setCompletionState(undefined);
        return true;
    }

    // After a fetch completes (success or error), check whether the user
    // typed ahead or changed direction while the request was in flight.
    // If so, try to service the latest input with the current session
    // state (reuseSession).  Only issue a new fetch when the session
    // cannot handle it AND the input/direction actually changed — this
    // avoids infinite re-fetch loops when reuseSession legitimately
    // returns false for the same input (e.g. C1 UNIQUE).
    //
    // Note: reuseSession must always run — even when input hasn't changed
    // — because the .then() handler sets anchor to the *resolved* prefix
    // (which can be shorter than the original input).  The gap between
    // the new anchor and the full input may contain separator characters
    // that need progressive consumption (D1) and level loading.
    private reconcileTypeAhead(
        fetchInput: string,
        fetchDirection: CompletionDirection,
    ): void {
        const currentInput = this.lastInput;
        const currentDirection = this.lastDirection;
        if (!this.reuseSession(currentInput, currentDirection)) {
            if (
                currentInput !== fetchInput ||
                currentDirection !== fetchDirection
            ) {
                this.fetchNewSession(currentInput, currentDirection);
            } else {
                // reuseSession returned false for the same input (e.g. C1
                // UNIQUE, C2 COMMITTED, D3 REFETCH).  In all cases items
                // are empty or uniquely satisfied — completionState is
                // undefined.
                debug(
                    `Partial completion reconcile: reuseSession=false for same input, suppressing re-fetch`,
                );
                this.setCompletionState(undefined);
            }
        }
    }

    // Sync entry point: fires the async session and attaches a terminal
    // .catch() so unhandled rejections never escape.
    private fetchNewSession(
        input: string,
        direction: CompletionDirection,
    ): void {
        this.startNewSession(input, direction).catch((e) =>
            debugError(`Unhandled error in startNewSession: '${input}' ${e}`),
        );
    }

    // Start a new completion session: issue backend request and process result.
    private async startNewSession(
        input: string,
        direction: CompletionDirection,
    ): Promise<void> {
        debug(`Partial completion start: '${input}' direction=${direction}`);
        this.searchMenuIndex.setItems([]);
        this.anchor = input;
        this.menuAnchorIndex = input.length;
        this.consumedSep = "";
        this.setPartitions([]);
        this.menuSepLevel = 0;
        this.noMatchPolicy = "refetch";
        // Trie just cleared via setItems([]) — filterItems returns []
        // and filterForState would return undefined.
        this.setCompletionState(undefined);
        const completionP = this.dispatcher.getCommandCompletion(
            input,
            direction,
        );
        this.completionP = completionP;
        try {
            const result = await completionP;

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
                this.reconcileTypeAhead(input, direction);
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

            // If triggered by a dismiss, only reopen when the
            // anchor advanced.  Same anchor means the same completions at
            // the same position — the user already dismissed them.
            const dismissAnchor = this.dismissAnchor;
            this.dismissAnchor = undefined;
            if (
                dismissAnchor !== undefined &&
                partial === dismissAnchor &&
                this.lastInput === input &&
                this.lastDirection === direction
            ) {
                debug(
                    `Partial completion dismiss: anchor unchanged ('${partial}'), suppressing reopen`,
                );
                return;
            }

            // Use the latest input/direction — the user may have typed
            // ahead while the fetch was in flight.
            this.reconcileTypeAhead(input, direction);
        } catch (e) {
            debugError(`Partial completion error: '${input}' ${e}`);
            // On error, clear the in-flight promise but preserve the
            // anchor so that identical input reuses the session (no
            // re-fetch) while diverged input still triggers a new fetch.
            this.completionP = undefined;
            this.dismissAnchor = undefined;
            this.reconcileTypeAhead(input, direction);
        }
    }
}

// ── SepLevel: separator progression model ────────────────────────────────────
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
// this type — no deferred or missing modes at the session level.
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
