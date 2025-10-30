// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Topic Graph Visualizer - Cytoscape.js integration for global importance and neighborhood topic visualization
declare var cytoscape: any;

interface TopicData {
    id: string;
    name: string;
    level: number;
    confidence: number;
    keywords: string[];
    entityReferences: string[];
    parentId?: string;
    childCount: number;
}

interface TopicRelationshipData {
    from: string;
    to: string;
    type: "parent-child" | "related-to" | "derived-from" | "co_occurs";
    strength: number;
}

interface TopicGraphData {
    centerTopic?: string;
    topics: TopicData[];
    relationships: TopicRelationshipData[];
    maxDepth: number;
}

type TopicViewMode = "tree" | "radial" | "force" | "transitioning";

export class TopicGraphVisualizer {
    protected cy: any = null;
    private container: HTMLElement;
    protected currentLayout: string = "dagre";
    private topicClickCallback: ((topic: TopicData) => void) | null = null;

    private currentTopic: string | null = null;
    private topicGraphData: TopicGraphData | null = null;
    private expandedNodes: Set<string> = new Set();

    // Level of detail management
    private visibleLevels: Set<number> = new Set([0, 1, 2]); // Show first 3 levels by default

    // LOD (Level of Detail) system for hierarchical zoom
    private lodThresholds: Map<
        number,
        { nodeThreshold: number; edgeThreshold: number; visibleLevels: number }
    > = new Map();
    private currentZoom: number = 1.0;
    private lastLodUpdate: number = 0;
    private lodUpdateInterval: number = 33; // ~30fps (reduced from 16ms for better performance)
    private zoomHandlerSetup: boolean = false;
    private prototypeModeEnabled: boolean = false;

    // Dual-instance approach: separate instances for global and neighborhood views
    private globalInstance: any = null;
    private neighborhoodInstance: any = null;
    private currentActiveView: "global" | "neighborhood" = "global";
    private onInstanceChangeCallback?: () => void;
    private globalGraphData: any = null;
    private neighborhoodGraphData: any = null;

    // Zoom thresholds for automatic view switching
    private zoomThresholds = {
        enterNeighborhoodMode: 2.5,
        exitNeighborhoodMode: 0.8,
    };

    // Transition state management
    private isLoadingNeighborhood: boolean = false;
    private previousGlobalZoom: number = 1.0;
    private storedGlobalViewport: {
        zoom: number;
        pan: { x: number; y: number };
    } | null = null;

