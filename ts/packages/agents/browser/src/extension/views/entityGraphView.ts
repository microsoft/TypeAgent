// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entity Graph View - Main entry point for entity visualization
import { EntityGraphVisualizer } from "./entityGraphVisualizer.js";
import { EntitySidebar } from "./entitySidebar.js";
import {
    EntityGraphServices,
    EntityCacheServices,
    DefaultEntityGraphServices,
    DefaultEntityCacheServices,
    ChromeExtensionService,
    createExtensionService,
} from "./knowledgeUtilities";

/**
 * Main class for the Entity Graph View page
 */
class EntityGraphView {
    private visualizer: EntityGraphVisualizer;
    private sidebar: EntitySidebar;
    private currentEntity: string | null = null;
    private entityGraphService: EntityGraphServices;
    private entityCacheService: EntityCacheServices;

    constructor() {
        try {
            console.log("EntityGraphView constructor starting...");

            // Initialize services with appropriate extension service based on environment
            const extensionService = createExtensionService();
            this.entityGraphService = new DefaultEntityGraphServices(
                extensionService,
            );
            this.entityCacheService = new DefaultEntityCacheServices();
            console.log(
                "Services initialized with Chrome extension connection",
            );

            // Handle URL parameters to get the entity from query params
            this.handleUrlParameters();

            // Initialize components
            const graphContainer = document.getElementById(
                "cytoscape-container",
            )!;
            const sidebarContainer = document.getElementById("entitySidebar")!;

            if (!graphContainer) {
                throw new Error(
                    "Graph container 'cytoscape-container' not found",
                );
            }
            if (!sidebarContainer) {
                throw new Error("Sidebar container 'entitySidebar' not found");
            }

            console.log("Creating visualizer...");
            this.visualizer = new EntityGraphVisualizer(graphContainer);
            console.log("Creating sidebar...");
            this.sidebar = new EntitySidebar(sidebarContainer);

            console.log(
                "EntityGraphView constructor completed, starting initialization...",
            );
            this.initialize().catch((error: any) => {
                console.error("EntityGraphView initialization failed:", error);
                this.hideGraphLoading();
                this.showGraphError(
                    `Initialization failed: ${error.message || error}`,
                );
            });
        } catch (error) {
            console.error("EntityGraphView constructor failed:", error);
            throw error;
        }
    }

    /**
     * Initialize the entity graph view
     */
    private async initialize(): Promise<void> {
        try {
            // Initialize visualizer
            console.log("Initializing visualizer...");
            await this.visualizer.initialize();
            console.log("Visualizer initialized successfully");

            // Ensure container is visible and has size
            const container = document.getElementById("cytoscape-container");
            if (container) {
                container.style.minHeight = "400px";
                container.style.width = "100%";
                console.log(
                    "Graph container initialized:",
                    container.offsetWidth,
                    "x",
                    container.offsetHeight,
                );
            } else {
                throw new Error("Graph container not found");
            }

            // Set up event handlers
            this.setupEventHandlers();
            this.setupControlHandlers();
            this.setupSearchHandlers();
            this.setupInteractiveHandlers();

            // Load entity from URL - entity parameter is required
            console.log(
                `Current entity after URL parsing: ${this.currentEntity}`,
            );
            if (this.currentEntity) {
                console.log(
                    `Loading specific entity from URL: ${this.currentEntity}`,
                );
                await this.navigateToEntity(this.currentEntity);
            } else {
                console.log(
                    "No entity parameter provided in URL - showing error",
                );
                this.showEntityParameterError();
            }
        } catch (error) {
            console.error("Failed to initialize entity graph view:", error);
            this.showGraphError("Failed to initialize entity graph");
        }
    }

    /**
     * Set up event handlers
     */
    private setupEventHandlers(): void {
        // Entity click navigation
        this.visualizer.onEntityClick((entityData) => {
            this.navigateToEntity(entityData.name);
        });
    }

