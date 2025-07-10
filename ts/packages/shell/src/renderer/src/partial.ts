// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult } from "agent-dispatcher";
import { getDispatcher } from "./main";
import { SearchMenu, SearchMenuItem } from "./search";

import registerDebug from "debug";
import { ExpandableTextarea } from "./chatInput";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

export class PartialCompletion {
    private readonly searchMenu: SearchMenu;
    private current: string = "";
    private space: boolean = false;
    private noCompletion: boolean = false;
    private completionP:
        | Promise<CommandCompletionResult | undefined>
        | undefined;

    constructor(
        private readonly container: HTMLDivElement,
        private readonly input: ExpandableTextarea,
    ) {
        this.searchMenu = new SearchMenu((item) => {
            this.handleSelect(item);
        }, false);
        document.addEventListener("selectionchange", () => {
            this.update(true);
        });
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
        if (r.endContainer !== this.input.getTextEntry().childNodes[0]) {
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
        const prefix = input.substring(this.current.length);
        if (!this.space) {
            return prefix;
        }
        const trimmed = prefix.trimStart();
        return trimmed === prefix ? undefined : trimmed;
    }
    private reuseSearchMenu(input: string) {
        if (!this.current || !input.startsWith(this.current)) {
            return false;
        }

        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${this.current}`);
            return true;
        }

        if (this.noCompletion) {
            debug(
                `Partial completion skipped: No completions for '${this.current}'`,
            );
            return true;
        }

        const prefix = this.getCompletionPrefix(input);
        if (prefix === undefined) {
            return false;
        }

        // Space are delimiters.  Don't reuse the search menu if we have a space at the end.
        // space.  We will try to refresh the completion.
        if (prefix.trimEnd() !== prefix) {
            return false;
        }

        this.updateSearchMenuPrefix(prefix);
        return true;
    }

    private updateSearchMenuPrefix(prefix: string) {
        if (this.searchMenu.numChoices === 0) {
            // No need to update if there is no choices.
            return;
        }
        const items = this.searchMenu.completePrefix(prefix);
        if (
            items.length !== 0 &&
            (items.length !== 1 || items[0].matchText !== prefix)
        ) {
            debug(
                `Partial completion updated: '${prefix}' with ${items.length} items`,
            );
            this.showCompletionMenu();
        } else {
            debug(
                items.length === 0
                    ? `Partial completion skipped: No current completions match for '${prefix}'`
                    : `Partial completion skipped: Completion already matched uniquely for '${prefix}'`,
            );
            this.cancelCompletionMenu();
        }
    }

    private updatePartialCompletion(input: string) {
        debug(`Partial completion start: ${input}`);
        this.cancelCompletionMenu();
        this.current = input;
        this.noCompletion = false;
        // Clear the choices
        this.searchMenu.setChoices([]);
        const completionP = getDispatcher().getCommandCompletion(input);
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
                        `Partial completion skipped: No completions for '${this.current}'`,
                    );
                    this.noCompletion = true;
                    return;
                }

                const partial =
                    result.startIndex > 0
                        ? input.substring(0, result.startIndex)
                        : input;
                const prefix =
                    result.startIndex > 0
                        ? input.substring(result.startIndex)
                        : "";
                this.current = partial;
                this.space = result.space;

                if (result.completions.length === 0) {
                    debug(
                        `Partial completion skipped: No current completions for '${this.current}'`,
                    );
                    return;
                }

                this.searchMenu.setChoices(
                    result.completions.map((choice) => ({
                        matchText: choice,
                        selectedText: choice,
                    })),
                );

                if (!this.isSelectionAtEnd()) {
                    // selection changed.
                    return;
                }

                const currentInput = this.getCurrentInputForCompletion();
                if (currentInput === input) {
                    this.updateSearchMenuPrefix(prefix);
                } else if (!this.reuseSearchMenu(currentInput)) {
                    this.updatePartialCompletion(currentInput);
                }
            })
            .catch((e) => {
                debugError(`Partial completion error: ${input} ${e}`);
                this.completionP = undefined;
            });
    }

    private showCompletionMenu() {
        const prefix = this.getCompletionPrefix(
            this.getCurrentInputForCompletion(),
        );
        if (prefix === undefined) {
            // This should not happen.
            debugError(`Partial completion prefix not found`);
            return;
        }
        if (this.searchMenu.isActive() && prefix !== "") {
            return;
        }
        const r = document.createRange();

        r.setEnd(
            this.input.getTextEntry().childNodes[0],
            this.getCurrentInput().length - prefix.length,
        );
        r.collapse(false);
        const rects = r.getClientRects();
        if (rects.length !== 1) {
            debugError("Partial completion skipped: invalid rects");
            return;
        }
        const x = rects[0].left;
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
        const replaceText = /\s/.test(item.selectedText)
            ? `"${item.selectedText.replaceAll('"', '\\"')}"`
            : item.selectedText;
        this.input.replaceTextAtCursor(
            replaceText,
            -prefix.length,
            prefix.length,
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
