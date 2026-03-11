// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import { SeparatorMode } from "@typeagent/agent-sdk";
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
    hide(): void;
    isActive(): boolean;
}

export interface ICompletionDispatcher {
    getCommandCompletion(input: string): Promise<CommandCompletionResult>;
}

// PartialCompletionSession manages the state machine for command completion.
//
// States:
//   IDLE        current === undefined
//   PENDING     current !== undefined && completionP !== undefined
//   ACTIVE      current !== undefined && completionP === undefined
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
//          entry (and it is not a prefix of any other).  Always re-fetch to
//          get the NEXT level's completions (e.g. agent name → subcommands).
//          This re-fetch is unconditional: `closedSet` is irrelevant here
//          because it describes THIS level, not the next's.
//   - The `closedSet` flag controls the no-match fallthrough: when the trie
//     has zero matches for the typed prefix:
//       closedSet=true  → reuse (closed set, nothing else exists)
//       closedSet=false → re-fetch (set is open, backend may know more)
//   - The anchor (`current`) is never advanced after a result is received.
//     When `separatorMode` requires a separator, the separator is stripped
//     from the raw prefix before being passed to the menu, so the trie
//     still matches.
//
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private current: string | undefined = undefined;

    // Saved as-is from the last completion result: what kind of separator
    // must appear in the input immediately after `current` before
    // completions are valid.  Defaults to "space" when omitted.
    // Used by reuseSession() and getCompletionPrefix() to interpret
    // the raw prefix without mutating `current`.
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

    // Reset to IDLE and hide the menu.
    public hide(): void {
        this.completionP = undefined;
        this.current = undefined;
        this.separatorMode = "space";
        this.closedSet = false;
        this.cancelMenu();
    }

    // Reset state to IDLE without hiding the menu (used after handleSelect inserts text).
    public resetToIdle(): void {
        this.current = undefined;
        this.separatorMode = "space";
        this.closedSet = false;
    }

    // Returns the text typed after the anchor (`current`), or undefined when
    // the input has diverged past the anchor or the separator is not yet present.
    public getCompletionPrefix(input: string): string | undefined {
        const current = this.current;
        if (current === undefined) {
            return undefined;
        }
        if (!input.startsWith(current)) {
            return undefined;
        }
        const rawPrefix = input.substring(current.length);
        if (
            this.separatorMode === "space" ||
            this.separatorMode === "spacePunctuation"
        ) {
            // The separator must be present and is not part of the replaceable prefix.
            const sepRe =
                this.separatorMode === "space" ? /^\s/ : /^[\s\p{P}]/u;
            if (!sepRe.test(rawPrefix)) {
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
    //                Unconditional — `closedSet` is irrelevant here.
    //   SHOW       — constraints satisfied; update the menu.  The final
    //                return is `this.closedSet || this.menu.isActive()`:
    //                reuse when the trie still has matches, or when the set
    //                is closed (nothing new to fetch).  Re-fetch only
    //                when the trie is empty AND the set is open.
    private reuseSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): boolean {
        const current = this.current;
        if (current === undefined) {
            return false;
        }

        // PENDING — a fetch is already in flight.
        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${current}`);
            return true;
        }

        // RE-FETCH — input moved past the anchor (e.g. backspace, new word).
        if (!input.startsWith(current)) {
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
        const rawPrefix = input.substring(current.length);
        const requiresSep =
            this.separatorMode === "space" ||
            this.separatorMode === "spacePunctuation";
        if (requiresSep) {
            if (rawPrefix === "") {
                debug(
                    `Partial completion deferred: still waiting for separator`,
                );
                this.menu.hide();
                return true; // HIDE+KEEP
            }
            const sepRe =
                this.separatorMode === "space" ? /^\s/ : /^[\s\p{P}]/u;
            if (!sepRe.test(rawPrefix)) {
                return false; // RE-FETCH
            }
        }

        // SHOW — strip the leading separator (if any) before passing to the
        // menu trie, so completions like "music" match prefix "" not " ".
        const prefix = requiresSep ? rawPrefix.trimStart() : rawPrefix;

        const position = getPosition(prefix);
        if (position !== undefined) {
            debug(
                `Partial completion update: '${prefix}' @ ${JSON.stringify(position)}`,
            );
            const uniquelySatisfied = this.menu.updatePrefix(prefix, position);
            if (uniquelySatisfied) {
                // The user has typed text that exactly matches one completion
                // and is not a prefix of any other.  We need the NEXT level's
                // completions (e.g. agent name → subcommands), so re-fetch.
                debug(
                    `Partial completion re-fetch: '${prefix}' uniquely satisfied`,
                );
                return false; // RE-FETCH for next level of completions
            }
        } else {
            this.menu.hide();
        }

        // When the menu is still active (trie has matches) we always
        // reuse — the loaded completions are still useful.  When there are
        // NO matches, the decision depends on `closedSet`:
        //   closedSet=true  → the set is closed; the user typed past all
        //                     valid continuations, so re-fetching won't help.
        //   closedSet=false → the set is NOT closed; the user may have
        //                     typed something valid that wasn't loaded, so
        //                     re-fetch with the longer input.
        return this.closedSet || this.menu.isActive();
    }

    // Start a new completion session: issue backend request and process result.
    private startNewSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        debug(`Partial completion start: '${input}'`);
        this.cancelMenu();
        this.current = input;
        this.separatorMode = "space";
        this.closedSet = false;
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
                    // Keep this.current at the full input so the anchor
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
                this.current = partial;

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

    private cancelMenu(): void {
        this.menu.hide();
    }
}
