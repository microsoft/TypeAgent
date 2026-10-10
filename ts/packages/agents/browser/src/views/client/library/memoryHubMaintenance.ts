// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewBuildJob, ViewVersion } from "@typeagent/memory-service";
import { viewMaintenanceDefinitionSchema } from "@typeagent/memory-client/view-protocol";
import { invokeMemory } from "./viewClient";
import { rbButton, rbNode } from "./memoryHubRunbookUi";

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
            ...(view.content.kind === "wiki"
                ? {
                      wikiDiscovery: {
                          rules: "explicit-subjects-v1",
                          createDraftPages: false,
                          subjects: view.content.sections.map((page) => ({
                              key: page.id,
                              pageId: page.id,
                              title: page.heading,
                              taxonomy: page.details.taxonomy,
                          })),
                      },
                  }
                : {}),
        },
        null,
        2,
    );
    editor.oninput = options.onChange;
    const result = rbNode("pre");
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
            "Manual maintenance rebuilds only affected whole views. Choose pinned, currentSources with sourceIds, or scopedSources with sourceTypes/tags/project. Project is exact source metadata.project; all tags must match. Wiki subject keys come from reviewed bindings or metadata.viewSubjects, not title matching. New pages require createDraftPages; unsupported identity, removals or overflow block visibly. Existing publication policy still applies. No periodic scheduler.",
        ),
        editor,
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
            }),
        ),
        rbNode("h5", "Accepted dependency and discovery manifest"),
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
        result,
    );
    return panel;
}
