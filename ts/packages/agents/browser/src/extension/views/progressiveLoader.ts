// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import cytoscape from "cytoscape";

export interface LoadingStage {
    name: string;
    priority: number;
    maxNodes: number;
    description: string;
}

export interface Viewport {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
}

export interface LoadingOptions {
    chunkSize?: number;
    delayBetweenChunks?: number;
    enableAnimations?: boolean;
    prioritizeViewport?: boolean;
}

/**
 * Progressive loading system for large graph visualization
 */
export class ProgressiveGraphLoader {
    private cy: cytoscape.Core;
    private loadedChunks: Set<string> = new Set();
    private pendingChunks: Map<string, any> = new Map();
    private isLoading: boolean = false;

    // Level-of-detail configuration
    private readonly stages: LoadingStage[] = [
        {
            name: "overview",
            priority: 1,
            maxNodes: 100,
            description: "Community overview with top entities",
        },
        {
            name: "clusters",
            priority: 2,
            maxNodes: 500,
            description: "Cluster details with hub nodes",
        },
        {
            name: "detailed",
            priority: 3,
            maxNodes: 2000,
            description: "Detailed view with full relationships",
        },
        {
            name: "full",
            priority: 4,
            maxNodes: Infinity,
            description: "Complete graph (progressive chunks)",
        },
    ];

    constructor(cy: cytoscape.Core) {
        this.cy = cy;
        this.setupEventHandlers();
    }

    /**
     * Setup event handlers for viewport changes
     */
    private setupEventHandlers(): void {
        // Listen for zoom and pan events
        this.cy.on(
            "zoom pan",
            this.debounce(() => {
                this.handleViewportChange();
            }, 300),
        );

        // Listen for tap events (node selection)
        this.cy.on("tap", "node", (event) => {
            const node = event.target;
            this.loadNodeNeighborhood(node);
        });
    }

