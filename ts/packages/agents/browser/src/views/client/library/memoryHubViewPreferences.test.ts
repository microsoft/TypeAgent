// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getMemoryHubViewPreferences,
    mountMemoryHubViewPreferences,
    subscribeMemoryHubViewPreferences,
    updateMemoryHubViewPreferences,
} from "./memoryHubViewPreferences";

jest.mock("./memoryHubViewPreferences.css", () => ({}));
const key = "websiteLibrary_userPreferences";
beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test("legacy key and viewMode migrate in place without discarding other preferences", () => {
    localStorage.setItem(
        key,
        JSON.stringify({
            viewMode: "domain",
            showConfidenceScores: false,
            enableNotifications: false,
            theme: "dark",
            future: { enabled: true },
        }),
    );
    expect(getMemoryHubViewPreferences()).toEqual({
        defaultViewMode: "domain",
        showConfidenceScores: false,
        enableNotifications: false,
        notices: [],
    });
    updateMemoryHubViewPreferences({ defaultViewMode: "timeline" });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
        viewMode: "timeline",
        showConfidenceScores: false,
        enableNotifications: false,
        theme: "dark",
        future: { enabled: true },
    });
});

test("unknown values are retained and unsupported defaults are explicitly explained", () => {
    localStorage.setItem(
        key,
        '{"viewMode":"future","showConfidenceScores":"automatic","other":42}',
    );
    const preferences = getMemoryHubViewPreferences();
    expect(preferences.defaultViewMode).toBe("list");
    expect(preferences.notices).toHaveLength(2);
    updateMemoryHubViewPreferences({ enableNotifications: false });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
        viewMode: "future",
        showConfidenceScores: "automatic",
        other: 42,
        enableNotifications: false,
    });
});

test.each(["{broken", "[]", "null", "42"])(
    "invalid stored preferences %s raise errors without overwriting",
    (stored) => {
        localStorage.setItem(key, stored);
        expect(getMemoryHubViewPreferences).toThrow();
        expect(() =>
            updateMemoryHubViewPreferences({ enableNotifications: false }),
        ).toThrow();
        expect(localStorage.getItem(key)).toBe(stored);
    },
);

test("subscriptions follow same-tab and cross-tab updates and stop on dispose", () => {
    const listener = jest.fn();
    const onError = jest.fn();
    const dispose = subscribeMemoryHubViewPreferences(listener, onError);
    updateMemoryHubViewPreferences({ defaultViewMode: "grid" });
    expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultViewMode: "grid" }),
    );
    localStorage.setItem(key, '{"viewMode":"timeline"}');
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ defaultViewMode: "timeline" }),
    );
    localStorage.setItem(key, "{bad");
    window.dispatchEvent(new StorageEvent("storage", { key }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    dispose();
    localStorage.clear();
    updateMemoryHubViewPreferences({ defaultViewMode: "list" });
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(2);
});

test("storage read and write outages are explicit, with no successful update notification", () => {
    const listener = jest.fn();
    const dispose = subscribeMemoryHubViewPreferences(listener, jest.fn());
    const set = jest
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
            throw new Error("Storage is full");
        });
    expect(() =>
        updateMemoryHubViewPreferences({ defaultViewMode: "grid" }),
    ).toThrow("Storage is full");
    expect(listener).not.toHaveBeenCalled();
    set.mockRestore();
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("Storage blocked");
    });
    expect(getMemoryHubViewPreferences).toThrow("Storage blocked");
    dispose();
});

test("settings edit only changed fields, preserve future defaults, show errors, and clean up", () => {
    localStorage.setItem(key, '{"viewMode":"future","theme":"dark"}');
    const host = document.createElement("div");
    const onError = jest.fn();
    const mounted = mountMemoryHubViewPreferences(host, { onError });
    const checkbox = host.querySelector<HTMLInputElement>(
        '[name="enableNotifications"]',
    )!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    host.querySelector("form")!.dispatchEvent(new Event("submit"));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
        viewMode: "future",
        theme: "dark",
        enableNotifications: false,
    });
    expect(host.textContent).toContain("saved on this browser");
    expect(host.textContent).toContain("does not control");
    localStorage.setItem(key, "{bad");
    mounted.show();
    expect(host.textContent).toContain("View preferences unavailable");
    expect(onError).toHaveBeenCalled();
    expect(host.querySelector("button")!.disabled).toBe(true);
    localStorage.setItem(key, '{"viewMode":"domain"}');
    mounted.show();
    expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe(
        "domain",
    );
    mounted.dispose();
    expect(host.children).toHaveLength(0);
    updateMemoryHubViewPreferences({ defaultViewMode: "grid" });
    expect(host.children).toHaveLength(0);
});

