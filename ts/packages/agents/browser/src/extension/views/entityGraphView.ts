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
} from "./knowledgeUtilities";

interface MockScenario {
    id: string;
    name: string;
    description: string;
}

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
    private mockMode: boolean = true; // Default to mock data during integration testing phase
    private currentMockScenario: string | null = null;
    private entityGraphService: EntityGraphServices;
    private entityCacheService: EntityCacheServices;

    private mockScenarios: MockScenario[] = [
        {
            id: "tech_ecosystem",
            name: "Tech Ecosystem",
            description: "Microsoft, Azure, and tech innovation",
        },
        {
            id: "ai_research",
            name: "AI Research",
            description: "OpenAI, Anthropic, and AI development",
        },
        {
            id: "startup_valley",
            name: "Startup Valley",
            description: "Y Combinator, venture capital, and entrepreneurship",
        },
        {
            id: "academic_research",
            name: "Academic Research",
            description: "MIT, research institutions, and academia",
        },
    ];

    constructor() {
        // Initialize services
        this.entityGraphService = new DefaultEntityGraphServices();
        this.entityCacheService = new DefaultEntityCacheServices();

        // Initialize components
        const graphContainer = document.getElementById("cytoscape-container")!;
        const sidebarContainer = document.getElementById("entitySidebar")!;

        this.visualizer = new EnhancedEntityGraphVisualizer(graphContainer);
        this.sidebar = new EntitySidebar(sidebarContainer);

        // Initialize interactive components with real data support
        this.discovery = new EntityDiscovery(this.entityGraphService);
        this.multiHopExplorer = new MultiHopExplorer(
            this.visualizer,
            this.entityGraphService,
        );
        this.relationshipManager = new RelationshipDetailsManager();
        this.comparisonManager = new EntityComparisonManager();

        // Set initial data mode
        this.setComponentDataModes();

        this.initialize();
    }

    /**
     * Initialize the entity graph view
     */
    private async initialize(): Promise<void> {
        try {
            // Initialize visualizer
            await this.visualizer.initialize();

            // Set up event handlers
            this.setupEventHandlers();
            this.setupMockScenarios();
            this.setupControlHandlers();
            this.setupLayoutControls();
            this.setupSearchHandlers();
            this.setupInteractiveHandlers();

            // Show loading state initially
            this.showGraphLoading();

            // Update URL parameters
            this.handleUrlParameters();

            // Initialize with default mock scenario if none specified
            if (!this.currentMockScenario) {
                await this.loadMockScenario("tech_ecosystem");
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
        // Mock mode toggle
        const mockToggle = document.getElementById(
            "mockModeToggle",
        ) as HTMLButtonElement;
        if (mockToggle) {
            mockToggle.addEventListener("click", () => this.toggleMockMode());
        }

        // Entity click navigation
        this.visualizer.onEntityClick((entityData) => {
            this.navigateToEntity(entityData.name);
        });
    }

    /**
     * Set up mock scenario controls
     */
    private setupMockScenarios(): void {
        const scenarioContainer = document.getElementById("mockScenarios");
        if (!scenarioContainer) return;

        this.mockScenarios.forEach((scenario) => {
            const button = document.createElement("button");
            button.className = "scenario-button";
            button.textContent = scenario.name;
            button.title = scenario.description;
            button.addEventListener("click", () =>
                this.loadMockScenario(scenario.id),
            );
            scenarioContainer.appendChild(button);
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
        const layoutControls = document.querySelectorAll(".layout-control");
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
        const mockParam = urlParams.get("mock");

        if (entityParam) {
            this.currentEntity = entityParam;
        }

        if (mockParam !== null) {
            this.mockMode = mockParam === "true";
        }
    }

    /**
     * Load a mock scenario
     */
    async loadMockScenario(scenarioId: string): Promise<void> {
        try {
            this.currentMockScenario = scenarioId;
            this.showGraphLoading();

            // Load mock data for the scenario
            const mockData = await this.generateMockData(scenarioId);

            // Update visualizer
            await this.visualizer.loadEntityGraph(mockData);

            // Update sidebar with center entity
            if (mockData.centerEntity) {
                await this.sidebar.loadEntity(mockData.centerEntity);
            }

            this.hideGraphLoading();
            this.updateScenarioButtons();
        } catch (error) {
            console.error("Failed to load mock scenario:", error);
            this.showGraphError("Failed to load scenario");
        }
    }

    /**
     * Generate mock data for a scenario
     */
    private async generateMockData(scenarioId: string): Promise<any> {
        // This would integrate with the mock data generator
        // For now, return basic mock structure
        switch (scenarioId) {
            case "tech_ecosystem":
                return {
                    centerEntity: "Microsoft",
                    entities: [
                        {
                            name: "Microsoft",
                            type: "organization",
                            confidence: 0.95,
                        },
                        {
                            name: "Satya Nadella",
                            type: "person",
                            confidence: 0.98,
                        },
                        { name: "Azure", type: "product", confidence: 0.92 },
                        {
                            name: "Office365",
                            type: "product",
                            confidence: 0.85,
                        },
                        {
                            name: "Visual Studio",
                            type: "product",
                            confidence: 0.8,
                        },
                    ],
                    relationships: [
                        {
                            from: "Satya Nadella",
                            to: "Microsoft",
                            type: "CEO_of",
                            strength: 0.95,
                        },
                        {
                            from: "Microsoft",
                            to: "Azure",
                            type: "develops",
                            strength: 0.98,
                        },
                        {
                            from: "Microsoft",
                            to: "Office365",
                            type: "develops",
                            strength: 0.9,
                        },
                        {
                            from: "Microsoft",
                            to: "Visual Studio",
                            type: "develops",
                            strength: 0.85,
                        },
                    ],
                };

            case "ai_research":
                return {
                    centerEntity: "OpenAI",
                    entities: [
                        {
                            name: "OpenAI",
                            type: "organization",
                            confidence: 0.98,
                        },
                        {
                            name: "Sam Altman",
                            type: "person",
                            confidence: 0.95,
                        },
                        { name: "ChatGPT", type: "product", confidence: 0.92 },
                        { name: "GPT-4", type: "product", confidence: 0.9 },
                        {
                            name: "Anthropic",
                            type: "organization",
                            confidence: 0.88,
                        },
                        { name: "Claude", type: "product", confidence: 0.85 },
                    ],
                    relationships: [
                        {
                            from: "Sam Altman",
                            to: "OpenAI",
                            type: "CEO_of",
                            strength: 0.95,
                        },
                        {
                            from: "OpenAI",
                            to: "ChatGPT",
                            type: "created",
                            strength: 0.85,
                        },
                        {
                            from: "OpenAI",
                            to: "GPT-4",
                            type: "developed",
                            strength: 0.9,
                        },
                        {
                            from: "Anthropic",
                            to: "Claude",
                            type: "developed",
                            strength: 0.92,
                        },
                    ],
                };

            default:
                return {
                    centerEntity: "Example Entity",
                    entities: [
                        {
                            name: "Example Entity",
                            type: "organization",
                            confidence: 0.8,
                        },
                    ],
                    relationships: [],
                };
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

            // Load entity data
            if (this.mockMode) {
                // Find entity in current mock data or load new scenario
                await this.sidebar.loadEntity(entityName);
            } else {
                // Load real entity data
                await this.loadRealEntityData(entityName);
            }
        } catch (error) {
            console.error("Failed to navigate to entity:", error);
        }
    }

    /**
     * Set data modes for all components
     */
    private setComponentDataModes(): void {
        // Component data modes would be set here if the services supported it
        console.log("Setting data mode to:", this.mockMode ? "mock" : "real");
        this.discovery.setMockMode(this.mockMode);
        this.multiHopExplorer.setMockMode(this.mockMode);
        this.relationshipManager.setMockMode(this.mockMode);
        this.comparisonManager.setMockMode(this.mockMode);
        this.sidebar.setMockMode(this.mockMode);
    }
    /**
     * Toggle between mock and real data mode
     */
    async toggleMockMode(): Promise<void> {
        this.mockMode = !this.mockMode;

        // Update all components
        this.setComponentDataModes();

        // Update UI
        this.updateMockModeIndicator();

        // Reload current entity with new data mode
        if (this.currentEntity) {
            await this.navigateToEntity(this.currentEntity);
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
            if (this.mockMode) {
                // Search in current mock scenario
                await this.searchMockEntity(query);
            } else {
                // Search in real data
                await this.searchRealEntity(query);
            }
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
        document.querySelectorAll(".layout-control").forEach((btn) => {
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
        if (this.currentMockScenario) {
            await this.loadMockScenario(this.currentMockScenario);
        }
    }

    // UI Helper Methods
    private showGraphLoading(): void {
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.classList.add("loading");
        }
    }

    private hideGraphLoading(): void {
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.classList.remove("loading");
        }
    }

    private showGraphError(message: string): void {
        const container = document.getElementById("cytoscape-container");
        if (container) {
            container.innerHTML = `<div class="error-message">${message}</div>`;
        }
    }

    private updateMockModeIndicator(): void {
        const indicator = document.getElementById("mockModeIndicator");
        const toggle = document.getElementById(
            "mockModeToggle",
        ) as HTMLInputElement;

        if (indicator) {
            indicator.style.display = this.mockMode ? "block" : "none";

            // Update indicator text
            const scenarioName = document.getElementById("mockScenarioName");
            if (scenarioName && this.currentMockScenario) {
                const scenario = this.mockScenarios.find(
                    (s) => s.id === this.currentMockScenario,
                );
                scenarioName.textContent = scenario
                    ? ` - ${scenario.name}`
                    : "";
            }
        }

        if (toggle) {
            toggle.checked = this.mockMode;
        }

        // Update data source indicator in UI
        const dataSourceInfo = document.querySelector(".data-source-info");
        if (dataSourceInfo) {
            dataSourceInfo.textContent = this.mockMode
                ? "Mock Data"
                : "Real Data";
            dataSourceInfo.className = `data-source-info ${this.mockMode ? "mock-mode" : "real-mode"}`;
        }
    }

    private updateScenarioButtons(): void {
        document.querySelectorAll(".scenario-button").forEach((btn) => {
            btn.classList.remove("active");
        });

        const activeBtn = document.querySelector(
            `[data-scenario="${this.currentMockScenario}"]`,
        );
        if (activeBtn) {
            activeBtn.classList.add("active");
        }
    }

    // Mock data methods
    private async searchMockEntity(query: string): Promise<void> {
        // Implementation for mock entity search
        console.log("Searching mock entities for:", query);
    }

    // Real data methods
    private async loadRealEntityData(entityName: string): Promise<void> {
        try {
            this.showGraphLoading();

            // Load entity graph using enhanced search
            const graphData = await this.entityGraphService.getEntityGraph(
                entityName,
                2,
            );

            if (graphData.entities.length > 0) {
                // Load the graph into the visualizer
                await this.visualizer.loadEntityGraph({
                    centerEntity: graphData.centerEntity,
                    entities: graphData.entities.map((e: any) => ({
                        name: e.name,
                        type: e.type,
                        confidence: e.confidence,
                    })),
                    relationships: graphData.relationships.map((r: any) => ({
                        from: r.relatedEntity,
                        to: graphData.centerEntity,
                        type: r.relationshipType,
                        strength: r.strength,
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
                    `Loaded real entity graph for ${entityName}: ${graphData.entities.length} entities, ${graphData.relationships.length} relationships`,
                );
            } else {
                this.showGraphError(`No data found for entity: ${entityName}`);
            }
        } catch (error) {
            console.error("Failed to load real entity data:", error);
            this.showGraphError(
                "Failed to load entity data. Please try again.",
            );
        }
    }

    private async searchRealEntity(query: string): Promise<void> {
        try {
            const searchResults = await this.entityGraphService.searchByEntity(
                query,
                {
                    maxResults: 10,
                    includeRelationships: true,
                    sortBy: "relevance",
                },
            );

            if (searchResults.entities.length > 0) {
                // Navigate to the first result
                await this.navigateToEntity(searchResults.entities[0].name);

                console.log(
                    `Real entity search for "${query}" found ${searchResults.entities.length} results`,
                );
            } else {
                this.showMessage(
                    `No entities found for search: ${query}`,
                    "warning",
                );
            }
        } catch (error) {
            console.error("Real entity search failed:", error);
            this.showMessage("Search failed. Please try again.", "error");
        }
    }

    /**
     * Load entity data with automatic fallback
     */
    private async loadEntityData(entityName: string): Promise<void> {
        if (this.mockMode) {
            return this.loadMockEntityData(entityName);
        } else {
            return this.loadRealEntityData(entityName);
        }
    }

    /**
     * Load mock entity data
     */
    private async loadMockEntityData(entityName: string): Promise<void> {
        // Implementation for loading mock data
        console.log("Loading mock data for entity:", entityName);
        // This would integrate with mock data provider
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
                await this.loadEntityData(entityName);
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
