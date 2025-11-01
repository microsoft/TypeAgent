// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Entity Graph View - Main entry point for entity visualization
import { EntityGraphVisualizer } from "./entityGraphVisualizer.js";
import { EntitySidebar } from "./entitySidebar.js";
import { createExtensionService } from "./knowledgeUtilities";
import {
    GraphDataProvider,
    GraphDataProviderImpl,
} from "./graphDataProvider.js";

/**
 * Main class for the Entity Graph View page
 */
interface ViewMode {
    type: "global" | "entity-specific";
    centerEntity?: string;
    centerTopic?: string;
}

interface NavigationState {
    type: "global" | "detail";
    entityName?: string;
    timestamp: number;
    cacheKey?: string;
}

class EntityGraphView {
    private visualizer: EntityGraphVisualizer;
    private sidebar: EntitySidebar;
    private extensionService: any;
    private currentEntity: string | null = null;
    private currentViewMode: ViewMode = { type: "global" };
    private graphDataProvider: GraphDataProvider;

    // Navigation history management
    private navigationHistory: NavigationState[] = [];
    private currentHistoryIndex: number = -1;
    private isHandlingPopstate: boolean = false;

    constructor() {
        try {
            console.log("EntityGraphView constructor starting...");

            // Initialize services with appropriate extension service based on environment
            this.extensionService = createExtensionService();

            // Initialize Graph data provider for direct storage access
            this.graphDataProvider = new GraphDataProviderImpl(
                this.extensionService,
            );
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

            // Hide sidebar by default
            sidebarContainer.style.display = "none";

            console.log("Creating visualizer...");
            this.visualizer = new EntityGraphVisualizer(graphContainer);

            // Set up hierarchical loading
            this.visualizer.setGraphDataProvider(this.graphDataProvider);

            // Set up UI callbacks
            this.visualizer.setInstanceChangeCallback(() => {
                // Update window title when visualizer switches views
                this.updateWindowTitle();
            });

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
            await this.visualizer.initialize();

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

            // Setup browser navigation AFTER basic initialization
            this.setupBrowserNavigation();

            // Load based on view mode
            console.log(`Current view mode: ${this.currentViewMode.type}`);

            if (
                this.currentViewMode.type === "entity-specific" &&
                this.currentEntity
            ) {
                console.log(`Loading specific entity: ${this.currentEntity}`);
                // Don't show sidebar until detail view is loaded
                this.updateSidebarVisibility(false);
                // Store entity name before clearing current entity to force initial load
                const entityToLoad = this.currentEntity;
                this.currentEntity = null; // Clear to ensure navigation doesn't skip
                // Don't update history during initial load - already handled by setupBrowserNavigation
                await this.navigateToEntity(entityToLoad, false);
            } else if (this.currentViewMode.type === "global") {
                console.log(
                    "Loading global knowledge graph with importance layer",
                );
                this.updateSidebarVisibility(false);
                await this.loadGlobalViewWithImportanceLayer();
            } else {
                console.log("Invalid state - showing error");
                this.showEntityParameterError();
            }

            // Update window title after initial load
            this.updateWindowTitle();
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
            if (this.currentViewMode.type === "global") {
                this.showEntityDetails(entityData.name);
            } else {
                this.navigateToEntity(entityData.name);
            }
        });

