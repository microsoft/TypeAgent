// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryAcquisitionProgress } from "@typeagent/browser-control-rpc/serviceTypes";
import { invokeMemory } from "./viewClient";
import { rbButton, rbIconButton, rbNode } from "./memoryHubDocumentUi";
import { routeHash } from "./memoryHubModel";

export function acquisitionStatusError(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (/disabled/i.test(message))
        return "Acquisition is disabled by host policy.";
    if (/unavailable|unsupported|not configured/i.test(message))
        return "Acquisition capability is unavailable on this host.";
    return "Acquisition operation failed. Request details are restricted to trusted host diagnostics.";
}

export function mountMemoryHubAcquisitions(host: HTMLElement) {
    const status = rbNode("p", undefined, "hub-muted");
    status.setAttribute("role", "status");
    const controls = rbNode("div");
    const list = rbNode("div");
    const acquisitionHeading = rbNode("h4", "Acquisition progress");
    acquisitionHeading.title =
        "Read-only progress for existing requests. Run once only processes host-authorized requests; it does not admit requests, grant tool permissions, or enable periodic work.";
    host.setAttribute("aria-label", "Acquisition progress");
    host.append(acquisitionHeading, status, controls, list);
    let sequence = 0;
    let working = false;
    let corpora: Array<{ corpusId: string; name: string }> = [];
    let selectedView: string | undefined;
    async function act(operation: () => Promise<void>) {
        if (working) return;
        working = true;
        for (const button of host.querySelectorAll<HTMLButtonElement>("button"))
            button.disabled = true;
        try {
            await operation();
            await refresh(corpora, selectedView);
        } catch (error) {
            status.textContent = acquisitionStatusError(error);
        } finally {
            working = false;
            for (const button of host.querySelectorAll<HTMLButtonElement>(
                "button",
            ))
                button.disabled = button.dataset.terminal === "true";
        }
    }
    function card(request: MemoryAcquisitionProgress): HTMLElement {
        const article = rbNode("article", undefined, "card");
        article.append(
            rbNode("h4", `${request.requestId} · ${request.state}`),
            rbNode(
                "p",
                `Created ${request.createdAt} · updated ${request.updatedAt} · calls ${request.calls} · retries ${request.retries}`,
            ),
        );
        if (request.hasError)
            article.append(
                rbNode(
                    "p",
                    "This request reported an error. Sensitive request details are not displayed.",
                ),
            );
        for (const consumer of request.consumers) {
            const link = rbNode(
                "a",
                `Question ${consumer.slotId} · view ${consumer.viewId} · definition ${consumer.definitionRevision}`,
            );
            link.href = routeHash({
                page: "questions",
                corpusId: request.corpusId,
                objectId: consumer.viewId,
            });
            article.append(link);
        }
        if (request.receipt) {
            const job = rbNode(
                "a",
                `Ingestion ${request.receipt.state} · revision ${request.receipt.revisionId}`,
            );
            job.href = routeHash({
                page: "activity",
                corpusId: request.corpusId,
                objectId: request.receipt.jobId,
            });
            const source = rbNode("a", `Retained source ${request.sourceId}`);
            source.href = routeHash({
                page: "library",
                corpusId: request.corpusId,
                objectId: request.sourceId,
            });
            article.append(job, source);
        }
        const cancel = rbButton("Cancel acquisition", () => {
            if (
                !confirm(
                    "Cancel this acquisition request? Shared retained sources will not be removed.",
                )
            )
                return;
            void act(async () => {
                await invokeMemory("memoryCancelAcquisition", {
                    corpusId: request.corpusId,
                    requestId: request.requestId,
                });
            });
        });
        cancel.dataset.terminal = String(
            request.state === "resolved" || request.state === "cancelled",
        );
        cancel.disabled = cancel.dataset.terminal === "true" || working;
        article.append(cancel);
        return article;
    }
    async function refresh(
        targets: Array<{ corpusId: string; name: string }>,
        viewId?: string,
    ) {
        corpora = targets;
        selectedView = viewId;
        const current = ++sequence;
        status.textContent = "Loading acquisition progress…";
        controls.replaceChildren();
        list.replaceChildren();
        const results = await Promise.allSettled(
            targets.map(async (corpus) => ({
                corpus,
                requests: await invokeMemory("memoryListAcquisitions", {
                    corpusId: corpus.corpusId,
                }),
            })),
        );
        if (current !== sequence) return;
        const failures: string[] = [];
        let count = 0;
        for (let index = 0; index < results.length; index++) {
            const result = results[index];
            if (result.status === "rejected") {
                failures.push(
                    `${targets[index].name}: ${acquisitionStatusError(result.reason)}`,
                );
                continue;
            }
            const { corpus, requests } = result.value;
            const run = rbIconButton(
                "fa-play",
                `Run acquisitions once · ${corpus.name}`,
                () => {
                    if (
                        !confirm(
                            "Run existing host-authorized acquisitions once? This grants no new tool permissions.",
                        )
                    )
                        return;
                    void act(async () => {
                        await invokeMemory("memoryRunAcquisitions", {
                            corpusId: corpus.corpusId,
                        });
                    });
                },
            );
            run.disabled = working;
            controls.append(run);
            for (const request of requests.filter(
                (request) =>
                    !viewId ||
                    request.consumers.some(
                        (consumer) => consumer.viewId === viewId,
                    ),
            )) {
                list.append(card(request));
                count++;
            }
        }
        status.textContent = failures.length
            ? `Acquisition progress incomplete. ${failures.join("; ")}`
            : `${count} ${count === 1 ? "request" : "requests"}${viewId ? " for this view" : ""}`;
    }
    return {
        refresh,
        clear() {
            sequence++;
            controls.replaceChildren();
            list.replaceChildren();
            status.textContent =
                "Acquisition progress is unavailable until a question collection is selected.";
        },
    };
}
