// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryGraphNode,
    MemoryGraphQueryRequest,
} from "@typeagent/memory-service";
import type {
    MemoryHubGraphRequest,
    MemoryHubGraphResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import { EntityGraphVisualizer } from "./entityGraphVisualizer";
import { TopicGraphVisualizer } from "./topicGraphVisualizer";
import { graphText, mountGraphDetails } from "./memoryHubGraphDetails";
import { mountGraphControls } from "./memoryHubGraphControls";
import { iconButton } from "./memoryHubUi";
import { rbButton } from "./memoryHubDocumentUi";
import { viewSheet } from "./memoryHubViewUi";
import { invokeView } from "./viewClient";
import "./memoryHubGraph.css";

type GraphKind = MemoryGraphQueryRequest["kind"];
export interface MemoryHubGraphOptions {
    scope: () => string | undefined;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onError: (error: unknown) => void;
    onRouteChanged: (kind: GraphKind, selection?: string) => void;
}

function routeSelection(view: "entities" | "topics", selection?: string) {
    if (view === "entities") return { kind: "entities" as const, selection };
    for (const [prefix, kind] of [
        ["hierarchy:", "hierarchy"],
        ["cooccurrence:", "topics"],
    ] as const)
        if (selection?.startsWith(prefix))
            return {
                kind,
                selection: selection.slice(prefix.length) || undefined,
            };
    return {
        kind: selection ? ("topics" as const) : ("hierarchy" as const),
        selection,
    };
}

export function mountMemoryHubGraph(
    host: HTMLElement,
    options: MemoryHubGraphOptions,
) {
    const root = graphText("section", undefined, "hub-scoped-graph");
    root.hidden = true;
    root.setAttribute("aria-label", "Scoped memory graph");
    const controls = mountGraphControls(root, () => {
        kind = kind === "entities" ? "entities" : topicKind();
        options.onRouteChanged(kind);
        void load();
    });
    const status = graphText("p");
    status.setAttribute("role", "status");
    const warning = graphText("div");
    warning.setAttribute("role", "status");
    const toolbar = graphText("div", undefined, "hub-graph-toolbar");
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Graph controls");
    const viewport = graphText("div", undefined, "hub-graph-viewport");
    const canvas = graphText("div", undefined, "hub-scoped-graph-canvas");
    canvas.setAttribute("aria-label", "Memory graph visualization");
    viewport.append(toolbar, canvas);
    root.append(status, warning, viewport);
    host.append(root);
    const details = mountGraphDetails(host, options);
    let version = 0;
    let disposed = false;
    let kind: GraphKind = "entities";
    let result: MemoryHubGraphResult | undefined;
    let renderer: EntityGraphVisualizer | TopicGraphVisualizer | undefined;
    let picker: ReturnType<typeof viewSheet> | undefined;
    const browse = iconButton("fa-list", "Browse graph items", () => {
        if (result) showPicker(result);
    });
    browse.disabled = true;

    function showPicker(data: MemoryHubGraphResult) {
        picker?.close();
        picker = viewSheet(host, "Graph items");
        picker.body.classList.add("hub-graph-item-picker");
        const search = graphText("input");
        search.type = "search";
        search.setAttribute("aria-label", "Find graph items");
        const items = graphText("select");
        items.setAttribute("aria-label", "Graph nodes and relationships");
        items.size = 8;
        const entries = data.corpora.flatMap((corpus) => [
            ...corpus.graph.nodes.map((node) => ({
                id: node.id,
                label: `Node · ${corpus.corpusName} · ${node.label}`,
            })),
            ...corpus.graph.edges.map((edge) => ({
                id: edge.id,
                label: `Relationship · ${corpus.corpusName} · ${corpus.graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source} - ${edge.label ?? edge.type} -> ${corpus.graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target}`,
            })),
        ]);
        const note = graphText("p");
        note.setAttribute("role", "status");
        const inspect = rbButton("Inspect graph item", () => {
            const id = items.value;
            picker?.close();
            picker = undefined;
            openSelection(id);
        });
        const filter = () => {
            const matching = entries.filter((entry) =>
                entry.label.toLowerCase().includes(search.value.toLowerCase()),
            );
            items.replaceChildren(
                ...matching.map((entry) => {
                    const option = graphText("option", entry.label);
                    option.value = entry.id;
                    return option;
                }),
            );
            items.selectedIndex = matching.length ? 0 : -1;
            items.disabled = !matching.length;
            inspect.disabled = !matching.length;
            note.textContent = matching.length
                ? ""
                : "No graph items match this search.";
        };
        search.addEventListener("input", filter);
        picker.body.append(
            graphText(
                "p",
                "Choose from nodes and relationships in the displayed graph. Use the arrow keys to select an item, then inspect its evidence.",
            ),
            search,
            items,
            note,
            inspect,
        );
        filter();
        search.focus();
    }

    function topicKind(): "topics" | "hierarchy" {
        return controls.mode.value === "topics" ? "topics" : "hierarchy";
    }
    function release() {
        picker?.close();
        picker = undefined;
        browse.disabled = true;
        if (renderer && "destroy" in renderer) renderer.destroy();
        else renderer?.dispose();
        renderer = undefined;
        canvas.replaceChildren();
        details.close();
        result = undefined;
    }
    function hide() {
        version++;
        release();
        root.hidden = true;
    }
    function selection(id: string) {
        return result?.corpora
            .map((corpus) => ({
                corpus,
                node: corpus.graph.nodes.find((node) => node.id === id),
                edge: corpus.graph.edges.find((edge) => edge.id === id),
            }))
            .find((entry) => entry.node || entry.edge);
    }
    function openSelection(id: string) {
        const selected = selection(id);
        if (!selected) return;
        const { corpus, node, edge } = selected;
        const title = node?.label ?? edge?.label ?? edge?.type ?? id;
        details.open(
            `${corpus.corpusName} · ${title}`,
            {
                corpusId: corpus.corpusId,
                generation: corpus.graph.generation,
                ...(node ? { nodeId: id } : { edgeId: id }),
            },
            node
                ? () => void load({ corpusId: corpus.corpusId, nodeId: id })
                : undefined,
            node?.topicId
                ? {
                      topicId: node.topicId,
                      ...(corpus.graph.topicGeneration
                          ? {
                                generation: corpus.graph.topicGeneration,
                            }
                          : {}),
                  }
                : undefined,
        );
        if (node) options.onRouteChanged(kind, id);
    }
    async function renderGraph(data: MemoryHubGraphResult, ticket: number) {
        if (kind === "entities") {
            const entity = new EntityGraphVisualizer(canvas);
            renderer = entity;
            entity.onEntityClick((node) => {
                if (node.id) openSelection(node.id);
            });
            entity.onEdgeClick(openSelection);
            await entity.initialize();
            if (ticket !== version) return;
            await entity.loadGlobalGraph(data);
        } else {
            const topic = new TopicGraphVisualizer(canvas);
            renderer = topic;
            topic.onTopicClick((node) => openSelection(node.id));
            topic.onEdgeClick(openSelection);
            await topic.init(data);
        }
        if (ticket === version) renderer?.resize();
    }
    function showErrors(data: MemoryHubGraphResult) {
        const messages = data.errors.map(
            (error) => `${error.corpusId}: ${error.message}`,
        );
        if (data.omittedCorpora)
            messages.push(
                `${data.omittedCorpora} corpora omitted by node budget.`,
            );
        warning.textContent = messages.join("\n");
        warning.hidden = !messages.length;
    }
    async function load(
        focus: Partial<
            Pick<MemoryHubGraphRequest, "corpusId" | "nodeId" | "search">
        > = {},
    ) {
        const ticket = ++version;
        release();
        root.hidden = false;
        root.setAttribute("aria-busy", "true");
        warning.replaceChildren();
        warning.hidden = true;
        controls.showMode(kind !== "entities");
        status.hidden = false;
        status.textContent = "Loading scoped memory graph...";
        try {
            const filters = controls.request();
            const corpusId = options.scope();
            const request: MemoryHubGraphRequest = {
                ...filters,
                evidenceKinds: [...filters.evidenceKinds],
                ...(corpusId === undefined ? {} : { corpusId }),
                kind,
                maxNodes: 250,
                maxEdges: 500,
                ...focus,
            };
            const data = await invokeView("memoryHubGraph", request);
            if (ticket !== version || disposed) return;
            result = data;
            showErrors(data);
            const nodes = data.corpora.flatMap((corpus) => corpus.graph.nodes);
            if (nodes.length) await renderGraph(data, ticket);
            if (ticket !== version || disposed) return;
            browse.disabled = !nodes.length;
            status.textContent = nodes.length
                ? ""
                : "No nodes in the available projection.";
            status.hidden = nodes.length > 0;
            if (request.nodeId) openSelection(request.nodeId);
        } catch (error) {
            if (ticket === version && !disposed) {
                release();
                status.textContent =
                    "Graph could not be loaded. Retry with Refresh graph.";
                status.hidden = false;
                warning.textContent =
                    error instanceof Error ? error.message : String(error);
                warning.hidden = false;
                options.onError(error);
            }
        } finally {
            if (ticket === version) root.setAttribute("aria-busy", "false");
        }
    }
    toolbar.append(
        iconButton("fa-rotate", "Refresh graph", () => void load()),
        iconButton("fa-globe", "Global graph", () => {
            options.onRouteChanged(kind);
            void load();
        }),
        iconButton("fa-expand", "Fit graph", () => {
            if (renderer instanceof EntityGraphVisualizer) renderer.fitToView();
            else renderer?.fitToView();
        }),
        browse,
    );
    return {
        async show(request: {
            view: "entities" | "topics";
            selection?: string;
        }) {
            const route = routeSelection(request.view, request.selection);
            kind = route.kind;
            controls.mode.value = kind === "entities" ? "hierarchy" : kind;
            const opaque =
                route.selection?.startsWith("graph:") ||
                route.selection?.startsWith("[");
            await load(
                route.selection
                    ? opaque
                        ? { nodeId: route.selection }
                        : { search: route.selection }
                    : {},
            );
            if (route.selection && !opaque) {
                const match: MemoryGraphNode | undefined = result?.corpora
                    .flatMap((corpus) => corpus.graph.nodes)
                    .find((node) => node.label === route.selection);
                if (match) openSelection(match.id);
            }
        },
        hide,
        scopeChanged: hide,
        dispose() {
            disposed = true;
            hide();
            details.dispose();
            root.remove();
        },
    };
}