    /**
     * Load graph progressively based on current viewport
     */
    async loadProgressively(
        graphData: any,
        options: LoadingOptions = {},
    ): Promise<void> {
        if (this.isLoading) {
            console.log("Loading already in progress");
            return;
        }

        this.isLoading = true;
        const currentZoom = this.cy.zoom();
        const stage = this.getCurrentStage(currentZoom);

        console.log(
            `Loading graph with stage: ${stage.name} (max ${stage.maxNodes} nodes)`,
        );

        try {
            // Clear existing elements
            this.cy.elements().remove();
            this.loadedChunks.clear();

            // Load based on current stage
            if (stage.maxNodes === Infinity) {
                await this.loadInChunks(graphData, options);
            } else {
                await this.loadStageData(graphData, stage, options);
            }
        } catch (error) {
            console.error("Progressive loading failed:", error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Determine current loading stage based on zoom level
     */
    private getCurrentStage(zoomLevel: number): LoadingStage {
        if (zoomLevel < 0.5) {
            return this.stages[0]; // overview
        } else if (zoomLevel < 1.0) {
            return this.stages[1]; // clusters
        } else if (zoomLevel < 2.0) {
            return this.stages[2]; // detailed
        } else {
            return this.stages[3]; // full
        }
    }

    /**
     * Load data for specific stage
     */
    private async loadStageData(
        graphData: any,
        stage: LoadingStage,
        options: LoadingOptions,
    ): Promise<void> {
        let nodesToLoad: any[] = [];
        let edgesToLoad: any[] = [];

        if (stage.name === "overview") {
            // Load communities and top entities
            nodesToLoad = this.selectTopNodes(graphData.nodes, stage.maxNodes);
            edgesToLoad = this.selectRelevantEdges(
                graphData.edges,
                nodesToLoad,
            );
        } else if (stage.name === "clusters") {
            // Load cluster representatives and connections
            nodesToLoad = this.selectClusterNodes(
                graphData.nodes,
                stage.maxNodes,
            );
            edgesToLoad = this.selectRelevantEdges(
                graphData.edges,
                nodesToLoad,
            );
        } else {
            // Load detailed view
            nodesToLoad = graphData.nodes.slice(0, stage.maxNodes);
            edgesToLoad = this.selectRelevantEdges(
                graphData.edges,
                nodesToLoad,
            );
        }

        // Add elements to graph
        await this.addElementsWithAnimation(nodesToLoad, edgesToLoad, options);
    }

    /**
     * Load graph in progressive chunks
     */
    private async loadInChunks(
        graphData: any,
        options: LoadingOptions,
    ): Promise<void> {
        const chunkSize = options.chunkSize || 200;
        const delay = options.delayBetweenChunks || 50;

        // Start with overview
        await this.loadStageData(graphData, this.stages[0], options);

        // Load remaining nodes in chunks
        const remainingNodes = graphData.nodes.slice(this.stages[0].maxNodes);

        for (let i = 0; i < remainingNodes.length; i += chunkSize) {
            const chunk = remainingNodes.slice(i, i + chunkSize);
            const chunkEdges = this.selectRelevantEdges(graphData.edges, chunk);

            await this.addElementsWithAnimation(chunk, chunkEdges, options);

            // Small delay to prevent UI blocking
            if (delay > 0) {
                await this.sleep(delay);
            }
        }
    }

    /**
     * Select top nodes based on centrality score
     */
    private selectTopNodes(nodes: any[], maxCount: number): any[] {
        return nodes
            .sort(
                (a, b) =>
                    (b.data.centralityScore || 0) -
                    (a.data.centralityScore || 0),
            )
            .slice(0, maxCount);
    }

    /**
     * Select cluster representative nodes
     */
    private selectClusterNodes(nodes: any[], maxCount: number): any[] {
        // Group by community and select representatives
        const communities = new Map<string, any[]>();

        for (const node of nodes) {
            const communityId = node.data.communityId || "default";
            if (!communities.has(communityId)) {
                communities.set(communityId, []);
            }
            communities.get(communityId)!.push(node);
        }

        const selected: any[] = [];
        const nodesPerCommunity = Math.max(
            1,
            Math.floor(maxCount / communities.size),
        );

        for (const [communityId, communityNodes] of communities) {
            // Select top nodes from each community
            const topNodes = communityNodes
                .sort(
                    (a, b) =>
                        (b.data.centralityScore || 0) -
                        (a.data.centralityScore || 0),
                )
                .slice(0, nodesPerCommunity);

            selected.push(...topNodes);
        }

        return selected.slice(0, maxCount);
    }

    /**
     * Select edges relevant to loaded nodes
     */
    private selectRelevantEdges(edges: any[], nodes: any[]): any[] {
        const nodeIds = new Set(nodes.map((n) => n.data.id));

        return edges.filter(
            (edge) =>
                nodeIds.has(edge.data.source) && nodeIds.has(edge.data.target),
        );
    }

    /**
     * Add elements with optional animation
     */
    private async addElementsWithAnimation(
        nodes: any[],
        edges: any[],
        options: LoadingOptions,
    ): Promise<void> {
        const elements = [...nodes, ...edges];

        if (options.enableAnimations !== false && elements.length < 100) {
            // Add elements with animation for small chunks
            this.cy.add(elements);

            // Animate new elements
            const newElements = this.cy.elements(":unselected");
            newElements.style({ opacity: 0 });
            newElements.animate(
                {
                    style: { opacity: 1 },
                },
                {
                    duration: 300,
                    easing: "ease-out",
                },
            );
        } else {
            // Add elements without animation for large chunks
            this.cy.add(elements);
        }

        // Run layout if needed
        if (elements.length > 0) {
            this.runIncrementalLayout();
        }
    }

    /**
     * Run incremental layout for new elements
     */
    private runIncrementalLayout(): void {
        const layout = this.cy.layout({
            name: "cose-bilkent",
            fit: false, // Don't fit viewport to avoid jarring movement
        } as any);

        layout.run();
    }

    /**
     * Handle viewport changes (zoom/pan)
     */
    private handleViewportChange(): void {
        const currentZoom = this.cy.zoom();
        const newStage = this.getCurrentStage(currentZoom);

        // Check if we need to load more detail
        if (this.shouldLoadMoreDetail(newStage)) {
            this.loadAdditionalDetail(newStage);
        }
    }

    /**
     * Check if more detail should be loaded
     */
    private shouldLoadMoreDetail(stage: LoadingStage): boolean {
        const currentNodeCount = this.cy.nodes().length;
        return currentNodeCount < stage.maxNodes && !this.isLoading;
    }

    /**
     * Load additional detail for current stage
     */
    private async loadAdditionalDetail(stage: LoadingStage): Promise<void> {
        // Implementation would load more nodes based on viewport
        console.log(`Loading additional detail for stage: ${stage.name}`);
    }

    /**
     * Load neighborhood around a specific node
     */
    private async loadNodeNeighborhood(
        node: cytoscape.NodeSingular,
    ): Promise<void> {
        const nodeId = node.id();
        const chunkId = `neighborhood-${nodeId}`;

        if (this.loadedChunks.has(chunkId)) {
            return; // Already loaded
        }

        console.log(`Loading neighborhood for node: ${nodeId}`);

        // In a real implementation, this would query the hybrid storage
        // for the node's neighborhood and add the results

        this.loadedChunks.add(chunkId);
    }

    /**
     * Get current viewport information
     */
    private getCurrentViewport(): Viewport {
        const pan = this.cy.pan();
        const zoom = this.cy.zoom();
        const extent = this.cy.extent();

        return {
            x: pan.x,
            y: pan.y,
            width: extent.w,
            height: extent.h,
            zoom: zoom,
        };
    }

    /**
     * Check if an element is in current viewport
     */
    private isInViewport(
        element: cytoscape.NodeSingular | cytoscape.EdgeSingular,
    ): boolean {
        const viewport = this.getCurrentViewport();
        const bb = element.boundingBox();

        // Simple overlap check
        return !(
            bb.x2 < viewport.x ||
            bb.x1 > viewport.x + viewport.width ||
            bb.y2 < viewport.y ||
            bb.y1 > viewport.y + viewport.height
        );
    }

    /**
     * Utility function to create a promise that resolves after a delay
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Debounce utility to limit function calls
     */
    private debounce<T extends (...args: any[]) => any>(
        func: T,
        delay: number,
    ): (...args: Parameters<T>) => void {
        let timeoutId: NodeJS.Timeout;

        return (...args: Parameters<T>) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func(...args), delay);
        };
    }

    /**
     * Get loading statistics
     */
    getLoadingStats(): {
        loadedChunks: number;
        currentNodes: number;
        currentEdges: number;
        isLoading: boolean;
    } {
        return {
            loadedChunks: this.loadedChunks.size,
            currentNodes: this.cy.nodes().length,
            currentEdges: this.cy.edges().length,
            isLoading: this.isLoading,
        };
    }

    /**
     * Clear all loaded data
     */
    clear(): void {
        this.cy.elements().remove();
        this.loadedChunks.clear();
        this.pendingChunks.clear();
        this.isLoading = false;
    }
}
