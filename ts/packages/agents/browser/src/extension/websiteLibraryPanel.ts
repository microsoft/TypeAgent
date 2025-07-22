// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface ImportOptions {
    source: "chrome" | "edge";
    type: "bookmarks" | "history";
    limit?: number;
    days?: number;
    folder?: string;
    extractContent?: boolean;
    enableIntelligentAnalysis?: boolean;
    enableActionDetection?: boolean;
    extractionMode?: "basic" | "content" | "actions" | "full";
    maxConcurrent?: number;
    contentTimeout?: number;
}

interface LibraryStats {
    totalWebsites: number;
    totalBookmarks: number;
    totalHistory: number;
    topDomains: number;
    lastImport?: number;
}

interface SearchFilters {
    dateFrom?: string;
    dateTo?: string;
    sourceType?: "bookmarks" | "history";
    domain?: string;
    minRelevance?: number;
}

interface KnowledgeStatus {
    hasKnowledge: boolean;
    extractionDate?: string;
    entityCount?: number;
    topicCount?: number;
    suggestionCount?: number;
    status: "extracted" | "pending" | "error" | "none";
    confidence?: number;
}

interface Website {
    url: string;
    title: string;
    domain: string;
    visitCount?: number;
    lastVisited?: string;
    source: "bookmarks" | "history";
    score?: number;
    snippet?: string;
    knowledge?: KnowledgeStatus;
}

interface SearchResult {
    websites: Website[];
    summary: {
        text: string;
        totalFound: number;
        searchTime: number;
        sources: SourceReference[];
        entities: EntityMatch[];
    };
    query: string;
    filters: SearchFilters;
}

interface SourceReference {
    url: string;
    title: string;
    relevance: number;
}

interface EntityMatch {
    entity: string;
    type: string;
    count: number;
}

interface SuggestedSearch {
    query: string;
    category: string;
    description: string;
    estimatedResults: number;
}

interface CategorySuggestions {
    recentFinds: SuggestedSearch[];
    popularDomains: SuggestedSearch[];
    exploreTopics: SuggestedSearch[];
}

class WebsiteLibraryPanel {
    private isConnected: boolean = false;
    private currentImport: {
        id: string;
        startTime: number;
        cancelled: boolean;
    } | null = null;
    private selectedBrowser: string = "";
    private selectedType: string = "";

    // Search-related properties
    private currentResults: Website[] = [];
    private currentViewMode: "list" | "card" | "timeline" | "domain" = "list";
    private searchDebounceTimer: number | null = null;
    private recentSearches: string[] = [];
    private currentQuery: string = "";

    private settingsModal: any = null;
    private knowledgeStatusCache: Map<string, KnowledgeStatus> = new Map();

    async initialize() {
        console.log("Initializing Website Library Panel");

        this.setupEventListeners();
        this.setupSearchEventListeners();
        this.setupViewModeHandlers();
        this.setupTabEventListeners();
        await this.checkConnectionStatus();
        await this.loadLibraryStats();
        await this.loadRecentSearches();
        await this.loadSuggestedSearches();
    }

    private setupEventListeners() {
        document.querySelectorAll("[data-browser]").forEach((option) => {
            option.addEventListener("click", () => {
                this.selectBrowser(option.getAttribute("data-browser")!);
            });
        });

        document.querySelectorAll("[data-type]").forEach((option) => {
            option.addEventListener("click", () => {
                this.selectDataType(option.getAttribute("data-type")!);
            });
        });

        document
            .getElementById("startImport")!
            .addEventListener("click", () => {
                this.startImport();
            });

        document
            .getElementById("cancelImport")!
            .addEventListener("click", () => {
                this.cancelImport();
            });

        document
            .getElementById("settingsButton")!
            .addEventListener("click", () => {
                this.showSettings();
            });
    }

