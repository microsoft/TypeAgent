// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandCompletionResult, Dispatcher } from "agent-dispatcher";
import { SearchMenu } from "./search";
import { SearchMenuItem } from "./searchMenuUI/searchMenuUI";

import registerDebug from "debug";
import { ExpandableTextArea } from "./chat/expandableTextArea";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

function getLeafNode(node: Node, offset: number) {
    let curr = 0;
    let currNode: Node | undefined = node;
    while (currNode !== undefined) {
        const childNodes = currNode.childNodes;
        if (childNodes.length === 0) {
            if (
                currNode.textContent === null ||
                currNode.textContent.length < offset - curr
            ) {
                return undefined;
            }

            return { node: currNode, offset: offset - curr };
        }

        currNode = undefined;
        for (const child of childNodes) {
            if (child.textContent === null) {
                continue;
            }
            const len = child.textContent.length;
            if (curr + len >= offset) {
                currNode = child;
                break;
            }
            curr += len;
        }
    }
    return undefined;
}

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
        private readonly input: ExpandableTextArea,
        private readonly dispatcher: Dispatcher,
    ) {
        this.searchMenu = new SearchMenu((item) => {
            this.handleSelect(item);
        });
        document.addEventListener("selectionchange", () => {
            debug("Partial completion update on selection changed");
            this.update(false);
        });

        if (document.activeElement === this.input.getTextEntry()) {
            // If the input is already focused, we need to update immediately.
            this.update(false);
        }
    }

    public update(contentChanged: boolean) {
        if (contentChanged) {
            // Normalize the input text to ensure selection at end is correct.
            this.input.getTextEntry().normalize();
        }
        if (!this.isSelectionAtEnd(contentChanged)) {
            this.cancelCompletionMenu();
            return;
        }
        const input = this.getCurrentInputForCompletion();
        debug(`Partial completion input: '${input}'`);
        if (!this.reuseSearchMenu(input)) {
            this.updatePartialCompletion(input);
        }
    }

    public close() {
        this.completionP = undefined;
        this.cancelCompletionMenu();
    }
    private getCurrentInput() {
        return this.input.getTextEntry().textContent ?? "";
    }
    private getCurrentInputForCompletion() {
        return this.getCurrentInput().trimStart();
    }

    private isSelectionAtEnd(trace: boolean = false) {
        const s = document.getSelection();
        if (!s || s.rangeCount !== 1) {
            if (trace) {
                debug(
                    `Partial completion skipped: invalid selection count ${s?.rangeCount}`,
                );
            }
            return false;
        }
        const r = s.getRangeAt(0);
        if (!r.collapsed) {
            if (trace) {
                debug(`Partial completion skipped: non-collapsed range`);
            }
            return false;
        }

        const endNode = this.input.getSelectionEndNode();
        if (r.endContainer !== endNode) {
            if (trace) {
                debug(`Partial completion skipped: selection not in text area`);
            }
            return false;
        }
        if (r.endOffset !== endNode.textContent?.length) {
            if (trace) {
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

        const position = this.getSearchMenuPosition(prefix);
        if (position !== undefined) {
            debug(
                `Partial completion update: '${prefix}' @ ${JSON.stringify(position)}`,
            );
            this.searchMenu.updatePrefix(prefix, position);
        } else {
            this.searchMenu.hide();
        }

        // If the search menu is still matching continue to use it (return true).

        // Otherwise, space are delimiters, then we refresh the completions (return false) when we have trailing spaces,
        return this.searchMenu.isActive() || prefix.trimEnd() === prefix;
    }

    // Updating completions information with input
    private updatePartialCompletion(input: string) {
        debug(`Partial completion start: '${input}'`);
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
                    result.startIndex > 0
                        ? input.substring(0, result.startIndex)
                        : input;
                this.current = partial;
                this.space = result.space;

                const completions: SearchMenuItem[] = [];
                const sortedGroups = result.completions.filter((g) => g.sorted);
                let sortedGroupIndex = 0;
                let maxSortedGroups = 0;
                for (const group of sortedGroups) {
                    let index = 0;
                    maxSortedGroups = Math.max(
                        maxSortedGroups,
                        group.completions.length,
                    );

                    for (const choice of group.completions) {
                        completions.push({
                            matchText: choice,
                            selectedText: choice,
                            sortIndex:
                                sortedGroups.length * index + sortedGroupIndex,
                            needQuotes: group.needQuotes,
                            emojiChar: group.emojiChar,
                        });
                        index++;
                    }
                    sortedGroupIndex++;
                }
                let baseIndex = sortedGroups.length * maxSortedGroups;
                for (const group of result.completions) {
                    if (!group.sorted) {
                        const sorted = [...group.completions].sort();
                        for (const choice of sorted) {
                            completions.push({
                                matchText: choice,
                                selectedText: choice,
                                sortIndex: baseIndex++,
                                needQuotes: group.needQuotes,
                                emojiChar: group.emojiChar,
                            });
                        }
                    }
                }

                if (completions.length === 0) {
                    debug(
                        `Partial completion skipped: No current completions for '${partial}'`,
                    );
                    return;
                }

                this.searchMenu.setChoices(completions);

                debug(
                    `Partial completion selection updated: '${partial}' with ${completions.length} items`,
                );
                this.update(false);
            })
            .catch((e) => {
                debugError(`Partial completion error: '${input}' ${e}`);
                this.completionP = undefined;
            });
    }

    private getSearchMenuPosition(prefix: string) {
        // The menu is not active or completion prefix is empty (i.e. need to move the menu).
        const textEntry = this.input.getTextEntry();
        let x: number;
        if (textEntry.childNodes.length === 0) {
            x = textEntry.getBoundingClientRect().left;
        } else {
            const offset = this.getCurrentInput().length - prefix.length;
            const leaf = getLeafNode(textEntry, offset);
            if (leaf === undefined) {
                debugError(
                    "Partial completion skipped: unable to determine leaf node",
                );
                return;
            }
            const r = document.createRange();
            r.setStart(leaf.node, leaf.offset);
            r.collapse(true);
            const rects = r.getClientRects();
            if (rects.length !== 1) {
                debugError("Partial completion skipped: invalid rects");
                return;
            }
            x = rects[0].left;
        }

        const { top } = this.container.getBoundingClientRect();
        return { left: x, bottom: window.innerHeight - top };
    }

    private cancelCompletionMenu() {
        this.searchMenu.hide();
    }

    private handleSelect(item: SearchMenuItem) {
        debug(`Partial completion selected: ${item.selectedText}`);
        this.cancelCompletionMenu();
        const prefix = this.getCompletionPrefix(
            this.getCurrentInputForCompletion(),
        );
        if (prefix === undefined) {
            // This should not happen.
            debugError(`Partial completion abort select: prefix not found`);
            return;
        }
        const replaceText =
            item.needQuotes !== false && /\s/.test(item.selectedText)
                ? `"${item.selectedText.replaceAll('"', '\\"')}"`
                : item.selectedText;

        const offset = this.getCurrentInput().length - prefix.length;
        const leafNode = getLeafNode(this.input.getTextEntry(), offset);
        if (leafNode === undefined) {
            debugError(
                "Partial completion abort select: unable to determine leaf node",
            );
            return;
        }
        const endLeafNode = getLeafNode(
            this.input.getTextEntry(),
            offset + prefix.length,
        );
        if (endLeafNode === undefined) {
            debugError(
                "Partial completion abort select: unable to determine end leaf node",
            );
            return;
        }

        const newNode = document.createTextNode(replaceText);
        const r = document.createRange();
        r.setStart(leafNode.node, leafNode.offset);
        r.setEnd(endLeafNode.node, endLeafNode.offset);
        r.deleteContents();
        r.insertNode(newNode);

        r.collapse(false);
        const s = document.getSelection();
        if (s) {
            s.removeAllRanges();
            s.addRange(r);
        }

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
        return this.searchMenu.handleSpecialKeys(event);
    }

    public handleMouseWheel(event: WheelEvent) {
        this.searchMenu.handleMouseWheel(event.deltaY);
    }
}
