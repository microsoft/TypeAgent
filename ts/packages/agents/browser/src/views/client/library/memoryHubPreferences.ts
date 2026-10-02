// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryCenterHowToSettings } from "@typeagent/browser-control-rpc/serviceTypes";
import { invokeMemory } from "./viewClient";

const preferences = [
    ["buildAgentEdition", "Build draft agent editions after capture"],
    [
        "describeImages",
        "Describe supported images with the configured multimodal model",
    ],
    ["approvedAutomations", "Suggest approved, versioned automations"],
    ["mcpTools", "Suggest tools from the configured MCP catalog"],
] as const;
export function mountMemoryHubPreferences(
    host: HTMLElement,
    options: {
        scope: () => string | undefined;
        onError: (error: unknown) => void;
        onChanged: () => void | Promise<void>;
    },
) {
    const form = document.createElement("form");
    form.className = "card";
    const heading = document.createElement("h3");
    heading.textContent = "Runbook import and binding preferences";
    const notice = document.createElement("p");
    notice.textContent =
        "Detection must also be enabled above. Imports create drafts, never accept bindings or execute instructions. Image descriptions are unsupported when the configured model cannot read images; unreviewed pixels are not safe previews.";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const controls = new Map<string, HTMLInputElement>();
    form.append(heading, notice);
    for (const [key, title] of preferences) {
        const label = document.createElement("label");
        label.className = "checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = key;
        controls.set(key, input);
        label.append(input, document.createTextNode(title));
        form.append(label);
    }
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save runbook preferences";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "Reload saved preferences";
    const actions = document.createElement("div");
    actions.className = "hub-controls";
    actions.append(save, reload);
    form.append(actions, status);
    host.append(form);
    let epoch = 0;
    let disposed = false;
    let settings: MemoryCenterHowToSettings | undefined;
    let owner: string | undefined;
    let dirty = false;
    let saving = false;
    function applySelections(result: MemoryCenterHowToSettings) {
        const runbook = result.preferences?.runbook;
        const values =
            runbook !== null &&
            typeof runbook === "object" &&
            !Array.isArray(runbook)
                ? runbook
                : {};
        for (const [key, input] of controls)
            input.checked = key in values && Reflect.get(values, key) === true;
    }
    function discardChanges(): boolean {
        if (!dirty && !saving) return true;
        if (saving) {
            options.onError(
                new Error("Wait for the preferences save to finish."),
            );
            return false;
        }
        if (!confirm("Discard unsaved runbook preferences?")) return false;
        if (settings) applySelections(settings);
        dirty = false;
        return true;
    }
    function enabled(value: boolean) {
        save.disabled = !value;
        for (const input of controls.values()) input.disabled = !value;
    }
    enabled(false);
    async function show() {
        if (!discardChanges()) return;
        const corpusId = options.scope();
        const generation = ++epoch;
        settings = undefined;
        owner = undefined;
        enabled(false);
        if (!corpusId) {
            status.textContent =
                "Select a named corpus to edit these preferences.";
            return;
        }
        try {
            const result = await invokeMemory("memoryGetHowToSettings", {
                corpusId,
            });
            if (
                disposed ||
                generation !== epoch ||
                corpusId !== options.scope()
            )
                return;
            settings = result;
            owner = corpusId;
            applySelections(result);
            status.textContent = `Saved settings revision ${result.revision}. ${result.enabled && result.detectCandidates ? "Detection enabled." : "Detection is disabled; synthesis will not run."}`;
            enabled(true);
        } catch (error) {
            if (generation !== epoch || disposed) return;
            status.textContent = `Preferences unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
        }
    }
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const current = settings;
        const corpusId = owner;
        if (!current || !corpusId || corpusId !== options.scope()) {
            options.onError(
                new Error(
                    "Select and load a named corpus before saving preferences",
                ),
            );
            return;
        }
        const generation = epoch;
        const oldRunbook = current.preferences?.runbook;
        const runbook = {
            ...(oldRunbook !== null &&
            typeof oldRunbook === "object" &&
            !Array.isArray(oldRunbook)
                ? oldRunbook
                : {}),
            ...Object.fromEntries(
                [...controls].map(([key, input]) => [key, input.checked]),
            ),
        };
        saving = true;
        enabled(false);
        void invokeMemory("memoryUpdateHowToSettings", {
            corpusId,
            expectedRevision: current.revision,
            preferences: { ...current.preferences, runbook },
        })
            .then(async (result) => {
                if (
                    disposed ||
                    generation !== epoch ||
                    corpusId !== options.scope()
                )
                    return;
                settings = result;
                dirty = false;
                status.textContent = `Saved settings revision ${result.revision}; existing guides and skills are unchanged.`;
                await options.onChanged();
            })
            .catch((error: unknown) => {
                if (disposed || generation !== epoch) return;
                status.textContent = `Preferences were not saved: ${error instanceof Error ? error.message : String(error)}. Your selections are retained; reload to resolve a version conflict.`;
                options.onError(error);
            })
            .finally(() => {
                if (!disposed && generation === epoch) {
                    saving = false;
                    enabled(true);
                }
            });
    });
    reload.addEventListener("click", () => {
        void show();
    });
    form.addEventListener("change", () => {
        dirty = true;
    });
    function beforeUnload(event: BeforeUnloadEvent) {
        if (dirty || saving) {
            event.preventDefault();
            event.returnValue = "";
        }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return {
        show,
        discardChanges,
        scopeChanged() {
            epoch++;
            settings = undefined;
            owner = undefined;
            enabled(false);
        },
        dispose() {
            disposed = true;
            epoch++;
            window.removeEventListener("beforeunload", beforeUnload);
            form.remove();
        },
    };
}
