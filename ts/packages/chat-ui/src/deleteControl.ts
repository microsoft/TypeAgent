// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { iconChevronDown, iconTrash } from "./icons.js";

/**
 * Create a developer-mode "delete message" split button.
 *
 * The primary button performs a soft delete (a recoverable "move to trash");
 * the caret opens a small menu that lets the user choose between the same soft
 * delete and a permanent (hard) delete. `onDelete(permanent)` is invoked with
 * the chosen mode.
 */
export function createDeleteControl(
    onDelete: (permanent: boolean) => void,
): HTMLElement {
    const root = document.createElement("div");
    root.className = "chat-message-actions chat-delete-control";

    const primary = makeButton(
        "chat-action-button chat-delete-primary",
        "Move to trash (recoverable)",
        iconTrash(),
        (ev) => {
            ev.stopPropagation();
            onDelete(false);
        },
    );

    const caret = makeButton(
        "chat-action-button chat-delete-caret",
        "Delete options",
        iconChevronDown(),
        (ev) => {
            ev.stopPropagation();
            openDeleteMenu(caret, onDelete);
        },
    );

    root.appendChild(primary);
    root.appendChild(caret);
    return root;
}

function makeButton(
    className: string,
    label: string,
    glyph: HTMLElement,
    onClick: (ev: MouseEvent) => void,
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(glyph);
    btn.addEventListener("click", onClick);
    return btn;
}

function openDeleteMenu(
    anchor: HTMLElement,
    onDelete: (permanent: boolean) => void,
): void {
    document.querySelector(".chat-delete-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "chat-feedback-menu chat-delete-menu";

    const dismiss = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node) && ev.target !== anchor) {
            menu.remove();
            document.removeEventListener("mousedown", dismiss, true);
        }
    };

    const entries: { label: string; permanent: boolean }[] = [
        { label: "🗑  Move to trash (recoverable)", permanent: false },
        { label: "⨯  Delete permanently", permanent: true },
    ];
    for (const e of entries) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "chat-feedback-menu-item";
        item.textContent = e.label;
        item.addEventListener("click", () => {
            menu.remove();
            document.removeEventListener("mousedown", dismiss, true);
            onDelete(e.permanent);
        });
        menu.appendChild(item);
    }

    positionMenu(menu, anchor);
    setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
}

function positionMenu(el: HTMLElement, anchor: HTMLElement): void {
    el.style.position = "fixed";
    el.style.zIndex = "9999";
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const rect = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + h > vh - 8) top = Math.max(8, rect.top - h - 4);
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (left < 8) left = 8;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "";
}
