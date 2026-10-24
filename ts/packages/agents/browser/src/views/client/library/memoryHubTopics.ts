// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TopicQueryPage,
    TopicQueryRequest,
    ViewBuildJob,
} from "@typeagent/memory-service";
import { mountGraphDetails } from "./memoryHubGraphDetails";

export interface TopicBrowserOptions {
    corpusId: () => string | undefined;
    query: (request: TopicQueryRequest) => Promise<TopicQueryPage>;
    rebuild: (corpusId: string) => Promise<ViewBuildJob>;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onError: (error: unknown) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    value?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    return node;
}

export function mountTopicBrowser(
    host: HTMLElement,
    options: TopicBrowserOptions,
) {
    const root = element("section");
    root.className = "phase2-card";
    root.setAttribute("aria-label", "Maintained topics");
    const heading = element("h3", "Maintained topics");
    const search = element("input");
    search.type = "search";
    search.placeholder = "Filter topic labels or scoped aliases";
    search.setAttribute("aria-label", "Filter maintained topics");
    const load = element("button", "Browse topics");
    const rebuild = element("button", "Rebuild topics");
    const back = element("button", "All topics");
    back.hidden = true;
    const next = element("button", "Next topic page");
    next.hidden = true;
    const status = element(
        "p",
        "Select a corpus to browse the complete maintained topic view.",
    );
    status.setAttribute("role", "status");
    const limits = element("p");
    const list = element("div");
    root.append(
        heading,
        search,
        load,
        rebuild,
        back,
        status,
        limits,
        list,
        next,
    );
    host.append(root);
    const eventDetails = mountGraphDetails(host, options);
    let epoch = 0;
    let disposed = false;
    let request: TopicQueryRequest | undefined;
    let continuation: string | undefined;

    function render(page: TopicQueryPage, corpusId: string) {
        list.replaceChildren();
        status.textContent = `${page.nodes.length} shown of ${page.matchingNodes} matching; ${page.totalNodes} maintained topics; ${page.omittedNodes} omitted from this response. Generation ${page.generation ?? "not available"}.`;
        limits.textContent = [
            ...page.limits,
            `${page.omittedParents} organizational links, ${page.omittedRelated} related links and ${page.omittedNeighborhoods} neighbors omitted.`,
            `Full-state blob payload: ${page.io.stateBytes} bytes uncompressed; snapshot ${page.io.snapshotBytes} serialized bytes; ${page.io.elapsedMs.toFixed(1)} ms. Physical disk traffic is not measured by these payload counts.`,
        ].join(" ");
        for (const topic of page.nodes) {
            const card = element("article");
            const title = element("button", topic.label);
            title.addEventListener(
                "click",
                () =>
                    void browse({
                        corpusId,
                        topicId: topic.id,
                        depth: 1,
                        pageSize: 24,
                    }),
            );
            card.append(
                title,
                element(
                    "p",
                    `${topic.scope} · ${topic.occurrenceCount} occurrences · ${topic.authorship}`,
                ),
                element("p", topic.summary || `Summary ${topic.summaryState}.`),
                element(
                    "p",
                    [
                        ...topic.limits,
                        `${topic.omittedOccurrences} occurrence IDs and ${topic.omittedCitations} summary citations omitted.`,
                    ].join(" "),
                ),
            );
            for (const citation of topic.citations) {
                const eventId =
                    citation.evidence?.kind === "event"
                        ? citation.evidence.eventId
                        : undefined;
                const source = element(
                    "button",
                    eventId
                        ? `Event ${eventId} · original evidence`
                        : `Source ${citation.sourceId} · manage source`,
                );
                source.addEventListener("click", () =>
                    eventId
                        ? eventDetails.openEvent(corpusId, eventId)
                        : options.onOpenSource(corpusId, citation.sourceId),
                );
                const evidence = element("details");
                evidence.append(
                    element(
                        "summary",
                        eventId
                            ? `Original indexed event evidence · ${eventId}`
                            : `Original indexed evidence · revision ${citation.revisionId}`,
                    ),
                    element("blockquote", citation.excerpt),
                    element("code", citation.locator),
                );
                card.append(source, evidence);
            }
            const parents = page.parents
                .filter((edge) => edge.childId === topic.id)
                .map((edge) => edge.parentId);
            const children = page.parents
                .filter((edge) => edge.parentId === topic.id)
                .map((edge) => edge.childId);
            const related = page.related
                .filter((edge) => edge.fromId === topic.id)
                .map((edge) => edge.toId);
            card.append(
                element(
                    "p",
                    `Organization: ${parents.length} displayed parents, ${children.length} displayed children. ${related.length} displayed related links.`,
                ),
            );
            list.append(card);
        }
        if (request?.topicId && page.neighborhoods.length) {
            const neighbors = element("section");
            neighbors.append(element("h4", "Incidence-derived neighbors"));
            for (const neighbor of page.neighborhoods) {
                const button = element(
                    "button",
                    `${neighbor.label} · ${neighbor.scope} · ${neighbor.sharedSources} shared sources`,
                );
                button.addEventListener(
                    "click",
                    () =>
                        void browse({
                            corpusId,
                            topicId: neighbor.topicId,
                            depth: 1,
                            pageSize: 24,
                        }),
                );
                neighbors.append(button);
            }
            list.append(neighbors);
        }
        continuation = page.nextContinuationToken;
        next.hidden = !continuation;
        back.hidden = !request?.topicId;
    }

    async function browse(selected?: TopicQueryRequest) {
        const corpusId = options.corpusId();
        if (!corpusId) {
            status.textContent =
                "Select one corpus before browsing maintained topics.";
            return;
        }
        if (selected && selected.corpusId !== corpusId) {
            const error = new Error(
                "Topic corpus scope changed; browse the selected corpus again.",
            );
            status.textContent = error.message;
            list.replaceChildren();
            options.onError(error);
            return;
        }
        request = selected ?? { corpusId, search: search.value, pageSize: 24 };
        const current = ++epoch;
        load.disabled = true;
        next.disabled = true;
        status.textContent = "Loading maintained topic snapshot…";
        try {
            const page = await options.query(request);
            if (!disposed && current === epoch) render(page, corpusId);
        } catch (error) {
            if (!disposed && current === epoch) {
                status.textContent =
                    error instanceof Error ? error.message : String(error);
                list.replaceChildren();
                next.hidden = true;
                options.onError(error);
            }
        } finally {
            if (!disposed && current === epoch) {
                load.disabled = false;
                next.disabled = false;
            }
        }
    }
    load.addEventListener("click", () => void browse());
    back.addEventListener("click", () => void browse());
    search.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void browse();
    });
    next.addEventListener("click", () => {
        if (request && continuation)
            void browse({ ...request, continuationToken: continuation });
    });
    rebuild.addEventListener("click", () => {
        const corpusId = options.corpusId();
        if (!corpusId) {
            status.textContent = "Select one corpus before rebuilding topics.";
            return;
        }
        const current = epoch;
        rebuild.disabled = true;
        void options
            .rebuild(corpusId)
            .then(
                (job) => {
                    if (!disposed && current === epoch)
                        status.textContent = `Topic build ${job.jobId}: ${job.state}. Browse again when complete.`;
                },
                (error: unknown) => {
                    if (!disposed && current === epoch) {
                        status.textContent =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        options.onError(error);
                    }
                },
            )
            .finally(() => {
                if (!disposed && current === epoch) rebuild.disabled = false;
            });
    });
    return {
        refresh: () => {
            epoch++;
            eventDetails.close();
            request = undefined;
            continuation = undefined;
            list.replaceChildren();
            load.disabled = false;
            next.disabled = false;
            rebuild.disabled = false;
            next.hidden = true;
            back.hidden = true;
            status.textContent =
                "Browse maintained topics for the selected corpus.";
        },
        hide: () => eventDetails.close(),
        dispose: () => {
            disposed = true;
            epoch++;
            eventDetails.dispose();
            root.remove();
        },
    };
}