    // Graph data provider for API calls
    private graphDataProvider: any = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.initializeLODThresholds();
    }

    /**
     * Detect WebGL support in the current browser
     */
    private detectWebGLSupport(): boolean {
        try {
            const canvas = document.createElement("canvas");
            const gl =
                canvas.getContext("webgl") ||
                canvas.getContext("experimental-webgl");
            return !!gl;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get optimal WebGL renderer configuration based on graph size and device capabilities
     */
    private getOptimalRendererConfig(): any {
        if (this.detectWebGLSupport()) {
            const nodeCount = this.topicGraphData?.topics?.length || 0;

            // Configure WebGL settings based on graph size
            let webglConfig = {
                name: "canvas",
                webgl: true,
                webglTexSize: 2048,
                webglTexRows: 16,
                webglBatchSize: 1024,
                webglTexPerBatch: 8,
            };

            // Scale configuration for larger graphs
            if (nodeCount > 1000) {
                webglConfig.webglTexSize = 4096;
                webglConfig.webglTexRows = 24;
                webglConfig.webglBatchSize = 2048;
                webglConfig.webglTexPerBatch = 16;
            } else if (nodeCount > 500) {
                webglConfig.webglBatchSize = 2048;
                webglConfig.webglTexPerBatch = 16;
            }

            console.log(
                `[WebGL] Enabled with texture size: ${webglConfig.webglTexSize}, batch size: ${webglConfig.webglBatchSize}`,
            );
            return webglConfig;
        } else {
            console.log(
                `[WebGL] Not supported, falling back to Canvas renderer`,
            );
            return { name: "canvas" };
        }
    }

    /**
     * Initialize LOD thresholds for different zoom levels
     */
    private initializeLODThresholds(): void {
        // Define zoom thresholds with corresponding visibility settings
        this.lodThresholds.set(0.25, {
            nodeThreshold: 0.8,
            edgeThreshold: 0.9,
            visibleLevels: 1,
        });
        this.lodThresholds.set(0.5, {
            nodeThreshold: 0.6,
            edgeThreshold: 0.7,
            visibleLevels: 2,
        });
        this.lodThresholds.set(1.0, {
            nodeThreshold: 0.4,
            edgeThreshold: 0.5,
            visibleLevels: 3,
        });
        this.lodThresholds.set(1.5, {
            nodeThreshold: 0.3,
            edgeThreshold: 0.4,
            visibleLevels: 4,
        });
        this.lodThresholds.set(2.0, {
            nodeThreshold: 0.2,
            edgeThreshold: 0.3,
            visibleLevels: 5,
        });
        this.lodThresholds.set(3.0, {
            nodeThreshold: 0.1,
            edgeThreshold: 0.2,
            visibleLevels: 6,
        });
        this.lodThresholds.set(4.0, {
            nodeThreshold: 0.05,
            edgeThreshold: 0.1,
            visibleLevels: 7,
        });
    }

    /**
     * Initialize the topic graph with data
     */
    public async init(data: TopicGraphData): Promise<void> {
        this.topicGraphData = data;

        // Create separate containers and instances if not already created
        if (!this.globalInstance || !this.neighborhoodInstance) {
            this.createDualInstances();
        }

        await this.initializeGlobalView(data);
    }

    /**
     * Create both Cytoscape instances with separate containers
     */
    private createDualInstances(): void {
        const rendererConfig = this.getOptimalRendererConfig();

        // Create global instance container
        const globalContainer = document.createElement("div");
        globalContainer.style.width = "100%";
        globalContainer.style.height = "100%";
        globalContainer.style.position = "absolute";
        globalContainer.style.top = "0";
        globalContainer.style.left = "0";
        globalContainer.style.visibility = "visible";
        this.container.appendChild(globalContainer);

        // Create neighborhood instance container
        const neighborhoodContainer = document.createElement("div");
        neighborhoodContainer.style.width = "100%";
        neighborhoodContainer.style.height = "100%";
        neighborhoodContainer.style.position = "absolute";
        neighborhoodContainer.style.top = "0";
        neighborhoodContainer.style.left = "0";
        neighborhoodContainer.style.visibility = "hidden";
        this.container.appendChild(neighborhoodContainer);

        // Initialize global instance
        this.globalInstance = cytoscape({
            container: globalContainer,
            style: this.getOptimizedTopicGraphStyles(),
            layout: this.getLayoutOptions(),
            elements: [],
            renderer: rendererConfig,
            minZoom: 0.25,
            maxZoom: 4.0,
            zoomingEnabled: true,
            userZoomingEnabled: false,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            autoungrabify: false,
        });

        // Initialize neighborhood instance
        this.neighborhoodInstance = cytoscape({
            container: neighborhoodContainer,
            style: this.getOptimizedTopicGraphStyles(),
            layout: this.getLayoutOptions(),
            elements: [],
            renderer: rendererConfig,
            minZoom: 0.25,
            maxZoom: 4.0,
            zoomingEnabled: true,
            userZoomingEnabled: false,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            autoungrabify: false,
        });

        // Setup zoom handlers for both instances
        this.setupZoomHandlerForInstance(this.globalInstance);
        this.setupZoomHandlerForInstance(this.neighborhoodInstance);

        console.log(
            "[TopicGraphVisualizer] Dual instances created with separate containers",
        );
    }

    /**
     * Initialize global importance view with dual-instance architecture
     */
    private async initializeGlobalView(data: TopicGraphData): Promise<void> {
        console.log(
            "[TopicGraphVisualizer] Initializing GLOBAL importance view",
        );
        console.log(
            `[TopicGraphVisualizer] Global view data: ${data.topics.length} topics`,
        );

        this.cy = this.globalInstance;
        this.currentActiveView = "global";
        this.globalGraphData = data;

        // Show global, hide others
        this.setInstanceVisibility("global");

        await this.loadData(data);
        this.setupEventHandlers();

        // Set up wheel zoom handler on container (only once)
        if (!this.zoomHandlerSetup) {
            this.setupContainerWheelHandler();
        }

        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Setup zoom handler for a specific Cytoscape instance
     */
    private setupZoomHandlerForInstance(instance: any): void {
        // Standard zoom handler for LOD updates
        instance.on("zoom", async (event: any) => {
            const currentZoom = instance.zoom();
            this.currentZoom = currentZoom;

            // Throttle LOD updates
            const now = Date.now();
            if (now - this.lastLodUpdate < this.lodUpdateInterval) return;
            this.lastLodUpdate = now;

            // Only apply LoD if this is the active instance
            if (instance === this.cy) {
                await this.applyLevelOfDetail(currentZoom);
            }
        });
    }

    /**
     * Switch to global importance view
     */
    public async switchToGlobalView(
        globalData?: TopicGraphData,
    ): Promise<void> {
        console.log(
            "[TopicGraphVisualizer] SWITCHING to global importance view",
        );
        const dataToUse = globalData || this.globalGraphData;

        if (!dataToUse) {
            console.warn(
                "[TopicGraphVisualizer] No global graph data available",
            );
            return;
        }

        console.log(
            `[TopicGraphVisualizer] Loading ${dataToUse.topics.length} topics in global view`,
        );

        this.cy = this.globalInstance;
        this.currentActiveView = "global";
        this.globalGraphData = dataToUse;

        this.setInstanceVisibility("global");

        await this.loadData(dataToUse);

        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }

        console.log("[TopicGraphVisualizer] Global view switch complete");
    }

    /**
     * Get current active view mode
     */
    public getCurrentViewMode(): "global" | "neighborhood" {
        return this.currentActiveView;
    }

    /**
     * Register callback for instance change events
     */
    public onInstanceChange(callback: () => void): void {
        this.onInstanceChangeCallback = callback;
    }

    /**
     * Set graph data provider for API calls
     */
    public setGraphDataProvider(provider: any): void {
        this.graphDataProvider = provider;
    }

    /**
     * Transition to neighborhood mode (zoom > 2.5x)
     */
    private async transitionToNeighborhoodMode(): Promise<void> {
        if (this.isLoadingNeighborhood) {
            console.log(
                "[TopicGraphVisualizer] Already loading neighborhood, skipping",
            );
            return;
        }

        if (!this.graphDataProvider) {
            console.warn(
                "[TopicGraphVisualizer] No graph data provider set, cannot load neighborhood",
            );
            return;
        }

        this.isLoadingNeighborhood = true;

        try {
            // Store current global viewport for restoration later
            this.previousGlobalZoom = this.globalInstance.zoom();
            this.storedGlobalViewport = {
                zoom: this.globalInstance.zoom(),
                pan: this.globalInstance.pan(),
            };

            console.log(
                `[TopicGraphVisualizer] Stored global viewport - Zoom: ${this.storedGlobalViewport.zoom.toFixed(2)}, Pan: (${this.storedGlobalViewport.pan.x.toFixed(0)}, ${this.storedGlobalViewport.pan.y.toFixed(0)})`,
            );

            // Get topics in current viewport
            const viewportTopics = this.getTopicsInViewport();
            console.log(
                `[TopicGraphVisualizer] Found ${viewportTopics.length} topics in viewport`,
            );

            if (viewportTopics.length === 0) {
                console.warn(
                    "[TopicGraphVisualizer] No topics in viewport, aborting neighborhood transition",
                );
                this.isLoadingNeighborhood = false;
                return;
            }

            // Select top 4 topics by importance to use as anchor nodes
            const sortedByImportance = viewportTopics.sort((a: any, b: any) => {
                const importanceA =
                    a.data("importance") || a.data("computedImportance") || 0;
                const importanceB =
                    b.data("importance") || b.data("computedImportance") || 0;
                return importanceB - importanceA;
            });

            const anchorTopics = sortedByImportance.slice(0, 4);
            const centerTopic = anchorTopics[0]; // Most important topic is the center

            console.log(
                `[TopicGraphVisualizer] Selected ${anchorTopics.length} anchor topics (center: ${centerTopic.data("label")})`,
            );
            anchorTopics.forEach((topic: any, idx: number) => {
                const importance =
                    topic.data("importance") ||
                    topic.data("computedImportance") ||
                    0;
                console.log(
                    `  ${idx + 1}. ${topic.data("label")} (importance: ${importance.toFixed(3)})`,
                );
            });

            // Get anchor topic IDs (top 4 by importance)
            const viewportTopicIds = anchorTopics.map((node: any) => node.id());

            // Load neighborhood data around these anchor topics
            const neighborhoodData =
                await this.graphDataProvider.getTopicViewportNeighborhood(
                    centerTopic.id(),
                    viewportTopicIds,
                    200, // maxNodes
                );

            console.log(
                `[TopicGraphVisualizer] Loaded neighborhood: ${neighborhoodData.topics?.length || 0} topics`,
            );

            if (
                !neighborhoodData.topics ||
                neighborhoodData.topics.length === 0
            ) {
                console.warn(
                    "[TopicGraphVisualizer] No neighborhood data returned",
                );
                this.isLoadingNeighborhood = false;
                return;
            }

            // Store neighborhood data
            this.neighborhoodGraphData = neighborhoodData;

            // Get center topic position from global view BEFORE switching
            const centerTopicNode = this.globalInstance.$(
                `#${centerTopic.id()}`,
            );
            let centerPosition = null;
            if (centerTopicNode.length > 0) {
                centerPosition = centerTopicNode.position();
                console.log(
                    `[TopicGraphVisualizer] Center topic "${centerTopic.data("label")}" position in global: (${centerPosition.x.toFixed(0)}, ${centerPosition.y.toFixed(0)})`,
                );
            }

            // Load data into neighborhood instance BEFORE switching
            await this.loadDataIntoInstance(
                this.neighborhoodInstance,
                neighborhoodData,
            );

            // If we have the center topic position, center the neighborhood view on it
            if (centerPosition) {
                const centerTopicInNeighborhood = this.neighborhoodInstance.$(
                    `#${centerTopic.id()}`,
                );
                if (centerTopicInNeighborhood.length > 0) {
                    console.log(
                        `[TopicGraphVisualizer] Centering neighborhood view on topic "${centerTopic.data("label")}"`,
                    );
                    this.neighborhoodInstance.center(centerTopicInNeighborhood);
                    this.neighborhoodInstance.zoom(1.5);
                }
            }

            // Now switch to neighborhood instance
            this.cy = this.neighborhoodInstance;
            this.currentActiveView = "neighborhood";

            // Hide global instance, show neighborhood
            this.setInstanceVisibility("neighborhood");

            // Setup event handlers for neighborhood instance
            this.setupEventHandlers();

            console.log(
                "[TopicGraphVisualizer] Neighborhood transition complete",
            );

            if (this.onInstanceChangeCallback) {
                this.onInstanceChangeCallback();
            }
        } catch (error) {
            console.error(
                "[TopicGraphVisualizer] Error transitioning to neighborhood:",
                error,
            );
        } finally {
            this.isLoadingNeighborhood = false;
        }
    }

    /**
     * Return to global view (zoom < 0.8x)
     */
    private async returnToGlobalView(): Promise<void> {
        console.log("[TopicGraphVisualizer] Returning to global view");

        // Switch back to global instance FIRST
        this.cy = this.globalInstance;
        this.currentActiveView = "global";

        // Show global instance, hide neighborhood BEFORE restoring zoom
        this.setInstanceVisibility("global");

        // Restore viewport if we stored it (with slight delay to let instance settle)
        if (this.storedGlobalViewport) {
            const { zoom, pan } = this.storedGlobalViewport;

            // Ensure zoom stays below neighborhood threshold
            const safeZoom = Math.min(
                zoom,
                this.zoomThresholds.enterNeighborhoodMode - 0.1,
            );

            // Restore viewport
            setTimeout(() => {
                this.globalInstance.zoom(safeZoom);
                this.globalInstance.pan(pan);
                console.log(
                    `[TopicGraphVisualizer] Restored global viewport - Zoom: ${safeZoom.toFixed(2)}`,
                );
            }, 50);

            this.storedGlobalViewport = null;
        }

        console.log("[TopicGraphVisualizer] Returned to global view");

        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Get topics currently in viewport
     */
    private getTopicsInViewport(): any[] {
        const activeInstance =
            this.currentActiveView === "global" ? this.globalInstance : this.cy;
        if (!activeInstance) return [];

        const viewport = activeInstance.extent();
        const topicsInViewport: any[] = [];

        activeInstance.nodes().forEach((node: any) => {
            const bb = node.boundingBox();
            if (this.isNodeInViewport(bb, viewport)) {
                topicsInViewport.push(node);
            }
        });

        return topicsInViewport;
    }

    /**
     * Select center topic from viewport topics (highest importance)
     */
    private selectCenterTopic(viewportTopics: any[]): any {
        if (viewportTopics.length === 0) return null;

        // Sort by importance (computedImportance data field)
        const sorted = viewportTopics.sort((a: any, b: any) => {
            const impA = a.data("computedImportance") || 0;
            const impB = b.data("computedImportance") || 0;
            return impB - impA;
        });

        return sorted[0];
    }

    /**
     * Set which instance is visible (uses visibility to avoid destroying renderer)
     */
    private setInstanceVisibility(
        visibleView: "global" | "neighborhood",
    ): void {
        const containers = {
            global: this.globalInstance?.container(),
            neighborhood: this.neighborhoodInstance?.container(),
        };

        // Hide all containers using visibility (preserves renderer state)
        Object.values(containers).forEach((container) => {
            if (container) container.style.visibility = "hidden";
        });

        // Show active container
        if (containers[visibleView]) {
            containers[visibleView].style.visibility = "visible";

            // Resize the active instance to ensure proper rendering
            if (visibleView === "global" && this.globalInstance) {
                this.globalInstance.resize();
            } else if (
                visibleView === "neighborhood" &&
                this.neighborhoodInstance
            ) {
                this.neighborhoodInstance.resize();
            }
        }
    }

    /**
     * Setup zoom handler for Level of Detail updates and custom zoom control (legacy)
     */
    private setupZoomHandler(): void {
        if (this.zoomHandlerSetup || !this.cy) return;

        // Set up wheel handler on container
        this.setupContainerWheelHandler();
    }

    /**
     * Setup custom wheel zoom handler on container (called once)
     */
    private setupContainerWheelHandler(): void {
        if (this.zoomHandlerSetup) return;

        // Custom smooth zoom wheel handler to prevent abrupt zoom changes
        this.container.addEventListener(
            "wheel",
            (event) => {
                if (!this.cy) return;

                event.preventDefault(); // Prevent default Cytoscape zoom handling

                const currentZoom = this.cy.zoom();
                const deltaY = event.deltaY;

                // Calculate smooth zoom step (10% per wheel event, max)
                const zoomStep = currentZoom * 0.1; // 10% of current zoom
                const maxStep = 0.1; // Maximum absolute step
                const actualStep = Math.min(zoomStep, maxStep);

                // Determine new zoom level
                let newZoom;
                if (deltaY > 0) {
                    // Zoom out
                    newZoom = currentZoom - actualStep;
                } else {
                    // Zoom in
                    newZoom = currentZoom + actualStep;
                }

                // Clamp to our bounds
                newZoom = Math.max(0.25, Math.min(4.0, newZoom));

                // Apply smooth zoom to current active instance
                this.cy.zoom({
                    level: newZoom,
                    renderedPosition: { x: event.offsetX, y: event.offsetY },
                });
            },
            { passive: false },
        ); // Must be non-passive to preventDefault

        this.zoomHandlerSetup = true;
        console.log("[TopicGraphVisualizer] Container wheel handler set up");
    }

    /**
     * Apply Level of Detail based on zoom level
     */
    private async applyLevelOfDetail(zoom: number): Promise<void> {
        if (!this.cy) return;

        // Skip LoD updates when in prototype mode
        if (this.prototypeModeEnabled) {
            return;
        }

        // Check for view transitions based on zoom
        await this.checkViewTransitions(zoom);

        // Get LOD settings for current zoom
        const lodSettings = this.getLODSettings(zoom);

        console.log(
            `[TopicGraphVisualizer] LoD Update - Zoom: ${zoom.toFixed(2)}x, Visible Levels: ${lodSettings.visibleLevels}, Node Threshold: ${lodSettings.nodeThreshold}, View Mode: ${this.currentActiveView}`,
        );

        // Update visible hierarchy depth
        this.updateVisibleHierarchyDepth(lodSettings.visibleLevels);

        // Update node and edge visibility based on importance
        this.updateElementVisibility(zoom, lodSettings);

        // Update label visibility
        this.updateLabelVisibility(zoom);
    }

    /**
     * Check if zoom level triggers view transitions
     */
    private async checkViewTransitions(zoom: number): Promise<void> {
        // Transition to neighborhood mode when zooming in past threshold
        if (
            this.currentActiveView === "global" &&
            zoom > this.zoomThresholds.enterNeighborhoodMode
        ) {
            console.log(
                `[TopicGraphVisualizer] Zoom ${zoom.toFixed(2)}x > ${this.zoomThresholds.enterNeighborhoodMode} - Triggering neighborhood mode`,
            );
            await this.transitionToNeighborhoodMode();
        }
        // Return to global view when zooming out below threshold
        else if (
            this.currentActiveView === "neighborhood" &&
            zoom < this.zoomThresholds.exitNeighborhoodMode
        ) {
            console.log(
                `[TopicGraphVisualizer] Zoom ${zoom.toFixed(2)}x < ${this.zoomThresholds.exitNeighborhoodMode} - Returning to global view`,
            );
            await this.returnToGlobalView();
        }
    }

    /**
     * Get LOD settings for a specific zoom level
     */
    private getLODSettings(zoom: number): {
        nodeThreshold: number;
        edgeThreshold: number;
        visibleLevels: number;
    } {
        // Find the closest zoom threshold
        const zoomLevels = Array.from(this.lodThresholds.keys()).sort(
            (a, b) => a - b,
        );
        let closestZoom = zoomLevels[0];

        for (const level of zoomLevels) {
            if (zoom >= level) {
                closestZoom = level;
            } else {
                break;
            }
        }

        return (
            this.lodThresholds.get(closestZoom) || {
                nodeThreshold: 0.5,
                edgeThreshold: 0.5,
                visibleLevels: 3,
            }
        );
    }

    /**
     * Update visible hierarchy depth based on zoom
     */
    private updateVisibleHierarchyDepth(maxLevel: number): void {
        if (!this.cy) return;

        // Show/hide nodes based on their hierarchy level
        this.cy.nodes().forEach((node: any) => {
            const level = node.data("level");
            if (level <= maxLevel) {
                node.style("display", "element");
                node.style("opacity", 1 - level * 0.1); // Fade deeper levels
            } else {
                node.style("display", "none");
            }
        });

        // Update edges visibility based on connected nodes
        this.cy.edges().forEach((edge: any) => {
            const source = edge.source();
            const target = edge.target();

            if (
                source.style("display") === "none" ||
                target.style("display") === "none"
            ) {
                edge.style("display", "none");
            } else {
                edge.style("display", "element");
            }
        });
    }

    /**
     * Update element visibility based on importance, zoom, and viewport
     */
    private updateElementVisibility(zoom: number, lodSettings: any): void {
        if (!this.cy) return;

        const viewport = this.getViewportBounds();
        const nodesInViewport = this.getNodesInViewport(viewport);

        // Update node visibility based on computed importance and viewport presence
        this.cy.nodes().forEach((node: any) => {
            if (node.style("display") === "none") return; // Skip already hidden nodes

            const computedImportance = node.data("computedImportance") || 0.5;
            const isInViewport = nodesInViewport.has(node.id());

            // Calculate adaptive threshold based on viewport density
            const adaptiveThreshold = this.calculateAdaptiveThreshold(
                lodSettings.nodeThreshold,
                nodesInViewport.size,
                zoom,
            );

            // Determine visibility based on importance and viewport presence
            const shouldShow = this.shouldShowNodeAtZoom(
                computedImportance,
                adaptiveThreshold,
                isInViewport,
                zoom,
            );

            if (shouldShow) {
                node.addClass("visible-at-zoom");
                node.removeClass("hidden-at-zoom");
            } else {
                node.addClass("hidden-at-zoom");
                node.removeClass("visible-at-zoom");
            }
        });

        // Update edge visibility based on connected nodes
        this.updateEdgeVisibility(zoom, lodSettings);
    }

    /**
     * Get viewport bounds for visibility calculations
     */
    private getViewportBounds(): any {
        if (!this.cy) return null;
        return this.cy.extent();
    }

    /**
     * Get set of nodes currently in viewport
     */
    private getNodesInViewport(viewport: any): Set<string> {
        const nodesInView = new Set<string>();

        if (!this.cy || !viewport) return nodesInView;

        try {
            this.cy.nodes().forEach((node: any) => {
                try {
                    const bb = node.boundingBox();
                    if (bb && this.isNodeInViewport(bb, viewport)) {
                        nodesInView.add(node.id());
                    }
                } catch (nodeError) {
                    // Skip nodes that can't get bounding box (e.g., from hidden instances)
                }
            });
        } catch (error) {
            console.warn(
                "[TopicGraphVisualizer] Error getting viewport nodes:",
                error,
            );
        }

        return nodesInView;
    }

    /**
     * Check if a node's bounding box intersects with viewport
     */
    private isNodeInViewport(nodeBB: any, viewport: any): boolean {
        return !(
            nodeBB.x2 < viewport.x1 ||
            nodeBB.x1 > viewport.x2 ||
            nodeBB.y2 < viewport.y1 ||
            nodeBB.y1 > viewport.y2
        );
    }

    /**
     * Calculate adaptive threshold based on viewport density
     */
    private calculateAdaptiveThreshold(
        baseThreshold: number,
        nodesInViewport: number,
        zoom: number,
    ): number {
        // Increase threshold when viewport is crowded to show only most important nodes
        const densityFactor = Math.min(2.0, 1.0 + nodesInViewport / 50);

        // Decrease threshold at higher zoom to show more detail
        const zoomFactor = Math.max(0.5, 1.0 - (zoom - 1.0) * 0.3);

        return baseThreshold * densityFactor * zoomFactor;
    }

    /**
     * Determine if a node should be visible at current zoom level
     */
    private shouldShowNodeAtZoom(
        importance: number,
        threshold: number,
        isInViewport: boolean,
        zoom: number,
    ): boolean {
        // Always show high-importance nodes
        if (importance > 0.8) return true;

        // At high zoom, show more nodes regardless of viewport
        if (zoom > 2.0) return importance > threshold * 0.7;

        // In viewport, use normal threshold
        if (isInViewport) return importance > threshold;

        // Outside viewport, require higher importance
        return importance > threshold * 1.5;
    }

    /**
     * Update edge visibility based on connected nodes with batch operations
     */
    private updateEdgeVisibility(zoom: number, lodSettings: any): void {
        if (!this.cy) return;

        // Use batch for better performance
        this.cy.batch(() => {
            this.cy.edges().forEach((edge: any) => {
                const source = edge.source();
                const target = edge.target();

                const sourceVisible = source.hasClass("visible-at-zoom");
                const targetVisible = target.hasClass("visible-at-zoom");

                // Show edge only if both nodes are visible
                if (sourceVisible && targetVisible) {
                    // Apply additional filtering based on edge importance
                    const edgeStrength = edge.data("strength") || 0.5;
                    if (edgeStrength >= lodSettings.edgeThreshold) {
                        edge.addClass("visible-at-zoom");
                        edge.removeClass("hidden-at-zoom");
                    } else {
                        edge.addClass("hidden-at-zoom");
                        edge.removeClass("visible-at-zoom");
                    }
                } else {
                    edge.addClass("hidden-at-zoom");
                    edge.removeClass("visible-at-zoom");
                }
            });
        });
    }

    /**
     * Update label visibility based on zoom and importance with batch operations
     */
    private updateLabelVisibility(zoom: number): void {
        if (!this.cy) return;

        // Calculate label opacity based on importance and zoom with batching
        this.cy.batch(() => {
            this.cy.nodes().forEach((node: any) => {
                const isVisible = node.hasClass("visible-at-zoom");
                const computedImportance =
                    node.data("computedImportance") || 0.5;
                const level = node.data("level") || 0;

                let textOpacity = 0;

                if (isVisible) {
                    if (zoom < 0.5) {
                        // Hide all labels at very low zoom except level 0
                        textOpacity = level === 0 ? 0.7 : 0;
                    } else if (zoom < 1.0) {
                        // Show important labels only
                        textOpacity = computedImportance > 0.7 ? 0.8 : 0;
                    } else if (zoom < 2.0) {
                        // Show more labels based on importance and level
                        if (level <= 1) {
                            textOpacity = Math.min(
                                1.0,
                                computedImportance + 0.2,
                            );
                        } else {
                            textOpacity = computedImportance > 0.5 ? 0.7 : 0;
                        }
                    } else {
                        // High zoom: show all visible node labels
                        textOpacity = Math.min(1.0, computedImportance + 0.3);
                    }
                }

                // Apply opacity
                node.style("text-opacity", textOpacity);
            });
        });
    }

    /**
     * Load topic data into the graph
     */
    private async loadData(data: TopicGraphData): Promise<void> {
        await this.loadDataIntoInstance(this.cy, data);
    }

    /**
     * Load data into a specific Cytoscape instance with batch operations for performance
     */
    private async loadDataIntoInstance(
        instance: any,
        data: any,
    ): Promise<void> {
        let elements: any[];
        let usePresetLayout = false;

        if (data.presetLayout?.elements) {
            console.log(
                `[TopicGraphVisualizer] Using graphology preset layout with ${data.presetLayout.elements.length} elements`,
            );
            console.log(
                `[TopicGraphVisualizer] Layout computed in ${data.presetLayout.layoutDuration?.toFixed(0)}ms, ` +
                    `${data.presetLayout.communityCount} communities detected`,
            );
            elements = data.presetLayout.elements;
            usePresetLayout = true;
        } else {
            console.log(
                "[TopicGraphVisualizer] No preset layout, will compute CoSE layout",
            );
            elements = this.convertToTopicElements(data);
        }

        // Use batch operations for better performance
        instance.batch(() => {
            instance.elements().remove();
            instance.add(elements);
        });

        // Apply layout on this specific instance
        await this.applyLayoutToInstance(instance, usePresetLayout);

        // Focus on center topic if specified
        if (data.centerTopic) {
            const node = instance.$(`#${data.centerTopic}`);
            if (node.length > 0) {
                instance.center(node);
                instance.zoom(1.5);
            }
        } else {
            instance.fit();
        }

        // Apply initial LOD only if this is the active instance
        if (instance === this.cy) {
            const initialZoom = instance.zoom();
            await this.applyLevelOfDetail(initialZoom);
        }
    }

    /**
     * Calculate multi-factor importance for a topic
     */
    private calculateTopicImportance(topic: TopicData): number {
        const baseConfidence = topic.confidence || 0.5;
        const levelWeight = 1 / (topic.level + 1);
        const childrenWeight = Math.min(1, topic.childCount * 0.1);
        const entityRefWeight = Math.min(
            1,
            topic.entityReferences.length * 0.05,
        );
        const keywordWeight = Math.min(1, topic.keywords.length * 0.03);

        const rawImportance =
            baseConfidence * 0.4 +
            levelWeight * 0.25 +
            childrenWeight * 0.15 +
            entityRefWeight * 0.15 +
            keywordWeight * 0.05;

        // Apply exponential scaling to increase variance
        // This spreads out the importance values more dramatically
        const scaled = Math.pow(rawImportance, 1.5);

        return Math.min(1, Math.max(0.1, scaled));
    }

    /**
     * Convert topic data to Cytoscape elements
     */
    private convertToTopicElements(data: TopicGraphData): any[] {
        const elements: any[] = [];

        // Add topic nodes
        const nodeMap = new Map<string, any>();
        for (const topic of data.topics) {
            if (this.visibleLevels.has(topic.level)) {
                // Use backend importance score if available, otherwise calculate locally
                const computedImportance =
                    (topic as any).importance !== undefined
                        ? (topic as any).importance
                        : this.calculateTopicImportance(topic);

                const nodeElement = {
                    data: {
                        id: topic.id,
                        label: topic.name,
                        level: topic.level,
                        confidence: topic.confidence,
                        computedImportance: computedImportance,
                        keywords: topic.keywords,
                        entityReferences: topic.entityReferences,
                        parentId: topic.parentId,
                        childCount: topic.childCount,
                        nodeType: "topic",
                    },
                    classes: this.getTopicClasses(topic),
                };
                elements.push(nodeElement);
                nodeMap.set(topic.id, topic);
            }
        }

        // Calculate dynamic co-occurrence threshold for global view
        let coOccursThreshold = 0;
        if (this.currentActiveView === "global") {
            coOccursThreshold = this.calculateCoOccursThreshold(
                data.relationships,
            );
        }

        // Add relationship edges
        for (const rel of data.relationships) {
            // Only add edges if both nodes are visible
            const sourceVisible = elements.some(
                (el) => el.data.id === rel.from,
            );
            const targetVisible = elements.some((el) => el.data.id === rel.to);

            if (sourceVisible && targetVisible) {
                // Performance optimization: filter edges based on view mode
                if (this.currentActiveView === "global") {
                    // In global view, only show top 20% strongest co_occurs edges
                    // This keeps strongly related topics connected while reducing edge density
                    if (
                        rel.type === "co_occurs" &&
                        (rel.strength || 0) < coOccursThreshold
                    ) {
                        continue;
                    }
                    // Also skip low-strength edges for cleaner visualization
                    if (rel.strength < 0.3) {
                        continue;
                    }
                }

                elements.push({
                    data: {
                        id: `${rel.from}-${rel.to}`,
                        source: rel.from,
                        target: rel.to,
                        relationship: rel.type,
                        strength: rel.strength,
                    },
                    classes: `edge-${rel.type}`,
                });
            }
        }

        return elements;
    }

    /**
     * Calculate dynamic threshold for co-occurrence edges based on strength distribution
     * Returns the 80th percentile strength value (keeps top 20% of co_occurs edges)
     */
    private calculateCoOccursThreshold(
        relationships: TopicRelationshipData[],
    ): number {
        const coOccursStrengths = relationships
            .filter((rel) => rel.type === "co_occurs")
            .map((rel) => rel.strength || 0)
            .sort((a, b) => a - b);

        if (coOccursStrengths.length === 0) {
            return 0;
        }

        const percentile = 0.8;
        const index = Math.floor(coOccursStrengths.length * percentile);
        const threshold = coOccursStrengths[index];

        console.log(
            `[TopicGraphVisualizer] Co-occurrence threshold: ${threshold.toFixed(3)} ` +
                `(80th percentile of ${coOccursStrengths.length} co_occurs edges, ` +
                `will keep ${coOccursStrengths.length - index} edges)`,
        );

        return threshold;
    }

    /**
     * Get CSS classes for topic nodes
     */
    private getTopicClasses(topic: TopicData): string {
        const classes = ["topic-node"];

        classes.push(`level-${topic.level}`);

        if (topic.confidence > 0.8) classes.push("high-confidence");
        else if (topic.confidence > 0.6) classes.push("medium-confidence");
        else classes.push("low-confidence");

        if (topic.childCount > 0) classes.push("has-children");
        if (this.expandedNodes.has(topic.id)) classes.push("expanded");

        return classes.join(" ");
    }

    /**
     * Get optimized Cytoscape style definitions with entity graph consistency
     */
    private getOptimizedTopicGraphStyles(): any[] {
        return this.getBaseTopicStyles();
    }

    /**
     * Get base topic graph styles matching entity graph patterns with performance optimizations
     */
    private getBaseTopicStyles(): any[] {
        return [
            // Base node performance optimizations
            {
                selector: "node",
                style: {
                    "min-zoomed-font-size": 8,
                    "text-opacity": 0, // Start with labels hidden for performance
                    "transition-property": "none",
                    "transition-duration": 0,
                    events: "yes",
                    // Use fixed sizing for better performance instead of dynamic mapData
                    width: 40,
                    height: 40,
                },
            },

            // Topic nodes with simplified styling
            {
                selector: 'node[nodeType="topic"]',
                style: {
                    "background-color": "data(color)",
                    width: "data(size)",
                    height: "data(size)",
                    label: "data(label)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": "12px",
                    "font-weight": "bold",
                    color: "#333",
                    "border-width": 2,
                    "border-color": "#666",
                    "min-zoomed-font-size": 8,
                    "transition-property": "none",
                    "transition-duration": 0,
                    opacity: 1.0,
                },
            },

            // Level-specific styling - using graphology community colors instead
            {
                selector: ".level-0",
                style: {
                    shape: "roundrectangle",
                    "font-size": "14px",
                    "font-weight": "bold",
                    "text-opacity": 1,
                    "z-index": 1000,
                },
            },
            {
                selector: ".level-1",
                style: {
                    shape: "ellipse",
                    "font-size": "12px",
                    "text-opacity": 1,
                    "z-index": 900,
                },
            },
            {
                selector: ".level-2",
                style: {
                    shape: "diamond",
                    "font-size": "11px",
                    "z-index": 800,
                },
            },
            {
                selector: ".level-3",
                style: {
                    shape: "triangle",
                    "font-size": "10px",
                    "z-index": 700,
                },
            },
            {
                selector: ".level-4",
                style: {
                    shape: "pentagon",
                    "font-size": "9px",
                    "z-index": 600,
                },
            },

            // Show labels only for important nodes
            {
                selector: "node[?important]",
                style: {
                    "text-opacity": 1,
                },
            },

            // LOD visibility classes
            {
                selector: ".visible-at-zoom",
                style: {
                    display: "element",
                    events: "yes",
                },
            },
            {
                selector: ".hidden-at-zoom",
                style: {
                    display: "none",
                    events: "no",
                },
            },

            // Edge base styles with haystack for performance
            {
                selector: "edge",
                style: {
                    "curve-style": "haystack", // Fastest edge rendering
                    "haystack-radius": 0.5,
                    width: 1,
                    "line-color": "#ddd",
                    "target-arrow-shape": "none", // Remove arrows for performance
                    opacity: 0.6,
                    "transition-property": "none",
                    "transition-duration": 0,
                },
            },

            // Edge types with simplified styling for performance
            {
                selector: ".edge-parent-child",
                style: {
                    "line-color": "#A4C8F0",
                    width: 2,
                    opacity: 0.5,
                },
            },
            {
                selector: ".edge-co_occurs",
                style: {
                    "line-color": "#C8F0A0",
                    width: 1,
                    opacity: 0.4,
                },
            },
            {
                selector: ".edge-related-to",
                style: {
                    "line-color": "#C8F0A0",
                    width: 1,
                    opacity: 0.3,
                },
            },
            {
                selector: ".edge-derived-from",
                style: {
                    "line-color": "#FBD89C",
                    width: 1,
                    opacity: 0.3,
                },
            },

            // Edge hover highlight
            {
                selector: "edge:hover",
                style: {
                    opacity: 0.9,
                    width: 4,
                    "z-index": 999,
                },
            },

            // Selected/highlighted states
            {
                selector: ":selected",
                style: {
                    "border-color": "#FF5722",
                    "border-width": 5,
                    "overlay-opacity": 0.3,
                    "overlay-color": "#FF5722",
                    "z-index": 9999,
                },
            },
            {
                selector: ":active",
                style: {
                    "overlay-opacity": 0.5,
                    "overlay-color": "#FF5722",
                },
            },
            {
                selector: ".search-highlight",
                style: {
                    "background-color": "#FFD700",
                    "border-color": "#FFA500",
                    "border-width": 4,
                },
            },
        ];
    }

    /**
     * Get layout options - now always returns optimized CoSE
     */
    private getLayoutOptions(): any {
        return this.getOptimalCoSEConfig();
    }

    /**
     * Get optimized CoSE layout configuration based on graph size
     */
    private getOptimalCoSEConfig(): any {
        const nodeCount = this.topicGraphData?.topics?.length || 0;
        const edgeCount = this.topicGraphData?.relationships?.length || 0;

        // Drastically reduce iterations for performance - matching entity graph approach
        let iterations;
        if (nodeCount < 100) {
            iterations = 300;
        } else if (nodeCount < 300) {
            iterations = 200;
        } else if (nodeCount < 800) {
            iterations = 100;
        } else {
            iterations = 50; // Very few iterations for large graphs
        }

        // Further reduce if edge density is high
        const edgeDensity = edgeCount / (nodeCount * nodeCount);
        if (edgeDensity > 0.1) {
            // Dense graph
            iterations = Math.max(20, iterations / 2);
        }

        console.log(
            `[Perf] Using ${iterations} iterations for ${nodeCount} nodes, ${edgeCount} edges (density: ${edgeDensity.toFixed(3)})`,
        );

        const baseConfig = {
            name: "cose",
            idealEdgeLength: 80, // Reduced from 250 for faster layout
            nodeOverlap: 20, // Reduced from 50
            refresh: 20,
            fit: false,
            animate: "end",
            padding: 30, // Reduced from 40
            randomize: false,
            componentSpacing: 100, // Reduced from 150
            nodeRepulsion: (node: any) => {
                const importance = node.data("computedImportance") || 0.5;
                // Reduced repulsion for faster calculation
                return 400000 * (importance + 0.1);
            },
            edgeElasticity: (edge: any) => {
                const strength = edge.data("strength") || 0.5;
                const type = edge.data("relationship");
                // Simplified edge elasticity
                if (type === "co_occurs") {
                    return 50 * strength; // Reduced from 30
                }
                return 100 * strength; // Reduced from 50
            },
            nestingFactor: 5,
            gravity: 80, // Increased from 40 for faster convergence
            numIter: iterations,
            initialTemp: 200, // Reduced from 300
            coolingFactor: 0.95,
            minTemp: 1.0,
        };

        return baseConfig;
    }

    /**
     * Apply current layout
     */
    private async applyLayout(): Promise<void> {
        await this.applyLayoutToInstance(this.cy);
    }

    /**
     * Apply layout to a specific instance
     */
    private async applyLayoutToInstance(
        instance: any,
        usePreset: boolean = false,
    ): Promise<void> {
        return new Promise((resolve) => {
            let layoutConfig;

            if (usePreset) {
                layoutConfig = {
                    name: "preset",
                    fit: false,
                    animate: false,
                };
                console.log(
                    "[TopicGraphVisualizer] Applying preset layout (using pre-computed positions)",
                );
            } else {
                layoutConfig = this.getLayoutOptions();
                console.log(
                    `[TopicGraphVisualizer] Computing CoSE layout...`,
                );
            }

            const layout = instance.layout(layoutConfig);
            layout.on("layoutstop", () => {
                if (!usePreset) {
                    console.log(
                        "[TopicGraphVisualizer] CoSE layout computation complete",
                    );
                }
                resolve();
            });
            layout.run();
        });
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        // Topic click handler
        this.cy.on("tap", 'node[nodeType="topic"]', (event: any) => {
            const node = event.target;
            const topicData = this.createTopicDataFromNode(node);

            if (this.topicClickCallback) {
                this.topicClickCallback(topicData);
            }

            this.selectTopic(node.id());
        });

        // Double-click to expand/collapse
        this.cy.on("dbltap", 'node[nodeType="topic"]', (event: any) => {
            const node = event.target;
            this.toggleTopicExpansion(node.id());
        });

        // Setup zoom handler if not already done
        if (!this.zoomHandlerSetup) {
            this.setupZoomHandler();
        }
    }

    /**
     * Create TopicData from Cytoscape node
     */
    private createTopicDataFromNode(node: any): TopicData {
        const data = node.data();
        return {
            id: data.id,
            name: data.label,
            level: data.level,
            confidence: data.confidence,
            keywords: data.keywords || [],
            entityReferences: data.entityReferences || [],
            parentId: data.parentId,
            childCount: data.childCount || 0,
        };
    }

    /**
     * Select and focus on a topic
     */
    public selectTopic(topicId: string): void {
        this.cy.elements().removeClass("selected");
        const node = this.cy.getElementById(topicId);
        if (node.length > 0) {
            node.addClass("selected");
            this.currentTopic = topicId;
        }
    }

    /**
     * Focus view on a specific topic
     */
    public focusOnTopic(topicId: string): void {
        const node = this.cy.getElementById(topicId);
        if (node.length > 0) {
            this.cy.animate(
                {
                    fit: {
                        eles: node,
                        padding: 100,
                    },
                },
                {
                    duration: 500,
                },
            );
            this.selectTopic(topicId);
        }
    }

    /**
     * Toggle expansion of a topic (show/hide children)
     */
    public toggleTopicExpansion(topicId: string): void {
        if (this.expandedNodes.has(topicId)) {
            this.expandedNodes.delete(topicId);
            this.collapseTopicChildren(topicId);
        } else {
            this.expandedNodes.add(topicId);
            this.expandTopicChildren(topicId);
        }
    }

    /**
     * Expand children of a topic
     */
    private expandTopicChildren(topicId: string): void {
        if (!this.topicGraphData) return;

        const childTopics = this.topicGraphData.topics.filter(
            (topic) => topic.parentId === topicId,
        );

        // Add child elements to the graph
        const newElements: any[] = [];
        for (const topic of childTopics) {
            if (!this.cy.getElementById(topic.id).length) {
                const computedImportance = this.calculateTopicImportance(topic);

                newElements.push({
                    data: {
                        id: topic.id,
                        label: topic.name,
                        level: topic.level,
                        confidence: topic.confidence,
                        computedImportance: computedImportance, // Add computed importance for dynamic nodes
                        keywords: topic.keywords,
                        entityReferences: topic.entityReferences,
                        parentId: topic.parentId,
                        childCount: topic.childCount,
                        nodeType: "topic",
                    },
                    classes: this.getTopicClasses(topic),
                });

                // Add parent-child edge
                newElements.push({
                    data: {
                        id: `${topicId}-${topic.id}`,
                        source: topicId,
                        target: topic.id,
                        relationship: "parent-child",
                        strength: 0.9,
                    },
                    classes: "edge-parent-child",
                });
            }
        }

        if (newElements.length > 0) {
            // Use batch for adding new elements
            this.cy.batch(() => {
                this.cy.add(newElements);
            });

            this.applyLayout();

            // Reapply LOD to ensure new nodes respect visibility rules
            this.applyLevelOfDetail(this.currentZoom);
        }
    }

    /**
     * Collapse children of a topic with batch operations
     */
    private collapseTopicChildren(topicId: string): void {
        const childNodes = this.cy.nodes().filter((node: any) => {
            return node.data("parentId") === topicId;
        });

        if (childNodes.length > 0) {
            // Use batch for removing elements
            this.cy.batch(() => {
                childNodes.remove();
            });
        }
    }

    /**
     * Set visible levels
     */
    public setVisibleLevels(levels: number[]): void {
        this.visibleLevels = new Set(levels);
        if (this.topicGraphData) {
            this.loadData(this.topicGraphData);
        }
    }

    /**
     * Set topic click callback
     */
    public onTopicClick(callback: (topic: TopicData) => void): void {
        this.topicClickCallback = callback;
    }

    /**
     * Search for topics by name or keyword
     */
    public searchTopics(query: string): TopicData[] {
        if (!this.topicGraphData) return [];

        const lowerQuery = query.toLowerCase();
        return this.topicGraphData.topics.filter(
            (topic) =>
                topic.name.toLowerCase().includes(lowerQuery) ||
                topic.keywords.some((keyword) =>
                    keyword.toLowerCase().includes(lowerQuery),
                ),
        );
    }

    /**
     * Highlight search results
     */
    public highlightSearchResults(topicIds: string[]): void {
        this.cy.elements().removeClass("search-highlight");
        for (const topicId of topicIds) {
            const node = this.cy.getElementById(topicId);
            if (node.length > 0) {
                node.addClass("search-highlight");
            }
        }
    }

    /**
     * Fit the graph to the view
     */
    public fitToView(): void {
        if (this.cy) {
            this.cy.fit();
        }
    }

    /**
     * Center the graph
     */
    public centerGraph(): void {
        if (this.cy) {
            this.cy.center();
        }
    }

    /**
     * Get current graph statistics
     */
    public getGraphStats(): any {
        if (!this.topicGraphData) return null;

        return {
            totalTopics: this.topicGraphData.topics.length,
            visibleTopics: this.cy
                ? this.cy.nodes('[nodeType="topic"]').length
                : 0,
            maxDepth: this.topicGraphData.maxDepth,
            visibleLevels: Array.from(this.visibleLevels),
            expandedNodes: Array.from(this.expandedNodes),
        };
    }

    /**
     * Export graph as image
     */
    public exportAsImage(format: "png" | "jpg" = "png"): string {
        return this.cy.png({
            output: "base64uri",
            full: true,
            scale: 2,
        });
    }

    /**
     * Enable or disable prototype rendering mode
     * When enabled, disables LoD and shows all elements with simple styling
     */
    public setPrototypeMode(enabled: boolean): void {
        if (!this.cy) {
            console.warn("[TopicGraphVisualizer] No Cytoscape instance available");
            return;
        }

        this.prototypeModeEnabled = enabled;

        if (enabled) {
            console.log("[TopicGraphVisualizer] Enabling prototype mode - disabling LoD, showing all elements");

            this.cy.batch(() => {
                this.cy.nodes().forEach((node: any) => {
                    node.removeClass("hidden-at-zoom");
                    node.addClass("visible-at-zoom");
                    node.style("display", "element");
                    node.style("events", "yes");
                    node.style("text-opacity", 0);
                });

                this.cy.edges().forEach((edge: any) => {
                    edge.removeClass("hidden-at-zoom");
                    edge.addClass("visible-at-zoom");
                    edge.style("display", "element");
                    edge.style("events", "yes");
                });
            });

            console.log(`[TopicGraphVisualizer] Prototype mode enabled - ${this.cy.nodes().length} nodes, ${this.cy.edges().length} edges visible`);
        } else {
            console.log("[TopicGraphVisualizer] Disabling prototype mode - re-enabling LoD");

            const currentZoom = this.cy.zoom();
            this.applyLevelOfDetail(currentZoom);

            console.log(`[TopicGraphVisualizer] Prototype mode disabled - LoD re-applied at zoom ${currentZoom.toFixed(2)}x`);
        }
    }

    /**
     * Cleanup and dispose
     */
    public dispose(): void {
        // Destroy Cytoscape instance
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }

        // Reset flags
        this.zoomHandlerSetup = false;
    }
}
