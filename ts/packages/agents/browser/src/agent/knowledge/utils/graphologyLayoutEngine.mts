// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRequire } from "module";
import { circular } from "graphology-layout";
import registerDebug from "debug";

const require = createRequire(import.meta.url);
const Graph = require("graphology");
const louvain = require("graphology-communities-louvain");
const forceAtlas2 = require("graphology-layout-forceatlas2");
const noverlap = require("graphology-layout-noverlap");

const debug = registerDebug("typeagent:browser:knowledge:graphology");

type Graph = any;

export interface GraphNode {
    id: string;
    name: string;
    type?: string;
    confidence?: number;
    count?: number;
    [key: string]: any;
}

export interface GraphEdge {
    from: string;
    to: string;
    type?: string;
    confidence?: number;
    strength?: number;
    [key: string]: any;
}

export interface CytoscapeElement {
    data: {
        id?: string;
        source?: string;
        target?: string;
        name?: string;
        type?: string;
        confidence?: number;
        importance?: number;
        community?: number;
        color?: string;
        size?: number;
        [key: string]: any;
    };
    position?: { x: number; y: number };
}

export interface GraphologyLayoutOptions {
    nodeLimit?: number;
    minEdgeConfidence?: number;
    denseClusterThreshold?: number;
    forceAtlas2Iterations?: number;
    noverlapIterations?: number;
    targetViewportSize?: number;
}

const DEFAULT_OPTIONS: Required<GraphologyLayoutOptions> = {
    nodeLimit: 2000,
    minEdgeConfidence: 0.3,
    denseClusterThreshold: 100,
    forceAtlas2Iterations: 150,
    noverlapIterations: 500,
    targetViewportSize: 2000,
};

const COMMUNITY_COLORS = [
    "#bf616a",
    "#d08770",
    "#ebcb8b",
    "#a3be8c",
    "#b48ead",
    "#8fbcbb",
    "#88c0d0",
    "#81a1c1",
    "#5e81ac",
];

export function buildGraphologyGraph(
    nodes: GraphNode[],
    edges: GraphEdge[],
    options: GraphologyLayoutOptions = {},
): Graph {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    debug(
        `Building graphology graph: ${nodes.length} nodes, ${edges.length} edges`,
    );

    const graph = new Graph({ type: "undirected" });

    for (const node of nodes.slice(0, opts.nodeLimit)) {
        const { id, ...nodeProps } = node;
        graph.addNode(id, {
            ...nodeProps,
            type: nodeProps.type || "entity",
            confidence: nodeProps.confidence || 0.5,
            count: nodeProps.count || 1,
        });
    }

    debug(`Added ${graph.order} nodes to graph`);

    initializeCircularLayout(graph);

    const nodeSet = new Set(graph.nodes());
    const edgeSet = new Set<string>();
    let edgeCount = 0;

    for (const edge of edges) {
        if (edge.from === edge.to) continue;
        if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;

        const edgeKey = [edge.from, edge.to].sort().join("|");
        if (edgeSet.has(edgeKey)) continue;

        if (
            edge.type !== "parent" &&
            edge.type !== "parent-child" &&
            (edge.confidence || 1) < opts.minEdgeConfidence
        ) {
            continue;
        }

        edgeSet.add(edgeKey);
        try {
            graph.addEdge(edge.from, edge.to, {
                type: edge.type || "related",
                confidence: edge.confidence || 0.5,
                strength: edge.strength || edge.confidence || 0.5,
            });
            edgeCount++;
        } catch (error) {
            debug(`Warning: Could not add edge ${edge.from} -> ${edge.to}`);
        }
    }

    debug(`Added ${edgeCount} edges to graph`);

    // Remove isolated nodes (nodes with no edges)
    const isolatedNodes: string[] = [];
    for (const node of graph.nodes()) {
        if (graph.degree(node) === 0) {
            isolatedNodes.push(node);
        }
    }

    if (isolatedNodes.length > 0) {
        debug(`Removing ${isolatedNodes.length} isolated nodes (no edges)`);
        for (const node of isolatedNodes) {
            graph.dropNode(node);
        }
    }

    calculateNodeImportance(graph);
    assignNodeSizes(graph);
    detectCommunities(graph);
    assignCommunityColors(graph);
    applyMultiPhaseLayout(graph, opts);

    return graph;
}

function initializeCircularLayout(graph: Graph): void {
    debug("Initializing circular layout...");
    const positions = circular(graph, { scale: 100 });

    for (const node of graph.nodes()) {
        graph.setNodeAttribute(node, "x", positions[node].x);
        graph.setNodeAttribute(node, "y", positions[node].y);
    }
}

