// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entity Graph View - Main entry point for entity visualization
import { EntityGraphVisualizer } from "./entityGraphVisualizer.js";
import { EntitySidebar } from "./entitySidebar.js";
import {
    ChromeExtensionService,
    createExtensionService,
} from "./knowledgeUtilities";
import {
    GraphDataProvider,
    GraphDataProviderImpl,
} from "./graphDataProvider.js";

/**
 * Main class for the Entity Graph View page
 */
interface ViewMode {
    type: 'global' | 'entity-specific';
    centerEntity?: string;
    centerTopic?: string;
}

class EntityGraphView {
    private visualizer: EntityGraphVisualizer;
    private sidebar: EntitySidebar;
    private currentEntity: string | null = null;
    private currentViewMode: ViewMode = { type: 'global' };
    private graphDataProvider: GraphDataProvider;

    constructor() {
        try {
            console.log("EntityGraphView constructor starting...");

            // Initialize services with appropriate extension service based on environment
            const extensionService = createExtensionService();

            // Initialize Graph data provider for direct storage access
            this.graphDataProvider = new GraphDataProviderImpl(extensionService);
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

            // Load based on view mode
            console.log(`Current view mode: ${this.currentViewMode.type}`);
            
            if (this.currentViewMode.type === 'entity-specific' && this.currentEntity) {
                console.log(`Loading specific entity: ${this.currentEntity}`);
                this.updateSidebarVisibility(true);
                await this.navigateToEntity(this.currentEntity);
            } else if (this.currentViewMode.type === 'global') {
                console.log("Loading global knowledge graph");
                this.updateSidebarVisibility(false);
                await this.loadGlobalView();
            } else {
                console.log("Invalid state - showing error");
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

        // Back to global button
        const backToGlobalBtn = document.getElementById("backToGlobalBtn");
        if (backToGlobalBtn) {
            backToGlobalBtn.addEventListener("click", () => {
                console.log("Back to global button clicked");
                this.navigateToGlobalView();
            });
        }
    }

    /**
     * Set up search handlers
     */
    private setupSearchHandlers(): void {
        const searchInput = document.getElementById(
            "entitySearchInput",
        ) as HTMLInputElement;
        const searchButton = document.getElementById(
            "entitySearchButton",
        ) as HTMLButtonElement;

        console.log("Setting up search handlers:", {
            searchInput: !!searchInput,
            searchButton: !!searchButton,
        });

        if (searchInput && searchButton) {
            const performSearch = () => {
                const query = searchInput.value.trim();
                if (query) {
                    console.log("Performing search with value:", query);
                    this.searchEntity(query);
                    // Clear the input after successful search initiation
                    searchInput.value = "";
                } else {
                    this.showMessage(
                        "Please enter an entity name to search",
                        "warning",
                    );
                }
            };

            searchButton.addEventListener("click", performSearch);

            searchInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault(); // Prevent form submission
                    performSearch();
                }
            });

            // Optional: Add focus behavior for better UX
            searchInput.addEventListener("focus", () => {
                searchInput.select(); // Select all text when focused
            });
        } else {
            console.warn("Search elements not found:", {
                searchInputFound: !!searchInput,
                searchButtonFound: !!searchButton,
            });
        }
    }

    /**
     * Handle URL parameters
     */
    private handleUrlParameters(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const entityParam = urlParams.get("entity");
        const topicParam = urlParams.get("topic");
        const modeParam = urlParams.get("mode");

        console.log("Handling URL parameters:", {
            fullUrl: window.location.href,
            search: window.location.search,
            entityParam: entityParam,
            topicParam: topicParam,
            modeParam: modeParam,
        });

        this.currentViewMode = this.determineViewMode();

        if (this.currentViewMode.type === 'entity-specific') {
            this.currentEntity = this.currentViewMode.centerEntity || this.currentViewMode.centerTopic || null;
            
            if (this.currentEntity) {
                console.log(`${entityParam ? 'Entity' : 'Topic'} from URL: ${this.currentEntity}`);
                const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
                if (entityBreadcrumb) {
                    entityBreadcrumb.textContent = ` > ${this.currentEntity}`;
                }
            }
        } else {
            console.log("Global mode detected - will show full knowledge graph");
            const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = " > Global View";
            }
        }
    }

    private determineViewMode(): ViewMode {
        const urlParams = new URLSearchParams(window.location.search);
        const entityParam = urlParams.get("entity");
        const topicParam = urlParams.get("topic");
        const modeParam = urlParams.get("mode");
        
        if (modeParam === 'global' || (!entityParam && !topicParam)) {
            return { type: 'global' };
        }
        
        return { 
            type: 'entity-specific',
            centerEntity: entityParam || undefined,
            centerTopic: topicParam || undefined
        };
    }

    /**
     * Navigate to a specific entity
     */
    async navigateToEntity(entityName: string): Promise<void> {
        try {
            this.currentEntity = entityName;
            this.currentViewMode = { type: 'entity-specific', centerEntity: entityName };

            const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityName}`;
            }

            const backToGlobalBtn = document.getElementById("backToGlobalBtn");
            if (backToGlobalBtn) {
                backToGlobalBtn.style.display = "flex";
            }

            const url = new URL(window.location.href);
            url.searchParams.set("entity", entityName);
            url.searchParams.delete("mode");
            window.history.pushState({}, "", url.toString());

            this.updateSidebarVisibility(true);
            await this.loadRealEntityData(entityName);
        } catch (error) {
            console.error("Failed to navigate to entity:", error);
        }
    }

    async navigateToGlobalView(): Promise<void> {
        try {
            this.currentEntity = null;
            this.currentViewMode = { type: 'global' };

            const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = " > Global View";
            }

            const backToGlobalBtn = document.getElementById("backToGlobalBtn");
            if (backToGlobalBtn) {
                backToGlobalBtn.style.display = "none";
            }

            const url = new URL(window.location.href);
            url.searchParams.delete("entity");
            url.searchParams.delete("topic");
            url.searchParams.set("mode", "global");
            window.history.pushState({}, "", url.toString());

            this.updateSidebarVisibility(false);
            await this.loadGlobalView();
        } catch (error) {
            console.error("Failed to navigate to global view:", error);
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
            // Navigate directly to the entity (same as URL parameter logic)
            console.log(`Searching for entity: ${query}`);
            this.showMessage(`Loading entity "${query}"...`, "info");

            await this.navigateToEntity(query.trim());

            // Show success message
            this.showMessage(`Loaded entity: "${query}"`, "success");
        } catch (error) {
            console.error("Failed to search entity:", error);
            this.showMessage(
                `Failed to load entity "${query}". ${error instanceof Error ? error.message : "Please try again."}`,
                "error",
            );
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

    private updateSidebarVisibility(visible: boolean): void {
        const sidebar = document.getElementById("entitySidebar");
        const graphContainer = document.getElementById("cytoscape-container");
        
        if (sidebar && graphContainer) {
            if (visible) {
                sidebar.style.display = 'block';
                graphContainer.style.width = 'calc(100% - 400px)';
            } else {
                sidebar.style.display = 'none';
                graphContainer.style.width = '100%';
            }
            
            if (this.visualizer) {
                setTimeout(() => this.visualizer.resize(), 100);
            }
        }
    }

    private async loadGlobalView(): Promise<void> {
        try {
            console.time('[Perf] Total global view load');
            this.showGraphLoading();
            console.log("Loading global knowledge graph");

            console.time('[Perf] Fetch global data');
            const globalData = await this.loadGlobalGraphData();
            console.timeEnd('[Perf] Fetch global data');
            console.log(`[Perf] Data stats: ${globalData.statistics.totalEntities} entities, ${globalData.statistics.totalRelationships} relationships, ${globalData.statistics.totalCommunities} communities`);

            if (globalData.statistics.totalEntities === 0) {
                this.hideGraphLoading();
                this.showGraphEmpty();
                console.timeEnd('[Perf] Total global view load');
                return;
            }

            console.time('[Perf] Visualizer loadGlobalGraph');
            await this.visualizer.loadGlobalGraph(globalData);
            console.timeEnd('[Perf] Visualizer loadGlobalGraph');

            this.hideGraphLoading();

            console.log(`Loaded global graph: ${globalData.statistics.totalEntities} entities, ${globalData.statistics.totalRelationships} relationships, ${globalData.statistics.totalCommunities} communities`);
            console.timeEnd('[Perf] Total global view load');
        } catch (error) {
            console.error("Failed to load global view:", error);
            this.hideGraphLoading();
            this.showGraphError("Failed to load global knowledge graph");
            console.timeEnd('[Perf] Total global view load');
        }
    }

    private async loadGlobalGraphData(): Promise<any> {
        console.time('[Perf] HybridGraph global data fetch');
        console.log('[HybridGraph] Fetching global graph data');

        // Use Graph data provider for direct storage access
        const globalGraphResult = await this.graphDataProvider.getGlobalGraphData();

        console.timeEnd('[Perf] HybridGraph global data fetch');
        console.log(`[HybridGraph] Loaded ${globalGraphResult.entities.length} entities, ${globalGraphResult.relationships.length} relationships`);

        // Process communities for color assignment
        const processedCommunities = globalGraphResult.communities.map((c: any) => ({
            ...c,
            entities: typeof c.entities === 'string' ? JSON.parse(c.entities || "[]") : (c.entities || []),
            topics: typeof c.topics === 'string' ? JSON.parse(c.topics || "[]") : (c.topics || [])
        }));

        // Assign community colors to entities
        const entitiesWithColors = this.assignCommunityColors(globalGraphResult.entities, processedCommunities);

        // Return data in format expected by existing UI components
        return {
            communities: processedCommunities,
            entities: entitiesWithColors,
            relationships: globalGraphResult.relationships,
            topics: [],
            statistics: {
                totalEntities: globalGraphResult.statistics.totalEntities,
                totalRelationships: globalGraphResult.statistics.totalRelationships,
                totalCommunities: globalGraphResult.statistics.communities
            }
        };
    }

    private assignCommunityColors(entities: any[], communities: any[]): any[] {
        const communityColors = [
            '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', 
            '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
            '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
            '#c49c94', '#f7b6d3', '#c7c7c7', '#dbdb8d', '#9edae5'
        ];

        const communityColorMap = new Map<string, string>();
        communities.forEach((community, index) => {
            const colorIndex = index % communityColors.length;
            communityColorMap.set(community.id || `community_${index}`, communityColors[colorIndex]);
        });

        return entities.map(entity => ({
            ...entity,
            color: communityColorMap.get(entity.communityId) || '#999999',
            borderColor: this.getBorderColor(communityColorMap.get(entity.communityId) || '#999999')
        }));
    }

    private getBorderColor(color: string): string {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return '#333333';
        
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const imageData = ctx.getImageData(0, 0, 1, 1);
        const [r, g, b] = imageData.data;
        
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? '#333333' : '#ffffff';
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
            console.time('[Perf] Total entity view load');
            this.showGraphLoading();
            console.log(`Getting entity graph for: ${entityName} depth: 8`);

            console.time('[Perf] Entity graph data fetch');
            // Load entity graph using HybridGraph data provider
            let graphData;
            try {
                console.log(`[HybridGraph Migration] Using Graph data provider for entity "${entityName}" neighborhood`);
                const neighborhoodResult = await this.graphDataProvider.getEntityNeighborhood(entityName, 2, 100);

                // Also fetch search data for sidebar enrichment (topics, domains, facets, etc.)
                console.time('[Perf] Entity View - Search enrichment data');
                let searchData: any = null;
                try {
                    const extensionService = createExtensionService();
                    searchData = await (extensionService as any).searchByEntities([entityName], "", 10);
                    console.timeEnd('[Perf] Entity View - Search enrichment data');
                    console.log(`[HybridGraph Migration] Fetched search enrichment data: ${searchData?.websites?.length || 0} websites, ${searchData?.topTopics?.length || 0} topics`);
                } catch (searchError) {
                    console.timeEnd('[Perf] Entity View - Search enrichment data');
                    console.warn(`[HybridGraph Migration] Could not fetch search enrichment data:`, searchError);
                }

                // Transform HybridGraph result to expected format with enrichment
                console.time('[Perf] Entity View - Combine graph and search data');
                graphData = {
                    centerEntity: neighborhoodResult.centerEntity.name,
                    entities: [neighborhoodResult.centerEntity, ...neighborhoodResult.neighbors],
                    relationships: neighborhoodResult.relationships,
                    relatedEntities: neighborhoodResult.neighbors,
                    topTopics: searchData?.topTopics || [],
                    summary: searchData?.summary || null,
                    metadata: {
                        ...neighborhoodResult.metadata,
                        ...(searchData?.metadata || {})
                    },
                    answerSources: searchData?.answerSources || []
                };

                // Enrich center entity with search data if available
                if (searchData?.websites?.length > 0 && graphData.entities.length > 0) {
                    const firstWebsite = searchData.websites[0];
                    // Add enrichment data as properties to avoid TypeScript errors
                    const enrichedEntity: any = {
                        ...graphData.entities[0],
                        properties: {
                            ...(graphData.entities[0].properties || {}),
                            facets: firstWebsite.facets || [],
                            aliases: firstWebsite.aliases || [],
                            description: firstWebsite.description,
                            url: firstWebsite.url,
                            domains: firstWebsite.domains || []
                        }
                    };
                    graphData.entities[0] = enrichedEntity;
                }
                console.timeEnd('[Perf] Entity View - Combine graph and search data');

                console.log(`[HybridGraph Migration] Entity neighborhood loaded: ${graphData.entities.length} entities, ${graphData.relationships.length} relationships, ${graphData.topTopics?.length || 0} topics`);
            } catch (error) {
                console.error(`[HybridGraph Migration] Failed to load entity neighborhood for "${entityName}":`, error);
                // Return empty graph data on error
                graphData = {
                    centerEntity: entityName,
                    entities: [],
                    relationships: [],
                    relatedEntities: [],
                    topTopics: [],
                    metadata: { error: error instanceof Error ? error.message : "Unknown error" }
                };
            }
            console.timeEnd('[Perf] Entity graph data fetch');
            console.log(`[Perf] Entity data: ${graphData.entities?.length || 0} entities, ${graphData.relationships?.length || 0} relationships`);

            console.log(
                `Found ${graphData.entities?.length || 0} websites for center entity`,
            );

            if (graphData.entities && graphData.entities.length > 0) {
                console.log("Expanding graph with related entities...");

                console.time('[Perf] Entity View - Data processing and validation');
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
                    // Website-based entities - mark as documents
                    ...graphData.entities.map((e: any) => ({
                        name: e.name || e.entityName || "Unknown",
                        type: e.url
                            ? "document"
                            : e.type || e.entityType || "website",
                        confidence: e.confidence || 0.5,
                        url: e.url,
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
                    const from = r.from || (r as any).relatedEntity || "Unknown";
                    const to = r.to || graphData.centerEntity || "Unknown";
                    const type = r.type || (r as any).relationshipType || "related";

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
                console.timeEnd('[Perf] Entity View - Data processing and validation');

                console.time('[Perf] Entity View - Graph visualization');
                // Load the graph into the visualizer
                await this.visualizer.loadEntityGraph({
                    centerEntity: graphData.centerEntity,
                    entities: allEntities,
                    relationships: validatedRelationships,
                }, graphData.centerEntity);
                console.timeEnd('[Perf] Entity View - Graph visualization');

                // Find the center entity from allEntities (should be first)
                const centerEntityFromGraph =
                    graphData.entities.find(
                        (e: any) =>
                            e.id === "center" || e.category === "center",
                    ) || graphData.entities[0]; // Fallback to first entity which should be center

                // Load entity data into sidebar using rich graph data
                const centerEntityData = {
                    name: entityName,
                    entityName: entityName,
                    type: centerEntityFromGraph.type,
                    entityType: centerEntityFromGraph.type,
                    confidence:
                        centerEntityFromGraph.confidence ||
                        this.calculateCenterEntityConfidence(
                            graphData.entities,
                        ) ||
                        0.8,
                    source: "graph",
                    // Include facets from the entity properties if available
                    facets: centerEntityFromGraph?.properties?.facets || (centerEntityFromGraph as any)?.facets || [],
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
                    firstSeen: this.getEarliestDate(
                        // TODO: limit this to "contains" relationships
                        graphData.entities,
                        validatedRelationships,
                    ),
                    lastSeen: this.getLatestDate(
                        graphData.entities,
                        validatedRelationships,
                    ),
                    visitCount: this.calculateTotalVisits(graphData.entities),
                };

                console.time('[Perf] Entity sidebar load');
                await this.sidebar.loadEntity(centerEntityData);
                console.timeEnd('[Perf] Entity sidebar load');

                this.hideGraphLoading();
                console.log(
                    `Loaded real entity graph for ${entityName}: ${graphData.entities.length} entities, ${validRelationships.length} relationships`,
                );
                console.timeEnd('[Perf] Total entity view load');
            } else {
                this.hideGraphLoading();
                this.showGraphError(`No data found for entity: ${entityName}`);
                console.timeEnd('[Perf] Total entity view load');
            }
        } catch (error) {
            console.error(" Failed to load real entity data:", error);
            this.hideGraphLoading();
            this.showGraphError(
                "Failed to load entity data. Please try again.",
            );
            console.timeEnd('[Perf] Total entity view load');
        }
    }

    private async searchRealEntity(query: string): Promise<void> {
        try {
            console.log(`Searching for real entity: ${query}`);
            this.showMessage(`Searching for "${query}"...`, "info");

            // Use direct entity neighborhood query for search
            const neighborhoodResult = await this.graphDataProvider.getEntityNeighborhood(query, 2, 10);
            const searchResults = {
                entities: neighborhoodResult.neighbors.length > 0 ?
                    [{ name: query }, ...neighborhoodResult.neighbors.slice(0, 9)] :
                    [{ name: query }]
            };

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

            // Refresh data by re-fetching entity neighborhood
            const refreshedEntity = await this.graphDataProvider.getEntityNeighborhood(entityName, 2, 100);

            if (refreshedEntity && refreshedEntity.neighbors.length > 0) {
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
            return (
                total +
                (entity.visitCount ||
                    entity.occurrenceCount ||
                    entity.mentionCount ||
                    1)
            );
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

    private getEarliestDate(entities: any[], relationships: any[]): string {
        if (!entities || entities.length === 0) return new Date().toISOString();

        const containsRelationships = relationships.filter(
            (r) => r.type === "contains",
        );
        const entityNamesInContainsRelationships = new Set(
            containsRelationships.map((r) => r.to),
        );

        let earliest: string | null = null;
        entities.forEach((entity) => {
            if (entityNamesInContainsRelationships.has(entity.name)) {
                const date =
                    entity.lastVisited || entity.dateAdded || entity.createdAt;
                if (date && (!earliest || date < earliest)) {
                    earliest = date;
                }
            }
        });

        return earliest || new Date().toISOString();
    }

    private getLatestDate(entities: any[], relationships: any[]): string {
        if (!entities || entities.length === 0) return new Date().toISOString();

        const containsRelationships = relationships.filter(
            (r) => r.type === "contains",
        );
        const entityNamesInContainsRelationships = new Set(
            containsRelationships.map((r) => r.to),
        );

        let latest: string | null = null;
        entities.forEach((entity) => {
            if (entityNamesInContainsRelationships.has(entity.name)) {
                const date =
                    entity.lastVisited || entity.updatedAt || entity.lastSeen;
                if (date && (!latest || date > latest)) {
                    latest = date;
                }
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
