// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewBuildResultState,
    ViewBuildTargetResult,
    ViewMaintenanceTargetPlan,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubDocumentUi";

const states: Record<ViewBuildResultState, string> = {
    pending: "Queued",
    inventorying: "Reading evidence",
    checkingInventory: "Checking evidence",
    generating: "Building document",
    validating: "Checking document",
    draft: "Draft saved",
    merged: "Edits merged",
    published: "Published",
    searchable: "Searchable",
    conflicted: "Conflict needs resolution",
    blocked: "Blocked",
    stale: "Inputs changed",
    skipped: "Skipped",
    failed: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
};

export function viewBuildSummary(job: ViewBuildJob): string {
    const saved = job.results.filter((result) =>
        ["draft", "merged", "published", "searchable"].includes(result.state),
    ).length;
    const attention = job.results.filter((result) =>
        ["conflicted", "blocked", "stale", "failed", "interrupted"].includes(
            result.state,
        ),
    ).length;
    return `${saved} of ${job.results.length} targets saved${attention ? `; ${attention} need attention` : ""}`;
}

function resultTitle(result: ViewBuildTargetResult): string {
    const labels = {
        wiki: "Wiki",
        projectBrief: "Project brief",
        timeline: "Timeline",
        troubleshootingGuide: "Troubleshooting guide",
    };
    return labels[result.snapshot.definition.kind];
}

