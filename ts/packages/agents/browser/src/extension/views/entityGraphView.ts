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
    private mockMode: boolean = false; // Use real data by default
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
        try {
            console.log("EntityGraphView constructor starting...");
            
            // Initialize services with Chrome extension connection
            const chromeService = new ChromeExtensionService();
            this.entityGraphService = new DefaultEntityGraphServices(chromeService);
            this.entityCacheService = new DefaultEntityCacheServices();
            console.log("Services initialized with Chrome extension connection");

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

            // Set initial data mode
            this.setComponentDataModes();
            console.log("Component data modes set");

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
            this.setupMockScenarios();
            this.setupControlHandlers();
            this.setupLayoutControls();
            this.setupSearchHandlers();
            this.setupInteractiveHandlers();

            // Initialize with default mock scenario if none specified
            // Show loading state initially
            this.showGraphLoading();

            // Update URL parameters and load entity if specified
            this.handleUrlParameters();

            // Load entity from URL or initialize with a default entity search
            if (this.currentEntity) {
                await this.navigateToEntity(this.currentEntity);
            } else {
                // Try to load some real entity data as default
                await this.loadDefaultEntityData();
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

        // Choose scenario button
        const chooseScenarioBtn = document.getElementById("chooseScenarioBtn");
        if (chooseScenarioBtn) {
            chooseScenarioBtn.addEventListener("click", () => {
                const scenarioSelect = document.getElementById("mockScenarioSelect") as HTMLSelectElement;
                if (scenarioSelect) {
                    scenarioSelect.focus();
                }
            });
        }
    }

    /**
     * Set up mock scenario controls
     */
    private setupMockScenarios(): void {
        const scenarioSelect = document.getElementById("mockScenarioSelect") as HTMLSelectElement;
        if (!scenarioSelect) return;

        // Clear existing options (except the first placeholder)
        scenarioSelect.innerHTML = '<option value="">Select Scenario...</option>';

        // Add scenario options
        this.mockScenarios.forEach((scenario) => {
            const option = document.createElement("option");
            option.value = scenario.id;
            option.textContent = scenario.name;
            option.title = scenario.description;
            scenarioSelect.appendChild(option);
        });

        // Add change event listener
        scenarioSelect.addEventListener("change", (e) => {
            const target = e.target as HTMLSelectElement;
            if (target.value) {
                this.loadMockScenario(target.value);
            }
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
        const mockParam = urlParams.get("mock");

        if (entityParam) {
            this.currentEntity = entityParam;
            // Update breadcrumb to show entity name
            const entityBreadcrumb = document.getElementById("entityNameBreadcrumb");
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityParam}`;
            }
        }

        if (mockParam !== null) {
            this.mockMode = mockParam === "true";
        }
    }

    /**
     * Load a mock scenario
     */
    async loadMockScenario(scenarioId: string, centerEntity?: string): Promise<void> {
        try {
            this.currentMockScenario = scenarioId;
            this.showGraphLoading();

            // Load mock data for the scenario or specific entity
            const mockData = await this.generateMockData(scenarioId, centerEntity);
            
            console.log("Loading entity graph with data:", mockData);

            // Validate mock data
            if (!mockData || !mockData.entities || mockData.entities.length === 0) {
                throw new Error("No mock data generated");
            }

            // Update visualizer
            await this.visualizer.loadEntityGraph(mockData);
            console.log("Graph loaded successfully");

            // Update sidebar with center entity
            if (mockData.centerEntity) {
                await this.sidebar.loadEntity(mockData.centerEntity);
                console.log("Sidebar loaded for:", mockData.centerEntity);
            }

            this.hideGraphLoading();
            this.updateScenarioButtons();
            console.log("Mock scenario loading completed successfully");
        } catch (error: any) {
            console.error("Failed to load mock scenario:", error);
            this.hideGraphLoading();
            this.showGraphError(`Failed to load scenario: ${error.message || error}`);
        }
    }

    /**
     * Generate mock data for a scenario or specific entity
     */
    private async generateMockData(scenarioId: string, centerEntity?: string): Promise<any> {
        // If we have a specific entity from URL, create mock data for it
        if (centerEntity) {
            return this.generateMockEntityData(centerEntity);
        }

        // Otherwise use predefined scenarios
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
     * Load default entity data when no specific entity is requested
     */
    private async loadDefaultEntityData(): Promise<void> {
        try {
            this.showGraphLoading();
            console.log("Loading default entity data...");

            // Try to search for some common technology entities that are likely to have data
            const commonEntities = [
                'TypeScript', 'JavaScript', 'React', 'Node.js', 'Microsoft', 
                'OpenAI', 'GitHub', 'Stack Overflow', 'Visual Studio Code'
            ];
            
            let foundEntity = false;
            for (const entity of commonEntities) {
                try {
                    console.log(`Trying to find data for: ${entity}`);
                    const result = await this.entityGraphService.searchByEntity(entity, { maxResults: 5 });
                    
                    if (result.entities && result.entities.length > 0) {
                        console.log(`Found ${result.entities.length} entities for ${entity}, loading as default`);
                        await this.navigateToEntity(entity);
                        foundEntity = true;
                        break;
                    }
                } catch (error) {
                    console.warn(`Failed to search for ${entity}:`, error);
                    continue;
                }
            }

            if (!foundEntity) {
                console.log("No default entity data found, showing empty state with instructions");
                this.hideGraphLoading();
                this.showEmptyStateWithInstructions();
            }
            
        } catch (error) {
            console.error("Failed to load default entity data:", error);
            this.hideGraphLoading();
            this.showEmptyStateWithInstructions();
        }
    }

    private showEmptyStateWithInstructions(): void {
        const emptyElement = document.getElementById("graphEmpty");
        if (emptyElement) {
            emptyElement.innerHTML = `
                <div class="empty-state">
                    <h3>No Entity Data Available</h3>
                    <p>To see entity graphs, you need to:</p>
                    <ol>
                        <li>Import some website data (bookmarks, history, or HTML files)</li>
                        <li>Search for an entity using the search box above</li>
                        <li>Or toggle to Mock Data mode for demo purposes</li>
                    </ol>
                    <p>Once you have data, entity graphs will show relationships between people, organizations, technologies, and concepts found in your browsing history.</p>
                </div>
            `;
            emptyElement.style.display = "flex";
        }
    }

    /**
     * Generate mock data for a specific entity
     */
    private async generateMockEntityData(entityName: string): Promise<any> {
        // Create mock data based on entity name
        const entityType = this.inferEntityType(entityName);
        
        return {
            centerEntity: entityName,
            entities: [
                {
                    name: entityName,
                    type: entityType,
                    confidence: 0.85,
                },
                {
                    name: `Related to ${entityName}`,
                    type: "concept",
                    confidence: 0.75,
                },
                {
                    name: `${entityName} Example`,
                    type: "product",
                    confidence: 0.70,
                },
            ],
            relationships: [
                {
                    from: `Related to ${entityName}`,
                    to: entityName,
                    type: "related_to",
                    strength: 0.8,
                },
                {
                    from: `${entityName} Example`,
                    to: entityName,
                    type: "example_of",
                    strength: 0.75,
                },
            ],
        };
    }

    /**
     * Infer entity type from name
     */
    private inferEntityType(entityName: string): string {
        const lowercaseName = entityName.toLowerCase();
        
        if (lowercaseName.includes("site") || lowercaseName.includes("website") || lowercaseName.includes("domain")) {
            return "website";
        }
        if (lowercaseName.includes("corp") || lowercaseName.includes("inc") || lowercaseName.includes("company")) {
            return "organization";
        }
        if (lowercaseName.includes("app") || lowercaseName.includes("software") || lowercaseName.includes("tool")) {
            return "product";
        }
        
        // Default to organization
        return "organization";
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
                // Load mock data for this specific entity
                await this.loadMockScenario("entity_specific", entityName);
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
        if (this.currentMockScenario) {
            await this.loadMockScenario(this.currentMockScenario);
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
