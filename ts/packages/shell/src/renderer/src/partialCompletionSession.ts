// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import {
    SearchMenuItem,
    SearchMenuPosition,
} from "../../preload/electronTypes.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

export interface ISearchMenu {
    setChoices(choices: SearchMenuItem[]): void;
    updatePrefix(prefix: string, position: SearchMenuPosition): void;
    hide(): void;
    isActive(): boolean;
}

export interface ICompletionDispatcher {
    getCommandCompletion(
        input: string,
    ): Promise<CommandCompletionResult | undefined>;
}

// PartialCompletionSession manages the state machine for command completion.
//
// States:
//   IDLE        current === undefined
//   PENDING     current !== undefined && completionP !== undefined
//   ACTIVE      current !== undefined && completionP === undefined && noCompletion === false
//   EXHAUSTED   current !== undefined && completionP === undefined && noCompletion === true
//
// Design principles:
//   - Completion result fields (noCompletion, needsSeparator) are stored as-is
//     from the backend response and never mutated as the user keeps typing.
//     reuseSession() reads them to decide whether to show, hide, or re-fetch.
//   - reuseSession() makes exactly three kinds of decisions:
//       1. Re-fetch  — input has moved past what the current result covers
//       2. Show/update menu — input satisfies the result's constraints
//       3. Hide menu, keep session — input doesn't satisfy constraints yet
//          (separator not typed, or no completions exist), but is still
//          within the anchor so a re-fetch would return the same result.
//   - The anchor (`current`) is never advanced after a result is received.
//     When `needsSeparator` is true the separator is stripped from the raw
//     prefix before being passed to the menu, so the trie still matches.
//
// This class has no DOM dependencies and is fully unit-testable with Jest.
export class PartialCompletionSession {
    // The "anchor" prefix for the current session.  Set to the full input
    // when the request is issued, then narrowed to input[0..startIndex] when
    // the backend reports how much the grammar consumed.  `undefined` = IDLE.
    private current: string | undefined = undefined;

    // True when the backend reported no completions for `current` (EXHAUSTED).
    private noCompletion: boolean = false;

    // Saved as-is from the last completion result: whether a separator must
    // appear in the input immediately after `current` before completions are
    // valid.  Used by reuseSession() and getCompletionPrefix() to interpret
    // the raw prefix without mutating `current`.
    private needsSeparator: boolean = false;

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
        // Empty input: hide without fetching.  Must come before reuseSession()
        // because reuseSession("") would match current="" and show stale items.
        if (input.trimStart().length === 0) {
            this.cancelMenu();
            return;
        }

        if (this.reuseSession(input, getPosition)) {
            return;
        }

        this.startNewSession(input, getPosition);
    }

    // Reset to IDLE and hide the menu.
    public hide(): void {
        this.completionP = undefined;
        this.current = undefined;
        this.noCompletion = false;
        this.needsSeparator = false;
        this.cancelMenu();
    }

    // Reset state to IDLE without hiding the menu (used after handleSelect inserts text).
    public resetToIdle(): void {
        this.current = undefined;
        this.needsSeparator = false;
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
        if (this.needsSeparator) {
            // The separator must be present and is not part of the replaceable prefix.
            if (!/^\s/.test(rawPrefix)) {
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
    //   HIDE+KEEP  — input is within the anchor but the result's constraints
    //                aren't satisfied yet (no completions, or separator not
    //                typed); hide the menu but don't re-fetch (return true).
    //   SHOW       — constraints satisfied; update/show the menu (return
    //                isActive() so callers can re-fetch when the trie is empty).
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

        // HIDE+KEEP — backend found no completions for this anchor.
        if (this.noCompletion) {
            debug(
                `Partial completion skipped: No completions for '${current}'`,
            );
            this.menu.hide();
            return true;
        }

        // Separator handling: the character immediately after the anchor must be
        // whitespace.  Three sub-cases:
        //   ""        — separator not typed yet: HIDE+KEEP (separator may still arrive)
        //   " …"      — separator present: SHOW (fall through, strip it below)
        //   "x…"      — non-separator typed right after anchor: RE-FETCH (the
        //               separator constraint can never be satisfied without
        //               backtracking, so treat this as a new input)
        const rawPrefix = input.substring(current.length);
        if (this.needsSeparator) {
            if (rawPrefix === "") {
                debug(
                    `Partial completion deferred: still waiting for separator`,
                );
                this.menu.hide();
                return true; // HIDE+KEEP
            }
            if (!/^\s/.test(rawPrefix)) {
                return false; // RE-FETCH
            }
        }

        // SHOW — strip the leading separator (if any) before passing to the
        // menu trie, so completions like "music" match prefix "" not " ".
        const prefix = this.needsSeparator ? rawPrefix.trimStart() : rawPrefix;

        const position = getPosition(prefix);
        if (position !== undefined) {
            debug(
                `Partial completion update: '${prefix}' @ ${JSON.stringify(position)}`,
            );
            this.menu.updatePrefix(prefix, position);
        } else {
            this.menu.hide();
        }

        // Always reuse: input is within the anchor and we have loaded
        // completions.  Even if the trie has no matches for the current
        // prefix (menu hidden), backspacing may restore matches without
        // needing a re-fetch.
        return true;
    }

    // Start a new completion session: issue backend request and process result.
    private startNewSession(
        input: string,
        getPosition: (prefix: string) => SearchMenuPosition | undefined,
    ): void {
        debug(`Partial completion start: '${input}'`);
        this.cancelMenu();
        this.current = input;
        this.noCompletion = false;
        this.needsSeparator = false;
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
                if (result === undefined) {
                    debug(
                        `Partial completion skipped: No completions for '${input}'`,
                    );
                    this.noCompletion = true;
                    return;
                }

                const partial =
                    result.startIndex >= 0 && result.startIndex <= input.length
                        ? input.substring(0, result.startIndex)
                        : input;
                this.current = partial;
                this.needsSeparator = result.needsSeparator === true;

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
                        `Partial completion skipped: No current completions for '${partial}'`,
                    );
                    return;
                }

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
