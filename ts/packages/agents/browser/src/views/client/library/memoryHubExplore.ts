// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hubNotifications } from "./memoryHubNotifications";
import type {
    MemoryHubExploreResult,
    MemoryHubGraphSource,
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgeKind,
} from "@typeagent/browser-control-rpc/viewRpc";
import { watchSlowRequest } from "./memoryHubUi";
import { invokeView } from "./viewClient";
import {
    mountKnowledgeCollection,
    KNOWLEDGE_PREVIEW_SIZE,
} from "./memoryKnowledgeCollection";
import { mountFlyout, type FlyoutView } from "./memoryHubFlyout";
import "./memoryHubPhase2.css";
import { mountTopicBrowser } from "./memoryHubTopics";
import { mountGraphDetails } from "./memoryHubGraphDetails";

export type MemoryHubExploreOptions = {
    scope: () => string | undefined;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onError: (error: unknown) => void;
};
function text<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    content?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const value = document.createElement(tag);
    if (content !== undefined) value.textContent = content;
    if (className) value.className = className;
    return value;
}
export function mountMemoryHubExplore(
    host: HTMLElement,
    options: MemoryHubExploreOptions,
) {
    const root = text("section", undefined, "memory-phase2 memory-explore");
    root.setAttribute("aria-label", "Corpus overview");
    const status = text(
        "p",
        "Open Overview to load corpus-neutral knowledge.",
        "phase2-status",
    );
    status.setAttribute("role", "status");
    const counts = text("div", undefined, "phase2-counts");
    const note = text("div");
    const flyout = mountFlyout(host, "Knowledge detail");
    const graphDetails = mountGraphDetails(host, options);
    const lists = text("div", undefined, "phase2-lists");
    root.append(status, counts, note, lists);
    host.append(root);
    const topics = mountTopicBrowser(root, {
        corpusId: options.scope,
        query: (request) => invokeView("memoryQueryTopics", request),
        rebuild: (corpusId) => invokeView("memoryRebuildTopics", { corpusId }),
        onOpenSource: options.onOpenSource,
        onError: options.onError,
    });
    let cached: MemoryHubExploreResult | undefined;
    let version = 0;
    let disposed = false;
    let collections: ReturnType<typeof mountKnowledgeCollection>[] = [];

    function sourceItems(
        sources: MemoryHubGraphSource[],
    ): MemoryHubKnowledgeItem[] {
        const unique = new Map(
            sources.map((source) => [
                JSON.stringify([source.corpusId, source.sourceId]),
                source,
            ]),
        );
        return [...unique.values()].map((source) => {
            const corpus =
                cached?.corpora.find(
                    (value) => value.corpusId === source.corpusId,
                )?.name ?? "Contributing corpus";
            return {
                id: JSON.stringify([source.corpusId, source.sourceId]),
                title: source.title ?? source.sourceId,
                subtitle: corpus,
                sources: [source],
            };
        });
    }
    function openSource(item: MemoryHubKnowledgeItem) {
        const source = item.sources[0];
        if (!source)
            throw new Error("Contributing source identity is unavailable.");
        flyout.close();
        options.onOpenSource(source.corpusId, source.sourceId);
    }
    function selectKnowledgeItem(value: MemoryHubKnowledgeItem) {
        if (value.graphSupport) {
            flyout.close();
            graphDetails.open(value.title, value.graphSupport);
            return;
        }
        flyout.push(itemView(value));
    }
    function itemView(value: MemoryHubKnowledgeItem): FlyoutView {
        return {
            title: value.title,
            render(body) {
                const details = [
                    value.subtitle,
                    value.mentions === undefined
                        ? undefined
                        : `${value.mentions} mention${value.mentions === 1 ? "" : "s"}`,
                ].filter(Boolean);
                if (details.length)
                    body.append(text("p", details.join(" · "), "phase2-text"));
                const section = text("section");
                section.setAttribute(
                    "aria-label",
                    "Selected knowledge item sources",
                );
                body.append(section);
                const sources = mountKnowledgeCollection(section, {
                    title: "Contributing sources",
                    items: sourceItems(value.sources),
                    onSelect: openSource,
                    onError: options.onError,
                });
                return () => sources.dispose();
            },
        };
    }
    function viewAll(
        title: string,
        items: MemoryHubKnowledgeItem[],
        total: number,
        kind: MemoryHubKnowledgeKind,
    ) {
        flyout.open({
            title,
            render(body) {
                const all = mountKnowledgeCollection(body, {
                    title,
                    items,
                    total,
                    loadPage: (request) =>
                        invokeView("memoryHubKnowledge", {
                            ...request,
                            corpusId: options.scope(),
                            kind,
                        }),
                    onSelect:
                        kind === "sources" ? openSource : selectKnowledgeItem,
                    startExpanded: true,
                    onError: options.onError,
                });
                return () => all.dispose();
            },
        });
    }
    function collection(
        title: string,
        items: MemoryHubKnowledgeItem[],
        total: number,
        kind: MemoryHubKnowledgeKind,
    ) {
        collections.push(
            mountKnowledgeCollection(lists, {
                title,
                items,
                total,
                loadPage: (request) =>
                    invokeView("memoryHubKnowledge", {
                        ...request,
                        corpusId: options.scope(),
                        kind,
                    }),
                onSelect: kind === "sources" ? openSource : selectKnowledgeItem,
                onViewAll: () => viewAll(title, items, total, kind),
                onError: options.onError,
            }),
        );
    }
    function clearCollections() {
        flyout.close();
        graphDetails.close();
        collections.forEach((value) => value.dispose());
        collections = [];
    }
    function render(data: MemoryHubExploreResult) {
        counts.replaceChildren(
            ...Object.entries(data.counts).map(([name, count]) =>
                text("strong", `${count} ${name}`),
            ),
        );
        const errors = data.errors.map(
            (error) =>
                `${error.corpusId} · ${error.operation}: ${error.message}`,
        );
        hubNotifications.set("explore", {
            title: "Explore",
            page: "explore",
            context: options.scope() ?? "All memory",
            messages: errors,
        });
        status.textContent = `${data.corpora.length} responding ${data.corpora.length === 1 ? "corpus" : "corpora"} · Previewing up to ${KNOWLEDGE_PREVIEW_SIZE} cards per collection${errors.length ? " · partial results" : ""}`;
        clearCollections();
        lists.replaceChildren();
        collection(
            "Derived entities",
            data.entities.map((value) => ({
                id: value.id,
                title: value.name,
                subtitle: value.types.join(" · "),
                mentions: value.mentionCount,
                sources: value.sources,
                ...(value.graphSupport
                    ? { graphSupport: value.graphSupport }
                    : {}),
            })),
            data.counts.entities,
            "entities",
        );
        collection(
            "Derived topics",
            data.topics.map((value) => ({
                id: value.id,
                title: value.name,
                mentions: value.mentionCount,
                sources: value.sources,
                ...(value.graphSupport
                    ? { graphSupport: value.graphSupport }
                    : {}),
            })),
            data.counts.topics,
            "topics",
        );
        const names = new Map(
            data.entities.map((value) => [value.id, value.name]),
        );
        collection(
            "Derived relationships",
            data.relationships.map((value) => ({
                id: value.id,
                title: `${value.fromName ?? names.get(value.fromId) ?? "Entity outside preview"} → ${value.type} → ${value.toName ?? names.get(value.toId) ?? "Entity outside preview"}`,
                mentions: value.count,
                sources: value.sources,
                ...(value.graphSupport
                    ? { graphSupport: value.graphSupport }
                    : {}),
            })),
            data.counts.relationships,
            "relationships",
        );
        const contributors = sourceItems(
            data.contributingSources ?? [
                ...data.entities.flatMap((value) => value.sources),
                ...data.topics.flatMap((value) => value.sources),
                ...data.relationships.flatMap((value) => value.sources),
            ],
        );
        collection(
            data.sourceInventory ? "Document sources" : "Contributing sources",
            contributors,
            data.contributingSourceCount ?? contributors.length,
            "sources",
        );
        note.replaceChildren();
        if (data.sourceInventory)
            note.append(
                text(
                    "p",
                    "Document sources are listed separately. Conversation and event evidence opens from the derived knowledge cards or graphs.",
                ),
            );
        if (!data.entities.length && !data.topics.length)
            note.append(
                text(
                    "p",
                    errors.length
                        ? "Knowledge unavailable from some corpora; zero visible nodes is not a complete empty result."
                        : "No derived knowledge in this scope.",
                ),
            );
    }
    async function load() {
        topics.refresh();
        const requestVersion = ++version;
        const scope = options.scope();
        status.textContent = "Loading corpus overview…";
        const stopWatching = watchSlowRequest(status, () => {
            version++;
            status.textContent = "Overview loading cancelled.";
        });
        try {
            const data = await invokeView("memoryHubExplore", {
                corpusId: scope,
                maxNodes: KNOWLEDGE_PREVIEW_SIZE,
            });
            if (
                disposed ||
                requestVersion !== version ||
                scope !== options.scope()
            )
                return;
            cached = data;
            render(data);
        } catch (error) {
            if (
                disposed ||
                requestVersion !== version ||
                scope !== options.scope()
            )
                return;
            status.textContent = `Explore unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
        } finally {
            stopWatching();
        }
    }
    return {
        async show() {
            if (disposed) return;
            if (cached) render(cached);
            else await load();
        },
        scopeChanged() {
            topics.refresh();
            version++;
            cached = undefined;
            clearCollections();
            counts.replaceChildren();
            lists.replaceChildren();
            note.replaceChildren();
            hubNotifications.clear("explore");
            status.textContent =
                "Scope changed. Open Overview to load this corpus.";
        },
        hide() {
            flyout.close();
            graphDetails.close();
            topics.hide();
        },
        dispose() {
            topics.dispose();
            disposed = true;
            version++;
            clearCollections();
            flyout.dispose();
            graphDetails.dispose();
            root.remove();
        },
    };
}
