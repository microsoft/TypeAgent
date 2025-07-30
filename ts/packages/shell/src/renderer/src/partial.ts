// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult, Dispatcher } from "agent-dispatcher";
import { SearchMenu, SearchMenuItem } from "./search";

import registerDebug from "debug";
import { ExpandableTextarea } from "./chatInput";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

export class PartialCompletion {
    private readonly searchMenu: SearchMenu;
    private current: string | undefined = undefined;
    private space: boolean = false;
    private noCompletion: boolean = false;
    private completionP:
        | Promise<CommandCompletionResult | undefined>
        | undefined;

    constructor(
        private readonly container: HTMLDivElement,
        private readonly input: ExpandableTextarea,
        private readonly dispatcher: Dispatcher,
    ) {
        this.searchMenu = new SearchMenu((item) => {
            this.handleSelect(item);
        }, false);
        document.addEventListener("selectionchange", () => {
            debug("Partial completion update on selection changed");
            this.update(true);
        });

        if (document.activeElement === this.input.getTextEntry()) {
            // If the input is already focused, we need to update immediately.
            this.update();
        }
    }

    public update(selectionChanged: boolean = false) {
        if (!this.isSelectionAtEnd(selectionChanged)) {
            this.cancelCompletionMenu();
            return;
        }
        const input = this.getCurrentInputForCompletion();
        debug(`Partial completion input: ${input}`);
        if (!this.reuseSearchMenu(input)) {
            this.updatePartialCompletion(input);
        }
    }

    public close() {
        this.completionP = undefined;
        this.cancelCompletionMenu();
    }
    private getCurrentInput() {
        return this.input.getTextEntry().innerText;
    }
    private getCurrentInputForCompletion() {
        return this.getCurrentInput().trimStart();
    }

    private isSelectionAtEnd(selectionChanged: boolean = false) {
        const s = document.getSelection();
        if (!s || s.rangeCount !== 1) {
            if (!selectionChanged) {
                debug(
                    `Partial completion skipped: invalid selection count ${s?.rangeCount}`,
                );
            }
            return false;
        }
        const r = s.getRangeAt(0);
        if (!r.collapsed) {
            if (!selectionChanged) {
                debug(`Partial completion skipped: non-collapsed range`);
            }
            return false;
        }

        const endNode = this.input.getSelectionEndNode();
        if (r.endContainer !== endNode) {
            if (!selectionChanged) {
                debug(`Partial completion skipped: selection not in text area`);
            }
            return false;
        }
        if (r.endOffset !== this.getCurrentInput().length) {
            if (!selectionChanged) {
                debug(`Partial completion skipped: selection not at end`);
            }
            return false;
        }
        return true;
    }

    private getCompletionPrefix(input: string) {
        const current = this.current;
        if (current === undefined) {
            // No completion data
            return undefined;
        }
        const prefix = input.substring(current.length);
        const trimmed = prefix.trimStart();
        return this.space && trimmed === prefix ? undefined : trimmed;
    }

