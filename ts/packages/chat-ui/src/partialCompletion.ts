// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionToggle,
    LocalSearchMenuUI,
    type SearchMenuItem,
    type SearchMenuPosition,
} from "@typeagent/completion-ui";

/**
 * Subset of agent-dispatcher's CompletionState received from the host
 * over the pcState postMessage protocol.
 */
export type PcCompletionState = {
    prefix: string;
    items: SearchMenuItem[];
    generation: number;
    anchorIndex: number;
};

export type PcDirection = "forward" | "backward";

export type PcPostMessage =
    | { type: "pcUpdate"; input: string; direction: PcDirection }
    | { type: "pcAccept" }
    | { type: "pcDismiss"; input: string; direction: PcDirection }
    | { type: "pcHide" }
    | { type: "pcDispose" };

export type PcPost = (msg: PcPostMessage) => void;

/**
 * Adapts ChatPanel's contentEditable input + ghost span for command
 * completion using @typeagent/completion-ui.
 *
 * Architecture mirrors the legacy vscode-shell partialCompletion:
 *   - The CompletionController lives in the host (extension / agent-server).
 *   - This class drives it from the webview via postMessage:
 *       pcUpdate(input, direction)  on input / focus / caret moves
 *       pcAccept()                  when the user picks a completion
 *       pcDismiss(input, direction) when the user explicitly hides (Esc)
 *       pcHide()                    when the caret leaves the end of input
 *       pcDispose()                 on dispose
 *   - The host sends pcState back on every state change. We render two UIs:
 *       Inline ghost-text suffix in the existing ChatPanel ghost span.
 *       Dropdown menu (LocalSearchMenuUI) anchored above the input.
 *
 * This adaptation differs from the legacy version (which targeted a
 * <textarea>) by using the contentEditable <span> input that ChatPanel
 * already creates, plus ChatPanel's existing trailing ghost span — so
 * we don't need a mirror element to render ghost text.
 */
export class PartialCompletion {
    private readonly toggle: CompletionToggle | undefined;
    private menu: LocalSearchMenuUI | undefined;
    private state: PcCompletionState | undefined;
    private inline: boolean;
    private previousInput: string = "";
    private disposed = false;
    // Index of the currently-previewed item when inline ghost text is
    // active. Up/Down cycle through items[] just like the dropdown menu.
    private inlineIndex = 0;

    constructor(
        private readonly inputContainer: HTMLElement,
        private readonly textInput: HTMLElement,
        private readonly ghostSpan: HTMLSpanElement,
        private readonly post: PcPost,
        opts?: { inline?: boolean },
    ) {
        // Match shell default: inline ghost text. Toggle button switches
        // to dropdown menu (parity with shell's ui.inlineCompletions).
        this.inline = opts?.inline ?? true;

        const parent = inputContainer;
        const cs = getComputedStyle(parent);
        if (cs.position === "static") {
            parent.style.position = "relative";
        }
        this.toggle = new CompletionToggle(
            this.inline ? "expand" : "collapse",
            () => this.switchMode(!this.inline),
        );
        this.toggle.hide();
        const tEl = this.toggle.getElement();
        tEl.style.position = "absolute";
        tEl.style.zIndex = "2";
        tEl.style.top = "2px";
        tEl.style.right = "2px";
        parent.appendChild(tEl);

        textInput.addEventListener("input", this.onInput);
        textInput.addEventListener("keydown", this.onKeydown);
        textInput.addEventListener("blur", this.onBlur);
    }

