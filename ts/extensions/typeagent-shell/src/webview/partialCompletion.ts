// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionToggle,
    LocalSearchMenuUI,
    type SearchMenuItem,
    type SearchMenuPosition,
} from "@typeagent/completion-ui";

// Subset of agent-dispatcher's CompletionState we receive over postMessage.
type PcCompletionState = {
    prefix: string;
    items: SearchMenuItem[];
    generation: number;
    anchorIndex: number;
};

type PostMessage = (msg: any) => void;

/**
 * Adapts a <textarea> for command completion using @typeagent/completion-ui.
 *
 * Architecture:
 *  - The CompletionController lives in the extension host (per AgentServerBridge).
 *  - This class drives it from the webview via postMessage:
 *      pcUpdate(input, direction)   on textarea input / focus / caret moves
 *      pcAccept()                   when the user picks a completion
 *      pcDismiss(input, direction)  when the user explicitly hides (Esc)
 *      pcHide()                     when the caret leaves the end of the textarea
 *      pcDispose()                  on dispose
 *  - The host fires "pcState" back on every state change.  We render two UIs:
 *      Dropdown menu (LocalSearchMenuUI) above the textarea.
 *      Inline ghost-text suffix overlaid on the textarea via a mirror div.
 */
export class TextareaPartialCompletion {
    private readonly toggle: CompletionToggle | undefined;
    private readonly mirror: HTMLDivElement;
    private readonly ghostSpan: HTMLSpanElement;
    private menu: LocalSearchMenuUI | undefined;
    private state: PcCompletionState | undefined;
    private inline: boolean;
    private previousInput: string = "";
    private disposed = false;

    constructor(
        private readonly container: HTMLElement,
        private readonly textarea: HTMLTextAreaElement,
        private readonly post: PostMessage,
        opts?: { inline?: boolean },
    ) {
        this.inline = opts?.inline ?? true;

        // Mirror div for inline ghost-text rendering.  Sits behind the
        // textarea with matching layout properties so the user's text
        // overlaps the mirror exactly, and the ghost suffix appears
        // immediately after the caret.
        this.mirror = document.createElement("div");
        this.mirror.className = "tac-mirror";
        this.ghostSpan = document.createElement("span");
        this.ghostSpan.className = "tac-ghost";
        const parent = textarea.parentElement;
        if (parent) {
            const style = getComputedStyle(parent);
            if (style.position === "static") {
                parent.style.position = "relative";
            }
            parent.insertBefore(this.mirror, textarea);
            // CompletionToggle sits next to the textarea (hidden by default).
            this.toggle = new CompletionToggle(
                this.inline ? "expand" : "collapse",
                () => this.switchMode(!this.inline),
            );
            this.toggle.hide();
            parent.appendChild(this.toggle.getElement());
        }
        this.syncMirrorStyles();

        textarea.addEventListener("input", this.onInput);
        textarea.addEventListener("keydown", this.onKeydown);
        textarea.addEventListener("blur", this.onBlur);
        textarea.addEventListener("scroll", this.onScroll);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.textarea.removeEventListener("input", this.onInput);
        this.textarea.removeEventListener("keydown", this.onKeydown);
        this.textarea.removeEventListener("blur", this.onBlur);
        this.textarea.removeEventListener("scroll", this.onScroll);
        this.menu?.close();
        this.menu = undefined;
        this.mirror.remove();
        this.toggle?.remove();
        this.post({ type: "pcDispose" });
    }

    /**
     * Should be called from chatUI when the user submits — clears completion state
     * and resets previousInput so the next typed character is forward.
     */
    public reset(): void {
        this.previousInput = "";
        this.hideAll();
        this.post({ type: "pcHide" });
    }

    /** Receive a state update from the extension host. */
    public applyState(state: PcCompletionState | undefined): void {
        this.state = state;
        this.renderInline();
        this.renderMenu();
    }

    /** Forwarded by chatUI before its own keydown handling.  Returns true if handled. */
    public handleKeyDownPreSend(event: KeyboardEvent): boolean {
        if (!this.state || this.state.items.length === 0) {
            return false;
        }
        if (event.key === "Escape") {
            this.dismissExplicit();
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowDown") {
            this.menu?.adjustSelection(1);
            event.preventDefault();
            return true;
        }
        if (event.key === "ArrowUp") {
            this.menu?.adjustSelection(-1);
            event.preventDefault();
            return true;
        }
        if (event.key === "Tab" || event.key === "Enter") {
            this.acceptInlineOrSelected();
            event.preventDefault();
            return true;
        }
        return false;
    }