function calculateNodeImportance(graph: Graph): void {
    debug("Calculating node importance (degree centrality)...");
    for (const node of graph.nodes()) {
        const degree = graph.degree(node);
        graph.setNodeAttribute(node, "importance", degree);
    }
}

function assignNodeSizes(graph: Graph): void {
    const importanceValues = graph
        .nodes()
        .map((n: string) => graph.getNodeAttribute(n, "importance") as number);
    const minImp = Math.min(...importanceValues);
    const maxImp = Math.max(...importanceValues);

    for (const node of graph.nodes()) {
        const imp = graph.getNodeAttribute(node, "importance") as number;
        const normalizedImp =
            maxImp > minImp ? (imp - minImp) / (maxImp - minImp) : 0.5;
        const size = Math.max(25, Math.min(60, 25 + normalizedImp * 35));
        graph.setNodeAttribute(node, "size", size);
    }
}

function detectCommunities(graph: Graph): void {
    debug("Detecting communities (Louvain algorithm)...");
    try {
        louvain.assign(graph);
        const communities = new Set<number>();
        for (const node of graph.nodes()) {
            const comm = graph.getNodeAttribute(node, "community") as number;
            communities.add(comm);
        }
        debug(`Detected ${communities.size} communities`);
    } catch (error) {
        debug("Community detection failed, assigning all nodes to community 0");
        for (const node of graph.nodes()) {
            graph.setNodeAttribute(node, "community", 0);
        }
    }
}

function assignCommunityColors(graph: Graph): void {
    const communityColors: Record<number, string> = {};
    let colorIdx = 0;

    for (const node of graph.nodes()) {
        const comm = graph.getNodeAttribute(node, "community") as number;
        if (!(comm in communityColors)) {
            communityColors[comm] =
                COMMUNITY_COLORS[colorIdx % COMMUNITY_COLORS.length];
            colorIdx++;
        }
        graph.setNodeAttribute(node, "color", communityColors[comm]);
    }
}

function applyMultiPhaseLayout(
    graph: Graph,
    options: Required<GraphologyLayoutOptions>,
): void {
    debug("=== Layout Phase ===");

    debug("Step 1: Running global ForceAtlas2...");
    forceAtlas2.assign(graph, {
        iterations: options.forceAtlas2Iterations,
        settings: {
            gravity: 0.05,
            scalingRatio: 100,
            strongGravityMode: false,
            linLogMode: false,
            barnesHutOptimize: true,
            barnesHutTheta: 0.5,
        },
    });
    debug("  ✓ ForceAtlas2 complete");

    debug("Step 2: Applying global overlap prevention...");
    noverlap.assign(graph, {
        maxIterations: options.noverlapIterations,
        settings: {
            margin: 20,
            ratio: 1.3,
            expansion: 1.2,
            gridSize: 40,
        },
    });
    debug("  ✓ Global overlap prevention complete");

    const communities = groupNodesByCommunity(graph);
    const denseCommunities = Object.entries(communities).filter(
        ([_, nodes]) => nodes.length > options.denseClusterThreshold,
    );

    if (denseCommunities.length > 0) {
        debug(
            `Step 3: Refining ${denseCommunities.length} dense clusters (>${options.denseClusterThreshold} nodes)...`,
        );

        for (const [comm, nodes] of denseCommunities) {
            debug(`  Processing community ${comm} (${nodes.length} nodes)...`);

            const subgraph = new Graph({ type: "undirected" });
            for (const node of nodes) {
                subgraph.addNode(node, graph.getNodeAttributes(node));
            }
            for (const edge of graph.edges()) {
                const source = graph.source(edge);
                const target = graph.target(edge);
                if (subgraph.hasNode(source) && subgraph.hasNode(target)) {
                    subgraph.addEdge(
                        source,
                        target,
                        graph.getEdgeAttributes(edge),
                    );
                }
            }

            forceAtlas2.assign(subgraph, {
                iterations: options.forceAtlas2Iterations,
                settings: {
                    gravity: 0.05,
                    scalingRatio: 100,
                    strongGravityMode: false,
                    linLogMode: false,
                    barnesHutOptimize: true,
                    barnesHutTheta: 0.5,
                },
            });

            noverlap.assign(subgraph, {
                maxIterations: 300,
                settings: {
                    margin: 25,
                    ratio: 1.4,
                    expansion: 1.2,
                    gridSize: 30,
                },
            });

            const centroidX =
                nodes.reduce(
                    (sum, n) =>
                        sum + (graph.getNodeAttribute(n, "x") as number),
                    0,
                ) / nodes.length;
            const centroidY =
                nodes.reduce(
                    (sum, n) =>
                        sum + (graph.getNodeAttribute(n, "y") as number),
                    0,
                ) / nodes.length;

            const newCentroidX =
                nodes.reduce(
                    (sum, n) =>
                        sum + (subgraph.getNodeAttribute(n, "x") as number),
                    0,
                ) / nodes.length;
            const newCentroidY =
                nodes.reduce(
                    (sum, n) =>
                        sum + (subgraph.getNodeAttribute(n, "y") as number),
                    0,
                ) / nodes.length;

            for (const node of nodes) {
                const newX = subgraph.getNodeAttribute(node, "x") as number;
                const newY = subgraph.getNodeAttribute(node, "y") as number;
                graph.setNodeAttribute(
                    node,
                    "x",
                    centroidX + (newX - newCentroidX),
                );
                graph.setNodeAttribute(
                    node,
                    "y",
                    centroidY + (newY - newCentroidY),
                );
            }
        }
        debug("  ✓ Dense cluster refinement complete");
    } else {
        debug("Step 3: No dense clusters requiring refinement");
    }

    debug("=== Layout Complete ===");
}