export function mountMemoryHubViewActivity(
    host: HTMLElement,
    attentionHost: HTMLElement,
    options: {
        scope: () => string | undefined;
        onError: (error: unknown) => void;
        onOpenView: (
            corpusId: string,
            viewId: string,
            revisionId?: string,
        ) => void;
        onOpenBuild: (corpusId: string, jobId: string) => void;
        onAttentionCount?: (count: number) => void;
    },
) {
    const root = rbNode("section", undefined, "hub-view-activity");
    root.setAttribute("aria-label", "View operations");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const list = rbNode("div");
    const detail = rbNode("div");
    root.append(rbNode("h3", "View builds and updates"), status, list, detail);
    host.append(root);
    let sequence = 0;
    let disposed = false;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let selected: { corpusId: string; jobId: string } | undefined;
    const cancellationRequests = new Set<string>();

    async function run(operation: () => Promise<void>): Promise<void> {
        try {
            await operation();
        } catch (error) {
            status.textContent = `View activity unavailable: ${rbError(error)}`;
            options.onError(error);
        }
    }

    async function sourceAttention(
        corpusId: string,
        corpusName: string,
        maintenance: boolean,
    ): Promise<HTMLElement[]> {
        const snapshot = await invokeMemory("memoryListViews", { corpusId });
        const active = snapshot.views.filter(
            (view) => view.state !== "archived",
        );
        const maintained = active.filter((view) => view.definition.maintenance);
        const targets: ViewMaintenanceTargetPlan[] = [];
        if (maintenance)
            for (let offset = 0; offset < maintained.length; offset += 32) {
                const plan = await invokeMemory("memoryPlanViewMaintenance", {
                    corpusId,
                    viewIds: maintained
                        .slice(offset, offset + 32)
                        .map((view) => view.viewId),
                });
                targets.push(...plan.targets);
            }
        return Promise.all(
            active.map(async (view) => {
                const publication = await invokeMemory(
                    "memoryGetViewPublication",
                    {
                        corpusId,
                        viewId: view.viewId,
                    },
                );
                const target = targets.find(
                    (target) => target.viewId === view.viewId,
                );
                const reason =
                    publication.indexState === "failed"
                        ? `Indexing failed: ${publication.reason}`
                        : target &&
                            ["rebuild", "blocked"].includes(target.state)
                          ? `${target.state === "rebuild" ? "Update needed" : "Update blocked"}: ${target.reason}`
                          : view.state === "stale"
                            ? "Evidence changed; inspect this view's update settings."
                            : undefined;
                const card = rbNode("article", undefined, "card");
                if (!reason) return card;
                card.append(
                    rbNode("h4", view.content.title),
                    rbNode("p", `${corpusName} · ${reason}`),
                    rbButton(
                        publication.indexState === "failed"
                            ? "Inspect publication and retry indexing"
                            : "Preview update",
                        () => options.onOpenView(corpusId, view.viewId),
                    ),
                );
                return card;
            }),
        ).then((cards) => cards.filter((card) => card.childElementCount > 0));
    }

    function renderJob(job: ViewBuildJob): HTMLElement {
        const cancellationKey = JSON.stringify([job.corpusId, job.jobId]);
        if (job.state !== "running")
            cancellationRequests.delete(cancellationKey);
        const card = rbNode("article", undefined, "card hub-view-job");
        card.append(
            rbNode("h4", job.maintenancePlan ? "Update views" : "Build views"),
            rbNode("p", `${job.state} · ${viewBuildSummary(job)}`),
            rbNode("time", new Date(job.updatedAt).toLocaleString()),
        );
        for (const result of job.results) {
            const row = rbNode("div", undefined, "hub-view-result");
            row.append(
                rbNode("strong", resultTitle(result)),
                rbNode("span", states[result.state]),
                rbNode("p", result.reason),
            );
            row.append(
                rbButton(
                    result.conflictId ? "Resolve conflict" : "Open view",
                    () =>
                        options.onOpenView(
                            job.corpusId,
                            result.viewId,
                            result.conflictId ? undefined : result.revisionId,
                        ),
                ),
            );
            if (
                !result.revisionId &&
                !result.conflictId &&
                !["draft", "merged", "published", "searchable"].includes(
                    result.state,
                )
            )
                row.querySelector("button")!.disabled = true;
            if (result.publication)
                row.append(
                    rbNode(
                        "p",
                        `Publication: ${result.publication.reason}. Index: ${result.publication.indexState}.`,
                    ),
                );
            card.append(row);
        }
        const diagnostics = rbNode("details");
        diagnostics.append(
            rbNode("summary", "Operation details"),
            rbNode("pre", JSON.stringify(job, null, 2)),
        );
        card.append(diagnostics);
        if (job.state === "running") {
            const cancel = rbButton("Request cancellation", () => {
                cancel.disabled = true;
                cancellationRequests.add(cancellationKey);
                void run(async () => {
                    let response: ViewBuildJob;
                    try {
                        response = await invokeMemory("memoryCancelViewBuild", {
                            corpusId: job.corpusId,
                            jobId: job.jobId,
                        });
                    } catch (error) {
                        cancellationRequests.delete(cancellationKey);
                        throw error;
                    }
                    if (response.state !== "running")
                        cancellationRequests.delete(cancellationKey);
                    await refresh();
                    status.textContent =
                        response.state === "cancelled"
                            ? "Cancellation acknowledged. Already saved targets remain."
                            : "Cancellation requested. Already saved targets remain.";
                }).finally(() => {
                    cancel.disabled = cancellationRequests.has(cancellationKey);
                });
            });
            cancel.disabled = cancellationRequests.has(cancellationKey);
            card.append(cancel);
        } else if (
            ["failed", "partial", "cancelled", "interrupted"].includes(
                job.state,
            )
        ) {
            const retry = rbButton("Retry build", () => {
                retry.disabled = true;
                void run(async () => {
                    const next = await invokeMemory("memoryRetryViewBuild", {
                        corpusId: job.corpusId,
                        jobId: job.jobId,
                    });
                    options.onOpenBuild(next.corpusId, next.jobId);
                    await refresh();
                }).finally(() => {
                    retry.disabled = false;
                });
            });
            card.append(retry);
        }
        return card;
    }

    async function refresh(): Promise<void> {
        const current = ++sequence;
        const scope = options.scope();
        clearTimeout(timer);
        const capabilities = await invokeMemory("memoryViewCapabilities", {});
        if (disposed || current !== sequence) return;
        if (!capabilities.derivedViews?.builds) {
            list.replaceChildren();
            detail.replaceChildren();
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
            status.textContent =
                "View building is unavailable in this session.";
            return;
        }
        const corpora = await invokeMemory("memoryListCorpora", {});
        const available = corpora.filter(
            (corpus) => !scope || corpus.corpusId === scope,
        );
        const groups = await Promise.all(
            available.map(async (corpus) => {
                const [jobs, alerts] = await Promise.all([
                    invokeMemory("memoryListViewBuilds", {
                        corpusId: corpus.corpusId,
                    }),
                    sourceAttention(
                        corpus.corpusId,
                        corpus.name,
                        capabilities.derivedViews?.maintenance === true,
                    ),
                ]);
                return { corpus, jobs, alerts };
            }),
        );
        if (disposed || current !== sequence || scope !== options.scope())
            return;
        list.replaceChildren();
        attentionHost.replaceChildren();
        let total = 0;
        let running = false;
        const seen = new Set<string>();
        for (const { corpus, jobs, alerts } of groups) {
            attentionHost.append(...alerts);
            const ordered = [...jobs].sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
            );
            for (const job of ordered) {
                total++;
                running ||= job.state === "running";
                const row = rbNode("article", undefined, "card");
                row.append(
                    rbButton(
                        `${job.maintenancePlan ? "Update" : "Build"} · ${corpus.name} · ${job.state}`,
                        () => options.onOpenBuild(corpus.corpusId, job.jobId),
                    ),
                    rbNode("p", viewBuildSummary(job)),
                );
                list.append(row);
                for (const result of job.results) {
                    const key = JSON.stringify([
                        corpus.corpusId,
                        result.viewId,
                    ]);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    if (
                        ![
                            "conflicted",
                            "failed",
                            "blocked",
                            "stale",
                            "interrupted",
                        ].includes(result.state)
                    )
                        continue;
                    if (result.conflictId) {
                        const conflict = await invokeMemory(
                            "memoryGetViewConflict",
                            {
                                corpusId: corpus.corpusId,
                                conflictId: result.conflictId,
                            },
                        );
                        if (disposed || current !== sequence) return;
                        if (!conflict || conflict.state === "resolved")
                            continue;
                    }
                    const item = rbNode("article", undefined, "card");
                    item.append(
                        rbNode(
                            "h4",
                            `${resultTitle(result)} · ${states[result.state]}`,
                        ),
                        rbNode("p", `${corpus.name} · ${result.reason}`),
                        rbButton(
                            result.conflictId
                                ? "Resolve conflict"
                                : "Inspect operation",
                            () =>
                                result.conflictId
                                    ? options.onOpenView(
                                          corpus.corpusId,
                                          result.viewId,
                                      )
                                    : options.onOpenBuild(
                                          corpus.corpusId,
                                          job.jobId,
                                      ),
                        ),
                    );
                    attentionHost.append(item);
                }
            }
        }
        status.textContent = total
            ? `${total} view operations. Results are recorded per target.`
            : "No view builds yet.";
        options.onAttentionCount?.(attentionHost.childElementCount);
        if (attentionHost.childElementCount) {
            attentionHost.prepend(
                rbNode("h3", "View attention"),
                rbNode(
                    "p",
                    "Current view and build issues in this scope. The filters above apply to source and guide notifications.",
                ),
            );
        }
        if (selected) {
            const job = await invokeMemory("memoryGetViewBuild", selected);
            if (disposed || current !== sequence) return;
            detail.replaceChildren(
                job
                    ? renderJob(job)
                    : rbNode(
                          "p",
                          "This build receipt is unavailable; another receipt is not substituted.",
                      ),
            );
            if (
                cancellationRequests.has(
                    JSON.stringify([selected.corpusId, selected.jobId]),
                )
            )
                status.textContent =
                    "Cancellation requested; waiting for acknowledgment. Already saved targets remain.";
        } else detail.replaceChildren();
        if (running && visible && !disposed)
            timer = setTimeout(() => void run(refresh), 2_000);
    }

    return {
        refresh: () => run(refresh),
        scopeChanged(): void {
            sequence++;
            clearTimeout(timer);
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
        },
        async show(target?: {
            corpusId: string;
            jobId: string;
        }): Promise<void> {
            visible = true;
            selected = target;
            await run(refresh);
        },
        hide(): void {
            visible = false;
            clearTimeout(timer);
        },
        dispose(): void {
            disposed = true;
            sequence++;
            clearTimeout(timer);
            root.remove();
            attentionHost.replaceChildren();
        },
    };
}
