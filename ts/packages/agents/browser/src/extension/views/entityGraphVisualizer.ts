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

type ViewMode = 'entity-detail' | 'entity-extended' | 'entity-community' | 'global' | 'transitioning';

/**
 * Entity Graph Visualizer using Cytoscape.js
 */
export class EntityGraphVisualizer {
    protected cy: any = null;
    private container: HTMLElement;
    protected currentLayout: string = "force";
    private entityClickCallback: ((entity: EntityData) => void) | null = null;

    // View mode and data management
    private viewMode: ViewMode = 'global';
    private currentEntity: string | null = null;
    private entityGraphData: GraphData | null = null;
    private globalGraphData: any = null;

    private layoutCache: Map<string, any> = new Map();
    private zoomTimer: any = null;
    private isUpdatingLOD: boolean = false;
    private isNodeBeingDragged: boolean = false;
    private layoutUpdateTimer: any = null;
    private selectedNodes: Set<string> = new Set();
    private contextMenu: HTMLElement | null = null;

    // Investigation tracking
    private zoomEventCount: number = 0;
    private eventSequence: Array<{event: string, time: number, zoom: number, details?: any}> = [];

    // LOD performance optimization
    private lodThresholds: Map<number, {nodeThreshold: number, edgeThreshold: number}> = new Map();

    constructor(container: HTMLElement) {
        this.container = container;
    }

