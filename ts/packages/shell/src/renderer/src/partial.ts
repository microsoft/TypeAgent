// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Dispatcher } from "agent-dispatcher";
import { CompletionDirection } from "@typeagent/agent-sdk";
import { SearchMenu } from "./search";
import { SearchMenuItem } from "./searchMenuUI/searchMenuUI";
import {
    CompletionController,
    createCompletionController,
} from "agent-dispatcher/helpers/completion";

import registerDebug from "debug";
import { ExpandableTextArea } from "./chat/expandableTextArea";

const debug = registerDebug("typeagent:shell:partial");
const debugError = registerDebug("typeagent:shell:partial:error");

// Expose the debug factory so that Playwright tests (and developers in
// DevTools) can call  __debug.enable('typeagent:*')  at runtime.
(globalThis as any).__debug = registerDebug;

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

// Architecture: docs/architecture/completion.md — §6 Shell — DOM Adapter
export class PartialCompletion {
    private readonly searchMenu: SearchMenu;
    private readonly controller: CompletionController;
    public closed: boolean = false;
    // Track previous input to determine direction: shorter = backspace
    // ("backward"), longer/same = forward action.
    private previousInput: string = "";
    // Tracks the last generation and prefix seen from CompletionState to
    // decide whether render() (items changed) or updatePosition() (same
    // items) should be called on the SearchMenu.
    private lastGeneration: number = -1;
    private lastPrefix: string = "";

    private readonly cleanupEventListeners: () => void;
    constructor(
        private readonly container: HTMLDivElement,
        private readonly input: ExpandableTextArea,
        dispatcher: Dispatcher,
        inline: boolean = true,
        onToggleMode?: () => void,
    ) {
        // Create controller first.
        this.controller = createCompletionController(dispatcher);

        this.searchMenu = new SearchMenu(
            (item) => {
                this.handleSelect(item);
            },
            inline,
            (prefix) => this.getSearchMenuPosition(prefix),
            this.input.getTextEntry(),
            onToggleMode,
        );

        // When completion state changes, re-render the search menu.
        // CompletionState already contains filtered items and prefix —
        // pass them directly to avoid a redundant trie query in render().
        this.controller.setOnUpdate(() => {
            const state = this.controller.getCompletionState();
            debug(
                `onUpdate: ${state ? `prefix='${state.prefix}' items=${state.items.length}` : "hidden"}`,
            );
            if (state) {
                if (
                    state.generation !== this.lastGeneration ||
                    state.prefix !== this.lastPrefix
                ) {
                    this.lastGeneration = state.generation;
                    this.lastPrefix = state.prefix;
                    this.searchMenu.render(state.prefix, state.items);
                } else {
                    this.searchMenu.updatePosition(state.prefix);
                }
            } else {
                // Reset trackers so that a future state with the same
                // generation+prefix triggers a full render() instead of
                // the lightweight updatePosition() (which no-ops when
                // the menu is inactive).
                this.lastGeneration = -1;
                this.lastPrefix = "";
                this.searchMenu.hide();
            }
        });

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
        debug(`update entry: contentChanged=${contentChanged}`);
        if (contentChanged) {
            // Normalize the input text to ensure selection at end is correct.
            this.input.getTextEntry().normalize();
        }
        if (!this.isSelectionAtEnd(contentChanged)) {
            this.previousInput = "";
            this.controller.hide();
            debug("update: selection not at end, hiding");
            return;
        }
        const input = this.getCurrentInputForCompletion();

        // Skip if input hasn't changed since the last call we forwarded
        // to the controller.  This prevents selectionchange echoes from
        // recomputing direction against the already-mutated previousInput
        // (which would flip "backward" to "forward").
        // Reset to "" on hide (cursor moved away) so re-focus always
        // re-activates the controller.
        if (input === this.previousInput) {
            debug(`update skipped: input unchanged ('${input}')`);
            return;
        }
        debug(
            `Partial completion input: '${input}' (${contentChanged ? "content changed" : "selection changed"})`,
        );

        // Only use "backward" when the user is genuinely backspacing:
        // the new input must be a strict prefix of the previous input.
        const direction: CompletionDirection =
            input.length < this.previousInput.length &&
            this.previousInput.startsWith(input)
                ? "backward"
                : "forward";
        this.previousInput = input;

        this.controller.update(input, direction);
    }

    public hide() {
        debug("hide");
        this.controller.hide();
    }

    public switchMode(newInline: boolean) {
        this.searchMenu.switchMode(newInline);
        // Always full render after mode switch (new UI instance).
        const state = this.controller.getCompletionState();
        if (state) {
            this.searchMenu.render(state.prefix, state.items);
        }
    }

