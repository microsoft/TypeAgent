// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entity Graph Visualizer - Cytoscape.js integration for entity visualization
declare var cytoscape: any;

interface EntityData {
    name: string;
    type: string;
    confidence: number;
}

interface RelationshipData {
    from: string;
    to: string;
    type: string;
    strength: number;
}

interface GraphData {
    centerEntity?: string;
    entities: EntityData[];
    relationships: RelationshipData[];
}

type ViewMode =
    | "entity-detail"
    | "entity-extended"
    | "entity-community"
    | "global"
    | "transitioning";

/**
 * Entity Graph Visualizer using Cytoscape.js
 */
export class EntityGraphVisualizer {
    protected cy: any = null;
    private container: HTMLElement;
    protected currentLayout: string = "force";
    private entityClickCallback: ((entity: EntityData) => void) | null = null;

    // View mode and data management
    private viewMode: ViewMode = "global";
    private currentEntity: string | null = null;
    private entityGraphData: GraphData | null = null;
    private globalGraphData: any = null;

    // Single-instance (global only) - Phase 3: Detail view removed
    private globalInstance: any = null;
    private currentActiveView: "global" = "global";
    private onInstanceChangeCallback?: () => void;
    private zoomHandlersSetup: boolean = false;

    private layoutCache: Map<string, any> = new Map();
    private zoomTimer: any = null;
    private isNodeBeingDragged: boolean = false;
    private layoutUpdateTimer: any = null;
    private selectedNodes: Set<string> = new Set();
    private contextMenu: HTMLElement | null = null;

    // Cursor tracking for center node selection
    private lastCursorPosition: { x: number; y: number } | null = null;
    private isCursorOverMap: boolean = false;


    // Investigation tracking
    private zoomEventCount: number = 0;
    private eventSequence: Array<{
        event: string;
        time: number;
        zoom: number;
        details?: any;
    }> = [];

    // Graph data provider
    private graphDataProvider: any = null;

