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

    // Triple-instance approach: separate persistent instances for global, neighborhood, and detail views
    private globalInstance: any = null;
    private neighborhoodInstance: any = null;
    private detailInstance: any = null;
    private currentActiveView: "global" | "neighborhood" | "detail" = "global";
    private onInstanceChangeCallback?: () => void;
    private zoomHandlersSetup: boolean = false;

    private layoutCache: Map<string, any> = new Map();
    private zoomTimer: any = null;
    private isUpdatingLOD: boolean = false;
    private isNodeBeingDragged: boolean = false;
    private layoutUpdateTimer: any = null;
    private selectedNodes: Set<string> = new Set();
    private contextMenu: HTMLElement | null = null;

    // Cursor tracking for center node selection
    private lastCursorPosition: { x: number; y: number } | null = null;
    private isCursorOverMap: boolean = false;

    // Transition protection flags
    private isLoadingNeighborhood: boolean = false;

    // Global view state preservation
    private previousGlobalZoom: number = 1.0;  // Store zoom level when leaving global view

    // Investigation tracking
    private zoomEventCount: number = 0;
    private eventSequence: Array<{
        event: string;
        time: number;
        zoom: number;
        details?: any;
    }> = [];

    // LOD performance optimization
    private lodThresholds: Map<
        number,
        { nodeThreshold: number; edgeThreshold: number }
    > = new Map();

    // Hierarchical partitioned loading
    private currentLayer: 'global' | 'neighborhood' = 'global';
    private neighborhoodCache = new Map<string, any>();
    private lastZoomLevel = 1.0;
    private graphDataProvider: any = null;
    private zoomThresholds = {
        enterNeighborhoodMode: 2.5,  // Higher threshold - allow more global exploration
        exitNeighborhoodMode: 0.8,   // Zoom out below 0.8x returns to global
        neighborhoodSwitch: 1.2      // TESTING: Lower pan threshold for smaller graphs
    };

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
     * Get CoSE layout configuration
     */
    private getOptimalLayoutConfig(): any {
        // Use actual current graph size, not global data size
        const nodeCount = this.cy?.nodes().length || 0;

        // Use original CoSE layout configuration
        const coseConfig = {
            name: "cose",
            idealEdgeLength: 100,
            nodeOverlap: 20,
            refresh: 20,
            fit: false,
            animate: "end",
            padding: 30,
            randomize: false,
            componentSpacing: 100,
            nodeRepulsion: 400000,
            edgeElasticity: 100,
            nestingFactor: 5,
            gravity: 80,
            numIter: 1000,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.0,
        };

        console.log(`[CoSE] Layout configured for ${nodeCount} nodes`);
        return coseConfig;
    }

    /**
     * Initialize the visualizer
     */
    async initialize(): Promise<void> {
        // Check if Cytoscape is available globally (loaded via script tag)
        if (typeof cytoscape === "undefined") {
            throw new Error(
                "Cytoscape.js library is not loaded. Please ensure the script is included in the HTML.",
            );
        }

        console.log(
            `[Platform] Detected: ${navigator.platform}, using Cytoscape.js default wheel sensitivity`,
        );

        // Get optimal renderer configuration (WebGL when available)
        const rendererConfig = this.getOptimalRendererConfig();

        // Initialize dual instances - global and detail
        this.initializeTripleInstances(rendererConfig);

        // Set the active instance to global initially
        this.cy = this.globalInstance;
        this.currentActiveView = "global";

        this.setupInteractions();
    }

    /**
     * Initialize the triple-instance system (global, neighborhood, and detail)
     */
    private initializeTripleInstances(rendererConfig: any): void {
        console.log("[TripleInstance] Initializing global, neighborhood, and detail instances");

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

        // Create detail instance container
        const detailContainer = document.createElement("div");
        detailContainer.style.width = "100%";
        detailContainer.style.height = "100%";
        detailContainer.style.position = "absolute";
        detailContainer.style.top = "0";
        detailContainer.style.left = "0";
        detailContainer.style.visibility = "hidden";
        this.container.appendChild(detailContainer);

        // Initialize global instance
        this.globalInstance = cytoscape({
            container: globalContainer,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "grid" },
            renderer: rendererConfig,
            minZoom: 0.25,
            maxZoom: 4.0,
            zoomingEnabled: true,
            userZoomingEnabled: false,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        // Initialize neighborhood instance
        this.neighborhoodInstance = cytoscape({
            container: neighborhoodContainer,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "grid" },
            renderer: rendererConfig,
            minZoom: 0.25,
            maxZoom: 4.0,
            zoomingEnabled: true,
            userZoomingEnabled: false,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        // Initialize detail instance
        this.detailInstance = cytoscape({
            container: detailContainer,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "grid" },
            renderer: rendererConfig,
            minZoom: 0.25,
            maxZoom: 4.0,
            zoomingEnabled: true,
            userZoomingEnabled: false,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        // Setup interactions for all instances
        this.setupInteractions(); // Use existing method for global instance (this.cy will be set to global)

        console.log("[TripleInstance] All three instances initialized successfully");
    }

    /**
     * Helper to manage instance visibility
     */
    private setInstanceVisibility(activeView: "global" | "neighborhood" | "detail"): void {
        const containers = {
            global: this.globalInstance.container(),
            neighborhood: this.neighborhoodInstance.container(),
            detail: this.detailInstance.container()
        };

        // Hide all containers
        Object.values(containers).forEach(container => {
            if (container) container.style.visibility = "hidden";
        });

        // Show active container
        if (containers[activeView]) {
            containers[activeView].style.visibility = "visible";
        }
    }

    /**
     * Switch to global view instance
     */
    public switchToGlobalView(): void {
        console.log("[TripleInstance] Switching to global view");

        console.log("[DEBUG-SWITCH] Back navigation state:", JSON.stringify({
            zoomHandlersSetup: this.zoomHandlersSetup,
            currentActiveView: this.currentActiveView,
            cyBeforeSwitch: this.cy?.container()?.id || 'none',
            globalInstanceExists: !!this.globalInstance,
            globalInstanceContainer: !!this.globalInstance?.container(),
            globalInstanceReady: this.globalInstance?._private?.cy !== undefined
        }));

        // Hide other instances and show global
        this.setInstanceVisibility("global");

        // Update active references
        this.cy = this.globalInstance;
        this.currentActiveView = "global";
        this.viewMode = "global";
        this.currentLayer = 'global';  // Update layer state

        console.log("[DEBUG-SWITCH] After switch state:", JSON.stringify({
            cyIsGlobalInstance: this.cy === this.globalInstance,
            currentActiveView: this.currentActiveView,
            viewMode: this.viewMode
        }));

        // Notify UI of instance change
        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Switch to neighborhood view instance
     */
    public switchToNeighborhoodView(): void {
        console.log("[TripleInstance] Switching to neighborhood view");

        // Hide other instances and show neighborhood
        this.setInstanceVisibility("neighborhood");

        // Update active references
        this.cy = this.neighborhoodInstance;
        this.currentActiveView = "neighborhood";
        this.viewMode = "global";  // Still global mode, but neighborhood layer
        this.currentLayer = 'neighborhood';

        // Apply neighborhood-specific LoD to ensure labels are visible
        const currentZoom = this.neighborhoodInstance.zoom();
        console.log(`[TripleInstance] Applying neighborhood LoD at zoom ${currentZoom.toFixed(3)}`);
        this.updateNeighborhoodViewStyles(currentZoom);

        // Notify UI of instance change
        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Switch to detail view instance
     */
    public switchToDetailView(): void {
        console.log("[TripleInstance] Switching to detail view");

        // Hide other instances and show detail
        this.setInstanceVisibility("detail");

        // Update active references
        this.cy = this.detailInstance;
        this.currentActiveView = "detail";
        this.viewMode = "entity-detail";

        // Notify UI of instance change
        if (this.onInstanceChangeCallback) {
            this.onInstanceChangeCallback();
        }
    }

    /**
     * Check if triple-instance system is available and can handle fast navigation
     */
    public canUseFastNavigation(): boolean {
        const instancesExist =
            this.globalInstance !== null &&
            this.neighborhoodInstance !== null &&
            this.detailInstance !== null;
        const globalHasData =
            instancesExist && this.globalInstance.elements().length > 0;
        console.log(
            `[TripleInstance] Instances exist: ${instancesExist}, Global has data: ${globalHasData}`,
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
     * Fast switch to neighborhood view
     */
    public fastSwitchToNeighborhood(): void {
        if (this.canUseFastNavigation() && this.neighborhoodInstance.elements().length > 0) {
            this.switchToNeighborhoodView();
        }
    }

    /**
     * Fast switch to detail view
     */
    public fastSwitchToDetail(): void {
        if (this.canUseFastNavigation()) {
            this.switchToDetailView();
        }
    }

    /**
     * Get the current active view for UI integration
     */
    public getCurrentActiveView(): "global" | "neighborhood" | "detail" {
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
        const activeInstance = this.currentActiveView === "global" ? this.globalInstance : this.cy;

        if (!activeInstance) {
            console.warn("[Testing] No active instance available");
            return null;
        }

        // Get all nodes in the global instance (not filtered by viewport for testing)
        const allNodes = activeInstance.nodes();
        console.log(`[Testing] Found ${allNodes.length} total nodes in ${this.currentActiveView} view`);

        if (allNodes.length === 0) {
            console.warn("[Testing] No nodes in current instance");
            return null;
        }

        // For testing, just find the most important node overall, not just in viewport
        // This ensures we always find a node for neighborhood testing
        const mostImportantNode = allNodes.reduce((best: any, node: any) => {
            const nodeImportance = node.data('importance') || node.data('computedImportance') || 0;
            const currentBest = best ? (best.data('importance') || best.data('computedImportance') || 0) : -1;
            return nodeImportance > currentBest ? node : best;
        }, null);

        if (mostImportantNode) {
            const nodeName = mostImportantNode.data('name') || mostImportantNode.data('id');
            const importance = mostImportantNode.data('importance') || mostImportantNode.data('computedImportance') || 0;
            console.log(`[Testing] Selected node: ${nodeName} (importance: ${importance})`);
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
        this.isUpdatingLOD = false;
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
     * Pre-compute LOD thresholds to avoid calculation during zoom events
     */
    private precomputeLODThresholds(): void {
        // Don't require this.cy to be set - we can precompute thresholds independently
        const zoomLevels = [0.1, 0.3, 0.6, 1.0, 1.5, 3.0, 6.0, 10.0];
        this.lodThresholds.clear();

        zoomLevels.forEach((zoom) => {
            const thresholds = this.calculateDynamicThresholds(zoom);
            this.lodThresholds.set(zoom, thresholds);
        });

        console.log(
            `[Performance] Pre-computed LOD thresholds for ${zoomLevels.length} zoom levels`,
        );
    }

    /**
     * Fast threshold lookup during zoom events
     */
    private getFastLODThresholds(zoom: number): {
        nodeThreshold: number;
        edgeThreshold: number;
    } {
        // Find closest pre-computed zoom level
        const zoomLevels = Array.from(this.lodThresholds.keys()).sort(
            (a, b) => a - b,
        );

        // Handle empty array case
        if (zoomLevels.length === 0) {
            console.warn(`[Performance] LOD thresholds not precomputed, falling back to calculation for zoom ${zoom}`);
            return this.calculateDynamicThresholds(zoom);
        }

        const closestZoom = zoomLevels.reduce((prev, curr) =>
            Math.abs(curr - zoom) < Math.abs(prev - zoom) ? curr : prev,
        );

        const thresholds = this.lodThresholds.get(closestZoom);
        if (thresholds) {
            return thresholds;
        }

        // Fallback to calculation if not found
        console.warn(`[Performance] Precomputed threshold not found for zoom ${closestZoom}, falling back to calculation`);
        return this.calculateDynamicThresholds(zoom);
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
                    "line-opacity": 1,
                    "target-arrow-color": "#4A90E2",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "line-style": "solid",
                },
            },
            {
                selector: 'edge[type="related_to"]',
                style: {
                    "line-color": "#7ED321",
                    width: "mapData(strength, 0, 1, 2, 4)",
                    "line-opacity": 0.8,
                    "target-arrow-color": "#7ED321",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "line-style": "dashed",
                },
            },
            {
                selector: 'edge[type="same_domain"]',
                style: {
                    "line-color": "#BD10E0",
                    width: "mapData(strength, 0, 1, 1, 3)",
                    "line-opacity": 0.6,
                    "target-arrow-color": "#BD10E0",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "line-style": "dotted",
                },
            },
            {
                selector: 'edge[type="co_occurrence"]',
                style: {
                    "line-color": "#F5A623",
                    width: "mapData(strength, 0, 1, 2, 4)",
                    "line-opacity": 0.7,
                    "target-arrow-color": "#F5A623",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "line-style": "solid",
                },
            },
            {
                selector: 'edge[type="topic_of"]',
                style: {
                    "line-color": "#FF6B9D",
                    width: "mapData(strength, 0, 1, 1, 3)",
                    "line-opacity": 0.5,
                    "target-arrow-color": "#FF6B9D",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "line-style": "dashed",
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
                    "border-color": "data(borderColor)",
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
        // Setup for all instances
        [this.globalInstance, this.neighborhoodInstance, this.detailInstance].forEach(instance => {
            if (!instance) return;

            this.setupNodeInteractionsForInstance(instance);
        });
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

            // Hide current view before transitioning to detail view
            if (this.currentActiveView === "global" || this.currentActiveView === "neighborhood") {
                this.hideCurrentViewForDetailNavigation();
            }

            // Handle transition from global to detail view
            if (this.viewMode === "global") {
                this.initiateEntityDetailTransition(node, entityData);
            } else if (this.entityClickCallback) {
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
     * Load entity graph data
     */
    async loadEntityGraph(
        graphData: GraphData,
        centerEntityName?: string,
    ): Promise<void> {
        const centerEntity = centerEntityName || graphData.centerEntity || null;

        if (!centerEntity) {
            console.error("[TripleInstance] No center entity specified");
            return;
        }

        console.log(`[TripleInstance] Loading entity graph for ${centerEntity}`);

        // Store entity data
        this.currentEntity = centerEntity;
        this.entityGraphData = graphData;

        // Switch to detail view (makes it visible)
        this.switchToDetailView();

        // Clear existing elements from detail instance
        this.detailInstance.elements().remove();

        // Convert graph data to elements
        const elements = this.convertToGraphElements(graphData);

        // Add elements to detail instance
        this.detailInstance.add(elements);

        // Apply detail layout focusing on center entity
        await this.applyDetailLayoutToInstance(
            this.detailInstance,
            centerEntity,
        );

        // Setup all interactions for detail instance (including node clicks)
        console.log("[DEBUG-DETAIL] About to setup interactions for detail view");
        console.log("[DEBUG-DETAIL] Detail interaction state:", JSON.stringify({
            zoomHandlersSetup: this.zoomHandlersSetup,
            currentActiveView: this.currentActiveView,
            cyIsDetailInstance: this.cy === this.detailInstance,
            detailInstanceExists: !!this.detailInstance,
            detailInstanceContainer: !!this.detailInstance?.container()
        }));

        this.setupZoomInteractions();
        this.setupInteractions();

        console.log("[DEBUG-DETAIL] Detail interactions setup complete");

        console.log(
            `[TripleInstance] Entity detail view loaded for ${centerEntity}`,
        );
    }

    /**
     * Check if fallback transition should be used based on performance constraints
     */
    private shouldUseFallbackTransition(nodeCount: number): boolean {
        // Performance thresholds from design document
        const deviceMemory = (navigator as any).deviceMemory || 4; // GB
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);

        if (isMobile || deviceMemory < 4) {
            return nodeCount > 1000; // Conservative threshold for mobile/low-memory
        } else if (deviceMemory < 8) {
            return nodeCount > 2000; // Moderate threshold
        } else {
            return nodeCount > 5000; // High threshold for powerful devices
        }
    }

    /**
     * Create detail elements that should be added to the graph
     */
    private async createDetailElements(
        graphData: GraphData,
        centerEntity: string,
    ): Promise<any[]> {
        const newElements: any[] = [];

        try {
            // Get existing node and edge IDs to avoid duplicates
            const existingNodeIds = new Set();
            const existingEdgeIds = new Set();

            this.cy.nodes().forEach((node: any) => {
                existingNodeIds.add(node.data("id"));
                existingNodeIds.add(node.data("name"));
            });

            this.cy.edges().forEach((edge: any) => {
                existingEdgeIds.add(edge.data("id"));
            });

            // Add new entities that don't already exist
            graphData.entities.forEach((entity) => {
                const entityId = entity.name;
                if (!existingNodeIds.has(entityId)) {
                    newElements.push({
                        data: {
                            id: entityId,
                            name: entity.name,
                            type: entity.type,
                            confidence: entity.confidence || 0.5,
                        },
                        classes:
                            entity.type === "document"
                                ? "document"
                                : entity.type,
                    });
                }
            });

            // Add new relationships that don't already exist
            graphData.relationships.forEach((rel) => {
                const edgeId = `${rel.from}-${rel.to}-${rel.type}`;
                if (
                    !existingEdgeIds.has(edgeId) &&
                    (existingNodeIds.has(rel.from) ||
                        graphData.entities.some((e) => e.name === rel.from)) &&
                    (existingNodeIds.has(rel.to) ||
                        graphData.entities.some((e) => e.name === rel.to))
                ) {
                    newElements.push({
                        data: {
                            id: edgeId,
                            source: rel.from,
                            target: rel.to,
                            type: rel.type,
                            strength: rel.strength || 0.5,
                        },
                        classes: rel.type,
                    });
                }
            });

            console.log(
                `[Transition] Created ${newElements.length} new elements for detail view`,
            );
            return newElements;
        } catch (error) {
            console.error(
                "[Transition] Error creating detail elements:",
                error,
            );
            return [];
        }
    }

    /**
     * Perform standard entity graph loading (no transition)
     */
    private async performStandardEntityLoad(
        graphData: GraphData,
        centerEntity: string | null,
    ): Promise<void> {
        console.time("[Perf] Entity clear elements");
        this.cy.elements().remove();
        console.timeEnd("[Perf] Entity clear elements");

        console.time("[Perf] Entity convert to elements");
        const elements = this.convertToGraphElements(graphData);
        console.timeEnd("[Perf] Entity convert to elements");
        console.log(
            `[Perf] Entity graph: ${elements.filter((e) => e.group === "nodes").length} nodes, ${elements.filter((e) => e.group === "edges").length} edges`,
        );

        console.time("[Perf] Entity add elements");
        this.cy.add(elements);
        console.timeEnd("[Perf] Entity add elements");

        console.time("[Perf] Entity apply layout");
        this.applyLayout(this.currentLayout);
        console.timeEnd("[Perf] Entity apply layout");

        console.time("[Perf] Entity fit to view");
        this.cy.fit();
        console.timeEnd("[Perf] Entity fit to view");

        if (centerEntity) {
            this.centerOnEntityWithLabels(centerEntity);
        }
    }

    /**
     * Load global importance layer into global instance (Triple-Instance Architecture)
     */
    public async loadGlobalGraph(graphData: any): Promise<void> {
        console.log("[TripleInstance] Loading global graph");

        // Clear anchor nodes to ensure global view uses CSS-based sizing
        this.currentAnchorNodes.clear();

        // Clear and load global instance
        this.globalInstance.elements().remove();
        const elements = this.convertToGraphElements(graphData);
        this.globalInstance.add(elements);

        // Apply direct sizing based on computed importance (since CSS mapData doesn't auto-refresh)
        this.applyImportanceBasedSizing();

        // Analyze importance distribution and visual sizing
        this.analyzeGlobalViewImportanceDistribution();

        // Set active instance reference BEFORE setting up interactions
        this.cy = this.globalInstance;
        this.currentActiveView = "global";

        // Setup zoom interactions for global instance
        console.log("[DEBUG-INIT] About to setup zoom interactions on initial load");
        console.log("[DEBUG-INIT] Interaction state before setup:", JSON.stringify({
            zoomHandlersSetup: this.zoomHandlersSetup,
            currentActiveView: this.currentActiveView,
            cyIsGlobalInstance: this.cy === this.globalInstance,
            globalInstanceExists: !!this.globalInstance,
            globalInstanceContainer: !!this.globalInstance?.container(),
            globalInstanceReady: this.globalInstance?._private?.cy !== undefined
        }));

        this.setupZoomInteractions();

        console.log("[DEBUG-INIT] About to setup general interactions on initial load");
        this.setupInteractions();

        console.log("[DEBUG-INIT] Interactions setup complete on initial load");

        // Store global data reference
        this.globalGraphData = graphData;

        // Apply layout optimized for global size
        await this.applyLayoutToInstance(this.globalInstance, "cose", graphData.entities.length);

        // Fit the graph to the viewport to let Cytoscape handle optimal sizing
        this.globalInstance.fit({
            padding: 50,  // Add some padding around edges
            animate: false  // No animation for initial load
        });

        // Switch to global view
        this.switchToGlobalView();

        console.log(`[TripleInstance] Loaded ${graphData.entities.length} entities into global instance`);
    }

    /**
     * Analyze importance distribution and visual sizing in global view
     */
    private analyzeGlobalViewImportanceDistribution(): void {
        if (!this.globalInstance) return;

        const nodes = this.globalInstance.nodes();
        console.log(`[GlobalImportance] Analyzing ${nodes.length} nodes for importance distribution`);

        // Collect importance values and calculate rendered sizes
        const importanceData: Array<{
            name: string;
            importance: number;
            renderedWidth: number;
            renderedHeight: number;
            sizeCategory: string;
        }> = [];

        nodes.forEach((node: any) => {
            const importance = node.data('importance') || node.data('computedImportance') || 0;
            const name = node.data('name') || node.data('id') || 'unknown';

            // Get rendered size (after mapData calculation)
            const renderedWidth = parseFloat(node.style('width')) || 0;
            const renderedHeight = parseFloat(node.style('height')) || 0;

            // Categorize by size for analysis
            let sizeCategory = 'small';
            if (renderedWidth >= 35) sizeCategory = 'large';
            else if (renderedWidth >= 25) sizeCategory = 'medium';

            importanceData.push({
                name,
                importance,
                renderedWidth,
                renderedHeight,
                sizeCategory
            });
        });

        // Sort by importance for analysis
        importanceData.sort((a, b) => b.importance - a.importance);

        // Calculate distribution statistics
        const importanceValues = importanceData.map(d => d.importance);
        const minImportance = Math.min(...importanceValues);
        const maxImportance = Math.max(...importanceValues);
        const avgImportance = importanceValues.reduce((sum, val) => sum + val, 0) / importanceValues.length;

        // Calculate percentiles
        const getPercentile = (arr: number[], percentile: number) => {
            const index = Math.floor((percentile / 100) * (arr.length - 1));
            return arr[index] || 0;
        };

        const sortedImportance = [...importanceValues].sort((a, b) => a - b);
        const p25 = getPercentile(sortedImportance, 25);
        const p50 = getPercentile(sortedImportance, 50);
        const p75 = getPercentile(sortedImportance, 75);
        const p90 = getPercentile(sortedImportance, 90);
        const p95 = getPercentile(sortedImportance, 95);

        // Analyze size distribution
        const sizeCounts = {
            small: importanceData.filter(d => d.sizeCategory === 'small').length,
            medium: importanceData.filter(d => d.sizeCategory === 'medium').length,
            large: importanceData.filter(d => d.sizeCategory === 'large').length
        };

        const sizeStats = {
            minSize: Math.min(...importanceData.map(d => d.renderedWidth)),
            maxSize: Math.max(...importanceData.map(d => d.renderedWidth)),
            avgSize: importanceData.reduce((sum, d) => sum + d.renderedWidth, 0) / importanceData.length
        };

        // Define importance thresholds based on mapData(importance, 0, 1, 20, 40)
        const getExpectedSize = (importance: number) => 20 + (importance * 20);
        const thresholds = {
            veryHigh: 0.8,  // Should render ~36px
            high: 0.6,      // Should render ~32px
            medium: 0.4,    // Should render ~28px
            low: 0.2,       // Should render ~24px
            veryLow: 0.0    // Should render ~20px
        };

        const thresholdCounts = {
            veryHigh: importanceValues.filter(v => v >= thresholds.veryHigh).length,
            high: importanceValues.filter(v => v >= thresholds.high && v < thresholds.veryHigh).length,
            medium: importanceValues.filter(v => v >= thresholds.medium && v < thresholds.high).length,
            low: importanceValues.filter(v => v >= thresholds.low && v < thresholds.medium).length,
            veryLow: importanceValues.filter(v => v < thresholds.low).length
        };

        // Log comprehensive analysis
        console.log("[GlobalImportance] ============ IMPORTANCE DISTRIBUTION ANALYSIS ============");
        console.log("[GlobalImportance] Basic Statistics:", {
            totalNodes: nodes.length,
            importanceRange: { min: minImportance.toFixed(4), max: maxImportance.toFixed(4) },
            average: avgImportance.toFixed(4),
            percentiles: {
                p25: p25.toFixed(4),
                p50: p50.toFixed(4),
                p75: p75.toFixed(4),
                p90: p90.toFixed(4),
                p95: p95.toFixed(4)
            }
        });

        console.log("[GlobalImportance] Threshold Distribution:", {
            veryHigh: `${thresholdCounts.veryHigh} nodes (≥0.8) - ${(thresholdCounts.veryHigh/nodes.length*100).toFixed(1)}%`,
            high: `${thresholdCounts.high} nodes (0.6-0.8) - ${(thresholdCounts.high/nodes.length*100).toFixed(1)}%`,
            medium: `${thresholdCounts.medium} nodes (0.4-0.6) - ${(thresholdCounts.medium/nodes.length*100).toFixed(1)}%`,
            low: `${thresholdCounts.low} nodes (0.2-0.4) - ${(thresholdCounts.low/nodes.length*100).toFixed(1)}%`,
            veryLow: `${thresholdCounts.veryLow} nodes (<0.2) - ${(thresholdCounts.veryLow/nodes.length*100).toFixed(1)}%`
        });

        console.log("[GlobalImportance] Visual Size Analysis:", {
            sizeRange: { min: sizeStats.minSize.toFixed(1), max: sizeStats.maxSize.toFixed(1) },
            averageSize: sizeStats.avgSize.toFixed(1),
            sizeDistribution: {
                small: `${sizeCounts.small} nodes (<25px) - ${(sizeCounts.small/nodes.length*100).toFixed(1)}%`,
                medium: `${sizeCounts.medium} nodes (25-35px) - ${(sizeCounts.medium/nodes.length*100).toFixed(1)}%`,
                large: `${sizeCounts.large} nodes (≥35px) - ${(sizeCounts.large/nodes.length*100).toFixed(1)}%`
            }
        });

        // Log top 10 most important nodes
        console.log("[GlobalImportance] Top 10 Most Important Nodes:");
        importanceData.slice(0, 10).forEach((node, index) => {
            const expectedSize = getExpectedSize(node.importance);
            console.log(`  ${index + 1}. ${node.name}: importance=${node.importance.toFixed(4)}, rendered=${node.renderedWidth.toFixed(1)}px (expected=${expectedSize.toFixed(1)}px)`);
        });

        // Log bottom 10 least important nodes
        console.log("[GlobalImportance] Bottom 10 Least Important Nodes:");
        importanceData.slice(-10).forEach((node, index) => {
            const expectedSize = getExpectedSize(node.importance);
            console.log(`  ${importanceData.length - 9 + index}. ${node.name}: importance=${node.importance.toFixed(4)}, rendered=${node.renderedWidth.toFixed(1)}px (expected=${expectedSize.toFixed(1)}px)`);
        });

        // Analyze visual differentiation effectiveness
        const uniqueSizes = new Set(importanceData.map(d => Math.round(d.renderedWidth)));
        const sizeSpread = sizeStats.maxSize - sizeStats.minSize;
        const importanceSpread = maxImportance - minImportance;

        console.log("[GlobalImportance] Visual Differentiation Analysis:", {
            uniqueSizes: uniqueSizes.size,
            sizeSpread: sizeSpread.toFixed(1) + 'px',
            importanceSpread: importanceSpread.toFixed(4),
            sizesPerImportanceUnit: (sizeSpread / importanceSpread).toFixed(1) + 'px per importance unit',
            effectivenessRating: sizeSpread > 15 ? 'Good' : sizeSpread > 10 ? 'Moderate' : 'Poor'
        });

        console.log("[GlobalImportance] ========================================================");
    }

    /**
     * Load neighborhood data into neighborhood instance (Triple-Instance Architecture)
     */
    public async loadNeighborhoodGraph(neighborhoodData: any, centerEntity: string, preserveZoom: boolean = false): Promise<void> {
        console.log(`[TripleInstance] Loading neighborhood for ${centerEntity}`);

        // Preserve visual continuity by extracting positions from global view
        const globalNodePositions = this.extractGlobalNodePositions();

        // Clear and load neighborhood instance
        this.neighborhoodInstance.elements().remove();
        const elements = this.convertToGraphElements(neighborhoodData);
        this.neighborhoodInstance.add(elements);

        // Apply layout optimized for neighborhood size, preserving global positions where possible
        await this.applyLayoutWithVisualContinuity(this.neighborhoodInstance, globalNodePositions, centerEntity, neighborhoodData.entities.length);

        // Only set initial zoom when transitioning from global view, not when reloading
        if (!preserveZoom) {
            // Fit the neighborhood to the viewport, letting Cytoscape determine optimal zoom
            this.neighborhoodInstance.fit({
                padding: 30,
                animate: false
            });

            const actualZoom = this.neighborhoodInstance.zoom();
            console.log(`[TripleInstance] Fitted neighborhood to viewport, zoom: ${actualZoom.toFixed(3)} for ${neighborhoodData.entities.length} nodes`);
        } else {
            console.log(`[TripleInstance] Preserving current zoom level for neighborhood reload`);
        }

        // Switch to neighborhood view
        this.switchToNeighborhoodView();

        // Cache the neighborhood data
        this.neighborhoodCache.set(centerEntity, neighborhoodData);

        console.log(`[TripleInstance] Loaded ${neighborhoodData.entities.length} entities into neighborhood instance`);
    }

    /**
     * Load entity detail into detail instance (existing - enhanced for triple-instance)
     */
    public async loadEntityDetailGraph(entityData: any, centerEntity: string): Promise<void> {
        console.log(`[TripleInstance] Loading entity detail for ${centerEntity}`);

        // Clear and load detail instance
        this.detailInstance.elements().remove();
        const elements = this.convertToGraphElements(entityData);
        this.detailInstance.add(elements);

        // Apply layout optimized for detail size (force-directed for entity focus)
        await this.applyLayoutToInstance(this.detailInstance, "force", entityData.entities.length);

        // Fit the detail view to the viewport
        this.detailInstance.fit({
            padding: 40,
            animate: false
        });

        // Switch to detail view
        this.switchToDetailView();

        console.log(`[TripleInstance] Loaded ${entityData.entities.length} entities into detail instance`);
    }

    /**
     * Apply layout to specific instance with optimization for size
     */
    private async applyLayoutToInstance(instance: any, layoutName: string, nodeCount: number): Promise<void> {
        const layoutConfig = this.getLayoutConfigForInstance(layoutName, nodeCount);

        const layout = instance.layout(layoutConfig);

        return new Promise((resolve) => {
            layout.on('layoutstop', () => {
                console.log(`[TripleInstance] Layout ${layoutName} completed for ${nodeCount} nodes`);
                resolve();
            });
            layout.run();
        });
    }

    /**
     * Get layout configuration optimized for specific instance and node count
     */
    private getLayoutConfigForInstance(layoutName: string, nodeCount: number): any {
        if (layoutName === "cose") {
            return {
                name: "cose",
                idealEdgeLength: 100,
                nodeOverlap: 20,
                refresh: 20,
                fit: true,
                animate: "end",
                padding: 30,
                randomize: false,
                componentSpacing: 100,
                nodeRepulsion: nodeCount > 1000 ? 400000 : 200000,
                edgeElasticity: 100,
                nestingFactor: 5,
                gravity: 80,
                numIter: nodeCount > 1000 ? 1000 : Math.max(50, nodeCount),
                initialTemp: 200,
                coolingFactor: 0.95,
                minTemp: 1.0,
            };
        } else if (layoutName === "force") {
            return {
                name: "fcose",
                quality: "default",
                randomize: false,
                animate: "end",
                fit: true,
                padding: 30
            };
        }

        return { name: layoutName };
    }

    /**
     * Convert graph data to Cytoscape elements (enhanced for triple-instance)
     */
    private convertToGraphElements(graphData: any): any[] {
        console.log(`[DEBUG] Converting graph data:`, {
            entityCount: graphData.entities.length,
            relationshipCount: graphData.relationships.length,
            firstEntity: graphData.entities[0],
            firstRelationship: graphData.relationships[0]
        });

        // Debug: Check the first few entities' importance values
        console.log(`[DEBUG] First 5 entities with importance values:`);
        graphData.entities.slice(0, 5).forEach((entity: any, index: number) => {
            console.log(`  ${index + 1}. ${entity.name}: importance=${entity.importance}, degree=${entity.degree}, type=${entity.type}`);
        });

        const nodes = graphData.entities.map((entity: any) => {
            // Set appropriate importance values based on current context
            const baseImportance = entity.importance || 0;
            const minImportance = this.currentActiveView === 'neighborhood' ? 0.5 : 0;
            const effectiveImportance = Math.max(baseImportance, minImportance);

            return {
                group: 'nodes',
                data: {
                    id: entity.id || entity.name,
                    name: entity.name,
                    type: entity.type,
                    importance: effectiveImportance,
                    confidence: entity.confidence || 0.5,
                    // Ensure LOD-compatible properties are set
                    degreeCount: entity.degree || entity.degreeCount || Math.max(1, effectiveImportance * 10),
                    centralityScore: entity.centrality || entity.centralityScore || effectiveImportance,
                    computedImportance: this.calculateEntityImportance(entity),
                    ...entity.properties
                }
            };
        });

        // Create a set of valid node IDs for fast lookup
        const nodeIds = new Set(nodes.map((node: any) => node.data.id));

        // Also create a map for alternative lookups (name -> id)
        const nodeNameToId = new Map();
        nodes.forEach((node: any) => {
            const data = node.data;
            // Map various possible identifiers to the actual node ID
            if (data.name) nodeNameToId.set(data.name, data.id);
            if (data.id) nodeNameToId.set(data.id, data.id);
            // Handle domain names for website entities
            if (data.type === 'website' && data.name) {
                try {
                    const url = new URL(data.name.startsWith('http') ? data.name : `https://${data.name}`);
                    nodeNameToId.set(url.hostname, data.id);
                    nodeNameToId.set(url.hostname.replace('www.', ''), data.id);
                } catch (e) {
                    // If URL parsing fails, try the name as-is
                    nodeNameToId.set(data.name, data.id);
                }
            }
        });

        console.log(`[DEBUG] Created ${nodeIds.size} node IDs and ${nodeNameToId.size} name mappings`);

        let invalidEdgeCount = 0;
        const invalidEdgeExamples: string[] = [];

        const edges = graphData.relationships.map((rel: any) => {
            const sourceId = rel.source || rel.fromEntity || rel.from;
            const targetId = rel.target || rel.toEntity || rel.to;

            return {
                group: 'edges',
                data: {
                    id: `${sourceId}-${targetId}`,
                    source: sourceId,
                    target: targetId,
                    type: rel.type,
                    strength: rel.strength || 0.5
                }
            };
        }).map((edge: any) => {
            // Resolve source and target to actual node IDs using mappings
            const originalSource = edge.data.source;
            const originalTarget = edge.data.target;

            // Try to find actual node IDs for source and target
            const resolvedSourceId = nodeNameToId.get(originalSource) || originalSource;
            const resolvedTargetId = nodeNameToId.get(originalTarget) || originalTarget;

            return {
                ...edge,
                data: {
                    ...edge.data,
                    source: resolvedSourceId,
                    target: resolvedTargetId,
                    id: `${resolvedSourceId}-${resolvedTargetId}`
                }
            };
        }).filter((edge: any) => {
            // Validate that both source and target exist and reference valid nodes
            const hasValidIds = edge.data.source && edge.data.target;
            const nodesExist = nodeIds.has(edge.data.source) && nodeIds.has(edge.data.target);

            if (hasValidIds && !nodesExist) {
                invalidEdgeCount++;
                // Only keep first 3 examples for debugging
                if (invalidEdgeExamples.length < 3) {
                    invalidEdgeExamples.push(`${edge.data.source}-${edge.data.target}`);
                }
            }

            return hasValidIds && nodesExist;
        });

        // Log summary instead of individual warnings
        if (invalidEdgeCount > 0) {
            console.warn(`[TripleInstance] Filtered ${invalidEdgeCount} invalid edges (examples: ${invalidEdgeExamples.join(', ')}${invalidEdgeCount > 3 ? '...' : ''})`);

            // Additional debugging for edge validation issue
            console.log(`[DEBUG] Node IDs sample (first 5):`, Array.from(nodeIds).slice(0, 5));
            console.log(`[DEBUG] Edge examples with validation:`, invalidEdgeExamples.slice(0, 3).map(example => {
                const [source, target] = example.split('-');
                return {
                    edge: example,
                    sourceExists: nodeIds.has(source),
                    targetExists: nodeIds.has(target),
                    source,
                    target
                };
            }));
        }

        console.log(`[TripleInstance] Converted ${nodes.length} nodes and ${edges.length} valid edges (filtered ${invalidEdgeCount} invalid edges)`);

        return [...nodes, ...edges];
    }

    /**
     * Legacy loadGlobalGraph method - updated to use new triple-instance approach
     */
    async loadGlobalGraphLegacy(globalData: any): Promise<void> {
        if (!this.cy) return;

        console.log("[TripleInstance] Loading global graph");

        // Store global data
        this.globalGraphData = globalData;
        this.entityGraphData = null;
        this.currentEntity = null;

        // Switch to global view (makes it visible)
        this.switchToGlobalView();

        // Check if global instance already has data
        if (this.globalInstance.elements().length > 0) {
            console.log(
                "[TripleInstance] Global instance already loaded, just showing it",
            );
            return;
        }

        // Load data into global instance for the first time
        console.log(
            "[TripleInstance] First time loading - building global instance",
        );

        // Load ALL data initially - style-based LOD will handle visibility
        const allData = this.prepareAllDataWithImportance(globalData);
        console.log(
            `[TripleInstance] Loading ${allData.entities.length} entities, ${allData.relationships.length} relationships`,
        );

        // Convert to Cytoscape elements
        const elements = this.convertGlobalDataToElements(allData);

        // Add elements to global instance
        this.globalInstance.add(elements);

        // Set active instance reference BEFORE setting up interactions
        this.cy = this.globalInstance;
        this.currentActiveView = "global";

        // Pre-compute LOD thresholds for performance
        this.precomputeLODThresholds();

        // Setup zoom interactions for global instance
        console.log("[DEBUG-INIT] About to setup zoom interactions on initial load");
        console.log("[DEBUG-INIT] Interaction state before setup:", JSON.stringify({
            zoomHandlersSetup: this.zoomHandlersSetup,
            currentActiveView: this.currentActiveView,
            cyIsGlobalInstance: this.cy === this.globalInstance,
            globalInstanceExists: !!this.globalInstance,
            globalInstanceContainer: !!this.globalInstance?.container(),
            globalInstanceReady: this.globalInstance?._private?.cy !== undefined
        }));

        this.setupZoomInteractions();

        console.log("[DEBUG-INIT] About to setup general interactions on initial load");
        this.setupInteractions();

        console.log("[DEBUG-INIT] Interactions setup complete on initial load");

        // Test zoom event functionality immediately after setup
        setTimeout(() => {
            console.log("[DEBUG-TEST] Testing zoom functionality 2 seconds after init");
            console.log("[DEBUG-TEST] Current zoom before test:", this.globalInstance.zoom());
            this.globalInstance.zoom(this.globalInstance.zoom() * 1.1);
            console.log("[DEBUG-TEST] Current zoom after test:", this.globalInstance.zoom());
        }, 2000);

        // Apply layout with cache
        await this.applyLayoutWithCache("initial");

        // Fit to view
        this.globalInstance.fit({ maxZoom: 2.0 });

        // Apply initial LOD
        const zoomAfterFit = this.globalInstance.zoom();
        this.updateStyleBasedLOD(zoomAfterFit);

        console.log("[TripleInstance] Global view loaded successfully");
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
            console.log("[Zoom] Zoom handlers already set up, skipping duplicate setup");
            return;
        }

        console.log("[Zoom] Setting up zoom handlers for all instances");

        // Set up zoom interactions for all three instances
        this.setupZoomInteractionsForInstance(this.globalInstance);
        this.setupZoomInteractionsForInstance(this.neighborhoodInstance);
        this.setupZoomInteractionsForInstance(this.detailInstance);

        this.zoomHandlersSetup = true;
    }

    private setupZoomInteractionsForInstance(instance: any): void {
        if (!instance) return;

        // Determine which instance this is for logging
        let instanceName = "unknown";
        if (instance === this.globalInstance) {
            instanceName = "global";
        } else if (instance === this.neighborhoodInstance) {
            instanceName = "neighborhood";
        } else if (instance === this.detailInstance) {
            instanceName = "detail";
        }

        // Natural zoom event handling - trust Cytoscape.js defaults
        instance.on("zoom", () => {
            const zoom = instance.zoom();
            this.zoomEventCount++;

            // Enhanced logging with threshold information
            const enterThreshold = this.zoomThresholds.enterNeighborhoodMode;
            const exitThreshold = this.zoomThresholds.exitNeighborhoodMode;
            const willTriggerNeighborhood = (this.currentActiveView === "global" && zoom > enterThreshold);
            const willTriggerGlobal = (this.currentActiveView === "neighborhood" && zoom < exitThreshold);

            console.log(
                `[Zoom] Event #${this.zoomEventCount} on ${instanceName} instance, zoom: ${zoom.toFixed(3)} | ` +
                `Current view: ${this.currentActiveView} | Active: ${instance === this.cy ? 'YES' : 'NO'} | ` +
                `Thresholds: enter=${enterThreshold}, exit=${exitThreshold} | ` +
                `Triggers: →neighborhood=${willTriggerNeighborhood}, →global=${willTriggerGlobal}`,
            );

            console.log(`[DEBUG-ZOOM] Zoom handler state:`, JSON.stringify({
                instanceName: instanceName,
                zoomEventCount: this.zoomEventCount,
                currentActiveView: this.currentActiveView,
                instanceEqualsThis: instance === this.cy,
                instanceContainer: instance?.container()?.id || 'none',
                thisContainer: this.cy?.container()?.id || 'none'
            }));

            // Only handle view transitions and LOD updates for the currently active instance
            if (instance !== this.cy) {
                console.log(`[Zoom] Skipping LOD update - ${instanceName} instance not currently active`);
                return;
            }

            this.eventSequence.push({
                event: "zoom",
                time: Date.now(),
                zoom: zoom,
                details: { eventNumber: this.zoomEventCount, view: this.currentActiveView, instance: instanceName },
            });

            // Smooth 60fps LOD updates
            clearTimeout(this.zoomTimer);
            this.zoomTimer = setTimeout(async () => {
                console.time("[Perf] Zoom LOD update");

                // Apply appropriate LoD based on current view and instance
                if (instanceName === "neighborhood" && this.currentAnchorNodes.size > 0) {
                    // Use anchor-based LoD for neighborhood view
                    this.applyAnchorBasedLoD(zoom);
                } else {
                    // Use standard style-based LoD for global and detail views
                    this.updateStyleBasedLOD(zoom);
                }

                console.timeEnd("[Perf] Zoom LOD update");

                // Handle hierarchical loading based on zoom level
                // Only process if not already loading
                if (!this.isLoadingNeighborhood) {
                    await this.handleHierarchicalZoomChange(zoom);
                }
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
        if (!this.graphDataProvider) return;

        const zoomDelta = newZoom - this.lastZoomLevel;
        this.lastZoomLevel = newZoom;

        // Determine transitions based on current view and zoom
        if (this.currentActiveView === "global" && newZoom > this.zoomThresholds.enterNeighborhoodMode) {
            console.log("[TripleInstance] Transitioning from global to neighborhood");
            await this.transitionToNeighborhoodMode();
        } else if (this.currentActiveView === "neighborhood" && newZoom < this.zoomThresholds.exitNeighborhoodMode) {
            console.log("[TripleInstance] Transitioning from neighborhood to global");
            await this.transitionToGlobalMode();
        }
    }

    /**
     * Transition from global view to neighborhood view
     */
    private async transitionToNeighborhoodMode(): Promise<void> {
        if (this.isLoadingNeighborhood) {
            console.log("[TripleInstance] Already loading neighborhood, skipping");
            return;
        }

        // Store current global zoom level before transitioning away
        this.previousGlobalZoom = this.globalInstance.zoom();
        console.log(`[TripleInstance] Stored global zoom level: ${this.previousGlobalZoom} before transition`);

        // Find center entity in global view using smart cursor-based selection
        console.log(`[TripleInstance] Looking for center node in ${this.currentActiveView} view`);

        // Get candidate nodes (viewport or all visible nodes)
        let candidateNodes = this.getNodesInViewport();
        console.log(`[TripleInstance] Found ${candidateNodes.length} nodes in viewport`);

        if (candidateNodes.length === 0) {
            // Fallback: use all visible nodes when viewport is too zoomed out
            const activeInstance = this.currentActiveView === "global" ? this.globalInstance : this.cy;
            candidateNodes = activeInstance.nodes().filter((node: any) => {
                return node.style('display') !== 'none' && node.style('opacity') > 0;
            });
            console.log(`[TripleInstance] Fallback: Found ${candidateNodes.length} visible nodes in ${this.currentActiveView} view`);
        }

        // Smart center node selection: cursor-based if available, otherwise importance-based
        let centerNode = null;
        if (this.isCursorOverMap && this.lastCursorPosition) {
            console.log(`[TripleInstance] Using cursor-based center selection at (${this.lastCursorPosition.x}, ${this.lastCursorPosition.y})`);
            console.log(`[TripleInstance] isCursorOverMap: ${this.isCursorOverMap}, lastCursorPosition:`, this.lastCursorPosition);
            centerNode = this.findNodeClosestToCursor(candidateNodes, this.lastCursorPosition);

            if (centerNode) {
                const centerNodeName = centerNode.data('name') || centerNode.data('id');
                console.log(`[TripleInstance] Cursor-based selection found: ${centerNodeName}`);
            } else {
                console.log(`[TripleInstance] Cursor-based selection failed to find a node`);
            }
        } else {
            console.log(`[TripleInstance] Cursor-based selection not available: isCursorOverMap=${this.isCursorOverMap}, hasLastCursorPosition=${!!this.lastCursorPosition}`);
        }

        // Fallback to importance-based selection if cursor method didn't find a node
        if (!centerNode) {
            console.log(`[TripleInstance] Falling back to importance-based center selection`);
            centerNode = this.findMostImportantNode(candidateNodes);

            if (centerNode) {
                const centerNodeName = centerNode.data('name') || centerNode.data('id');
                console.log(`[TripleInstance] Importance-based selection found: ${centerNodeName}`);
            }
        }

        if (!centerNode) {
            console.log("[TripleInstance] No suitable center node found in viewport or global view");
            return;
        }

        const centerEntityName = centerNode.data('name') || centerNode.data('id');
        const importance = centerNode.data('importance') || centerNode.data('computedImportance') || 0;
        console.log(`[TripleInstance] Selected center node: ${centerEntityName} (importance: ${importance})`);

        // Collect all viewport node names for anchor-based neighborhood construction
        const viewportNodeNames = candidateNodes.map((node: any) => {
            return node.data('name') || node.data('id');
        });
        console.log(`[TripleInstance] Viewport contains ${viewportNodeNames.length} nodes that will anchor the neighborhood`);
        console.log(`[TripleInstance] Viewport nodes (first 10):`, viewportNodeNames.slice(0, 10));

        // Set loading flag to prevent concurrent transitions
        this.isLoadingNeighborhood = true;

        try {
            // Check if neighborhood instance already has data for this entity
            if (this.neighborhoodInstance.elements().length > 0) {
                // Check if current neighborhood contains center entity
                const existingCenter = this.neighborhoodInstance.$(`#${centerEntityName}`);
                if (existingCenter.length > 0) {
                    // Just switch to existing neighborhood
                    this.switchToNeighborhoodView();
                    return;
                }
            }

            // Load new neighborhood data with viewport nodes as anchors
            await this.loadNeighborhoodAroundNodes(centerEntityName, viewportNodeNames);
        } finally {
            // Always clear the loading flag
            this.isLoadingNeighborhood = false;
        }
    }

    /**
     * Transition from neighborhood view to global view
     */
    private async transitionToGlobalMode(): Promise<void> {
        // Prevent duplicate calls during rapid zoom events
        if (this.isLoadingNeighborhood) {
            console.log("[TripleInstance] Already transitioning, skipping duplicate global transition");
            return;
        }

        console.log("[TripleInstance] Transitioning from neighborhood to global");

        this.switchToGlobalView();

        // Restore previous global zoom level with offset to ensure it stays in global view
        // Apply offset to ensure zoom stays below neighborhood threshold (2.5)
        const globalZoomWithOffset = Math.min(this.previousGlobalZoom, this.zoomThresholds.enterNeighborhoodMode - 0.1);
        this.globalInstance.zoom(globalZoomWithOffset);
        console.log(`[TripleInstance] Restored global zoom: ${this.previousGlobalZoom} → applied: ${globalZoomWithOffset} (offset to stay in global view)`);
    }

    private setupContainerInteractions(): void {
        // Set up container-level interactions that apply to all instances

        // Track cursor position and map hover state for smart center node selection
        this.container.addEventListener("mousemove", (event) => {
            // Store cursor position relative to container, not screen
            const containerRect = this.container.getBoundingClientRect();
            this.lastCursorPosition = {
                x: event.clientX - containerRect.left,
                y: event.clientY - containerRect.top
            };
            this.isCursorOverMap = true;
            // console.log(`[CursorTracking] Cursor at container-relative position: (${this.lastCursorPosition.x.toFixed(1)}, ${this.lastCursorPosition.y.toFixed(1)})`);
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
     * Style-based LOD using Cytoscape.js best practices
     * Replaces data swapping with style updates for smooth performance
     */
    private updateStyleBasedLOD(zoom: number): void {
        if (!this.cy) {
            console.log("[DEBUG] updateStyleBasedLOD: No cytoscape instance");
            return;
        }

        console.log("[DEBUG] updateStyleBasedLOD called with:", JSON.stringify({
            zoomLevel: zoom,
            currentLayer: this.currentLayer,
            totalNodes: this.cy.nodes().length,
            totalEdges: this.cy.edges().length
        }));

        // Validate and clamp zoom value to reasonable bounds
        if (!isFinite(zoom)) {
            console.error(
                `[Zoom] Non-finite zoom in updateStyleBasedLOD: ${zoom}`,
            );
            return; // Skip update with invalid zoom
        }

        // Clamp zoom to our configured bounds (0.25 - 4.0)
        if (zoom < 0.25) {
            console.warn(`[Zoom] Zoom too low (${zoom}), clamping to 0.25`);
            zoom = 0.25;
        } else if (zoom > 4.0) {
            console.warn(`[Zoom] Zoom too high (${zoom}), clamping to 4.0`);
            zoom = 4.0;
        }

        // Check active instance for triple-instance architecture
        if (this.currentActiveView === "detail") {
            // In detail view instance - only update styles, no automatic transitions
            console.log(
                `[Perf] Detail instance - style-only LOD update`,
            );
            this.updateEntityViewStyles(zoom);
            // Note: No automatic transitions in triple-instance architecture
            return;
        }

        // Neighborhood view mode - specific LoD treatment
        if (this.currentActiveView === "neighborhood") {
            console.log(
                `[Perf] Neighborhood instance - applying neighborhood LoD`,
            );
            this.updateNeighborhoodViewStyles(zoom);
            return;
        }

        // Global view mode - style-based LOD (no data manipulation)
        console.time("[Perf] Style-based LOD update");

        // Use pre-computed thresholds for performance
        const { nodeThreshold, edgeThreshold } =
            this.getFastLODThresholds(zoom);

        console.log("[DEBUG] LOD thresholds:", JSON.stringify({
            nodeThreshold,
            edgeThreshold,
            zoomLevel: zoom
        }));

        // Analyze importance distribution for calibration
        const importanceValues = this.cy
            .nodes()
            .map((node: any) => {
                const importance =
                    node.data("importance") ||
                    node.data("computedImportance") ||
                    0;
                const degreeCount = node.data("degreeCount") || 0;
                const centralityScore = node.data("centralityScore") || 0;
                return Math.max(importance, degreeCount / 100, centralityScore);
            })
            .sort((a: number, b: number) => b - a);

        // Calculate expected visible counts for validation

        // Use batch for optimal performance
        this.cy.batch(() => {
            let visibleNodes = 0;
            let visibleEdges = 0;

            // Update node visibility based on importance
            this.cy.nodes().forEach((node: any) => {
                const importance =
                    node.data("importance") ||
                    node.data("computedImportance") ||
                    0;
                const degreeCount = node.data("degreeCount") || 0;
                const centralityScore = node.data("centralityScore") || 0;

                // Calculate effective importance from available metrics
                const effectiveImportance = Math.max(
                    importance,
                    degreeCount / 100,
                    centralityScore,
                );

                if (effectiveImportance >= nodeThreshold) {
                    node.style("display", "element");

                    // Show labels based on zoom level and importance
                    const fontSize = this.calculateNodeFontSize(
                        zoom,
                        effectiveImportance,
                    );
                    node.style({
                        "font-size": fontSize + "px",
                        "text-opacity": fontSize > 0 ? 1 : 0,
                    });

                    visibleNodes++;
                } else {
                    node.style("display", "none");
                }
            });

            // Update edge visibility based on confidence and connected node visibility
            this.cy.edges().forEach((edge: any) => {
                const confidence =
                    edge.data("confidence") ||
                    edge.data("strength") ||
                    edge.data("weight") ||
                    0.5;
                const source = edge.source();
                const target = edge.target();

                // Only show edge if both nodes are visible and confidence meets threshold
                const sourceVisible = source.style("display") === "element";
                const targetVisible = target.style("display") === "element";

                if (
                    sourceVisible &&
                    targetVisible &&
                    confidence >= edgeThreshold
                ) {
                    edge.style("display", "element");
                    visibleEdges++;
                } else {
                    edge.style("display", "none");
                }
            });

            console.log(
                `[Perf] Style LOD: ${visibleNodes} nodes, ${visibleEdges} edges visible`,
            );
            console.log("[DEBUG] LOD results:", JSON.stringify({
                visibleNodes,
                visibleEdges,
                totalNodes: this.cy.nodes().length,
                totalEdges: this.cy.edges().length,
                hiddenNodes: this.cy.nodes().length - visibleNodes,
                hiddenEdges: this.cy.edges().length - visibleEdges,
                nodeThreshold,
                edgeThreshold
            }));
        });

        console.timeEnd("[Perf] Style-based LOD update");
    }

    /**
     * Calculate dynamic thresholds based on actual data distribution
     * This adapts to the real importance and confidence scores in the dataset
     */
    private calculateDynamicThresholds(zoom: number): {
        nodeThreshold: number;
        edgeThreshold: number;
    } {
        if (!this.cy) return { nodeThreshold: 0, edgeThreshold: 0 };

        // In hierarchical loading mode, show more nodes since we've pre-filtered
        if (this.currentLayer === 'neighborhood') {
            // In neighborhood mode, show most nodes (they're already filtered)
            return {
                nodeThreshold: 0.01, // Very low threshold to show most nodes
                edgeThreshold: 0.1
            };
        }

        // Get target visibility percentages based on zoom level
        const { nodeVisibilityPercentage, edgeVisibilityPercentage } =
            this.getVisibilityPercentages(zoom);

        // Calculate node importance threshold from actual data
        const importanceValues = this.cy
            .nodes()
            .map((node: any) => {
                const importance =
                    node.data("importance") ||
                    node.data("computedImportance") ||
                    0;
                const degreeCount = node.data("degreeCount") || 0;
                const centralityScore = node.data("centralityScore") || 0;
                return Math.max(importance, degreeCount / 100, centralityScore);
            })
            .sort((a: number, b: number) => b - a);

        // Calculate edge confidence threshold from actual data
        const confidenceValues = this.cy
            .edges()
            .map((edge: any) => {
                return edge.data("confidence") || edge.data("strength") || 0.5;
            })
            .sort((a: number, b: number) => b - a);

        // Get threshold values at target percentiles
        const nodeThresholdIndex = Math.floor(
            importanceValues.length * nodeVisibilityPercentage,
        );
        const edgeThresholdIndex = Math.floor(
            confidenceValues.length * edgeVisibilityPercentage,
        );

        const nodeThreshold =
            importanceValues[
                Math.min(nodeThresholdIndex, importanceValues.length - 1)
            ] || 0;
        const edgeThreshold =
            confidenceValues[
                Math.min(edgeThresholdIndex, confidenceValues.length - 1)
            ] || 0;

        return { nodeThreshold, edgeThreshold };
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
     * Calculate zoom threshold for showing labels
     */
    private getLabelZoomThreshold(zoom: number): number {
        return zoom > 0.5 ? zoom : 0; // Only show labels when zoomed in enough
    }

    /**
     * Calculate font size for nodes based on zoom and importance
     */
    private calculateNodeFontSize(zoom: number, importance: number): number {
        const baseSize = 12;
        const zoomFactor = Math.max(0, zoom - 0.5); // Start showing labels at zoom 0.5
        const importanceFactor = Math.max(0.5, importance); // Minimum size factor

        const fontSize = baseSize * zoomFactor * importanceFactor;
        return Math.max(0, Math.min(24, fontSize)); // Clamp between 0 and 24px
    }

    /**
     * Style-based LOD for entity view mode
     */
    /**
     * Update neighborhood view styles with specific LoD for 50-100 node graphs
     */
    private updateNeighborhoodViewStyles(zoom: number): void {
        if (!this.neighborhoodInstance) return;

        const nodes = this.neighborhoodInstance.nodes();
        const edges = this.neighborhoodInstance.edges();
        const nodeCount = nodes.length;

        console.log(`[NeighborhoodLoD] Updating styles for ${nodeCount} nodes at zoom ${zoom.toFixed(2)}`);

        // Calculate neighborhood-specific thresholds based on node count
        // For 50-100 nodes, we want more granular control and better initial visibility
        const thresholds = {
            labelMinZoom: 0.7,      // Show labels when zoomed in > 0.7x (more permissive)
            labelFadeStart: 0.5,    // Start fading labels at 0.5x
            edgeMinZoom: 0.3,       // Show edges when > 0.3x
            nodeMinImportance: 0.1, // Minimum importance to show node
            labelMinImportance: 0.2 // Minimum importance to show label (more permissive)
        };

        // Update node visibility and labels based on zoom and importance
        nodes.forEach((node: any) => {
            const importance = node.data('importance') || node.data('computedImportance') || 0.5;
            const size = node.data('size') || 30;

            // Always show nodes in neighborhood view (they're already filtered)
            node.style('display', 'element');

            // Label visibility based on zoom and importance
            if (zoom >= thresholds.labelMinZoom && importance >= thresholds.labelMinImportance) {
                // Full label visibility when zoomed in
                const labelOpacity = Math.min(1, (zoom - thresholds.labelFadeStart) /
                                             (thresholds.labelMinZoom - thresholds.labelFadeStart));
                node.style({
                    'text-opacity': labelOpacity,
                    'font-size': Math.max(8, Math.min(16, 8 + (zoom - 0.5) * 8)),
                    'label': node.data('name')
                });
            } else if (zoom >= thresholds.labelFadeStart) {
                // Partial label visibility
                const labelOpacity = (zoom - thresholds.labelFadeStart) / 0.2;
                node.style({
                    'text-opacity': labelOpacity * 0.5,
                    'font-size': 8,
                    'label': node.data('name')
                });
            } else {
                // Hide labels when zoomed out
                node.style('text-opacity', 0);
            }

            // Let Cytoscape handle natural zoom scaling for consistent spacing
            // Only adjust border width to maintain visual hierarchy
            const zoomFactor = Math.min(1.5, Math.max(0.5, zoom));
            node.style({
                'border-width': Math.max(1, 2 * zoomFactor)
            });
        });

        // Edge visibility based on zoom
        edges.forEach((edge: any) => {
            if (zoom >= thresholds.edgeMinZoom) {
                const edgeOpacity = Math.min(0.8, 0.3 + (zoom - thresholds.edgeMinZoom) * 2);
                edge.style({
                    'display': 'element',
                    'opacity': edgeOpacity
                    // Let Cytoscape handle natural edge width scaling with zoom
                });
            } else {
                edge.style('display', 'none');
            }
        });

        console.log(`[NeighborhoodLoD] Applied: ${nodes.filter(':visible').length} visible nodes, ` +
                   `${edges.filter(':visible').length} visible edges`);
    }

    private updateEntityViewStyles(zoom: number): void {
        if (!this.cy) return;

        console.time("[Perf] Entity view style update");

        // In entity view, show all nodes but adjust labels and edge visibility
        const labelThreshold = 0.7; // Show labels when zoomed in
        const edgeThreshold = 0.5; // Show fewer edges when zoomed out

        this.cy.batch(() => {
            // Only update styles for non-hidden nodes (respect global-only class)
            this.cy.nodes().forEach((node: any) => {
                // Don't show nodes that were hidden during transition
                if (node.hasClass("global-only")) {
                    return; // Skip hidden nodes
                }

                node.style("display", "element");

                if (zoom > labelThreshold) {
                    const fontSize = Math.min(16, zoom * 12);
                    node.style({
                        "font-size": fontSize + "px",
                        "text-opacity": 1,
                    });
                } else {
                    node.style("text-opacity", 0);
                }
            });

            // Adjust edge visibility based on zoom
            this.cy.edges().forEach((edge: any) => {
                // Don't show edges that were hidden during transition
                if (edge.hasClass("global-only")) {
                    return; // Skip hidden edges
                }

                if (zoom > edgeThreshold) {
                    edge.style("display", "element");
                } else {
                    // In entity view, only hide low-confidence edges when zoomed out
                    const confidence =
                        edge.data("confidence") || edge.data("strength") || 0.5;
                    edge.style(
                        "display",
                        confidence > 0.7 ? "element" : "none",
                    );
                }
            });
        });

        console.timeEnd("[Perf] Entity view style update");
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

    /**
     * Apply visual sizing based on computed importance values
     * This replaces CSS mapData which doesn't auto-refresh when data changes
     */
    private applyImportanceBasedSizing(): void {
        if (!this.globalInstance) return;

        this.globalInstance.nodes().forEach((node: any) => {
            const computedImportance = node.data('computedImportance') || 0;
            // Map importance (0-1) to size (20-40px) - same as CSS mapData(computedImportance, 0, 1, 20, 40)
            const size = 20 + (computedImportance * 20);

            node.style({
                'width': size,
                'height': size
            });
        });

        console.log('[ImportanceSizing] Applied direct sizing based on computedImportance values');
    }

    /**
     * Calculate entity importance from available metrics
     */
    private calculateEntityImportance(entity: any): number {
        const importance = entity.importance || 0;
        const degree = entity.degree || entity.degreeCount || 0;
        const centrality = entity.centralityScore || 0;
        const pagerank = entity.metrics?.pagerank || 0;

        // Combine different importance signals with weights
        return Math.max(
            importance,
            degree / 100, // Normalize degree
            centrality,
            pagerank,
            0.1, // Minimum importance
        );
    }

    /**
     * Check if we should transition from entity view to global view
     */
    private shouldTransitionToGlobal(zoom: number): boolean {
        // In triple-instance architecture, we don't auto-transition based on zoom
        // Users manually navigate between instances via UI controls
        // Keep this method for potential future use but disable auto-transitions
        return false;

        // Original logic (disabled for triple-instance):
        // return (
        //     this.viewMode.startsWith("entity") &&
        //     zoom < 0.3 &&
        //     this.globalGraphData !== null
        // );
    }

    /**
     * Initiate a smooth transition from entity view to global view
     */
    private async initiateGlobalTransition(currentZoom: number): Promise<void> {
        if (
            !this.cy ||
            !this.globalGraphData ||
            this.viewMode === "transitioning"
        )
            return;

        console.log(
            "[Transition] Starting transition from entity to global view",
        );
        this.viewMode = "transitioning";

        // Store current entity position for smooth transition
        const entityNode = this.currentEntity
            ? this.cy.$(`#${this.currentEntity}`)
            : null;
        const entityPosition =
            entityNode && entityNode.length > 0 ? entityNode.position() : null;

        // Step 1: Show hidden global nodes/edges with animation
        await this.restoreGlobalElements();

        // Step 2: Hide detail-only nodes/edges
        await this.hideDetailElements();

        // Step 3: Apply global layout and focus
        this.applyGlobalLayout(currentZoom, entityPosition);
    }

    /**
     * Restore global-only elements that were hidden during detail view
     */
    private async restoreGlobalElements(): Promise<void> {
        return new Promise((resolve) => {
            const globalOnlyElements = this.cy.$(".global-only");

            if (globalOnlyElements.length === 0) {
                // No global-only elements to restore, need to load full global data
                this.loadFullGlobalData();
                resolve();
                return;
            }

            console.log(
                `[Transition] Restoring ${globalOnlyElements.length} global-only elements`,
            );

            this.cy.batch(() => {
                globalOnlyElements.forEach((element: any) => {
                    element.removeClass("global-only");
                    element.animate(
                        {
                            style: { opacity: 1, display: "element" },
                        },
                        400,
                    );
                });
            });

            setTimeout(() => resolve(), 450);
        });
    }

    /**
     * Hide detail-only elements during transition to global view
     */
    private async hideDetailElements(): Promise<void> {
        return new Promise((resolve) => {
            const detailOnlyElements = this.cy.$(".detail-only");

            if (detailOnlyElements.length === 0) {
                resolve();
                return;
            }

            console.log(
                `[Transition] Hiding ${detailOnlyElements.length} detail-only elements`,
            );

            this.cy.batch(() => {
                detailOnlyElements.forEach((element: any) => {
                    element.animate(
                        {
                            style: { opacity: 0, display: "none" },
                        },
                        300,
                    );
                });
            });

            setTimeout(() => {
                // Remove detail-only elements after animation
                detailOnlyElements.remove();
                resolve();
            }, 350);
        });
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

        // Pre-compute LOD thresholds for performance
        this.precomputeLODThresholds();

        console.timeEnd("[Transition] Load global elements");
    }

    /**
     * Apply global layout and focus on entity
     */
    private applyGlobalLayout(currentZoom: number, entityPosition: any): void {
        // Apply style-based LOD for current zoom
        this.updateStyleBasedLOD(currentZoom);

        // If we had an entity position, try to center on it
        if (entityPosition && this.currentEntity) {
            const newEntityNode = this.cy.$(`#${this.currentEntity}`);
            if (newEntityNode.length > 0) {
                // Animate to center on the entity in the global context
                this.cy.animate({
                    center: { eles: newEntityNode },
                    zoom: currentZoom,
                    duration: 500,
                    complete: () => {
                        this.viewMode = "global";
                        this.currentEntity = null; // Clear current entity in global view
                        console.log(
                            "[Transition] Completed transition to global view",
                        );
                    },
                });
            } else {
                // Entity not found in global view, just complete the transition
                this.viewMode = "global";
                this.currentEntity = null;
                console.log(
                    "[Transition] Completed transition to global view (entity not found)",
                );
            }
        } else {
            // No entity to focus on, just complete the transition
            this.viewMode = "global";
            this.currentEntity = null;
            console.log("[Transition] Completed transition to global view");
        }
    }

    /**
     * Initiate a direct transition from global view to entity detail view
     */
    private async initiateEntityDetailTransition(
        node: any,
        entityData: EntityData,
    ): Promise<void> {
        if (!this.cy || this.viewMode === "transitioning") return;

        console.log(
            `[Transition] Starting direct transition to detail view for entity: ${entityData.name}`,
        );
        this.viewMode = "transitioning";

        try {
            // Direct transition to detail view without zoom animation
            console.log(
                `[Transition] Loading detailed data for entity: ${entityData.name}`,
            );

            // Trigger the callback to load detailed entity data
            if (this.entityClickCallback) {
                this.entityClickCallback(entityData);
            }

            // The EntityGraphView will call loadEntityGraph which will complete the transition
        } catch (error) {
            console.error(
                "[Transition] Failed to transition to entity detail view:",
                error,
            );
            // Restore original view on error
            this.viewMode = "global";
        }
    }

    /**
     * Animate the viewport to a target position and zoom level
     */
    private animateViewport(
        target: { zoom: number; pan: { x: number; y: number } },
        duration: number = 600,
    ): Promise<void> {
        return new Promise((resolve) => {
            if (!this.cy) {
                resolve();
                return;
            }

            this.cy.animate(
                {
                    zoom: target.zoom,
                    pan: target.pan,
                },
                {
                    duration: duration,
                    easing: "ease-out-cubic",
                    complete: () => resolve(),
                },
            );
        });
    }

    /**
     * Apply sophisticated Level of Detail rendering based on multiple factors
     */
    private applySophisticatedLOD(zoom: number): void {
        const nodes = this.cy.nodes();
        const edges = this.cy.edges();

        // Calculate global metrics for adaptive thresholds
        const nodeMetrics = this.calculateNodeMetrics(nodes);
        const edgeMetrics = this.calculateEdgeMetrics(edges);

        // Apply multi-factor visibility algorithm for nodes
        nodes.forEach((node: any) => {
            const visibility = this.calculateNodeVisibility(
                node,
                zoom,
                nodeMetrics,
            );
            this.applyNodeLOD(node, visibility, zoom);
        });

        // Apply context-aware edge visibility
        edges.forEach((edge: any) => {
            const visibility = this.calculateEdgeVisibility(
                edge,
                zoom,
                edgeMetrics,
            );
            this.applyEdgeLOD(edge, visibility, zoom);
        });
    }

    private calculateNodeMetrics(nodes: any): any {
        const importanceValues = nodes.map(
            (n: any) => n.data("importance") || 0,
        );
        const degreeValues = nodes.map((n: any) => n.data("degree") || 0);

        return {
            importancePercentiles: this.calculatePercentiles(importanceValues),
            degreePercentiles: this.calculatePercentiles(degreeValues),
            totalNodes: nodes.length,
        };
    }

    private calculateEdgeMetrics(edges: any): any {
        const strengthValues = edges.map((e: any) => e.data("strength") || 0);

        return {
            strengthPercentiles: this.calculatePercentiles(strengthValues),
            totalEdges: edges.length,
        };
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

    private calculateNodeVisibility(
        node: any,
        zoom: number,
        metrics: any,
    ): any {
        const importance = node.data("importance") || 0;
        const degree = node.data("degree") || 0;
        const type = node.data("type") || "entity";
        const communityId = node.data("communityId");

        // Multi-factor scoring system
        let visibilityScore = 0;

        // Factor 1: Importance (40% weight)
        if (importance >= metrics.importancePercentiles.p90)
            visibilityScore += 4;
        else if (importance >= metrics.importancePercentiles.p75)
            visibilityScore += 3;
        else if (importance >= metrics.importancePercentiles.p50)
            visibilityScore += 2;
        else if (importance >= metrics.importancePercentiles.p25)
            visibilityScore += 1;

        // Factor 2: Degree/Connectivity (30% weight)
        if (degree >= metrics.degreePercentiles.p90) visibilityScore += 3;
        else if (degree >= metrics.degreePercentiles.p75) visibilityScore += 2;
        else if (degree >= metrics.degreePercentiles.p50) visibilityScore += 1;

        // Factor 3: Node type priority (20% weight)
        const typePriority = this.getTypePriority(type);
        visibilityScore += typePriority;

        // Factor 4: Community hubs (10% weight)
        if (communityId && this.isCommunityhub(node, communityId)) {
            visibilityScore += 1;
        }

        // Adaptive zoom-based thresholds
        const zoomThresholds = this.getAdaptiveZoomThresholds(
            zoom,
            metrics.totalNodes,
        );

        return {
            score: visibilityScore,
            shouldShow: visibilityScore >= zoomThresholds.nodeThreshold,
            shouldLabel: visibilityScore >= zoomThresholds.labelThreshold,
            labelSize: this.calculateLabelSize(visibilityScore, zoom),
            opacity: this.calculateOpacity(visibilityScore, zoom),
        };
    }

    private calculateEdgeVisibility(
        edge: any,
        zoom: number,
        metrics: any,
    ): any {
        const strength = edge.data("strength") || 0;
        const type = edge.data("type") || "related";
        const sourceNode = edge.source();
        const targetNode = edge.target();

        // Check if both nodes are visible
        const sourceVisible = sourceNode.style("display") !== "none";
        const targetVisible = targetNode.style("display") !== "none";

        if (!sourceVisible || !targetVisible) {
            return { shouldShow: false, opacity: 0 };
        }

        let visibilityScore = 0;

        // Factor 1: Edge strength
        if (strength >= metrics.strengthPercentiles.p90) visibilityScore += 3;
        else if (strength >= metrics.strengthPercentiles.p75)
            visibilityScore += 2;
        else if (strength >= metrics.strengthPercentiles.p50)
            visibilityScore += 1;

        // Factor 2: Edge type importance
        const typeWeight = this.getEdgeTypeWeight(type);
        visibilityScore += typeWeight;

        // Factor 3: Connected node importance
        const nodeImportance = Math.max(
            sourceNode.data("importance") || 0,
            targetNode.data("importance") || 0,
        );
        if (nodeImportance > 0.7) visibilityScore += 1;

        const zoomThresholds = this.getAdaptiveZoomThresholds(
            zoom,
            metrics.totalEdges,
        );

        return {
            score: visibilityScore,
            shouldShow: visibilityScore >= zoomThresholds.edgeThreshold,
            opacity: Math.min(1, 0.3 + visibilityScore * 0.2),
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

    private applyNodeLOD(node: any, visibility: any, zoom: number): void {
        if (visibility.shouldShow) {
            node.style({
                display: "element",
                opacity: visibility.opacity,
                "font-size": visibility.labelSize + "px",
            });

            if (visibility.shouldLabel) {
                node.style("label", node.data("name"));
            } else {
                node.style("label", "");
            }
        } else {
            node.style("display", "none");
        }
    }

    private applyEdgeLOD(edge: any, visibility: any, zoom: number): void {
        if (visibility.shouldShow) {
            edge.style({
                display: "element",
                opacity: visibility.opacity,
            });
        } else {
            edge.style("display", "none");
        }
    }


    private convertGlobalDataToElements(globalData: any): any[] {
        const elements: any[] = [];
        const nodeIds = new Set<string>();

        console.time("[Perf] Process nodes");
        if (globalData.entities && globalData.entities.length > 0) {
            globalData.entities.forEach((entity: any) => {
                if (!nodeIds.has(entity.id)) {
                    elements.push({
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
                    });
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

        const layoutConfigs: { [key: string]: any } = {
            force: this.getOptimalLayoutConfig(),
            hierarchical: {
                name: "breadthfirst",
                directed: true,
                roots: this.cy.nodes().filter("[?centerEntity]"),
                padding: 30,
                spacingFactor: 1.25,
            },
            radial: {
                name: "concentric",
                concentric: (node: any) => node.degree(),
                levelWidth: () => 1,
                padding: 30,
                startAngle: (3 * Math.PI) / 2,
                clockwise: true,
            },
            grid: {
                name: "grid",
                fit: false, // Prevent layout from fighting viewport control
                animate: "end", // Animate only at end to prevent viewport conflicts
                padding: 30,
                avoidOverlap: true,
                avoidOverlapPadding: 10,
                nodeDimensionsIncludeLabels: false,
                spacingFactor: undefined,
                condense: false,
                rows: undefined,
                cols: undefined,
                position: () => {
                    return {};
                },
                sort: undefined,
            },
        };

        const layout = this.cy.layout(
            layoutConfigs[layoutName] || layoutConfigs.force,
        );

        // Handle layout completion to manually fit view
        layout.one("layoutstop", () => {
            console.log(
                `[Layout] ${layoutName} layout completed, fitting view`,
            );
            this.cy.fit({ maxZoom: 2.0 }); // Constrain fit zoom to prevent oscillation
        });

        layout.run();
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

    // ===================================================================
    // HIERARCHICAL PARTITIONED LOADING METHODS
    // ===================================================================


    /**
     * Check if we should switch to a different neighborhood
     */
    private async checkNeighborhoodSwitch(): Promise<void> {
        // Find the most important visible node in current viewport
        let viewportNodes = this.getNodesInViewport();

        if (viewportNodes.length === 0) {
            // Fallback: use visible nodes when viewport filtering is too restrictive
            viewportNodes = this.cy.nodes().filter((node: any) => {
                return node.style('display') !== 'none' && node.style('opacity') > 0;
            });
        }

        const centerNode = this.findMostImportantNode(viewportNodes);

        if (!centerNode) return;

        const centerEntityName = centerNode.data('name') || centerNode.data('id');

        // Check if this is different from current neighborhood center
        // (Implementation can be enhanced to track current center)
        if (this.neighborhoodCache.has(centerEntityName)) {
            console.log(`[HierarchicalLoading] Switching to cached neighborhood: ${centerEntityName}`);
            const cachedData = this.neighborhoodCache.get(centerEntityName);
            await this.bindCompleteGraph(cachedData);
        } else {
            await this.loadNeighborhoodAroundNode(centerEntityName);
        }
    }

    /**
     * Load neighborhood around a specific node (Triple-Instance Architecture)
     */
    public async loadNeighborhoodAroundNode(centerEntityName: string): Promise<void> {
        // Check cache first
        if (this.neighborhoodCache.has(centerEntityName)) {
            console.log(`[TripleInstance] Cache hit for ${centerEntityName}`);
            const cachedData = this.neighborhoodCache.get(centerEntityName);
            // Preserve zoom when loading from cache to avoid jarring resets
            const shouldPreserveZoom = this.currentActiveView === "neighborhood";
            await this.loadNeighborhoodGraph(cachedData, centerEntityName, shouldPreserveZoom);
            return;
        }

        // Loading flag is managed by the calling method to avoid conflicts
        try {
            this.showNeighborhoodLoadingIndicator(centerEntityName);

            // Fetch neighborhood data with adjusted max nodes for small graphs
            // TESTING: Smaller neighborhood for 100-node global graphs
            const totalNodes = this.globalInstance?.nodes().length || 1000;
            const maxNodesForNeighborhood = totalNodes < 200 ? 50 : 100;

            const neighborhoodData = await this.graphDataProvider.getImportanceNeighborhood(
                centerEntityName,
                maxNodesForNeighborhood  // Adjusted based on graph size
            );

            console.log("[TripleInstance] About to load neighborhood data:", JSON.stringify({
                entities: neighborhoodData.entities?.length || 0,
                relationships: neighborhoodData.relationships?.length || 0,
                centerEntity: centerEntityName
            }));

            // Load into neighborhood instance
            // Don't preserve zoom for fresh neighborhood loads (allow initial zoom setup)
            await this.loadNeighborhoodGraph(neighborhoodData, centerEntityName, false);

            console.log("[TripleInstance] Neighborhood loaded successfully");

        } catch (error) {
            console.error("[HierarchicalLoading] Error loading neighborhood:", error);
            this.showNeighborhoodError(centerEntityName);
        } finally {
            this.hideNeighborhoodLoadingIndicator();
            // Loading flag is cleared by the calling method to avoid conflicts
        }
    }

    /**
     * Load neighborhood around multiple viewport nodes for better visual continuity
     */
    public async loadNeighborhoodAroundNodes(centerEntityName: string, viewportNodeNames: string[]): Promise<void> {
        // Create cache key that includes both center and viewport nodes for better cache utilization
        const cacheKey = `${centerEntityName}_viewport_${viewportNodeNames.length}`;

        // Check cache first - but be more selective with viewport-based caching
        // Only use cache if we have the exact same viewport configuration
        if (this.neighborhoodCache.has(cacheKey)) {
            console.log(`[TripleInstance] Cache hit for viewport-based neighborhood: ${cacheKey}`);
            const cachedData = this.neighborhoodCache.get(cacheKey);
            // Preserve zoom when loading from cache to avoid jarring resets
            const shouldPreserveZoom = this.currentActiveView === "neighborhood";
            await this.loadNeighborhoodGraph(cachedData, centerEntityName, shouldPreserveZoom);
            return;
        }

        // Loading flag is managed by the calling method to avoid conflicts
        try {
            this.showNeighborhoodLoadingIndicator(centerEntityName);

            // Use high maxNodes for viewport-based neighborhoods to explore more comprehensively
            // Since we have multiple anchor points, we want to ensure thorough exploration
            const maxNodesForNeighborhood = 500;
            console.log(`[TripleInstance] Using maxNodes=${maxNodesForNeighborhood} for comprehensive viewport-based exploration`);

            console.log(`[TripleInstance] Loading viewport-based neighborhood for ${centerEntityName} with ${viewportNodeNames.length} anchor nodes`);

            const neighborhoodData = await this.graphDataProvider.getViewportBasedNeighborhood(
                centerEntityName,
                viewportNodeNames,
                maxNodesForNeighborhood
            );

            console.log("[TripleInstance] About to load viewport-based neighborhood data:", JSON.stringify({
                entities: neighborhoodData.entities?.length || 0,
                relationships: neighborhoodData.relationships?.length || 0,
                centerEntity: centerEntityName,
                viewportAnchors: viewportNodeNames.length,
                source: neighborhoodData.metadata?.source || "unknown"
            }));

            // Apply custom importance calculation for multi-anchor neighborhoods
            this.calculateMultiAnchorImportance(neighborhoodData, viewportNodeNames);

            // Cache the result for faster subsequent loads
            this.neighborhoodCache.set(cacheKey, neighborhoodData);

            // Load into neighborhood instance with anchor-aware LoD
            // Don't preserve zoom for fresh neighborhood loads (allow initial zoom setup)
            await this.loadNeighborhoodGraphWithAnchorLoD(neighborhoodData, centerEntityName, viewportNodeNames, false);

            console.log("[TripleInstance] Viewport-based neighborhood loaded successfully");

        } catch (error) {
            console.error("[TripleInstance] Error loading viewport-based neighborhood:", error);
            console.log("[TripleInstance] Falling back to standard neighborhood loading");

            // Fallback to standard neighborhood loading
            try {
                await this.loadNeighborhoodAroundNode(centerEntityName);
            } catch (fallbackError) {
                console.error("[TripleInstance] Fallback neighborhood loading also failed:", fallbackError);
                this.showNeighborhoodError(centerEntityName);
            }
        } finally {
            this.hideNeighborhoodLoadingIndicator();
            // Loading flag is cleared by the calling method to avoid conflicts
        }
    }

    /**
     * Calculate custom importance scores for multi-anchor neighborhoods
     * Factors in distance from anchor nodes and connectivity
     */
    private calculateMultiAnchorImportance(neighborhoodData: any, viewportNodeNames: string[]): void {
        if (!neighborhoodData?.entities || !neighborhoodData?.relationships) {
            console.warn("[MultiAnchor] Invalid neighborhood data for importance calculation");
            return;
        }

        console.log(`[MultiAnchor] Calculating importance for ${neighborhoodData.entities.length} entities with ${viewportNodeNames.length} anchors`);

        // Create maps for efficient lookups
        const entityMap = new Map<string, any>();
        const connectionCounts = new Map<string, number>();
        const anchorSet = new Set(viewportNodeNames);

        // Build entity map and count connections
        neighborhoodData.entities.forEach((entity: any) => {
            const entityName = entity.name || entity.id;
            entityMap.set(entityName, entity);
            connectionCounts.set(entityName, 0);
        });

        // Count connections for each entity
        neighborhoodData.relationships.forEach((rel: any) => {
            const fromName = rel.from || rel.source;
            const toName = rel.to || rel.target;
            if (connectionCounts.has(fromName)) {
                connectionCounts.set(fromName, (connectionCounts.get(fromName) || 0) + 1);
            }
            if (connectionCounts.has(toName)) {
                connectionCounts.set(toName, (connectionCounts.get(toName) || 0) + 1);
            }
        });

        // Calculate distances from anchor nodes using BFS
        const distancesFromAnchors = this.calculateDistancesFromAnchors(neighborhoodData, viewportNodeNames);

        // Calculate custom importance scores
        neighborhoodData.entities.forEach((entity: any) => {
            const entityName = entity.name || entity.id;
            const connections = connectionCounts.get(entityName) || 0;
            const minDistanceFromAnchor = Math.min(...viewportNodeNames.map(anchor =>
                distancesFromAnchors.get(`${anchor}-${entityName}`) || 999
            ));

            // Importance calculation:
            // - Anchor nodes get maximum importance (1.0)
            // - Direct connections to anchors get high importance (0.8-0.9)
            // - Importance decreases with distance from anchors
            // - Connectivity bonus for highly connected nodes
            let importance = 0;

            if (anchorSet.has(entityName)) {
                // Anchor nodes get maximum importance
                importance = 1.0;
            } else {
                // Base importance decreases exponentially with distance from nearest anchor
                const distanceDecay = Math.pow(0.6, minDistanceFromAnchor);

                // Connectivity bonus (normalized, max +0.3)
                const maxConnections = Math.max(...Array.from(connectionCounts.values()));
                const connectivityBonus = maxConnections > 0 ? (connections / maxConnections) * 0.3 : 0;

                // Original importance from backend (if available)
                const originalImportance = entity.importance || entity.computedImportance || 0;
                const originalBonus = originalImportance * 0.2;

                importance = Math.min(0.95, distanceDecay + connectivityBonus + originalBonus);

                // Ensure direct neighbors of anchors have high visibility
                if (minDistanceFromAnchor === 1) {
                    importance = Math.max(importance, 0.8);
                }
            }

            // Store the calculated importance
            entity.multiAnchorImportance = importance;
            entity.anchorDistance = minDistanceFromAnchor;
            entity.connectionCount = connections;

            console.log(`[MultiAnchor] ${entityName}: importance=${importance.toFixed(3)}, distance=${minDistanceFromAnchor}, connections=${connections}, isAnchor=${anchorSet.has(entityName)}`);
        });

        console.log(`[MultiAnchor] Importance calculation completed`);
    }

    /**
     * Calculate distances from anchor nodes using BFS
     */
    private calculateDistancesFromAnchors(neighborhoodData: any, anchorNames: string[]): Map<string, number> {
        const distances = new Map<string, number>();

        // Build adjacency list
        const adjacencyList = new Map<string, Set<string>>();
        neighborhoodData.entities.forEach((entity: any) => {
            const entityName = entity.name || entity.id;
            adjacencyList.set(entityName, new Set());
        });

        neighborhoodData.relationships.forEach((rel: any) => {
            const fromName = rel.from || rel.source;
            const toName = rel.to || rel.target;
            if (adjacencyList.has(fromName) && adjacencyList.has(toName)) {
                adjacencyList.get(fromName)!.add(toName);
                adjacencyList.get(toName)!.add(fromName);
            }
        });

        // Run BFS from each anchor to calculate distances
        anchorNames.forEach(anchorName => {
            if (!adjacencyList.has(anchorName)) return;

            const visited = new Set<string>();
            const queue: Array<{node: string, distance: number}> = [{node: anchorName, distance: 0}];

            while (queue.length > 0) {
                const {node, distance} = queue.shift()!;

                if (visited.has(node)) continue;
                visited.add(node);

                const key = `${anchorName}-${node}`;
                const existingDistance = distances.get(key);
                if (existingDistance === undefined || distance < existingDistance) {
                    distances.set(key, distance);
                }

                // Add neighbors to queue
                const neighbors = adjacencyList.get(node) || new Set();
                neighbors.forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        queue.push({node: neighbor, distance: distance + 1});
                    }
                });
            }
        });

        return distances;
    }

    /**
     * Load neighborhood graph with anchor-aware Level of Detail
     */
    private async loadNeighborhoodGraphWithAnchorLoD(
        graphData: any,
        centerEntityName: string,
        anchorNames: string[],
        preserveZoom: boolean = false
    ): Promise<void> {
        console.log(`[AnchorLoD] Loading neighborhood with anchor-aware LoD for ${anchorNames.length} anchors`);

        // Store anchor information for LoD calculations
        this.currentAnchorNodes = new Set(anchorNames);

        // Load the graph using existing method first
        await this.loadNeighborhoodGraph(graphData, centerEntityName, preserveZoom);

        // Apply initial anchor-based LoD after loading
        this.applyAnchorBasedLoD(this.neighborhoodInstance.zoom());

        console.log(`[AnchorLoD] Anchor-aware LoD applied`);
    }

    // Store current anchor nodes for LoD calculations
    private currentAnchorNodes: Set<string> = new Set();

    // Navigation state tracking for hide/show approach with viewport preservation
    private hiddenViewStack: Array<{
        view: "global" | "neighborhood";
        viewport: {
            zoom: number;
            pan: { x: number; y: number };
        };
        timestamp: number;
    }> = [];

    /**
     * Apply Level of Detail based on anchor proximity and zoom level
     */
    private applyAnchorBasedLoD(zoom: number): void {
        if (!this.neighborhoodInstance || this.currentAnchorNodes.size === 0) return;

        console.log(`[AnchorLoD] Applying LoD at zoom ${zoom.toFixed(2)} with ${this.currentAnchorNodes.size} anchors`);

        // Define zoom-based visibility thresholds
        const thresholds = {
            anchorsOnly: 0.5,        // Show only anchor nodes
            directNeighbors: 1.0,    // Show anchors + direct neighbors
            secondDegree: 2.0,       // Show up to 2 hops from anchors
            fullGraph: 3.0           // Show all nodes based on importance
        };

        const nodes = this.neighborhoodInstance.nodes();
        const edges = this.neighborhoodInstance.edges();

        let visibleNodeCount = 0;
        let visibleEdgeCount = 0;

        // Apply node visibility based on zoom and anchor distance
        nodes.forEach((node: any) => {
            const entityName = node.data('name') || node.data('id');
            const isAnchor = this.currentAnchorNodes.has(entityName);
            const anchorDistance = node.data('anchorDistance') || 999;
            const importance = node.data('multiAnchorImportance') || node.data('importance') || 0;

            let visible = false;
            let opacity = 0;
            let size = 'small';

            if (zoom <= thresholds.anchorsOnly) {
                // Ultra zoomed out: only anchors
                visible = isAnchor;
                opacity = isAnchor ? 1.0 : 0;
                size = isAnchor ? 'large' : 'small';
            } else if (zoom <= thresholds.directNeighbors) {
                // Zoomed out: anchors + direct neighbors
                visible = isAnchor || anchorDistance <= 1;
                opacity = isAnchor ? 1.0 : (anchorDistance <= 1 ? 0.8 : 0);
                size = isAnchor ? 'large' : (anchorDistance <= 1 ? 'medium' : 'small');
            } else if (zoom <= thresholds.secondDegree) {
                // Medium zoom: show up to 2 hops with importance weighting
                if (isAnchor) {
                    visible = true;
                    opacity = 1.0;
                    size = 'large';
                } else if (anchorDistance <= 2) {
                    visible = true;
                    opacity = Math.max(0.4, 1.0 - (anchorDistance * 0.3));
                    size = anchorDistance <= 1 ? 'medium' : 'small';
                } else {
                    visible = importance > 0.6;
                    opacity = visible ? importance * 0.6 : 0;
                    size = 'small';
                }
            } else {
                // Zoomed in: show all nodes with importance-based opacity
                visible = true;
                if (isAnchor) {
                    opacity = 1.0;
                    size = 'large';
                } else {
                    opacity = Math.max(0.3, importance);
                    size = anchorDistance <= 1 ? 'medium' : 'small';
                }
            }

            // Apply styling
            if (visible) {
                node.style({
                    'display': 'element',
                    'opacity': opacity,
                    'width': size === 'large' ? 40 : (size === 'medium' ? 25 : 15),
                    'height': size === 'large' ? 40 : (size === 'medium' ? 25 : 15),
                    'background-color': isAnchor ? '#ff6b6b' : '#4ecdc4',
                    'border-width': isAnchor ? 3 : 1,
                    'border-color': isAnchor ? '#ff5252' : '#26a69a'
                });
                visibleNodeCount++;
            } else {
                node.style({
                    'display': 'none',
                    'opacity': 0
                });
            }
        });

        // Apply edge visibility based on connected nodes
        edges.forEach((edge: any) => {
            const source = edge.source();
            const target = edge.target();
            const sourceVisible = source.style('display') === 'element' && source.style('opacity') > 0;
            const targetVisible = target.style('display') === 'element' && target.style('opacity') > 0;

            if (sourceVisible && targetVisible) {
                const avgOpacity = (parseFloat(source.style('opacity')) + parseFloat(target.style('opacity'))) / 2;
                edge.style({
                    'display': 'element',
                    'opacity': Math.max(0.3, avgOpacity * 0.7),
                    'width': zoom > thresholds.secondDegree ? 2 : 1
                });
                visibleEdgeCount++;
            } else {
                edge.style({
                    'display': 'none',
                    'opacity': 0
                });
            }
        });

        console.log(`[AnchorLoD] LoD applied: ${visibleNodeCount}/${nodes.length} nodes, ${visibleEdgeCount}/${edges.length} edges visible`);
    }

    /**
     * Hide current view for detail navigation
     */
    private hideCurrentViewForDetailNavigation(): void {
        if (this.currentActiveView === "global" || this.currentActiveView === "neighborhood") {
            // Capture current viewport state before hiding
            const currentInstance = this.currentActiveView === "global" ? this.globalInstance : this.neighborhoodInstance;
            const viewport = {
                zoom: currentInstance.zoom(),
                pan: currentInstance.pan()
            };

            console.log(`[Navigation] Hiding ${this.currentActiveView} view for detail navigation - viewport: zoom=${viewport.zoom.toFixed(3)}, pan=(${viewport.pan.x.toFixed(1)}, ${viewport.pan.y.toFixed(1)})`);

            this.hiddenViewStack.push({
                view: this.currentActiveView,
                viewport: viewport,
                timestamp: Date.now()
            });

            // Limit stack size to prevent memory issues
            if (this.hiddenViewStack.length > 5) {
                this.hiddenViewStack.shift();
            }
        }
    }

    /**
     * Restore previously hidden view
     */
    public restoreHiddenView(): boolean {
        if (this.hiddenViewStack.length === 0) {
            console.log("[Navigation] No hidden view to restore");
            return false;
        }

        const hiddenView = this.hiddenViewStack.pop()!;
        console.log(`[Navigation] Restoring hidden ${hiddenView.view} view with viewport: zoom=${hiddenView.viewport.zoom.toFixed(3)}, pan=(${hiddenView.viewport.pan.x.toFixed(1)}, ${hiddenView.viewport.pan.y.toFixed(1)})`);

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
                    console.log(`[Navigation] Global view zoom before restoration: ${currentZoom.toFixed(3)}`);

                    this.globalInstance.zoom(hiddenView.viewport.zoom);
                    this.globalInstance.pan(hiddenView.viewport.pan);

                    // Verify zoom was actually set
                    const restoredZoom = this.globalInstance.zoom();
                    console.log(`[Navigation] Global view zoom after restoration: ${restoredZoom.toFixed(3)} (expected: ${hiddenView.viewport.zoom.toFixed(3)})`);
                }, 50);

            } else if (hiddenView.view === "neighborhood") {
                this.switchToNeighborhoodView();

                // Delay viewport restoration to ensure LoD updates are complete
                setTimeout(() => {
                    // Force resize to recalculate container dimensions, then restore viewport
                    this.neighborhoodInstance.resize();

                    // Log current zoom before restoration
                    const currentZoom = this.neighborhoodInstance.zoom();
                    console.log(`[Navigation] Neighborhood view zoom before restoration: ${currentZoom.toFixed(3)}`);

                    this.neighborhoodInstance.zoom(hiddenView.viewport.zoom);
                    this.neighborhoodInstance.pan(hiddenView.viewport.pan);

                    // Verify zoom was actually set
                    const restoredZoom = this.neighborhoodInstance.zoom();
                    console.log(`[Navigation] Neighborhood view zoom after restoration: ${restoredZoom.toFixed(3)} (expected: ${hiddenView.viewport.zoom.toFixed(3)})`);
                }, 50);
            }

            console.log(`[Navigation] Successfully restored ${hiddenView.view} view`);
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
    public getHiddenViewType(): "global" | "neighborhood" | null {
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
     * @deprecated Legacy method - use instance-specific loading methods instead
     * Bind complete graph data (preserves UI stability pattern)
     */
    private async bindCompleteGraph(graphData: any): Promise<void> {
        console.warn("[TripleInstance] bindCompleteGraph is deprecated - using instance-specific loading");

        // Route to appropriate instance-specific loading method
        if (this.currentActiveView === "global") {
            await this.loadGlobalGraph(graphData);
        } else if (this.currentActiveView === "neighborhood") {
            const centerEntity = graphData.entities?.[0]?.id || "unknown";
            // Preserve zoom when reloading neighborhood data to avoid jarring resets
            await this.loadNeighborhoodGraph(graphData, centerEntity, true);
        } else if (this.currentActiveView === "detail") {
            const centerEntity = graphData.entities?.[0]?.id || "unknown";
            await this.loadEntityDetailGraph(graphData, centerEntity);
        }
    }

    /**
     * Get nodes currently visible in viewport
     */
    private getNodesInViewport(): any[] {
        // Use the correct instance based on current view, like the manual method does
        const activeInstance = this.currentActiveView === "global" ? this.globalInstance : this.cy;

        if (!activeInstance) return [];

        const viewport = activeInstance.extent();
        return activeInstance.nodes().filter((node: any) => {
            const position = node.position();
            return (
                position.x >= viewport.x1 && position.x <= viewport.x2 &&
                position.y >= viewport.y1 && position.y <= viewport.y2
            );
        });
    }

    /**
     * Find the most important node from a list
     */
    private findMostImportantNode(nodes: any[]): any | null {
        return nodes.reduce((mostImportant, node) => {
            const nodeImportance = node.data('importance') || node.data('computedImportance') || 0;
            const currentBest = mostImportant ? (mostImportant.data('importance') || mostImportant.data('computedImportance') || 0) : -1;
            return nodeImportance > currentBest ? node : mostImportant;
        }, null);
    }

    /**
     * Find the node closest to the cursor position
     */
    private findNodeClosestToCursor(nodes: any[], cursorPosition: { x: number; y: number }): any | null {
        const activeInstance = this.currentActiveView === "global" ? this.globalInstance : this.cy;
        if (!activeInstance || nodes.length === 0) return null;

        // Try to use Cytoscape's built-in element hit testing first
        try {
            // Method 1: Try to get the element directly at the cursor position
            const containerRect = this.container.getBoundingClientRect();
            const renderedPosition = {
                x: cursorPosition.x,
                y: cursorPosition.y
            };

            // Try to get element at position using Cytoscape's API
            const elementAtPosition = activeInstance.$(':grabbable').filter((ele: any) => {
                const bb = ele.renderedBoundingBox();
                return bb &&
                       renderedPosition.x >= bb.x1 && renderedPosition.x <= bb.x2 &&
                       renderedPosition.y >= bb.y1 && renderedPosition.y <= bb.y2;
            });

            if (elementAtPosition && elementAtPosition.length > 0) {
                const node = elementAtPosition.first();
                const nodeName = node.data('name') || node.data('id');
                console.log(`[TripleInstance] Found node directly under cursor: ${nodeName}`);
                return node;
            }
        } catch (error) {
            console.log(`[TripleInstance] Direct hit testing failed, using distance calculation:`, error);
        }

        // Fallback: Calculate distances to find closest node
        // Cursor position is already container-relative
        const relativeX = cursorPosition.x;
        const relativeY = cursorPosition.y;

        // Convert to cytoscape graph coordinates
        let graphPosition;
        try {
            // Try the standard Cytoscape method if available
            const zoom = activeInstance.zoom();
            const pan = activeInstance.pan();
            const containerRect = this.container.getBoundingClientRect();

            // Cytoscape's coordinate system: center is (0,0) when pan is (0,0)
            graphPosition = {
                x: (relativeX - containerRect.width / 2 - pan.x) / zoom,
                y: (relativeY - containerRect.height / 2 - pan.y) / zoom
            };
            console.log(`[TripleInstance] Using coordinate conversion (zoom: ${zoom}, pan: ${pan.x},${pan.y})`);
        } catch (error) {
            console.warn("[TripleInstance] Coordinate conversion failed:", error);
            return null;
        }

        console.log(`[TripleInstance] Converted cursor to graph position: (${graphPosition.x.toFixed(1)}, ${graphPosition.y.toFixed(1)})`);

        let closestNode: any = null;
        let closestDistance = Infinity;
        const candidates: Array<{name: string, distance: number}> = [];

        nodes.forEach((node: any) => {
            const nodePosition = node.position();
            const distance = Math.sqrt(
                Math.pow(nodePosition.x - graphPosition.x, 2) +
                Math.pow(nodePosition.y - graphPosition.y, 2)
            );

            const nodeName = node.data('name') || node.data('id');
            candidates.push({name: nodeName, distance});

            if (distance < closestDistance) {
                closestDistance = distance;
                closestNode = node;
            }
        });

        // Show top 5 closest candidates for debugging
        candidates.sort((a, b) => a.distance - b.distance);
        console.log(`[TripleInstance] Top 5 closest nodes:`, candidates.slice(0, 5));

        if (closestNode) {
            const nodeName = closestNode.data('name') || closestNode.data('id');
            console.log(`[TripleInstance] Found node closest to cursor: ${nodeName} (distance: ${closestDistance.toFixed(1)})`);
        }

        return closestNode;
    }

    /**
     * Get current viewport bounds
     */
    private getCurrentViewport(): any {
        if (!this.cy) return null;

        return {
            zoom: this.cy.zoom(),
            pan: this.cy.pan(),
            extent: this.cy.extent()
        };
    }

    /**
     * Restore viewport position
     */
    private restoreViewport(viewport: any): void {
        if (!this.cy || !viewport) return;

        this.cy.zoom(viewport.zoom);
        this.cy.pan(viewport.pan);
    }

    /**
     * Show loading indicator for neighborhood loading
     */
    private showNeighborhoodLoadingIndicator(centerEntity: string): void {
        const indicator = document.createElement('div');
        indicator.id = 'neighborhood-loading-indicator';
        indicator.className = 'neighborhood-loading-indicator';
        indicator.innerHTML = `
            <div class="loading-content">
                <div class="spinner"></div>
                <div class="loading-text">
                    Loading detailed view around <strong>${centerEntity}</strong>
                </div>
                <div class="loading-subtext">
                    Fetching ~5000 related entities...
                </div>
            </div>
        `;

        indicator.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            z-index: 10000; background: rgba(0,0,0,0.8); color: white;
            padding: 16px 24px; border-radius: 8px; font-family: Arial, sans-serif;
        `;

        document.body.appendChild(indicator);
    }

    /**
     * Hide neighborhood loading indicator
     */
    private hideNeighborhoodLoadingIndicator(): void {
        const indicator = document.getElementById('neighborhood-loading-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Show layer transition indicator
     */
    private showLayerTransitionIndicator(fromLayer: string, toLayer: string): void {
        const message = toLayer === 'neighborhood'
            ? `Switching to detailed exploration around selected area`
            : `Returning to global overview`;

        console.log(`[HierarchicalLoading] ${message}`);
        // Could add visual indicator here
    }

    /**
     * Show error message for neighborhood loading
     */
    private showNeighborhoodError(centerEntity: string): void {
        console.error(`[HierarchicalLoading] Failed to load neighborhood for ${centerEntity}`);
        // Could add user-visible error message here
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

        return {
            nodes: nodes,
            edges: edges,
            layout: this.currentLayout,
            zoom: this.cy.zoom(),
            center: this.cy.center(),
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
            this.cy.fit({ maxZoom: 2.0 }); // Constrain resize fit to prevent oscillation
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
            <div class="tooltip-type">${data.type || 'entity'}</div>
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
     * Center on specific entity and show labels for neighborhood
     */
    private centerOnEntityWithLabels(entityName: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(entityName);
        if (node.length === 0) {
            console.warn(`Entity "${entityName}" not found in graph`);
            return;
        }

        // Pan to center the entity
        this.cy.center(node);

        // Show labels for the center node and its 2-degree neighborhood
        this.showLabelsForEntityNeighborhood(entityName, 2);
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

    /**
     * Apply detail layout to a specific instance with focus on center entity
     */
    private async applyDetailLayoutToInstance(
        instance: any,
        centerEntity: string,
    ): Promise<void> {
        if (!instance) return;

        // Use force-directed layout optimized for detail view
        const layoutConfig = {
            ...this.getOptimalLayoutConfig(),
            fit: false, // Don't auto-fit during layout
            animate: "end",
        };

        const layout = instance.layout(layoutConfig);

        return new Promise<void>((resolve) => {
            layout.one("layoutstop", () => {
                console.log(
                    `[TripleInstance] Detail layout completed for ${centerEntity}`,
                );
                // Fit view after layout with maxZoom constraint
                instance.fit({ maxZoom: 2.0 });
                resolve();
            });

            layout.run();
        });
    }

    /**
     * Extract node positions from global view for visual continuity
     */
    private extractGlobalNodePositions(): Map<string, { x: number; y: number }> {
        const positions = new Map<string, { x: number; y: number }>();

        if (!this.globalInstance) {
            return positions;
        }

        this.globalInstance.nodes().forEach((node: any) => {
            const nodeId = node.data('id') || node.data('name');
            const position = node.position();
            if (nodeId && position) {
                positions.set(nodeId, { x: position.x, y: position.y });
                console.log(`[VisualContinuity] Extracted position for ${nodeId}: (${position.x.toFixed(1)}, ${position.y.toFixed(1)})`);
            }
        });

        console.log(`[VisualContinuity] Extracted ${positions.size} node positions from global view`);
        console.log(`[VisualContinuity] Global position keys:`, Array.from(positions.keys()).slice(0, 10)); // Show first 10 for debugging
        return positions;
    }

    /**
     * Apply layout with visual continuity - preserve global positions where possible
     */
    private async applyLayoutWithVisualContinuity(
        instance: any,
        globalPositions: Map<string, { x: number; y: number }>,
        centerEntity: string,
        nodeCount: number
    ): Promise<void> {
        console.log(`[VisualContinuity] Applying layout with continuity for ${nodeCount} nodes, center: ${centerEntity}`);

        // First, try to position nodes that exist in both global and neighborhood views
        let preservedNodes = 0;
        const nodesToLayout: any[] = [];

        instance.nodes().forEach((node: any) => {
            const nodeId = node.data('id') || node.data('name');
            const globalPosition = globalPositions.get(nodeId);

            console.log(`[VisualContinuity] Checking node: ${nodeId}, has global position: ${!!globalPosition}`);

            if (globalPosition) {
                // Preserve position from global view
                node.position(globalPosition);
                preservedNodes++;
                console.log(`[VisualContinuity] Preserved position for ${nodeId}: (${globalPosition.x.toFixed(1)}, ${globalPosition.y.toFixed(1)})`);
            } else {
                // Mark for layout
                nodesToLayout.push(node);
                console.log(`[VisualContinuity] Node ${nodeId} needs layout - not found in global positions`);
            }
        });

        console.log(`[VisualContinuity] Preserved ${preservedNodes} node positions, ${nodesToLayout.length} nodes need layout`);

        // Apply layout optimized for neighborhood view with good spacing
        const layout = instance.layout({
            name: 'cose',
            animate: false,
            nodeRepulsion: () => 800000,  // Higher repulsion to prevent crowding
            nodeOverlap: 40,              // More overlap prevention
            idealEdgeLength: () => 120,   // Longer edges for better spacing
            edgeElasticity: () => 100,
            nestingFactor: 1,             // Less nesting for neighborhood view
            gravity: 50,                  // Lower gravity to allow more spread
            numIter: 200,                 // More iterations for better convergence
            initialTemp: 200,             // Higher temp to escape local minima
            coolingFactor: 0.9,
            minTemp: 1.0,
            randomize: preservedNodes === 0  // Only randomize if no positions were preserved
        });

        console.log(`[VisualContinuity] Starting layout with ${preservedNodes} preserved nodes...`);

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.error(`[VisualContinuity] Layout timeout after 10 seconds`);
                reject(new Error('Layout timeout'));
            }, 10000);

            layout.on('layoutstop', () => {
                clearTimeout(timeout);
                console.log(`[VisualContinuity] Layout completed successfully`);
                resolve(undefined);
            });

            layout.on('layoutready', () => {
                console.log(`[VisualContinuity] Layout ready - nodes positioned`);
            });

            console.log(`[VisualContinuity] Running layout...`);
            layout.run();
        });

        console.log(`[VisualContinuity] Applied layout to all ${instance.nodes().length} nodes with preserved starting positions`);

        // Ensure center entity is prominently positioned
        const centerNode = instance.nodes().filter((node: any) => {
            const nodeId = node.data('id') || node.data('name');
            return nodeId === centerEntity;
        });

        if (centerNode.length > 0) {
            const centerPosition = centerNode.position();
            console.log(`[VisualContinuity] Center entity ${centerEntity} positioned at (${centerPosition.x.toFixed(1)}, ${centerPosition.y.toFixed(1)})`);
        }
    }
}