    // Determine if the current search menu can still be reused, or if we need to update the completions.
    private reuseSearchMenu(input: string) {
        const current = this.current;
        if (current === undefined) {
            // No data to reuse.
            return false;
        }

        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${current}`);
            return true;
        }

        if (!input.startsWith(current)) {
            // The information is for another input prefix.
            return false;
        }

        // Special case to immediately refresh if input is "@" and the current data is for "".
        if (input.trim() === "@" && current.trim() === "") {
            return false;
        }

        if (this.noCompletion) {
            debug(
                `Partial completion skipped: No completions for '${current}'`,
            );
            return true;
        }

        const prefix = this.getCompletionPrefix(input);
        if (prefix === undefined) {
            return false;
        }

        this.updateSearchMenuPrefix(prefix);

        // If the search menu is still matching continue to use it (return true).

        // Otherwise, space are delimiters, then we refresh the completions (return false) when we have trailing spaces,
        return this.searchMenu.isActive() || prefix.trimEnd() === prefix;
    }

    private updateSearchMenuPrefix(prefix: string) {
        if (this.searchMenu.numChoices === 0) {
            // No need to update if there is no choices.
            return;
        }
        const items = this.searchMenu.completePrefix(prefix);
        const showMenu =
            items.length !== 0 &&
            (items.length !== 1 || items[0].matchText !== prefix);

        if (showMenu) {
            debug(
                `Partial completion selection updated: '${prefix}' with ${items.length} items`,
            );
            this.showCompletionMenu(prefix);
        } else {
            debug(
                items.length === 0
                    ? `Partial completion skipped: No current completions match for '${prefix}'`
                    : `Partial completion skipped: Completion already matched uniquely for '${prefix}'`,
            );
            this.cancelCompletionMenu();
        }
    }

    // Updating completions information with input
    private updatePartialCompletion(input: string) {
        debug(`Partial completion start: ${input}`);
        this.cancelCompletionMenu();
        this.current = input;
        this.noCompletion = false;
        // Clear the choices
        this.searchMenu.setChoices([]);
        const completionP = this.dispatcher.getCommandCompletion(input);
        this.completionP = completionP;
        completionP
            .then((result) => {
                if (this.completionP !== completionP) {
                    debug(`Partial completion canceled: ${input}`);
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
                    result.startIndex > 0
                        ? input.substring(0, result.startIndex)
                        : input;
                this.current = partial;
                this.space = result.space;

                const completions = result.completions.flatMap((group) =>
                    group.completions.map((choice) => {
                        return {
                            matchText: choice,
                            selectedText: choice,
                            needQuotes: group.needQuotes,
                        };
                    }),
                );
                if (completions.length === 0) {
                    debug(
                        `Partial completion skipped: No current completions for '${partial}'`,
                    );
                    return;
                }

                this.searchMenu.setChoices(completions);

                debug(
                    `Partial completion selection reloaded: '${partial}' with ${completions.length} items`,
                );
                this.update();
            })
            .catch((e) => {
                debugError(`Partial completion error: ${input} ${e}`);
                this.completionP = undefined;
            });
    }

    private showCompletionMenu(prefix: string) {
        if (prefix === undefined) {
            // This should not happen.
            debugError(`Partial completion prefix not found`);
            return;
        }

        if (this.searchMenu.isActive() && prefix !== "") {
            return;
        }
        // The menu is not active or completion prefix is empty (i.e. need to move the menu).
        const textEntry = this.input.getTextEntry();
        let x: number;
        if (textEntry.childNodes.length === 0) {
            x = textEntry.getBoundingClientRect().left;
        } else {
            const r = document.createRange();

            r.setEnd(
                textEntry.childNodes[0],
                this.getCurrentInput().length - prefix.length,
            );
            r.collapse(false);
            const rects = r.getClientRects();
            if (rects.length !== 1) {
                debugError("Partial completion skipped: invalid rects");
                return;
            }
            x = rects[0].left;
        }
        const leftBound = this.container.getBoundingClientRect().left;
        this.searchMenu.getContainer().style.left = `${x - leftBound}px`;
        if (!this.searchMenu.isActive()) {
            this.container.appendChild(this.searchMenu.getContainer());
        }
    }

    private cancelCompletionMenu() {
        if (this.searchMenu.isActive()) {
            this.container.removeChild(this.searchMenu.getContainer());
        }
    }
    private handleSelect(item: SearchMenuItem) {
        debug(`Partial completion selected: ${item.selectedText}`);
        this.cancelCompletionMenu();
        const prefix = this.getCompletionPrefix(
            this.getCurrentInputForCompletion(),
        );
        if (prefix === undefined) {
            // This should not happen.
            debugError(`Partial completion prefix not found`);
            return;
        }
        const replaceText =
            item.needQuotes !== false && /\s/.test(item.selectedText)
                ? `"${item.selectedText.replaceAll('"', '\\"')}"`
                : item.selectedText;
        this.input.replaceTextAtCursor(
            replaceText,
            -prefix.length,
            prefix.length,
        );

        // Make sure the text entry remains focused after replacement.
        this.input.getTextEntry().focus();

        debug(
            `Partial completion input suffix replaced at: ${replaceText} at offset ${prefix.length}`,
        );
    }

    public handleSpecialKeys(event: KeyboardEvent) {
        if (!this.searchMenu.isActive()) {
            return false;
        }
        if (event.key === "Escape") {
            this.cancelCompletionMenu();
            event.preventDefault();
            return true;
        }
        const prefix = this.getCompletionPrefix(
            this.getCurrentInputForCompletion(),
        );
        if (prefix === undefined) {
            // This should not happen.
            debugError(`Partial completion prefix not found`);
            this.cancelCompletionMenu();
            return false;
        }
        return this.searchMenu.handleSpecialKeys(event, prefix);
    }

    public handleMouseWheel(event: WheelEvent) {
        this.searchMenu.handleMouseWheel(event.deltaY!!);
    }
}