    private switchMode(newInline: boolean) {
        if (this.inline === newInline) return;
        this.inline = newInline;
        this.toggle?.setDirection(this.inline ? "expand" : "collapse");
        // Re-render with the new mode.
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
        // The dropdown's "selected" item is the source of truth — for inline
        // mode we still pick whichever item the controller has at index 0
        // (matches shell semantics: inline ghost is the first item).
        if (this.menu) {
            this.menu.selectCompletion();
            return;
        }
        if (this.state.items.length > 0) {
            this.applySelection(this.state.items[0]);
        }
    }

    private applySelection(item: SearchMenuItem) {
        const state = this.state;
        if (!state) return;
        const value = this.textarea.value;
        const caret = this.textarea.selectionStart ?? value.length;
        const replaceText =
            item.needQuotes !== false && /\s/.test(item.selectedText)
                ? `"${item.selectedText.replaceAll('"', '\\"')}"`
                : item.selectedText;
        const before = value.slice(0, caret - state.prefix.length);
        const after = value.slice(caret);
        const newValue = before + replaceText + after;
        const newCaret = before.length + replaceText.length;
        this.textarea.value = newValue;
        this.textarea.selectionStart = this.textarea.selectionEnd = newCaret;
        // Resize textarea to new content (parity with normal input flow).
        this.textarea.dispatchEvent(new Event("input", { bubbles: true }));
        this.previousInput = "";
        this.post({ type: "pcAccept" });
        // Trigger an immediate update so the next-token completions kick in.
        this.requestUpdate();
    }

    private dismissExplicit() {
        const input = this.currentInput();
        const direction =
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

    private currentInput(): string {
        return this.textarea.value.trimStart();
    }

    private isCaretAtEnd(): boolean {
        const t = this.textarea;
        if (t.selectionStart !== t.selectionEnd) return false;
        return (t.selectionStart ?? 0) >= t.value.length;
    }

    private requestUpdate() {
        if (!this.isCaretAtEnd()) {
            this.post({ type: "pcHide" });
            this.hideAll();
            return;
        }
        const input = this.currentInput();
        const direction =
            input.length < this.previousInput.length &&
            this.previousInput.startsWith(input)
                ? "backward"
                : "forward";
        this.previousInput = input;
        this.post({ type: "pcUpdate", input, direction });
    }

    private onInput = () => {
        this.requestUpdate();
        // Re-render inline immediately so ghost text follows new content
        // even before the host has sent an updated state.
        this.renderInline();
    };

    private onKeydown = () => {
        // Defer to next tick so selectionStart reflects the post-key state
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
        // Hide menu when textarea loses focus.  Use a slight delay so a
        // mousedown on a menu item still fires onCompletion before close().
        setTimeout(() => {
            if (this.disposed) return;
            this.menu?.close();
            this.menu = undefined;
            this.ghostSpan.textContent = "";
        }, 150);
    };

    private onScroll = () => {
        // Keep mirror scroll in sync with textarea so ghost stays aligned.
        this.mirror.scrollTop = this.textarea.scrollTop;
        this.mirror.scrollLeft = this.textarea.scrollLeft;
    };

    private syncMirrorStyles() {
        const cs = getComputedStyle(this.textarea);
        const m = this.mirror.style;
        m.position = "absolute";
        m.left = `${this.textarea.offsetLeft}px`;
        m.top = `${this.textarea.offsetTop}px`;
        m.width = `${this.textarea.offsetWidth}px`;
        m.height = `${this.textarea.offsetHeight}px`;
        m.font = cs.font;
        m.fontFamily = cs.fontFamily;
        m.fontSize = cs.fontSize;
        m.lineHeight = cs.lineHeight;
        m.letterSpacing = cs.letterSpacing;
        m.padding = cs.padding;
        m.border = cs.border;
        m.borderColor = "transparent";
        m.boxSizing = cs.boxSizing;
        m.whiteSpace = "pre-wrap";
        m.wordWrap = "break-word";
        m.overflow = "hidden";
        m.color = "transparent";
        m.pointerEvents = "none";
        m.zIndex = "0";
    }

    private renderInline() {
        if (!this.inline || !this.state || this.state.items.length === 0) {
            this.ghostSpan.textContent = "";
            this.toggle?.hide();
            return;
        }
        if (!this.isCaretAtEnd()) {
            this.ghostSpan.textContent = "";
            return;
        }
        const item = this.state.items[0];
        const suffix = item.matchText.substring(this.state.prefix.length);
        if (suffix.length === 0) {
            this.ghostSpan.textContent = "";
            return;
        }
        // Re-sync layout (font may have changed via theme).
        this.syncMirrorStyles();
        this.mirror.textContent = "";
        const userText = document.createTextNode(this.textarea.value);
        this.mirror.appendChild(userText);
        this.ghostSpan.textContent = suffix;
        this.mirror.appendChild(this.ghostSpan);
        this.toggle?.show();
    }

    private renderMenu() {
        if (this.inline) {
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
        const r = this.container.getBoundingClientRect();
        return {
            left: r.left + 8,
            bottom: window.innerHeight - r.top,
        };
    }
}
