// Entity Discovery Implementation
// Advanced search, discovery, and exploration features for entity graphs

import {
    EntityGraphServices,
    DefaultEntityGraphServices,
} from "./knowledgeUtilities";

export interface EntitySearchPattern {
    entityType?: string;
    relationshipType?: string;
    confidenceThreshold?: number;
    timeRange?: TimeRange;
    domainFilter?: string[];
    strengthThreshold?: number;
}

export interface TimeRange {
    startDate: string;
    endDate: string;
}

export interface EntityCluster {
    clusterId: string;
    centerEntity: string;
    entities: string[];
    clusterType: "topic" | "organization" | "geographic" | "temporal";
    coherenceScore: number;
    description: string;
}

export interface EntityMergeCandidate {
    primaryEntity: string;
    duplicateEntity: string;
    similarityScore: number;
    reasons: string[];
    suggestedAction: "merge" | "keep_separate" | "review";
}

export interface DiscoveryPath {
    pathId: string;
    description: string;
    entities: string[];
    pathType: "learning_journey" | "relationship_chain" | "topic_exploration";
    estimatedValue: number;
}

export interface EntitySuggestion {
    entity: string;
    reason: string;
    confidence: number;
    relationshipTypes: string[];
}

/**
 * Advanced Entity Discovery and Search Component
 */
export class EntityDiscovery {
    private searchInput: HTMLInputElement | null = null;
    private suggestionsContainer: HTMLElement | null = null;
    private searchResults: HTMLElement | null = null;
    private mockMode: boolean = true;
    private currentQuery: string = "";
    private searchTimeout: number | null = null;
    private entityGraphService: EntityGraphServices;

    constructor(entityGraphService?: EntityGraphServices) {
        this.entityGraphService =
            entityGraphService || new DefaultEntityGraphServices();
        this.initialize();
    }

    /**
     * Initialize the discovery component
     */
    private initialize(): void {
        this.setupSearchElements();
        this.setupEntitySearch();
        this.setupAdvancedFilters();
        this.setupDiscoveryPaths();
    }

    /**
     * Set up search UI elements
     */
    private setupSearchElements(): void {
        this.searchInput = document.getElementById(
            "entitySearchInput",
        ) as HTMLInputElement;
        this.suggestionsContainer = document.getElementById(
            "entitySearchSuggestions",
        ) as HTMLElement;

        // Create search results container if it doesn't exist
        if (!this.searchResults) {
            this.searchResults = document.createElement("div");
            this.searchResults.id = "entitySearchResults";
            this.searchResults.className = "entity-search-results";
            this.searchResults.style.display = "none";

            // Insert after suggestions container
            if (
                this.suggestionsContainer &&
                this.suggestionsContainer.parentNode
            ) {
                this.suggestionsContainer.parentNode.insertBefore(
                    this.searchResults,
                    this.suggestionsContainer.nextSibling,
                );
            }
        }
    }

    /**
     * Set up entity search functionality
     */
    setupEntitySearch(): void {
        if (!this.searchInput) return;

        // Real-time search suggestions
        this.searchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value.trim();
            this.currentQuery = query;

            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }

