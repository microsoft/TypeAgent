// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import "./memoryHubViewPreferences.css";

export type MemoryHubViewMode = "list" | "grid" | "timeline" | "domain";
export type MemoryHubViewPreferences = {
    defaultViewMode: MemoryHubViewMode;
    showConfidenceScores: boolean;
    enableNotifications: boolean;
    notices: string[];
};
export type MemoryHubViewPreferenceUpdate = Partial<
    Omit<MemoryHubViewPreferences, "notices">
>;

// Legacy Settings uses the DOM id defaultViewMode but persists the field viewMode.
const KEY = "websiteLibrary_userPreferences";
const subscribers = new Set<() => void>();
const modes: MemoryHubViewMode[] = ["list", "grid", "timeline", "domain"];

function readStored(): Record<string, unknown> {
    const stored = localStorage.getItem(KEY);
    if (stored === null) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(
            "Saved Knowledge Library preferences must be an object.",
        );
    return parsed as Record<string, unknown>;
}

export function getMemoryHubViewPreferences(): MemoryHubViewPreferences {
    const stored = readStored();
    const notices: string[] = [];
    const viewMode = modes.find((mode) => mode === stored.viewMode);
    if (stored.viewMode !== undefined && !viewMode)
        notices.push(
            "Saved default view is unsupported. List is used without replacing the saved value.",
        );
    function booleanPreference(key: string): boolean {
        const value = stored[key];
        if (value === undefined) return true;
        if (typeof value === "boolean") return value;
        notices.push(
            `Saved ${key} is unsupported. The default is used without replacing the saved value.`,
        );
        return true;
    }
    return {
        defaultViewMode: viewMode ?? "list",
        showConfidenceScores: booleanPreference("showConfidenceScores"),
        enableNotifications: booleanPreference("enableNotifications"),
        notices,
    };
}

export function updateMemoryHubViewPreferences(
    update: MemoryHubViewPreferenceUpdate,
): MemoryHubViewPreferences {
    const stored = readStored();
    if (update.defaultViewMode !== undefined) {
        if (!modes.includes(update.defaultViewMode))
            throw new Error("Unsupported default memory view.");
        stored.viewMode = update.defaultViewMode;
    }
    for (const key of [
        "showConfidenceScores",
        "enableNotifications",
    ] as const) {
        if (update[key] === undefined) continue;
        if (typeof update[key] !== "boolean")
            throw new Error(`Invalid ${key} preference.`);
        stored[key] = update[key];
    }
    localStorage.setItem(KEY, JSON.stringify(stored));
    for (const subscriber of subscribers) subscriber();
    return getMemoryHubViewPreferences();
}

export function subscribeMemoryHubViewPreferences(
    listener: (preferences: MemoryHubViewPreferences) => void,
    onError: (error: unknown) => void,
): () => void {
    const refresh = () => {
        try {
            listener(getMemoryHubViewPreferences());
        } catch (error) {
            onError(error);
        }
    };
    const storageChanged = (event: StorageEvent) => {
        if (event.key === KEY || event.key === null) refresh();
    };
    subscribers.add(refresh);
    window.addEventListener("storage", storageChanged);
    return () => {
        subscribers.delete(refresh);
        window.removeEventListener("storage", storageChanged);
    };
}