        // Sidebar close button
        const closeSidebarBtn = document.getElementById("closeEntitySidebar");
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener("click", () => {
                this.closeEntitySidebar();
            });
        }
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
        const reLayoutBtn = document.getElementById("reLayoutBtn");
        const debugViewportBtn = document.getElementById("debugViewportBtn");

        console.log("Control button elements:", {
            zoomInBtn: !!zoomInBtn,
            zoomOutBtn: !!zoomOutBtn,
            fitBtn: !!fitBtn,
            reLayoutBtn: !!reLayoutBtn,
            debugViewportBtn: !!debugViewportBtn,
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

        if (reLayoutBtn) {
            reLayoutBtn.addEventListener("click", () => {
                console.log("Re-run layout button clicked");
                this.visualizer.reRunLayout();
            });
        }

        if (debugViewportBtn) {
            debugViewportBtn.addEventListener("click", () => {
                console.log("Debug viewport button clicked");
                this.visualizer.debugLogViewportNodes();
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

        // Back to previous view button (was "back to global" but now smarter)
        const backToGlobalBtn = document.getElementById("backToGlobalBtn");
        if (backToGlobalBtn) {
            backToGlobalBtn.addEventListener("click", async () => {
                console.log("Back button clicked");

                // Try to restore hidden view first (much simpler approach)
                const restored = this.visualizer.restoreHiddenView();
                if (!restored) {
                    // Fallback to global view if no hidden view available
                    console.log(
                        "No hidden view available, falling back to global view",
                    );
                    this.navigateToGlobalView();
                }

                // Update button text after navigation
                this.updateBackButtonText();
            });
        }

        // Entity Graph breadcrumb link - navigate to global view
        const entityGraphBreadcrumb = document.getElementById(
            "entityGraphBreadcrumb",
        );
        if (entityGraphBreadcrumb) {
            entityGraphBreadcrumb.addEventListener("click", (e) => {
                e.preventDefault();
                console.log("Entity Graph breadcrumb clicked");
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

        if (this.currentViewMode.type === "entity-specific") {
            this.currentEntity =
                this.currentViewMode.centerEntity ||
                this.currentViewMode.centerTopic ||
                null;

            if (this.currentEntity) {
                console.log(
                    `${entityParam ? "Entity" : "Topic"} from URL: ${this.currentEntity}`,
                );
                const entityBreadcrumb = document.getElementById(
                    "entityNameBreadcrumb",
                );
                if (entityBreadcrumb) {
                    entityBreadcrumb.textContent = ` > ${this.currentEntity}`;
                }
            }
        } else {
            console.log(
                "Global mode detected - will show full knowledge graph",
            );
            const entityBreadcrumb = document.getElementById(
                "entityNameBreadcrumb",
            );
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

        if (modeParam === "global" || (!entityParam && !topicParam)) {
            return { type: "global" };
        }

        return {
            type: "entity-specific",
            centerEntity: entityParam || undefined,
            centerTopic: topicParam || undefined,
        };
    }

    /**
     * Navigate to a specific entity
     */
    async navigateToEntity(
        entityName: string,
        updateHistory: boolean = true,
    ): Promise<void> {
        try {
            // Check if this is the same entity (prevent unnecessary navigation)
            if (
                this.currentEntity === entityName &&
                this.currentViewMode.type === "entity-specific"
            ) {
                return;
            }

            // Set transitioning state if coming from global view
            if (this.currentViewMode.type === "global") {
                this.visualizer.setViewMode("transitioning");
            }

            // Update internal state
            this.currentEntity = entityName;
            this.currentViewMode = {
                type: "entity-specific",
                centerEntity: entityName,
            };

            // Update UI elements
            const entityBreadcrumb = document.getElementById(
                "entityNameBreadcrumb",
            );
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = ` > ${entityName}`;
            }

            const backToGlobalBtn = document.getElementById("backToGlobalBtn");
            if (backToGlobalBtn) {
                backToGlobalBtn.style.display = "flex";
            }

            // Update back button text to reflect what view we'll return to
            this.updateBackButtonText();

            // Update URL and history - only if not handling popstate and updateHistory is true
            if (updateHistory && !this.isHandlingPopstate) {
                this.updateUrlForEntity(entityName);

                const newState: NavigationState = {
                    type: "detail",
                    entityName: entityName,
                    timestamp: Date.now(),
                    cacheKey: `detail_${entityName}`,
                };

                this.addToNavigationHistory(newState);
            }

            // Don't show sidebar yet - wait for data to load
            await this.loadRealEntityData(entityName);
            // Show sidebar after detail view is loaded
            this.updateSidebarVisibility(true);

            // Update window title after navigation completes
            this.updateWindowTitle();
        } catch (error) {
            console.error("Failed to navigate to entity:", error);
            // Show user-friendly error message
            this.showNavigationError(`Failed to load entity: ${entityName}`);
        }
    }

    private async showEntityDetails(entityName: string): Promise<void> {
        try {
            console.log(`Fetching details for entity: ${entityName}`);

            const sidebarElement = document.getElementById("entitySidebar");
            if (sidebarElement) {
                sidebarElement.style.display = "flex";
            }

            const basicEntityData = {
                name: entityName,
                type: "Loading...",
                confidence: 0,
            };
            await this.sidebar.loadEntity(basicEntityData);

            const result = await this.extensionService.getEntityDetails(
                entityName,
            );

            if (result && result.success && result.details) {
                const details = result.details;

                const fullEntityData = {
                    name: details.name,
                    type: details.type,
                    confidence: details.confidence,
                    count: details.count,
                    relatedTopics: details.relatedTopics ||  details.topicAffinity || [],
                    relatedEntities: details.relatedEntities || [],
                    sources: details.sources || [],
                };

                await this.sidebar.loadEntity(fullEntityData, fullEntityData);
            } else {
                console.warn(
                    "No entity details available:",
                    result?.error || "Unknown error",
                );
            }
        } catch (error) {
            console.error("Failed to load entity details:", error);
        }
    }

    async navigateToGlobalView(): Promise<void> {
        try {
            // Update internal state
            this.currentEntity = null;
            this.currentViewMode = { type: "global" };

            // Update UI elements
            const entityBreadcrumb = document.getElementById(
                "entityNameBreadcrumb",
            );
            if (entityBreadcrumb) {
                entityBreadcrumb.textContent = " > Global View";
            }

            const backToGlobalBtn = document.getElementById("backToGlobalBtn");
            if (backToGlobalBtn) {
                backToGlobalBtn.style.display = "none";
            }

            // Update URL and history - only if not handling popstate
            if (!this.isHandlingPopstate) {
                this.updateUrlForGlobal();

                const newState: NavigationState = {
                    type: "global",
                    timestamp: Date.now(),
                };

                this.addToNavigationHistory(newState);
            }

            this.updateSidebarVisibility(false);
            await this.loadGlobalViewWithImportanceLayer();

            // Update window title for global view
            this.updateWindowTitle();
        } catch (error) {
            console.error("Failed to navigate to global view:", error);
            this.showNavigationError("Failed to load global view");
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

            await this.navigateToEntity(query.trim());
        } catch (error) {
            console.error("Failed to search entity:", error);
        }
    }

    /**
     * Export graph
     */
    exportGraph(): void {
        try {
            const graphData = this.visualizer.exportGraph();

            if (!graphData) {
                console.warn("No graph data to export");
                return;
            }

            const dataStr = JSON.stringify(graphData, null, 2);
            const dataBlob = new Blob([dataStr], { type: "application/json" });

            const link = document.createElement("a");
            link.href = URL.createObjectURL(dataBlob);
            link.download = `entity-graph-${this.currentEntity || "export"}-${new Date().toISOString().split("T")[0]}.json`;
            link.click();
        } catch (error) {
            console.error("Failed to export graph:", error);
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
                sidebar.style.display = "block";
                graphContainer.style.width = "100%";
            } else {
                sidebar.style.display = "none";
                graphContainer.style.width = "100%";
            }

            if (this.visualizer) {
                setTimeout(() => this.visualizer.resize(), 100);
            }
        }
    }

    private closeEntitySidebar(): void {
        const sidebar = document.getElementById("entitySidebar");
        if (sidebar) {
            sidebar.style.display = "none";
        }
    }

    private async loadGlobalView(): Promise<void> {
        try {
            this.showGraphLoading();

            // Try dual-instance fast navigation first - skip data fetch if possible
            console.log(
                `[Navigation] Current view mode: ${this.currentViewMode.type}, Fast nav available: ${this.visualizer.canUseFastNavigation()}`,
            );

            if (this.visualizer.canUseFastNavigation()) {
                console.log(
                    "[Navigation] Using dual-instance fast switch to global view - no data fetch needed",
                );
                this.visualizer.fastSwitchToGlobal();
                this.hideGraphLoading();
                console.log(
                    "[FastNav] Global view restored from dual-instance cache",
                );
                return;
            }

            // Fallback: fetch data and build graph normally
            console.log(
                "[Navigation] Dual-instance not available - fetching data and building graph",
            );
            const globalData = await this.loadGlobalGraphData();

            if (globalData.statistics.totalEntities === 0) {
                this.hideGraphLoading();
                this.showGraphEmpty();
                return;
            }

            await this.visualizer.loadGlobalGraph(globalData);

            this.hideGraphLoading();

            console.log(
                `Loaded global graph: ${globalData.statistics.totalEntities} entities, ${globalData.statistics.totalRelationships} relationships, ${globalData.statistics.totalCommunities} communities`,
            );
        } catch (error) {
            console.error("Failed to load global view:", error);
            this.hideGraphLoading();
            this.showGraphError("Failed to load global knowledge graph");
        }
    }

    private async loadGlobalGraphData(): Promise<any> {
        // Use Graph data provider for direct storage access
        const globalGraphResult =
            await this.graphDataProvider.getGlobalGraphData();

        // Process communities for color assignment
        const processedCommunities = globalGraphResult.communities.map(
            (c: any) => ({
                ...c,
                entities:
                    typeof c.entities === "string"
                        ? JSON.parse(c.entities || "[]")
                        : c.entities || [],
                topics:
                    typeof c.topics === "string"
                        ? JSON.parse(c.topics || "[]")
                        : c.topics || [],
            }),
        );

        // Assign community colors to entities
        const entitiesWithColors = this.assignCommunityColors(
            globalGraphResult.entities,
            processedCommunities,
        );

        // Return data in format expected by existing UI components
        return {
            communities: processedCommunities,
            entities: entitiesWithColors,
            relationships: globalGraphResult.relationships,
            topics: [],
            statistics: {
                totalEntities: globalGraphResult.statistics.totalEntities,
                totalRelationships:
                    globalGraphResult.statistics.totalRelationships,
                totalCommunities: globalGraphResult.statistics.communities,
            },
        };
    }

    /**
     * Enhance entities with LoD properties for importance-based visualization
     */
    private enhanceEntitiesForLoD(entities: any[]): any[] {
        // Calculate importance statistics for proper scaling
        const importanceValues = entities
            .map((e) => e.importance || 0)
            .filter((i) => i > 0);
        const minImportance = Math.min(...importanceValues);
        const maxImportance = Math.max(...importanceValues);
        const importanceRange = maxImportance - minImportance;

        return entities.map((entity: any) => {
            const importance = entity.importance || 0;
            const normalizedImportance =
                importanceRange > 0
                    ? (importance - minImportance) / importanceRange
                    : 0.5;

            // Calculate size based on importance (10-50px range)
            const baseSize = 10;
            const maxSize = 50;
            const size = baseSize + normalizedImportance * (maxSize - baseSize);

            // Calculate color based on importance (blue gradient)
            const colorIntensity = Math.max(0.3, normalizedImportance); // Minimum 30% intensity
            const blue = Math.floor(255 * colorIntensity);
            const color = `rgb(${Math.floor(blue * 0.3)}, ${Math.floor(blue * 0.6)}, ${blue})`;
            const borderColor = `rgb(${Math.floor(blue * 0.2)}, ${Math.floor(blue * 0.4)}, ${Math.floor(blue * 0.8)})`;

            // Enhanced entity with LoD properties
            return {
                ...entity,
                size: Math.round(size),
                color: color,
                borderColor: borderColor,
                // LoD properties for visibility thresholds
                computedImportance: importance,
                visualPriority: normalizedImportance,
                degreeCount:
                    entity.degree ||
                    entity.degreeCount ||
                    Math.max(1, importance * 10),
                centralityScore:
                    entity.centrality || entity.centralityScore || importance,
                // Labels based on importance
                showLabel: normalizedImportance > 0.3, // Only show labels for top 70% important nodes
                labelSize: Math.max(8, 8 + normalizedImportance * 8), // 8-16px label size
            };
        });
    }

    private assignCommunityColors(entities: any[], communities: any[]): any[] {
        const communityColors = [
            "#1f77b4",
            "#ff7f0e",
            "#2ca02c",
            "#d62728",
            "#9467bd",
            "#8c564b",
            "#e377c2",
            "#7f7f7f",
            "#bcbd22",
            "#17becf",
            "#aec7e8",
            "#ffbb78",
            "#98df8a",
            "#ff9896",
            "#c5b0d5",
            "#c49c94",
            "#f7b6d3",
            "#c7c7c7",
            "#dbdb8d",
            "#9edae5",
        ];

        const communityColorMap = new Map<string, string>();
        communities.forEach((community, index) => {
            const colorIndex = index % communityColors.length;
            communityColorMap.set(
                community.id || `community_${index}`,
                communityColors[colorIndex],
            );
        });

        return entities.map((entity) => ({
            ...entity,
            color: communityColorMap.get(entity.communityId) || "#999999",
            borderColor: this.getBorderColor(
                communityColorMap.get(entity.communityId) || "#999999",
            ),
        }));
    }

    private getBorderColor(color: string): string {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return "#333333";

        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        const imageData = ctx.getImageData(0, 0, 1, 1);
        const [r, g, b] = imageData.data;

        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128 ? "#333333" : "#ffffff";
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

    private showNavigationError(message: string): void {
        console.error(`[Navigation] ${message}`);
        // Show temporary error notification without disrupting the current view
        const notification = document.createElement("div");
        notification.className = "navigation-error-notification";
        notification.innerHTML = `
            <div class="notification-content">
                <span class="error-icon">⚠️</span>
                <span class="error-text">${this.escapeHtml(message)}</span>
                <button class="close-btn" data-action="close-notification">×</button>
            </div>
        `;
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 10000;
            background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;
            border-radius: 4px; padding: 12px; max-width: 300px;
            font-family: Arial, sans-serif; font-size: 14px;
            animation: slideIn 0.3s ease-out;
        `;

        // Add event listener for close button
        const closeBtn = notification.querySelector(
            '[data-action="close-notification"]',
        );
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                notification.remove();
            });
        }

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
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
                        <a href="#" data-action="go-back" style="color: #007acc; text-decoration: underline;">
                            ← Go Back
                        </a>
                    </p>
                </div>
            `;

            // Add event listener for go back link
            const goBackLink = container.querySelector(
                '[data-action="go-back"]',
            );
            if (goBackLink) {
                goBackLink.addEventListener("click", (e) => {
                    e.preventDefault();
                    history.back();
                });
            }
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

            // Load entity graph using HybridGraph data provider
            let graphData;
            try {
                const neighborhoodResult =
                    await this.graphDataProvider.getEntityNeighborhood(
                        entityName,
                        2,
                        50,
                    );

                // Also fetch search data for sidebar enrichment (topics, domains, facets, etc.)
                let searchData: any = null;

                try {
                    const extensionService = createExtensionService();
                    searchData = await (
                        extensionService as any
                    ).searchByEntities([entityName], "", 10);
                } catch (searchError) {
                    console.warn(
                        `[HybridGraph Migration] Could not fetch search enrichment data:`,
                        searchError,
                    );
                }

                // Transform HybridGraph result to expected format with enrichment
                graphData = {
                    centerEntity: neighborhoodResult.centerEntity.name,
                    entities: [
                        neighborhoodResult.centerEntity,
                        ...neighborhoodResult.neighbors,
                    ],
                    relationships: neighborhoodResult.relationships,
                    relatedEntities: neighborhoodResult.neighbors,
                    topTopics: searchData?.topTopics || [],
                    summary: searchData?.summary || null,
                    metadata: {
                        ...neighborhoodResult.metadata,
                        ...(searchData?.metadata || {}),
                    },
                    answerSources: searchData?.answerSources || [],
                };

                // Enrich center entity with search data if available
                if (
                    searchData?.websites?.length > 0 &&
                    graphData.entities.length > 0
                ) {
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
                        },
                    };
                    graphData.entities[0] = enrichedEntity;
                }
            } catch (error) {
                console.error(
                    `[HybridGraph Migration] Failed to load entity neighborhood for "%s":`,
                    entityName,
                    error,
                );
                // Return empty graph data on error
                graphData = {
                    centerEntity: entityName,
                    entities: [],
                    relationships: [],
                    relatedEntities: [],
                    topTopics: [],
                    metadata: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                };
            }
            if (graphData.entities && graphData.entities.length > 0) {
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
                    ...(graphData.relatedEntities || []).map((entity: any) => ({
                        name:
                            typeof entity === "string"
                                ? entity
                                : entity.name || entity,
                        type: "related_entity",
                        confidence:
                            typeof entity === "object"
                                ? entity.confidence || 0.7
                                : 0.7,
                    })),
                    // Top topics as entities
                    ...(graphData.topTopics || []).map((topic: any) => ({
                        name:
                            typeof topic === "string"
                                ? topic
                                : topic.name || topic,
                        type: "topic",
                        confidence:
                            typeof topic === "object"
                                ? topic.confidence || 0.6
                                : 0.6,
                    })),
                ];

                // Create entity name set for validation
                const entityNames = new Set(allEntities.map((e) => e.name));

                // Validate and deduplicate relationships
                const validatedRelationships = [];
                const relationshipSet = new Set();

                for (const r of validRelationships) {
                    const from =
                        r.from || (r as any).relatedEntity || "Unknown";
                    const to = r.to || graphData.centerEntity || "Unknown";
                    const type =
                        r.type || (r as any).relationshipType || "related";

                    // Check if both entities exist in the graph
                    if (!entityNames.has(from) || !entityNames.has(to)) {
                        continue;
                    }

                    // Create unique key for deduplication
                    const relationshipKey = `${from}:${to}:${type}`;
                    if (relationshipSet.has(relationshipKey)) {
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

                // PHASE 3d: Detail view removed - loadEntityGraph method no longer exists
                // await this.visualizer.loadEntityGraph(
                //     {
                //         centerEntity: graphData.centerEntity,
                //         entities: allEntities,
                //         relationships: validatedRelationships,
                //     },
                //     graphData.centerEntity,
                // );

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
                    facets:
                        centerEntityFromGraph?.properties?.facets ||
                        (centerEntityFromGraph as any)?.facets ||
                        [],
                    topicAffinity: graphData.topTopics || [],
                    summary: graphData.summary,
                    metadata: graphData.metadata,
                    answerSources: graphData.answerSources || [],
                    // Add additional data for sidebar metrics
                    mentionCount: this.calculateTotalMentions(
                        graphData.entities,
                    ),
                    relationships: validRelationships || [],
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

                await this.sidebar.loadEntity(centerEntityData);

                // Show sidebar after successfully loading data
                this.updateSidebarVisibility(true);

                this.hideGraphLoading();
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

    /**
     * Refresh entity data from source
     */
    async refreshEntityData(entityName: string): Promise<void> {
        try {
            this.showGraphLoading();

            // Refresh data by re-fetching entity neighborhood
            const refreshedEntity =
                await this.graphDataProvider.getEntityNeighborhood(
                    entityName,
                    2,
                    50,
                );

            if (refreshedEntity && refreshedEntity.neighbors.length > 0) {
                await this.loadRealEntityData(entityName);
            }
        } catch (error) {
            console.error("Failed to refresh entity data:", error);
        } finally {
            this.hideGraphLoading();
        }
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

    // ===================================================================
    // HIERARCHICAL LOADING METHODS
    // ===================================================================

    private async loadGlobalViewWithImportanceLayer(): Promise<void> {
        try {
            this.showGraphLoading();

            // Get importance layer data (top 1000 most important nodes)
            const importanceData =
                await this.graphDataProvider.getGlobalImportanceLayer(1000);

            if (importanceData.entities.length === 0) {
                this.hideGraphLoading();
                this.showGraphEmpty();
                return;
            }

            // Check if graphology layout is available
            const hasGraphologyLayout =
                importanceData.metadata?.graphologyLayout;

            // Transform data to expected format for visualizer
            const transformedData: any = {
                // Only enhance for LoD if graphology layout is NOT available
                // This preserves community colors and sizes from graphology
                entities: hasGraphologyLayout
                    ? importanceData.entities // Use entities as-is (preserves graphology data)
                    : this.enhanceEntitiesForLoD(importanceData.entities), // Fallback to blue gradient
                relationships: importanceData.relationships,
                communities: [],
                topics: [],
                statistics: {
                    totalEntities: importanceData.entities.length,
                    totalRelationships: importanceData.relationships.length,
                    totalCommunities: 0,
                },
                metadata: importanceData.metadata,
            };

            if (hasGraphologyLayout) {
                console.log(
                    `[EntityGraphView] Using graphology preset layout with community colors (${importanceData.metadata.graphologyLayout.elements?.length || 0} elements)`,
                );
                transformedData.presetLayout = {
                    elements: importanceData.metadata.graphologyLayout.elements,
                    layoutDuration:
                        importanceData.metadata.graphologyLayout.layoutDuration,
                    avgSpacing:
                        importanceData.metadata.graphologyLayout.avgSpacing,
                    communityCount:
                        importanceData.metadata.graphologyLayout.communityCount,
                };
            }

            await this.visualizer.loadGlobalGraph(transformedData);
            this.hideGraphLoading();
        } catch (error) {
            console.error(
                "[HierarchicalLoading] Failed to load importance layer:",
                error,
            );
            this.hideGraphLoading();
            this.showGraphError("Failed to load importance layer");
        }
    }

    // ============================================================================
    // Browser Navigation Integration
    // ============================================================================

    /**
     * Setup browser navigation event handlers
     */
    private setupBrowserNavigation(): void {
        // Handle browser back/forward buttons
        window.addEventListener("popstate", async () => {
            if (this.isHandlingPopstate) return;

            this.isHandlingPopstate = true;

            try {
                // Parse current URL to determine target state
                const targetState = this.parseCurrentUrl();
                await this.navigateToStateFromUrl(targetState);
            } catch (error) {
                console.error("[Navigation] Popstate handling failed:", error);
            } finally {
                this.isHandlingPopstate = false;
            }
        });

        // Handle initial page load
        const initialState = this.parseCurrentUrl();
        this.addToNavigationHistory(initialState);
    }

    /**
     * Parse current URL to determine navigation state
     */
    private parseCurrentUrl(): NavigationState {
        const urlParams = new URLSearchParams(window.location.search);
        const entityParam = urlParams.get("entity");
        const topicParam = urlParams.get("topic");
        const modeParam = urlParams.get("mode");

        if (modeParam === "global" || (!entityParam && !topicParam)) {
            return {
                type: "global",
                timestamp: Date.now(),
            };
        } else {
            const entityName = entityParam || topicParam;
            return {
                type: "detail",
                entityName: entityName || undefined,
                timestamp: Date.now(),
                cacheKey: entityName ? `detail_${entityName}` : undefined,
            };
        }
    }

    /**
     * Navigate to state based on URL
     */
    private async navigateToStateFromUrl(
        targetState: NavigationState,
    ): Promise<void> {
        if (targetState.type === "global") {
            await this.executeGlobalViewTransition();
        } else if (targetState.type === "detail" && targetState.entityName) {
            await this.executeDetailViewTransition(targetState.entityName);
        }

        // Update internal state to match URL
        this.syncInternalStateWithUrl(targetState);
    }

    /**
     * Execute global view transition
     */
    private async executeGlobalViewTransition(): Promise<void> {
        // Try to use hide/show logic first (same as back button)
        const restored = this.visualizer.restoreHiddenView();
        if (restored) {
            // Update internal state to match the restored view
            this.currentEntity = null;
            this.currentViewMode = { type: "global" };
            // Hide sidebar when navigating to global view
            this.updateSidebarVisibility(false);
            this.updateBackButtonText();
        } else {
            // Fallback to original logic if no hidden view available
            this.currentEntity = null;
            this.currentViewMode = { type: "global" };
            // Hide sidebar when navigating to global view
            this.updateSidebarVisibility(false);
            await this.loadGlobalView();
        }
    }

    /**
     * Execute detail view transition
     */
    private async executeDetailViewTransition(
        entityName: string,
    ): Promise<void> {
        // Use existing navigateToEntity logic but prevent URL update loop
        const wasHandlingPopstate = this.isHandlingPopstate;
        this.isHandlingPopstate = true;

        try {
            await this.navigateToEntity(entityName);
        } finally {
            this.isHandlingPopstate = wasHandlingPopstate;
        }
    }

    /**
     * Sync internal state with URL
     */
    private syncInternalStateWithUrl(state: NavigationState): void {
        if (state.type === "global") {
            this.currentEntity = null;
            this.currentViewMode = { type: "global" };
        } else if (state.entityName) {
            this.currentEntity = state.entityName;
            this.currentViewMode = {
                type: "entity-specific",
                centerEntity: state.entityName,
            };
        }

        // Update breadcrumb and UI elements
        this.updateBreadcrumbForCurrentState();
        // Don't automatically show sidebar for detail state - let loadRealEntityData handle it
        if (state.type === "global") {
            this.updateSidebarVisibility(false);
        }

        // Update window title for restored state
        this.updateWindowTitle();
    }

    /**
     * Update breadcrumb for current state
     */
    private updateBreadcrumbForCurrentState(): void {
        const entityBreadcrumb = document.getElementById(
            "entityNameBreadcrumb",
        );
        if (entityBreadcrumb) {
            if (this.currentEntity) {
                entityBreadcrumb.textContent = ` > ${this.currentEntity}`;
            } else {
                entityBreadcrumb.textContent = " > Global View";
            }
        }

        const backToGlobalBtn = document.getElementById("backToGlobalBtn");
        if (backToGlobalBtn) {
            backToGlobalBtn.style.display = this.currentEntity
                ? "flex"
                : "none";
        }
    }

    /**
     * Update back button text based on hidden view stack
     */
    private updateBackButtonText(): void {
        const backToGlobalBtn = document.getElementById("backToGlobalBtn");
        if (!backToGlobalBtn) return;

        // Check if visualizer has a hidden view available
        if (this.visualizer && this.visualizer.hasHiddenView()) {
            const hiddenViewType = this.visualizer.getHiddenViewType();
            if (hiddenViewType === "global") {
                backToGlobalBtn.innerHTML =
                    '<i class="bi bi-arrow-left"></i> Global';
                backToGlobalBtn.title = "Back to Global View";
            } else if (hiddenViewType === "detail") {
                backToGlobalBtn.innerHTML =
                    '<i class="bi bi-arrow-left"></i> Details';
                backToGlobalBtn.title = "Back to Detail View";
            } else {
                backToGlobalBtn.innerHTML =
                    '<i class="bi bi-arrow-left"></i> Back';
                backToGlobalBtn.title = "Back to Previous View";
            }
        } else {
            // No hidden view, will go to global view
            backToGlobalBtn.innerHTML =
                '<i class="bi bi-arrow-left"></i> Global';
            backToGlobalBtn.title = "Back to Global View";
        }
    }

    /**
     * Add state to navigation history
     */
    private addToNavigationHistory(state: NavigationState): void {
        // Remove any future history if we're navigating from a middle point
        if (this.currentHistoryIndex < this.navigationHistory.length - 1) {
            this.navigationHistory = this.navigationHistory.slice(
                0,
                this.currentHistoryIndex + 1,
            );
        }

        // Add new state
        this.navigationHistory.push(state);
        this.currentHistoryIndex = this.navigationHistory.length - 1;

        // Limit history size
        if (this.navigationHistory.length > 50) {
            this.navigationHistory = this.navigationHistory.slice(-40);
            this.currentHistoryIndex = this.navigationHistory.length - 1;
        }
    }

    /**
     * Update URL for entity navigation
     */
    private updateUrlForEntity(entityName: string): void {
        const url = new URL(window.location.href);
        url.searchParams.set("entity", entityName);
        url.searchParams.delete("mode");
        url.searchParams.delete("topic");

        // Use replaceState if handling popstate to avoid adding duplicate history entries
        if (this.isHandlingPopstate) {
            window.history.replaceState({}, "", url.toString());
        } else {
            window.history.pushState({}, "", url.toString());
        }
    }

    /**
     * Update URL for global view
     */
    private updateUrlForGlobal(): void {
        const url = new URL(window.location.href);
        url.searchParams.delete("entity");
        url.searchParams.delete("topic");
        url.searchParams.set("mode", "global");

        if (this.isHandlingPopstate) {
            window.history.replaceState({}, "", url.toString());
        } else {
            window.history.pushState({}, "", url.toString());
        }
    }

    /**
     * Update window title based on current view mode and entity
     */
    private updateWindowTitle(): void {
        let title = "Entity Graph";

        if (
            this.currentEntity &&
            this.currentViewMode.type === "entity-specific"
        ) {
            /* COMMENTED OUT - Phase 3 detail view cleanup */
            // const activeView = this.visualizer.getCurrentActiveView();
            // if (activeView === "detail") {
            //     title = `${this.currentEntity} Details`;
            // } else {
            //     // Fallback for entity-specific view
            //     title = `${this.currentEntity} Details`;
            // }
            // Simplified - only global view now
            title = `${this.currentEntity} Details`;
        } else {
            // Global view
            title = "Entity Graph";
        }

        document.title = title;
        console.log(`[Title] Updated window title to: ${title}`);
    }
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    new EntityGraphView();
});

// Export for potential external usage
export { EntityGraphView };
