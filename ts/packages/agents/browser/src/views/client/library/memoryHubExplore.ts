// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubExploreResult,
    MemoryHubGraphSource,
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgeKind,
} from "@typeagent/browser-control-rpc/viewRpc";
import { iconButton, watchSlowRequest } from "./memoryHubUi";
import { invokeView } from "./viewClient";
import {
    mountKnowledgeCollection,
    KNOWLEDGE_PREVIEW_SIZE,
} from "./memoryKnowledgeCollection";
import "./memoryHubPhase2.css";

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
function button(label: string, action: () => void) {
    const value = text("button", label);
    value.type = "button";
    value.addEventListener("click", action);
    return value;
}
export function mountMemoryHubExplore(
    host: HTMLElement,
    options: MemoryHubExploreOptions,
) {
    const root = text("section", undefined, "memory-phase2 memory-explore");
    root.setAttribute("aria-label", "Corpus overview");
    const controls = text("div", undefined, "phase2-controls");
    const status = text(
        "p",
        "Open Overview to load corpus-neutral knowledge.",
        "phase2-status",
    );
    status.setAttribute("role", "status");
    const warning = text("div", undefined, "phase2-warning");
    warning.hidden = true;
    warning.setAttribute("role", "status");
    const counts = text("div", undefined, "phase2-counts");
    const selected = text("section");
    selected.setAttribute("aria-label", "Selected knowledge item sources");
    const lists = text("div", undefined, "phase2-lists");
    root.append(controls, status, warning, counts, selected, lists);
    host.append(root);
    let cached: MemoryHubExploreResult | undefined;
    let version = 0;
    let disposed = false;
    let loading = false;
    let collections: ReturnType<typeof mountKnowledgeCollection>[] = [];
    let selectedCollection:
        | ReturnType<typeof mountKnowledgeCollection>
        | undefined;

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
        options.onOpenSource(source.corpusId, source.sourceId);
    }
    function selectKnowledgeItem(value: MemoryHubKnowledgeItem) {
        selectedCollection?.dispose();
        selected.replaceChildren(text("h3", value.title));
        selectedCollection = mountKnowledgeCollection(selected, {
            title: "Selected item contributing sources",
            items: sourceItems(value.sources),
            onSelect: openSource,
            onError: options.onError,
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
                onError: options.onError,
            }),
        );
    }
    function clearCollections() {
        collections.forEach((value) => value.dispose());
        collections = [];
        selectedCollection?.dispose();
        selectedCollection = undefined;
    }
    function renderControls() {
        const refresh = iconButton("fa-rotate", "Refresh overview", () => {
            void load();
        });
        refresh.disabled = loading;
        controls.replaceChildren(refresh);
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
        warning.hidden = !errors.length;
        warning.textContent = errors.length
            ? `Partial overview: only responding corpora are included.\n${errors.join("\n")}`
            : "";
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
            "Contributing sources",
            contributors,
            data.contributingSourceCount ?? contributors.length,
            "sources",
        );
        selected.replaceChildren();
        if (!data.entities.length && !data.topics.length)
            selected.append(
                text(
                    "p",
                    errors.length
                        ? "Knowledge unavailable from some corpora; zero visible nodes is not a complete empty result."
                        : "No derived knowledge in this scope.",
                ),
            );
        renderControls();
    }
    async function load() {
        const requestVersion = ++version;
        const scope = options.scope();
        loading = true;
        status.textContent = "Loading corpus overview…";
        renderControls();
        const stopWatching = watchSlowRequest(status, () => {
            version++;
            loading = false;
            status.textContent = "Overview loading cancelled.";
            renderControls();
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
            loading = false;
            render(data);
        } catch (error) {
            if (
                disposed ||
                requestVersion !== version ||
                scope !== options.scope()
            )
                return;
            loading = false;
            status.textContent = `Explore unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
            renderControls();
        } finally {
            stopWatching();
        }
    }
    renderControls();
    return {
        async show() {
            if (disposed) return;
            if (cached) render(cached);
            else await load();
        },
        scopeChanged() {
            version++;
            cached = undefined;
            clearCollections();
            loading = false;
            counts.replaceChildren();
            lists.replaceChildren();
            selected.replaceChildren();
            warning.hidden = true;
            status.textContent =
                "Scope changed. Open Overview to load this corpus.";
            renderControls();
        },
        dispose() {
            disposed = true;
            version++;
            clearCollections();
            root.remove();
        },
    };
}
