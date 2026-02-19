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
    private noCompletion: boolean = false;
    private completionP:
        | Promise<CommandCompletionResult | undefined>
        | undefined;
    public closed: boolean = false;

    private readonly cleanupEventListeners: () => void;
    constructor(
        private readonly container: HTMLDivElement,
        private readonly input: ExpandableTextArea,
        private readonly dispatcher: Dispatcher,
        private readonly inline: boolean = true,
    ) {
        this.searchMenu = new SearchMenu(
            (item) => {
                this.handleSelect(item);
            },
            this.inline,
            this.input.getTextEntry(),
        );
        const selectionChangeHandler = () => {
            debug("Partial completion update on selection changed");
            this.update(false);
        };
        document.addEventListener("selectionchange", selectionChangeHandler);
        this.cleanupEventListeners = () => {
            document.removeEventListener(
                "selectionchange",
                selectionChangeHandler,
            );
        };

        if (document.activeElement === this.input.getTextEntry()) {
            // If the input is already focused, we need to update immediately.
            this.update(false);
        }
    }

    public update(contentChanged: boolean) {
        if (this.closed) {
            throw new Error("Using a closed PartialCompletion");
        }
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

        // @ commands: use existing command completion path.
        // Same token-boundary logic as grammar completions: only re-fetch
        // at word boundaries so partial words (e.g. "@config c") don't hit
        // the backend, which would fail to resolve "c" and poison noCompletion.
        if (input.trimStart().startsWith("@")) {
            if (this.reuseSearchMenu(input)) {
                return;
            }
            // Re-fetch at the last word boundary so the backend sees only
            // complete command tokens and returns proper subcommand completions.
            const lastSpaceIdx = input.lastIndexOf(" ");
            if (/\s$/.test(input)) {
                this.updatePartialCompletion(input);
            } else if (lastSpaceIdx >= 0) {
                this.updatePartialCompletion(
                    input.substring(0, lastSpaceIdx + 1),
                );
            } else {
                this.updatePartialCompletion(input);
            }
            return;
        }

        // Request completions: only request at token boundaries.
        // Between boundaries, filter the existing menu locally.
        if (this.reuseSearchMenu(input)) {
            return;
        }

        // Determine whether this is a token boundary:
        // 1. Trailing space → complete tokens available, request with them
        // 2. Non-empty with no spaces → first typing, request start state (tokens=[])
        // 3. Otherwise (mid-word after spaces, no menu) → wait for next space
        const trimmed = input.trimStart();
        if (trimmed.length === 0) {
            return; // Empty input — defer until user starts typing
        }
        const hasTrailingSpace = /\s$/.test(input);
        const hasSpaces = /\s/.test(trimmed);

        if (hasTrailingSpace) {
            // Token boundary: send full input (all tokens are complete)
            this.updatePartialCompletion(input);
        } else if (!hasSpaces) {
            // Start state: request with "" so backend returns all initial completions.
            // The typed characters (e.g. "p") become the local filter via current="".
            this.updatePartialCompletion("");
        } else {
            // Mid-word with spaces and no active menu (e.g. backspace removed
            // a trailing space). Request at the last token boundary so the
            // menu reappears with the partial word as the local filter.
            const lastSpaceIdx = input.lastIndexOf(" ");
            if (lastSpaceIdx >= 0) {
                this.updatePartialCompletion(
                    input.substring(0, lastSpaceIdx + 1),
                );
            }
        }
    }

    public hide() {
        this.completionP = undefined;
        this.cancelCompletionMenu();
    }

    public close() {
        this.closed = true;
        this.hide();
        this.cleanupEventListeners();
    }
    private getCurrentInput() {
        // Strip inline ghost text if present
        const textEntry = this.input.getTextEntry();
        const ghost = textEntry.querySelector(".inline-ghost");
        if (ghost) {
            const ghostText = ghost.textContent ?? "";
            const raw = textEntry.textContent ?? "";
            return raw.slice(0, raw.length - ghostText.length);
        }
        return textEntry.textContent ?? "";
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

        const textEntry = this.input.getTextEntry();
        const ghost = textEntry.querySelector(".inline-ghost");

        if (ghost) {
            // With inline ghost text, "at end" means the cursor is right
            // before the ghost span. setCursorBeforeGhost places the cursor
            // using setStartBefore(ghost), so endContainer=textEntry and
            // endOffset=ghost's child index.
            if (r.endContainer === textEntry) {
                const ghostIndex = Array.from(textEntry.childNodes).indexOf(
                    ghost as ChildNode,
                );
                if (r.endOffset === ghostIndex) {
                    return true;
                }
            }
            // Also handle: cursor at the end of a text node that is the
            // immediate previous sibling of the ghost span.
            if (r.endContainer.nodeType === Node.TEXT_NODE) {
                if (
                    r.endContainer.nextSibling === ghost &&
                    r.endOffset === (r.endContainer.textContent?.length ?? 0)
                ) {
                    return true;
                }
            }
            if (trace) {
                debug(
                    `Partial completion skipped: selection not at end (ghost present)`,
                );
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
            return undefined;
        }
        if (!input.startsWith(current)) {
            return undefined;
        }
        return input.substring(current.length);
    }

    // Determine if the current search menu can still be reused, or if we need to update the completions.
    // Returns true to reuse (skip re-fetch), false to trigger a new completion request.
    private reuseSearchMenu(input: string) {
        const current = this.current;
        if (current === undefined) {
            return false;
        }

        if (this.completionP !== undefined) {
            debug(`Partial completion pending: ${current}`);
            return true;
        }

        if (!input.startsWith(current)) {
            // Input diverged (e.g. backspace past the anchor point).
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

        // Reuse while menu has matches; re-fetch when all items are filtered out.
        return this.searchMenu.isActive();
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
                    result.startIndex >= 0 && result.startIndex <= input.length
                        ? input.substring(0, result.startIndex)
                        : input;
                this.current = partial;

                // Build completions preserving backend group order so that
                // grammar completions (e.g. "by") appear before entity
                // completions (e.g. song titles), matching CLI behavior.
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
                            needQuotes: group.needQuotes,
                            emojiChar: group.emojiChar,
                        });
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

        // Reset completion state so the next update requests fresh
        // completions from the backend instead of reusing stale trie data.
        this.current = undefined;

        debug(`Partial completion replaced: ${replaceText}`);
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
