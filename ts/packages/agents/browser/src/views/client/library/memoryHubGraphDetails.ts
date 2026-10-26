// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryGraphSupport,
    MemoryGraphSupportRequest,
} from "@typeagent/memory-service";
import { mountFlyout } from "./memoryHubFlyout";
import { invokeView } from "./viewClient";
import { renderMarkdownInto } from "./utils/markdownView";

export function graphText<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

export function graphButton(label: string, run: () => void) {
    const button = graphText("button", label);
    button.type = "button";
    button.addEventListener("click", run);
    return button;
}

export interface GraphTopicContext {
    topicId: string;
    generation?: string;
}

export function mountGraphDetails(
    host: HTMLElement,
    options: {
        onOpenSource: (corpusId: string, sourceId: string) => void;
        onError: (error: unknown) => void;
    },
) {
    const flyout = mountFlyout(host, "Graph evidence");
    let version = 0;

    function error(body: HTMLElement, value: unknown, retry: () => void) {
        const section = graphText("div");
        section.dataset.graphError = "";
        const message = graphText(
            "p",
            value instanceof Error ? value.message : String(value),
        );
        message.setAttribute("role", "alert");
        section.append(message, graphButton("Retry evidence", retry));
        body.append(section);
        options.onError(value);
    }

    function evidenceView(
        support:
            | Extract<MemoryGraphSupport, { kind: "document" }>
            | Pick<
                  Extract<MemoryGraphSupport, { kind: "event" }>,
                  "kind" | "corpusId" | "eventId" | "title"
              >,
    ) {
        return {
            title: support.title ?? "Original graph evidence",
            render(body: HTMLElement) {
                let alive = true;
                let offset = 0;
                let next: number | undefined;
                const status = graphText("p");
                status.setAttribute("role", "status");
                const content = graphText(
                    "div",
                    undefined,
                    "hub-graph-evidence",
                );
                const previous = graphButton("First content page", () => {
                    offset = 0;
                    void load();
                });
                const more = graphButton("Next content page", () => {
                    if (next !== undefined) {
                        offset = next;
                        void load();
                    }
                });
                body.append(status, content, previous, more);
                if (support.kind === "document")
                    body.append(
                        graphButton("Manage source", () => {
                            flyout.close();
                            options.onOpenSource(
                                support.corpusId,
                                support.sourceId,
                            );
                        }),
                    );
                async function load() {
                    body.querySelector(":scope > [data-graph-error]")?.remove();
                    status.textContent = "Loading exact evidence...";
                    previous.disabled = true;
                    more.disabled = true;
                    try {
                        const page =
                            support.kind === "document"
                                ? await invokeView("memoryHubSourceOriginal", {
                                      corpusId: support.corpusId,
                                      sourceId: support.sourceId,
                                      revisionId: support.revisionId,
                                      ...(support.locator
                                          ? { locator: support.locator }
                                          : {}),
                                      offset,
                                  })
                                : await invokeView("memoryHubGraphEvent", {
                                      corpusId: support.corpusId,
                                      eventId: support.eventId,
                                      offset,
                                  });
                        if (!alive) return;
                        if ("available" in page && !page.available)
                            throw new Error(
                                "error" in page &&
                                typeof page.error === "string"
                                    ? page.error
                                    : "Exact evidence is unavailable.",
                            );
                        content.replaceChildren();
                        if (support.kind === "event")
                            content.append(graphText("pre", page.content));
                        else renderMarkdownInto(content, page.content);
                        next = page.nextOffset;
                        status.textContent = `${page.offset + 1}-${page.offset + page.content.length} of ${page.totalChars} characters`;
                        previous.disabled = offset === 0;
                        more.disabled = next === undefined;
                    } catch (value) {
                        if (alive) {
                            status.textContent =
                                "Evidence could not be loaded.";
                            content.replaceChildren();
                            error(body, value, () => void load());
                        }
                    }
                }
                void load();
                return () => {
                    alive = false;
                };
            },
        };
    }

    function supportRow(support: MemoryGraphSupport) {
        const row = graphText("li");
        row.append(
            graphButton(
                support.title ??
                    (support.kind === "document"
                        ? support.sourceId
                        : support.eventId),
                () => flyout.push(evidenceView(support)),
            ),
        );
        const provenance =
            support.kind === "document"
                ? `Document revision ${support.revisionId}`
                : [
                      "Event",
                      support.eventTime,
                      support.sender,
                      support.authority ?? "Authority unspecified",
                      support.conversationId,
                      support.turnId,
                  ]
                      .filter(Boolean)
                      .join(" · ");
        row.append(graphText("p", provenance));
        return row;
    }

    function topicSummary(
        body: HTMLElement,
        corpusId: string,
        topic: GraphTopicContext,
        active: () => boolean,
    ) {
        const section = graphText("section");
        section.setAttribute("aria-label", "Maintained topic summary");
        const status = graphText("p", "Loading maintained topic summary...");
        const content = graphText("div");
        section.append(status, content);
        body.append(section);
        async function load() {
            section.querySelector("[data-graph-error]")?.remove();
            try {
                const page = await invokeView("memoryQueryTopics", {
                    corpusId,
                    topicId: topic.topicId,
                    ...(topic.topicId.startsWith("concept:")
                        ? { curated: true, summarize: true }
                        : { depth: 0 }),
                    pageSize: 1,
                });
                if (!active()) return;
                if (topic.generation && page.generation !== topic.generation)
                    throw new Error(
                        "Topic snapshot changed. Refresh the graph.",
                    );
                const detail =
                    page.concepts?.find(
                        (concept) => concept.id === topic.topicId,
                    ) ?? page.nodes.find((node) => node.id === topic.topicId);
                if (!detail)
                    throw new Error("Maintained topic is no longer available.");
                status.textContent = `Generated summary · ${detail.summaryState ?? "ready"} · ${detail.scope}`;
                content.replaceChildren();
                if (detail.summary) renderMarkdownInto(content, detail.summary);
                content.append(
                    graphText(
                        "p",
                        [
                            ...page.limits,
                            ...("limits" in detail ? detail.limits : []),
                        ].join(" · "),
                    ),
                );
            } catch (value) {
                if (active()) {
                    status.textContent = "Topic summary could not be loaded.";
                    error(section, value, () => void load());
                }
            }
        }
        void load();
    }

    function open(
        title: string,
        request: MemoryGraphSupportRequest,
        expand?: () => void,
        topic?: GraphTopicContext,
    ) {
        const ticket = ++version;
        flyout.open({
            title,
            render(body) {
                let alive = true;
                if (topic)
                    topicSummary(
                        body,
                        request.corpusId,
                        topic,
                        () => alive && ticket === version,
                    );
                let continuationToken: string | undefined;
                let next: string | undefined;
                const status = graphText("p", "Loading graph evidence...");
                status.setAttribute("role", "status");
                const list = graphText("ul", undefined, "hub-graph-support");
                const previous = graphButton("First support page", () => {
                    continuationToken = undefined;
                    void load();
                });
                const more = graphButton("Next support page", () => {
                    continuationToken = next;
                    void load();
                });
                body.append(
                    graphText(
                        "p",
                        "Extracted mentions and co-occurrence are not verified facts. Authority belongs to the supporting evidence.",
                    ),
                    status,
                    list,
                    previous,
                    more,
                );
                if (expand)
                    body.append(
                        graphButton("Expand neighborhood", () => {
                            flyout.close();
                            expand();
                        }),
                    );
                async function load() {
                    body.querySelector(":scope > [data-graph-error]")?.remove();
                    status.textContent = "Loading graph evidence...";
                    list.replaceChildren();
                    previous.disabled = true;
                    more.disabled = true;
                    try {
                        const page = await invokeView("memoryHubGraphSupport", {
                            ...request,
                            pageSize: 50,
                            ...(continuationToken === undefined
                                ? {}
                                : { continuationToken }),
                        });
                        if (!alive || ticket !== version) return;
                        if (page.generation !== request.generation)
                            throw new Error(
                                "Graph generation changed; refresh the graph before opening evidence.",
                            );
                        list.replaceChildren(...page.items.map(supportRow));
                        next = page.nextContinuationToken;
                        status.textContent = `${page.items.length} of ${page.total} supporting records`;
                        previous.disabled = !continuationToken;
                        more.disabled = !next;
                    } catch (value) {
                        if (alive && ticket === version) {
                            status.textContent = "Graph evidence unavailable.";
                            error(body, value, () => void load());
                        }
                    }
                }
                void load();
                return () => {
                    alive = false;
                };
            },
        });
    }

    return {
        open,
        openEvent(corpusId: string, eventId: string, title?: string) {
            version++;
            flyout.open(
                evidenceView({
                    kind: "event",
                    corpusId,
                    eventId,
                    ...(title ? { title } : {}),
                }),
            );
        },
        close() {
            version++;
            flyout.close();
        },
        dispose() {
            version++;
            flyout.dispose();
        },
    };
}
