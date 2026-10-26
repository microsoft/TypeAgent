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
import {
    graphText,
    graphButton,
    mountGraphDetails,
} from "./memoryHubGraphDetails";
import { mountGraphControls } from "./memoryHubGraphControls";
import { invokeView } from "./viewClient";
import "./memoryHubGraph.css";

type GraphKind = MemoryGraphQueryRequest["kind"];
type CorpusGraph = MemoryHubGraphResult["corpora"][number];
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
    const coverageDetails = graphText("details");
    coverageDetails.append(graphText("summary", "Graph coverage"));
    const coverageInfo = graphText("div");
    coverageDetails.append(coverageInfo);
    const toolbar = graphText("div", undefined, "hub-graph-toolbar");
    const paging = graphText("div");
    paging.setAttribute("aria-label", "Graph inventory pages");
    const canvas = graphText("div", undefined, "hub-scoped-graph-canvas");
    canvas.setAttribute("aria-label", "Memory graph visualization");
    const browse = graphText("details");
    browse.append(graphText("summary", "Browse graph nodes and relationships"));
    const items = graphText("ul", undefined, "hub-graph-items");
    browse.append(items);
    root.append(
        status,
        warning,
        coverageDetails,
        toolbar,
        paging,
        canvas,
        browse,
    );
    host.append(root);
    const details = mountGraphDetails(host, options);
    let version = 0;
    let disposed = false;
    let kind: GraphKind = "entities";
    let result: MemoryHubGraphResult | undefined;
    let renderer: EntityGraphVisualizer | TopicGraphVisualizer | undefined;

    function topicKind(): "topics" | "hierarchy" {
        return controls.mode.value === "topics" ? "topics" : "hierarchy";
    }
    function release() {
        if (renderer && "destroy" in renderer) renderer.destroy();
        else renderer?.dispose();
        renderer = undefined;
        canvas.replaceChildren();
        items.replaceChildren();
        paging.replaceChildren();
        coverageInfo.replaceChildren();
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
                      ...(corpus.graph.coverage.topics?.generation
                          ? {
                                generation:
                                    corpus.graph.coverage.topics.generation,
                            }
                          : {}),
                  }
                : undefined,
        );
        if (node) options.onRouteChanged(kind, id);
    }
    function browseCorpus(corpus: CorpusGraph) {
        const entries = [
            ...corpus.graph.nodes.map((node) => ({
                id: node.id,
                label: `${node.label} · ${node.mentionCount} mentions${node.summaryState ? ` · summary ${node.summaryState}` : ""}`,
            })),
            ...corpus.graph.edges.map((edge) => ({
                id: edge.id,
                label: `${edge.label ?? edge.type} · ${edge.count} mentions`,
            })),
        ];
        for (const entry of entries) {
            const row = graphText("li");
            row.append(
                graphButton(`${corpus.corpusName} · ${entry.label}`, () =>
                    openSelection(entry.id),
                ),
            );
            items.append(row);
        }
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
    function coverage(data: MemoryHubGraphResult) {
        const messages = data.errors.map(
            (error) => `${error.corpusId}: ${error.message}`,
        );
        for (const corpus of data.corpora) {
            const parts = (["documents", "events"] as const).map((kind) => {
                const coverage = corpus.graph.coverage[kind];
                return `${kind} ${coverage.state}: ${coverage.indexed} of ${coverage.eligible} eligible indexed (${coverage.total} total)`;
            });
            if (corpus.graph.coverage.topics)
                parts.push(`topics ${corpus.graph.coverage.topics.state}`);
            coverageInfo.append(
                graphText("p", `${corpus.corpusName}: ${parts.join("; ")}`),
            );
            messages.push(
                ...corpus.graph.coverage.reasons.map(
                    (reason) => `${corpus.corpusName}: ${reason}`,
                ),
            );
            if (corpus.graph.state !== "ready")
                messages.push(`${corpus.corpusName}: ${corpus.graph.state}`);
        }
        if (data.omittedCorpora)
            messages.push(
                `${data.omittedCorpora} corpora omitted by node budget.`,
            );
        warning.textContent = messages.join("\n");
        warning.hidden = !messages.length;
    }
    function inventoryPages(
        data: MemoryHubGraphResult,
        request: MemoryHubGraphRequest,
    ) {
        for (const corpus of data.corpora) {
            const graph = corpus.graph;
            if (
                !graph.counts.omittedNodes &&
                !graph.nextContinuationToken &&
                !request.continuationToken
            )
                continue;
            const firstRequest: MemoryHubGraphRequest = {
                ...request,
                corpusId: corpus.corpusId,
                expectedGeneration: graph.generation,
                maxNodes: graph.limits.maxNodes,
                maxEdges: graph.limits.maxEdges,
            };
            delete firstRequest.continuationToken;
            const row = graphText("div", undefined, "hub-graph-toolbar");
            row.append(
                graphText(
                    "span",
                    `${corpus.corpusName}: ${graph.nodes.length} of ${graph.counts.nodes} matching nodes on this page; ${graph.counts.omittedNodes} not on this page.`,
                ),
            );
            const first = graphButton(
                `First nodes in ${corpus.corpusName}`,
                () => void load({}, firstRequest),
            );
            first.disabled = !request.continuationToken;
            const token = graph.nextContinuationToken;
            const next = graphButton(
                `Next nodes in ${corpus.corpusName}`,
                () => {
                    if (token)
                        void load(
                            {},
                            { ...firstRequest, continuationToken: token },
                        );
                },
            );
            next.disabled = !token;
            row.append(first, next);
            paging.append(row);
        }
    }
    async function load(
        focus: Partial<
            Pick<MemoryHubGraphRequest, "corpusId" | "nodeId" | "search">
        > = {},
        snapshot?: MemoryHubGraphRequest,
    ) {
        const ticket = ++version;
        release();
        root.hidden = false;
        root.setAttribute("aria-busy", "true");
        warning.replaceChildren();
        controls.showMode(kind !== "entities");
        status.textContent = "Loading scoped memory graph...";
        try {
            let request = snapshot;
            if (!request) {
                const filters = controls.request();
                const corpusId = options.scope();
                request = {
                    ...filters,
                    evidenceKinds: [...filters.evidenceKinds],
                    ...(corpusId === undefined ? {} : { corpusId }),
                    kind,
                    maxNodes: 250,
                    maxEdges: 500,
                    ...focus,
                };
            }
            const data = await invokeView("memoryHubGraph", request);
            if (ticket !== version || disposed) return;
            result = data;
            coverage(data);
            const nodes = data.corpora.flatMap((corpus) => corpus.graph.nodes);
            const edges = data.corpora.flatMap((corpus) => corpus.graph.edges);
            const totalNodes = data.corpora.reduce(
                (total, corpus) => total + corpus.graph.counts.nodes,
                0,
            );
            const totalEdges = data.corpora.reduce(
                (total, corpus) => total + corpus.graph.counts.edges,
                0,
            );
            const meaning =
                kind === "entities"
                    ? "Extracted entity relationships"
                    : kind === "hierarchy"
                      ? "Maintained topic hierarchy and related topics"
                      : "Source co-occurrence, not a topic hierarchy";
            status.textContent = `${meaning} · ${nodes.length} of ${totalNodes} matching nodes · ${edges.length} of ${totalEdges} matching edges · ${data.corpora.length} responding corpora`;
            if (nodes.length) await renderGraph(data, ticket);
            else
                status.textContent +=
                    " · No nodes in the available projection.";
            if (ticket !== version || disposed) return;
            data.corpora.forEach(browseCorpus);
            inventoryPages(data, request);
            if (request.nodeId) openSelection(request.nodeId);
        } catch (error) {
            if (ticket === version && !disposed) {
                release();
                status.textContent =
                    "Graph could not be loaded. Retry with Refresh graph.";
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
        graphButton("Refresh graph", () => void load()),
        graphButton("Global graph", () => {
            options.onRouteChanged(kind);
            void load();
        }),
        graphButton("Fit graph", () => {
            if (renderer instanceof EntityGraphVisualizer) renderer.fitToView();
            else renderer?.fitToView();
        }),
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