function groupNodesByCommunity(graph: Graph): Record<string, string[]> {
    const communities: Record<string, string[]> = {};
    for (const node of graph.nodes()) {
        const comm = String(graph.getNodeAttribute(node, "community"));
        if (!communities[comm]) {
            communities[comm] = [];
        }
        communities[comm].push(node);
    }
    return communities;
}

export function convertToCytoscapeElements(
    graph: Graph,
    targetViewportSize: number = 2000,
): CytoscapeElement[] {
    debug("Converting to Cytoscape format...");

    const elements: CytoscapeElement[] = [];

    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
    for (const node of graph.nodes()) {
        const x = graph.getNodeAttribute(node, "x") as number;
        const y = graph.getNodeAttribute(node, "y") as number;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    const targetMin = -targetViewportSize;
    const targetMax = targetViewportSize;
    const scaleX =
        maxX - minX === 0 ? 1 : (targetMax - targetMin) / (maxX - minX);
    const scaleY =
        maxY - minY === 0 ? 1 : (targetMax - targetMin) / (maxY - minY);

    debug(`Scaling factors: X=${scaleX.toFixed(2)}, Y=${scaleY.toFixed(2)}`);
    debug(`Target viewport: [${targetMin}, ${targetMax}]`);

    for (const node of graph.nodes()) {
        const attr = graph.getNodeAttributes(node);
        const x = (attr.x - minX) * scaleX + targetMin;
        const y = (attr.y - minY) * scaleY + targetMin;

        elements.push({
            data: {
                id: node,
                label: attr.name,
                level: attr.level || 0,
                confidence: attr.confidence,
                computedImportance: attr.importance,
                parentId: attr.parentId,
                childCount: attr.childCount || 0,
                nodeType: "topic",
                color: attr.color,
                size: attr.size,
            },
            position: { x, y },
        });
    }

    for (const edge of graph.edges()) {
        const attr = graph.getEdgeAttributes(edge);
        const source = graph.source(edge);
        const target = graph.target(edge);

        elements.push({
            data: {
                source,
                target,
                type: attr.type,
                confidence: attr.confidence,
                strength: attr.strength,
                color: "#ddd",
            },
        });
    }

    debug(
        `Converted ${graph.order} nodes and ${graph.size} edges to Cytoscape format`,
    );

    return elements;
}

export function calculateLayoutQualityMetrics(graph: Graph): {
    avgSpacing: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
} {
    let totalMinDist = 0;
    const nodes = graph.nodes();

    for (const node of nodes) {
        const x1 = graph.getNodeAttribute(node, "x") as number;
        const y1 = graph.getNodeAttribute(node, "y") as number;
        let minDist = Infinity;

        for (const other of nodes) {
            if (node === other) continue;
            const x2 = graph.getNodeAttribute(other, "x") as number;
            const y2 = graph.getNodeAttribute(other, "y") as number;
            const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (dist < minDist) minDist = dist;
        }
        totalMinDist += minDist;
    }

    const avgSpacing = totalMinDist / nodes.length;

    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
    for (const node of nodes) {
        const x = graph.getNodeAttribute(node, "x") as number;
        const y = graph.getNodeAttribute(node, "y") as number;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    return { avgSpacing, minX, maxX, minY, maxY };
}
