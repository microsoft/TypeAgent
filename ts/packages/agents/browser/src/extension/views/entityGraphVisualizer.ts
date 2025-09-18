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

/**
 * Entity Graph Visualizer using Cytoscape.js
 */
export class EntityGraphVisualizer {
    protected cy: any = null;
    private container: HTMLElement;
    protected currentLayout: string = "force";
    private entityClickCallback: ((entity: EntityData) => void) | null = null;
    private fullGraphData: any = null;
    private layoutCache: Map<string, any> = new Map();
    private zoomTimer: any = null;
    private isUpdatingLOD: boolean = false;
    private isNodeBeingDragged: boolean = false;
    private layoutUpdateTimer: any = null;
    private selectedNodes: Set<string> = new Set();
    private contextMenu: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
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

        // Initialize cytoscape instance with performance optimizations
        this.cy = cytoscape({
            container: this.container,
            elements: [],
            style: this.getOptimizedStyles(),
            layout: { name: "grid" },
            // Performance optimizations
            pixelRatio: 1,                    // Lower resolution for better performance
            motionBlur: false,                // Disable motion blur
            textureOnViewport: true,          // Cache rendered texture
            hideEdgesOnViewport: true,        // Hide edges during pan/zoom
            wheelSensitivity: 0.2,            // Slower zoom for smoother LOD updates
            // Standard settings
            zoomingEnabled: true,
            userZoomingEnabled: true,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
            autoungrabify: false,
        });

        this.setupInteractions();
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

            if (this.entityClickCallback) {
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
                this.cy!.zoom(currentZoom * zoomFactor);
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

        console.time('[Perf] Entity clear elements');
        // Clear existing elements
        this.cy.elements().remove();
        console.timeEnd('[Perf] Entity clear elements');

        console.time('[Perf] Entity convert to elements');
        // Convert data to Cytoscape format
        const elements = this.convertToGraphElements(graphData);
        console.timeEnd('[Perf] Entity convert to elements');
        console.log(`[Perf] Entity graph: ${elements.filter(e => e.group === "nodes").length} nodes, ${elements.filter(e => e.group === "edges").length} edges`);

        console.time('[Perf] Entity add elements');
        // Add elements to graph
        this.cy.add(elements);
        console.timeEnd('[Perf] Entity add elements');

        console.time('[Perf] Entity apply layout');
        // Apply layout
        this.applyLayout(this.currentLayout);
        console.timeEnd('[Perf] Entity apply layout');

        console.time('[Perf] Entity fit to view');
        // Fit to view
        this.cy.fit();
        console.timeEnd('[Perf] Entity fit to view');

        // Center on entity and show labels if specified
        if (centerEntityName) {
            this.centerOnEntityWithLabels(centerEntityName);
        }
    }

    async loadGlobalGraph(globalData: any): Promise<void> {
        if (!this.cy) return;

        console.time('[Perf] Clear existing elements');
        this.cy.elements().remove();
        console.timeEnd('[Perf] Clear existing elements');

        // Store full data for LOD updates
        this.fullGraphData = globalData;

        console.time('[Perf] Filter data for initial render');
        const filteredData = this.filterForInitialRender(globalData);
        console.timeEnd('[Perf] Filter data for initial render');
        console.log(`[Perf] Filtered to ${filteredData.entities.length} entities, ${filteredData.relationships.length} relationships for initial render`);

        console.time('[Perf] Convert to Cytoscape elements');
        const elements = this.convertGlobalDataToElements(filteredData);
        console.timeEnd('[Perf] Convert to Cytoscape elements');

        console.time('[Perf] Add elements to Cytoscape');
        this.cy.add(elements);
        console.timeEnd('[Perf] Add elements to Cytoscape');

        await this.applyLayoutWithCache('initial');

        this.setupZoomInteractions();

        console.time('[Perf] Fit to view');
        this.cy.fit();
        console.timeEnd('[Perf] Fit to view');
    }

