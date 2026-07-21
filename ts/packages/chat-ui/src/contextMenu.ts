// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Lightweight right-click context menu offering copy/paste affordances
 * for the chat input and read-only chat content. A single floating
 * `<div>` is reused across targets — attach() wires a contextmenu
 * listener that opens the menu with the appropriate item set based on
 * whether the target is editable and whether the current selection is
 * non-empty.
 */

type MenuItemId = "cut" | "copy" | "paste" | "selectAll";

interface MenuItem {
    id: MenuItemId;
    label: string;
    enabled: boolean;
    action: () => void;
}

/**
 * Options for attaching a context menu to an element.
 */
export interface ContextMenuTargetOptions {
    /**
     * True when the target accepts text input (cut/paste are enabled).
     * For read-only message content this should be false.
     */
    editable: boolean;
}

export class ChatContextMenu {
    private readonly menu: HTMLDivElement;
    private isOpen = false;
    private readonly onDocClick = (e: MouseEvent) => {
        if (!this.menu.contains(e.target as Node)) this.close();
    };
    private readonly onDocKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.close();
    };
    private readonly onScroll = () => this.close();

    constructor() {
        this.menu = document.createElement("div");
        this.menu.className = "chat-context-menu";
        this.menu.setAttribute("role", "menu");
        this.menu.style.display = "none";
        // Prevent the menu itself from triggering a nested context menu.
        this.menu.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    /**
     * Attach the context-menu trigger to an element. Multiple targets
     * can share the same ChatContextMenu instance.
     */
    attach(target: HTMLElement, options: ContextMenuTargetOptions): void {
        target.addEventListener("contextmenu", (e) => {
            // Allow the default browser menu when the Shift key is held —
            // matches common conventions for opting out of custom menus.
            if (e.shiftKey) return;
            e.preventDefault();
            this.open(e, target, options);
        });
    }

    private ensureMounted() {
        if (!this.menu.isConnected) {
            document.body.appendChild(this.menu);
        }
    }

    private open(
        event: MouseEvent,
        target: HTMLElement,
        options: ContextMenuTargetOptions,
    ) {
        this.ensureMounted();
        const items = this.buildItems(target, options);
        if (items.length === 0) return;

        this.menu.replaceChildren();
        for (const item of items) {
            const el = document.createElement("div");
            el.className = "chat-context-menu-item";
            el.setAttribute("role", "menuitem");
            el.textContent = item.label;
            if (!item.enabled) {
                el.classList.add("chat-context-menu-item-disabled");
                el.setAttribute("aria-disabled", "true");
            } else {
                // Use mousedown so the target's selection isn't lost to a
                // focus change before we act on it.
                el.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                });
                el.addEventListener("click", () => {
                    this.close();
                    item.action();
                });
            }
            this.menu.appendChild(el);
        }

        this.menu.style.display = "block";
        this.position(event.clientX, event.clientY);

        if (!this.isOpen) {
            this.isOpen = true;
            // Defer listener registration so the originating contextmenu
            // event doesn't immediately close the menu.
            setTimeout(() => {
                document.addEventListener("mousedown", this.onDocClick, true);
                document.addEventListener("keydown", this.onDocKeyDown, true);
                window.addEventListener("scroll", this.onScroll, true);
                window.addEventListener("resize", this.onScroll, true);
            }, 0);
        }
    }

    private position(clientX: number, clientY: number) {
        // Initially place at the requested point, then nudge inside the
        // viewport if the menu would overflow.
        this.menu.style.left = `${clientX}px`;
        this.menu.style.top = `${clientY}px`;
        const rect = this.menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = clientX;
        let top = clientY;
        if (rect.right > vw) left = Math.max(0, vw - rect.width - 4);
        if (rect.bottom > vh) top = Math.max(0, vh - rect.height - 4);
        this.menu.style.left = `${left}px`;
        this.menu.style.top = `${top}px`;
    }

    private close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.menu.style.display = "none";
        document.removeEventListener("mousedown", this.onDocClick, true);
        document.removeEventListener("keydown", this.onDocKeyDown, true);
        window.removeEventListener("scroll", this.onScroll, true);
        window.removeEventListener("resize", this.onScroll, true);
    }

    private buildItems(
        target: HTMLElement,
        options: ContextMenuTargetOptions,
    ): MenuItem[] {
        const sel = window.getSelection();
        const selectedText = sel ? sel.toString() : "";
        const hasSelection = selectedText.length > 0;
        const editable = options.editable;

        const items: MenuItem[] = [];

        if (editable) {
            items.push({
                id: "cut",
                label: "Cut",
                enabled: hasSelection,
                action: () => cutSelection(selectedText),
            });
        }

        items.push({
            id: "copy",
            label: "Copy",
            enabled: hasSelection,
            action: () => copyText(selectedText),
        });

        if (editable) {
            items.push({
                id: "paste",
                label: "Paste",
                enabled: true,
                action: () => pasteInto(target),
            });
        }

        items.push({
            id: "selectAll",
            label: "Select All",
            enabled: true,
            action: () => selectAll(target),
        });

        return items;
    }
}