    public close() {
        this.closed = true;
        this.controller.dispose();
        this.cleanupEventListeners();
    }

    private getCurrentInput() {
        // Strip inline completion area (ghost text + toggle) if present
        const textEntry = this.input.getTextEntry();
        const completionArea = textEntry.querySelector(
            ".inline-completion-area",
        );
        if (completionArea) {
            const areaText = completionArea.textContent ?? "";
            const raw = textEntry.textContent ?? "";
            return raw.slice(0, raw.length - areaText.length);
        }
        return textEntry.textContent ?? "";
    }

    private getCurrentInputForCompletion() {
        // Normalize non-breaking spaces (U+00A0) that contenteditable
        // inserts for trailing whitespace.  When the user types a
        // character after a trailing \u00A0, Chromium may convert it
        // back to a regular space — breaking the session's startsWith
        // anchor check and causing unnecessary re-fetches.
        return this.getCurrentInput()
            .trimStart()
            .replace(/\u00a0/g, " ");
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
        const completionArea = textEntry.querySelector(
            ".inline-completion-area",
        );

        if (completionArea) {
            // With inline ghost text, "at end" means the cursor is right
            // before the completion area wrapper. setCursorBeforeGhost
            // places the cursor using setStartBefore(wrapper), so
            // endContainer=textEntry and endOffset=wrapper's child index.
            if (r.endContainer === textEntry) {
                const areaIndex = Array.from(textEntry.childNodes).indexOf(
                    completionArea as ChildNode,
                );
                if (r.endOffset === areaIndex) {
                    return true;
                }
            }
            // Also handle: cursor at the end of a text node that is the
            // immediate previous sibling of the completion area wrapper.
            if (r.endContainer.nodeType === Node.TEXT_NODE) {
                if (
                    r.endContainer.nextSibling === completionArea &&
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

    private getSearchMenuPosition(prefix: string) {
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

    private handleSelect(item: SearchMenuItem) {
        debug(`Partial completion selected: ${item.selectedText}`);
        this.searchMenu.hide();

        // Compute the filter prefix relative to the current anchor.
        // Must be read before accept() clears the session's anchor.
        const completionPrefix = this.controller.getCompletionState()?.prefix;
        if (completionPrefix === undefined) {
            debugError(`Partial completion abort select: prefix not found`);
            return;
        }

        const replaceText =
            item.needQuotes !== false && /\s/.test(item.selectedText)
                ? `"${item.selectedText.replaceAll('"', '\\"')}"`
                : item.selectedText;

        const offset = this.getCurrentInput().length - completionPrefix.length;
        const leafNode = getLeafNode(this.input.getTextEntry(), offset);
        if (leafNode === undefined) {
            debugError(
                "Partial completion abort select: unable to determine leaf node",
            );
            return;
        }
        const endLeafNode = getLeafNode(
            this.input.getTextEntry(),
            offset + completionPrefix.length,
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

        // Normalize merges adjacent text nodes so getSelectionEndNode()
        // returns a single text node.  Then place the cursor at its end
        // so isSelectionAtEnd() passes.  Without this, r.collapse(false)
        // leaves endContainer pointing at the parent element, which does
        // not match the deepest-last-child that isSelectionAtEnd() expects.
        const textEntry = this.input.getTextEntry();
        textEntry.normalize();
        const endNode = this.input.getSelectionEndNode();
        const cursorRange = document.createRange();
        cursorRange.setStart(endNode, endNode.textContent?.length ?? 0);
        cursorRange.collapse(true);
        const s = document.getSelection();
        if (s) {
            s.removeAllRanges();
            s.addRange(cursorRange);
        }

        // Make sure the text entry remains focused after replacement.
        textEntry.focus();

        // Reset completion state so the next update requests fresh completions.
        this.controller.accept();

        debug(`Partial completion replaced: ${replaceText}`);

        // Clear previousInput so auto-detection picks "forward" for the
        // post-selection update (the new input won't be a prefix of "").
        this.previousInput = "";
        this.update(false);
    }

    public handleSpecialKeys(event: KeyboardEvent) {
        if (!this.searchMenu.isActive()) {
            return false;
        }
        if (event.key === "Escape") {
            this.explicitHide();
            event.preventDefault();
            return true;
        }
        return this.searchMenu.handleSpecialKeys(event);
    }

    private explicitHide(): void {
        const input = this.getCurrentInputForCompletion();
        const direction: CompletionDirection =
            input.length < this.previousInput.length &&
            this.previousInput.startsWith(input)
                ? "backward"
                : "forward";
        this.controller.dismiss(input, direction);
    }

    public handleMouseWheel(event: WheelEvent) {
        this.searchMenu.handleMouseWheel(event.deltaY);
    }
}
