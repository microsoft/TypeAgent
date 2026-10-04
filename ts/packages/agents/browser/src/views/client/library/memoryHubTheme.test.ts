// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyTheme,
    mountThemeToggle,
    nextTheme,
    readTheme,
    THEME_KEY,
} from "./memoryHubTheme";

function storage(initial: Record<string, string> = {}): Storage {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    } as unknown as Storage;
}

function toggle(): HTMLButtonElement {
    const button = document.createElement("button");
    button.append(document.createElement("i"));
    return button;
}

test("theme cycles light, dark and system", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
});

test("nothing stored, unknown values and unavailable storage default to light", () => {
    expect(readTheme(storage())).toBe("light");
    expect(readTheme(storage({ [THEME_KEY]: "sepia" }))).toBe("light");
    expect(readTheme(storage({ [THEME_KEY]: "dark" }))).toBe("dark");
    expect(readTheme(storage({ [THEME_KEY]: "system" }))).toBe("system");
    expect(
        readTheme({
            getItem: () => {
                throw new Error("blocked");
            },
        }),
    ).toBe("light");
});

test("applyTheme sets the root attribute and the toggle label", () => {
    const root = document.createElement("html");
    const button = toggle();
    applyTheme("dark", root, button);
    expect(root.dataset.theme).toBe("dark");
    expect(button.getAttribute("aria-label")).toBe("Theme: Dark");
    expect(button.querySelector("i")!.className).toContain("fa-moon");
    applyTheme("system", root, button);
    expect(root.dataset.theme).toBeUndefined();
    expect(button.title).toBe("Theme: System");
});

test("the toggle restores the stored choice, advances and persists it", () => {
    const root = document.createElement("html");
    const button = toggle();
    const store = storage({ [THEME_KEY]: "light" });
    mountThemeToggle(button, store, root);
    expect(root.dataset.theme).toBe("light");
    button.click();
    expect(root.dataset.theme).toBe("dark");
    expect(store.getItem(THEME_KEY)).toBe("dark");
    button.click();
    expect(root.dataset.theme).toBeUndefined();
    expect(store.getItem(THEME_KEY)).toBe("system");
});

test("a storage failure does not break the toggle", () => {
    const root = document.createElement("html");
    const button = toggle();
    const blocked = {
        getItem: () => null,
        setItem: () => {
            throw new Error("quota");
        },
    } as unknown as Storage;
    mountThemeToggle(button, blocked, root);
    expect(() => button.click()).not.toThrow();
    expect(root.dataset.theme).toBe("dark");
});
