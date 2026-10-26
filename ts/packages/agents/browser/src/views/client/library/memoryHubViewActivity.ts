// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewBuildResultState,
    ViewBuildTargetResult,
    ViewMaintenanceTargetPlan,
    ViewBuildSummary,
    ViewBuildResultSummary,
    ViewSummaryPage,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { MemoryHubInventoryPager } from "./memoryHubInventoryPager";
import {
    rbButton,
    rbChip,
    rbError,
    rbIconButton,
    rbNode,
} from "./memoryHubDocumentUi";

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

export function viewBuildSummary(job: {
    results: { state: ViewBuildResultState }[];
}): string {
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

function resultTitle(
    result: ViewBuildTargetResult | ViewBuildResultSummary,
): string {
    if (result.snapshot.pipeline === "topics-v1") return "Maintained topics";
    const labels = {
        wiki: "Wiki",
        projectBrief: "Project brief",
        timeline: "Timeline",
        troubleshootingGuide: "Troubleshooting guide",
        schemaView: "Schema-defined questions",
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
    const jobPager = new MemoryHubInventoryPager();
    const attentionPager = new MemoryHubInventoryPager();
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
    ): Promise<{ alerts: HTMLElement[]; page: ViewSummaryPage }> {
        const snapshot = await invokeMemory(
            "memoryListViewSummaries",
            attentionPager.request(corpusId),
        );
        const active = snapshot.items.filter(
            (view) => view.state !== "archived",
        );
        const maintained = active.filter((view) => view.maintained);
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
        const alerts = await Promise.all(
            active.map(async (view) => {
                const publication = view.publication;
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
                const label =
                    publication.indexState === "failed"
                        ? "Retry indexing"
                        : "Preview update";
                Object.assign(card.dataset, {
                    group: `${corpusName} · ${reason}`,
                    title: view.content.title,
                    label,
                    corpusId,
                    viewId: view.viewId,
                });
                card.append(
                    rbNode("h4", view.content.title),
                    rbNode("p", `${corpusName} · ${reason}`),
                    rbButton(label, () =>
                        options.onOpenView(corpusId, view.viewId),
                    ),
                );
                return card;
            }),
        ).then((cards) => cards.filter((card) => card.childElementCount > 0));
        return { alerts, page: snapshot };
    }

    function renderJob(job: ViewBuildJob): HTMLElement {
        const cancellationKey = JSON.stringify([job.corpusId, job.jobId]);
        if (job.state !== "running")
            cancellationRequests.delete(cancellationKey);
        const card = rbNode("article", undefined, "card hub-view-job");
        card.append(
            rbNode("h4", job.maintenancePlan ? "Update views" : "Build views"),
            rbChip(
                job.state,
                ["failed", "interrupted"].includes(job.state)
                    ? "bad"
                    : ["partial", "cancelled"].includes(job.state)
                      ? "warn"
                      : job.state === "running"
                        ? undefined
                        : "good",
            ),
            rbNode("p", viewBuildSummary(job)),
            rbNode("time", new Date(job.updatedAt).toLocaleString()),
        );
        for (const result of job.results) {
            const row = rbNode("div", undefined, "hub-view-result");
            row.append(
                rbNode("strong", resultTitle(result)),
                rbChip(states[result.state]),
                rbNode("p", result.reason),
            );
            if (result.wikiConsolidation) {
                const effect = result.wikiConsolidation;
                row.append(
                    rbChip(`Consolidation: ${effect.stage}`),
                    rbIconButton(
                        "fa-arrow-up-right-from-square",
                        "Open canonical article",
                        () =>
                            options.onOpenView(
                                job.corpusId,
                                effect.survivorViewId,
                            ),
                    ),
                    rbIconButton("fa-link", "Open original article link", () =>
                        options.onOpenView(job.corpusId, effect.retiringViewId),
                    ),
                );
            }
            if (result.snapshot.pipeline === "topics-v1") {
                row.append(
                    rbNode(
                        "p",
                        `Topic generation ${result.topicGeneration ?? "pending"}; browse the snapshot in Overview, not an article.`,
                    ),
                );
            } else {
                const open = rbButton(
                    result.conflictId ? "Resolve conflict" : "Open view",
                    () =>
                        options.onOpenView(
                            job.corpusId,
                            result.viewId,
                            result.conflictId ? undefined : result.revisionId,
                        ),
                );
                row.append(open);
                if (
                    !result.revisionId &&
                    !result.conflictId &&
                    !["draft", "merged", "published", "searchable"].includes(
                        result.state,
                    )
                )
                    open.disabled = true;
            }
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
            const cancel = rbIconButton(
                "fa-xmark",
                "Request cancellation",
                () => {
                    cancel.disabled = true;
                    cancellationRequests.add(cancellationKey);
                    void run(async () => {
                        let response: ViewBuildJob;
                        try {
                            response = await invokeMemory(
                                "memoryCancelViewBuild",
                                {
                                    corpusId: job.corpusId,
                                    jobId: job.jobId,
                                },
                            );
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
                        cancel.disabled =
                            cancellationRequests.has(cancellationKey);
                    });
                },
            );
            cancel.disabled = cancellationRequests.has(cancellationKey);
            card.append(cancel);
        } else if (
            ["failed", "partial", "cancelled", "interrupted"].includes(
                job.state,
            )
        ) {
            const retry = rbIconButton("fa-rotate-right", "Retry build", () => {
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

    function appendJobSummary(
        corpus: { corpusId: string; name: string },
        job: ViewBuildSummary,
    ): void {
        const row = rbNode("article", undefined, "card");
        row.append(
            rbButton(
                `${job.maintenance ? "Update" : "Build"} · ${corpus.name} · ${job.state}`,
                () => options.onOpenBuild(corpus.corpusId, job.jobId),
            ),
            rbNode("p", viewBuildSummary(job)),
        );
        list.append(row);
    }

    async function appendResultAttention(
        corpus: { corpusId: string; name: string },
        job: ViewBuildSummary,
        result: ViewBuildResultSummary,
        current: number,
    ): Promise<boolean> {
        if (result.conflictId) {
            const conflict = await invokeMemory("memoryGetViewConflict", {
                corpusId: corpus.corpusId,
                conflictId: result.conflictId,
            });
            if (disposed || current !== sequence) return false;
            if (!conflict || conflict.state === "resolved") return true;
        }
        const item = rbNode("article", undefined, "card");
        item.append(
            rbNode("h4", `${resultTitle(result)} · ${states[result.state]}`),
            rbNode("p", `${corpus.name} · ${result.reason}`),
            rbButton(
                result.conflictId ? "Resolve conflict" : "Inspect operation",
                () =>
                    result.conflictId
                        ? options.onOpenView(corpus.corpusId, result.viewId)
                        : options.onOpenBuild(corpus.corpusId, job.jobId),
            ),
        );
        attentionHost.append(item);
        return true;
    }

    // Views that need the same thing share one card with a row per view,
    // instead of repeating the identical sentence on every card.
    function collapseAlerts(alerts: HTMLElement[]): HTMLElement[] {
        const buckets = new Map<string, HTMLElement[]>();
        for (const alert of alerts) {
            const key = alert.dataset.group;
            if (key) buckets.set(key, [...(buckets.get(key) ?? []), alert]);
        }
        const collapsed = new Set<HTMLElement>();
        const result: HTMLElement[] = [];
        for (const alert of alerts) {
            const key = alert.dataset.group;
            const bucket = key ? buckets.get(key) : undefined;
            if (!bucket || bucket.length < 3) {
                result.push(alert);
                continue;
            }
            if (collapsed.has(bucket[0])) continue;
            bucket.forEach((entry) => collapsed.add(entry));
            const card = rbNode("article", undefined, "card");
            card.dataset.entries = String(bucket.length);
            const rows = rbNode("div", undefined, "hub-rows");
            card.append(
                rbNode("h4", `${bucket.length} views need attention`),
                rbNode("p", key),
                rows,
            );
            for (const entry of bucket) {
                const row = rbNode("div", undefined, "hub-row-actions");
                row.append(
                    rbNode("span", entry.dataset.title, "hub-grow"),
                    rbIconButton(
                        "fa-chevron-right",
                        `${entry.dataset.label}: ${entry.dataset.title}`,
                        () =>
                            options.onOpenView(
                                entry.dataset.corpusId!,
                                entry.dataset.viewId!,
                            ),
                    ),
                );
                rows.append(row);
            }
            result.push(card);
        }
        return result;
    }

    async function renderGroups(
        groups: Array<{
            corpus: { corpusId: string; name: string };
            jobs: ViewBuildSummary[];
            alerts: HTMLElement[];
        }>,
        current: number,
    ): Promise<{ total: number; running: boolean; current: boolean }> {
        let total = 0;
        let running = false;
        const seen = new Set<string>();
        for (const { corpus, jobs, alerts } of groups) {
            attentionHost.append(...collapseAlerts(alerts));
            const ordered = [...jobs].sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
            );
            for (const job of ordered) {
                total++;
                running ||= job.state === "running";
                appendJobSummary(corpus, job);
                for (const result of job.results) {
                    if (!result.current) continue;
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
                    if (
                        !(await appendResultAttention(
                            corpus,
                            job,
                            result,
                            current,
                        ))
                    )
                        return { total, running, current: false };
                }
            }
        }
        return { total, running, current: true };
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
                    jobPager.includes(corpus.corpusId)
                        ? invokeMemory(
                              "memoryListViewBuildSummaries",
                              jobPager.request(corpus.corpusId),
                          )
                        : Promise.resolve(undefined),
                    !visible && attentionPager.includes(corpus.corpusId)
                        ? sourceAttention(
                              corpus.corpusId,
                              corpus.name,
                              capabilities.derivedViews?.maintenance === true,
                          )
                        : Promise.resolve(undefined),
                ]);
                return {
                    corpus,
                    jobs: jobs?.items ?? [],
                    alerts: alerts?.alerts ?? [],
                    jobPage: jobs,
                    attentionPage: alerts?.page,
                };
            }),
        );
        if (disposed || current !== sequence || scope !== options.scope())
            return;
        jobPager.update(
            groups.flatMap((group) =>
                group.jobPage
                    ? [{ corpusId: group.corpus.corpusId, ...group.jobPage }]
                    : [],
            ),
        );
        attentionPager.update(
            groups.flatMap((group) =>
                group.attentionPage
                    ? [
                          {
                              corpusId: group.corpus.corpusId,
                              ...group.attentionPage,
                          },
                      ]
                    : [],
            ),
        );
        list.replaceChildren();
        attentionHost.replaceChildren();
        const rendered = await renderGroups(groups, current);
        if (!rendered.current) return;
        const { total, running } = rendered;
        status.textContent = total
            ? `Showing ${total} of ${jobPager.total} view operations`
            : "No view builds yet.";
        options.onAttentionCount?.(
            [...attentionHost.children].reduce(
                (sum, child) =>
                    sum + Number((child as HTMLElement).dataset.entries ?? 1),
                0,
            ) +
                Number(
                    !visible && (attentionPager.hasNext || jobPager.hasNext),
                ),
        );
        if (visible)
            list.append(
                jobPager.controls("view operations", () => void run(refresh)),
            );
        else {
            attentionHost.append(
                attentionPager.controls(
                    "view attention",
                    () => void run(refresh),
                ),
            );
            attentionHost.append(
                jobPager.controls(
                    "operation attention",
                    () => void run(refresh),
                ),
            );
        }
        if (attentionHost.childElementCount) {
            const heading = rbNode("h3", "View attention");
            heading.title =
                "Current view and build issues in this scope. The filters above apply to source and guide notifications.";
            attentionHost.prepend(heading);
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
            jobPager.reset();
            attentionPager.reset();
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
        },
        async show(target?: {
            corpusId: string;
            jobId: string;
        }): Promise<void> {
            visible = true;
            jobPager.reset();
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