function copyText(text: string) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text: string) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand("copy");
    } catch {
        // Best-effort; nothing more to do.
    }
    ta.remove();
}

// Notify listeners (send-button enable state, completion fetch) that an
// element's value changed from a programmatic edit.
function fireInputEvent(el: EventTarget | null | undefined) {
    el?.dispatchEvent(new Event("input", { bubbles: true }));
}

function cutSelection(text: string) {
    if (!text) return;
    copyText(text);
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        fireInputEvent(document.activeElement);
    }
}

async function pasteInto(target: HTMLElement) {
    let text = "";
    if (navigator.clipboard && navigator.clipboard.readText) {
        try {
            text = await navigator.clipboard.readText();
        } catch {
            text = "";
        }
    }
    if (!text) {
        // Fall back to execCommand('paste') — usually blocked outside
        // of native menus, but worth trying for completeness.
        target.focus();
        try {
            document.execCommand("paste");
        } catch {
            // Give up silently.
        }
        return;
    }
    target.focus();
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && target.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
        range.deleteContents();
    } else {
        range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
    }
    const node = document.createTextNode(text);
    range.insertNode(node);
    // Move caret to end of inserted text.
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireInputEvent(target);
}

function selectAll(target: HTMLElement) {
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

/**
 * Copy or cut the active selection for a Ctrl/Cmd+C or Ctrl/Cmd+X
 * keyboard shortcut, using the same clipboard path as the right-click
 * menu (getSelection + navigator.clipboard, with an execCommand
 * fallback).
 *
 * VS Code webviews don't run the native clipboard action on the DOM
 * selection for these keys, so only the JS path works - that is why the
 * right-click menu copies but the keyboard doesn't. A host can call this
 * from a keydown listener to restore keyboard copy/cut over the chat
 * history and the message input. The Electron shell gets these natively
 * and does not need it.
 *
 * Returns true when it acted on a non-empty selection, so the caller can
 * call preventDefault().
 */
export function handleClipboardShortcut(e: KeyboardEvent): boolean {
    if (
        e.defaultPrevented ||
        e.altKey ||
        e.shiftKey ||
        !(e.ctrlKey || e.metaKey)
    ) {
        return false;
    }
    const key = e.key.toLowerCase();
    if (key !== "c" && key !== "x") {
        return false;
    }
    const isCut = key === "x";

    // Native <input>/<textarea> keep their selection outside of
    // window.getSelection(), so read it off the focused element.
    const active = document.activeElement;
    if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
    ) {
        const start = active.selectionStart ?? 0;
        const end = active.selectionEnd ?? 0;
        if (end <= start) {
            return false;
        }
        copyText(active.value.slice(start, end));
        if (isCut && !active.readOnly && !active.disabled) {
            active.setRangeText("", start, end, "end");
            fireInputEvent(active);
        }
        return true;
    }

    const sel = window.getSelection();
    const text = sel ? sel.toString() : "";
    if (!text) {
        return false;
    }
    if (isCut && isEditableSelection(sel)) {
        cutSelection(text);
    } else {
        copyText(text);
    }
    return true;
}

// True when the selection sits inside editable content (the message
// input) rather than the read-only chat history, so Ctrl+X only deletes
// where deletion is valid.
function isEditableSelection(sel: Selection | null): boolean {
    const node = sel?.anchorNode ?? null;
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el instanceof HTMLElement && el.isContentEditable;
}