    private filterForInitialRender(globalData: any): any {
        const MAX_INITIAL_NODES = 200;
        const MAX_INITIAL_EDGES = 300; // Reduced from 500 to avoid dense graph

        // Sort entities by importance (use degree, size, or centrality as available)
        const sortedEntities = (globalData.entities || [])
            .map((entity: any) => ({
                ...entity,
                computedImportance: (entity.importance || 0) +
                                   (entity.degree || 0) / 100 +
                                   (entity.size || 0) / 100
            }))
            .sort((a: any, b: any) => b.computedImportance - a.computedImportance)
            .slice(0, MAX_INITIAL_NODES);

        const entityIds = new Set(sortedEntities.map((e: any) => e.id));

        // Only include relationships between visible entities
        const filteredRelationships = (globalData.relationships || [])
            .filter((r: any) => entityIds.has(r.fromEntity) && entityIds.has(r.toEntity))
            .slice(0, MAX_INITIAL_EDGES);

        return {
            ...globalData,
            entities: sortedEntities,
            relationships: filteredRelationships
        };
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
                fit: true,
                padding: 30
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
                fit: true,
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

        this.cy.on('zoom', () => {
            clearTimeout(this.zoomTimer);
            this.zoomTimer = setTimeout(() => {
                console.time('[Perf] Zoom LOD update');
                const zoom = this.cy.zoom();
                this.updateLevelOfDetailWithData(zoom);
                console.timeEnd('[Perf] Zoom LOD update');
            }, 100); // Debounce zoom events
        });
    }

    private updateLevelOfDetailWithData(zoom: number): void {
        if (!this.cy || !this.fullGraphData) {
            // Fallback to style-only LOD if no full data
            this.updateLevelOfDetail(zoom);
            return;
        }

        // Prevent multiple simultaneous LOD updates
        if (this.isUpdatingLOD) {
            console.log(`[Perf] LOD update skipped - already in progress`);
            return;
        }

        const currentNodeCount = this.cy.nodes().length;
        const targetNodeCount = this.getTargetNodeCount(zoom);
        const maxAvailableNodes = this.fullGraphData.entities?.length || 0;

        // Cap target to available data
        const actualTarget = Math.min(targetNodeCount, maxAvailableNodes);

        // Only update if we can actually change the node count significantly
        const canIncrease = actualTarget > currentNodeCount * 1.2; // Can add 20% more nodes
        const shouldDecrease = actualTarget < currentNodeCount * 0.8; // Should remove 20% of nodes

        if (canIncrease || shouldDecrease) {
            this.isUpdatingLOD = true;
            console.log(`[Perf] LOD update: ${currentNodeCount} -> ${actualTarget} nodes at zoom ${zoom.toFixed(2)} (max available: ${maxAvailableNodes})`);

            console.time('[Perf] LOD data filtering');
            const filteredData = this.filterDataForZoomLevel(zoom);
            console.timeEnd('[Perf] LOD data filtering');

            // Check if filtered data actually changed
            if (filteredData.entities.length !== currentNodeCount) {
                console.time('[Perf] LOD element update');
                this.updateGraphElements(filteredData);
                console.timeEnd('[Perf] LOD element update');
            } else {
                console.log(`[Perf] LOD skipped - same node count after filtering`);
                // Just update visibility/labels
                this.updateLevelOfDetail(zoom);
            }

            this.isUpdatingLOD = false;
        } else {
            // Just update visibility/labels
            this.updateLevelOfDetail(zoom);
        }
    }

    private getTargetNodeCount(zoom: number): number {
        if (zoom < 0.3) return 100;   // Very zoomed out - top entities only
        if (zoom < 0.6) return 300;   // Zoomed out - important entities
        if (zoom < 1.0) return 600;   // Medium zoom - more entities
        if (zoom < 1.5) return 1000;  // Zoomed in - most entities (realistic max)
        return 1200;                  // Very zoomed in - all available entities (with buffer)
    }