export function mountMemoryHubViewPreferences(
    host: HTMLElement,
    options: { onError: (error: unknown) => void },
) {
    const root = document.createElement("section");
    root.className = "memory-view-preferences";
    root.setAttribute("aria-label", "Memory view preferences");
    const title = document.createElement("h2");
    title.textContent = "View preferences";
    const form = document.createElement("form");
    const view = document.createElement("select");
    view.name = "defaultViewMode";
    for (const mode of modes) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = mode[0].toUpperCase() + mode.slice(1);
        view.append(option);
    }
    const confidence = document.createElement("input");
    confidence.type = "checkbox";
    confidence.name = "showConfidenceScores";
    const notifications = document.createElement("input");
    notifications.type = "checkbox";
    notifications.name = "enableNotifications";
    function field(text: string, control: HTMLElement) {
        const label = document.createElement("label");
        label.append(text, control);
        return label;
    }
    const note = document.createElement("p");
    note.textContent =
        "Timeline and Domain apply only to web evidence; other evidence remains visible in List. Confidence scores apply only to typed insights (retrieval ranking is not confidence). Optional Search completion notifications require host support; this does not control search status, errors, or other host notifications.";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const outdated = document.createElement("p");
    outdated.setAttribute("role", "status");
    outdated.hidden = true;
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload saved view preferences";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save view preferences";
    form.append(
        field("Default Search view", view),
        field("Show insight confidence scores", confidence),
        field("Allow optional Search completion notifications", notifications),
        save,
    );
    root.append(title, form, reload, note, outdated, status);
    host.append(root);
    const dirty = new Set<keyof MemoryHubViewPreferenceUpdate>();
    let disposed = false;
    view.addEventListener("change", () => dirty.add("defaultViewMode"));
    confidence.addEventListener("change", () =>
        dirty.add("showConfidenceScores"),
    );
    notifications.addEventListener("change", () =>
        dirty.add("enableNotifications"),
    );
    function report(error: unknown) {
        status.textContent = `View preferences unavailable: ${String(error)}`;
        options.onError(error);
    }
    function render(preferences: MemoryHubViewPreferences) {
        view.value = preferences.defaultViewMode;
        confidence.checked = preferences.showConfidenceScores;
        notifications.checked = preferences.enableNotifications;
        status.textContent = preferences.notices.join(" ");
        dirty.clear();
        outdated.hidden = true;
        outdated.textContent = "";
        save.disabled = false;
    }
    function markOutdated() {
        outdated.hidden = false;
        outdated.textContent =
            "Saved preferences changed or could not be refreshed while you have unsaved edits. Your pending selections are preserved. Reload or discard to use saved values, or save to merge only your edited fields.";
    }
    function receivePreferences(preferences: MemoryHubViewPreferences) {
        if (dirty.size) markOutdated();
        else render(preferences);
    }
    function refreshError(error: unknown) {
        if (dirty.size) markOutdated();
        report(error);
    }
    function show() {
        if (disposed || dirty.size) return;
        try {
            render(getMemoryHubViewPreferences());
        } catch (error) {
            save.disabled = true;
            report(error);
        }
    }
    function discardChanges(): boolean {
        if (disposed || !dirty.size) return true;
        if (!confirm("Discard unsaved memory view preferences?")) return false;
        try {
            render(getMemoryHubViewPreferences());
            return true;
        } catch (error) {
            refreshError(error);
            return false;
        }
    }
    reload.addEventListener("click", () => {
        if (dirty.size) discardChanges();
        else show();
    });
    const unsubscribe = subscribeMemoryHubViewPreferences(
        receivePreferences,
        refreshError,
    );
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (disposed) return;
        const update: MemoryHubViewPreferenceUpdate = {};
        if (dirty.has("defaultViewMode")) {
            const mode = modes.find((value) => value === view.value);
            if (!mode) {
                report(new Error("Unsupported default memory view."));
                return;
            }
            update.defaultViewMode = mode;
        }
        if (dirty.has("showConfidenceScores"))
            update.showConfidenceScores = confidence.checked;
        if (dirty.has("enableNotifications"))
            update.enableNotifications = notifications.checked;
        try {
            const preferences = updateMemoryHubViewPreferences(update);
            render(preferences);
            status.textContent = [
                "View preferences saved on this browser.",
                ...preferences.notices,
            ].join(" ");
        } catch (error) {
            report(error);
        }
    });
    show();
    return {
        show,
        isDirty: () => !disposed && dirty.size > 0,
        discardChanges,
        dispose() {
            disposed = true;
            unsubscribe();
            root.remove();
        },
    };
}