    private setupSearchEventListeners() {
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        const searchButton = document.getElementById("searchButton")!;
        const relevanceFilter = document.getElementById(
            "relevanceFilter",
        ) as HTMLInputElement;

        // Search input handlers
        searchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.handleSearchInput(query);
        });

        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                this.performSearch();
            }
        });

        searchButton.addEventListener("click", () => {
            this.performSearch();
        });

        // Relevance filter update
        relevanceFilter.addEventListener("input", (e) => {
            const value = (e.target as HTMLInputElement).value;
            document.getElementById("relevanceValue")!.textContent =
                `${value}%`;
        });

        // Filter change handlers
        [
            "dateFrom",
            "dateTo",
            "sourceFilter",
            "domainFilter",
            "relevanceFilter",
        ].forEach((id) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener("change", () => {
                    if (this.currentQuery) {
                        this.performSearch();
                    }
                });
            }
        });

        // Hide suggestions when clicking outside
        document.addEventListener("click", (e) => {
            const suggestions = document.getElementById("searchSuggestions")!;
            if (
                !searchInput.contains(e.target as Node) &&
                !suggestions.contains(e.target as Node)
            ) {
                suggestions.classList.add("d-none");
            }
        });
    }

    private setupViewModeHandlers() {
        document.querySelectorAll('input[name="viewMode"]').forEach((radio) => {
            radio.addEventListener("change", (e) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) {
                    this.currentViewMode = target.id.replace("View", "") as any;
                    this.rerenderResults();
                }
            });
        });
    }

    private setupTabEventListeners() {
        // Tab switching handlers are managed by Bootstrap, but we can add custom logic if needed
        const tabs = document.querySelectorAll(
            '#libraryTabs button[data-bs-toggle="tab"]',
        );
        tabs.forEach((tab) => {
            tab.addEventListener("shown.bs.tab", (e) => {
                const targetTab = (e.target as HTMLElement).getAttribute(
                    "data-bs-target",
                );
                this.onTabChanged(
                    targetTab?.replace("#", "").replace("-pane", "") || "",
                );
            });
        });
    }

    private onTabChanged(tabName: string) {
        console.log(`Switched to tab: ${tabName}`);

        // Refresh content when switching to specific tabs
        if (tabName === "discover") {
            this.loadSuggestedSearches();
        }
    }

    showSettings() {
        if (!this.settingsModal) {
            const settingsModalElement =
                document.getElementById("settingsModal")!;
            this.settingsModal = new (window as any).bootstrap.Modal(
                settingsModalElement,
            );

            // Add event listeners for proper cleanup
            settingsModalElement.addEventListener("hidden.bs.modal", () => {
                // Remove any lingering backdrop
                const backdrop = document.querySelector(".modal-backdrop");
                if (backdrop) {
                    backdrop.remove();
                }
                // Ensure body classes are cleaned up
                document.body.classList.remove("modal-open");
                document.body.style.removeProperty("overflow");
                document.body.style.removeProperty("padding-right");
            });
        }

        this.settingsModal.show();
    }

    private selectBrowser(browser: string) {
        document.querySelectorAll("[data-browser]").forEach((option) => {
            option.classList.remove("selected");
        });
        document
            .querySelector(`[data-browser="${browser}"]`)!
            .classList.add("selected");
        this.selectedBrowser = browser;
        this.updateImportButton();
    }

    private selectDataType(type: string) {
        document.querySelectorAll("[data-type]").forEach((option) => {
            option.classList.remove("selected");
        });
        document
            .querySelector(`[data-type="${type}"]`)!
            .classList.add("selected");
        this.selectedType = type;

        const daysContainer = document.getElementById("daysBackContainer")!;
        const folderContainer = document.getElementById("folderContainer")!;

        if (type === "history") {
            daysContainer.style.display = "block";
            folderContainer.style.display = "none";
        } else {
            daysContainer.style.display = "none";
            folderContainer.style.display = "block";
        }

        this.updateImportButton();
    }

    private updateImportButton() {
        const startButton = document.getElementById(
            "startImport",
        ) as HTMLButtonElement;
        startButton.disabled = !this.selectedBrowser || !this.selectedType;
    }

    private async startImport() {
        if (!this.selectedBrowser || !this.selectedType) {
            this.showNotification(
                "Please select both browser and data type",
                "error",
            );
            return;
        }

        const options: ImportOptions = {
            source: this.selectedBrowser as "chrome" | "edge",
            type: this.selectedType as "bookmarks" | "history",
        };

        const limitInput = document.getElementById(
            "importLimit",
        ) as HTMLInputElement;
        if (limitInput.value) {
            options.limit = parseInt(limitInput.value);
        }

        const daysInput = document.getElementById(
            "daysBack",
        ) as HTMLInputElement;
        if (daysInput.value && this.selectedType === "history") {
            options.days = parseInt(daysInput.value);
        }

        const folderInput = document.getElementById(
            "bookmarkFolder",
        ) as HTMLInputElement;
        if (folderInput.value && this.selectedType === "bookmarks") {
            options.folder = folderInput.value;
        }

        // Get enhancement options
        const extractContentCheckbox = document.getElementById(
            "extractContent",
        ) as HTMLInputElement;
        options.extractContent = extractContentCheckbox.checked;

        const intelligentAnalysisCheckbox = document.getElementById(
            "enableIntelligentAnalysis",
        ) as HTMLInputElement;
        options.enableIntelligentAnalysis = intelligentAnalysisCheckbox.checked;

        const actionDetectionCheckbox = document.getElementById(
            "enableActionDetection",
        ) as HTMLInputElement;
        options.enableActionDetection = actionDetectionCheckbox.checked;

        options.extractionMode = "basic";
        if (options.enableIntelligentAnalysis) {
            if (options.enableActionDetection) {
                options.extractionMode = "full";
            } else {
                options.extractionMode = "content";
            }
        }

        // Set performance defaults - increased timeout for debugging
        options.maxConcurrent = 5; // Limit concurrent requests
        options.contentTimeout = 30000; // 30 second timeout per page (increased for debugging)
        // Set performance defaults - increased timeout for debugging
        options.maxConcurrent = 5; // Limit concurrent requests
        options.contentTimeout = 30000; // 30 second timeout per page (increased for debugging)

        this.showImportProgress();

        this.currentImport = {
            id: this.generateImportId(),
            startTime: Date.now(),
            cancelled: false,
        };

        try {
            const response = await chrome.runtime.sendMessage({
                type: "importWebsiteDataWithProgress",
                parameters: options,
                importId: this.currentImport.id,
            });

            if (response.success) {
                await this.completeImport(response.itemCount);
            } else {
                await this.failImport(response.error);
                this.showNotification(
                    `Import failed: ${response.error}`,
                    "error",
                );
            }
        } catch (error) {
            console.error("Import error:", error);
            await this.failImport(
                error instanceof Error ? error.message : "Unknown error",
            );
            this.showNotification(
                "Import failed due to connection error",
                "error",
            );
        }
    }

    private async cancelImport() {
        if (this.currentImport) {
            this.currentImport.cancelled = true;

            try {
                await chrome.runtime.sendMessage({
                    type: "cancelImport",
                    importId: this.currentImport.id,
                });
            } catch (error) {
                console.error("Error cancelling import:", error);
            }

            await this.failImport("Cancelled by user");
            this.showNotification("Import cancelled", "info");
        }
    }

    private showImportProgress() {
        document.getElementById("importForm")!.classList.add("d-none");
        document.getElementById("importProgress")!.classList.remove("d-none");

        const connectionStatus = document.getElementById("connectionStatus")!;
        connectionStatus.innerHTML = this.createStatusIndicator(
            "importing",
            "Importing data...",
        );

        // Update the status message
        const statusMessage = document.getElementById("importStatusMessage")!;
        statusMessage.textContent = `Importing ${this.selectedType} from ${this.selectedBrowser}...`;
    }

    private hideImportProgress() {
        document.getElementById("importForm")!.classList.remove("d-none");
        document.getElementById("importProgress")!.classList.add("d-none");

        this.currentImport = null;
        this.updateConnectionStatus();
    }

    private async completeImport(itemCount: number) {
        this.hideImportProgress();

        // Show success notification
        this.showNotification(
            `Successfully imported ${itemCount} items from ${this.selectedBrowser} ${this.selectedType}!`,
            "success",
        );

        // Update the UI with fresh data
        await this.refreshUIAfterImport();
    }

    private async refreshUIAfterImport() {
        try {
            // Update library stats (for overview section)
            await this.loadLibraryStats();

            // Update suggested searches (for discover tab)
            await this.loadSuggestedSearches();

            console.log("UI refreshed after successful import");
        } catch (error) {
            console.error("Error refreshing UI after import:", error);
        }
    }

    private async failImport(error: string) {
        this.hideImportProgress();
    }

    private getImportOptions(): ImportOptions {
        const limitInput = document.getElementById(
            "importLimit",
        ) as HTMLInputElement;
        const daysInput = document.getElementById(
            "daysBack",
        ) as HTMLInputElement;
        const folderInput = document.getElementById(
            "bookmarkFolder",
        ) as HTMLInputElement;

        // Get enhancement option elements
        const extractContentCheckbox = document.getElementById(
            "extractContent",
        ) as HTMLInputElement;
        const intelligentAnalysisCheckbox = document.getElementById(
            "enableIntelligentAnalysis",
        ) as HTMLInputElement;
        const actionDetectionCheckbox = document.getElementById(
            "enableActionDetection",
        ) as HTMLInputElement;
        const extractionModeSelect = document.getElementById(
            "extractionMode",
        ) as HTMLSelectElement;

        const options: ImportOptions = {
            source: this.selectedBrowser as "chrome" | "edge",
            type: this.selectedType as "bookmarks" | "history",
        };

        if (limitInput.value) options.limit = parseInt(limitInput.value);
        if (daysInput.value && this.selectedType === "history")
            options.days = parseInt(daysInput.value);
        if (folderInput.value && this.selectedType === "bookmarks")
            options.folder = folderInput.value;

        // Add enhancement options
        options.extractContent = extractContentCheckbox.checked;
        options.enableIntelligentAnalysis = intelligentAnalysisCheckbox.checked;
        options.enableActionDetection = actionDetectionCheckbox.checked;

        options.extractionMode = "basic";
        if (options.enableIntelligentAnalysis) {
            if (options.enableActionDetection) {
                options.extractionMode = "full";
            } else {
                options.extractionMode = "content";
            }
        }

        return options;
    }

    private async loadLibraryStats() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getWebsiteLibraryStats",
            });

            if (response.success) {
                this.renderLibraryStats(response.stats);
            } else {
                console.error("Failed to load library stats:", response.error);
            }
        } catch (error) {
            console.error("Error loading library stats:", error);
            this.renderLibraryStats({
                totalWebsites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                topDomains: 0,
            });
        }
    }

    private renderLibraryStats(stats: LibraryStats) {
        document.getElementById("totalWebsites")!.textContent =
            stats.totalWebsites.toString();
        document.getElementById("totalBookmarks")!.textContent =
            stats.totalBookmarks.toString();
        document.getElementById("totalHistory")!.textContent =
            stats.totalHistory.toString();
        document.getElementById("topDomains")!.textContent =
            stats.topDomains.toString();

        const emptyState = document.getElementById("emptyLibraryState")!;
        const libraryActions = document.getElementById("libraryActions")!;

        if (stats.totalWebsites === 0) {
            emptyState.classList.remove("d-none");
        } else {
            emptyState.classList.add("d-none");
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkConnection",
            });

            this.isConnected = response.connected;
            this.updateConnectionStatus();
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus")!;

        if (this.isConnected) {
            statusElement.innerHTML = this.createStatusIndicator(
                "connected",
                "Connected to TypeAgent",
            );
        } else {
            statusElement.innerHTML = this.createStatusIndicator(
                "disconnected",
                "Disconnected from TypeAgent",
            );
        }
    }

    private generateImportId(): string {
        return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private showNotification(
        message: string,
        type: "success" | "error" | "info" = "info",
    ) {
        const alertClass = `alert-${type === "error" ? "danger" : type}`;
        const iconClass =
            type === "success"
                ? "bi-check-circle"
                : type === "error"
                  ? "bi-exclamation-triangle"
                  : "bi-info-circle";

        const notification = document.createElement("div");
        notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        notification.style.cssText =
            "top: 1rem; right: 1rem; z-index: 1050; min-width: 300px;";
        notification.innerHTML = `
            <i class="${iconClass} me-2"></i>${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    // Search-related methods
    private handleSearchInput(query: string) {
        this.currentQuery = query;

        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (query.length === 0) {
            // Clear results when input is empty
            this.clearSearchResults();
            document
                .getElementById("searchSuggestions")!
                .classList.add("d-none");
        } else if (query.length >= 2) {
            this.searchDebounceTimer = window.setTimeout(() => {
                this.getSearchSuggestions(query);
            }, 300);
        } else {
            document
                .getElementById("searchSuggestions")!
                .classList.add("d-none");
        }
    }

    private clearSearch() {
        // Clear search input
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = "";
        this.currentQuery = "";

        // Clear search results
        this.clearSearchResults();

        // Hide search suggestions
        document.getElementById("searchSuggestions")!.classList.add("d-none");

        console.log("Search cleared");
    }

    private clearSearchResults() {
        // Clear results data
        this.currentResults = [];
        this.currentQuery = "";

        // Hide results card
        const resultsCard = document.getElementById("searchResultsCard")!;
        resultsCard.classList.add("d-none");

        // Clear results containers
        const resultsContainer = document.getElementById(
            "searchResultsContainer",
        )!;
        resultsContainer.innerHTML = "";

        const summaryContainer = document.getElementById("resultsSummary")!;
        summaryContainer.innerHTML = "";

        const aiSummarySection = document.getElementById("aiSummarySection")!;
        aiSummarySection.innerHTML = "";
        aiSummarySection.classList.add("d-none");

        // Clear pagination
        const paginationContainer =
            document.getElementById("resultsPagination")!;
        paginationContainer.innerHTML = "";

        console.log("Search results cleared");
    }

    private showSearchLoading() {
        const resultsCard = document.getElementById("searchResultsCard")!;
        const resultsContainer = document.getElementById(
            "searchResultsContainer",
        )!;

        // Show results card with loading state
        resultsCard.classList.remove("d-none");

        // Show loading spinner
        resultsContainer.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary mb-3" role="status">
                    <span class="visually-hidden">Searching...</span>
                </div>
                <div class="text-muted">Searching your library...</div>
            </div>
        `;

        // Clear other sections
        const summaryContainer = document.getElementById("resultsSummary")!;
        summaryContainer.innerHTML = "";

        const aiSummarySection = document.getElementById("aiSummarySection")!;
        aiSummarySection.classList.add("d-none");
    }

    private async performSearch() {
        const query = this.currentQuery.trim();
        if (!query) {
            this.showNotification("Please enter a search query", "info");
            return;
        }

        // Clear previous results and show loading
        this.clearSearchResults();
        this.currentQuery = query;
        this.showSearchLoading();

        const searchButton = document.getElementById(
            "searchButton",
        ) as HTMLButtonElement;
        const originalContent = searchButton.innerHTML;

        searchButton.innerHTML = '<i class="bi bi-hourglass-split"></i>';
        searchButton.disabled = true;

        try {
            const filters = this.getActiveFilters();

            const response = await chrome.runtime.sendMessage({
                type: "queryKnowledge",
                parameters: {
                    query: query,
                    searchScope: "all_indexed",
                    maxResults: 50,
                    minRelevance: filters.minRelevance || 0,
                    includeSuggestedQuestions: false,
                    filters: filters,
                },
            });

            let searchResults: SearchResult;

            if (
                response.answer ||
                (response.sources && response.sources.length > 0)
            ) {
                // Transform semantic search result to SearchResult format
                searchResults = {
                    websites:
                        response.sources?.map((source: any) => ({
                            url: source.url,
                            title: source.title,
                            domain: new URL(source.url).hostname,
                            source: "bookmarks", // Default, will be updated by knowledge check
                            score: source.relevanceScore,
                            snippet: source.snippet || "",
                        })) || [],
                    summary: {
                        text: response.answer || "",
                        totalFound: response.sources?.length || 0,
                        searchTime: 0, // Not provided in knowledge response
                        sources: response.sources || [],
                        entities:
                            response.relatedEntities?.map((entity: any) => ({
                                entity: entity.name,
                                type: entity.type,
                                count: 1,
                            })) || [],
                    },
                    query: query,
                    filters: filters,
                };
            } else {
                // Fallback empty result
                searchResults = {
                    websites: [],
                    summary: {
                        text: "No results found.",
                        totalFound: 0,
                        searchTime: 0,
                        sources: [],
                        entities: [],
                    },
                    query: query,
                    filters: filters,
                };
            }

            await this.renderSearchResults(searchResults);
            await this.saveSearchToHistory(query);
            await this.loadRecentSearches();
        } catch (error) {
            console.error("Search error:", error);
            this.showNotification(
                "Search failed due to connection error",
                "error",
            );
        } finally {
            searchButton.innerHTML = originalContent;
            searchButton.disabled = false;
        }
    }

    private async getSearchSuggestions(query: string) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getSearchSuggestions",
                parameters: { query: query, limit: 5 },
            });

            if (response.success && response.suggestions.length > 0) {
                this.renderSearchSuggestions(response.suggestions);
            } else {
                document
                    .getElementById("searchSuggestions")!
                    .classList.add("d-none");
            }
        } catch (error) {
            console.error("Error getting search suggestions:", error);
        }
    }

    private renderSearchSuggestions(suggestions: string[]) {
        const container = document.getElementById("searchSuggestions")!;

        container.innerHTML = suggestions
            .map(
                (suggestion, index) => `
             <div class="suggestion-item" data-action="select-suggestion" data-suggestion-index="${index}">
                ${suggestion}
            </div>
        `,
            )
            .join("");

        container.classList.remove("d-none");
        this.attachSuggestionListeners(container, suggestions);
    }

    selectSuggestion(suggestion: string) {
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = suggestion;
        this.currentQuery = suggestion;
        document.getElementById("searchSuggestions")!.classList.add("d-none");
        this.performSearch();
    }

    private getActiveFilters(): SearchFilters {
        const dateFrom = (
            document.getElementById("dateFrom") as HTMLInputElement
        ).value;
        const dateTo = (document.getElementById("dateTo") as HTMLInputElement)
            .value;
        const sourceType = (
            document.getElementById("sourceFilter") as HTMLSelectElement
        ).value;
        const domain = (
            document.getElementById("domainFilter") as HTMLInputElement
        ).value;
        const relevance = parseInt(
            (document.getElementById("relevanceFilter") as HTMLInputElement)
                .value,
        );

        const filters: SearchFilters = {};
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
        if (sourceType)
            filters.sourceType = sourceType as "bookmarks" | "history";
        if (domain) filters.domain = domain;
        if (relevance > 0) filters.minRelevance = relevance / 100;

        return filters;
    }

    // Template utility functions for common patterns
    private createStatusIndicator(type: string, text: string): string {
        return `<span class="status-indicator status-${type}"></span>${text}`;
    }

    private createButton(
        text: string,
        action: string,
        data: Record<string, string>,
        classes = "btn btn-outline-primary btn-sm",
    ): string {
        const dataAttrs = Object.entries(data)
            .map(
                ([key, value]) =>
                    `data-${key}="${this.escapeDataAttribute(value)}"`,
            )
            .join(" ");
        return `<button class="${classes}" data-action="${action}" ${dataAttrs}>${text}</button>`;
    }

    private createFaviconLink(
        url: string,
        title: string,
        domain: string,
    ): string {
        return `
            <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                 class="result-favicon" alt="favicon">
            <a href="${url}" target="_blank" class="fw-semibold text-decoration-none">
                ${title || url}
            </a>
        `;
    }

    private formatSourceInfo(site: Website): string {
        const parts = [site.source === "bookmarks" ? "Bookmark" : "History"];

        if (site.visitCount) {
            parts.push(`${site.visitCount} visits`);
        }

        if (site.lastVisited) {
            parts.push(new Date(site.lastVisited).toLocaleDateString());
        }

        return parts.join(" • ");
    }

    private escapeDataAttribute(value: string): string {
        return value.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // Component-based rendering methods for list items
    private renderListItem(site: Website): string {
        return `
            <div class="search-result-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        ${this.renderSiteHeader(site)}
                        ${this.renderSiteDetails(site)}
                        ${this.renderSiteMetadata(site)}
                    </div>
                </div>
            </div>
        `;
    }

    private renderSiteHeader(site: Website): string {
        const scoreDisplay = site.score
            ? `<span class="result-score ms-2">${Math.round(site.score * 100)}%</span>`
            : "";

        return `
            <div class="d-flex align-items-center mb-1">
                ${this.createFaviconLink(site.url, site.title || site.url, site.domain)}
                ${scoreDisplay}
                ${this.getKnowledgeStatusBadge(site.knowledge)}
            </div>
        `;
    }

    private renderSiteDetails(site: Website): string {
        const snippetDisplay = site.snippet
            ? `<p class="small mb-1">${site.snippet}</p>`
            : "";

        return `
            <div class="result-domain text-muted small mb-1">${site.domain}</div>
            ${snippetDisplay}
            ${this.getKnowledgeDetails(site.knowledge)}
        `;
    }

    private renderSiteMetadata(site: Website): string {
        return `
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">${this.formatSourceInfo(site)}</small>
                ${this.renderSiteActions(site)}
            </div>
        `;
    }

    private renderSiteActions(site: Website): string {
        const openButton = this.createButton(
            '<i class="bi bi-box-arrow-up-right"></i> Open',
            "open-url",
            { url: site.url },
        );

        const extractButton =
            site.knowledge?.status === "none"
                ? this.createButton(
                      '<i class="bi bi-lightbulb"></i> Extract',
                      "extract-knowledge",
                      { url: site.url, title: site.title || site.url },
                      "btn btn-outline-secondary btn-sm",
                  )
                : "";

        return `
            <div class="btn-group btn-group-sm">
                ${openButton}
                ${extractButton}
            </div>
        `;
    }

    // Component methods for card view
    private renderCardItem(site: Website): string {
        return `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card result-card h-100">
                    <div class="card-body">
                        ${this.renderCardHeader(site)}
                        ${this.renderCardContent(site)}
                        ${this.renderCardFooter(site)}
                    </div>
                </div>
            </div>
        `;
    }

    private renderCardHeader(site: Website): string {
        return `
            <div class="d-flex align-items-center mb-2">
                ${this.createFaviconLink(site.url, site.title || site.url, site.domain)}
                <h6 class="card-title mb-0 text-truncate flex-grow-1">${site.title || site.url}</h6>
                ${this.getKnowledgeStatusBadge(site.knowledge)}
            </div>
        `;
    }

    private renderCardContent(site: Website): string {
        const snippetDisplay = site.snippet
            ? `<p class="card-text small">${site.snippet.substring(0, 120)}...</p>`
            : "";

        return `
            <p class="card-text small text-muted">${site.domain}</p>
            ${snippetDisplay}
            ${this.getKnowledgeDetails(site.knowledge)}
        `;
    }

    private renderCardFooter(site: Website): string {
        const scoreDisplay = site.score
            ? `<span class="result-score">${Math.round(site.score * 100)}%</span>`
            : "";

        const openButton = this.createButton(
            '<i class="bi bi-box-arrow-up-right"></i> Open',
            "open-url",
            { url: site.url },
            "btn btn-primary btn-sm",
        );

        const extractButton =
            site.knowledge?.status === "none"
                ? this.createButton(
                      '<i class="bi bi-lightbulb"></i>',
                      "extract-knowledge",
                      { url: site.url, title: site.title || site.url },
                      "btn btn-outline-secondary btn-sm",
                  )
                : "";

        return `
            <div class="mt-auto">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <small class="text-muted">${site.source}</small>
                    ${scoreDisplay}
                </div>
                <div class="btn-group w-100">
                    ${openButton}
                    ${extractButton}
                </div>
            </div>
        `;
    }

    // Event listener attachment methods
    private attachResultsEventListeners() {
        const container = document.getElementById("searchResultsContainer")!;

        // Remove existing listeners to prevent duplicates
        container.removeEventListener("click", this.handleResultsClick);

        // Add new listener
        container.addEventListener("click", this.handleResultsClick.bind(this));
    }

    private handleResultsClick = (event: Event) => {
        const target = event.target as HTMLElement;
        const button = target.closest("[data-action]") as HTMLElement;

        if (!button) return;

        const action = button.dataset.action;
        const url = button.dataset.url;
        const title = button.dataset.title;

        switch (action) {
            case "open-url":
                if (url) window.open(url, "_blank");
                break;
            case "extract-knowledge":
                if (url && title) this.extractKnowledgeForWebsite(url, title);
                break;
        }
    };

    private attachSuggestionListeners(
        container: HTMLElement,
        suggestions: string[],
    ) {
        const items = container.querySelectorAll(
            '[data-action="select-suggestion"]',
        );
        items.forEach((item, index) => {
            item.addEventListener("click", () => {
                this.selectSuggestion(suggestions[index]);
            });
        });
    }

    private attachRecentSearchListeners(container: HTMLElement) {
        const items = container.querySelectorAll(
            '[data-action="select-recent-search"]',
        );
        items.forEach((item, index) => {
            item.addEventListener("click", () => {
                if (index < this.recentSearches.length) {
                    this.selectRecentSearch(this.recentSearches[index]);
                }
            });
        });
    }

    private attachSuggestedSearchListeners(container: HTMLElement) {
        const items = container.querySelectorAll(
            '[data-action="select-suggested-search"]',
        );
        items.forEach((item) => {
            item.addEventListener("click", () => {
                const query = (item as HTMLElement).dataset.query;
                if (query) this.selectSuggestedSearch(query);
            });
        });
    }

    private async renderSearchResults(results: SearchResult) {
        // Enhance results with knowledge status
        const enhancedWebsites = await this.checkKnowledgeStatus(
            results.websites,
        );

        this.currentResults = enhancedWebsites;
        results.websites = enhancedWebsites;

        // Show results card
        const resultsCard = document.getElementById("searchResultsCard")!;
        resultsCard.classList.remove("d-none");
        resultsCard.scrollIntoView({ behavior: "smooth" });

        // Render summary
        this.renderResultsSummary(results);

        // Render AI summary if available
        if (results.summary.text) {
            this.renderAISummary(results.summary);
        } else {
            // Hide AI summary section if no summary available
            const aiSummarySection =
                document.getElementById("aiSummarySection")!;
            aiSummarySection.classList.add("d-none");
        }

        // Clear any loading state and render results based on current view mode
        const resultsContainer = document.getElementById(
            "searchResultsContainer",
        )!;
        if (this.currentResults.length === 0) {
            // Show "no results" message instead of loading spinner
            resultsContainer.innerHTML = `
                <div class="text-center py-4">
                    <i class="bi bi-search" style="font-size: 3rem; color: #6c757d; opacity: 0.5;"></i>
                    <h6 class="mt-3 text-muted">No results found</h6>
                    <p class="text-muted">Try adjusting your search terms or filters</p>
                </div>
            `;
        } else {
            this.rerenderResults();
        }
    }

    private escapeHTML(input: string): string {
        const div = document.createElement("div");
        div.textContent = input;
        return div.innerHTML;
    }

    private renderResultsSummary(results: SearchResult) {
        const summaryContainer = document.getElementById("resultsSummary")!;
        const escapedQuery = this.escapeHTML(results.query);

        summaryContainer.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${results.summary.totalFound}</strong> results found for 
                    <em>"${escapedQuery}"</em>
                </div>
                <small class="text-muted">
                    Search completed in ${results.summary.searchTime}ms
                </small>
            </div>
        `;
    }

    private renderAISummary(summary: any) {
        const summaryContainer = document.getElementById("aiSummarySection")!;

        summaryContainer.innerHTML = `
            <div class="ai-summary">
                <h6><i class="bi bi-robot"></i> AI Summary</h6>
                <p class="mb-3">${summary.text}</p>
                ${
                    summary.entities && summary.entities.length > 0
                        ? `
                    <div class="mb-2">
                        <strong>Key Entities:</strong><br>
                        ${summary.entities
                            .map(
                                (entity: EntityMatch) =>
                                    `<span class="entity-badge">${entity.entity} (${entity.count})</span>`,
                            )
                            .join("")}
                    </div>
                `
                        : ""
                }
            </div>
        `;

        summaryContainer.classList.remove("d-none");
    }

    private rerenderResults() {
        if (this.currentResults.length === 0) {
            // Don't re-render if there are no results - this is handled in renderSearchResults
            return;
        }

        const container = document.getElementById("searchResultsContainer")!;

        switch (this.currentViewMode) {
            case "list":
                container.innerHTML = this.renderListView(this.currentResults);
                break;
            case "card":
                container.innerHTML = this.renderCardView(this.currentResults);
                break;
            case "timeline":
                container.innerHTML = this.renderTimelineView(
                    this.currentResults,
                );
                break;
            case "domain":
                container.innerHTML = this.renderDomainView(
                    this.currentResults,
                );
                break;
        }

        // Attach event listeners after rendering
        this.attachResultsEventListeners();
    }

    private renderListView(websites: Website[]): string {
        return websites.map((site) => this.renderListItem(site)).join("");
    }

    private renderCardView(websites: Website[]): string {
        return `
            <div class="row">
                ${websites.map((site) => this.renderCardItem(site)).join("")}
            </div>
        `;
    }

    private renderTimelineView(websites: Website[]): string {
        const sortedSites = [...websites].sort((a, b) => {
            const dateA = a.lastVisited ? new Date(a.lastVisited).getTime() : 0;
            const dateB = b.lastVisited ? new Date(b.lastVisited).getTime() : 0;
            return dateB - dateA;
        });

        return sortedSites
            .map(
                (site) => `
            <div class="timeline-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <img src="https://www.google.com/s2/favicons?domain=${site.domain}" 
                                 class="result-favicon" alt="favicon">
                            <a href="${site.url}" target="_blank" class="fw-semibold text-decoration-none">
                                ${site.title || site.url}
                            </a>
                        </div>
                        <div class="result-domain text-muted small">${site.domain}</div>
                        ${
                            site.lastVisited
                                ? `
                            <div class="text-muted small">
                                <i class="bi bi-clock"></i> ${new Date(site.lastVisited).toLocaleString()}
                            </div>
                        `
                                : ""
                        }
                    </div>
                    ${site.score ? `<span class="result-score">${Math.round(site.score * 100)}%</span>` : ""}
                </div>
            </div>
        `,
            )
            .join("");
    }

    private renderDomainView(websites: Website[]): string {
        const domainGroups = websites.reduce(
            (groups, site) => {
                if (!groups[site.domain]) {
                    groups[site.domain] = [];
                }
                groups[site.domain].push(site);
                return groups;
            },
            {} as Record<string, Website[]>,
        );

        return Object.entries(domainGroups)
            .map(
                ([domain, sites]) => `
            <div class="domain-group">
                <div class="domain-header">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                                 class="result-favicon" alt="favicon">
                            <h6 class="mb-0">${domain}</h6>
                        </div>
                        <span class="badge bg-secondary">${sites.length} ${sites.length === 1 ? "page" : "pages"}</span>
                    </div>
                </div>
                ${sites
                    .map(
                        (site) => `
                    <div class="search-result-item">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="flex-grow-1">
                                <a href="${site.url}" target="_blank" class="fw-semibold text-decoration-none">
                                    ${site.title || site.url}
                                </a>
                                <div class="small text-muted">
                                    ${site.source} ${site.visitCount ? `• ${site.visitCount} visits` : ""}
                                </div>
                            </div>
                            ${site.score ? `<span class="result-score">${Math.round(site.score * 100)}%</span>` : ""}
                        </div>
                    </div>
                `,
                    )
                    .join("")}
            </div>
        `,
            )
            .join("");
    }

    private async saveSearchToHistory(query: string) {
        try {
            await chrome.runtime.sendMessage({
                type: "saveSearchHistory",
                query: query,
            });
        } catch (error) {
            console.error("Error saving search to history:", error);
        }
    }

    private async loadRecentSearches() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getSearchHistory",
            });

            if (response.success) {
                this.recentSearches = response.searches || [];
                this.renderRecentSearches();
            }
        } catch (error) {
            console.error("Error loading recent searches:", error);
        }
    }

    private renderRecentSearches() {
        const container = document.getElementById("recentSearchesList")!;

        if (this.recentSearches.length === 0) {
            container.innerHTML =
                '<span class="text-muted">No recent searches</span>';
            return;
        }

        container.innerHTML = this.recentSearches
            .slice(0, 5)
            .map(
                (search, index) => `
            <span class="recent-search-tag" data-action="select-recent-search" data-search-index="${index}">
                ${search}
            </span>
        `,
            )
            .join("");

        this.attachRecentSearchListeners(container);
    }

    selectRecentSearch(query: string) {
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = query;
        this.currentQuery = query;
        this.performSearch();
    }

    private async checkKnowledgeStatus(
        websites: Website[],
    ): Promise<Website[]> {
        const enhancedWebsites: Website[] = [];

        for (const website of websites) {
            const enhanced = { ...website };

            // Check cache first
            if (this.knowledgeStatusCache.has(website.url)) {
                enhanced.knowledge = this.knowledgeStatusCache.get(website.url);
            } else {
                // Query knowledge status from backend
                try {
                    const response = await chrome.runtime.sendMessage({
                        type: "checkPageIndexStatus",
                        parameters: { url: website.url },
                    });

                    if (response.success && response.result) {
                        const status: KnowledgeStatus = {
                            hasKnowledge: response.result.isIndexed,
                            status: response.result.isIndexed
                                ? "extracted"
                                : "none",
                            extractionDate: response.result.lastExtracted,
                            entityCount: response.result.entityCount,
                            topicCount: response.result.topicCount,
                            confidence: response.result.confidence,
                        };
                        enhanced.knowledge = status;
                        this.knowledgeStatusCache.set(website.url, status);
                    } else {
                        enhanced.knowledge = {
                            hasKnowledge: false,
                            status: "none",
                        };
                    }
                } catch (error) {
                    console.error(
                        "Error checking knowledge status for",
                        website.url,
                        error,
                    );
                    enhanced.knowledge = {
                        hasKnowledge: false,
                        status: "none",
                    };
                }
            }

            enhancedWebsites.push(enhanced);
        }

        return enhancedWebsites;
    }

    private async extractKnowledgeForWebsite(
        url: string,
        title: string,
    ): Promise<void> {
        try {
            // Update status to pending
            const pendingStatus: KnowledgeStatus = {
                hasKnowledge: false,
                status: "pending",
            };
            this.knowledgeStatusCache.set(url, pendingStatus);
            this.rerenderResults(); // Update UI to show pending state

            const response = await chrome.runtime.sendMessage({
                type: "extractKnowledgeFromPage",
                parameters: {
                    url: url,
                    title: title,
                    extractEntities: true,
                    extractRelationships: true,
                    suggestQuestions: true,
                    quality: "balanced",
                },
            });

            if (response.success) {
                const status: KnowledgeStatus = {
                    hasKnowledge: true,
                    status: "extracted",
                    extractionDate: new Date().toISOString(),
                    entityCount: response.result?.entities?.length || 0,
                    topicCount: response.result?.keyTopics?.length || 0,
                    suggestionCount:
                        response.result?.suggestedQuestions?.length || 0,
                };
                this.knowledgeStatusCache.set(url, status);
                this.showNotification(
                    `Knowledge extracted successfully for ${title}`,
                    "success",
                );
            } else {
                const status: KnowledgeStatus = {
                    hasKnowledge: false,
                    status: "error",
                };
                this.knowledgeStatusCache.set(url, status);
                this.showNotification(
                    `Failed to extract knowledge: ${response.error}`,
                    "error",
                );
            }

            this.rerenderResults(); // Update UI with final status
        } catch (error) {
            console.error("Error extracting knowledge:", error);
            const status: KnowledgeStatus = {
                hasKnowledge: false,
                status: "error",
            };
            this.knowledgeStatusCache.set(url, status);
            this.showNotification(
                "Knowledge extraction failed due to connection error",
                "error",
            );
            this.rerenderResults();
        }
    }

    private getKnowledgeStatusBadge(knowledge?: KnowledgeStatus): string {
        if (!knowledge) return "";

        switch (knowledge.status) {
            case "extracted":
                return `<span class="badge bg-success ms-2" title="Knowledge extracted on ${knowledge.extractionDate ? new Date(knowledge.extractionDate).toLocaleDateString() : "Unknown"}">
                    <i class="bi bi-check-circle"></i> Extracted
                </span>`;
            case "pending":
                return `<span class="badge bg-warning ms-2" title="Knowledge extraction in progress">
                    <i class="bi bi-clock"></i> Extracting...
                </span>`;
            case "error":
                return `<span class="badge bg-danger ms-2" title="Knowledge extraction failed">
                    <i class="bi bi-x-circle"></i> Error
                </span>`;
            default:
                return `<span class="badge bg-secondary ms-2" title="No knowledge extracted">
                    <i class="bi bi-circle"></i> None
                </span>`;
        }
    }

    private getKnowledgeDetails(knowledge?: KnowledgeStatus): string {
        if (!knowledge || !knowledge.hasKnowledge) return "";

        const details: string[] = [];
        if (knowledge.entityCount)
            details.push(`${knowledge.entityCount} entities`);
        if (knowledge.topicCount)
            details.push(`${knowledge.topicCount} topics`);
        if (knowledge.suggestionCount)
            details.push(`${knowledge.suggestionCount} questions`);

        return details.length > 0
            ? `<small class="text-muted d-block">${details.join(" • ")}</small>`
            : "";
    }

    private async loadSuggestedSearches() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getSuggestedSearches",
            });

            if (response.success) {
                this.renderSuggestedSearches(response.suggestions);
            }
        } catch (error) {
            console.error("Error loading suggested searches:", error);
        }
    }

    private renderSuggestedSearches(suggestions: CategorySuggestions) {
        this.renderSuggestionCategory(
            "recentFindsContainer",
            suggestions.recentFinds,
        );
        this.renderSuggestionCategory(
            "popularDomainsContainer",
            suggestions.popularDomains,
        );
        this.renderSuggestionCategory(
            "exploreTopicsContainer",
            suggestions.exploreTopics,
        );
    }

    private renderSuggestionCategory(
        containerId: string,
        suggestions: SuggestedSearch[],
    ) {
        const container = document.getElementById(containerId)!;

        if (suggestions.length === 0) {
            container.innerHTML =
                '<div class="text-muted small">Import data to see suggestions</div>';
            return;
        }

        container.innerHTML = suggestions
            .slice(0, 3)
            .map(
                (suggestion) => `
            <div class="suggested-search-item" data-action="select-suggested-search" data-query="${this.escapeDataAttribute(suggestion.query)}">
                <div class="fw-semibold">${suggestion.query}</div>
                <div class="small text-muted">${suggestion.description}</div>
                <div class="small text-muted">${suggestion.estimatedResults} results</div>
            </div>
        `,
            )
            .join("");

        this.attachSuggestedSearchListeners(container);
    }

    selectSuggestedSearch(query: string) {
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = query;
        this.currentQuery = query;
        this.performSearch();
    }

    // Discover tab methods
    exploreRecentBookmarks() {
        this.switchToSearchTab();
        const sourceFilter = document.getElementById(
            "sourceFilter",
        ) as HTMLSelectElement;
        sourceFilter.value = "bookmarks";

        const dateTo = document.getElementById("dateTo") as HTMLInputElement;
        const dateFrom = document.getElementById(
            "dateFrom",
        ) as HTMLInputElement;
        const today = new Date();
        const thirtyDaysAgo = new Date(
            today.getTime() - 30 * 24 * 60 * 60 * 1000,
        );

        dateTo.value = today.toISOString().split("T")[0];
        dateFrom.value = thirtyDaysAgo.toISOString().split("T")[0];

        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = "";
        this.currentQuery = "";
        this.performSearch();
    }

    exploreMostVisited() {
        this.switchToSearchTab();
        this.clearFilters();
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = "most visited";
        this.currentQuery = "most visited";
        this.performSearch();
    }

    exploreByDomain() {
        this.switchToSearchTab();
        const domainViewRadio = document.getElementById(
            "domainView",
        ) as HTMLInputElement;
        domainViewRadio.checked = true;
        this.currentViewMode = "domain";

        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = "*";
        this.currentQuery = "*";
        this.performSearch();
    }

    exploreUnexplored() {
        this.switchToSearchTab();
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.value = "rarely visited";
        this.currentQuery = "rarely visited";
        this.performSearch();
    }

    private switchToSearchTab() {
        const searchTab = document.getElementById(
            "search-tab",
        ) as HTMLButtonElement;
        if (searchTab) {
            searchTab.click();
        }
    }

    private clearFilters() {
        const dateFrom = document.getElementById(
            "dateFrom",
        ) as HTMLInputElement;
        const dateTo = document.getElementById("dateTo") as HTMLInputElement;
        const sourceFilter = document.getElementById(
            "sourceFilter",
        ) as HTMLSelectElement;
        const domainFilter = document.getElementById(
            "domainFilter",
        ) as HTMLInputElement;
        const relevanceFilter = document.getElementById(
            "relevanceFilter",
        ) as HTMLInputElement;

        dateFrom.value = "";
        dateTo.value = "";
        sourceFilter.value = "";
        domainFilter.value = "";
        relevanceFilter.value = "0";
        document.getElementById("relevanceValue")!.textContent = "0%";
    }
}

// Global instance for HTML onclick handlers
let libraryPanel: WebsiteLibraryPanel;

// Initialize the panel when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    libraryPanel = new WebsiteLibraryPanel();
    await libraryPanel.initialize();
});

// Add CSS for spin animation
const style = document.createElement("style");
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .spin {
        animation: spin 1s linear infinite;
    }
`;
document.head.appendChild(style);
