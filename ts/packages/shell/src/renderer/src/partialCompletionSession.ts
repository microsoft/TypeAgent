// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import { CommitMode, SeparatorMode } from "@typeagent/agent-sdk";
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
    getCommandCompletion(input: string): Promise<CommandCompletionResult>;
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
//          entry (and it is not a prefix of any other).  Gated by
//          `commitMode`:
//            commitMode="eager"    → re-fetch immediately for the NEXT
//              level's completions (e.g. variable-space grammar where
//              tokens can abut without whitespace).
//            commitMode="explicit" → suppress; the user hasn't committed
//              yet (must type an explicit delimiter).  B5 handles the
//              separator arrival.
//          `closedSet` is irrelevant here because it describes THIS
//          level, not the next's.
//   - The `closedSet` flag controls the no-match fallthrough: when the trie
//     has zero matches for the typed prefix:
//       closedSet=true  → reuse (closed set, nothing else exists)
//       closedSet=false → re-fetch (set is open, backend may know more)
//   - The anchor is never advanced after a result is received.
//     When `separatorMode` requires a separator, the separator is stripped
//     from the raw prefix before being passed to the menu, so the trie
//     still matches.
//
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private anchor: string | undefined = undefined;

    // Saved as-is from the last completion result: what kind of separator
    // must appear in the input immediately after `anchor` before
    // completions are valid.  Defaults to "space" when omitted.
    // Used by reuseSession() and getCompletionPrefix() to interpret
    // the raw prefix without mutating `anchor`.
    private separatorMode: SeparatorMode = "space";

    // When true, the completion set returned by the backend is a closed
    // set for THIS level of the command hierarchy — if the user types
    // something not in the list, no further completions can exist beyond
    // it.  This affects one decision in reuseSession():
    //
    //   No trie matches: closedSet=true → reuse (nothing else exists, no
    //   point re-fetching); closedSet=false → re-fetch (the backend may
    //   know about completions we haven't loaded).
    //
    // Notably, `closedSet` does NOT suppress the uniquelySatisfied re-fetch.
    // uniquelySatisfied means the user needs the NEXT level's completions,
    // which is a different question from whether THIS level is a closed set.
    private closedSet: boolean = false;

    // Controls when "uniquely satisfied" triggers a re-fetch for the next
    // hierarchical level.  Defaults to "explicit" when omitted.
    //
    //   "explicit" — tokens require an explicit delimiter (e.g. space)
    //               to commit.  The user must type a separator after
    //               the matched completion to commit it.  This suppresses
    //               B4 (uniquely satisfied) and lets B5 (committed-past-
    //               boundary) handle it when the separator actually arrives.
    //   "eager"   — commit immediately on unique satisfaction
    //               (e.g. variable-space grammar where tokens can abut
    //               without whitespace).  Re-fetches eagerly.
    private commitMode: CommitMode = "explicit";

    // The in-flight completion request, or undefined when settled.
    private completionP:
        | Promise<CommandCompletionResult | undefined>
        | undefined;

    constructor(
        private readonly menu: ISearchMenu,
        private readonly dispatcher: ICompletionDispatcher,
    ) {}

    // Main entry point.  Called by PartialCompletion.update() after DOM checks pass.
    //   input:       trimmed input text (ghost text stripped, leading whitespace stripped)
    //   getPosition: DOM callback that computes the menu anchor position; returns
    //                undefined when position cannot be determined (hides menu).
    public update(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        if (this.reuseSession(input, getPosition)) {
            return;
        }

        this.startNewSession(input, getPosition);
    }

    // Hide the menu and cancel any in-flight fetch, but preserve session
    // state so reuseSession() can still match the anchor if the user
    // returns (e.g. cursor moved away then back without typing).
    public hide(): void {
        this.completionP = undefined;
        this.menu.hide();
    }

    // Reset state to IDLE without hiding the menu (used after handleSelect inserts text).
    public resetToIdle(): void {
        this.resetSessionFields();
    }

    // Returns the text typed after the anchor, or undefined when
    // the input has diverged past the anchor or the separator is not yet present.
    public getCompletionPrefix(input: string): string | undefined {
        const anchor = this.anchor;
        if (anchor === undefined || !input.startsWith(anchor)) {
            return undefined;
        }
        const rawPrefix = input.substring(anchor.length);
        if (this.requiresSeparator()) {
            // The separator must be present and is not part of the replaceable prefix.
            if (!this.separatorRegex().test(rawPrefix)) {
                return undefined;
            }
            return rawPrefix.trimStart();
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
    //                Gated by commitMode: "eager" re-fetches immediately;
    //                "explicit" defers to B5 (committed-past-boundary).
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
    //
    // B. Hierarchical navigation — user completed this level; re-fetch for
    //    the NEXT level's completions.  closedSet describes THIS level,
    //    not the next.
    //   4. Uniquely satisfied — typed prefix exactly matches one completion and
    //                         is not a prefix of any other. Re-fetch for the
    //                         NEXT level (e.g. agent name → subcommands).
    //                         Gated by commitMode: when "explicit", this is
    //                         suppressed (B5 handles it once the user types a
    //                         separator).  When "eager", fires immediately.
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
    ): boolean {
        // PENDING — a fetch is already in flight.
        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${this.anchor}`);
            return true;
        }

        // [A1] No session — IDLE state, must fetch.
        const anchor = this.anchor;
        if (anchor === undefined) {
            debug(`Partial completion re-fetch: no active session (IDLE)`);
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
        const rawPrefix = input.substring(anchor.length);
        const requiresSep = this.requiresSeparator();
        if (requiresSep) {
            if (rawPrefix === "") {
                debug(
                    `Partial completion deferred: still waiting for separator`,
                );
                this.menu.hide();
                return true; // HIDE+KEEP
            }
            if (!this.separatorRegex().test(rawPrefix)) {
                // [A3] closedSet is not consulted here: it describes whether
                // the completion *entries* are exhaustive, not whether
                // the anchor token can extend.  The grammar may parse
                // the longer input on a completely different path.
                debug(
                    `Partial completion re-fetch: non-separator after anchor (mode='${this.separatorMode}', rawPrefix='${rawPrefix}')`,
                );
                return false; // RE-FETCH (session invalidation)
            }
        }

        // SHOW — strip the leading separator (if any) before passing to the
        // menu trie, so completions like "music" match prefix "" not " ".
        const completionPrefix = requiresSep
            ? rawPrefix.trimStart()
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
            // Only re-fetch when commitMode="eager" (tokens can abut
            // without whitespace).  When "explicit", B5 handles it
            // once the user types a separator.
            if (uniquelySatisfied) {
                if (this.commitMode === "eager") {
                    debug(
                        `Partial completion re-fetch: '${completionPrefix}' uniquely satisfied (eager commit)`,
                    );
                    return false; // RE-FETCH (hierarchical navigation)
                }
                debug(
                    `Partial completion: '${completionPrefix}' uniquely satisfied but commitMode='${this.commitMode}', deferring to separator`,
                );
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
        const reuse = this.closedSet || active;
        debug(
            `Partial completion ${reuse ? "reuse" : "re-fetch"}: closedSet=${this.closedSet}, menuActive=${active}`,
        );
        return reuse;
    }

    // Start a new completion session: issue backend request and process result.
    private startNewSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        debug(`Partial completion start: '${input}'`);
        this.menu.hide();
        this.resetSessionFields();
        this.anchor = input;
        this.menu.setChoices([]);
        const completionP = this.dispatcher.getCommandCompletion(input);
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
                this.commitMode = result.commitMode ?? "explicit";

                // Build completions preserving backend group order.
                const completions: SearchMenuItem[] = [];
                let currentIndex = 0;
                for (const group of result.completions) {
                    const items = group.sorted
                        ? group.completions
                        : [...group.completions].sort();
                    for (const choice of items) {
                        completions.push({
                            matchText: choice,
                            selectedText: choice,
                            sortIndex: currentIndex++,
                            ...(group.needQuotes !== undefined
                                ? { needQuotes: group.needQuotes }
                                : {}),
                            ...(group.emojiChar !== undefined
                                ? { emojiChar: group.emojiChar }
                                : {}),
                        });
                    }
                }

                if (completions.length === 0) {
                    debug(
                        `Partial completion skipped: No completions for '${input}'`,
                    );
                    // Keep this.anchor at the full input so the anchor
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
                this.reuseSession(input, getPosition);
            })
            .catch((e) => {
                debugError(`Partial completion error: '${input}' ${e}`);
                this.completionP = undefined;
            });
    }

    private resetSessionFields(): void {
        this.anchor = undefined;
        this.separatorMode = "space";
        this.closedSet = false;
        this.commitMode = "explicit";
    }

    private requiresSeparator(): boolean {
        return (
            this.separatorMode === "space" ||
            this.separatorMode === "spacePunctuation"
        );
    }

    private separatorRegex(): RegExp {
        return this.separatorMode === "space" ? /^\s/ : /^[\s\p{P}]/u;
    }
}