    private filterDataForZoomLevel(zoom: number): any {
        if (!this.fullGraphData) return { entities: [], relationships: [] };

        const targetCount = this.getTargetNodeCount(zoom);

        // Sort and filter entities
        const sortedEntities = (this.fullGraphData.entities || [])
            .map((entity: any) => ({
                ...entity,
                computedImportance: (entity.importance || 0) +
                                   (entity.degree || 0) / 100 +
                                   (entity.size || 0) / 100
            }))
            .sort((a: any, b: any) => b.computedImportance - a.computedImportance)
            .slice(0, targetCount);

        const entityIds = new Set(sortedEntities.map((e: any) => e.id));

        // Limit relationships based on zoom level
        // Too many edges make layout calculation exponentially slower
        const maxEdges = this.getMaxEdgesForZoom(zoom);

        // Filter and limit relationships
        const filteredRelationships = (this.fullGraphData.relationships || [])
            .filter((r: any) => entityIds.has(r.fromEntity) && entityIds.has(r.toEntity))
            .sort((a: any, b: any) => (b.confidence || 0.5) - (a.confidence || 0.5))
            .slice(0, maxEdges);

        console.log(`[Perf] Filtered to ${sortedEntities.length} nodes and ${filteredRelationships.length} edges for zoom ${zoom.toFixed(2)}`);

        return {
            entities: sortedEntities,
            relationships: filteredRelationships
        };
    }

    private getMaxEdgesForZoom(zoom: number): number {
        if (zoom < 0.3) return 200;    // Very zoomed out - minimal edges
        if (zoom < 0.6) return 800;    // Zoomed out - some edges
        if (zoom < 1.0) return 2000;   // Medium zoom - more edges
        if (zoom < 1.5) return 5000;   // Zoomed in - many edges
        return 10000;                  // Very zoomed in - most edges
    }

    private updateGraphElements(filteredData: any): void {
        if (!this.cy) return;

        // Store current viewport
        const viewport = {
            zoom: this.cy.zoom(),
            pan: this.cy.pan()
        };

        // Update elements
        this.cy.batch(() => {
            this.cy.elements().remove();
            const elements = this.convertGlobalDataToElements(filteredData);
            this.cy.add(elements);
        });

        // Use a more specific cache key and avoid layout thrashing
        const nodeCount = filteredData.entities.length;
        const cacheKey = `nodes_${nodeCount}`;

        // Only apply layout if we don't have a cache or if significant node count change
        if (this.layoutCache.has(cacheKey)) {
            console.time('[Perf] Apply cached layout');
            const positions = this.layoutCache.get(cacheKey);

            // Apply preset layout immediately (no async)
            const layout = this.cy.layout({
                name: 'preset',
                positions: (node: any) => positions[node.id()],
                fit: false, // Don't auto-fit to avoid viewport changes
                padding: 30
            });

            layout.run();
            console.timeEnd('[Perf] Apply cached layout');

            // Restore viewport immediately
            this.cy.viewport(viewport);
        } else {
            // Calculate new layout only if cache miss
            this.calculateAndCacheLayout(cacheKey).then(() => {
                // Restore viewport after layout
                this.cy.viewport(viewport);
            });
        }
    }

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
                elements.push({
                    group: "nodes",
                    data: {
                        id: entity.name,
                        name: entity.name,
                        type: entity.type || "unknown",
                        confidence: entity.confidence || 0.5,
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
                const sourceId = rel.fromEntity;
                const targetId = rel.toEntity;

                if (nodeIds.has(sourceId) && nodeIds.has(targetId)) {
                    elements.push({
                        group: "edges",
                        data: {
                            id: `${sourceId}-${targetId}`,
                            source: sourceId,
                            target: targetId,
                            type: rel.relationshipType || "related",
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
            force: {
                name: "cose",
                idealEdgeLength: 100,
                nodeOverlap: 20,
                refresh: 20,
                fit: true,
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
            },
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
                fit: true,
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
                animate: false,
            },
        };

        const layout = this.cy.layout(
            layoutConfigs[layoutName] || layoutConfigs.force,
        );
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
            this.cy.zoom(1.5);
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
            this.cy.fit();
        }
    }

    /**
     * Zoom in the graph
     */
    zoomIn(): void {
        console.log("zoomIn() called, cy instance exists:", !!this.cy);
        if (this.cy) {
            const currentZoom = this.cy.zoom();
            console.log(
                "Current zoom:",
                currentZoom,
                "-> New zoom:",
                currentZoom * 1.25,
            );
            this.cy.zoom(currentZoom * 1.25);
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
            console.log(
                "Current zoom:",
                currentZoom,
                "-> New zoom:",
                currentZoom * 0.8,
            );
            this.cy.zoom(currentZoom * 0.8);
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
            this.cy.fit();
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
            this.cy.fit();
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