            if (query.length >= 2) {
                this.searchTimeout = window.setTimeout(() => {
                    this.performSearch(query);
                }, 300);
            } else {
                this.hideSearchSuggestions();
            }
        });

        // Handle search submission
        this.searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.executeSearch(this.currentQuery);
            }
        });

        // Handle search button click
        const searchButton = document.getElementById("entitySearchButton");
        if (searchButton) {
            searchButton.addEventListener("click", () => {
                this.executeSearch(this.currentQuery);
            });
        }

        // Handle clicks outside to close suggestions
        document.addEventListener("click", (e) => {
            if (
                !this.searchInput?.contains(e.target as Node) &&
                !this.suggestionsContainer?.contains(e.target as Node)
            ) {
                this.hideSearchSuggestions();
            }
        });
    }

    /**
     * Perform search and show suggestions
     */
    async performSearch(query: string): Promise<void> {
        try {
            const suggestions = await this.searchEntities(query);
            this.renderEntitySuggestions(suggestions);
        } catch (error) {
            console.error("Search failed:", error);
            this.hideSearchSuggestions();
        }
    }

    /**
     * Execute full search and display results
     */
    async executeSearch(query: string): Promise<void> {
        if (!query.trim()) return;

        try {
            this.showSearchLoading();
            const searchResults = await this.performAdvancedSearch(query);
            this.displaySearchResults(searchResults);
            this.hideSearchSuggestions();
        } catch (error) {
            console.error("Advanced search failed:", error);
            this.showSearchError("Search failed. Please try again.");
        }
    }

    /**
     * Search entities (with mock data support)
     */
    async searchEntities(query: string): Promise<any[]> {
        if (this.mockMode) {
            return this.searchMockEntities(query);
        } else {
            return this.searchRealEntities(query);
        }
    }

    /**
     * Real entity search using enhanced search
     */
    private async searchRealEntities(query: string): Promise<any[]> {
        try {
            const searchResults = await this.entityGraphService.searchByEntity(
                query,
                {
                    maxResults: 8,
                    sortBy: "relevance",
                },
            );

            return searchResults.entities.map((entity: any) => ({
                name: entity.name,
                type: entity.type,
                confidence: entity.confidence,
                score:
                    entity.confidence * Math.min(entity.mentionCount / 10, 1), // Relevance score
            }));
        } catch (error) {
            console.error("Real entity search failed:", error);
            return [];
        }
    }

    /**
     * Mock entity search
     */
    private searchMockEntities(query: string): any[] {
        const mockEntities = [
            {
                name: "Microsoft",
                type: "organization",
                confidence: 0.95,
                score: 0.9,
            },
            {
                name: "Satya Nadella",
                type: "person",
                confidence: 0.98,
                score: 0.95,
            },
            { name: "Azure", type: "product", confidence: 0.92, score: 0.88 },
            {
                name: "Office365",
                type: "product",
                confidence: 0.85,
                score: 0.8,
            },
            {
                name: "OpenAI",
                type: "organization",
                confidence: 0.98,
                score: 0.92,
            },
            { name: "ChatGPT", type: "product", confidence: 0.92, score: 0.85 },
            {
                name: "Sam Altman",
                type: "person",
                confidence: 0.95,
                score: 0.9,
            },
            {
                name: "Anthropic",
                type: "organization",
                confidence: 0.88,
                score: 0.82,
            },
            { name: "Claude", type: "product", confidence: 0.85, score: 0.8 },
            { name: "GPT-4", type: "product", confidence: 0.9, score: 0.87 },
        ];

        const queryLower = query.toLowerCase();
        return mockEntities
            .filter((entity) => entity.name.toLowerCase().includes(queryLower))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);
    }

    /**
     * Render entity suggestions
     */
    renderEntitySuggestions(entities: any[]): void {
        if (!this.suggestionsContainer) return;

        if (entities.length === 0) {
            this.hideSearchSuggestions();
            return;
        }

        const suggestionsHtml = entities
            .map(
                (entity) => `
            <div class="entity-suggestion" data-entity="${entity.name}">
                <div class="entity-suggestion-icon entity-type-${entity.type}">
                    ${this.getEntityIcon(entity.type)}
                </div>
                <div class="entity-suggestion-info">
                    <div class="entity-suggestion-name">${this.escapeHtml(entity.name)}</div>
                    <div class="entity-suggestion-type">${entity.type}</div>
                </div>
                <div class="entity-suggestion-confidence">
                    ${Math.round(entity.confidence * 100)}%
                </div>
            </div>
        `,
            )
            .join("");

        this.suggestionsContainer.innerHTML = suggestionsHtml;
        this.suggestionsContainer.style.display = "block";

        // Add click handlers for suggestions
        this.suggestionsContainer
            .querySelectorAll(".entity-suggestion")
            .forEach((suggestion) => {
                suggestion.addEventListener("click", () => {
                    const entityName = suggestion.getAttribute("data-entity");
                    if (entityName) {
                        this.selectEntity(entityName);
                    }
                });
            });
    }

    /**
     * Hide search suggestions
     */
    private hideSearchSuggestions(): void {
        if (this.suggestionsContainer) {
            this.suggestionsContainer.style.display = "none";
        }
    }

    /**
     * Select an entity from suggestions
     */
    private selectEntity(entityName: string): void {
        if (this.searchInput) {
            this.searchInput.value = entityName;
        }

        this.hideSearchSuggestions();

        // Emit entity selection event
        const event = new CustomEvent("entitySelected", {
            detail: { entityName },
        });
        document.dispatchEvent(event);
    }

    /**
     * Perform advanced search with filters
     */
    private async performAdvancedSearch(query: string): Promise<any> {
        const searchPattern: EntitySearchPattern = {
            confidenceThreshold: 0.5,
            strengthThreshold: 0.3,
        };

        if (this.mockMode) {
            return this.mockAdvancedSearch(query, searchPattern);
        } else {
            return this.realAdvancedSearch(query, searchPattern);
        }
    }

    /**
     * Mock advanced search
     */
    private mockAdvancedSearch(
        query: string,
        pattern: EntitySearchPattern,
    ): any {
        const entities = this.searchMockEntities(query);
        const clusters = this.generateMockClusters(entities);
        const paths = this.generateMockDiscoveryPaths(query);
        const suggestions = this.generateMockSuggestions(query);

        return {
            query,
            entities,
            clusters,
            paths,
            suggestions,
            totalResults: entities.length,
        };
    }

    /**
     * Real advanced search (with enhanced search integration)
     */
    private async realAdvancedSearch(
        query: string,
        pattern: EntitySearchPattern,
    ): Promise<any> {
        try {
            const searchResults = await this.entityGraphService.searchByEntity(
                query,
                {
                    entityType: pattern.entityType,
                    confidenceThreshold: pattern.confidenceThreshold,
                    maxResults: 20,
                    sortBy: "relevance",
                    domainFilter: pattern.domainFilter,
                    timeRange: pattern.timeRange,
                },
            );

            // Generate clusters and paths from real data
            const clusters = this.generateClustersFromResults(
                searchResults.entities,
            );
            const paths = this.generatePathsFromResults(searchResults.entities);
            const suggestions = searchResults.suggestions;

            return {
                query,
                entities: searchResults.entities,
                clusters,
                paths,
                suggestions,
                totalResults: searchResults.totalCount,
            };
        } catch (error) {
            console.error("Real advanced search failed:", error);
            return {
                query,
                entities: [],
                clusters: [],
                paths: [],
                suggestions: [],
                totalResults: 0,
            };
        }
    }

    /**
     * Display search results
     */
    private displaySearchResults(results: any): void {
        if (!this.searchResults) return;

        const resultsHtml = `
            <div class="search-results-header">
                <h3>Search Results for "${this.escapeHtml(results.query)}"</h3>
                <div class="results-count">${results.totalResults} entities found</div>
                <button class="close-search-results" onclick="this.parentElement.parentElement.style.display='none'">
                    <i class="bi bi-x"></i>
                </button>
            </div>

            <div class="search-results-content">
                ${this.renderSearchResultsSection("Entities", results.entities, this.renderEntityResult.bind(this))}
                ${this.renderSearchResultsSection("Clusters", results.clusters, this.renderClusterResult.bind(this))}
                ${this.renderSearchResultsSection("Discovery Paths", results.paths, this.renderPathResult.bind(this))}
                ${this.renderSearchResultsSection("Suggestions", results.suggestions, this.renderSuggestionResult.bind(this))}
            </div>
        `;

        this.searchResults.innerHTML = resultsHtml;
        this.searchResults.style.display = "block";

        // Add event handlers for results
        this.setupSearchResultHandlers();
    }

    /**
     * Render a search results section
     */
    private renderSearchResultsSection(
        title: string,
        items: any[],
        renderFunc: (item: any) => string,
    ): string {
        if (!items || items.length === 0) return "";

        return `
            <div class="search-results-section">
                <h4>${title}</h4>
                <div class="search-results-list">
                    ${items.map(renderFunc).join("")}
                </div>
            </div>
        `;
    }

    /**
     * Render individual entity result
     */
    private renderEntityResult(entity: any): string {
        return `
            <div class="search-result-item entity-result" data-entity="${entity.name}">
                <div class="result-icon entity-type-${entity.type}">
                    ${this.getEntityIcon(entity.type)}
                </div>
                <div class="result-info">
                    <div class="result-name">${this.escapeHtml(entity.name)}</div>
                    <div class="result-type">${entity.type}</div>
                </div>
                <div class="result-confidence">
                    ${Math.round(entity.confidence * 100)}%
                </div>
            </div>
        `;
    }

    /**
     * Render cluster result
     */
    private renderClusterResult(cluster: any): string {
        return `
            <div class="search-result-item cluster-result" data-cluster="${cluster.clusterId}">
                <div class="result-icon">
                    <i class="bi bi-diagram-3"></i>
                </div>
                <div class="result-info">
                    <div class="result-name">${this.escapeHtml(cluster.description)}</div>
                    <div class="result-type">${cluster.entities.length} entities</div>
                </div>
                <div class="result-confidence">
                    ${Math.round(cluster.coherenceScore * 100)}%
                </div>
            </div>
        `;
    }

    /**
     * Render discovery path result
     */
    private renderPathResult(path: any): string {
        return `
            <div class="search-result-item path-result" data-path="${path.pathId}">
                <div class="result-icon">
                    <i class="bi bi-arrow-through-heart"></i>
                </div>
                <div class="result-info">
                    <div class="result-name">${this.escapeHtml(path.description)}</div>
                    <div class="result-type">${path.entities.length} entities • ${path.pathType}</div>
                </div>
                <div class="result-confidence">
                    ${Math.round(path.estimatedValue * 100)}%
                </div>
            </div>
        `;
    }

    /**
     * Render suggestion result
     */
    private renderSuggestionResult(suggestion: any): string {
        return `
            <div class="search-result-item suggestion-result" data-entity="${suggestion.entity}">
                <div class="result-icon">
                    <i class="bi bi-lightbulb"></i>
                </div>
                <div class="result-info">
                    <div class="result-name">${this.escapeHtml(suggestion.entity)}</div>
                    <div class="result-type">${suggestion.reason}</div>
                </div>
                <div class="result-confidence">
                    ${Math.round(suggestion.confidence * 100)}%
                </div>
            </div>
        `;
    }

    /**
     * Set up search result event handlers
     */
    private setupSearchResultHandlers(): void {
        if (!this.searchResults) return;

        // Entity results
        this.searchResults
            .querySelectorAll(".entity-result")
            .forEach((result) => {
                result.addEventListener("click", () => {
                    const entityName = result.getAttribute("data-entity");
                    if (entityName) {
                        this.navigateToEntity(entityName);
                    }
                });
            });

        // Cluster results
        this.searchResults
            .querySelectorAll(".cluster-result")
            .forEach((result) => {
                result.addEventListener("click", () => {
                    const clusterId = result.getAttribute("data-cluster");
                    if (clusterId) {
                        this.exploreCluster(clusterId);
                    }
                });
            });

        // Path results
        this.searchResults
            .querySelectorAll(".path-result")
            .forEach((result) => {
                result.addEventListener("click", () => {
                    const pathId = result.getAttribute("data-path");
                    if (pathId) {
                        this.followDiscoveryPath(pathId);
                    }
                });
            });
    }

    /**
     * Set up advanced filtering
     */
    private setupAdvancedFilters(): void {
        // This would set up the advanced filter UI
        console.log("Setting up advanced filters");
    }

    /**
     * Set up discovery paths
     */
    private setupDiscoveryPaths(): void {
        // This would set up the discovery paths UI
        console.log("Setting up discovery paths");
    }

    // Mock data generators
    private generateMockClusters(entities: any[]): EntityCluster[] {
        if (entities.length === 0) return [];

        return [
            {
                clusterId: "tech-leaders",
                centerEntity: entities[0].name,
                entities: entities.slice(0, 3).map((e) => e.name),
                clusterType: "organization",
                coherenceScore: 0.85,
                description: "Technology Leadership Cluster",
            },
        ];
    }

    private generateMockDiscoveryPaths(query: string): DiscoveryPath[] {
        return [
            {
                pathId: "ai-evolution",
                description: "AI Technology Evolution Path",
                entities: ["OpenAI", "ChatGPT", "GPT-4", "Sam Altman"],
                pathType: "learning_journey",
                estimatedValue: 0.9,
            },
            {
                pathId: "microsoft-ecosystem",
                description: "Microsoft Business Ecosystem",
                entities: ["Microsoft", "Satya Nadella", "Azure", "Office365"],
                pathType: "relationship_chain",
                estimatedValue: 0.85,
            },
        ];
    }

    private generateMockSuggestions(query: string): EntitySuggestion[] {
        return [
            {
                entity: "Microsoft",
                reason: "Related to AI development",
                confidence: 0.75,
                relationshipTypes: ["competitor", "partner"],
            },
            {
                entity: "Google",
                reason: "Technology sector leader",
                confidence: 0.82,
                relationshipTypes: ["competitor", "technology_provider"],
            },
        ];
    }

    // Navigation methods
    private navigateToEntity(entityName: string): void {
        const event = new CustomEvent("entityNavigate", {
            detail: { entityName },
        });
        document.dispatchEvent(event);
    }

    private exploreCluster(clusterId: string): void {
        const event = new CustomEvent("clusterExplore", {
            detail: { clusterId },
        });
        document.dispatchEvent(event);
    }

    private followDiscoveryPath(pathId: string): void {
        const event = new CustomEvent("pathFollow", {
            detail: { pathId },
        });
        document.dispatchEvent(event);
    }

    // Utility methods
    private showSearchLoading(): void {
        if (this.searchResults) {
            this.searchResults.innerHTML = `
                <div class="search-loading">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Searching...</span>
                    </div>
                    <p>Searching entities...</p>
                </div>
            `;
            this.searchResults.style.display = "block";
        }
    }

    private showSearchError(message: string): void {
        if (this.searchResults) {
            this.searchResults.innerHTML = `
                <div class="search-error">
                    <i class="bi bi-exclamation-triangle"></i>
                    <p>${message}</p>
                </div>
            `;
            this.searchResults.style.display = "block";
        }
    }

    private getEntityIcon(type: string): string {
        const iconMap: { [key: string]: string } = {
            person: '<i class="bi bi-person"></i>',
            organization: '<i class="bi bi-building"></i>',
            product: '<i class="bi bi-box"></i>',
            concept: '<i class="bi bi-lightbulb"></i>',
            location: '<i class="bi bi-geo"></i>',
            technology: '<i class="bi bi-cpu"></i>',
        };
        return iconMap[type] || '<i class="bi bi-diagram-2"></i>';
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Set mock mode
     */
    setMockMode(enabled: boolean): void {
        this.mockMode = enabled;
    }

    /**
     * Clear search results
     */
    clearResults(): void {
        if (this.searchResults) {
            this.searchResults.style.display = "none";
        }
        this.hideSearchSuggestions();

        if (this.searchInput) {
            this.searchInput.value = "";
        }
    }

    // Helper methods for real data processing

    /**
     * Generate clusters from search results
     */
    private generateClustersFromResults(entities: any[]): any[] {
        const clusters: any[] = [];

        // Group entities by type
        const typeGroups = entities.reduce((groups, entity) => {
            const type = entity.type;
            if (!groups[type]) {
                groups[type] = [];
            }
            groups[type].push(entity);
            return groups;
        }, {});

        // Create clusters for each type with multiple entities
        for (const [type, typeEntities] of Object.entries(typeGroups)) {
            if ((typeEntities as any[]).length > 1) {
                clusters.push({
                    clusterId: `cluster-${type}`,
                    description: `${type.charAt(0).toUpperCase() + type.slice(1)} Cluster`,
                    entities: (typeEntities as any[]).slice(0, 5), // Top 5 entities
                    clusterType: "topical",
                    coherenceScore: 0.8,
                });
            }
        }

        return clusters;
    }

    /**
     * Generate discovery paths from search results
     */
    private generatePathsFromResults(entities: any[]): any[] {
        const paths: any[] = [];

        if (entities.length > 2) {
            // Create a learning journey path
            paths.push({
                pathId: "learning-journey",
                description: "Entity Learning Journey",
                entities: entities.slice(0, 4).map((e) => e.name),
                pathType: "learning_journey",
                estimatedValue: 0.85,
            });
        }

        if (entities.length > 3) {
            // Create a relationship chain path
            paths.push({
                pathId: "relationship-chain",
                description: "Entity Relationship Chain",
                entities: entities.slice(1, 5).map((e) => e.name),
                pathType: "relationship_chain",
                estimatedValue: 0.75,
            });
        }

        return paths;
    }
}
