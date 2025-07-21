// Entity Graph View - Main entry point for entity visualization
import { EnhancedEntityGraphVisualizer } from "./enhancedEntityGraphVisualizer.js";
import { EntitySidebar } from "./entitySidebar.js";
import { EntityDiscovery } from "./entityDiscovery.js";
import { MultiHopExplorer } from "./multiHopExplorer.js";
import { RelationshipDetailsManager } from "./relationshipDetailsManager.js";
import { EntityComparisonManager } from "./entityComparison.js";
import {
    EntityGraphServices,
    EntityCacheServices,
    DefaultEntityGraphServices,
    DefaultEntityCacheServices,
    ChromeExtensionService,
} from "./knowledgeUtilities";

/**
 * Main class for the Entity Graph View page
 */
class EntityGraphView {
    private visualizer: EnhancedEntityGraphVisualizer;
    private sidebar: EntitySidebar;
    private discovery: EntityDiscovery;
    private multiHopExplorer: MultiHopExplorer;
    private relationshipManager: RelationshipDetailsManager;
    private comparisonManager: EntityComparisonManager;
    private currentEntity: string | null = null;
    private entityGraphService: EntityGraphServices;
    private entityCacheService: EntityCacheServices;

    constructor() {
        try {
            console.log("EntityGraphView constructor starting...");
            
            // Initialize services with Chrome extension connection
            const chromeService = new ChromeExtensionService();
            this.entityGraphService = new DefaultEntityGraphServices(chromeService);
            this.entityCacheService = new DefaultEntityCacheServices();
            console.log("Services initialized with Chrome extension connection");

            // Handle URL parameters to get the entity from query params
            this.handleUrlParameters();

            // Initialize components
            const graphContainer = document.getElementById("cytoscape-container")!;
            const sidebarContainer = document.getElementById("entitySidebar")!;

            if (!graphContainer) {
                throw new Error("Graph container 'cytoscape-container' not found");
            }
            if (!sidebarContainer) {
                throw new Error("Sidebar container 'entitySidebar' not found");
            }

            console.log("Creating visualizer...");
            this.visualizer = new EnhancedEntityGraphVisualizer(graphContainer);
            console.log("Creating sidebar...");
            this.sidebar = new EntitySidebar(sidebarContainer);

            // Initialize interactive components with real data support
            console.log("Creating discovery component...");
            this.discovery = new EntityDiscovery(this.entityGraphService);
            console.log("Creating multi-hop explorer...");
            this.multiHopExplorer = new MultiHopExplorer(
                this.visualizer,
                this.entityGraphService,
            );
            console.log("Creating relationship manager...");
            this.relationshipManager = new RelationshipDetailsManager();
            console.log("Creating comparison manager...");
            this.comparisonManager = new EntityComparisonManager();

            console.log("EntityGraphView constructor completed, starting initialization...");
            this.initialize().catch((error: any) => {
                console.error("EntityGraphView initialization failed:", error);
                this.hideGraphLoading();
                this.showGraphError(`Initialization failed: ${error.message || error}`);
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
                console.log("Graph container initialized:", container.offsetWidth, "x", container.offsetHeight);
            } else {
                throw new Error("Graph container not found");
            }

            // Set up event handlers
            this.setupEventHandlers();
            this.setupControlHandlers();
            this.setupLayoutControls();
            this.setupSearchHandlers();
            this.setupInteractiveHandlers();

            // Load entity from URL - entity parameter is required
            console.log(`Current entity after URL parsing: ${this.currentEntity}`);
            if (this.currentEntity) {
                console.log(`Loading specific entity from URL: ${this.currentEntity}`);
                await this.navigateToEntity(this.currentEntity);
            } else {
                console.log("No entity parameter provided in URL - showing error");
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
        // Export controls
        const exportButton = document.getElementById("exportGraph");
        if (exportButton) {
            exportButton.addEventListener("click", () => this.exportGraph());
        }

        // Refresh controls
        const refreshButton = document.getElementById("refreshGraph");
        if (refreshButton) {
            refreshButton.addEventListener("click", () => this.refreshGraph());
        }
    }

    /**
     * Set up layout controls
     */
    private setupLayoutControls(): void {
        const layoutControls = document.querySelectorAll(".layout-btn");
        layoutControls.forEach((control) => {
            control.addEventListener("click", (e) => {
                const target = e.target as HTMLElement;
                const layout = target.dataset.layout;
                if (layout) {
                    this.changeLayout(layout);
                }
            });
        });
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
            entityParam: entityParam
        });

        if (entityParam) {
            this.currentEntity = entityParam;
            console.log(`Entity from URL: ${entityParam}`);
            // Update breadcrumb to show entity name
            const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityParam}`;
            }
        } else {
            console.log("No entity parameter found in URL, will use default fallback");
        }
    }

    /**
     * Navigate to a specific entity
     */
    async navigateToEntity(entityName: string): Promise<void> {
        try {
            this.currentEntity = entityName;

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
        // Entity navigation from discovery
        document.addEventListener("entityNavigate", (e: any) => {
            this.navigateToEntity(e.detail.entityName);
        });

        // Entity selection from discovery
        document.addEventListener("entitySelected", (e: any) => {
            this.navigateToEntity(e.detail.entityName);
        });

        // Cluster exploration
        document.addEventListener("clusterExplore", (e: any) => {
            this.exploreCluster(e.detail.clusterId);
        });

        // Discovery path following
        document.addEventListener("pathFollow", (e: any) => {
            this.followDiscoveryPath(e.detail.pathId);
        });

        // Entity comparison requests
        document.addEventListener("requestEntityComparison", (e: any) => {
            this.comparisonManager.startComparison(e.detail.entities);
        });

        // Edge/relationship clicks for details
        this.visualizer.onEdgeClick((edgeData: any) => {
            this.relationshipManager.showRelationshipDetails(edgeData);
        });

        // Sidebar entity navigation
        document.addEventListener("entityNavigate", (e: any) => {
            if (e.target.closest(".entity-sidebar")) {
                this.navigateToEntity(e.detail.entityName);
            }
        });
    }

    /**
     * Explore a cluster
     */
    private async exploreCluster(clusterId: string): Promise<void> {
        try {
            console.log("Exploring cluster:", clusterId);
            // This would load and visualize the cluster
            // For now, just show a message
            this.showMessage(`Exploring cluster: ${clusterId}`, "info");
        } catch (error) {
            console.error("Failed to explore cluster:", error);
        }
    }

    /**
     * Follow a discovery path
     */
    private async followDiscoveryPath(pathId: string): Promise<void> {
        try {
            console.log("Following discovery path:", pathId);
            // This would navigate through the discovery path
            this.showMessage(`Following path: ${pathId}`, "info");
        } catch (error) {
            console.error("Failed to follow discovery path:", error);
        }
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
     * Change graph layout
     */
    changeLayout(layoutType: string): void {
        this.visualizer.changeLayout(layoutType);

        // Update active layout button
        document.querySelectorAll(".layout-btn").forEach((btn) => {
            btn.classList.remove("active");
        });
        document
            .querySelector(`[data-layout="${layoutType}"]`)
            ?.classList.add("active");
    }

    /**
     * Export graph
     */
    exportGraph(): void {
        const graphData = this.visualizer.exportGraph();
        const dataStr = JSON.stringify(graphData, null, 2);
        const dataBlob = new Blob([dataStr], { type: "application/json" });

        const link = document.createElement("a");
        link.href = URL.createObjectURL(dataBlob);
        link.download = `entity-graph-${this.currentEntity || "export"}.json`;
        link.click();
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

    private showGraphError(message: string): void {
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.innerHTML = `<div class="error-message">${message}</div>`;
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
            
            console.log(`Found ${graphData.entities?.length || 0} websites for center entity`);

            if (graphData.entities && graphData.entities.length > 0) {
                console.log("Expanding graph with related entities...");
                
                // Process and validate the relationships data
                const validRelationships = graphData.relationships?.filter((r: any) => {
                    // Ensure all required fields are present and not undefined
                    const hasValidFrom = r.relatedEntity && typeof r.relatedEntity === 'string';
                    const hasValidTo = graphData.centerEntity && typeof graphData.centerEntity === 'string';
                    const hasValidType = r.relationshipType && typeof r.relationshipType === 'string';
                    
                    if (!hasValidFrom) {
                        console.warn("Relationship missing relatedEntity:", r);
                    }
                    if (!hasValidTo) {
                        console.warn("Relationship missing centerEntity:", graphData.centerEntity);
                    }
                    if (!hasValidType) {
                        console.warn("Relationship missing relationshipType:", r);
                    }
                    
                    return hasValidFrom && hasValidTo && hasValidType;
                }) || [];

                console.log(`Generated entity graph: ${graphData.entities.length} entities, ${validRelationships.length} relationships`);

                // Load the graph into the visualizer
                await this.visualizer.loadEntityGraph({
                    centerEntity: graphData.centerEntity,
                    entities: graphData.entities.map((e: any) => ({
                        name: e.name || e.entityName || 'Unknown',
                        type: e.type || e.entityType || 'unknown',
                        confidence: e.confidence || 0.5,
                    })),
                    relationships: validRelationships.map((r: any) => ({
                        from: r.relatedEntity,
                        to: graphData.centerEntity,
                        type: r.relationshipType,
                        strength: r.strength || 0.5,
                    })),
                });

                // Load entity data into sidebar
                const entityData = await this.entityGraphService.searchByEntity(
                    entityName,
                    { maxResults: 1 },
                );
                if (
                    entityData &&
                    entityData.entities &&
                    entityData.entities.length > 0
                ) {
                    await this.sidebar.loadEntity(entityData.entities[0]);
                }

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

            const searchResults = await this.entityGraphService.searchByEntity(query, {
                maxResults: 10,
                includeRelationships: true,
                sortBy: "relevance",
            });

            if (searchResults.entities && searchResults.entities.length > 0) {
                console.log(`Found ${searchResults.entities.length} entities for search: ${query}`);
                
                // Navigate to the most relevant result
                const topResult = searchResults.entities[0];
                await this.navigateToEntity(topResult.name);

                // Show search results summary
                this.showMessage(
                    `Found ${searchResults.entities.length} results for "${query}". Showing: ${topResult.name}`, 
                    "success"
                );

                console.log(`Real entity search for "${query}" completed successfully`);
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
                "error"
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
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new EntityGraphView();
});

// Export for potential external usage
export { EntityGraphView };
