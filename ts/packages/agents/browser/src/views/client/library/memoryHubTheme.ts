// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ThemeMode = "system" | "light" | "dark";

export const THEME_KEY = "memoryHub.theme";

const modes: Record<ThemeMode, { icon: string; label: string }> = {
    system: { icon: "fa-circle-half-stroke", label: "System" },
    light: { icon: "fa-sun", label: "Light" },
    dark: { icon: "fa-moon", label: "Dark" },
};
// Light is the default; System follows the OS only when chosen.
const order: ThemeMode[] = ["light", "dark", "system"];

export function nextTheme(mode: ThemeMode): ThemeMode {
    return order[(order.indexOf(mode) + 1) % order.length];
}

export function readTheme(storage: Pick<Storage, "getItem">): ThemeMode {
    try {
        const value = storage.getItem(THEME_KEY);
        return value === "dark" || value === "system" ? value : "light";
    } catch {
        return "light";
    }
}

function saveTheme(storage: Pick<Storage, "setItem">, mode: ThemeMode): void {
    try {
        storage.setItem(THEME_KEY, mode);
    } catch {
        // Storage can be unavailable; the choice then lasts for this page only.
    }
}

export function applyTheme(
    mode: ThemeMode,
    root: HTMLElement,
    button?: HTMLElement,
): void {
    if (mode === "system") delete root.dataset.theme;
    else root.dataset.theme = mode;
    if (!button) return;
    const { icon, label } = modes[mode];
    const text = `Theme: ${label}`;
    button.setAttribute("aria-label", text);
    button.title = text;
    const glyph = button.querySelector("i");
    if (glyph) glyph.className = `fa-solid ${icon}`;
}

export function mountThemeToggle(
    button: HTMLElement,
    storage: Storage = localStorage,
    root: HTMLElement = document.documentElement,
): void {
    let mode = readTheme(storage);
    applyTheme(mode, root, button);
    button.addEventListener("click", () => {
        mode = nextTheme(mode);
        saveTheme(storage, mode);
        applyTheme(mode, root, button);
    });
}
