// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type MenuItem = {
    label: string;
    icon: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean | (() => boolean);
};

export function icon(name: string): HTMLElement {
    const glyph = document.createElement("i");
    glyph.className = name.includes(" ") ? name : `fa-solid ${name}`;
    glyph.setAttribute("aria-hidden", "true");
    return glyph;
}

export function setIconButton(
    target: HTMLButtonElement,
    glyph: string,
    label: string,
): HTMLButtonElement {
    target.classList.add("icon-btn");
    target.setAttribute("aria-label", label);
    target.title = label;
    target.replaceChildren(icon(glyph));
    return target;
}

export function iconButton(
    glyph: string,
    label: string,
    action: () => void,
    className = "",
): HTMLButtonElement {
    const result = document.createElement("button");
    result.type = "button";
    if (className) result.classList.add(...className.split(" "));
    result.addEventListener("click", action);
    return setIconButton(result, glyph, label);
}

export const SLOW_REQUEST_MS = 15_000;

// After delayMs, appends a "taking longer" note with a Cancel button to the
// status element. Call the returned function when the request settles.
export function watchSlowRequest(
    status: HTMLElement,
    onCancel: () => void,
    delayMs = SLOW_REQUEST_MS,
): () => void {
    const note = document.createElement("span");
    note.className = "hub-slow-note";
    const timer = window.setTimeout(() => {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
            note.remove();
            onCancel();
        });
        note.append(" This is taking longer than usual. ", cancel);
        status.append(note);
    }, delayMs);
    return () => {
        window.clearTimeout(timer);
        note.remove();
    };
}

let closeOpenMenu: (() => void) | undefined;

export function menuButton(
    label: string,
    items: MenuItem[],
    glyph = "fa-ellipsis",
): HTMLElement {
    const host = document.createElement("span");
    host.className = "hub-menu-host";
    const trigger = iconButton(glyph, label, () => toggle());
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    host.append(trigger);

    function close(): void {
        host.querySelector(".hub-menu")?.remove();
        trigger.setAttribute("aria-expanded", "false");
        document.removeEventListener("click", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
        if (closeOpenMenu === close) closeOpenMenu = undefined;
    }
    function onOutside(event: Event): void {
        if (!host.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
        trigger.focus();
    }
    function toggle(): void {
        if (host.querySelector(".hub-menu")) {
            close();
            return;
        }
        closeOpenMenu?.();
        const menu = document.createElement("div");
        menu.className = "hub-menu";
        menu.setAttribute("role", "menu");
        for (const item of items) {
            const entry = document.createElement("button");
            entry.type = "button";
            entry.setAttribute("role", "menuitem");
            entry.disabled =
                typeof item.disabled === "function"
                    ? item.disabled()
                    : !!item.disabled;
            if (item.danger) entry.classList.add("danger");
            entry.append(icon(item.icon), item.label);
            entry.addEventListener("click", () => {
                close();
                item.action();
            });
            menu.append(entry);
        }
        host.append(menu);
        trigger.setAttribute("aria-expanded", "true");
        closeOpenMenu = close;
        document.addEventListener("click", onOutside, true);
        document.addEventListener("keydown", onKey, true);
        menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
    return host;
}