test.each(["same-tab", "storage"])(
    "%s updates preserve dirty selections until save merges edited fields with latest preferences",
    (delivery) => {
        const host = document.createElement("div");
        const mounted = mountMemoryHubViewPreferences(host, {
            onError: jest.fn(),
        });
        try {
            const view = host.querySelector<HTMLSelectElement>("select")!;
            const notifications = host.querySelector<HTMLInputElement>(
                '[name="enableNotifications"]',
            )!;
            view.value = "grid";
            view.dispatchEvent(new Event("change"));
            expect(mounted.isDirty()).toBe(true);
            if (delivery === "same-tab")
                updateMemoryHubViewPreferences({
                    defaultViewMode: "domain",
                    enableNotifications: false,
                });
            else {
                localStorage.setItem(
                    key,
                    '{"viewMode":"domain","enableNotifications":false,"future":42}',
                );
                window.dispatchEvent(new StorageEvent("storage", { key }));
            }
            expect(view.value).toBe("grid");
            expect(notifications.checked).toBe(true);
            expect(host.textContent).toContain(
                "pending selections are preserved",
            );
            mounted.show();
            expect(view.value).toBe("grid");
            expect(mounted.isDirty()).toBe(true);
            host.querySelector("form")!.dispatchEvent(new Event("submit"));
            expect(getMemoryHubViewPreferences()).toEqual(
                expect.objectContaining({
                    defaultViewMode: "grid",
                    enableNotifications: false,
                }),
            );
            expect(notifications.checked).toBe(false);
            expect(mounted.isDirty()).toBe(false);
            expect(host.textContent).not.toContain(
                "pending selections are preserved",
            );
            expect(host.textContent).toContain("saved on this browser");
            if (delivery === "storage")
                expect(JSON.parse(localStorage.getItem(key)!).future).toBe(42);
        } finally {
            mounted.dispose();
        }
    },
);

test("discard confirms ordinary navigation and restores latest saved preferences only when accepted", () => {
    const host = document.createElement("div");
    const mounted = mountMemoryHubViewPreferences(host, { onError: jest.fn() });
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    try {
        expect(mounted.discardChanges()).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        const view = host.querySelector<HTMLSelectElement>("select")!;
        view.value = "timeline";
        view.dispatchEvent(new Event("change"));
        updateMemoryHubViewPreferences({ defaultViewMode: "domain" });
        expect(mounted.discardChanges()).toBe(false);
        expect(confirm).toHaveBeenCalledWith(
            "Discard unsaved memory view preferences?",
        );
        expect(view.value).toBe("timeline");
        expect(mounted.isDirty()).toBe(true);
        expect(host.textContent).toContain("pending selections are preserved");
        confirm.mockReturnValue(true);
        expect(mounted.discardChanges()).toBe(true);
        expect(view.value).toBe("domain");
        expect(mounted.isDirty()).toBe(false);
        expect(host.textContent).not.toContain(
            "pending selections are preserved",
        );
    } finally {
        mounted.dispose();
    }
});

test("reload uses the same confirmation and failed storage reads or saves do not lose drafts", () => {
    const host = document.createElement("div");
    const onError = jest.fn();
    const mounted = mountMemoryHubViewPreferences(host, { onError });
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    try {
        const view = host.querySelector<HTMLSelectElement>("select")!;
        view.value = "grid";
        view.dispatchEvent(new Event("change"));
        const reload = Array.from(host.querySelectorAll("button")).find(
            (button) => button.textContent === "Reload saved view preferences",
        )!;
        reload.click();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(mounted.isDirty()).toBe(true);
        localStorage.setItem(key, "{bad");
        window.dispatchEvent(new StorageEvent("storage", { key }));
        expect(view.value).toBe("grid");
        expect(host.textContent).toContain("View preferences unavailable");
        expect(host.textContent).toContain("pending selections are preserved");
        confirm.mockReturnValue(true);
        expect(mounted.discardChanges()).toBe(false);
        expect(mounted.isDirty()).toBe(true);
        host.querySelector("form")!.dispatchEvent(new Event("submit"));
        expect(mounted.isDirty()).toBe(true);
        expect(view.value).toBe("grid");
        expect(host.textContent).not.toContain("saved on this browser");
        expect(onError).toHaveBeenCalledTimes(3);
        localStorage.setItem(key, '{"viewMode":"domain"}');
        reload.click();
        expect(view.value).toBe("domain");
        expect(mounted.isDirty()).toBe(false);
        expect(host.textContent).not.toContain(
            "pending selections are preserved",
        );
        mounted.dispose();
        expect(mounted.isDirty()).toBe(false);
        expect(mounted.discardChanges()).toBe(true);
    } finally {
        mounted.dispose();
    }
});