    constructor(container: HTMLElement) {
        this.container = container;
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
            const nodeCount = this.globalGraphData?.entities?.length || 0;

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
     * Initialize the visualizer
     */
    async initialize(): Promise<void> {
        console.time("[Perf] EntityGraphVisualizer initialization");
        // Check if Cytoscape is available globally (loaded via script tag)
        if (typeof cytoscape === "undefined") {
            throw new Error(
                "Cytoscape.js library is not loaded. Please ensure the script is included in the HTML.",
            );
        }
        console.log("[Perf] Cytoscape.js library detected");

        console.log(
            `[Platform] Detected: ${navigator.platform}, using Cytoscape.js default wheel sensitivity`,
        );

        // Get optimal renderer configuration (WebGL when available)
        const rendererConfig = this.getOptimalRendererConfig();

        // Initialize single Cytoscape instance with WebGL
        console.log("[EntityGraphVisualizer] Using single-instance initialization");
        console.time("[Perf] Single instance initialization");
        this.initializeSingleInstance(rendererConfig);
        console.timeEnd("[Perf] Single instance initialization");

        console.time("[Perf] Initial interaction setup");
        this.setupInteractions();
        console.timeEnd("[Perf] Initial interaction setup");
        console.timeEnd("[Perf] EntityGraphVisualizer initialization");
    }


    /**
     * Initialize simplified single-instance system for prototype mode
     */
    private initializeSingleInstance(rendererConfig: any): void {
        console.log("[Prototype] Initializing single Cytoscape instance with WebGL");
        console.log(`[Prototype] Renderer configuration: ${JSON.stringify(rendererConfig)}`);

        // Create single instance directly on the container
        this.cy = cytoscape({
            container: this.container,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "preset" }, // Use preset layout from graphology
            renderer: rendererConfig,
            minZoom: 0.1,
            maxZoom: 5.0,
            wheelSensitivity: 0.15,
            zoomingEnabled: true,
            userZoomingEnabled: true,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        console.log("[Prototype] Single instance created successfully");
    }


    /**
     * Switch to global view instance
     */
    public switchToGlobalView(): void {
        console.log("[TripleInstance] Switching to global view");

        console.log(
            "[DEBUG-SWITCH] Back navigation state:",
            JSON.stringify({
                zoomHandlersSetup: this.zoomHandlersSetup,
                currentActiveView: this.currentActiveView,
                cyBeforeSwitch: this.cy?.container()?.id || "none",
                globalInstanceExists: !!this.globalInstance,
                globalInstanceContainer: !!this.globalInstance?.container(),
                globalInstanceReady:
                    this.globalInstance?._private?.cy !== undefined,
            }),
        );

        // Update active references
        this.cy = this.globalInstance;
        this.currentActiveView = "global";
        this.viewMode = "global";

        console.log(
            "[DEBUG-SWITCH] After switch state:",
            JSON.stringify({
                cyIsGlobalInstance: this.cy === this.globalInstance,
                currentActiveView: this.currentActiveView,
                viewMode: this.viewMode,
            }),
        );

        // STEP 2: Log global view node positions after transition back
        setTimeout(() => {
            this.logGlobalNodePositions("AFTER_TRANSITION", []);
        }, 100); // Delay to ensure view is fully switched

        // Clear neighborhood state when transitioning to global
        this.clearNeighborhoodState();

        // Notify UI of instance change
        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Clear neighborhood state to prevent cached data from affecting new neighborhood loads
     * @param clearCache - If true, also clears the neighborhood data cache to force fresh data fetching
     */
    private clearNeighborhoodState(clearCache: boolean = false): void {
        console.log(
            "[StateClearing] Clearing neighborhood state for fresh transitions",
        );

        // Clear anchor nodes tracking
        if (this.currentAnchorNodes) {
            console.log(
                `[StateClearing] Clearing ${this.currentAnchorNodes.size} anchor nodes`,
            );
            this.currentAnchorNodes.clear();
        }

        // Clear anchor position tracking data
        if (this.anchorNodeData && this.anchorNodeData.size > 0) {
            console.log(
                `[StateClearing] Clearing ${this.anchorNodeData.size} anchor position tracking entries`,
            );
            this.anchorNodeData.clear();
        }

        console.log("[StateClearing] State cleared successfully");
    }

    /**
     * Force clear all neighborhood state including cache (for debugging or fixing cached state issues)
     */
    public forceResetNeighborhoodState(): void {
        console.log(
            "[StateClearing] Force clearing all neighborhood state including cache",
        );
        this.clearNeighborhoodState(true);
    }



    /**
     * Check if triple-instance system is available and can handle fast navigation
     */
    public canUseFastNavigation(): boolean {
        const instancesExist = this.globalInstance !== null;
        const globalHasData =
            instancesExist && this.globalInstance.elements().length > 0;
        console.log(
            `[TripleInstance] Global instance exists: ${instancesExist}, Global has data: ${globalHasData}`,
        );
        return instancesExist && globalHasData;
    }

    /**
     * Fast switch to global view (triple-instance approach)
     */
    public fastSwitchToGlobal(): void {
        if (this.canUseFastNavigation()) {
            this.switchToGlobalView();
        }
    }


    /**
     * Get the current active view for UI integration
     */
    public getCurrentActiveView(): "global" {
        return this.currentActiveView;
    }

    /**
     * Set callback for when instance changes (for UI updates)
     */
    public setInstanceChangeCallback(callback: () => void): void {
        this.onInstanceChangeCallback = callback;
    }

    /**
     * Find the most central/important node in current viewport for testing
     */
    public findCentralNodeInViewport(): any {
        // Make sure we're checking the global instance when in global view
        const activeInstance =
            this.currentActiveView === "global" ? this.globalInstance : this.cy;

        if (!activeInstance) {
            console.warn("[Testing] No active instance available");
            return null;
        }

        // Get all nodes in the global instance (not filtered by viewport for testing)
        const allNodes = activeInstance.nodes();
        console.log(
            `[Testing] Found ${allNodes.length} total nodes in ${this.currentActiveView} view`,
        );

        if (allNodes.length === 0) {
            console.warn("[Testing] No nodes in current instance");
            return null;
        }

        // For testing, just find the most important node overall, not just in viewport
        // This ensures we always find a node for neighborhood testing
        const mostImportantNode = allNodes.reduce((best: any, node: any) => {
            const nodeImportance =
                node.data("importance") || node.data("computedImportance") || 0;
            const currentBest = best
                ? best.data("importance") ||
                  best.data("computedImportance") ||
                  0
                : -1;
            return nodeImportance > currentBest ? node : best;
        }, null);

        if (mostImportantNode) {
            const nodeName =
                mostImportantNode.data("name") || mostImportantNode.data("id");
            const importance =
                mostImportantNode.data("importance") ||
                mostImportantNode.data("computedImportance") ||
                0;
            console.log(
                `[Testing] Selected node: ${nodeName} (importance: ${importance})`,
            );
        }

        return mostImportantNode;
    }

    /**
     * Get current view mode
     */
    public getViewMode(): ViewMode {
        return this.viewMode;
    }

    /**
     * Set view mode for transition management
     */
    public setViewMode(mode: ViewMode): void {
        console.log(
            `[Visualizer] View mode changing from ${this.viewMode} to ${mode}`,
        );
        this.viewMode = mode;
    }

    /**
     * Reset visualizer to clean state
     */
    public resetToCleanState(): void {
        // Cancel any pending operations
        if (this.zoomTimer) {
            clearTimeout(this.zoomTimer);
            this.zoomTimer = null;
        }
        if (this.layoutUpdateTimer) {
            clearTimeout(this.layoutUpdateTimer);
            this.layoutUpdateTimer = null;
        }

        // Reset state flags
        this.isNodeBeingDragged = false;

        // Clear cached data
        this.layoutCache.clear();
        this.selectedNodes.clear();

        // Reset investigation tracking
        this.zoomEventCount = 0;
        this.eventSequence = [];
    }

    /**
     * Get investigation data for analysis
     */
    public getInvestigationData(): {
        zoomEventCount: number;
        eventSequence: Array<{
            event: string;
            time: number;
            zoom: number;
            details?: any;
        }>;
        summary: any;
    } {
        const events = this.eventSequence;
        const zoomEvents = events.filter((e) => e.event === "zoom");

        return {
            zoomEventCount: this.zoomEventCount,
            eventSequence: events,
            summary: {
                totalEvents: events.length,
                zoomEvents: zoomEvents.length,
                firstEventTime: events.length > 0 ? events[0].time : null,
                lastEventTime:
                    events.length > 0 ? events[events.length - 1].time : null,
                timeSpanMs:
                    events.length > 1
                        ? events[events.length - 1].time - events[0].time
                        : 0,
                eventsInFirstSecond: events.filter(
                    (e) => e.time <= (events[0]?.time || 0) + 1000,
                ).length,
                eventTypes: [...new Set(events.map((e) => e.event))],
                zoomRange: {
                    min: Math.min(...events.map((e) => e.zoom)),
                    max: Math.max(...events.map((e) => e.zoom)),
                    final:
                        events.length > 0
                            ? events[events.length - 1].zoom
                            : null,
                },
            },
        };
    }



    /**
     * Normalize wheel delta values for cross-platform consistency
     */
    private normalizeWheelDelta(deltaY: number): number {
        // Handle extreme delta values from different platforms
        const MAX_DELTA = 10; // Reasonable maximum delta
        const MIN_DELTA = -10; // Reasonable minimum delta

        // Linux systems often report ±120, normalize to ±3
        if (Math.abs(deltaY) > 100) {
            const normalizedDelta =
                Math.sign(deltaY) * Math.min(3, Math.abs(deltaY) / 40);
            console.log(
                `[Zoom] Normalized extreme delta: ${deltaY} → ${normalizedDelta}`,
            );
            return normalizedDelta;
        }

        // Clamp to reasonable range for other platforms
        return Math.max(MIN_DELTA, Math.min(MAX_DELTA, deltaY));
    }

    /**
     * Get optimized styles for better performance
     */
    protected getOptimizedStyles(): any[] {
        // Use base styles but with performance optimizations
        const baseStyles = this.getDefaultStyles();

        // Add performance-optimized base node/edge styles
        const performanceStyles = [
            {
                selector: "node",
                style: {
                    "min-zoomed-font-size": 8, // Hide labels when too small
                    "text-opacity": 0, // Start with labels hidden
                    "transition-property": "none", // No animations
                    "transition-duration": 0,
                    // Use data-driven sizing based on computed importance
                    // This allows Cytoscape to scale nodes naturally with zoom
                    width: "mapData(computedImportance, 0, 1, 20, 40)",
                    height: "mapData(computedImportance, 0, 1, 20, 40)",
                },
            },
            {
                selector: "edge",
                style: {
                    "curve-style": "haystack", // Fastest edge rendering
                    "haystack-radius": 0.5,
                    width: 1,
                    opacity: 0.6,
                    "target-arrow-shape": "none", // Remove arrows for performance
                    "transition-property": "none",
                    "transition-duration": 0,
                },
            },
            {
                selector: "node[?important]", // Only show labels for important nodes
                style: {
                    "text-opacity": 1,
                },
            },
        ];

        // Merge with base styles, performance styles take precedence
        return [...performanceStyles, ...baseStyles];
    }

    /**
     * Get default styles for the graph
     */
    protected getDefaultStyles(): any[] {
        return [
            // Node styles by type
            {
                selector: 'node[type="person"]',
                style: {
                    "background-color": "#4A90E2",
                    shape: "ellipse",
                    width: 60,
                    height: 60,
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": 12,
                    "font-weight": "bold",
                    color: "#333",
                },
            },
            {
                selector: 'node[type="organization"]',
                style: {
                    "background-color": "#7ED321",
                    shape: "rectangle",
                    width: 80,
                    height: 50,
                    label: "data(name)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "font-size": 12,
                    "font-weight": "bold",
                    color: "#333",
                },
            },
            {
                selector: 'node[type="product"]',
                style: {
                    "background-color": "#BD10E0",
                    shape: "roundrectangle",
                    width: 70,
                    height: 40,
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": 11,
                    "font-weight": "bold",
                    color: "#333",
                },
            },
            {
                selector: 'node[type="concept"]',
                style: {
                    "background-color": "#F5A623",
                    shape: "diamond",
                    width: 50,
                    height: 50,
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": 11,
                    "font-weight": "bold",
                    color: "#333",
                },
            },
            {
                selector: 'node[type="document"]',
                style: {
                    "background-color": "#50E3C2",
                    shape: "rectangle",
                    width: 90,
                    height: 60,
                    label: "data(name)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "font-size": 10,
                    "font-weight": "bold",
                    color: "#333",
                    "text-wrap": "wrap",
                    "text-max-width": 80,
                },
            },
            {
                selector: 'node[type="website"]',
                style: {
                    "background-color": "#4ECDC4",
                    shape: "roundrectangle",
                    width: 85,
                    height: 55,
                    label: "data(name)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "font-size": 10,
                    "font-weight": "bold",
                    color: "#333",
                    "text-wrap": "wrap",
                    "text-max-width": 75,
                },
            },
            {
                selector: 'node[type="technology"]',
                style: {
                    "background-color": "#9013FE",
                    shape: "hexagon",
                    width: 55,
                    height: 55,
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": 11,
                    "font-weight": "bold",
                    color: "#333",
                },
            },
            {
                selector: 'node[type="topic"]',
                style: {
                    "background-color": "#FF6B9D",
                    shape: "ellipse",
                    width: 45,
                    height: 45,
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": 10,
                    "font-weight": "bold",
                    color: "#333",
                },
            },

            // Edge styles by relationship type
            {
                selector: 'edge[type="contains"]',
                style: {
                    "line-color": "#4A90E2",
                    width: "mapData(strength, 0, 1, 2, 5)",
                    "line-opacity": 1.0,
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                },
            },
            {
                selector: 'edge[type="related_to"]',
                style: {
                    "line-color": "#7ED321",
                    width: "mapData(strength, 0, 1, 2, 4)",
                    "line-opacity": 0.6,
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                },
            },
            {
                selector: 'edge[type="same_domain"]',
                style: {
                    "line-color": "#BD10E0",
                    width: "mapData(strength, 0, 1, 1, 3)",
                    "line-opacity": 0.4,
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                },
            },
            {
                selector: 'edge[type="co_occurrence"]',
                style: {
                    "line-color": "#F5A623",
                    width: "mapData(strength, 0, 1, 2, 4)",
                    "line-opacity": 0.7,
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                },
            },
            {
                selector: 'edge[type="topic_of"]',
                style: {
                    "line-color": "#FF6B9D",
                    width: "mapData(strength, 0, 1, 1, 3)",
                    "line-opacity": 0.5,
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                },
            },
            // Fallback edge styles by strength (fixed selectors)
            {
                selector: "edge[strength >= 0.7]",
                style: {
                    "line-color": "#4A90E2",
                    width: 3,
                    "line-opacity": 1,
                    "curve-style": "haystack",
                },
            },
            {
                selector: "edge[strength >= 0.3]",
                style: {
                    "line-color": "#667eea",
                    width: 2,
                    "line-opacity": 0.8,
                    "curve-style": "haystack",
                },
            },
            {
                selector: "edge[strength < 0.3]",
                style: {
                    "line-color": "#999",
                    width: 1,
                    "line-style": "solid",
                    "line-opacity": 0.6,
                    "curve-style": "haystack",
                },
            },

            // Selected elements
            {
                selector: ":selected",
                style: {
                    "border-color": "#FF6B35",
                    "border-width": 3,
                    "border-opacity": 1,
                },
            },

            // Highlighted elements
            {
                selector: ".highlighted",
                style: {
                    opacity: 1,
                    "z-index": 15,
                },
            },

            // Override type-specific colors with community colors when available
            // This selector has higher priority by being placed after type-specific selectors
            {
                selector: "node[color]",
                style: {
                    "background-color": "data(color)",
                },
            },

            // Entity nodes (zoomed-out view with community colors)
            {
                selector: 'node[type="entity"]',
                style: {
                    "background-color": "data(color)",
                    shape: "ellipse",
                    width: "data(size)",
                    height: "data(size)",
                    label: "data(name)",
                    "text-valign": "bottom",
                    "text-margin-y": 3,
                    "font-size": "8px",
                    "font-weight": "normal",
                    color: "#333",
                    "text-background-color": "rgba(255, 255, 255, 0.8)",
                    "text-background-opacity": 0.7,
                    "text-background-padding": "2px",
                    "border-width": 1,
                    "border-color": "#666",
                    "z-index": 10,
                },
            },
            // Hub nodes (high importance)
            {
                selector: "node[importance > 0.7]",
                style: {
                    "border-width": 3,
                    "border-color": "#333",
                    "font-weight": "bold",
                    "font-size": "10px",
                    "z-index": 20,
                },
            },
            // Very important nodes
            {
                selector: "node[importance > 0.9]",
                style: {
                    "border-width": 4,
                    "border-color": "#000",
                    "font-weight": "bold",
                    "font-size": "12px",
                    "z-index": 30,
                },
            },

            // Dimmed elements
            {
                selector: ".dimmed",
                style: {
                    opacity: 0.3,
                    "z-index": 5,
                },
            },
        ];
    }

    /**
     * Set up interaction handlers
     */
    private setupInteractions(): void {
        if (!this.cy) return;

        this.setupNodeInteractions();
        this.setupEdgeInteractions();
        this.setupSelectionInteractions();
        this.setupContextMenus();
        this.setupKeyboardShortcuts();
        this.setupGestureHandling();
        this.setupContainerInteractions(); // Add container-level interactions
    }

    private setupNodeInteractions(): void {
        if (!this.cy) return;
        this.setupNodeInteractionsForInstance(this.cy);
    }

    private setupNodeInteractionsForInstance(instance: any): void {
        // Single click
        instance.on("tap", "node", (evt: any) => {
            const node = evt.target;
            const entityData: EntityData = {
                name: node.data("name"),
                type: node.data("type"),
                confidence: node.data("confidence"),
            };

            if (this.entityClickCallback) {
                this.entityClickCallback(entityData);
            }

            this.highlightConnectedElements(node);
        });

        // Double click for detailed view
        instance.on("dblclick", "node", (evt: any) => {
            const node = evt.target;
            this.focusOnNode(node);
        });

        // Node hover with progressive disclosure
        instance.on("mouseover", "node", (evt: any) => {
            const node = evt.target;
            this.showProgressiveNodeInfo(node, evt.renderedPosition);
            this.highlightNodeNeighborhood(node, 1);
        });

        instance.on("mouseout", "node", () => {
            this.hideNodeTooltip();
            this.clearNeighborhoodHighlights();
        });

        // Node dragging with auto-layout
        instance.on("grab", "node", () => {
            this.isNodeBeingDragged = true;
        });

        instance.on("free", "node", () => {
            this.isNodeBeingDragged = false;
            this.scheduleLayoutUpdate();
        });
    }

    private setupEdgeInteractions(): void {
        if (!this.cy) return;

        // Edge click
        this.cy.on("tap", "edge", (evt: any) => {
            const edge = evt.target;
            this.highlightEdgePath(edge);
            this.showEdgeDetails(edge, evt.renderedPosition);
        });

        // Edge hover
        this.cy.on("mouseover", "edge", (evt: any) => {
            const edge = evt.target;
            this.emphasizeEdge(edge);
        });

        this.cy.on("mouseout", "edge", () => {
            this.deemphasizeAllEdges();
        });
    }

    private setupSelectionInteractions(): void {
        if (!this.cy) return;

        // Box selection mode toggle

        // Background interactions
        this.cy.on("tap", (evt: any) => {
            if (evt.target === this.cy) {
                this.clearHighlights();
                this.clearAllSelections();
            }
        });

        // Multi-selection with Ctrl/Cmd
        this.cy.on("tap", "node", (evt: any) => {
            if (evt.originalEvent.ctrlKey || evt.originalEvent.metaKey) {
                const node = evt.target;
                this.toggleNodeSelection(node);
                evt.stopPropagation();
            }
        });

        // Selection change handling
        this.cy.on("select unselect", () => {
            this.updateSelectionToolbar();
        });
    }

    private setupContextMenus(): void {
        if (!this.cy) return;

        // Right-click context menu for nodes
        this.cy.on("cxttap", "node", (evt: any) => {
            const node = evt.target;
            this.showNodeContextMenu(node, evt.renderedPosition);
            evt.preventDefault();
        });

        // Right-click context menu for edges
        this.cy.on("cxttap", "edge", (evt: any) => {
            const edge = evt.target;
            this.showEdgeContextMenu(edge, evt.renderedPosition);
            evt.preventDefault();
        });

        // Background context menu
        this.cy.on("cxttap", (evt: any) => {
            if (evt.target === this.cy) {
                this.showBackgroundContextMenu(evt.renderedPosition);
                evt.preventDefault();
            }
        });
    }

    private setupKeyboardShortcuts(): void {
        if (!this.cy) return;

        document.addEventListener("keydown", (evt: KeyboardEvent) => {
            if (this.isGraphFocused()) {
                this.handleKeyboardShortcut(evt);
            }
        });
    }

    private setupGestureHandling(): void {
        if (!this.cy) return;

        // Pinch-to-zoom for touch devices
        let initialDistance = 0;
        let isGesturing = false;

        this.cy.on("touchstart", (evt: any) => {
            if (evt.originalEvent.touches.length === 2) {
                isGesturing = true;
                const touch1 = evt.originalEvent.touches[0];
                const touch2 = evt.originalEvent.touches[1];
                initialDistance = this.getTouchDistance(touch1, touch2);
            }
        });

        this.cy.on("touchmove", (evt: any) => {
            if (isGesturing && evt.originalEvent.touches.length === 2) {
                const touch1 = evt.originalEvent.touches[0];
                const touch2 = evt.originalEvent.touches[1];
                const currentDistance = this.getTouchDistance(touch1, touch2);
                const zoomFactor = currentDistance / initialDistance;

                const currentZoom = this.cy!.zoom();
                const minZoom = this.cy!.minZoom();
                const maxZoom = this.cy!.maxZoom();
                const newZoom = Math.min(
                    Math.max(currentZoom * zoomFactor, minZoom),
                    maxZoom,
                );
                this.cy!.zoom(newZoom);
                initialDistance = currentDistance;
            }
        });

        this.cy.on("touchend", () => {
            isGesturing = false;
        });
    }


    /**
     * Load global importance layer into global instance (Triple-Instance Architecture)
     */
    public async loadGlobalGraph(graphData: any): Promise<void> {
        // Clear all neighborhood state when loading global data
        this.clearNeighborhoodState();

        // Require graphology preset layout - no fallback modes
        if (!graphData.presetLayout?.elements) {
            const errorMsg = "Graphology layout data is required but not available";
            console.error(`[EntityGraphVisualizer] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        console.log(`[EntityGraphVisualizer] Loading graph using graphology preset layout (${graphData.presetLayout.elements.length} elements)`);

        // Clear existing elements and add graphology elements directly
        this.cy.elements().remove();
        this.cy.add(graphData.presetLayout.elements);

        // Apply preset layout to use the positions from graphology without any computation
        this.cy.layout({
            name: 'preset',
            fit: true,
            padding: 50,
            animate: false
        }).run();

        // Store global data reference
        this.globalGraphData = graphData;

        console.log(`[EntityGraphVisualizer] Loaded ${graphData.presetLayout.elements.length} pre-positioned elements from server`);
    }






    /**
     * Legacy loadGlobalGraph method - updated to use new triple-instance approach
     */
    async loadGlobalGraphLegacy(globalData: any): Promise<void> {
        if (!this.cy) return;

        // Store global data
        this.globalGraphData = globalData;
        this.entityGraphData = null;
        this.currentEntity = null;

        // Switch to global view (makes it visible)
        this.switchToGlobalView();

        // Check if global instance already has data
        if (this.globalInstance.elements().length > 0) {
            return;
        }

        // Load ALL data initially - style-based LOD will handle visibility
        const allData = this.prepareAllDataWithImportance(globalData);

        // Convert to Cytoscape elements
        const elements = this.convertGlobalDataToElements(allData);

        // Add elements to global instance
        this.globalInstance.add(elements);

        // Set active instance reference BEFORE setting up interactions
        this.cy = this.globalInstance;
        this.currentActiveView = "global";

        // LoD system removed - using simple zoom-based opacity instead

        this.setupZoomInteractions();
        this.setupInteractions();

        setTimeout(() => {
            this.globalInstance.zoom(this.globalInstance.zoom() * 1.1);
        }, 2000);

        // Apply layout with cache
        await this.applyLayoutWithCache("initial");

        // Fit to view
        this.globalInstance.fit({ maxZoom: 2.0 });

        // LoD system removed - using simple zoom-based opacity instead
    }

    private async applyLayoutWithCache(cacheKey: string): Promise<void> {
        if (!this.cy) return;

        const nodeCount = this.cy.nodes().length;
        const fullCacheKey = `${cacheKey}_${nodeCount}`;

        // Check if we have cached positions
        if (this.layoutCache.has(fullCacheKey)) {
            console.time("[Perf] Apply cached layout");
            const positions = this.layoutCache.get(fullCacheKey);

            const layout = this.cy.layout({
                name: "preset",
                positions: (node: any) => positions[node.id()],
                fit: false, // Prevent layout from fighting viewport control
                animate: false, // No animation needed for preset positions
                padding: 30,
            });

            // Handle layout completion to manually fit view
            layout.one("layoutstop", () => {
                console.log(`[Layout] Cached layout applied, fitting view`);
                this.cy.fit({ maxZoom: 1.0 }); // Constrain fit zoom to normal size
            });

            layout.run();
            console.timeEnd("[Perf] Apply cached layout");
        } else {
            console.time("[Perf] Calculate new layout");
            await this.calculateAndCacheLayout(fullCacheKey);
            console.timeEnd("[Perf] Calculate new layout");
        }
    }

    private calculateAndCacheLayout(cacheKey: string): Promise<void> {
        return new Promise((resolve) => {
            if (!this.cy) {
                resolve();
                return;
            }

            const nodeCount = this.cy.nodes().length;
            const edgeCount = this.cy.edges().length;

            // Drastically reduce iterations for dense graphs
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

            const layout = this.cy.layout({
                name: "cose",
                idealEdgeLength: 80,
                nodeOverlap: 20,
                refresh: 20,
                fit: false, // Prevent layout from fighting viewport control
                animate: "end", // Animate only at end to prevent viewport conflicts
                padding: 30,
                randomize: false,
                componentSpacing: 100,
                nodeRepulsion: (node: any) =>
                    400000 * ((node.data("importance") || 0) + 0.1),
                edgeElasticity: (edge: any) =>
                    100 * (edge.data("strength") || 0.5),
                nestingFactor: 5,
                gravity: 80,
                numIter: iterations,
                initialTemp: 200,
                coolingFactor: 0.95,
                minTemp: 1.0,
                stop: () => {
                    // Cache positions after layout completes
                    this.saveLayoutToCache(cacheKey);

                    // Manually fit view after layout completion
                    console.log(`[Layout] Cose layout completed, fitting view`);
                    this.cy.fit({ maxZoom: 2.0 }); // Constrain fit zoom to prevent oscillation

                    resolve();
                },
            });

            layout.run();
        });
    }

    private saveLayoutToCache(cacheKey: string): void {
        if (!this.cy) return;

        const positions: any = {};
        this.cy.nodes().forEach((node: any) => {
            positions[node.id()] = node.position();
        });

        this.layoutCache.set(cacheKey, positions);
        console.log(
            `[Perf] Cached layout for ${Object.keys(positions).length} nodes`,
        );
    }

    private setupZoomInteractions(): void {
        // Prevent duplicate event handler setup
        if (this.zoomHandlersSetup) {
            console.log(
                "[Zoom] Zoom handlers already set up, skipping duplicate setup",
            );
            return;
        }

        console.log("[Zoom] Setting up zoom handlers for all instances");

        this.setupZoomInteractionsForInstance(this.globalInstance);

        this.zoomHandlersSetup = true;
    }

    private setupZoomInteractionsForInstance(instance: any): void {
        if (!instance) return;

        let instanceName = "unknown";
        if (instance === this.globalInstance) {
            instanceName = "global";
        }

        // Natural zoom event handling - trust Cytoscape.js defaults
        instance.on("zoom", () => {
            const zoom = instance.zoom();
            this.zoomEventCount++;

            // Only handle view transitions and LOD updates for the currently active instance
            if (instance !== this.cy) {
                return;
            }

            this.eventSequence.push({
                event: "zoom",
                time: Date.now(),
                zoom: zoom,
                details: {
                    eventNumber: this.zoomEventCount,
                    view: this.currentActiveView,
                    instance: instanceName,
                },
            });

            // Smooth 60fps LOD updates
            clearTimeout(this.zoomTimer);
            this.zoomTimer = setTimeout(async () => {
                // LoD system removed - using simple zoom-based opacity instead

                // PHASE 4: Dynamic spacing system removed - causes performance issues
                // this.updateDynamicSpacing(zoom);

                // Handle hierarchical loading based on zoom level
                // Only process if not already loading
                await this.handleHierarchicalZoomChange(zoom);
            }, 16); // ~60fps update rate
        });

        // Set up event sequence analysis for this instance
        ["pan", "viewport", "render"].forEach((eventType) => {
            instance.on(eventType, () => {
                // Only track events from the currently active instance
                if (instance !== this.cy) return;

                this.eventSequence.push({
                    event: eventType,
                    time: Date.now(),
                    zoom: instance.zoom(),
                });
            });
        });
    }

    /**
     * Handle zoom-based hierarchical transitions with protection against multiple triggers
     */
    private async handleHierarchicalZoomChange(newZoom: number): Promise<void> {
        // Neighborhood view removed - zoom-based transitions now handle global and detail views only
    }

    private setupContainerInteractions(): void {
        // Set up container-level interactions that apply to all instances

        // Track cursor position and map hover state for smart center node selection
        this.container.addEventListener("mousemove", (event) => {
            // Store cursor position relative to container, not screen
            const containerRect = this.container.getBoundingClientRect();
            this.lastCursorPosition = {
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top,
            };
            this.isCursorOverMap = true;
        });

        this.container.addEventListener("mouseleave", () => {
            this.isCursorOverMap = false;
        });

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

                // Apply smooth zoom to currently active instance
                this.cy.zoom({
                    level: newZoom,
                    renderedPosition: { x: event.offsetX, y: event.offsetY },
                });
            },
            { passive: false },
        ); // Must be non-passive to preventDefault

        // Custom wheel event handling for delta normalization
        this.container.addEventListener(
            "wheel",
            (event: WheelEvent) => {
                // Check if we should handle this event (only if it targets the cytoscape container)
                if (!this.cy || event.defaultPrevented) return;

                const originalDelta = event.deltaY;
                const normalizedDelta = this.normalizeWheelDelta(originalDelta);

                // If delta was normalized significantly, we might want to intervene
                if (Math.abs(normalizedDelta - originalDelta) > 10) {
                    console.log(
                        `[Zoom] Intercepted extreme wheel delta: ${originalDelta} → ${normalizedDelta}`,
                    );
                    // Note: For now we just log. Full intervention would require preventing default
                    // and manually applying zoom, but this might interfere with Cytoscape's handling
                }
            },
            { passive: true },
        );
    }



    /**
     * Get target visibility percentages based on zoom level
     * Progressive disclosure: fewer items visible when zoomed out
     */
    private getVisibilityPercentages(zoom: number): {
        nodeVisibilityPercentage: number;
        edgeVisibilityPercentage: number;
    } {
        let nodeVisibilityPercentage: number;
        let edgeVisibilityPercentage: number;

        if (zoom < 0.3) {
            // Very zoomed out - show top 10% of nodes, 5% of edges
            nodeVisibilityPercentage = 0.1;
            edgeVisibilityPercentage = 0.05;
        } else if (zoom < 0.6) {
            // Zoomed out - show top 30% of nodes, 20% of edges
            nodeVisibilityPercentage = 0.3;
            edgeVisibilityPercentage = 0.2;
        } else if (zoom < 1.0) {
            // Medium zoom - show top 60% of nodes, 50% of edges
            nodeVisibilityPercentage = 0.6;
            edgeVisibilityPercentage = 0.5;
        } else if (zoom < 1.5) {
            // Zoomed in - show top 85% of nodes, 80% of edges
            nodeVisibilityPercentage = 0.85;
            edgeVisibilityPercentage = 0.8;
        } else {
            // Very zoomed in - show 95% of nodes, 90% of edges
            nodeVisibilityPercentage = 0.95;
            edgeVisibilityPercentage = 0.9;
        }

        return { nodeVisibilityPercentage, edgeVisibilityPercentage };
    }



    /**
     * Prepare all data with computed importance scores for style-based LOD
     */
    private prepareAllDataWithImportance(globalData: any): any {
        const entities = globalData.entities || [];
        const relationships = globalData.relationships || [];

        // Compute importance scores for all entities
        const entitiesWithImportance = entities.map((entity: any) => ({
            ...entity,
            computedImportance: this.calculateEntityImportance(entity),
        }));

        // Limit to reasonable amount for performance (style-based LOD can handle more than data-based)
        const maxEntities = 1000; // Increased from 200 since style-based LOD is more efficient
        const maxRelationships = 5000; // Increased from 300

        const sortedEntities = entitiesWithImportance
            .sort(
                (a: any, b: any) => b.computedImportance - a.computedImportance,
            )
            .slice(0, maxEntities);

        const entityIds = new Set(sortedEntities.map((e: any) => e.id));

        // Filter relationships to those connecting loaded entities
        // Support both transformed (from/to) and original (fromEntity/toEntity) field formats
        const filteredRelationships = relationships
            .filter((r: any) => {
                const fromId = r.from || r.fromEntity;
                const toId = r.to || r.toEntity;
                return entityIds.has(fromId) && entityIds.has(toId);
            })
            .sort(
                (a: any, b: any) =>
                    (b.confidence || 0.5) - (a.confidence || 0.5),
            )
            .slice(0, maxRelationships);

        return {
            entities: sortedEntities,
            relationships: filteredRelationships,
        };
    }

    // Storage for position comparison debugging
    private globalNodePositionsBeforeTransition: Map<
        string,
        { x: number; y: number }
    > = new Map();

    /**
     * Log global view node positions and compare with previous state for debugging position shifts
     * Only logs nodes that are within the current viewport bounds
     */
    private logGlobalNodePositions(
        phase: "BEFORE_TRANSITION" | "AFTER_TRANSITION",
        viewportNodeNames: string[],
    ): void {
        if (!this.globalInstance) {
            console.log(
                `[POSITION-DEBUG] No global instance available for ${phase}`,
            );
            return;
        }

        console.log(`[POSITION-DEBUG] ============ ${phase} ============`);

        const currentPositions = new Map<string, { x: number; y: number }>();

        // Get the viewport bounds of the global instance
        const extent = this.globalInstance.extent();
        const viewport = {
            left: extent.x1,
            right: extent.x2,
            top: extent.y1,
            bottom: extent.y2,
            width: extent.x2 - extent.x1,
            height: extent.y2 - extent.y1,
        };

        console.log(
            `[POSITION-DEBUG] Global viewport bounds: (${viewport.left.toFixed(1)}, ${viewport.top.toFixed(1)}) to (${viewport.right.toFixed(1)}, ${viewport.bottom.toFixed(1)}) [${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}]`,
        );

        // Get all visible nodes and filter to only those within viewport
        const allVisibleNodes = this.globalInstance
            .nodes()
            .filter((node: any) => node.style("display") !== "none");

        const nodesInViewport = allVisibleNodes.filter((node: any) => {
            const pos = node.position();
            return (
                pos.x >= viewport.left &&
                pos.x <= viewport.right &&
                pos.y >= viewport.top &&
                pos.y <= viewport.bottom
            );
        });

        console.log(
            `[POSITION-DEBUG] Found ${nodesInViewport.length} nodes within viewport (out of ${allVisibleNodes.length} total visible nodes)`,
        );

        // Log positions of all nodes within viewport
        nodesInViewport.forEach((node: any) => {
            const name = node.data("name") || node.data("id");
            const position = node.position();
            currentPositions.set(name, { x: position.x, y: position.y });
            console.log(
                `[POSITION-DEBUG] ${name}: x=${position.x.toFixed(2)}, y=${position.y.toFixed(2)}`,
            );
        });

        if (phase === "BEFORE_TRANSITION") {
            // Store positions for later comparison
            this.globalNodePositionsBeforeTransition = new Map(
                currentPositions,
            );
            console.log(
                `[POSITION-DEBUG] Stored ${this.globalNodePositionsBeforeTransition.size} viewport node positions for comparison`,
            );
        } else if (phase === "AFTER_TRANSITION") {
            // Compare with stored positions
            this.compareViewportNodePositions(currentPositions);
        }

        console.log(
            `[POSITION-DEBUG] ========================================`,
        );
    }

    /**
     * Compare current viewport node positions with stored pre-transition positions
     */
    private compareViewportNodePositions(
        currentPositions: Map<string, { x: number; y: number }>,
    ): void {
        console.log(
            `[POSITION-COMPARE] Comparing ${currentPositions.size} current viewport nodes with ${this.globalNodePositionsBeforeTransition.size} stored viewport nodes`,
        );

        const movedNodes: {
            name: string;
            before: { x: number; y: number };
            after: { x: number; y: number };
            distance: number;
        }[] = [];
        const missingNodes: string[] = [];
        const newNodes: string[] = [];

        // Check for position changes in existing nodes
        currentPositions.forEach((currentPos, nodeName) => {
            const beforePos =
                this.globalNodePositionsBeforeTransition.get(nodeName);
            if (beforePos) {
                const deltaX = currentPos.x - beforePos.x;
                const deltaY = currentPos.y - beforePos.y;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

                if (distance > 0.1) {
                    // Threshold for significant movement
                    movedNodes.push({
                        name: nodeName,
                        before: beforePos,
                        after: currentPos,
                        distance: distance,
                    });
                }
            } else {
                newNodes.push(nodeName);
            }
        });

        // Check for nodes that disappeared
        this.globalNodePositionsBeforeTransition.forEach(
            (beforePos, nodeName) => {
                if (!currentPositions.has(nodeName)) {
                    missingNodes.push(nodeName);
                }
            },
        );

        // Log results
        console.log(`[POSITION-COMPARE] Viewport Node Summary:`);
        console.log(`  - Viewport nodes that moved: ${movedNodes.length}`);
        console.log(
            `  - Viewport nodes that disappeared from view: ${missingNodes.length}`,
        );
        console.log(`  - New viewport nodes that appeared: ${newNodes.length}`);

        if (movedNodes.length > 0) {
            console.log(
                `[POSITION-COMPARE] Moved viewport nodes (distance > 0.1px):`,
            );
            movedNodes.forEach((moved) => {
                console.log(
                    `  ${moved.name}: (${moved.before.x.toFixed(2)}, ${moved.before.y.toFixed(2)}) → (${moved.after.x.toFixed(2)}, ${moved.after.y.toFixed(2)}) [distance: ${moved.distance.toFixed(2)}px]`,
                );
            });
        }

        if (missingNodes.length > 0) {
            console.log(
                `[POSITION-COMPARE] Viewport nodes that disappeared:`,
                missingNodes.slice(0, 10),
                missingNodes.length > 10
                    ? `... and ${missingNodes.length - 10} more`
                    : "",
            );
        }

        if (newNodes.length > 0) {
            console.log(
                `[POSITION-COMPARE] New viewport nodes:`,
                newNodes.slice(0, 10),
                newNodes.length > 10
                    ? `... and ${newNodes.length - 10} more`
                    : "",
            );
        }

        if (
            movedNodes.length === 0 &&
            missingNodes.length === 0 &&
            newNodes.length === 0
        ) {
            console.log(
                `[POSITION-COMPARE] ✅ Perfect viewport preservation - all visible nodes maintained exact positions!`,
            );
        }
    }

    /**
     * Debug method: Log all nodes within the global viewport with detailed information
     * Called by the debug button in the UI
     */
    public debugLogViewportNodes(): void {
        if (!this.globalInstance) {
            console.log("[DEBUG-VIEWPORT] No global instance available");
            return;
        }

        console.log(
            "[DEBUG-VIEWPORT] ============ VIEWPORT NODES DEBUG ============",
        );

        // Get the viewport bounds of the global instance
        const extent = this.globalInstance.extent();
        const viewport = {
            left: extent.x1,
            right: extent.x2,
            top: extent.y1,
            bottom: extent.y2,
            width: extent.x2 - extent.x1,
            height: extent.y2 - extent.y1,
            zoom: this.globalInstance.zoom(),
        };

        console.log("[DEBUG-VIEWPORT] Current viewport:", {
            bounds: `(${viewport.left.toFixed(1)}, ${viewport.top.toFixed(1)}) to (${viewport.right.toFixed(1)}, ${viewport.bottom.toFixed(1)})`,
            dimensions: `${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}`,
            zoom: `${viewport.zoom.toFixed(3)}x`,
            activeView: this.currentActiveView,
        });

        // Get ALL nodes (visible and invisible) within viewport bounds
        const allNodes = this.globalInstance.nodes();
        const nodesInViewport = allNodes.filter((node: any) => {
            const pos = node.position();
            return (
                pos.x >= viewport.left &&
                pos.x <= viewport.right &&
                pos.y >= viewport.top &&
                pos.y <= viewport.bottom
            );
        });

        console.log(
            `[DEBUG-VIEWPORT] Total nodes in graph: ${allNodes.length}`,
        );
        console.log(
            `[DEBUG-VIEWPORT] Nodes within viewport bounds: ${nodesInViewport.length}`,
        );

        // Group nodes by visibility
        const visibleNodes: any[] = [];
        const hiddenNodes: any[] = [];

        nodesInViewport.forEach((node: any) => {
            const isVisible = node.style("display") !== "none";
            if (isVisible) {
                visibleNodes.push(node);
            } else {
                hiddenNodes.push(node);
            }
        });

        console.log(
            `[DEBUG-VIEWPORT] Visible nodes in viewport: ${visibleNodes.length}`,
        );
        console.log(
            `[DEBUG-VIEWPORT] Hidden nodes in viewport: ${hiddenNodes.length}`,
        );

        // Log detailed information for each node
        console.log("[DEBUG-VIEWPORT] === VISIBLE NODES ===");
        visibleNodes.forEach((node: any, index: number) => {
            const pos = node.position();
            const name = node.data("name") || node.data("id");
            const importance =
                node.data("importance") || node.data("computedImportance") || 0;
            const size = parseFloat(node.style("width")) || 0;

            console.log(
                `[DEBUG-VIEWPORT] ${index + 1}. ${name}: pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}), importance=${importance.toFixed(4)}, size=${size.toFixed(1)}px, visible=YES`,
            );
        });

        if (hiddenNodes.length > 0) {
            console.log("[DEBUG-VIEWPORT] === HIDDEN NODES ===");
            hiddenNodes.forEach((node: any, index: number) => {
                const pos = node.position();
                const name = node.data("name") || node.data("id");
                const importance =
                    node.data("importance") ||
                    node.data("computedImportance") ||
                    0;
                const size = parseFloat(node.style("width")) || 0;

                console.log(
                    `[DEBUG-VIEWPORT] ${index + 1}. ${name}: pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}), importance=${importance.toFixed(4)}, size=${size.toFixed(1)}px, visible=NO`,
                );
            });
        }

        // Summary statistics
        const importanceValues = nodesInViewport.map(
            (node: any) =>
                node.data("importance") || node.data("computedImportance") || 0,
        );
        const avgImportance =
            importanceValues.reduce((a: number, b: number) => a + b, 0) /
            importanceValues.length;
        const maxImportance = Math.max(...importanceValues);
        const minImportance = Math.min(...importanceValues);

        console.log("[DEBUG-VIEWPORT] === SUMMARY ===");
        console.log(
            `[DEBUG-VIEWPORT] Viewport bounds: ${viewport.width.toFixed(0)} x ${viewport.height.toFixed(0)} at zoom ${viewport.zoom.toFixed(3)}x`,
        );
        console.log(
            `[DEBUG-VIEWPORT] Total nodes in viewport: ${nodesInViewport.length} (${visibleNodes.length} visible, ${hiddenNodes.length} hidden)`,
        );
        console.log(
            `[DEBUG-VIEWPORT] Importance range: ${minImportance.toFixed(4)} - ${maxImportance.toFixed(4)} (avg: ${avgImportance.toFixed(4)})`,
        );
        console.log(
            `[DEBUG-VIEWPORT] Visibility ratio: ${((visibleNodes.length / nodesInViewport.length) * 100).toFixed(1)}%`,
        );
        console.log(
            "[DEBUG-VIEWPORT] ================================================",
        );
    }


    /**
     * Calculate entity importance from available metrics
     */
    private calculateEntityImportance(entity: any): number {
        const importance = entity.importance || 0;
        const degree = entity.degree || entity.degreeCount || 0;
        const centrality = entity.centralityScore || 0;
        const pagerank = entity.metrics?.pagerank || 0;

        // If we have a valid backend importance, use it
        if (importance > 0) {
            return importance;
        }

        // Calculate degree-based importance if we have degree information
        if (degree > 0) {
            // Find the maximum degree from the current dataset for normalization
            // This is a simple approach - in production, we might want to cache this
            const maxDegree = 201; // Estimated max degree based on typical graphs
            return Math.min(1.0, degree / maxDegree);
        }

        // Fall back to other signals
        const otherSignals = Math.max(centrality, pagerank);
        if (otherSignals > 0) {
            return otherSignals;
        }

        // Only use minimum for truly unknown entities
        return 0.1;
    }



    /**
     * Load full global data when transitioning from direct entity view
     */
    private loadFullGlobalData(): void {
        console.time("[Transition] Load global elements");

        // Clear current elements and load global data
        this.cy.elements().remove();

        // Load all global data and apply style-based LOD
        const allData = this.prepareAllDataWithImportance(this.globalGraphData);
        const elements = this.convertGlobalDataToElements(allData);

        this.cy.batch(() => {
            this.cy.add(elements);
        });

        // LoD system removed - using simple zoom-based opacity instead

        console.timeEnd("[Transition] Load global elements");
    }





    private calculatePercentiles(values: number[]): any {
        if (values.length === 0) return { p25: 0, p50: 0, p75: 0, p90: 0 };

        const sorted = values.sort((a, b) => a - b);
        const len = sorted.length;

        return {
            p25: sorted[Math.floor(len * 0.25)],
            p50: sorted[Math.floor(len * 0.5)],
            p75: sorted[Math.floor(len * 0.75)],
            p90: sorted[Math.floor(len * 0.9)],
        };
    }



    private getTypePriority(type: string): number {
        const priorities: { [key: string]: number } = {
            person: 3,
            organization: 3,
            product: 2,
            concept: 2,
            location: 2,
            technology: 2,
            event: 1,
            document: 1,
            website: 1,
            topic: 1,
            related_entity: 0,
        };
        return priorities[type] || 0;
    }

    private getEdgeTypeWeight(type: string): number {
        const weights: { [key: string]: number } = {
            contains: 2,
            created_by: 2,
            located_in: 2,
            works_for: 2,
            related: 1,
            mentioned: 0,
        };
        return weights[type] || 1;
    }

    private isCommunityhub(node: any, communityId: string): boolean {
        if (!this.cy) return false;

        // Simple heuristic: node is a hub if it has connections to many other nodes in the community
        const communityNodes = this.cy
            .nodes()
            .filter((n: any) => n.data("communityId") === communityId);
        const nodeConnections = node.connectedEdges().length;
        const avgConnections =
            communityNodes
                .map((n: any) => n.connectedEdges().length)
                .reduce((a: number, b: number) => a + b, 0) /
            communityNodes.length;

        return nodeConnections > avgConnections * 1.5;
    }

    private getAdaptiveZoomThresholds(
        zoom: number,
        totalElements: number,
    ): any {
        // Dynamic thresholds based on zoom level and graph density
        const densityFactor = Math.min(1, totalElements / 1000);

        if (zoom < 0.3) {
            return {
                nodeThreshold: 6 + densityFactor * 2,
                labelThreshold: 8,
                edgeThreshold: 4 + densityFactor,
            };
        } else if (zoom < 0.6) {
            return {
                nodeThreshold: 4 + densityFactor,
                labelThreshold: 6,
                edgeThreshold: 3,
            };
        } else if (zoom < 1.0) {
            return {
                nodeThreshold: 2,
                labelThreshold: 4,
                edgeThreshold: 2,
            };
        } else {
            return {
                nodeThreshold: 0,
                labelThreshold: 2,
                edgeThreshold: 1,
            };
        }
    }

    private calculateLabelSize(score: number, zoom: number): number {
        // Safety check for NaN values
        if (!isFinite(score) || !isFinite(zoom)) {
            console.warn("[LOD] Non-finite values in calculateLabelSize:", {
                score,
                zoom,
            });
            return 10; // Return safe default
        }

        const baseSize = 10;
        const scoreMultiplier = Math.min(1.5, 1 + score * 0.1);
        const zoomMultiplier = Math.min(1.3, zoom);
        const result = Math.round(baseSize * scoreMultiplier * zoomMultiplier);

        return isFinite(result) ? result : 10;
    }

    private calculateOpacity(score: number, zoom: number): number {
        // Safety check for NaN values
        if (!isFinite(score) || !isFinite(zoom)) {
            console.warn("[LOD] Non-finite values in calculateOpacity:", {
                score,
                zoom,
            });
            return 0.8; // Return safe default
        }

        const baseOpacity = 0.6;
        const scoreBonus = Math.min(0.4, score * 0.1);
        const zoomBonus = Math.min(0.2, zoom * 0.2);
        const result = Math.min(1, baseOpacity + scoreBonus + zoomBonus);

        return isFinite(result) ? result : 0.8;
    }



    private convertGlobalDataToElements(globalData: any): any[] {
        const elements: any[] = [];
        const nodeIds = new Set<string>();

        // Check if preset layout is available
        const presetLayout = globalData.presetLayout?.elements;
        const presetPositions = new Map<string, { x: number; y: number }>();

        if (presetLayout) {
            console.log(
                `[Visualizer] Using preset layout with ${presetLayout.length} positioned elements`,
            );
            for (const element of presetLayout) {
                if (element.position && element.data?.id) {
                    presetPositions.set(element.data.id, element.position);
                }
                // Also try label-based lookup
                if (element.position && element.data?.label) {
                    presetPositions.set(element.data.label, element.position);
                }
            }
        }

        console.time("[Perf] Process nodes");
        if (globalData.entities && globalData.entities.length > 0) {
            globalData.entities.forEach((entity: any) => {
                if (!nodeIds.has(entity.id)) {
                    const nodeElement: any = {
                        group: "nodes",
                        data: {
                            id: entity.id,
                            name: entity.name,
                            type: entity.type || "entity",
                            size: entity.size || 12,
                            importance:
                                entity.importance ||
                                entity.computedImportance ||
                                0,
                            degree: entity.degree || 0,
                            communityId: entity.communityId,
                            color: entity.color || "#999999",
                            borderColor: entity.borderColor || "#333333",
                        },
                    };

                    // Add preset position if available
                    const presetPos =
                        presetPositions.get(entity.id) ||
                        presetPositions.get(entity.name);
                    if (presetPos) {
                        nodeElement.position = { x: presetPos.x, y: presetPos.y };
                    }

                    elements.push(nodeElement);
                    nodeIds.add(entity.id);
                }
            });
        }
        console.timeEnd("[Perf] Process nodes");
        console.log(`[Perf] Created ${nodeIds.size} nodes`);

        console.time("[Perf] Process edges");
        if (globalData.relationships && globalData.relationships.length > 0) {
            let validRelationships = 0;
            let invalidRelationships = 0;

            // NOTE: This function is only used in triple-instance mode now.
            // In prototype mode, we use presetLayout.elements directly which are already consolidated.
            // No artificial limit when data is already filtered
            globalData.relationships.forEach((rel: any) => {
                // Support both transformed (from/to) and original (fromEntity/toEntity) field formats
                const sourceId = rel.from || rel.fromEntity;
                const targetId = rel.to || rel.toEntity;
                const relationType =
                    rel.type || rel.relationshipType || "related";

                if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                    elements.push({
                        group: "edges",
                        data: {
                            id: `${sourceId}-${targetId}`,
                            source: sourceId,
                            target: targetId,
                            type: relationType,
                            strength: rel.confidence || 0.5,
                            weight: rel.count || 1,
                        },
                    });
                    validRelationships++;
                } else {
                    invalidRelationships++;
                }
            });

            console.log(
                `[Perf] Created ${validRelationships} valid edges, skipped ${invalidRelationships} invalid`,
            );
        }
        console.timeEnd("[Perf] Process edges");

        return elements;
    }

    /**
     * Apply layout to the graph
     */
    private applyLayout(layoutName: string): void {
        if (!this.cy) return;

        // Always use preset positions from graphology - no client-side layout computation
        console.log("[EntityGraphVisualizer] Skipping layout calculation, using preset positions from graphology");
    }

    /**
     * Change the current layout
     */
    changeLayout(layoutName: string): void {
        this.currentLayout = layoutName;
        this.applyLayout(layoutName);
    }

    /**
     * Re-run the current layout algorithm
     */
    reRunLayout(): void {
        console.log(`[Layout] Re-running ${this.currentLayout} layout`);
        this.applyLayout(this.currentLayout);
    }

    /**
     * Set the graph data provider for hierarchical loading
     */
    setGraphDataProvider(provider: any): void {
        this.graphDataProvider = provider;
        console.log("[HierarchicalLoading] Graph data provider set");
    }

    

    // Store current anchor nodes for LoD calculations
    private currentAnchorNodes: Set<string> = new Set();

    private hiddenViewStack: Array<{
        view: "global";
        viewport: {
            zoom: number;
            pan: { x: number; y: number };
        };
        timestamp: number;
    }> = [];


    /**
     * Restore previously hidden view
     */
    public restoreHiddenView(): boolean {
        if (this.hiddenViewStack.length === 0) {
            console.log("[Navigation] No hidden view to restore");
            return false;
        }

        const hiddenView = this.hiddenViewStack.pop()!;
        console.log(
            `[Navigation] Restoring hidden ${hiddenView.view} view with viewport: zoom=${hiddenView.viewport.zoom.toFixed(3)}, pan=(${hiddenView.viewport.pan.x.toFixed(1)}, ${hiddenView.viewport.pan.y.toFixed(1)})`,
        );

        try {
            // Switch back to the hidden view
            if (hiddenView.view === "global") {
                this.switchToGlobalView();

                // Delay viewport restoration to ensure all LoD updates are complete
                setTimeout(() => {
                    // Force resize to recalculate container dimensions, then restore viewport
                    this.globalInstance.resize();

                    // Log current zoom before restoration
                    const currentZoom = this.globalInstance.zoom();
                    console.log(
                        `[Navigation] Global view zoom before restoration: ${currentZoom.toFixed(3)}`,
                    );

                    this.globalInstance.zoom(hiddenView.viewport.zoom);
                    this.globalInstance.pan(hiddenView.viewport.pan);

                    // Verify zoom was actually set
                    const restoredZoom = this.globalInstance.zoom();
                    console.log(
                        `[Navigation] Global view zoom after restoration: ${restoredZoom.toFixed(3)} (expected: ${hiddenView.viewport.zoom.toFixed(3)})`,
                    );
                }, 50);
            }

            console.log(
                `[Navigation] Successfully restored ${hiddenView.view} view`,
            );
            return true;
        } catch (error) {
            console.error("[Navigation] Failed to restore hidden view:", error);
            return false;
        }
    }

    /**
     * Check if there's a hidden view available for restoration
     */
    public hasHiddenView(): boolean {
        return this.hiddenViewStack.length > 0;
    }

    /**
     * Get the type of the most recent hidden view
     */
    public getHiddenViewType(): "global" | null {
        if (this.hiddenViewStack.length === 0) return null;
        return this.hiddenViewStack[this.hiddenViewStack.length - 1].view;
    }

    /**
     * Clear hidden view stack (useful for resetting navigation state)
     */
    public clearHiddenViews(): void {
        this.hiddenViewStack = [];
        console.log("[Navigation] Hidden view stack cleared");
    }




    /**
     * Highlight connected elements
     */
    private highlightConnectedElements(node: any): void {
        if (!this.cy) return;

        // Clear previous highlights
        this.clearHighlights();

        // Get connected elements
        const connected = node.neighborhood().add(node);
        const others = this.cy.elements().not(connected);

        // Apply highlights
        connected.addClass("highlighted");
        others.addClass("dimmed");
    }

    /**
     * Clear all highlights
     */
    private clearHighlights(): void {
        if (!this.cy) return;

        this.cy.elements().removeClass("highlighted dimmed");
    }

    /**
     * Hide node tooltip
     */
    private hideNodeTooltip(): void {
        const tooltip = document.getElementById("graph-tooltip");
        if (tooltip) {
            tooltip.style.display = "none";
        }
    }

    /**
     * Get or create tooltip element
     */
    private getOrCreateTooltip(): HTMLElement {
        let tooltip = document.getElementById("graph-tooltip");
        if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = "graph-tooltip";
            tooltip.className = "graph-tooltip";
            tooltip.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 12px;
                z-index: 1000;
                pointer-events: none;
                display: none;
            `;
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    /**
     * Set entity click callback
     */
    onEntityClick(callback: (entity: EntityData) => void): void {
        this.entityClickCallback = callback;
    }

    /**
     * Focus on a specific entity
     */
    focusOnEntity(entityName: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(entityName);
        if (node.length > 0) {
            this.cy.center(node);
            // Set zoom to reasonable focus level within limits
            const targetZoom = 1.5;
            const minZoom = this.cy.minZoom();
            const maxZoom = this.cy.maxZoom();
            const safeZoom = Math.min(Math.max(targetZoom, minZoom), maxZoom);
            this.cy.zoom(safeZoom);
            this.highlightConnectedElements(node);
        }
    }

    /**
     * Export graph data
     */
    exportGraph(): any {
        if (!this.cy) return null;

        // Extract only the data portions of nodes and edges to avoid circular references
        const nodes = this.cy.nodes().map((node: any) => ({
            data: node.data(),
            position: node.position(),
            classes: node.classes(),
        }));

        const edges = this.cy.edges().map((edge: any) => ({
            data: edge.data(),
            classes: edge.classes(),
        }));

        // Get pan position instead of center() which returns element
        const pan = this.cy.pan();

        return {
            nodes: nodes,
            edges: edges,
            layout: this.currentLayout,
            zoom: this.cy.zoom(),
            pan: { x: pan.x, y: pan.y },
            exportedAt: new Date().toISOString(),
            version: "1.0",
        };
    }

    /**
     * Get current layout
     */
    getCurrentLayout(): string {
        return this.currentLayout;
    }

    /**
     * Resize the graph container
     */
    resize(): void {
        if (this.cy) {
            this.cy.resize();
            // Don't call fit() here - it resets zoom when sidebar opens/closes
        }
    }

    /**
     * Zoom in the graph
     */
    zoomIn(): void {
        console.log("zoomIn() called, cy instance exists:", !!this.cy);
        if (this.cy) {
            const currentZoom = this.cy.zoom();
            const maxZoom = this.cy.maxZoom();
            const newZoom = Math.min(currentZoom * 1.25, maxZoom);
            console.log(
                "Current zoom:",
                currentZoom,
                "-> New zoom:",
                newZoom,
                "(max:",
                maxZoom,
                ")",
            );
            this.cy.zoom(newZoom);
        } else {
            console.warn("Cannot zoom in: Cytoscape instance not available");
        }
    }

    /**
     * Zoom out the graph
     */
    zoomOut(): void {
        console.log("zoomOut() called, cy instance exists:", !!this.cy);
        if (this.cy) {
            const currentZoom = this.cy.zoom();
            const minZoom = this.cy.minZoom();
            const newZoom = Math.max(currentZoom * 0.8, minZoom);
            console.log(
                "Current zoom:",
                currentZoom,
                "-> New zoom:",
                newZoom,
                "(min:",
                minZoom,
                ")",
            );
            this.cy.zoom(newZoom);
        } else {
            console.warn("Cannot zoom out: Cytoscape instance not available");
        }
    }

    /**
     * Fit graph to view
     */
    fitToView(): void {
        console.log("fitToView() called, cy instance exists:", !!this.cy);
        if (this.cy) {
            this.cy.fit({ maxZoom: 2.0 }); // Constrain user-triggered fit to prevent oscillation
            console.log("Graph fitted to view");
        } else {
            console.warn(
                "Cannot fit to view: Cytoscape instance not available",
            );
        }
    }

    /**
     * Center the graph
     */
    centerGraph(): void {
        console.log("centerGraph() called, cy instance exists:", !!this.cy);
        if (this.cy) {
            this.cy.center();
            console.log("Graph centered");
        } else {
            console.warn(
                "Cannot center graph: Cytoscape instance not available",
            );
        }
    }

    /**
     * Reset graph zoom and position
     */
    resetView(): void {
        if (this.cy) {
            this.cy.fit({ maxZoom: 2.0 }); // Constrain reset fit to prevent oscillation
            this.cy.center();
        }
    }

    /**
     * Take a screenshot of the graph
     */
    takeScreenshot(): string {
        if (this.cy) {
            return this.cy.png({
                output: "base64uri",
                bg: "white",
                full: true,
                scale: 2,
            });
        }
        return "";
    }



    // Interactive feature implementations
    private focusOnNode(node: any): void {
        if (!this.cy) return;

        this.cy.animate(
            {
                center: { eles: node },
                zoom: 2,
            },
            {
                duration: 500,
            },
        );

        this.showLabelsForEntityNeighborhood(node.data("name"), 2);
    }

    private showProgressiveNodeInfo(node: any, position: any): void {
        const data = node.data();
        const tooltip = this.getOrCreateTooltip();

        const connections = node.connectedEdges().length;
        const importance = data.importance || data.computedImportance || 0;
        const communityInfo = data.communityId
            ? `Community: ${data.communityId}`
            : "";

        // Enhanced tooltip for neighborhood view
        const centralityInfo = data.centralityScore
            ? `Centrality: ${(data.centralityScore * 100).toFixed(1)}%`
            : "";
        const degreeInfo = data.degreeCount
            ? `Degree: ${data.degreeCount}`
            : "";

        tooltip.innerHTML = `
            <div class="tooltip-header">${data.name}</div>
            <div class="tooltip-type">${data.type || "entity"}</div>
            <div class="tooltip-connections">Connections: ${connections}</div>
            ${importance > 0 ? `<div class="tooltip-importance">Importance: ${(importance * 100).toFixed(1)}%</div>` : ""}
            ${centralityInfo ? `<div class="tooltip-centrality">${centralityInfo}</div>` : ""}
            ${degreeInfo ? `<div class="tooltip-degree">${degreeInfo}</div>` : ""}
            ${communityInfo ? `<div class="tooltip-community">${communityInfo}</div>` : ""}
        `;

        tooltip.style.left = `${position.x + 10}px`;
        tooltip.style.top = `${position.y - 10}px`;
        tooltip.style.display = "block";
    }

    private highlightNodeNeighborhood(node: any, depth: number): void {
        if (!this.cy) return;

        const neighborhood = node.neighborhood().union(node);
        this.cy.elements().removeClass("highlighted neighborhood");
        neighborhood.addClass("neighborhood");
        node.addClass("highlighted");
    }

    private clearNeighborhoodHighlights(): void {
        if (!this.cy) return;
        this.cy.elements().removeClass("neighborhood");
    }

    private scheduleLayoutUpdate(): void {
        if (this.layoutUpdateTimer) {
            clearTimeout(this.layoutUpdateTimer);
        }

        this.layoutUpdateTimer = setTimeout(() => {
            if (!this.isNodeBeingDragged) {
                this.applyLayout(this.currentLayout);
            }
        }, 1000);
    }

    private highlightEdgePath(edge: any): void {
        if (!this.cy) return;

        const sourceNode = edge.source();
        const targetNode = edge.target();

        this.cy.elements().removeClass("highlighted path-highlighted");
        edge.addClass("path-highlighted");
        sourceNode.addClass("highlighted");
        targetNode.addClass("highlighted");
    }

    private showEdgeDetails(edge: any, position: any): void {
        const data = edge.data();
        const tooltip = this.getOrCreateTooltip();

        const strength = data.strength || 0;
        const type = data.type || "related";

        tooltip.innerHTML = `
            <div class="tooltip-header">${data.source} → ${data.target}</div>
            <div class="tooltip-type">Type: ${type}</div>
            <div class="tooltip-strength">Strength: ${Math.round(strength * 100)}%</div>
        `;

        tooltip.style.left = `${position.x + 10}px`;
        tooltip.style.top = `${position.y - 10}px`;
        tooltip.style.display = "block";
    }

    private emphasizeEdge(edge: any): void {
        if (!this.cy) return;
        edge.style({
            "line-color": "#FF6B35",
            width: "4px",
            "z-index": 999,
        });
    }

    private deemphasizeAllEdges(): void {
        if (!this.cy) return;
        this.cy.edges().style({
            "line-color": "",
            width: "",
            "z-index": "",
        });
    }

    private clearAllSelections(): void {
        if (!this.cy) return;
        this.cy.elements().unselect();
        this.selectedNodes.clear();
    }

    private toggleNodeSelection(node: any): void {
        const nodeId = node.id();
        if (this.selectedNodes.has(nodeId)) {
            node.unselect();
            this.selectedNodes.delete(nodeId);
        } else {
            node.select();
            this.selectedNodes.add(nodeId);
        }
    }

    private updateSelectionToolbar(): void {
        const selectedCount = this.selectedNodes.size;
        // This could emit an event or update a toolbar UI
        console.log(`Selection changed: ${selectedCount} nodes selected`);
    }

    private showNodeContextMenu(node: any, position: any): void {
        this.hideContextMenu();

        const menu = document.createElement("div");
        menu.className = "graph-context-menu";
        menu.style.cssText = `
            position: fixed;
            left: ${position.x}px;
            top: ${position.y}px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
            min-width: 150px;
        `;

        const menuItems = [
            { label: "Focus on Node", action: () => this.focusOnNode(node) },
            { label: "Hide Node", action: () => node.style("display", "none") },
            {
                label: "Expand Neighborhood",
                action: () => this.expandNodeNeighborhood(node),
            },
            {
                label: "Copy Node Name",
                action: () => navigator.clipboard.writeText(node.data("name")),
            },
        ];

        menuItems.forEach((item) => {
            const menuItem = document.createElement("div");
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener("click", () => {
                item.action();
                this.hideContextMenu();
            });
            menuItem.addEventListener("mouseover", () => {
                menuItem.style.backgroundColor = "#f0f0f0";
            });
            menuItem.addEventListener("mouseout", () => {
                menuItem.style.backgroundColor = "";
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Hide menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener(
                "click",
                this.hideContextMenu.bind(this),
                { once: true },
            );
        }, 100);
    }

    private showEdgeContextMenu(edge: any, position: any): void {
        this.hideContextMenu();

        const menu = document.createElement("div");
        menu.className = "graph-context-menu";
        menu.style.cssText = `
            position: fixed;
            left: ${position.x}px;
            top: ${position.y}px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
            min-width: 150px;
        `;

        const menuItems = [
            { label: "Hide Edge", action: () => edge.style("display", "none") },
            { label: "Trace Path", action: () => this.highlightEdgePath(edge) },
        ];

        menuItems.forEach((item) => {
            const menuItem = document.createElement("div");
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener("click", () => {
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        setTimeout(() => {
            document.addEventListener(
                "click",
                this.hideContextMenu.bind(this),
                { once: true },
            );
        }, 100);
    }

    private showBackgroundContextMenu(position: any): void {
        this.hideContextMenu();

        const menu = document.createElement("div");
        menu.className = "graph-context-menu";
        menu.style.cssText = `
            position: fixed;
            left: ${position.x}px;
            top: ${position.y}px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
            min-width: 150px;
        `;

        const menuItems = [
            { label: "Fit to View", action: () => this.fitToView() },
            {
                label: "Reset Layout",
                action: () => this.applyLayout(this.currentLayout),
            },
            { label: "Show All Nodes", action: () => this.showAllNodes() },
            { label: "Export View", action: () => this.takeScreenshot() },
        ];

        menuItems.forEach((item) => {
            const menuItem = document.createElement("div");
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener("click", () => {
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        setTimeout(() => {
            document.addEventListener(
                "click",
                this.hideContextMenu.bind(this),
                { once: true },
            );
        }, 100);
    }

    private hideContextMenu(): void {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }

    private isGraphFocused(): boolean {
        return (
            document.activeElement === this.container ||
            this.container.contains(document.activeElement)
        );
    }

    private handleKeyboardShortcut(evt: KeyboardEvent): void {
        switch (evt.key) {
            case "f":
                this.fitToView();
                evt.preventDefault();
                break;
            case "r":
                this.resetView();
                evt.preventDefault();
                break;
            case "Escape":
                this.clearHighlights();
                this.clearAllSelections();
                evt.preventDefault();
                break;
            case "a":
                if (evt.ctrlKey || evt.metaKey) {
                    this.selectAllNodes();
                    evt.preventDefault();
                }
                break;
        }
    }

    private getTouchDistance(touch1: Touch, touch2: Touch): number {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private expandNodeNeighborhood(node: any): void {
        // This would integrate with the data loading system to fetch more connected entities
        console.log(`Expanding neighborhood for node: ${node.data("name")}`);
    }

    private showAllNodes(): void {
        if (!this.cy) return;
        this.cy.nodes().style("display", "element");
    }

    private selectAllNodes(): void {
        if (!this.cy) return;
        this.cy.nodes().select();
        this.selectedNodes.clear();
        this.cy.nodes().forEach((node: any) => {
            this.selectedNodes.add(node.id());
        });
    }


    /**
     * Show labels for entity and its neighborhood within specified degrees
     */
    private showLabelsForEntityNeighborhood(
        entityName: string,
        maxDegree: number,
    ): void {
        if (!this.cy) return;

        const centerNode = this.cy.getElementById(entityName);
        if (centerNode.length === 0) {
            console.warn(
                `Entity "${entityName}" not found for label enhancement`,
            );
            return;
        }

        // First clear all labels to ensure clean state
        this.cy.nodes().style("text-opacity", 0);

        // Show label for center node with special styling
        centerNode.style({
            "text-opacity": 1,
            "font-weight": "bold",
            "font-size": "14px",
            color: "#000",
            "text-background-color": "#ffff99",
            "text-background-opacity": 0.8,
            "text-background-padding": "3px",
        });

        // Find and label nodes within the specified degree range
        const labeledNodes = new Set<string>();
        labeledNodes.add(entityName);

        for (let degree = 1; degree <= maxDegree; degree++) {
            // Get nodes at current degree
            const nodesAtDegree = centerNode
                .neighborhood()
                .nodes()
                .filter((node: any) => {
                    // Simple BFS-style degree calculation
                    const distance =
                        centerNode.edgesWith(node).length > 0
                            ? 1
                            : centerNode
                                    .neighborhood()
                                    .nodes()
                                    .some(
                                        (neighbor: any) =>
                                            neighbor.edgesWith(node).length > 0,
                                    )
                              ? 2
                              : 999;
                    return distance === degree;
                });

            // Style nodes at this degree
            nodesAtDegree.forEach((node: any) => {
                const nodeId = node.id();
                if (!labeledNodes.has(nodeId)) {
                    labeledNodes.add(nodeId);

                    // Different styling based on degree
                    if (degree === 1) {
                        // First degree neighbors - prominent labels
                        node.style({
                            "text-opacity": 1,
                            "font-weight": "bold",
                            "font-size": "12px",
                            color: "#333",
                            "text-background-color": "#e6f3ff",
                            "text-background-opacity": 0.7,
                            "text-background-padding": "2px",
                        });
                    } else if (degree === 2) {
                        // Second degree neighbors - subtle labels
                        node.style({
                            "text-opacity": 1,
                            "font-weight": "normal",
                            "font-size": "10px",
                            color: "#666",
                            "text-background-color": "#f0f0f0",
                            "text-background-opacity": 0.5,
                            "text-background-padding": "1px",
                        });
                    }
                }
            });
        }
    }

    /**
     * Destroy the visualizer
     */
    destroy(): void {
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }

        // Remove tooltip
        const tooltip = document.getElementById("graph-tooltip");
        if (tooltip) {
            tooltip.remove();
        }
    }



    // Anchor node position tracking for global->neighborhood transitions
    private anchorNodeData: Map<
        string,
        {
            globalPosition: any;
            globalViewport: any;
            neighborhoodPosition?: any;
            neighborhoodViewport?: any;
        }
    > = new Map();


    /**
     * Calculate distance from a point to the viewport boundary
     */
    private calculateDistanceToViewport(position: any, viewport: any): number {
        const dx = Math.max(
            viewport.x1 - position.x,
            0,
            position.x - viewport.x2,
        );
        const dy = Math.max(
            viewport.y1 - position.y,
            0,
            position.y - viewport.y2,
        );
        return Math.sqrt(dx * dx + dy * dy);
    }



    /**
     * Calculate the center point of anchor nodes
     */
    private calculateAnchorCenter(anchorNodes: any[]): {
        x: number;
        y: number;
    } {
        if (anchorNodes.length === 0) {
            return { x: 0, y: 0 };
        }

        const positions = anchorNodes.map((node) => node.position());
        return {
            x:
                positions.reduce((sum, pos) => sum + pos.x, 0) /
                positions.length,
            y:
                positions.reduce((sum, pos) => sum + pos.y, 0) /
                positions.length,
        };
    }
}
