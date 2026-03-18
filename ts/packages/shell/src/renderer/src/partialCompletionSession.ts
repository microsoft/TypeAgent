// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import {
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

// PartialCompletionSession manages the state machine for command completion.
//
// States:
//   IDLE        anchor === undefined
//   PENDING     anchor !== undefined && completionP !== undefined
//   ACTIVE      anchor !== undefined && completionP === undefined
//
// Design principles:
//   - Completion result fields (separatorMode, closedSet) are stored as-is
//     from the backend response and never mutated as the user keeps typing.
//     reuseSession() reads them to decide whether to show, hide, or re-fetch.
//   - reuseSession() makes exactly four kinds of decisions:
//       1. Re-fetch  — input has moved past what the current result covers
//       2. Show/update menu — input satisfies the result's constraints;
//          trie filters the loaded completions against the typed prefix.
//       3. Hide menu, keep session — input is within the anchor but the
//          result's constraints aren't satisfied yet (separator not typed,
//          or no completions exist).  A re-fetch would return the same result.
//       4. Uniquely satisfied — the user has exactly typed one completion
//          entry (and it is not a prefix of any other).  Always re-fetches
//          for the NEXT level's completions — the direction to use for the
//          re-fetch is determined by the caller.
//   - The `closedSet` flag controls the no-match fallthrough: when the trie
//     has zero matches for the typed prefix:
//       closedSet=true  → reuse (closed set, nothing else exists)
//       closedSet=false → re-fetch (set is open, backend may know more)
//   - The anchor is never advanced after a result is received.
//     When `separatorMode` requires a separator, the separator is stripped
//     from the raw prefix before being passed to the menu, so the trie
//     still matches.
//
// Architecture: docs/architecture/completion.md — §5 Shell — Completion Session
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private anchor: string | undefined = undefined;

    // Saved as-is from the last completion result.
    private separatorMode: SeparatorMode = "space";
    private closedSet: boolean = false;
    // True when completions differ between forward and backward.
    private directionSensitive: boolean = false;
    // Direction used for the last fetch.
    private lastDirection: CompletionDirection = "forward";

    // The in-flight completion request, or undefined when settled.
    private completionP: Promise<CommandCompletionResult> | undefined;

    constructor(
        private readonly menu: ISearchMenu,
        private readonly dispatcher: ICompletionDispatcher,
    ) {}

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
    }

    // Returns the text typed after the anchor, or undefined when
    // the input has diverged past the anchor or the separator is not yet present.
    public getCompletionPrefix(input: string): string | undefined {
        const anchor = this.anchor;
        if (anchor === undefined || !input.startsWith(anchor)) {
            return undefined;
        }
        const rawPrefix = input.substring(anchor.length);
        const sepMode = this.separatorMode;
        if (requiresSeparator(sepMode)) {
            // The separator must be present and is not part of the replaceable prefix.
            if (!separatorRegex(sepMode).test(rawPrefix)) {
                return undefined;
            }
            return stripLeadingSeparator(rawPrefix, sepMode);
        }
        return rawPrefix;
    }

    // Decides whether the current session can service `input` without a new
    // backend fetch.  Returns true to reuse, false to trigger a re-fetch.
    //
    // Decision order:
    //   PENDING    — a fetch is in flight; wait for it (return true, no-op).
    //   RE-FETCH   — input has moved outside the anchor; the saved result no
    //                longer applies (return false).
    //   HIDE+KEEP  — input is within the anchor but the separator hasn't
    //                been typed yet; hide the menu but don't re-fetch
    //                (return true).
    //   UNIQUE     — prefix exactly matches one entry and is not a prefix of
    //                any other; re-fetch for the NEXT level (return false).
    //   SHOW       — constraints satisfied; update the menu.  The final
    //                return is `this.closedSet || this.menu.isActive()`:
    //                reuse when the trie still has matches, or when the set
    //                is closed (nothing new to fetch).  Re-fetch only
    //                when the trie is empty AND the set is open.
    //
    // Re-fetch triggers (returns false → startNewSession):
    //
    // A. Session invalidation — anchor is stale; backend result was computed
    //    for a prefix that no longer matches the input.  Unconditional.
    //   1. No session       — anchor is undefined (IDLE state).
    //   2. Anchor diverged  — input no longer starts with the saved anchor
    //                         (e.g. backspace deleted into the anchor region).
    //   3. Bad separator    — separatorMode requires whitespace (or punctuation)
    //                         immediately after anchor, but a non-separator
    //                         character was typed instead. The constraint can
    //                         never be satisfied, so treat as new input.
    //   7. Direction changed — the user switched between forward and backward
    //                         AND the last result was direction-sensitive
    //                         AND the input is at the exact anchor (no text
    //                         typed past it).  Once the user types past the
    //                         anchor, the direction-sensitive boundary has been
    //                         passed and the loaded completions are still valid.
    //
    // B. Hierarchical navigation — user completed this level; re-fetch for
    //    the NEXT level's completions.
    //   4. Uniquely satisfied — typed prefix exactly matches one completion and
    //                         is not a prefix of any other. Always re-fetch
    //                         for the NEXT level.
    //   5. Committed past boundary — prefix contains a separator after a valid
    //                         completion match (e.g. "set " where "set" matches
    //                         but so does "setWindowState"). The user committed
    //                         by typing a separator; re-fetch for next level.
    //
    // C. Open-set discovery — trie has zero matches and the set is not
    //    exhaustive; the backend may know about completions not yet loaded.
    //    Gated by closedSet === false.
    //   6. Open set, no matches — trie has zero matches for the typed prefix
    //                         AND closedSet is false. The backend may know about
    //                         completions not yet loaded.
    private reuseSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
        direction: CompletionDirection,
    ): boolean {
        // [A1] No session — IDLE state, must fetch.
        if (this.anchor === undefined) {
            debug(`Partial completion re-fetch: no active session (IDLE)`);
            return false;
        }

        // PENDING — a fetch is already in flight.
        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${this.anchor}`);
            return true;
        }

        // ACTIVE from here.
        const { anchor, separatorMode: sepMode, closedSet } = this;

        // [A7] Direction changed on a direction-sensitive result.
        // The loaded completions were computed for the opposite direction
        // and would differ — but only at the anchor boundary itself.
        // Once the user has typed past the anchor (rawPrefix is
        // non-empty), the direction-sensitive point has been passed:
        // the trailing text acts as a commit signal, and backward is
        // neutralized by the content after the anchor.  The loaded
        // completions are still valid for trie filtering.
        //
        // If input is shorter than anchor, A2 (anchor diverged) will
        // catch it.  If input is longer but the separator isn't
        // satisfied, A3 will catch it.  So this check only needs to
        // handle the exact-anchor case.
        if (
            direction !== this.lastDirection &&
            this.directionSensitive &&
            input === anchor
        ) {
            debug(
                `Partial completion re-fetch: direction changed (${this.lastDirection} → ${direction}), directionSensitive`,
            );
            return false;
        }

        // [A2] RE-FETCH — input moved past the anchor (e.g. backspace, new word).
        if (!input.startsWith(anchor)) {
            debug(
                `Partial completion re-fetch: anchor diverged (anchor='${anchor}', input='${input}')`,
            );
            return false;
        }

        // Separator handling: the character immediately after the anchor must
        // satisfy the separatorMode constraint.
        //   "space":            whitespace required
        //   "spacePunctuation": whitespace or Unicode punctuation required
        //   "optional"/"none":  no separator needed, fall through to SHOW
        //
        // Three sub-cases when a separator IS required:
        //   ""        — separator not typed yet: HIDE+KEEP (separator may still arrive)
        //   " …"      — separator present: SHOW (fall through, strip it below)
        //   "x…"      — non-separator typed right after anchor: RE-FETCH (the
        //               separator constraint can never be satisfied without
        //               backtracking, so treat this as a new input)
        //
        // NOTE: The anchor (derived from startIndex) may already
        // include whitespace when the grammar consumed it (e.g.
        // an escaped literal space like `hello\ ` in a grammar
        // rule, where the space is part of the token itself).
        // In that case separatorMode may still require a separator
        // — this is intentional and means the grammar expects a
        // *second* separator after the anchor.  Do not "fix" this
        // by trimming the anchor or adjusting startIndex; the
        // agent is the authority on where it stopped parsing.
        const rawPrefix = input.substring(anchor.length);
        const needsSep = requiresSeparator(sepMode);
        if (needsSep) {
            if (rawPrefix === "") {
                debug(
                    `Partial completion deferred: still waiting for separator`,
                );
                this.menu.hide();
                return true; // HIDE+KEEP
            }
            if (!separatorRegex(sepMode).test(rawPrefix)) {
                // [A3] closedSet is not consulted here: it describes whether
                // the completion *entries* are exhaustive, not whether
                // the anchor token can extend.  The grammar may parse
                // the longer input on a completely different path.
                debug(
                    `Partial completion re-fetch: non-separator after anchor (mode='${sepMode}', rawPrefix='${rawPrefix}')`,
                );
                return false; // RE-FETCH (session invalidation)
            }
        }

        // SHOW — strip the leading separator (if any) before passing to the
        // menu trie, so completions like "music" match prefix "" not " ".
        const completionPrefix = needsSep
            ? stripLeadingSeparator(rawPrefix, sepMode)
            : rawPrefix;

        const position = getPosition(completionPrefix);
        if (position !== undefined) {
            debug(
                `Partial completion update: '${completionPrefix}' @ ${JSON.stringify(position)}`,
            );
            const uniquelySatisfied = this.menu.updatePrefix(
                completionPrefix,
                position,
            );

            // [B4] The user has typed text that exactly matches one
            // completion and is not a prefix of any other.
            // Always re-fetch for the next level — the direction
            // for the re-fetch comes from the caller.
            if (uniquelySatisfied) {
                debug(
                    `Partial completion re-fetch: '${completionPrefix}' uniquely satisfied`,
                );
                return false; // RE-FETCH (hierarchical navigation)
            }

            // [B5] Committed-past-boundary: the prefix contains whitespace
            // or punctuation, meaning the user typed past a completion entry.
            // If the text before the first separator exactly matches a
            // completion, re-fetch for the next level.  This handles the
            // case where an entry (e.g. "set") is also a prefix of other
            // entries ("setWindowState") so uniquelySatisfied is false,
            // but the user committed by typing a separator.
            const sepMatch = completionPrefix.match(/^(.+?)[\s\p{P}]/u);
            if (sepMatch !== null && this.menu.hasExactMatch(sepMatch[1])) {
                debug(
                    `Partial completion re-fetch: '${sepMatch[1]}' committed with separator`,
                );
                return false; // RE-FETCH (hierarchical navigation)
            }
        } else {
            debug(
                `Partial completion: no position for prefix '${completionPrefix}', hiding menu`,
            );
            this.menu.hide();
        }

        // [C6] When the menu is still active (trie has matches) we always
        // reuse — the loaded completions are still useful.  When there are
        // NO matches, the decision depends on `closedSet`:
        //   closedSet=true  → the set is closed; the user typed past all
        //                     valid continuations, so re-fetching won't help.
        //   closedSet=false → the set is NOT closed; the user may have
        //                     typed something valid that wasn't loaded, so
        //                     re-fetch with the longer input (open-set discovery).
        const active = this.menu.isActive();
        const reuse = closedSet || active;
        debug(
            `Partial completion ${reuse ? "reuse" : "re-fetch"}: closedSet=${closedSet}, menuActive=${active}`,
        );
        return reuse;
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
        this.separatorMode = "space";
        this.closedSet = false;
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

                this.separatorMode = result.separatorMode ?? "space";
                this.closedSet = result.closedSet;
                this.directionSensitive = result.directionSensitive;
                this.lastDirection = direction;

                const completions = toMenuItems(result.completions);

                if (completions.length === 0) {
                    debug(
                        `Partial completion skipped: No completions for '${input}'`,
                    );
                    // Keep anchor at the full input so the anchor
                    // covers the entire typed text.  The menu stays empty,
                    // so reuseSession()'s SHOW path will use `closedSet` to
                    // decide: closedSet=true → reuse (nothing more exists);
                    // closedSet=false → re-fetch when new input arrives.
                    //
                    // Override separatorMode: with no completions, there is
                    // nothing to separate from, so the separator check in
                    // reuseSession() should not interfere.
                    this.separatorMode = "none";
                    return;
                }

                // Anchor the session at the resolved prefix so
                // subsequent keystrokes filter within the trie.
                const partial =
                    result.startIndex >= 0 && result.startIndex <= input.length
                        ? input.substring(0, result.startIndex)
                        : input;
                this.anchor = partial;

                this.menu.setChoices(completions);

                // Re-run update with captured input to show the menu (or defer
                // if the separator has not been typed yet).
                this.reuseSession(input, getPosition, direction);
            })
            .catch((e) => {
                debugError(`Partial completion error: '${input}' ${e}`);
                // On error, clear the in-flight promise but preserve the
                // anchor so that identical input reuses the session (no
                // re-fetch) while diverged input still triggers a new fetch.
                this.completionP = undefined;
            });
    }
}

// ── Separator helpers ────────────────────────────────────────────────────────

function requiresSeparator(mode: SeparatorMode): boolean {
    return mode === "space" || mode === "spacePunctuation";
}

function separatorRegex(mode: SeparatorMode): RegExp {
    return mode === "space" ? /^\s/ : /^[\s\p{P}]/u;
}

// Strip leading separator characters from rawPrefix.
// For "space" mode, only whitespace is stripped.
// For "spacePunctuation" mode, leading whitespace and punctuation are stripped.
function stripLeadingSeparator(rawPrefix: string, mode: SeparatorMode): string {
    return mode === "space"
        ? rawPrefix.trimStart()
        : rawPrefix.replace(/^[\s\p{P}]+/u, "");
}

// Convert backend CompletionGroups into flat SearchMenuItems,
// preserving group order and sorting within each group.
function toMenuItems(groups: CompletionGroup[]): SearchMenuItem[] {
    const items: SearchMenuItem[] = [];
    let sortIndex = 0;
    for (const group of groups) {
        const sorted = group.sorted
            ? group.completions
            : [...group.completions].sort();
        for (const choice of sorted) {
            items.push({
                matchText: choice,
                selectedText: choice,
                sortIndex: sortIndex++,
                ...(group.needQuotes !== undefined
                    ? { needQuotes: group.needQuotes }
                    : {}),
                ...(group.emojiChar !== undefined
                    ? { emojiChar: group.emojiChar }
                    : {}),
            });
        }
    }
    return items;
}