    /**
     * Detect WebGL support in the current browser
     */
    private detectWebGLSupport(): boolean {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
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
                name: 'canvas',
                webgl: true,
                webglTexSize: 2048,
                webglTexRows: 16,
                webglBatchSize: 1024,
                webglTexPerBatch: 8
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

            console.log(`[WebGL] Enabled with texture size: ${webglConfig.webglTexSize}, batch size: ${webglConfig.webglBatchSize}`);
            return webglConfig;
        } else {
            console.log(`[WebGL] Not supported, falling back to Canvas renderer`);
            return { name: 'canvas' };
        }
    }

    /**
     * Get CoSE layout configuration
     */
    private getOptimalLayoutConfig(): any {
        const nodeCount = this.globalGraphData?.entities?.length || 0;

        // Use original CoSE layout configuration
        const coseConfig = {
            name: "cose",
            idealEdgeLength: 100,
            nodeOverlap: 20,
            refresh: 20,
            fit: false,
            animate: 'end',
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


        console.log(`[Platform] Detected: ${navigator.platform}, using Cytoscape.js default wheel sensitivity`);

        // Get optimal renderer configuration (WebGL when available)
        const rendererConfig = this.getOptimalRendererConfig();

        // Initialize cytoscape instance with optimal configuration
        this.cy = cytoscape({
            container: this.container,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "grid" },
            renderer: rendererConfig,
            // Use conservative zoom bounds to prevent oscillation
            // Previous: 0.15-8.0 (oscillated), 0.01-100 (extreme bouncing), 0.1-10.0 (still bouncing)
            minZoom: 0.25,                    // Conservative minimum to keep graph visible
            maxZoom: 4.0,                     // Conservative maximum to prevent fit() overreach
            // Remove wheelSensitivity to trust Cytoscape defaults and avoid warnings
            pixelRatio: 1,                     // Lower resolution for better performance on high-density displays
            // Zoom settings - disable user zooming to implement custom smooth zoom
            zoomingEnabled: true,           // Allow programmatic zooming
            userZoomingEnabled: false,      // Disable default wheel/touch zoom (we handle it custom)
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        this.setupInteractions();
    }

    /**
     * Get current view mode
     */
    public getViewMode(): ViewMode {
        return this.viewMode;
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
        eventSequence: Array<{event: string, time: number, zoom: number, details?: any}>;
        summary: any;
    } {
        const now = Date.now();
        const events = this.eventSequence;
        const zoomEvents = events.filter(e => e.event === 'zoom');

        return {
            zoomEventCount: this.zoomEventCount,
            eventSequence: events,
            summary: {
                totalEvents: events.length,
                zoomEvents: zoomEvents.length,
                firstEventTime: events.length > 0 ? events[0].time : null,
                lastEventTime: events.length > 0 ? events[events.length - 1].time : null,
                timeSpanMs: events.length > 1 ? events[events.length - 1].time - events[0].time : 0,
                eventsInFirstSecond: events.filter(e => e.time <= (events[0]?.time || 0) + 1000).length,
                eventTypes: [...new Set(events.map(e => e.event))],
                zoomRange: {
                    min: Math.min(...events.map(e => e.zoom)),
                    max: Math.max(...events.map(e => e.zoom)),
                    final: events.length > 0 ? events[events.length - 1].zoom : null
                }
            }
        };
    }

    /**
     * Pre-compute LOD thresholds to avoid calculation during zoom events
     */
    private precomputeLODThresholds(): void {
        if (!this.cy) return;

        const zoomLevels = [0.1, 0.3, 0.6, 1.0, 1.5, 3.0, 6.0, 10.0];
        this.lodThresholds.clear();

        zoomLevels.forEach(zoom => {
            const thresholds = this.calculateDynamicThresholds(zoom);
            this.lodThresholds.set(zoom, thresholds);
        });

        console.log(`[Performance] Pre-computed LOD thresholds for ${zoomLevels.length} zoom levels`);
    }

    /**
     * Fast threshold lookup during zoom events
     */
    private getFastLODThresholds(zoom: number): {nodeThreshold: number, edgeThreshold: number} {
        // Find closest pre-computed zoom level
        const zoomLevels = Array.from(this.lodThresholds.keys()).sort((a, b) => a - b);
        const closestZoom = zoomLevels.reduce((prev, curr) =>
            Math.abs(curr - zoom) < Math.abs(prev - zoom) ? curr : prev
        );

        const thresholds = this.lodThresholds.get(closestZoom);
        if (thresholds) {
            return thresholds;
        }

        // Fallback to calculation if not found
        return this.calculateDynamicThresholds(zoom);
    }

    /**
     * Normalize wheel delta values for cross-platform consistency
     */
    private normalizeWheelDelta(deltaY: number): number {
        // Handle extreme delta values from different platforms
        const MAX_DELTA = 10;  // Reasonable maximum delta
        const MIN_DELTA = -10; // Reasonable minimum delta

        // Linux systems often report ±120, normalize to ±3
        if (Math.abs(deltaY) > 100) {
            const normalizedDelta = Math.sign(deltaY) * Math.min(3, Math.abs(deltaY) / 40);
            console.log(`[Zoom] Normalized extreme delta: ${deltaY} → ${normalizedDelta}`);
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
                selector: 'node',
                style: {
                    'min-zoomed-font-size': 8,        // Hide labels when too small
                    'text-opacity': 0,                 // Start with labels hidden
                    'transition-property': 'none',     // No animations
                    'transition-duration': 0,
                }
            },
            {
                selector: 'edge',
                style: {
                    'curve-style': 'haystack',        // Fastest edge rendering
                    'haystack-radius': 0.5,
                    'width': 1,
                    'opacity': 0.6,
                    'target-arrow-shape': 'none',     // Remove arrows for performance
                    'transition-property': 'none',
                    'transition-duration': 0,
                }
            },
            {
                selector: 'node[?important]',         // Only show labels for important nodes
                style: {
                    'text-opacity': 1
                }
            }
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
                selector: 'node[importance > 0.7]',
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
                selector: 'node[importance > 0.9]',
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
    }

    private setupNodeInteractions(): void {
        if (!this.cy) return;

        // Single click
        this.cy.on("tap", "node", (evt: any) => {
            const node = evt.target;
            const entityData: EntityData = {
                name: node.data("name"),
                type: node.data("type"),
                confidence: node.data("confidence"),
            };

            // Handle transition from global to detail view
            if (this.viewMode === 'global') {
                this.initiateEntityDetailTransition(node, entityData);
            } else if (this.entityClickCallback) {
                this.entityClickCallback(entityData);
            }

            this.highlightConnectedElements(node);
        });

        // Double click for detailed view
        this.cy.on("dblclick", "node", (evt: any) => {
            const node = evt.target;
            this.focusOnNode(node);
        });

        // Node hover with progressive disclosure
        this.cy.on("mouseover", "node", (evt: any) => {
            const node = evt.target;
            this.showProgressiveNodeInfo(node, evt.renderedPosition);
            this.highlightNodeNeighborhood(node, 1);
        });

        this.cy.on("mouseout", "node", () => {
            this.hideNodeTooltip();
            this.clearNeighborhoodHighlights();
        });

        // Node dragging with auto-layout
        this.cy.on("grab", "node", (evt: any) => {
            this.isNodeBeingDragged = true;
        });

        this.cy.on("free", "node", (evt: any) => {
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
        let boxSelectionMode = false;

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
                const newZoom = Math.min(Math.max(currentZoom * zoomFactor, minZoom), maxZoom);
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
    async loadEntityGraph(graphData: GraphData, centerEntityName?: string): Promise<void> {
        if (!this.cy) return;

        const wasTransitioning = this.viewMode === 'transitioning';
        const centerEntity = centerEntityName || graphData.centerEntity || null;

        // Store entity data
        this.currentEntity = centerEntity;
        this.entityGraphData = graphData;

        // Cancel any pending LOD updates
        if (this.zoomTimer) {
            clearTimeout(this.zoomTimer);
            this.zoomTimer = null;
        }

        if (wasTransitioning && this.globalGraphData) {
            // Smooth transition from global to detail view
            await this.performSmoothDetailTransition(graphData, centerEntity);
        } else {
            // Standard entity graph loading (direct navigation)
            await this.performStandardEntityLoad(graphData, centerEntity);
        }

        // Set final view mode
        this.viewMode = 'entity-detail';
        console.log(`[Transition] Completed transition to entity detail view for: ${centerEntity}`);
    }

    /**
     * Perform smooth transition from global to detail view
     */
    private async performSmoothDetailTransition(graphData: GraphData, centerEntity: string | null): Promise<void> {
        if (!this.cy || !centerEntity) return;

        console.log(`[Transition] Performing smooth detail transition for: ${centerEntity}`);

        // Step 1: Hide non-relevant global nodes/edges
        const relevantEntityIds = new Set([
            centerEntity,
            ...graphData.entities.map(e => e.name),
            ...graphData.relationships.flatMap(r => [r.from, r.to])
        ]);

        console.log(`[Transition] Relevant entities for detail view: ${relevantEntityIds.size} entities`);

        this.cy.batch(() => {
            let hiddenNodes = 0;
            let hiddenEdges = 0;

            // Hide global nodes that aren't in the detail view
            this.cy.nodes().forEach((node: any) => {
                const nodeId = node.data('name') || node.data('id');
                if (!relevantEntityIds.has(nodeId)) {
                    node.addClass('global-only');
                    node.style({ 'display': 'none', 'opacity': 0 });
                    hiddenNodes++;
                }
            });

            // Hide global edges that aren't in the detail view
            this.cy.edges().forEach((edge: any) => {
                const from = edge.data('source');
                const to = edge.data('target');
                if (!relevantEntityIds.has(from) || !relevantEntityIds.has(to)) {
                    edge.addClass('global-only');
                    edge.style({ 'display': 'none', 'opacity': 0 });
                    hiddenEdges++;
                }
            });

            console.log(`[Transition] Hidden ${hiddenNodes} nodes and ${hiddenEdges} edges from global view`);
        });

        // Step 2: Add new detail-specific nodes and edges
        await this.addDetailElements(graphData, centerEntity);

        // Step 3: Apply layout for visible elements only - do this synchronously like performStandardEntityLoad
        this.applyDetailViewLayout(centerEntity);
    }

    /**
     * Perform standard entity graph loading (no transition)
     */
    private async performStandardEntityLoad(graphData: GraphData, centerEntity: string | null): Promise<void> {
        console.time('[Perf] Entity clear elements');
        this.cy.elements().remove();
        console.timeEnd('[Perf] Entity clear elements');

        console.time('[Perf] Entity convert to elements');
        const elements = this.convertToGraphElements(graphData);
        console.timeEnd('[Perf] Entity convert to elements');
        console.log(`[Perf] Entity graph: ${elements.filter(e => e.group === "nodes").length} nodes, ${elements.filter(e => e.group === "edges").length} edges`);

        console.time('[Perf] Entity add elements');
        this.cy.add(elements);
        console.timeEnd('[Perf] Entity add elements');

        console.time('[Perf] Entity apply layout');
        this.applyLayout(this.currentLayout);
        console.timeEnd('[Perf] Entity apply layout');

        console.time('[Perf] Entity fit to view');
        this.cy.fit();
        console.timeEnd('[Perf] Entity fit to view');

        if (centerEntity) {
            this.centerOnEntityWithLabels(centerEntity);
        }
    }

    /**
     * Add detail-specific elements during transition
     */
    private async addDetailElements(graphData: GraphData, centerEntity: string): Promise<void> {
        const existingNodeIds = new Set();
        const existingEdgeIds = new Set();

        // Track existing elements
        this.cy.nodes().forEach((node: any) => {
            existingNodeIds.add(node.data('name') || node.data('id'));
        });
        this.cy.edges().forEach((edge: any) => {
            const id = edge.data('id') || `${edge.data('source')}-${edge.data('target')}`;
            existingEdgeIds.add(id);
        });

        // Convert new data to elements
        const newElements = this.convertToGraphElements(graphData);
        const newNodes = newElements.filter(e => e.group === "nodes");
        const newEdges = newElements.filter(e => e.group === "edges");

        // Add only truly new nodes
        const nodesToAdd = newNodes.filter(node =>
            !existingNodeIds.has(node.data.name || node.data.id)
        );

        // Add only truly new edges
        const edgesToAdd = newEdges.filter(edge => {
            const id = edge.data.id || `${edge.data.source}-${edge.data.target}`;
            return !existingEdgeIds.has(id);
        });

        if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
            console.log(`[Transition] Adding ${nodesToAdd.length} new nodes and ${edgesToAdd.length} new edges`);

            // Add new elements without style bypasses to avoid warnings
            const elementsToAdd = [...nodesToAdd, ...edgesToAdd];

            this.cy.batch(() => {
                // Add elements without initial style bypasses
                this.cy.add(elementsToAdd);

                // Apply initial styling and classes after addition
                elementsToAdd.forEach(el => {
                    const element = this.cy.getElementById(el.data.id);
                    if (element.length > 0) {
                        element.addClass('detail-only');
                        element.style('opacity', 0);

                        // Animate to visible
                        element.animate({
                            style: { 'opacity': 1 }
                        }, 400);
                    }
                });
            });
        }
    }

    /**
     * Apply layout optimized for detail view
     */
    private applyDetailViewLayout(centerEntity: string): void {
        // Only layout visible elements (not those with global-only class)
        const visibleElements = this.cy.elements().not('.global-only');
        const centerNode = visibleElements.filter(`node[name = "${centerEntity}"]`);

        console.log(`[Transition] Applying detail layout for "${centerEntity}", visible elements: ${visibleElements.length}, found center: ${centerNode.length > 0}`);

        if (visibleElements.length === 0) {
            console.warn(`[Transition] No visible elements for layout`);
            return;
        }

        if (centerNode.length === 0) {
            console.warn(`[Transition] Center entity "${centerEntity}" not found for layout`);
            // Just fit all visible elements if center entity not found
            this.cy.fit(visibleElements);
            return;
        }

        // Use cose layout for detail view to match expected layout behavior
        const coseConfig = this.getOptimalLayoutConfig();
        const layout = visibleElements.layout({
            ...coseConfig,
            animate: true,
            animationDuration: 500,
            fit: false, // Disable auto-fit, we'll do it manually after layout completes
            // Override some settings for detail view
            nodeRepulsion: 200000, // Reduced from 400000 for tighter layout in detail view
            gravity: 120,          // Increased from 80 for better centering in detail view
            initialTemp: 100,      // Reduced from 200 for faster convergence
            numIter: 500          // Reduced from 1000 for faster layout completion
        });

        // Handle layout completion like applyLayout does - fit view after layout completes
        layout.one('layoutstop', () => {
            console.log(`[Transition] Detail layout completed, fitting view to visible elements`);
            this.cy.fit(visibleElements, 50); // Fit to visible elements with padding
        });

        layout.run();
    }

    async loadGlobalGraph(globalData: any): Promise<void> {
        if (!this.cy) return;

        // Set view mode and store global data
        this.viewMode = 'global';
        this.currentEntity = null;
        this.globalGraphData = globalData;
        this.entityGraphData = null;

        console.time('[Perf] Clear existing elements');
        this.cy.elements().remove();
        console.timeEnd('[Perf] Clear existing elements');


        console.time('[Perf] Prepare all data for style-based LOD');
        // Load ALL data initially - style-based LOD will handle visibility
        const allData = this.prepareAllDataWithImportance(globalData);
        console.timeEnd('[Perf] Prepare all data for style-based LOD');
        console.log(`[Perf] Loading ${allData.entities.length} entities, ${allData.relationships.length} relationships for style-based LOD`);

        console.time('[Perf] Convert to Cytoscape elements');
        const elements = this.convertGlobalDataToElements(allData);
        console.timeEnd('[Perf] Convert to Cytoscape elements');

        console.time('[Perf] Add elements to Cytoscape');
        this.cy.add(elements);
        console.timeEnd('[Perf] Add elements to Cytoscape');

        // Pre-compute LOD thresholds for performance
        this.precomputeLODThresholds();

        await this.applyLayoutWithCache('initial');

        this.setupZoomInteractions();

        console.time('[Perf] Fit to view');
        this.cy.fit({ maxZoom: 2.0 }); // Constrain initial fit to prevent oscillation
        console.timeEnd('[Perf] Fit to view');

        // Investigation 1: Measure zoom after fit
        const zoomAfterFit = this.cy.zoom();

        // Apply initial style-based LOD immediately after fit
        console.time('[Perf] Initial style-based LOD');
        this.updateStyleBasedLOD(zoomAfterFit);
        console.timeEnd('[Perf] Initial style-based LOD');
    }

    private async applyLayoutWithCache(cacheKey: string): Promise<void> {
        if (!this.cy) return;

        const nodeCount = this.cy.nodes().length;
        const fullCacheKey = `${cacheKey}_${nodeCount}`;

        // Check if we have cached positions
        if (this.layoutCache.has(fullCacheKey)) {
            console.time('[Perf] Apply cached layout');
            const positions = this.layoutCache.get(fullCacheKey);

            const layout = this.cy.layout({
                name: 'preset',
                positions: (node: any) => positions[node.id()],
                fit: false,        // Prevent layout from fighting viewport control
                animate: false,    // No animation needed for preset positions
                padding: 30
            });

            // Handle layout completion to manually fit view
            layout.one('layoutstop', () => {
                console.log(`[Layout] Cached layout applied, fitting view`);
                this.cy.fit({ maxZoom: 2.0 }); // Constrain fit zoom to prevent oscillation
            });

            layout.run();
            console.timeEnd('[Perf] Apply cached layout');
        } else {
            console.time('[Perf] Calculate new layout');
            await this.calculateAndCacheLayout(fullCacheKey);
            console.timeEnd('[Perf] Calculate new layout');
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
            if (edgeDensity > 0.1) { // Dense graph
                iterations = Math.max(20, iterations / 2);
            }

            console.log(`[Perf] Using ${iterations} iterations for ${nodeCount} nodes, ${edgeCount} edges (density: ${edgeDensity.toFixed(3)})`);

            const layout = this.cy.layout({
                name: 'cose',
                idealEdgeLength: 80,
                nodeOverlap: 20,
                refresh: 20,
                fit: false,               // Prevent layout from fighting viewport control
                animate: 'end',           // Animate only at end to prevent viewport conflicts
                padding: 30,
                randomize: false,
                componentSpacing: 100,
                nodeRepulsion: (node: any) => 400000 * ((node.data('importance') || 0) + 0.1),
                edgeElasticity: (edge: any) => 100 * (edge.data('strength') || 0.5),
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
                }
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
        console.log(`[Perf] Cached layout for ${Object.keys(positions).length} nodes`);
    }

    private setupZoomInteractions(): void {
        if (!this.cy) return;

        // Natural zoom event handling - trust Cytoscape.js defaults
        this.cy.on('zoom', () => {
            const zoom = this.cy.zoom();
            this.zoomEventCount++;

            // Simple logging only - no intervention
            console.log(`[Zoom] Event #${this.zoomEventCount}, zoom: ${zoom.toFixed(3)}`);

            this.eventSequence.push({
                event: 'zoom',
                time: Date.now(),
                zoom: zoom,
                details: { eventNumber: this.zoomEventCount }
            });

            // Smooth 60fps LOD updates
            clearTimeout(this.zoomTimer);
            this.zoomTimer = setTimeout(() => {
                console.time('[Perf] Zoom LOD update');
                this.updateStyleBasedLOD(zoom);
                console.timeEnd('[Perf] Zoom LOD update');
            }, 16); // ~60fps update rate
        });

        // Custom smooth zoom wheel handler to prevent abrupt zoom changes
        this.container.addEventListener('wheel', (event) => {
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

            // Apply smooth zoom
            this.cy.zoom({
                level: newZoom,
                renderedPosition: { x: event.offsetX, y: event.offsetY }
            });
        }, { passive: false }); // Must be non-passive to preventDefault

        // Investigation 4: Event sequence analysis
        ['pan', 'viewport', 'render'].forEach(eventType => {
            this.cy.on(eventType, () => {
                this.eventSequence.push({
                    event: eventType,
                    time: Date.now(),
                    zoom: this.cy.zoom()
                });
            });
        });

        // Custom wheel event handling for delta normalization
        this.container.addEventListener('wheel', (event: WheelEvent) => {
            // Check if we should handle this event (only if it targets the cytoscape container)
            if (!this.cy || event.defaultPrevented) return;

            const originalDelta = event.deltaY;
            const normalizedDelta = this.normalizeWheelDelta(originalDelta);

            // If delta was normalized significantly, we might want to intervene
            if (Math.abs(normalizedDelta - originalDelta) > 10) {
                console.log(`[Zoom] Intercepted extreme wheel delta: ${originalDelta} → ${normalizedDelta}`);
                // Note: For now we just log. Full intervention would require preventing default
                // and manually applying zoom, but this might interfere with Cytoscape's handling
            }
        }, { passive: true });
    }

    /**
     * Style-based LOD using Cytoscape.js best practices
     * Replaces data swapping with style updates for smooth performance
     */
    private updateStyleBasedLOD(zoom: number): void {
        if (!this.cy) return;

        // Validate and clamp zoom value to reasonable bounds
        if (!isFinite(zoom)) {
            console.error(`[Zoom] Non-finite zoom in updateStyleBasedLOD: ${zoom}`);
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

        // Check view mode first
        if (this.viewMode.startsWith('entity')) {
            // In entity view mode - only update styles, no data changes
            console.log(`[Perf] Entity view mode (${this.viewMode}) - style-only LOD update`);
            this.updateEntityViewStyles(zoom);

            // Check if we should transition to global view based on zoom
            if (this.shouldTransitionToGlobal(zoom)) {
                this.initiateGlobalTransition(zoom);
            }
            return;
        }

        // Global view mode - style-based LOD (no data manipulation)
        console.time('[Perf] Style-based LOD update');

        // Use pre-computed thresholds for performance
        const { nodeThreshold, edgeThreshold } = this.getFastLODThresholds(zoom);
        const labelZoomThreshold = this.getLabelZoomThreshold(zoom);

        // Analyze importance distribution for calibration
        const importanceValues = this.cy.nodes().map((node: any) => {
            const importance = node.data('importance') || node.data('computedImportance') || 0;
            const degreeCount = node.data('degreeCount') || 0;
            const centralityScore = node.data('centralityScore') || 0;
            return Math.max(importance, degreeCount / 100, centralityScore);
        }).sort((a: number, b: number) => b - a);

        const importanceStats = {
            min: Math.min(...importanceValues),
            max: Math.max(...importanceValues),
            median: importanceValues[Math.floor(importanceValues.length / 2)],
            p10: importanceValues[Math.floor(importanceValues.length * 0.1)],
            p30: importanceValues[Math.floor(importanceValues.length * 0.3)],
            p60: importanceValues[Math.floor(importanceValues.length * 0.6)],
            p90: importanceValues[Math.floor(importanceValues.length * 0.9)]
        };

        // Calculate expected visible counts for validation
        const expectedVisibleNodes = importanceValues.filter((v: number) => v >= nodeThreshold).length;

        // Use batch for optimal performance
        this.cy.batch(() => {
            let visibleNodes = 0;
            let visibleEdges = 0;

            // Update node visibility based on importance
            this.cy.nodes().forEach((node: any) => {
                const importance = node.data('importance') || node.data('computedImportance') || 0;
                const degreeCount = node.data('degreeCount') || 0;
                const centralityScore = node.data('centralityScore') || 0;

                // Calculate effective importance from available metrics
                const effectiveImportance = Math.max(importance, degreeCount / 100, centralityScore);

                if (effectiveImportance >= nodeThreshold) {
                    node.style('display', 'element');

                    // Show labels based on zoom level and importance
                    const fontSize = this.calculateNodeFontSize(zoom, effectiveImportance);
                    node.style({
                        'font-size': fontSize + 'px',
                        'text-opacity': fontSize > 0 ? 1 : 0
                    });

                    visibleNodes++;
                } else {
                    node.style('display', 'none');
                }
            });

            // Update edge visibility based on confidence and connected node visibility
            this.cy.edges().forEach((edge: any) => {
                const confidence = edge.data('confidence') || edge.data('strength') || edge.data('weight') || 0.5;
                const source = edge.source();
                const target = edge.target();

                // Only show edge if both nodes are visible and confidence meets threshold
                const sourceVisible = source.style('display') === 'element';
                const targetVisible = target.style('display') === 'element';

                if (sourceVisible && targetVisible && confidence >= edgeThreshold) {
                    edge.style('display', 'element');
                    visibleEdges++;
                } else {
                    edge.style('display', 'none');
                }
            });

            console.log(`[Perf] Style LOD: ${visibleNodes} nodes, ${visibleEdges} edges visible`);
        });

        console.timeEnd('[Perf] Style-based LOD update');
    }

    /**
     * Calculate dynamic thresholds based on actual data distribution
     * This adapts to the real importance and confidence scores in the dataset
     */
    private calculateDynamicThresholds(zoom: number): { nodeThreshold: number; edgeThreshold: number } {
        if (!this.cy) return { nodeThreshold: 0, edgeThreshold: 0 };

        // Get target visibility percentages based on zoom level
        const { nodeVisibilityPercentage, edgeVisibilityPercentage } = this.getVisibilityPercentages(zoom);

        // Calculate node importance threshold from actual data
        const importanceValues = this.cy.nodes().map((node: any) => {
            const importance = node.data('importance') || node.data('computedImportance') || 0;
            const degreeCount = node.data('degreeCount') || 0;
            const centralityScore = node.data('centralityScore') || 0;
            return Math.max(importance, degreeCount / 100, centralityScore);
        }).sort((a: number, b: number) => b - a);

        // Calculate edge confidence threshold from actual data
        const confidenceValues = this.cy.edges().map((edge: any) => {
            return edge.data('confidence') || edge.data('strength') || 0.5;
        }).sort((a: number, b: number) => b - a);

        // Get threshold values at target percentiles
        const nodeThresholdIndex = Math.floor(importanceValues.length * nodeVisibilityPercentage);
        const edgeThresholdIndex = Math.floor(confidenceValues.length * edgeVisibilityPercentage);

        const nodeThreshold = importanceValues[Math.min(nodeThresholdIndex, importanceValues.length - 1)] || 0;
        const edgeThreshold = confidenceValues[Math.min(edgeThresholdIndex, confidenceValues.length - 1)] || 0;

        return { nodeThreshold, edgeThreshold };
    }

    /**
     * Get target visibility percentages based on zoom level
     * Progressive disclosure: fewer items visible when zoomed out
     */
    private getVisibilityPercentages(zoom: number): { nodeVisibilityPercentage: number; edgeVisibilityPercentage: number } {
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
    private updateEntityViewStyles(zoom: number): void {
        if (!this.cy) return;

        console.time('[Perf] Entity view style update');

        // In entity view, show all nodes but adjust labels and edge visibility
        const labelThreshold = 0.7; // Show labels when zoomed in
        const edgeThreshold = 0.5;   // Show fewer edges when zoomed out

        this.cy.batch(() => {
            // Only update styles for non-hidden nodes (respect global-only class)
            this.cy.nodes().forEach((node: any) => {
                // Don't show nodes that were hidden during transition
                if (node.hasClass('global-only')) {
                    return; // Skip hidden nodes
                }

                node.style('display', 'element');

                if (zoom > labelThreshold) {
                    const fontSize = Math.min(16, zoom * 12);
                    node.style({
                        'font-size': fontSize + 'px',
                        'text-opacity': 1
                    });
                } else {
                    node.style('text-opacity', 0);
                }
            });

            // Adjust edge visibility based on zoom
            this.cy.edges().forEach((edge: any) => {
                // Don't show edges that were hidden during transition
                if (edge.hasClass('global-only')) {
                    return; // Skip hidden edges
                }

                if (zoom > edgeThreshold) {
                    edge.style('display', 'element');
                } else {
                    // In entity view, only hide low-confidence edges when zoomed out
                    const confidence = edge.data('confidence') || edge.data('strength') || 0.5;
                    edge.style('display', confidence > 0.7 ? 'element' : 'none');
                }
            });
        });

        console.timeEnd('[Perf] Entity view style update');
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
            computedImportance: this.calculateEntityImportance(entity)
        }));

        // Limit to reasonable amount for performance (style-based LOD can handle more than data-based)
        const maxEntities = 1000; // Increased from 200 since style-based LOD is more efficient
        const maxRelationships = 5000; // Increased from 300

        const sortedEntities = entitiesWithImportance
            .sort((a: any, b: any) => b.computedImportance - a.computedImportance)
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
            .sort((a: any, b: any) => (b.confidence || 0.5) - (a.confidence || 0.5))
            .slice(0, maxRelationships);

        return {
            entities: sortedEntities,
            relationships: filteredRelationships
        };
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
            degree / 100,        // Normalize degree
            centrality,
            pagerank,
            0.1                  // Minimum importance
        );
    }

    /**
     * Determine the appropriate view mode based on zoom level and current context
     */
    private determineViewFromZoom(zoom: number): ViewMode {
        // If we have a current entity, use entity-based view modes
        if (this.currentEntity && this.entityGraphData) {
            if (zoom > 1.0) return 'entity-detail';      // Close-up view of entity and immediate neighbors
            if (zoom > 0.5) return 'entity-extended';    // Extended neighborhood
            if (zoom > 0.3) return 'entity-community';   // Community context
        }
        // Otherwise, global view
        return 'global';
    }

    /**
     * Check if we should transition from entity view to global view
     */
    private shouldTransitionToGlobal(zoom: number): boolean {
        // Only transition if:
        // 1. We're in entity view
        // 2. User has zoomed out significantly (< 0.3)
        // 3. We have global data available
        return this.viewMode.startsWith('entity') &&
               zoom < 0.3 &&
               this.globalGraphData !== null;
    }

    /**
     * Initiate a smooth transition from entity view to global view
     */
    private async initiateGlobalTransition(currentZoom: number): Promise<void> {
        if (!this.cy || !this.globalGraphData || this.viewMode === 'transitioning') return;

        console.log('[Transition] Starting transition from entity to global view');
        this.viewMode = 'transitioning';

        // Store current entity position for smooth transition
        const entityNode = this.currentEntity ? this.cy.$(`#${this.currentEntity}`) : null;
        const entityPosition = entityNode && entityNode.length > 0 ? entityNode.position() : null;

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
            const globalOnlyElements = this.cy.$('.global-only');

            if (globalOnlyElements.length === 0) {
                // No global-only elements to restore, need to load full global data
                this.loadFullGlobalData();
                resolve();
                return;
            }

            console.log(`[Transition] Restoring ${globalOnlyElements.length} global-only elements`);

            this.cy.batch(() => {
                globalOnlyElements.forEach((element: any) => {
                    element.removeClass('global-only');
                    element.animate({
                        style: { 'opacity': 1, 'display': 'element' }
                    }, 400);
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
            const detailOnlyElements = this.cy.$('.detail-only');

            if (detailOnlyElements.length === 0) {
                resolve();
                return;
            }

            console.log(`[Transition] Hiding ${detailOnlyElements.length} detail-only elements`);

            this.cy.batch(() => {
                detailOnlyElements.forEach((element: any) => {
                    element.animate({
                        style: { 'opacity': 0, 'display': 'none' }
                    }, 300);
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
        console.time('[Transition] Load global elements');

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

        console.timeEnd('[Transition] Load global elements');
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
                        this.viewMode = 'global';
                        this.currentEntity = null; // Clear current entity in global view
                        console.log('[Transition] Completed transition to global view');
                    }
                });
            } else {
                // Entity not found in global view, just complete the transition
                this.viewMode = 'global';
                this.currentEntity = null;
                console.log('[Transition] Completed transition to global view (entity not found)');
            }
        } else {
            // No entity to focus on, just complete the transition
            this.viewMode = 'global';
            this.currentEntity = null;
            console.log('[Transition] Completed transition to global view');
        }
    }

    /**
     * Initiate a smooth transition from global view to entity detail view
     */
    private async initiateEntityDetailTransition(node: any, entityData: EntityData): Promise<void> {
        if (!this.cy || this.viewMode === 'transitioning') return;

        console.log(`[Transition] Starting transition from global to detail view for entity: ${entityData.name}`);
        this.viewMode = 'transitioning';

        // Store current view state
        const currentZoom = this.cy.zoom();
        const currentPan = this.cy.pan();

        try {
            // Step 1: Smooth zoom to the selected node
            const nodePosition = node.position();
            const targetZoom = Math.max(currentZoom * 2, 1.5); // Zoom in at least 2x or to 1.5x minimum

            await this.animateViewport({
                zoom: targetZoom,
                pan: {
                    x: this.container.offsetWidth / 2 - nodePosition.x * targetZoom,
                    y: this.container.offsetHeight / 2 - nodePosition.y * targetZoom
                }
            }, 600); // 600ms smooth transition

            // Step 2: Load detailed data for the entity
            console.log(`[Transition] Loading detailed data for entity: ${entityData.name}`);

            // Trigger the callback to load detailed entity data
            if (this.entityClickCallback) {
                this.entityClickCallback(entityData);
            }

            // The EntityGraphView will call loadEntityGraph which will complete the transition

        } catch (error) {
            console.error('[Transition] Failed to transition to entity detail view:', error);
            // Restore original view on error
            this.viewMode = 'global';
            this.cy.animate({
                zoom: currentZoom,
                pan: currentPan
            }, 300);
        }
    }

    /**
     * Animate the viewport to a target position and zoom level
     */
    private animateViewport(target: {zoom: number, pan: {x: number, y: number}}, duration: number = 600): Promise<void> {
        return new Promise((resolve) => {
            if (!this.cy) {
                resolve();
                return;
            }

            this.cy.animate({
                zoom: target.zoom,
                pan: target.pan
            }, {
                duration: duration,
                easing: 'ease-out-cubic',
                complete: () => resolve()
            });
        });
    }

    // NOTE: Legacy data-swapping LOD methods removed - replaced with style-based LOD

    private updateLevelOfDetail(zoom: number): void {
        if (!this.cy) return;

        this.cy.batch(() => {
            this.applySophisticatedLOD(zoom);
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
            const visibility = this.calculateNodeVisibility(node, zoom, nodeMetrics);
            this.applyNodeLOD(node, visibility, zoom);
        });

        // Apply context-aware edge visibility
        edges.forEach((edge: any) => {
            const visibility = this.calculateEdgeVisibility(edge, zoom, edgeMetrics);
            this.applyEdgeLOD(edge, visibility, zoom);
        });
    }

    private calculateNodeMetrics(nodes: any): any {
        const importanceValues = nodes.map((n: any) => n.data('importance') || 0);
        const degreeValues = nodes.map((n: any) => n.data('degree') || 0);

        return {
            importancePercentiles: this.calculatePercentiles(importanceValues),
            degreePercentiles: this.calculatePercentiles(degreeValues),
            totalNodes: nodes.length
        };
    }

    private calculateEdgeMetrics(edges: any): any {
        const strengthValues = edges.map((e: any) => e.data('strength') || 0);

        return {
            strengthPercentiles: this.calculatePercentiles(strengthValues),
            totalEdges: edges.length
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
            p90: sorted[Math.floor(len * 0.9)]
        };
    }

    private calculateNodeVisibility(node: any, zoom: number, metrics: any): any {
        const importance = node.data('importance') || 0;
        const degree = node.data('degree') || 0;
        const type = node.data('type') || 'entity';
        const communityId = node.data('communityId');

        // Multi-factor scoring system
        let visibilityScore = 0;

        // Factor 1: Importance (40% weight)
        if (importance >= metrics.importancePercentiles.p90) visibilityScore += 4;
        else if (importance >= metrics.importancePercentiles.p75) visibilityScore += 3;
        else if (importance >= metrics.importancePercentiles.p50) visibilityScore += 2;
        else if (importance >= metrics.importancePercentiles.p25) visibilityScore += 1;

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
        const zoomThresholds = this.getAdaptiveZoomThresholds(zoom, metrics.totalNodes);

        return {
            score: visibilityScore,
            shouldShow: visibilityScore >= zoomThresholds.nodeThreshold,
            shouldLabel: visibilityScore >= zoomThresholds.labelThreshold,
            labelSize: this.calculateLabelSize(visibilityScore, zoom),
            opacity: this.calculateOpacity(visibilityScore, zoom)
        };
    }

    private calculateEdgeVisibility(edge: any, zoom: number, metrics: any): any {
        const strength = edge.data('strength') || 0;
        const type = edge.data('type') || 'related';
        const sourceNode = edge.source();
        const targetNode = edge.target();

        // Check if both nodes are visible
        const sourceVisible = sourceNode.style('display') !== 'none';
        const targetVisible = targetNode.style('display') !== 'none';

        if (!sourceVisible || !targetVisible) {
            return { shouldShow: false, opacity: 0 };
        }

        let visibilityScore = 0;

        // Factor 1: Edge strength
        if (strength >= metrics.strengthPercentiles.p90) visibilityScore += 3;
        else if (strength >= metrics.strengthPercentiles.p75) visibilityScore += 2;
        else if (strength >= metrics.strengthPercentiles.p50) visibilityScore += 1;

        // Factor 2: Edge type importance
        const typeWeight = this.getEdgeTypeWeight(type);
        visibilityScore += typeWeight;

        // Factor 3: Connected node importance
        const nodeImportance = Math.max(
            sourceNode.data('importance') || 0,
            targetNode.data('importance') || 0
        );
        if (nodeImportance > 0.7) visibilityScore += 1;

        const zoomThresholds = this.getAdaptiveZoomThresholds(zoom, metrics.totalEdges);

        return {
            score: visibilityScore,
            shouldShow: visibilityScore >= zoomThresholds.edgeThreshold,
            opacity: Math.min(1, 0.3 + (visibilityScore * 0.2))
        };
    }

    private getTypePriority(type: string): number {
        const priorities: { [key: string]: number } = {
            'person': 3,
            'organization': 3,
            'product': 2,
            'concept': 2,
            'location': 2,
            'technology': 2,
            'event': 1,
            'document': 1,
            'website': 1,
            'topic': 1,
            'related_entity': 0
        };
        return priorities[type] || 0;
    }

    private getEdgeTypeWeight(type: string): number {
        const weights: { [key: string]: number } = {
            'contains': 2,
            'created_by': 2,
            'located_in': 2,
            'works_for': 2,
            'related': 1,
            'mentioned': 0
        };
        return weights[type] || 1;
    }

    private isCommunityhub(node: any, communityId: string): boolean {
        if (!this.cy) return false;

        // Simple heuristic: node is a hub if it has connections to many other nodes in the community
        const communityNodes = this.cy.nodes().filter((n: any) =>
            n.data('communityId') === communityId
        );
        const nodeConnections = node.connectedEdges().length;
        const avgConnections = communityNodes.map((n: any) =>
            n.connectedEdges().length
        ).reduce((a: number, b: number) => a + b, 0) / communityNodes.length;

        return nodeConnections > avgConnections * 1.5;
    }

    private getAdaptiveZoomThresholds(zoom: number, totalElements: number): any {
        // Dynamic thresholds based on zoom level and graph density
        const densityFactor = Math.min(1, totalElements / 1000);

        if (zoom < 0.3) {
            return {
                nodeThreshold: 6 + densityFactor * 2,
                labelThreshold: 8,
                edgeThreshold: 4 + densityFactor
            };
        } else if (zoom < 0.6) {
            return {
                nodeThreshold: 4 + densityFactor,
                labelThreshold: 6,
                edgeThreshold: 3
            };
        } else if (zoom < 1.0) {
            return {
                nodeThreshold: 2,
                labelThreshold: 4,
                edgeThreshold: 2
            };
        } else {
            return {
                nodeThreshold: 0,
                labelThreshold: 2,
                edgeThreshold: 1
            };
        }
    }

    private calculateLabelSize(score: number, zoom: number): number {
        const baseSize = 10;
        const scoreMultiplier = Math.min(1.5, 1 + score * 0.1);
        const zoomMultiplier = Math.min(1.3, zoom);
        return Math.round(baseSize * scoreMultiplier * zoomMultiplier);
    }

    private calculateOpacity(score: number, zoom: number): number {
        const baseOpacity = 0.6;
        const scoreBonus = Math.min(0.4, score * 0.1);
        const zoomBonus = Math.min(0.2, zoom * 0.2);
        return Math.min(1, baseOpacity + scoreBonus + zoomBonus);
    }

    private applyNodeLOD(node: any, visibility: any, zoom: number): void {
        if (visibility.shouldShow) {
            node.style({
                'display': 'element',
                'opacity': visibility.opacity,
                'font-size': visibility.labelSize + 'px'
            });

            if (visibility.shouldLabel) {
                node.style('label', node.data('name'));
            } else {
                node.style('label', '');
            }
        } else {
            node.style('display', 'none');
        }
    }

    private applyEdgeLOD(edge: any, visibility: any, zoom: number): void {
        if (visibility.shouldShow) {
            edge.style({
                'display': 'element',
                'opacity': visibility.opacity
            });
        } else {
            edge.style('display', 'none');
        }
    }

    /**
     * Convert graph data to Cytoscape elements
     */
    private convertToGraphElements(graphData: GraphData): any[] {
        const elements: any[] = [];

        console.time('[Perf] Entity process nodes');
        // Add nodes - validate entity data
        graphData.entities.forEach((entity) => {
            if (entity.name && typeof entity.name === "string") {
                // Calculate default visual properties to avoid Cytoscape warnings
                const entityType = entity.type || "unknown";
                const confidence = entity.confidence || 0.5;

                // Set default colors and sizes based on entity type and confidence
                let color = "#6C7B7F"; // Default gray
                let size = Math.max(20, 30 + confidence * 20); // Size 20-50 based on confidence
                let borderColor = "#4A5568"; // Default border

                // Type-specific styling
                switch (entityType) {
                    case "concept":
                    case "entity":
                        color = "#4299E1"; // Blue
                        borderColor = "#2B6CB0";
                        break;
                    case "website":
                        color = "#48BB78"; // Green
                        borderColor = "#2F855A";
                        break;
                    case "topic":
                        color = "#ED8936"; // Orange
                        borderColor = "#C05621";
                        break;
                    case "unknown":
                    default:
                        color = "#A0AEC0"; // Light gray
                        borderColor = "#718096";
                        break;
                }

                elements.push({
                    group: "nodes",
                    data: {
                        id: entity.name,
                        name: entity.name,
                        type: entityType,
                        confidence: confidence,
                        // Add required visual data fields to prevent Cytoscape warnings
                        color: color,
                        size: size,
                        borderColor: borderColor,
                    },
                });
            } else {
                console.warn("Skipping invalid entity (missing name):", entity);
            }
        });
        console.timeEnd('[Perf] Entity process nodes');
        console.log(`[Perf] Entity processed ${elements.filter(e => e.group === "nodes").length} nodes`);

        console.time('[Perf] Entity process relationships');
        // Add edges - validate relationship data
        let validRelationships = 0;
        let invalidRelationships = 0;

        graphData.relationships.forEach((rel) => {
            if (
                rel.from &&
                rel.to &&
                typeof rel.from === "string" &&
                typeof rel.to === "string"
            ) {
                elements.push({
                    group: "edges",
                    data: {
                        id: `${rel.from}-${rel.to}`,
                        source: rel.from,
                        target: rel.to,
                        type: rel.type || "related",
                        strength: rel.strength || 0.5,
                    },
                });
                validRelationships++;
            } else {
                console.warn(
                    "Skipping invalid relationship (missing from/to):",
                    rel,
                );
                invalidRelationships++;
            }
        });
        console.timeEnd('[Perf] Entity process relationships');
        console.log(`[Perf] Entity processed ${validRelationships} valid relationships, ${invalidRelationships} invalid`);

        return elements;
    }

    private convertGlobalDataToElements(globalData: any): any[] {
        const elements: any[] = [];
        const nodeIds = new Set<string>();

        console.time('[Perf] Process nodes');
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
                            importance: entity.importance || entity.computedImportance || 0,
                            degree: entity.degree || 0,
                            communityId: entity.communityId,
                            color: entity.color || '#999999',
                            borderColor: entity.borderColor || '#333333'
                        }
                    });
                    nodeIds.add(entity.id);
                }
            });
        }
        console.timeEnd('[Perf] Process nodes');
        console.log(`[Perf] Created ${nodeIds.size} nodes`);

        console.time('[Perf] Process edges');
        if (globalData.relationships && globalData.relationships.length > 0) {
            let validRelationships = 0;
            let invalidRelationships = 0;

            // No artificial limit when data is already filtered
            globalData.relationships.forEach((rel: any) => {
                // Support both transformed (from/to) and original (fromEntity/toEntity) field formats
                const sourceId = rel.from || rel.fromEntity;
                const targetId = rel.to || rel.toEntity;
                const relationType = rel.type || rel.relationshipType || "related";

                if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                    elements.push({
                        group: "edges",
                        data: {
                            id: `${sourceId}-${targetId}`,
                            source: sourceId,
                            target: targetId,
                            type: relationType,
                            strength: rel.confidence || 0.5,
                            weight: rel.count || 1
                        }
                    });
                    validRelationships++;
                } else {
                    invalidRelationships++;
                }
            });

            console.log(`[Perf] Created ${validRelationships} valid edges, skipped ${invalidRelationships} invalid`);
        }
        console.timeEnd('[Perf] Process edges');

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
                fit: false,               // Prevent layout from fighting viewport control
                animate: 'end',           // Animate only at end to prevent viewport conflicts
                padding: 30,
                avoidOverlap: true,
                avoidOverlapPadding: 10,
                nodeDimensionsIncludeLabels: false,
                spacingFactor: undefined,
                condense: false,
                rows: undefined,
                cols: undefined,
                position: (node: any) => {
                    return {};
                },
                sort: undefined,
            },
        };

        const layout = this.cy.layout(
            layoutConfigs[layoutName] || layoutConfigs.force,
        );

        // Handle layout completion to manually fit view
        layout.one('layoutstop', () => {
            console.log(`[Layout] ${layoutName} layout completed, fitting view`);
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
     * Show node tooltip
     */
    private showNodeTooltip(node: any, position: any): void {
        const tooltip = this.getOrCreateTooltip();
        const data = node.data();

        tooltip.innerHTML = `
            <div class="tooltip-header">${data.name}</div>
            <div class="tooltip-type">${data.type}</div>
        `;

        tooltip.style.left = `${position.x + 10}px`;
        tooltip.style.top = `${position.y - 10}px`;
        tooltip.style.display = "block";
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

        this.cy.animate({
            center: { eles: node },
            zoom: 2
        }, {
            duration: 500
        });

        this.showLabelsForEntityNeighborhood(node.data('name'), 2);
    }

    private showProgressiveNodeInfo(node: any, position: any): void {
        const data = node.data();
        const tooltip = this.getOrCreateTooltip();

        const connections = node.connectedEdges().length;
        const importance = data.importance || 0;
        const communityInfo = data.communityId ? `Community: ${data.communityId}` : '';

        tooltip.innerHTML = `
            <div class="tooltip-header">${data.name}</div>
            <div class="tooltip-type">${data.type}</div>
            <div class="tooltip-connections">Connections: ${connections}</div>
            <div class="tooltip-importance">Importance: ${Math.round(importance * 100)}%</div>
            ${communityInfo ? `<div class="tooltip-community">${communityInfo}</div>` : ''}
        `;

        tooltip.style.left = `${position.x + 10}px`;
        tooltip.style.top = `${position.y - 10}px`;
        tooltip.style.display = "block";
    }

    private highlightNodeNeighborhood(node: any, depth: number): void {
        if (!this.cy) return;

        const neighborhood = node.neighborhood().union(node);
        this.cy.elements().removeClass('highlighted neighborhood');
        neighborhood.addClass('neighborhood');
        node.addClass('highlighted');
    }

    private clearNeighborhoodHighlights(): void {
        if (!this.cy) return;
        this.cy.elements().removeClass('neighborhood');
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

        this.cy.elements().removeClass('highlighted path-highlighted');
        edge.addClass('path-highlighted');
        sourceNode.addClass('highlighted');
        targetNode.addClass('highlighted');
    }

    private showEdgeDetails(edge: any, position: any): void {
        const data = edge.data();
        const tooltip = this.getOrCreateTooltip();

        const strength = data.strength || 0;
        const type = data.type || 'related';

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
            'line-color': '#FF6B35',
            'width': '4px',
            'z-index': 999
        });
    }

    private deemphasizeAllEdges(): void {
        if (!this.cy) return;
        this.cy.edges().style({
            'line-color': '',
            'width': '',
            'z-index': ''
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

        const menu = document.createElement('div');
        menu.className = 'graph-context-menu';
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
            { label: 'Focus on Node', action: () => this.focusOnNode(node) },
            { label: 'Hide Node', action: () => node.style('display', 'none') },
            { label: 'Expand Neighborhood', action: () => this.expandNodeNeighborhood(node) },
            { label: 'Copy Node Name', action: () => navigator.clipboard.writeText(node.data('name')) }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener('click', () => {
                item.action();
                this.hideContextMenu();
            });
            menuItem.addEventListener('mouseover', () => {
                menuItem.style.backgroundColor = '#f0f0f0';
            });
            menuItem.addEventListener('mouseout', () => {
                menuItem.style.backgroundColor = '';
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Hide menu when clicking elsewhere
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 100);
    }

    private showEdgeContextMenu(edge: any, position: any): void {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'graph-context-menu';
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
            { label: 'Hide Edge', action: () => edge.style('display', 'none') },
            { label: 'Trace Path', action: () => this.highlightEdgePath(edge) },
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener('click', () => {
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 100);
    }

    private showBackgroundContextMenu(position: any): void {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'graph-context-menu';
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
            { label: 'Fit to View', action: () => this.fitToView() },
            { label: 'Reset Layout', action: () => this.applyLayout(this.currentLayout) },
            { label: 'Show All Nodes', action: () => this.showAllNodes() },
            { label: 'Export View', action: () => this.takeScreenshot() }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;
            menuItem.addEventListener('click', () => {
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu.bind(this), { once: true });
        }, 100);
    }

    private hideContextMenu(): void {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }

    private isGraphFocused(): boolean {
        return document.activeElement === this.container ||
               this.container.contains(document.activeElement);
    }

    private handleKeyboardShortcut(evt: KeyboardEvent): void {
        switch (evt.key) {
            case 'f':
                this.fitToView();
                evt.preventDefault();
                break;
            case 'r':
                this.resetView();
                evt.preventDefault();
                break;
            case 'Escape':
                this.clearHighlights();
                this.clearAllSelections();
                evt.preventDefault();
                break;
            case 'a':
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
        console.log(`Expanding neighborhood for node: ${node.data('name')}`);
    }

    private showAllNodes(): void {
        if (!this.cy) return;
        this.cy.nodes().style('display', 'element');
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
    private showLabelsForEntityNeighborhood(entityName: string, maxDegree: number): void {
        if (!this.cy) return;

        const centerNode = this.cy.getElementById(entityName);
        if (centerNode.length === 0) {
            console.warn(`Entity "${entityName}" not found for label enhancement`);
            return;
        }

        // First clear all labels to ensure clean state
        this.cy.nodes().style('text-opacity', 0);

        // Show label for center node with special styling
        centerNode.style({
            'text-opacity': 1,
            'font-weight': 'bold',
            'font-size': '14px',
            'color': '#000',
            'text-background-color': '#ffff99',
            'text-background-opacity': 0.8,
            'text-background-padding': '3px'
        });

        // Find and label nodes within the specified degree range
        const labeledNodes = new Set<string>();
        labeledNodes.add(entityName);

        for (let degree = 1; degree <= maxDegree; degree++) {
            // Get nodes at current degree
            const nodesAtDegree = centerNode.neighborhood().nodes().filter((node: any) => {
                // Simple BFS-style degree calculation
                const distance = centerNode.edgesWith(node).length > 0 ? 1 :
                                centerNode.neighborhood().nodes().some((neighbor: any) =>
                                    neighbor.edgesWith(node).length > 0) ? 2 : 999;
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
                            'text-opacity': 1,
                            'font-weight': 'bold',
                            'font-size': '12px',
                            'color': '#333',
                            'text-background-color': '#e6f3ff',
                            'text-background-opacity': 0.7,
                            'text-background-padding': '2px'
                        });
                    } else if (degree === 2) {
                        // Second degree neighbors - subtle labels
                        node.style({
                            'text-opacity': 1,
                            'font-weight': 'normal',
                            'font-size': '10px',
                            'color': '#666',
                            'text-background-color': '#f0f0f0',
                            'text-background-opacity': 0.5,
                            'text-background-padding': '1px'
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
}
