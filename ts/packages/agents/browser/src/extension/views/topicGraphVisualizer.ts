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

    // Graph data provider for API calls
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
     * Initialize the topic graph with data
     */
    public async init(data: TopicGraphData): Promise<void> {
        this.topicGraphData = data;

        if (!this.cy) {
            const rendererConfig = this.getOptimalRendererConfig();
            this.cy = cytoscape({
                container: this.container,
                style: this.getOptimizedTopicGraphStyles(),
                layout: { name: 'preset' },
                elements: [],
                renderer: rendererConfig,
                minZoom: 0.25,
                maxZoom: 4.0,
                zoomingEnabled: true,
                userZoomingEnabled: true,
                panningEnabled: true,
                userPanningEnabled: true,
                boxSelectionEnabled: false,
                autoungrabify: false,
            });
            this.setupEventHandlers();
        }

        await this.loadData(data);
    }


    /**
     * Set graph data provider for API calls
     */
    public setGraphDataProvider(provider: any): void {
        this.graphDataProvider = provider;
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

        // Calculate dynamic co-occurrence threshold
        const coOccursThreshold = this.calculateCoOccursThreshold(
            data.relationships,
        );

        // Add relationship edges
        for (const rel of data.relationships) {
            // Only add edges if both nodes are visible
            const sourceVisible = elements.some(
                (el) => el.data.id === rel.from,
            );
            const targetVisible = elements.some((el) => el.data.id === rel.to);

            if (sourceVisible && targetVisible) {
                // Performance optimization: filter edges
                // Only show top 20% strongest co_occurs edges
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
                console.log(`[TopicGraphVisualizer] Computing CoSE layout...`);
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
            console.warn(
                "[TopicGraphVisualizer] No Cytoscape instance available",
            );
            return;
        }

        this.prototypeModeEnabled = enabled;

        if (enabled) {
            console.log(
                "[TopicGraphVisualizer] Enabling prototype mode - disabling LoD, showing all elements",
            );

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

            console.log(
                `[TopicGraphVisualizer] Prototype mode enabled - ${this.cy.nodes().length} nodes, ${this.cy.edges().length} edges visible`,
            );
        } else {
            console.log(
                "[TopicGraphVisualizer] Disabling prototype mode",
            );
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
