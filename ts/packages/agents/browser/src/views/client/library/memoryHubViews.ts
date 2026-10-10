// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewMergeConflict,
    ViewSnapshot,
    ViewVersion,
    ViewSynthesisOutput,
    ViewRelationshipInput,
    ViewPublicationPolicy,
    ViewPublicationStatus,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubRunbookUi";

function jsonEditor(label: string, value: unknown): HTMLTextAreaElement {
    const editor = document.createElement("textarea");
    editor.setAttribute("aria-label", label);
    editor.rows = 12;
    editor.value = JSON.stringify(value, null, 2);
    return editor;
}

function editableEdges(view: ViewVersion): ViewRelationshipInput[] {
    return view.relationships.flatMap((edge) =>
        edge.origin === "system"
            ? []
            : [
                  {
                      id: edge.id,
                      predicate: edge.predicate,
                      from: edge.from,
                      to: edge.to,
                      citations: edge.citations,
                  },
              ],
    );
}

function publicationChoice(label: string, inherit: boolean): HTMLSelectElement {
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (const value of [...(inherit ? ["inherit"] : []), "on", "off"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent =
            value === "inherit" ? "Inherit" : value === "on" ? "On" : "Off";
        select.append(option);
    }
    return select;
}

export function mountMemoryHubViews(
    host: HTMLElement,
    options: {
        scope: () => string | undefined;
        onError: (error: unknown) => void;
    },
) {
    const root = rbNode("section");
    root.className = "hub-draft-views";
    root.hidden = true;
    root.setAttribute("aria-label", "Derived views");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const controls = rbNode("div");
    const receipt = rbNode("div");
    const drafts = rbNode("div");
    const comparison = rbNode("div");
    root.append(
        rbNode("h3", "Views"),
        rbNode(
            "p",
            "Distill exact retained revisions into a conditional troubleshooting guide. Publication and index readiness are separate; neither grants human review, skill approval or execution. Configured synthesis remains live-unqualified.",
        ),
        status,
        controls,
        receipt,
        drafts,
        comparison,
    );
    host.append(root);
    let snapshot: ViewSnapshot = { head: null, views: [] };
    let policy: ViewPublicationPolicy = {
        revision: 0,
        autoPublish: true,
        views: {},
    };
    const publications = new Map<string, ViewPublicationStatus>();
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let busy = false;
    let refreshPending = false;
    let disposed = false;

    async function action(operation: () => Promise<void>): Promise<void> {
        if (busy || disposed) return;
        busy = true;
        try {
            await operation();
        } catch (error) {
            status.textContent = `View operation failed: ${rbError(error)}. No success or overwrite is assumed.`;
            options.onError(error);
        } finally {
            busy = false;
            if (refreshPending) {
                refreshPending = false;
                void action(refresh);
            }
        }
    }

    async function refresh(): Promise<void> {
        const current = ++sequence;
        const capabilities = await invokeMemory("memoryViewCapabilities", {});
        if (current !== sequence) return;
        root.hidden = !capabilities.derivedViews?.builds;
        if (root.hidden) return;
        const corpusId = options.scope();
        if (!corpusId) {
            status.textContent =
                "Choose a named corpus to build views. All memory is not an access grant.";
            controls.replaceChildren();
            drafts.replaceChildren();
            receipt.replaceChildren();
            comparison.replaceChildren();
            return;
        }
        const [views, jobs, savedPolicy] = await Promise.all([
            invokeMemory("memoryListViews", { corpusId }),
            invokeMemory("memoryListViewBuilds", { corpusId }),
            invokeMemory("memoryGetViewPublicationPolicy", { corpusId }),
        ]);
        if (current !== sequence || corpusId !== options.scope()) return;
        snapshot = views;
        policy = savedPolicy;
        publications.clear();
        await Promise.all(
            views.views.map(async (view) => {
                publications.set(
                    view.viewId,
                    await invokeMemory("memoryGetViewPublication", {
                        corpusId,
                        viewId: view.viewId,
                    }),
                );
            }),
        );
        await renderControls(corpusId, current);
        if (current !== sequence) return;
        renderDrafts();
        if (jobs[0]) renderReceipt(jobs[0]);
        else
            receipt.replaceChildren(rbNode("p", "No durable view builds yet."));
        status.textContent =
            "Opt-in views enabled. Inputs, policy and target revisions are rechecked before publication. Auto-publish does not stamp human review.";
    }

    async function renderControls(
        corpusId: string,
        current: number,
    ): Promise<void> {
        const sources: Array<{
            sourceId: string;
            revisionId: string;
            title: string;
        }> = [];
        let continuationToken: string | undefined;
        do {
            const page = await invokeMemory("memoryListSources", {
                corpusId,
                pageSize: 200,
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
            for (const source of page.items) {
                const revision = source.revisions.find(
                    (entry) => entry.revisionId === source.activeRevisionId,
                );
                if (revision?.state === "ready")
                    sources.push({
                        sourceId: source.sourceId,
                        revisionId: source.activeRevisionId,
                        title: source.title,
                    });
            }
            continuationToken = page.nextContinuationToken;
        } while (continuationToken && sources.length < 1000);
        if (continuationToken)
            throw new Error(
                "Source selection exceeds 1000 ready sources; use a bounded corpus",
            );
        if (current !== sequence) return;
        const selected = new Map<string, string>();
        const sourceHost = rbNode("fieldset");
        sourceHost.append(
            rbNode(
                "legend",
                "Select exact current evidence (maximum 32 sources)",
            ),
        );
        for (const source of sources) {
            const label = rbNode("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.onchange = () => {
                if (checkbox.checked)
                    selected.set(source.sourceId, source.revisionId);
                else selected.delete(source.sourceId);
            };
            label.append(
                checkbox,
                rbNode(
                    "span",
                    `${source.title} [${source.sourceId} @ ${source.revisionId}]`,
                ),
            );
            sourceHost.append(label);
        }
        const target = document.createElement("input");
        target.setAttribute("aria-label", "Stable view ID");
        target.placeholder = "guide-id (existing ID rebuilds that draft)";
        const cutoff = document.createElement("input");
        cutoff.setAttribute("aria-label", "Learned before ISO timestamp");
        cutoff.placeholder = "Optional learned-before ISO timestamp";
        const corpusPolicy = publicationChoice(
            "Corpus auto-publish after build",
            false,
        );
        corpusPolicy.value = policy.autoPublish ? "on" : "off";
        const settings = rbNode("fieldset");
        settings.append(
            rbNode("legend", "Corpus settings: Auto-publish after build"),
            corpusPolicy,
            rbButton("Save corpus publication setting", () => {
                void action(async () => {
                    await invokeMemory("memoryUpdateViewPublicationPolicy", {
                        corpusId,
                        expectedHead: snapshot.head,
                        expectedRevision: policy.revision,
                        autoPublish: corpusPolicy.value === "on",
                    });
                    await refresh();
                });
            }),
        );
        const buildPolicy = publicationChoice(
            "Build auto-publish after build",
            true,
        );
        const effective = rbNode("p");
        const updateEffective = () => {
            const override = policy.views[target.value.trim()]?.autoPublish;
            const value =
                buildPolicy.value !== "inherit"
                    ? buildPolicy.value === "on"
                    : (override ?? policy.autoPublish);
            const origin =
                buildPolicy.value !== "inherit"
                    ? "build override"
                    : override != null
                      ? "view override"
                      : "corpus setting";
            effective.textContent = `Auto-publish after build: ${value ? "On" : "Off"} (${origin}). One-build overrides do not change saved settings.`;
        };
        target.oninput = buildPolicy.onchange = updateEffective;
        updateEffective();
        controls.replaceChildren(
            settings,
            sourceHost,
            target,
            cutoff,
            buildPolicy,
            effective,
            rbButton("Build views", () => {
                void action(async () => {
                    if (dirty)
                        throw new Error(
                            "Save or explicitly discard editor changes before building",
                        );
                    const viewId = target.value.trim();
                    if (!viewId || !selected.size)
                        throw new Error("Choose evidence and a stable view ID");
                    const latest = await invokeMemory("memoryListViews", {
                        corpusId,
                    });
                    const prior = latest.views.find(
                        (view) => view.viewId === viewId,
                    );
                    const job = await invokeMemory("memoryBuildViews", {
                        corpusId,
                        expectedHead: latest.head,
                        targets: [
                            {
                                expectedVersion: prior?.version ?? 0,
                                definition: {
                                    viewId,
                                    kind: "troubleshootingGuide",
                                    selector: {
                                        kind: "sources",
                                        sources: [...selected].map(
                                            ([sourceId, revisionId]) => ({
                                                sourceId,
                                                revisionId,
                                            }),
                                        ),
                                    },
                                },
                            },
                        ],
                        ...(cutoff.value.trim()
                            ? { bounds: { learnedBefore: cutoff.value.trim() } }
                            : {}),
                        ...(buildPolicy.value === "inherit"
                            ? {}
                            : { publication: buildPolicy.value === "on" }),
                    });
                    if (current === sequence) renderReceipt(job);
                });
            }),
            rbButton("Refresh views and receipts", () => {
                void action(refresh);
            }),
        );
    }

    function renderReceipt(job: ViewBuildJob): void {
        if (job.corpusId !== options.scope()) return;
        if (timer) clearTimeout(timer);
        receipt.replaceChildren(
            rbNode("h4", `Build ${job.jobId}: ${job.state}`),
        );
        for (const result of job.results) {
            const effective = result.snapshot.publicationPolicy;
            if (effective)
                receipt.append(
                    rbNode(
                        "p",
                        `Auto-publish: ${effective.autoPublish ? "On" : "Off"} (${effective.origin}); corpus policy revision ${effective.corpusRevision}, view policy revision ${effective.viewRevision}`,
                    ),
                );
            if (result.publication)
                receipt.append(
                    rbNode(
                        "p",
                        `Published ${result.publication.publishedRevisionId}; indexed ${result.publication.indexedRevisionId ?? "not ready"}: ${result.publication.reason}`,
                    ),
                );
            receipt.append(
                rbNode(
                    "p",
                    `${result.viewId}: ${result.state}. ${result.reason}`,
                ),
                rbNode(
                    "p",
                    `Input fingerprint: ${result.snapshot.fingerprint}; exact sources: ${result.snapshot.inputs.map((source) => `${source.sourceId}@${source.revisionId}`).join(", ")}`,
                ),
            );
            if (result.inventory) {
                const details = rbNode("details");
                details.append(
                    rbNode(
                        "summary",
                        "Inspect source-first inventory, source check and final artifact coverage",
                    ),
                    rbNode(
                        "p",
                        "Source-to-inventory and semantic checks are model-based, not guarantees of semantic completeness. Diagnostic-only drafts are not reusable recovery.",
                    ),
                    rbNode(
                        "pre",
                        JSON.stringify(
                            {
                                inventory: result.inventory,
                                sourceCheck: result.inventoryAudit,
                                finalCoverage: result.coverage,
                            },
                            null,
                            2,
                        ),
                    ),
                );
                receipt.append(details);
            }
            if (result.missingEvidence?.length)
                receipt.append(
                    rbNode(
                        "p",
                        `Missing evidence: ${result.missingEvidence.join("; ")}`,
                    ),
                );
            if (result.conflictId)
                receipt.append(
                    rbButton("Compare and resolve conflict", () => {
                        void action(() =>
                            showConflict(job.corpusId, result.conflictId!),
                        );
                    }),
                );
        }
        receipt.append(
            rbButton("Refresh build status", () => {
                void action(() => poll(job));
            }),
        );
        if (job.results.some((result) => result.conflictId))
            receipt.append(
                rbNode(
                    "p",
                    "This receipt records the original build outcome. Explicit conflict resolution saves a separate draft revision.",
                ),
            );
        if (job.state === "running") {
            receipt.append(
                rbButton("Cancel pending materialization", () => {
                    void action(async () =>
                        renderReceipt(
                            await invokeMemory("memoryCancelViewBuild", {
                                corpusId: job.corpusId,
                                jobId: job.jobId,
                            }),
                        ),
                    );
                }),
            );
            const current = sequence;
            const tick = () => {
                if (current !== sequence) return;
                if (busy) timer = setTimeout(tick, 500);
                else void action(() => poll(job));
            };
            timer = setTimeout(tick, 500);
        } else if (job.state !== "complete")
            receipt.append(
                rbButton("Retry failed targets", () => {
                    void action(async () =>
                        renderReceipt(
                            await invokeMemory("memoryRetryViewBuild", {
                                corpusId: job.corpusId,
                                jobId: job.jobId,
                            }),
                        ),
                    );
                }),
            );
    }

    async function poll(job: ViewBuildJob): Promise<void> {
        const current = sequence;
        const value = await invokeMemory("memoryGetViewBuild", {
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (current !== sequence) return;
        if (!value)
            throw new Error("Exact build receipt is unavailable or forgotten");
        renderReceipt(value);
        // Polling never replaces an active editor.
        if (value.state !== "running" && !dirty) {
            snapshot = await invokeMemory("memoryListViews", {
                corpusId: job.corpusId,
            });
            if (current === sequence) renderDrafts();
        }
    }

    function renderDrafts(): void {
        if (dirty) return;
        drafts.replaceChildren(rbNode("h4", "Current draft views"));
        for (const view of snapshot.views.filter(
            (value) => value.content.kind === "troubleshootingGuide",
        ))
            drafts.append(
                rbButton(
                    `${view.content.title} (${view.state}, v${view.version})`,
                    () => showEditor(view),
                ),
            );
    }

    function showEditor(view: ViewVersion): void {
        if (!discardChanges()) return;
        const content = jsonEditor(
            "Draft content with stable section IDs",
            view.content,
        );
        const edges = jsonEditor("Typed relationships", editableEdges(view));
        const viewPolicy = publicationChoice(
            "View auto-publish after build",
            true,
        );
        const override = policy.views[view.viewId]?.autoPublish;
        viewPolicy.value =
            override == null ? "inherit" : override ? "on" : "off";
        const publication = publications.get(view.viewId);
        const publish = (retry: boolean) => {
            void action(async () => {
                if (dirty)
                    throw new Error(
                        "Save or discard edits before publishing or retrying indexing",
                    );
                if (!snapshot.head)
                    throw new Error("Exact view history head is unavailable");
                const revisionId = retry
                    ? publication?.publishedRevisionId
                    : view.revisionId;
                if (!revisionId)
                    throw new Error("No published revision to index");
                const result = await invokeMemory(
                    retry ? "memoryRetryViewIndex" : "memoryPublishView",
                    {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        revisionId,
                        expectedHead: snapshot.head,
                        expectedVersion: view.version,
                    },
                );
                await refresh();
                status.textContent = result.reason;
            });
        };
        content.oninput = edges.oninput = () => {
            dirty = true;
        };
        comparison.replaceChildren(
            rbNode("h4", `Edit ${view.viewId} version ${view.version}`),
            rbNode(
                "p",
                "Content and relationships are separate structured edits. Narrative remains editable; checked fact/context passages must remain somewhere in the final artifact. Rebuild with changed evidence to revise facts. Saving checks exact evidence and semantic/context support; unsupported edits are blocked.",
            ),
            content,
            edges,
            rbNode(
                "p",
                `Publication: ${publication?.blockedReason ?? publication?.reason ?? "not published"}. Published ${publication?.publishedRevisionId ?? "none"}; indexed ${publication?.indexedRevisionId ?? "none"}.`,
            ),
            viewPolicy,
            rbButton("Save view publication override", () => {
                void action(async () => {
                    await invokeMemory("memoryUpdateViewPublicationPolicy", {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        expectedHead: snapshot.head,
                        expectedRevision:
                            policy.views[view.viewId]?.revision ?? 0,
                        autoPublish:
                            viewPolicy.value === "inherit"
                                ? null
                                : viewPolicy.value === "on",
                    });
                    await refresh();
                });
            }),
            rbButton("Publish exact revision", () => publish(false)),
            rbButton("Retry index", () => publish(true)),
            rbButton("Save explicit edits", () => {
                void action(async () => {
                    await invokeMemory("memorySaveViewDraft", {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        expectedHead: snapshot.head,
                        expectedVersion: view.version,
                        definition: {
                            viewId: view.viewId,
                            kind: "troubleshootingGuide",
                            selector: view.definition.selector,
                        },
                        content: JSON.parse(content.value),
                        relationships: JSON.parse(edges.value),
                    });
                    dirty = false;
                    comparison.replaceChildren();
                    await refresh();
                });
            }),
            rbButton("Inspect history", () => {
                void action(async () => {
                    const history = await invokeMemory("memoryViewHistory", {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                    });
                    const display = rbNode(
                        "pre",
                        JSON.stringify(history, null, 2),
                    );
                    comparison.append(display);
                });
            }),
            rbButton("Discard unsaved edits", () => {
                if (discardChanges()) comparison.replaceChildren();
            }),
        );
    }

    async function showConflict(
        corpusId: string,
        conflictId: string,
    ): Promise<void> {
        if (!discardChanges()) return;
        const currentSequence = sequence;
        const [conflict, latest] = await Promise.all([
            invokeMemory("memoryGetViewConflict", { corpusId, conflictId }),
            invokeMemory("memoryListViews", { corpusId }),
        ]);
        if (currentSequence !== sequence) return;
        if (!conflict) throw new Error("Conflict is unavailable or forgotten");
        renderConflict(conflict, latest);
    }

    function renderConflict(
        conflict: ViewMergeConflict,
        latest: ViewSnapshot,
    ): void {
        comparison.replaceChildren(
            rbNode(
                "h4",
                `Conflict ${conflict.conflictId}: ${conflict.targets.join(", ")}`,
            ),
        );
        for (const [label, value] of [
            ["Old generated base", conflict.base],
            ["Human draft at conflict", conflict.human],
            ["New generated candidate", conflict.candidate],
        ] as const)
            comparison.append(
                rbNode("h5", label),
                rbNode(
                    "pre",
                    JSON.stringify(value ?? "No known generated base", null, 2),
                ),
            );
        if (conflict.state === "resolved") {
            if (!conflict.resolutionRevisionId)
                throw new Error(
                    "Resolved conflict is missing its resolution revision",
                );
            comparison.append(
                rbNode(
                    "p",
                    `Resolved in draft revision ${conflict.resolutionRevisionId}. This historical comparison is read-only.`,
                ),
            );
            return;
        }
        const current = latest.views.find(
            (view) => view.viewId === conflict.viewId,
        );
        if (!current) throw new Error("Conflict target is missing");
        if (current.revisionId !== conflict.expectedRevisionId) {
            comparison.append(
                rbNode(
                    "p",
                    "The current draft changed after this conflict. This comparison is read-only; rebuild against the current draft before resolving.",
                ),
            );
            return;
        }
        const combined = jsonEditor(
            "Explicit combined resolution",
            conflict.candidate,
        );
        combined.oninput = () => {
            dirty = true;
        };
        const choice = document.createElement("select");
        choice.setAttribute("aria-label", "Conflict resolution choice");
        for (const [value, label] of [
            ["human", "Keep my edits"],
            ["generated", "Use new generated content"],
            ["combined", "Use explicit combined result"],
        ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            choice.append(option);
        }
        comparison.append(
            choice,
            combined,
            rbButton("Resolve explicitly and save draft", () => {
                void action(async () => {
                    const selected = choice.value as
                        | "human"
                        | "generated"
                        | "combined";
                    const output: ViewSynthesisOutput | undefined =
                        selected === "combined"
                            ? JSON.parse(combined.value)
                            : undefined;
                    const saved = await invokeMemory(
                        "memoryResolveViewConflict",
                        {
                            corpusId: conflict.corpusId,
                            conflictId: conflict.conflictId,
                            expectedHead: latest.head!,
                            expectedVersion: current.version,
                            expectedRevisionId: current.revisionId,
                            inputFingerprint: conflict.input.fingerprint,
                            choice: selected,
                            ...(output === undefined
                                ? {}
                                : { combined: output }),
                        },
                    );
                    dirty = false;
                    comparison.replaceChildren();
                    await refresh();
                    if (!disposed && options.scope() === conflict.corpusId)
                        status.textContent = `Conflict resolved explicitly; saved draft version ${saved.version.version}. No publication or human review is granted.`;
                });
            }),
        );
    }

    function discardChanges(): boolean {
        if (dirty && !confirm("Discard unsaved draft view edits?"))
            return false;
        dirty = false;
        return true;
    }
    return {
        refresh: () => action(refresh),
        discardChanges,
        scopeChanged() {
            if (disposed) return;
            sequence++;
            if (timer) clearTimeout(timer);
            controls.replaceChildren();
            drafts.replaceChildren();
            receipt.replaceChildren();
            comparison.replaceChildren();
            root.hidden = true;
            if (busy) refreshPending = true;
            else void action(refresh);
        },
        dispose() {
            disposed = true;
            refreshPending = false;
            sequence++;
            if (timer) clearTimeout(timer);
            root.remove();
        },
    };
}
