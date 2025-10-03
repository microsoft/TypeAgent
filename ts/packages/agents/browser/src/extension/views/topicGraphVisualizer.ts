// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Topic Graph Visualizer - Cytoscape.js integration for hierarchical topic visualization
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
    type: "parent-child" | "related-to" | "derived-from";
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

    // View mode and data management
    private viewMode: TopicViewMode = "tree";
    private currentTopic: string | null = null;
    private topicGraphData: TopicGraphData | null = null;
    private expandedNodes: Set<string> = new Set();

    // Level of detail management
    private visibleLevels: Set<number> = new Set([0, 1, 2]); // Show first 3 levels by default
    private maxVisibleDepth: number = 3;

    // LOD (Level of Detail) system for hierarchical zoom
    private lodThresholds: Map<
        number,
        { nodeThreshold: number; edgeThreshold: number; visibleLevels: number }
    > = new Map();
    private currentZoom: number = 1.0;
    private lastLodUpdate: number = 0;
    private lodUpdateInterval: number = 16; // ~60fps
    private zoomHandlerSetup: boolean = false;

    constructor(container: HTMLElement) {
        this.container = container;
        this.initializeLODThresholds();
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

        if (!this.cy) {
            this.initializeCytoscape();
        }

        await this.loadData(data);
        this.setupEventHandlers();
    }

    /**
     * Initialize Cytoscape instance
     */
    private initializeCytoscape(): void {
        this.cy = cytoscape({
            container: this.container,
            style: this.getOptimizedTopicGraphStyles(),
            layout: this.getLayoutOptions(),
            elements: [],
            minZoom: 0.25,
            maxZoom: 4.0,
            wheelSensitivity: 0.1,
            zoomingEnabled: true,
            userZoomingEnabled: true,
            panningEnabled: true,
            userPanningEnabled: true,
            boxSelectionEnabled: false,
            selectionType: "single",
        });

        // Set up zoom event handler for LOD
        this.setupZoomHandler();
    }

    /**
     * Setup zoom handler for Level of Detail updates
     */
    private setupZoomHandler(): void {
        if (this.zoomHandlerSetup || !this.cy) return;

        this.cy.on("zoom", () => {
            const zoom = this.cy.zoom();
            this.currentZoom = zoom;

            // Throttle LOD updates
            const now = Date.now();
            if (now - this.lastLodUpdate < this.lodUpdateInterval) return;
            this.lastLodUpdate = now;

            // Apply LOD based on zoom level
            this.applyLevelOfDetail(zoom);
        });

        this.zoomHandlerSetup = true;
    }

    /**
     * Apply Level of Detail based on zoom level
     */
    private applyLevelOfDetail(zoom: number): void {
        if (!this.cy) return;

        // Get LOD settings for current zoom
        const lodSettings = this.getLODSettings(zoom);

        // Update visible hierarchy depth
        this.updateVisibleHierarchyDepth(lodSettings.visibleLevels);

        // Update node and edge visibility based on importance
        this.updateElementVisibility(zoom, lodSettings);

        // Update label visibility
        this.updateLabelVisibility(zoom);
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
     * Update element visibility based on importance and zoom
     */
    private updateElementVisibility(zoom: number, lodSettings: any): void {
        if (!this.cy) return;

        // Calculate visibility based on node importance (confidence * (1 / (level + 1)))
        this.cy.nodes().forEach((node: any) => {
            if (node.style("display") === "none") return; // Skip hidden nodes

            const confidence = node.data("confidence") || 0.5;
            const level = node.data("level") || 0;
            const childCount = node.data("childCount") || 0;

            // Calculate importance score
            const importance =
                confidence * (1 / (level + 1)) * (1 + childCount * 0.1);

            // Determine if node should be visible at this zoom
            if (importance >= lodSettings.nodeThreshold) {
                node.addClass("visible-at-zoom");
                node.removeClass("hidden-at-zoom");
            } else {
                node.addClass("hidden-at-zoom");
                node.removeClass("visible-at-zoom");
            }
        });
    }

    /**
     * Update label visibility based on zoom
     */
    private updateLabelVisibility(zoom: number): void {
        if (!this.cy) return;

        // Progressive label visibility
        if (zoom < 0.5) {
            // Hide all labels at very low zoom
            this.cy.style().selector("node").style("text-opacity", 0).update();
        } else if (zoom < 1.0) {
            // Show only level 0 labels
            this.cy
                .style()
                .selector("node")
                .style("text-opacity", 0)
                .selector(".level-0")
                .style("text-opacity", 1)
                .update();
        } else if (zoom < 1.5) {
            // Show level 0 and 1 labels
            this.cy
                .style()
                .selector("node")
                .style("text-opacity", 0)
                .selector(".level-0, .level-1")
                .style("text-opacity", 1)
                .update();
        } else {
            // Show all visible node labels
            this.cy
                .style()
                .selector("node.visible-at-zoom")
                .style("text-opacity", 1)
                .selector("node.hidden-at-zoom")
                .style("text-opacity", 0)
                .update();
        }
    }

    /**
     * Load topic data into the graph
     */
    private async loadData(data: TopicGraphData): Promise<void> {
        const elements = this.convertToTopicElements(data);

        this.cy.elements().remove();
        this.cy.add(elements);

        // Apply layout
        await this.applyLayout();

        // Focus on center topic if specified
        if (data.centerTopic) {
            this.focusOnTopic(data.centerTopic);
        } else {
            this.cy.fit();
        }

        // Apply initial LOD based on current zoom
        const initialZoom = this.cy.zoom();
        this.applyLevelOfDetail(initialZoom);
    }

    /**
     * Convert topic data to Cytoscape elements
     */
    private convertToTopicElements(data: TopicGraphData): any[] {
        const elements: any[] = [];

        // Add topic nodes
        for (const topic of data.topics) {
            if (this.visibleLevels.has(topic.level)) {
                elements.push({
                    data: {
                        id: topic.id,
                        label: topic.name,
                        level: topic.level,
                        confidence: topic.confidence,
                        keywords: topic.keywords,
                        entityReferences: topic.entityReferences,
                        parentId: topic.parentId,
                        childCount: topic.childCount,
                        nodeType: "topic",
                    },
                    classes: this.getTopicClasses(topic),
                });
            }
        }

        // Add relationship edges
        for (const rel of data.relationships) {
            // Only add edges if both nodes are visible
            const sourceVisible = elements.some(
                (el) => el.data.id === rel.from,
            );
            const targetVisible = elements.some((el) => el.data.id === rel.to);

            if (sourceVisible && targetVisible) {
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
     * Get base topic graph styles matching entity graph patterns
     */
    private getBaseTopicStyles(): any[] {
        return [
            // Base node performance optimizations
            {
                selector: "node",
                style: {
                    "min-zoomed-font-size": 8,
                    "text-opacity": 1,
                    "transition-property": "none",
                    "transition-duration": 0,
                    events: "yes",
                },
            },

            // Topic nodes
            {
                selector: 'node[nodeType="topic"]',
                style: {
                    "background-color": "#FF6B9D",
                    width: "mapData(confidence, 0, 1, 30, 80)",
                    height: "mapData(confidence, 0, 1, 30, 80)",
                    label: "data(label)",
                    "text-valign": "bottom",
                    "text-margin-y": 5,
                    "font-size": "12px",
                    "font-weight": "bold",
                    color: "#333",
                    "text-wrap": "wrap",
                    "text-max-width": 80,
                    "border-width": 2,
                    "border-color": "#E5507A",
                    "min-zoomed-font-size": 8,
                    "text-opacity": 1,
                    "transition-property": "none",
                    "transition-duration": 0,
                },
            },

            // Level-specific styling with entity graph consistency
            {
                selector: ".level-0",
                style: {
                    "background-color": "#4A90E2",
                    "border-color": "#1565C0",
                    shape: "roundrectangle",
                    width: 90,
                    height: 90,
                    "font-size": "14px",
                    "font-weight": "bold",
                    "z-index": 1000,
                },
            },
            {
                selector: ".level-1",
                style: {
                    "background-color": "#7ED321",
                    "border-color": "#388E3C",
                    shape: "ellipse",
                    width: 70,
                    height: 70,
                    "font-size": "12px",
                    "z-index": 900,
                },
            },
            {
                selector: ".level-2",
                style: {
                    "background-color": "#F5A623",
                    "border-color": "#F57C00",
                    shape: "diamond",
                    width: 50,
                    height: 50,
                    "font-size": "11px",
                    "z-index": 800,
                },
            },
            {
                selector: ".level-3",
                style: {
                    "background-color": "#BD10E0",
                    "border-color": "#9013FE",
                    shape: "triangle",
                    width: 40,
                    height: 40,
                    "font-size": "10px",
                    "z-index": 700,
                },
            },
            {
                selector: ".level-4",
                style: {
                    "background-color": "#50E3C2",
                    "border-color": "#4ECDC4",
                    shape: "pentagon",
                    width: 35,
                    height: 35,
                    "font-size": "9px",
                    "z-index": 600,
                },
            },

            // Confidence-based styling with importance indicators
            {
                selector: ".high-confidence",
                style: {
                    "border-width": 4,
                    opacity: 1.0,
                    "overlay-padding": 3,
                    "overlay-opacity": 0.1,
                    "overlay-color": "#000",
                },
            },
            {
                selector: ".medium-confidence",
                style: {
                    "border-width": 3,
                    opacity: 0.85,
                },
            },
            {
                selector: ".low-confidence",
                style: {
                    "border-width": 2,
                    opacity: 0.7,
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

            // Expanded/collapsed states
            {
                selector: ".has-children",
                style: {
                    "border-style": "double",
                },
            },
            {
                selector: ".expanded",
                style: {
                    "background-opacity": 0.9,
                },
            },

            // Edge base styles optimized for performance
            {
                selector: "edge",
                style: {
                    width: "mapData(strength, 0, 1, 1, 4)",
                    "line-color": "#999",
                    "target-arrow-color": "#999",
                    "target-arrow-shape": "triangle",
                    "curve-style": "haystack",
                    "haystack-radius": 0.5,
                    opacity: 0.7,
                    "transition-property": "none",
                    "transition-duration": 0,
                },
            },

            // Edge types with entity graph consistency
            {
                selector: ".edge-parent-child",
                style: {
                    "line-color": "#4A90E2",
                    "target-arrow-color": "#4A90E2",
                    "line-style": "solid",
                    width: 3,
                    opacity: 0.9,
                },
            },
            {
                selector: ".edge-related-to",
                style: {
                    "line-color": "#7ED321",
                    "target-arrow-color": "#7ED321",
                    "line-style": "dashed",
                    "line-dash-pattern": [6, 3],
                    width: 2,
                    opacity: 0.7,
                },
            },
            {
                selector: ".edge-derived-from",
                style: {
                    "line-color": "#F5A623",
                    "target-arrow-color": "#F5A623",
                    "line-style": "dotted",
                    "line-dash-pattern": [2, 2],
                    width: 2,
                    opacity: 0.6,
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
     * Get layout options based on current view mode
     */
    private getLayoutOptions(): any {
        switch (this.viewMode) {
            case "tree":
                return {
                    name: "dagre",
                    rankDir: "TB",
                    nodeSep: 80,
                    rankSep: 120,
                    spacingFactor: 1.2,
                };
            case "radial":
                return {
                    name: "breadthfirst",
                    circle: true,
                    spacingFactor: 2.0,
                    avoidOverlap: true,
                };
            case "force":
                return {
                    name: "cose",
                    idealEdgeLength: 150,
                    nodeOverlap: 20,
                    nodeRepulsion: 8000,
                    edgeElasticity: 100,
                };
            default:
                return { name: "grid" };
        }
    }

    /**
     * Apply current layout
     */
    private async applyLayout(): Promise<void> {
        return new Promise((resolve) => {
            const layout = this.cy.layout(this.getLayoutOptions());
            layout.on("layoutstop", () => resolve());
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
        const newElements = [];
        for (const topic of childTopics) {
            if (!this.cy.getElementById(topic.id).length) {
                newElements.push({
                    data: {
                        id: topic.id,
                        label: topic.name,
                        level: topic.level,
                        confidence: topic.confidence,
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
            this.cy.add(newElements);
            this.applyLayout();

            // Reapply LOD to ensure new nodes respect visibility rules
            this.applyLevelOfDetail(this.currentZoom);
        }
    }

    /**
     * Collapse children of a topic
     */
    private collapseTopicChildren(topicId: string): void {
        const childNodes = this.cy.nodes().filter((node: any) => {
            return node.data("parentId") === topicId;
        });

        childNodes.remove();
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
     * Change view mode
     */
    public setViewMode(mode: TopicViewMode): void {
        if (mode !== this.viewMode) {
            this.viewMode = mode;
            this.applyLayout();
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
     * Cleanup and dispose
     */
    public dispose(): void {
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
    }
}