    private blurTimer: ReturnType<typeof setTimeout> | undefined;

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.blurTimer !== undefined) {
            clearTimeout(this.blurTimer);
            this.blurTimer = undefined;
        }
        this.textInput.removeEventListener("input", this.onInput);
        this.textInput.removeEventListener("keydown", this.onKeydown);
        this.textInput.removeEventListener("blur", this.onBlur);
        this.menu?.close();
        this.menu = undefined;
        this.toggle?.remove();
        this.post({ type: "pcDispose" });
    }

    /**
     * Called by ChatPanel when the user submits — clears completion state
     * and resets previousInput so the next typed character is forward.
     */
    public reset(): void {
        this.previousInput = "";
        this.hideAll();
        this.post({ type: "pcHide" });
    }

    /** Receive a state update from the host. */
    public applyState(state: PcCompletionState | undefined): void {
        // Reset inline cycle index whenever a new completion list arrives
        // (different prefix → first item is the most relevant suggestion).
        this.state = state;
        this.inlineIndex = 0;
        this.renderInline();
        this.renderMenu();
    }

    /**
     * Forwarded by ChatPanel before its own keydown handling.
     * Returns true if the key was handled.
     */
    public handleKeyDownPreSend(event: KeyboardEvent): boolean {
        // Ctrl+Space (or Cmd+Space on macOS) re-summons the completion
        // engine after the user dismissed it with Esc, mirroring the
        // VS Code IntelliSense convention. Handle this BEFORE the
        // "state must be present" early return below — that's the
        // whole point of this binding.
        if (
            event.key === " " &&
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.shiftKey
        ) {
            event.preventDefault();
            this.requestUpdate();
            return true;
        }
        if (!this.state || this.state.items.length === 0) {
            return false;
        }
        if (event.key === "Escape") {
            this.dismissExplicit();
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown") {
            if (!this.effectiveInline() && this.menu) {
                this.menu.adjustSelection(1);
                event.preventDefault();
                return true;
            }
            // Inline ghost mode: cycle through completion candidates so
            // the user can preview/accept any one of them with Tab,
            // matching the Electron shell's behaviour. Always consume
            // the arrow when an inline ghost is showing — even if there
            // is only one candidate — so the keystroke doesn't fall
            // through to chat-ui's history navigation and clobber the
            // user's typed input.
            if (this.effectiveInline()) {
                if (this.state.items.length > 1) {
                    this.inlineIndex =
                        (this.inlineIndex + 1) % this.state.items.length;
                    this.renderInline();
                }
                event.preventDefault();
                return true;
            }
            return false;
        }
        if (event.key === "ArrowUp") {
            if (!this.effectiveInline() && this.menu) {
                this.menu.adjustSelection(-1);
                event.preventDefault();
                return true;
            }
            if (this.effectiveInline()) {
                if (this.state.items.length > 1) {
                    this.inlineIndex =
                        (this.inlineIndex - 1 + this.state.items.length) %
                        this.state.items.length;
                    this.renderInline();
                }
                event.preventDefault();
                return true;
            }
            return false;
        }
        if (event.key === "Tab") {
            // Tab accepts in both inline and dropdown modes.  In
            // dropdown mode, if no item is currently selected (e.g.
            // an auto-opened subcommand dropdown that the user hasn't
            // navigated yet — see firstUpdate in LocalSearchMenuUI),
            // snap to the first item instead of accepting nothing.
            // A second Tab will then accept that item.
            if (!this.effectiveInline() && this.menu) {
                if (!this.menu.selectCompletion()) {
                    this.menu.adjustSelection(1);
                }
                event.preventDefault();
                return true;
            }
            this.acceptInlineOrSelected();
            event.preventDefault();
            return true;
        }
        if (event.key === "Enter") {
            // Enter accepts only in dropdown mode.  In inline mode we
            // intentionally let Enter fall through to ChatPanel's
            // submit handler so the user sends what they typed (the
            // ghost text is just a preview and is NOT silently
            // accepted).  Mirrors PR #2277's shell behavior.
            if (!this.effectiveInline() && this.menu) {
                if (this.menu.selectCompletion()) {
                    event.preventDefault();
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    private switchMode(newInline: boolean) {
        if (this.inline === newInline) return;
        this.inline = newInline;
        this.toggle?.setDirection(this.inline ? "expand" : "collapse");
        if (this.inline) {
            this.menu?.close();
            this.menu = undefined;
        } else {
            this.ghostSpan.textContent = "";
        }
        this.renderInline();
        this.renderMenu();
    }

    private acceptInlineOrSelected() {
        if (!this.state) return;
        if (this.menu) {
            this.menu.selectCompletion();
            return;
        }
        if (this.state.items.length > 0) {
            // In inline mode, accept whichever candidate is currently
            // previewed (Up/Down lets the user cycle).
            const idx = Math.min(
                Math.max(this.inlineIndex, 0),
                this.state.items.length - 1,
            );
            this.applySelection(this.state.items[idx]);
        }
    }

    private applySelection(item: SearchMenuItem) {
        const state = this.state;
        if (!state) return;
        const value = this.currentValue();
        const caret = this.caretOffset();
        const replaceText =
            item.needQuotes !== false && /\s/.test(item.selectedText)
                ? `"${item.selectedText.replaceAll('"', '\\"')}"`
                : item.selectedText;
        const before = value.slice(0, caret - state.prefix.length);
        const after = value.slice(caret);
        // Mirror the ghost preview: if we're starting a fresh token
        // (no prefix consumed) but the existing text doesn't end in
        // whitespace, insert a leading space so accept matches preview.
        const needsLeadingSpace =
            state.prefix.length === 0 &&
            before.length > 0 &&
            !/\s$/.test(before) &&
            replaceText.length > 0 &&
            !/^\s/.test(replaceText);
        const leadIn = needsLeadingSpace ? " " : "";
        // Append a trailing space so the user can immediately start
        // typing the next token (or have the next-token completion
        // surface cleanly). Skip when the text already ends with
        // whitespace.
        const withSpace = /\s$/.test(replaceText)
            ? replaceText
            : replaceText + " ";
        const insertion = leadIn + withSpace;
        const newValue = before + insertion + after;
        const newCaret = before.length + insertion.length;
        this.setValueAndCaret(newValue, newCaret);
        this.previousInput = "";
        this.post({ type: "pcAccept" });
        // Trigger an immediate update so next-token completions kick in.
        this.requestUpdate();
    }

    private dismissExplicit() {
        const input = this.currentInput();
        const direction: PcDirection =
            input.length < this.previousInput.length &&
            this.previousInput.startsWith(input)
                ? "backward"
                : "forward";
        this.post({ type: "pcDismiss", input, direction });
        this.hideAll();
    }

    private hideAll() {
        this.state = undefined;
        this.menu?.close();
        this.menu = undefined;
        this.ghostSpan.textContent = "";
        this.toggle?.hide();
    }

    private currentValue(): string {
        return this.textInput.textContent ?? "";
    }

    private currentInput(): string {
        return this.currentValue().trimStart();
    }

    private caretOffset(): number {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
            return this.currentValue().length;
        }
        const range = sel.getRangeAt(0);
        if (!this.textInput.contains(range.startContainer)) {
            return this.currentValue().length;
        }
        // For a flat contentEditable holding only text/text nodes, the
        // caret offset within the textInput is the offset of the start
        // container plus prior siblings' lengths.
        let offset = range.startOffset;
        let node: Node | null = range.startContainer;
        if (node !== this.textInput) {
            while (node && node.previousSibling) {
                node = node.previousSibling;
                offset += (node.textContent ?? "").length;
            }
        }
        return offset;
    }

    private isCaretAtEnd(): boolean {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        if (!range.collapsed) return false;
        return this.caretOffset() >= this.currentValue().length;
    }

    private setValueAndCaret(value: string, caret: number) {
        this.textInput.textContent = value;
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        const node = this.textInput.firstChild ?? this.textInput;
        const safeCaret = Math.min(caret, value.length);
        if (node.nodeType === Node.TEXT_NODE) {
            range.setStart(node, safeCaret);
        } else {
            range.setStart(this.textInput, 0);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        // Notify ChatPanel of the synthetic edit so it can update its
        // send-button state, etc.
        this.textInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    private requestUpdate() {
        if (!this.isCaretAtEnd()) {
            this.post({ type: "pcHide" });
            this.hideAll();
            return;
        }
        const input = this.currentInput();
        const direction: PcDirection =
            input.length < this.previousInput.length &&
            this.previousInput.startsWith(input)
                ? "backward"
                : "forward";
        this.previousInput = input;
        this.post({ type: "pcUpdate", input, direction });
    }

    private onInput = () => {
        this.requestUpdate();
        // Re-render inline immediately so ghost follows new content even
        // before host sends an updated state.
        this.renderInline();
    };

    private onKeydown = () => {
        // Defer to next tick so the caret reflects the post-key state
        // (handles arrow-key caret moves).
        queueMicrotask(() => {
            if (this.disposed) return;
            if (!this.isCaretAtEnd()) {
                this.post({ type: "pcHide" });
                this.hideAll();
            }
        });
    };

    private onBlur = () => {
        // Hide menu when input loses focus. Slight delay so a mousedown on
        // a menu item still fires onCompletion before close(). Track the
        // timer handle so dispose() can cancel it.
        if (this.blurTimer !== undefined) clearTimeout(this.blurTimer);
        this.blurTimer = setTimeout(() => {
            this.blurTimer = undefined;
            if (this.disposed) return;
            this.menu?.close();
            this.menu = undefined;
            this.ghostSpan.textContent = "";
        }, 150);
    };

    /**
     * Effective mode after applying the @-command override. Inline ghost
     * text is bad UX for command trees (many siblings, only first item
     * shown), so any input that starts with `@` always gets the dropdown.
     */
    private effectiveInline(): boolean {
        if (!this.inline) return false;
        return !this.currentInput().startsWith("@");
    }

    private renderInline() {
        if (!this.effectiveInline()) {
            this.ghostSpan.textContent = "";
            return;
        }
        if (
            !this.state ||
            this.state.items.length === 0 ||
            !this.isCaretAtEnd()
        ) {
            this.ghostSpan.textContent = "";
            this.toggle?.hide();
            return;
        }
        const idx = Math.min(
            Math.max(this.inlineIndex, 0),
            this.state.items.length - 1,
        );
        const item = this.state.items[idx];
        const suffix = item.matchText.substring(this.state.prefix.length);
        // If the ghost is starting a fresh token (no prefix consumed)
        // and its suffix doesn't already lead with whitespace, prepend
        // a space so the preview is visually separated from the typed
        // text. We deliberately do NOT skip this when `value` ends in
        // whitespace, because contentEditable collapses trailing
        // whitespace at display time — without an explicit leading
        // space on the ghost the user sees "task" + ghost adjacent
        // even though the underlying value already has a trailing
        // space (this hits on every Tab past the first).
        const value = this.currentValue();
        const needsLeadingSpace =
            this.state.prefix.length === 0 &&
            value.length > 0 &&
            suffix.length > 0 &&
            !/^\s/.test(suffix);
        // Show the same trailing space that acceptInlineOrSelected
        // appends on Tab so the ghost preview matches the post-accept
        // text exactly (no visually adjacent words).
        const withTrailing = /\s$/.test(suffix) ? suffix : suffix + " ";
        this.ghostSpan.textContent =
            (needsLeadingSpace ? " " : "") + withTrailing;
        this.toggle?.show();
    }

    private renderMenu() {
        if (this.effectiveInline()) {
            this.menu?.close();
            this.menu = undefined;
            return;
        }
        if (!this.state || this.state.items.length === 0) {
            this.menu?.close();
            this.menu = undefined;
            this.toggle?.hide();
            return;
        }
        if (!this.menu) {
            this.menu = new LocalSearchMenuUI((item) => {
                this.applySelection(item);
            });
        }
        const position = this.computeMenuPosition();
        this.menu.update({
            position,
            prefix: this.state.prefix,
            items: this.state.items,
        });
        this.toggle?.show();
    }

    private computeMenuPosition(): SearchMenuPosition {
        // Anchor the menu just above the input element. Without a mirror
        // we don't know the exact caret pixel position, so we use the
        // input's left edge — visually similar to popular IDE behavior
        // for command palettes.
        const rect = this.textInput.getBoundingClientRect();
        return {
            left: rect.left,
            bottom: window.innerHeight - rect.top + 2,
        };
    }
}