    /**
     * Set up graph control handlers
     */
    private setupControlHandlers(): void {
        console.log("Setting up control handlers...");

        // Zoom controls
        const zoomInBtn = document.getElementById("zoomInBtn");
        const zoomOutBtn = document.getElementById("zoomOutBtn");
        const fitBtn = document.getElementById("fitBtn");
        const centerBtn = document.getElementById("centerBtn");

        console.log("Control button elements:", {
            zoomInBtn: !!zoomInBtn,
            zoomOutBtn: !!zoomOutBtn,
            fitBtn: !!fitBtn,
            centerBtn: !!centerBtn,
        });

        if (zoomInBtn) {
            zoomInBtn.addEventListener("click", () => {
                console.log("Zoom in button clicked");
                this.visualizer.zoomIn();
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener("click", () => {
                console.log("Zoom out button clicked");
                this.visualizer.zoomOut();
            });
        }

        if (fitBtn) {
            fitBtn.addEventListener("click", () => {
                console.log("Fit to view button clicked");
                this.visualizer.fitToView();
            });
        }

        if (centerBtn) {
            centerBtn.addEventListener("click", () => {
                console.log("Center graph button clicked");
                this.visualizer.centerGraph();
            });
        }

        // Screenshot control
        const screenshotBtn = document.getElementById("screenshotBtn");
        console.log("Screenshot button element:", !!screenshotBtn);

        if (screenshotBtn) {
            screenshotBtn.addEventListener("click", () => {
                console.log("Screenshot button clicked");
                this.takeScreenshot();
            });
        }

        // Export controls
        const exportButton = document.getElementById("exportGraph");
        const exportBtn = document.getElementById("exportBtn");
        console.log("Export button elements:", {
            exportButton: !!exportButton,
            exportBtn: !!exportBtn,
        });

        if (exportButton) {
            exportButton.addEventListener("click", () => {
                console.log("Export graph button clicked");
                this.exportGraph();
            });
        }
        if (exportBtn) {
            exportBtn.addEventListener("click", () => {
                console.log("Export button clicked");
                this.exportGraph();
            });
        }

        // Refresh controls
        const refreshButton = document.getElementById("refreshGraph");
        if (refreshButton) {
            refreshButton.addEventListener("click", () => this.refreshGraph());
        }
    }

    /**
     * Set up search handlers
     */
    private setupSearchHandlers(): void {
        const searchInput = document.getElementById(
            "entitySearch",
        ) as HTMLInputElement;
        const searchButton = document.getElementById(
            "searchButton",
        ) as HTMLButtonElement;

        if (searchInput && searchButton) {
            searchButton.addEventListener("click", () => {
                this.searchEntity(searchInput.value);
            });

            searchInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.searchEntity(searchInput.value);
                }
            });
        }
    }

    /**
     * Handle URL parameters
     */
    private handleUrlParameters(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const entityParam = urlParams.get("entity");

        console.log("Handling URL parameters:", {
            fullUrl: window.location.href,
            search: window.location.search,
            entityParam: entityParam,
        });

        if (entityParam) {
            this.currentEntity = entityParam;
            console.log(`Entity from URL: ${entityParam}`);
            // Update breadcrumb to show entity name
            const entityBreadcrumb = document.getElementById(
                "entityNameBreadcrumb",
            );
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityParam}`;
            }
        } else {
            console.log(
                "No entity parameter found in URL, will use default fallback",
            );
        }
    }

    /**
     * Navigate to a specific entity
     */
    async navigateToEntity(entityName: string): Promise<void> {
        try {
            this.currentEntity = entityName;

            // Update breadcrumb to show entity name
            const entityBreadcrumb = document.getElementById(
                "entityNameBreadcrumb",
            );
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityName}`;
            }

            // Update URL
            const url = new URL(window.location.href);
            url.searchParams.set("entity", entityName);
            window.history.pushState({}, "", url.toString());

            // Load real entity data
            await this.loadRealEntityData(entityName);
        } catch (error) {
            console.error("Failed to navigate to entity:", error);
        }
    }

    /**
     * Set up interactive event handlers
     */
    private setupInteractiveHandlers(): void {
        // Entity navigation from search/sidebar
        document.addEventListener("entityNavigate", (e: any) => {
            this.navigateToEntity(e.detail.entityName);
        });

        // Entity selection from search results
        document.addEventListener("entitySelected", (e: any) => {
            this.navigateToEntity(e.detail.entityName);
        });
    }

    async searchEntity(query: string): Promise<void> {
        if (!query.trim()) return;

        try {
            // Search in real data
            await this.searchRealEntity(query);
        } catch (error) {
            console.error("Failed to search entity:", error);
        }
    }

    /**
     * Export graph
     */
    exportGraph(): void {
        try {
            console.log("Exporting graph data...");
            const graphData = this.visualizer.exportGraph();

            if (!graphData) {
                console.warn("No graph data to export");
                this.showMessage(
                    "No graph data available to export",
                    "warning",
                );
                return;
            }

            console.log("Graph data to export:", {
                nodeCount: graphData.nodes?.length || 0,
                edgeCount: graphData.edges?.length || 0,
                layout: graphData.layout,
                zoom: graphData.zoom,
            });

            const dataStr = JSON.stringify(graphData, null, 2);
            const dataBlob = new Blob([dataStr], { type: "application/json" });

            const link = document.createElement("a");
            link.href = URL.createObjectURL(dataBlob);
            link.download = `entity-graph-${this.currentEntity || "export"}-${new Date().toISOString().split("T")[0]}.json`;
            link.click();

            console.log("Graph exported successfully");
            this.showMessage("Graph exported successfully", "success");
        } catch (error) {
            console.error("Failed to export graph:", error);
            this.showMessage(
                "Failed to export graph: " +
                    (error instanceof Error ? error.message : "Unknown error"),
                "error",
            );
        }
    }

    /**
     * Take screenshot of the graph
     */
    takeScreenshot(): void {
        try {
            const imageData = this.visualizer.takeScreenshot();
            if (imageData) {
                const link = document.createElement("a");
                link.href = imageData;
                link.download = `entity-graph-${this.currentEntity || "screenshot"}.png`;
                link.click();
            } else {
                console.warn("Failed to generate screenshot");
            }
        } catch (error) {
            console.error("Error taking screenshot:", error);
        }
    }

    /**
     * Refresh graph
     */
    async refreshGraph(): Promise<void> {
        if (this.currentEntity) {
            await this.loadRealEntityData(this.currentEntity);
        }
    }

    // UI Helper Methods
    private showGraphLoading(): void {
        const loadingElement = document.getElementById("graphLoading");
        const emptyElement = document.getElementById("graphEmpty");
        const container = document.getElementById("cytoscape-container");

        if (loadingElement) {
            loadingElement.style.display = "flex";
            console.log("Loading state shown");
        }
        if (emptyElement) {
            emptyElement.style.display = "none";
        }
        if (container) {
            container.classList.add("loading");
        }
    }

    private hideGraphLoading(): void {
        const loadingElement = document.getElementById("graphLoading");
        const container = document.getElementById("cytoscape-container");

        if (loadingElement) {
            loadingElement.style.display = "none";
            console.log("Loading state hidden");
        }
        if (container) {
            container.classList.remove("loading");
        }
        // Also hide the empty state when graph loads
        this.hideGraphEmpty();
    }

    private showGraphEmpty(): void {
        const emptyElement = document.getElementById("graphEmpty");
        if (emptyElement) {
            emptyElement.style.display = "flex";
        }
    }

    private hideGraphEmpty(): void {
        const emptyElement = document.getElementById("graphEmpty");
        if (emptyElement) {
            emptyElement.style.display = "none";
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    private showGraphError(message: string): void {
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.innerHTML = `<div class="error-message">${this.escapeHtml(message)}</div>`;
        }
    }

    private showEntityParameterError(): void {
        this.hideGraphLoading();
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.innerHTML = `
                <div class="error-message">
                    <h3>Entity Parameter Required</h3>
                    <p>This page requires an entity parameter in the URL.</p>
                    <p>Please navigate to this page with a URL like:</p>
                    <code>entityGraphView.html?entity=YourEntityName</code>
                    <p style="margin-top: 20px;">
                        <a href="#" onclick="history.back()" style="color: #007acc; text-decoration: underline;">
                            ← Go Back
                        </a>
                    </p>
                </div>
            `;
        }

        // Also show in the empty state area if it exists
        const emptyElement = document.getElementById("graphEmpty");
        if (emptyElement) {
            emptyElement.innerHTML = `
                <div class="empty-state">
                    <h3>Entity Parameter Required</h3>
                    <p>This entity graph view requires an entity name to be specified in the URL parameters.</p>
                    <p><strong>Expected URL format:</strong></p>
                    <code>entityGraphView.html?entity=YourEntityName</code>
                    <p>Please check the URL and try again with a valid entity parameter.</p>
                </div>
            `;
            emptyElement.style.display = "flex";
        }
    }

    // Real data methods
    private async loadRealEntityData(entityName: string): Promise<void> {
        try {
            this.showGraphLoading();
            console.log(`Getting entity graph for: ${entityName} depth: 2`);

            // Load entity graph using enhanced search
            const graphData = await this.entityGraphService.getEntityGraph(
                entityName,
                2,
            );

            console.log(
                `Found ${graphData.entities?.length || 0} websites for center entity`,
            );

            if (graphData.entities && graphData.entities.length > 0) {
                console.log("Expanding graph with related entities...");

                // Process and validate the relationships data
                const validRelationships =
                    graphData.relationships?.filter((r: any) => {
                        // Ensure all required fields are present and not undefined
                        const hasValidFrom =
                            (r.relatedEntity &&
                                typeof r.relatedEntity === "string") ||
                            (r.from && typeof r.from === "string");
                        const hasValidTo =
                            (graphData.centerEntity &&
                                typeof graphData.centerEntity === "string") ||
                            (r.to && typeof r.to === "string");
                        const hasValidType =
                            (r.relationshipType &&
                                typeof r.relationshipType === "string") ||
                            (r.type && typeof r.type === "string");

                        if (!hasValidFrom) {
                            console.warn(
                                "Relationship missing relatedEntity:",
                                r,
                            );
                        }
                        if (!hasValidTo) {
                            console.warn(
                                "Relationship missing centerEntity:",
                                graphData.centerEntity,
                            );
                        }
                        if (!hasValidType) {
                            console.warn(
                                "Relationship missing relationshipType:",
                                r,
                            );
                        }

                        return hasValidFrom && hasValidTo && hasValidType;
                    }) || [];

                console.log(
                    `Generated entity graph: ${graphData.entities.length} entities, ${validRelationships.length} relationships`,
                );

                // Create entity list with center entity, website entities, related entities, and topics
                const allEntities = [
                    // Center entity - get actual type and confidence from graph data
                    {
                        name: graphData.centerEntity,
                        type:
                            this.inferEntityType(graphData.centerEntity) ||
                            "entity",
                        confidence:
                            this.calculateCenterEntityConfidence(
                                graphData.entities,
                            ) || 0.8,
                    },
                    // Website-based entities
                    ...graphData.entities.map((e: any) => ({
                        name: e.name || e.entityName || "Unknown",
                        type: e.type || e.entityType || "website",
                        confidence: e.confidence || 0.5,
                    })),
                    // Related entities from search results
                    ...(graphData.relatedEntities || []).map(
                        (entity: any, index: number) => ({
                            name:
                                typeof entity === "string"
                                    ? entity
                                    : entity.name || entity,
                            type: "related_entity",
                            confidence:
                                typeof entity === "object"
                                    ? entity.confidence || 0.7
                                    : 0.7,
                        }),
                    ),
                    // Top topics as entities
                    ...(graphData.topTopics || []).map(
                        (topic: any, index: number) => ({
                            name:
                                typeof topic === "string"
                                    ? topic
                                    : topic.name || topic,
                            type: "topic",
                            confidence:
                                typeof topic === "object"
                                    ? topic.confidence || 0.6
                                    : 0.6,
                        }),
                    ),
                ];

                // Create entity name set for validation
                const entityNames = new Set(allEntities.map((e) => e.name));

                // Validate and deduplicate relationships
                const validatedRelationships = [];
                const relationshipSet = new Set();

                for (const r of validRelationships) {
                    const from = r.from || r.relatedEntity || "Unknown";
                    const to = r.to || graphData.centerEntity || "Unknown";
                    const type = r.relationshipType || r.type || "related";

                    // Check if both entities exist in the graph
                    if (!entityNames.has(from)) {
                        console.warn(
                            `Dropping relationship - 'from' entity not found in graph:`,
                            from,
                        );
                        continue;
                    }
                    if (!entityNames.has(to)) {
                        console.warn(
                            `Dropping relationship - 'to' entity not found in graph:`,
                            to,
                        );
                        continue;
                    }

                    // Create unique key for deduplication
                    const relationshipKey = `${from}:${to}:${type}`;
                    if (relationshipSet.has(relationshipKey)) {
                        console.warn(`Dropping duplicate relationship:`, {
                            from,
                            to,
                            type,
                        });
                        continue;
                    }

                    relationshipSet.add(relationshipKey);
                    validatedRelationships.push({
                        from,
                        to,
                        type,
                        strength: r.strength || 0.5,
                    });
                }

                // Add relationships from related entities to center
                for (const entity of graphData.relatedEntities || []) {
                    const entityName =
                        typeof entity === "string"
                            ? entity
                            : entity.name || entity;
                    const relationshipKey = `${entityName}:${graphData.centerEntity}:related_to`;
                    if (!relationshipSet.has(relationshipKey)) {
                        relationshipSet.add(relationshipKey);
                        validatedRelationships.push({
                            from: entityName,
                            to: graphData.centerEntity,
                            type: "related_to",
                            strength: 0.8,
                        });
                    }
                }

                // Add relationships from topics to center
                for (const topic of graphData.topTopics || []) {
                    const topicName =
                        typeof topic === "string" ? topic : topic.name || topic;
                    const relationshipKey = `${topicName}:${graphData.centerEntity}:topic_of`;
                    if (!relationshipSet.has(relationshipKey)) {
                        relationshipSet.add(relationshipKey);
                        validatedRelationships.push({
                            from: topicName,
                            to: graphData.centerEntity,
                            type: "topic_of",
                            strength: 0.6,
                        });
                    }
                }

                console.log(
                    `Entity graph: ${allEntities.length} entities, ${validatedRelationships.length} relationships`,
                );
                console.log(
                    `Entity types: websites=${graphData.entities.length}, related=${graphData.relatedEntities?.length || 0}, topics=${graphData.topTopics?.length || 0}`,
                );

                // Load the graph into the visualizer
                await this.visualizer.loadEntityGraph({
                    centerEntity: graphData.centerEntity,
                    entities: allEntities,
                    relationships: validatedRelationships,
                });

                // Load entity data into sidebar using rich graph data
                const centerEntityData = {
                    name: entityName,
                    entityName: entityName,
                    type: this.inferEntityType(entityName) || "entity",
                    entityType: this.inferEntityType(entityName) || "entity",
                    confidence:
                        this.calculateCenterEntityConfidence(
                            graphData.entities,
                        ) || 0.8,
                    source: "graph",
                    topicAffinity: graphData.topTopics || [],
                    summary: graphData.summary,
                    metadata: graphData.metadata,
                    answerSources: graphData.answerSources || [],
                    // Add additional data for sidebar metrics
                    mentionCount: this.calculateTotalMentions(
                        graphData.entities,
                    ),
                    relationships: validRelationships || [],
                    dominantDomains: this.extractDomains(graphData.entities),
                    firstSeen: this.getEarliestDate(graphData.entities),
                    lastSeen: this.getLatestDate(graphData.entities),
                    visitCount: this.calculateTotalVisits(graphData.entities),
                };
                await this.sidebar.loadEntity(centerEntityData);

                this.hideGraphLoading();
                console.log(
                    `Loaded real entity graph for ${entityName}: ${graphData.entities.length} entities, ${validRelationships.length} relationships`,
                );
            } else {
                this.hideGraphLoading();
                this.showGraphError(`No data found for entity: ${entityName}`);
            }
        } catch (error) {
            console.error(" Failed to load real entity data:", error);
            this.hideGraphLoading();
            this.showGraphError(
                "Failed to load entity data. Please try again.",
            );
        }
    }

    private async searchRealEntity(query: string): Promise<void> {
        try {
            console.log(`Searching for real entity: ${query}`);
            this.showMessage(`Searching for "${query}"...`, "info");

            const searchResults = await this.entityGraphService.searchByEntity(
                query,
                {
                    maxResults: 10,
                    includeRelationships: true,
                    sortBy: "relevance",
                },
            );

            if (searchResults.entities && searchResults.entities.length > 0) {
                console.log(
                    `Found ${searchResults.entities.length} entities for search: ${query}`,
                );

                // Navigate to the most relevant result
                const topResult = searchResults.entities[0];
                await this.navigateToEntity(topResult.name);

                // Show search results summary
                this.showMessage(
                    `Found ${searchResults.entities.length} results for "${query}". Showing: ${topResult.name}`,
                    "success",
                );

                console.log(
                    `Real entity search for "${query}" completed successfully`,
                );
            } else {
                console.log(`No results found for search: ${query}`);
                this.showMessage(
                    `No entities found for search: "${query}". Try different keywords or import more website data.`,
                    "warning",
                );
            }
        } catch (error) {
            console.error("Real entity search failed:", error);
            this.showMessage(
                `Search failed for "${query}". ${error instanceof Error ? error.message : "Please try again."}`,
                "error",
            );
        }
    }

    /**
     * Refresh entity data from source
     */
    async refreshEntityData(entityName: string): Promise<void> {
        try {
            this.showGraphLoading();

            // Refresh data using enhanced search
            const refreshedEntity =
                await this.entityGraphService.refreshEntityData(entityName);

            if (refreshedEntity) {
                await this.loadRealEntityData(entityName);
                this.showMessage(`Refreshed data for ${entityName}`, "success");
            } else {
                this.showMessage(
                    `No updated data available for ${entityName}`,
                    "info",
                );
            }
        } catch (error) {
            console.error("Failed to refresh entity data:", error);
            this.showMessage("Failed to refresh entity data", "error");
        } finally {
            this.hideGraphLoading();
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): any {
        return this.entityCacheService.getCacheStats();
    }

    /**
     * Clear all cached data
     */
    async clearCache(): Promise<void> {
        await this.entityCacheService.clearAll();
        this.showMessage("Cache cleared successfully", "success");
    }

    /**
     * Show message to user
     */
    private showMessage(
        message: string,
        type: "success" | "info" | "warning" | "error",
    ): void {
        // This would show a toast or notification
        console.log(`${type.toUpperCase()}: ${message}`);

        // You could implement a toast notification here
        // For now, just log to console
    }

    /**
     * Helper methods for entity data processing
     */
    private inferEntityType(entityName: string): string {
        const lowerName = entityName.toLowerCase();

        // Technology/framework detection
        if (
            lowerName.includes("api") ||
            lowerName.includes("framework") ||
            lowerName.includes("library") ||
            lowerName.includes("javascript") ||
            lowerName.includes("typescript") ||
            lowerName.includes("react") ||
            lowerName.includes("node") ||
            lowerName.includes("python")
        ) {
            return "technology";
        }

        // Organization detection
        if (
            lowerName.includes("corp") ||
            lowerName.includes("inc") ||
            lowerName.includes("company") ||
            lowerName.includes("ltd") ||
            lowerName.includes("microsoft") ||
            lowerName.includes("google")
        ) {
            return "organization";
        }

        // Product detection
        if (
            lowerName.includes("app") ||
            lowerName.includes("tool") ||
            lowerName.includes("platform") ||
            lowerName.includes("service") ||
            lowerName.includes("software")
        ) {
            return "product";
        }

        // Person detection (basic heuristics)
        const words = lowerName.split(" ");
        if (words.length === 2 && /^[A-Z][a-z]+ [A-Z][a-z]+/.test(entityName)) {
            return "person";
        }

        return "concept"; // Default type
    }

    private calculateCenterEntityConfidence(entities: any[]): number {
        if (!entities || entities.length === 0) return 0.8;

        // Calculate average confidence of related entities
        const avgConfidence =
            entities.reduce((sum, entity) => {
                return sum + (entity.confidence || 0.5);
            }, 0) / entities.length;

        // Boost center entity confidence slightly above average
        return Math.min(0.95, avgConfidence + 0.1);
    }

    private calculateTotalMentions(entities: any[]): number {
        if (!entities || entities.length === 0) return 0;

        return entities.reduce((total, entity) => {
            return total + (entity.visitCount || entity.mentionCount || 1);
        }, 0);
    }

    private extractDomains(entities: any[]): string[] {
        if (!entities || entities.length === 0) return [];

        const domains = new Set<string>();
        entities.forEach((entity) => {
            if (entity.url) {
                try {
                    const domain = new URL(entity.url).hostname.replace(
                        "www.",
                        "",
                    );
                    domains.add(domain);
                } catch (e) {
                    // Skip invalid URLs
                }
            }
        });

        return Array.from(domains).slice(0, 5);
    }

    private getEarliestDate(entities: any[]): string {
        if (!entities || entities.length === 0) return new Date().toISOString();

        let earliest: string | null = null;
        entities.forEach((entity) => {
            const date =
                entity.lastVisited || entity.dateAdded || entity.createdAt;
            if (date && (!earliest || date < earliest)) {
                earliest = date;
            }
        });

        return earliest || new Date().toISOString();
    }

    private getLatestDate(entities: any[]): string {
        if (!entities || entities.length === 0) return new Date().toISOString();

        let latest: string | null = null;
        entities.forEach((entity) => {
            const date =
                entity.lastVisited || entity.updatedAt || entity.lastSeen;
            if (date && (!latest || date > latest)) {
                latest = date;
            }
        });

        return latest || new Date().toISOString();
    }

    private calculateTotalVisits(entities: any[]): number {
        if (!entities || entities.length === 0) return 0;

        return entities.reduce((total, entity) => {
            return total + (entity.visitCount || 0);
        }, 0);
    }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new EntityGraphView();
});

// Export for potential external usage
export { EntityGraphView };
