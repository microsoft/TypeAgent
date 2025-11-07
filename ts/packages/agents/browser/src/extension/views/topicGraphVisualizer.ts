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

interface TopicGraphLayoutData {
    presetLayout: {
        elements: any[];
        layoutDuration?: number;
        communityCount?: number;
        avgSpacing?: number;
        metadata?: any;
    };
    centerTopic?: string;
}

export class TopicGraphVisualizer {
    protected cy: any = null;
    private container: HTMLElement;
    protected currentLayout: string = "dagre";
    private topicClickCallback: ((topic: TopicData) => void) | null = null;

    private currentTopic: string | null = null;
    private topicGraphData: TopicGraphLayoutData | null = null;

    // Level of detail management
    private visibleLevels: Set<number> = new Set([0, 1, 2]); // Show first 3 levels by default

    private zoomHandlerSetup: boolean = false;

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
            // Use preset layout element count instead of raw topic count
            const nodeCount = this.cy ? this.cy.nodes().length : 0;

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
     * Phase 3: Now accepts TopicGraphLayoutData for optimized data transfer
     */
    public async init(data: TopicGraphLayoutData): Promise<void> {
        this.topicGraphData = data;

        if (!this.cy) {
            const rendererConfig = this.getOptimalRendererConfig();
            this.cy = cytoscape({
                container: this.container,
                style: this.getOptimizedTopicGraphStyles(),
                layout: { name: "preset" },
                elements: [],
                renderer: rendererConfig,
                minZoom: 0.25,
                maxZoom: 4.0,
                wheelSensitivity: 0.15,
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
    private async loadData(data: TopicGraphLayoutData): Promise<void> {
        await this.loadDataIntoInstance(this.cy, data);
    }

    /**
     * Load data into a specific Cytoscape instance with batch operations for performance
     */
    private async loadDataIntoInstance(
        instance: any,
        data: TopicGraphLayoutData,
    ): Promise<void> {
        // Require server-side graphology layout - no client-side fallback
        if (!data.presetLayout?.elements) {
            throw new Error(
                "Server-side graphology layout is required but not available",
            );
        }

        console.log(
            `[TopicGraphVisualizer] Using graphology preset layout with ${data.presetLayout.elements.length} elements`,
        );
        console.log(
            `[TopicGraphVisualizer] Layout computed in ${data.presetLayout.layoutDuration?.toFixed(0)}ms, ` +
                `${data.presetLayout.communityCount} communities detected`,
        );

        const elements = data.presetLayout.elements;

        // Use batch operations for better performance
        instance.batch(() => {
            instance.elements().remove();
            instance.add(elements);
        });

        // Apply preset layout - server-side layout is required
        await this.applyPresetLayout(instance);

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
     * Apply preset layout to a specific instance
     */
    private async applyPresetLayout(instance: any): Promise<void> {
        return new Promise((resolve) => {
            const layoutConfig = {
                name: "preset",
                fit: false,
                animate: false,
            };

            console.log(
                "[TopicGraphVisualizer] Applying preset layout (using pre-computed positions)",
            );

            const layout = instance.layout(layoutConfig);
            layout.on("layoutstop", () => {
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
        if (!this.cy) return [];

        const lowerQuery = query.toLowerCase();
        const results: TopicData[] = [];

        // Search through Cytoscape elements instead of raw topic data
        this.cy.nodes('[nodeType="topic"]').forEach((node: any) => {
            const data = node.data();
            const name = data.label || data.name || "";
            const keywords = data.keywords || [];

            if (
                name.toLowerCase().includes(lowerQuery) ||
                keywords.some((keyword: string) =>
                    keyword.toLowerCase().includes(lowerQuery),
                )
            ) {
                results.push({
                    id: data.id,
                    name: name,
                    level: data.level || 0,
                    confidence: data.confidence || 0,
                    keywords: keywords,
                    entityReferences: data.entityReferences || [],
                    parentId: data.parentId,
                    childCount: data.childCount || 0,
                });
            }
        });

        return results;
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
     * Resize the graph container to handle layout changes
     */
    public resize(): void {
        if (this.cy) {
            // Force DOM to update before resize
            requestAnimationFrame(() => {
                if (this.cy) {
                    this.cy.resize();
                    // Force coordinate system recalculation
                    this.cy.forceRender();
                }
            });
        }
    }

    /**
     * Get current graph statistics
     */
    public getGraphStats(): any {
        if (!this.cy) return null;

        const topicNodes = this.cy.nodes('[nodeType="topic"]');
        return {
            totalTopics: topicNodes.length,
            visibleTopics: topicNodes.length,
            maxDepth: 0, // Server handles depth calculation
            visibleLevels: Array.from(this.visibleLevels),
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
