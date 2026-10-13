// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildJob, ViewVersion } from "@typeagent/memory-service";
import { viewMaintenanceDefinitionSchema } from "@typeagent/memory-client/view-protocol";
import { invokeMemory } from "./viewClient";
import { rbButton, rbNode } from "./memoryHubDocumentUi";

export function createMaintenancePanel(
    view: ViewVersion,
    head: string | null,
    options: {
        action: (operation: () => Promise<void>) => void;
        onChange: () => void;
        dirty: () => boolean;
        saved: () => Promise<void>;
        onBuild: (job: ViewBuildJob) => void;
        isCurrent: () => boolean;
    },
): HTMLElement {
    const panel = rbNode("section");
    panel.setAttribute("aria-label", "View maintenance");
    const editor = document.createElement("textarea");
    editor.setAttribute("aria-label", "Maintenance definition JSON");
    editor.rows = 14;
    editor.value = JSON.stringify(
        view.definition.maintenance ?? {
            schemaVersion: 1,
            scope: { mode: "pinned" },
        },
        null,
        2,
    );
    editor.oninput = options.onChange;
    const result = rbNode("pre");
    const advanced = rbNode("details");
    advanced.append(
        rbNode("summary", "Advanced maintenance definition"),
        editor,
    );
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", "Sources for future updates");
    mode.append(
        new Option("Keep the exact evidence (pinned)", "pinned"),
        new Option(
            "Follow latest revisions of selected sources",
            "currentSources",
        ),
        new Option(
            "Follow matching sources in this collection",
            "scopedSources",
        ),
    );
    const initial = viewMaintenanceDefinitionSchema.parse(
        JSON.parse(editor.value),
    );
    mode.value = initial.scope.mode;
    const fields = rbNode("div");
    const field = (label: string, value: string) => {
        const wrapper = rbNode("label", label);
        const input = document.createElement("input");
        input.value = value;
        input.setAttribute("aria-label", label);
        wrapper.append(input);
        fields.append(wrapper);
        return input;
    };
    const sourceIds = field(
        "Source IDs (comma separated)",
        initial.scope.mode === "currentSources"
            ? initial.scope.sourceIds.join(", ")
            : "",
    );
    const sourceTypes = field(
        "Source types (comma separated)",
        initial.scope.mode === "scopedSources"
            ? (initial.scope.sourceTypes ?? []).join(", ")
            : "",
    );
    const tags = field(
        "All tags (comma separated)",
        initial.scope.mode === "scopedSources"
            ? (initial.scope.tags ?? []).join(", ")
            : "",
    );
    const project = field(
        "Exact project metadata",
        initial.scope.mode === "scopedSources"
            ? (initial.scope.project ?? "")
            : "",
    );
    const split = (value: string) => [
        ...new Set(
            value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        ),
    ];
    const sync = () => {
        const definition = JSON.parse(editor.value);
        definition.scope =
            mode.value === "pinned"
                ? { mode: "pinned" }
                : mode.value === "currentSources"
                  ? {
                        mode: "currentSources",
                        sourceIds: split(sourceIds.value),
                    }
                  : {
                        mode: "scopedSources",
                        ...(sourceTypes.value.trim()
                            ? { sourceTypes: split(sourceTypes.value) }
                            : {}),
                        ...(tags.value.trim()
                            ? { tags: split(tags.value) }
                            : {}),
                        ...(project.value.trim()
                            ? { project: project.value.trim() }
                            : {}),
                    };
        editor.value = JSON.stringify(definition, null, 2);
        updateFields();
        options.onChange();
    };
    const updateFields = () => {
        sourceIds.parentElement!.hidden = mode.value !== "currentSources";
        for (const input of [sourceTypes, tags, project])
            input.parentElement!.hidden = mode.value !== "scopedSources";
    };
    mode.onchange = sync;
    for (const input of [sourceIds, sourceTypes, tags, project])
        input.oninput = sync;
    updateFields();
    const diagnostics = rbNode("details");
    diagnostics.append(
        rbNode("summary", "Exact update plan and receipt"),
        result,
    );
    const manifest = rbNode("details");
    manifest.append(
        rbNode("summary", "Accepted dependency and discovery manifest"),
        rbNode(
            "pre",
            JSON.stringify(
                view.maintenance ?? {
                    state: "No accepted maintenance checkpoint; full reconciliation required",
                },
                null,
                2,
            ),
        ),
    );
    const summary = rbNode("p");
    summary.setAttribute("role", "status");
    const requireSaved = () => {
        if (options.dirty())
            throw new Error(
                "Save or discard maintenance edits before planning or running",
            );
    };
    panel.append(
        rbNode("h4", `Maintain ${view.viewId}`),
        rbNode(
            "p",
            "Preview changes before manually updating this view. Keep exact evidence, follow chosen sources, or follow explicit metadata matches. Existing publication policy applies; updates do not run on a schedule.",
        ),
        mode,
        fields,
        advanced,
        rbButton("Save maintenance definition", () =>
            options.action(async () => {
                if (!options.isCurrent()) return;
                const maintenance = viewMaintenanceDefinitionSchema.parse(
                    JSON.parse(editor.value),
                );
                const saved = await invokeMemory(
                    "memoryUpdateViewMaintenance",
                    {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        expectedHead: head,
                        expectedVersion: view.version,
                        maintenance,
                    },
                );
                if (!options.isCurrent()) return;
                result.textContent = JSON.stringify(
                    saved.version.definition.maintenance,
                    null,
                    2,
                );
                await options.saved();
            }),
        ),
        rbButton("Preview maintenance", () =>
            options.action(async () => {
                if (!options.isCurrent()) return;
                requireSaved();
                const plan = await invokeMemory("memoryPlanViewMaintenance", {
                    corpusId: view.corpusId,
                    viewIds: [view.viewId],
                });
                if (!options.isCurrent()) return;
                result.textContent = JSON.stringify(plan, null, 2);
                summary.textContent = `Preview ready: ${plan.targets.length} explicit target(s). Inspect the exact plan before running.`;
            }),
        ),
        rbButton("Run manual maintenance", () =>
            options.action(async () => {
                if (!options.isCurrent()) return;
                requireSaved();
                const plan = await invokeMemory("memoryPlanViewMaintenance", {
                    corpusId: view.corpusId,
                    viewIds: [view.viewId],
                });
                if (!options.isCurrent()) return;
                const receipt = await invokeMemory("memoryMaintainViews", {
                    corpusId: view.corpusId,
                    expectedHead: plan.expectedHead,
                    targets: plan.targets.map(
                        ({ viewId, expectedVersion }) => ({
                            viewId,
                            expectedVersion,
                        }),
                    ),
                });
                if (!options.isCurrent()) return;
                result.textContent = JSON.stringify(
                    { receiptId: receipt.receiptId, plan: receipt.plan },
                    null,
                    2,
                );
                if (receipt.job) options.onBuild(receipt.job);
                summary.textContent = receipt.job
                    ? `Update started: ${receipt.job.state}. Results are recorded per target.`
                    : "Maintenance receipt recorded. No build job was started; inspect the exact receipt.";
            }),
        ),
        manifest,
        summary,
        diagnostics,
    );
    return panel;
}
