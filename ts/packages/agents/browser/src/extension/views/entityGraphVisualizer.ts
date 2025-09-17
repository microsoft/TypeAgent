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

        // Node click
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

        // Background click
        this.cy.on("tap", (evt: any) => {
            if (evt.target === this.cy) {
                this.clearHighlights();
            }
        });

        // Node hover
        this.cy.on("mouseover", "node", (evt: any) => {
            const node = evt.target;
            this.showNodeTooltip(node, evt.renderedPosition);
        });

        this.cy.on("mouseout", "node", () => {
            this.hideNodeTooltip();
        });
    }

    /**
     * Load entity graph data
     */
    async loadEntityGraph(graphData: GraphData): Promise<void> {
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

        console.time('[Perf] Apply layout');
        await this.applyLayoutWithCache('initial');
        console.timeEnd('[Perf] Apply layout');

        this.setupEnhancedZoomInteractions();

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

    private setupEnhancedZoomInteractions(): void {
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
            this.cy.nodes().forEach((node: any) => {
                const importance = node.data('importance') || 0;
                const degree = node.data('degree') || 0;
                
                if (zoom < 0.5) {
                    if (importance < 0.3 && degree < 5) {
                        node.style('display', 'none');
                    } else {
                        node.style('display', 'element');
                        node.style('label', '');
                    }
                } else if (zoom < 1.0) {
                    node.style('display', 'element');
                    if (importance > 0.5 || degree > 10) {
                        node.style('label', node.data('name'));
                    } else {
                        node.style('label', '');
                    }
                } else {
                    node.style('display', 'element');
                    node.style('label', node.data('name'));
                }
            });

            this.cy.edges().forEach((edge: any) => {
                const strength = edge.data('strength') || 0;
                
                if (zoom < 0.7 && strength < 0.3) {
                    edge.style('display', 'none');
                } else {
                    edge.style('display', 'element');
                }
            });
        });
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
                    if (invalidRelationships <= 5) {
                        console.log(`[Graph Debug] Missing entity for relationship: ${sourceId} -> ${targetId}, has source: ${nodeIds.has(sourceId)}, has target: ${nodeIds.has(targetId)}`);
                    }
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
            <div class="tooltip-confidence">Confidence: ${(data.confidence * 100).toFixed(0)}%</div>
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
