// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Full-page Website Library implementation
// Extends the existing interfaces and functionality for full-page layout

import { WebsiteImportManager } from "./websiteImportManager";
import { WebsiteImportUI } from "./websiteImportUI";
import {
    ImportOptions,
    FolderImportOptions,
    ImportProgress,
    ImportResult,
} from "../interfaces/websiteImport.types";

interface FullPageNavigation {
    currentPage: "search" | "discover" | "analytics";
    previousPage: string | null;
}

interface DiscoverInsights {
    trendingTopics: Array<{
        topic: string;
        count: number;
        trend: "up" | "down" | "stable";
        percentage: number;
    }>;
    readingPatterns: Array<{
        timeframe: string;
        activity: number;
        peak: boolean;
    }>;
    popularPages: Website[];
    topDomains: Array<{
        domain: string;
        count: number;
        favicon?: string;
    }>;
}

interface AnalyticsData {
    overview: {
        totalSites: number;
        totalBookmarks: number;
        totalHistory: number;
        knowledgeExtracted: number;
    };
    trends: Array<{
        date: string;
        visits: number;
        bookmarks: number;
    }>;
    insights: Array<{
        category: string;
        value: number;
        change: number;
    }>;
}

// Import existing interfaces
interface LocalImportOptions {
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
    status: "extracted" | "pending" | "error" | "none" | "extracting";
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

class WebsiteLibraryPanelFullPage {
    private isConnected: boolean = false;
    private navigation: FullPageNavigation = {
        currentPage: "search",
        previousPage: null,
    };

    // Search functionality
    private currentResults: Website[] = [];
    private currentViewMode: "list" | "grid" | "timeline" | "domain" = "list";
    private searchDebounceTimer: number | null = null;
    private recentSearches: string[] = [];
    private currentQuery: string = "";
    // Data storage
    private libraryStats: LibraryStats = {
        totalWebsites: 0,
        totalBookmarks: 0,
        totalHistory: 0,
        topDomains: 0,
    };
    private discoverData: DiscoverInsights | null = null;
    private analyticsData: AnalyticsData | null = null;

    // Enhanced services and managers
    private notificationManager: NotificationManager;
    private chromeExtensionService: ChromeExtensionService;
    private userPreferences: UserPreferences;
    private searchSuggestions: SearchSuggestion[] = [];
    private suggestionDropdown: HTMLElement | null = null;
    private knowledgeCache: Map<string, KnowledgeStatus> = new Map();
    private searchCache: Map<string, SearchResult> = new Map();

    // Import components
    private importManager: WebsiteImportManager;
    private importUI: WebsiteImportUI;

    constructor() {
        this.notificationManager = new NotificationManagerImpl();
        this.chromeExtensionService = new ChromeExtensionServiceImpl();
        this.userPreferences = this.loadUserPreferences();

        // Initialize import components
        this.importManager = new WebsiteImportManager();
        this.importUI = new WebsiteImportUI();
    }

    async initialize() {
        console.log("Initializing Enhanced Full-Page Website Library Panel");

        try {
            this.setupNavigation();
            this.setupSearchInterface();
            this.setupEventListeners();
            this.setupKnowledgeInteractions();
            this.setupNotificationSystem();
            this.setupImportFunctionality();

            await this.checkConnectionStatus();
            await this.loadLibraryStats();
            await this.loadRecentSearches();
            this.showPage("search");

            this.notificationManager.showSuccess(
                "Website Library loaded successfully with enhanced features!",
            );
        } catch (error) {
            console.error("Failed to initialize Website Library:", error);
            this.notificationManager.showError(
                "Failed to load Website Library. Please refresh the page.",
                () => window.location.reload(),
            );
        }
    }

    private setupNavigation() {
        const navItems = document.querySelectorAll(".nav-item");
        navItems.forEach((item) => {
            item.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const page = target.getAttribute("data-page") as
                    | "search"
                    | "discover"
                    | "analytics";
                if (page) {
                    this.navigateToPage(page);
                }
            });
        });
    }

    private setupSearchInterface() {
        // Search input
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        const searchButton = document.getElementById("searchButton");

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                const target = e.target as HTMLInputElement;
                this.handleSearchInput(target.value);
            });

            searchInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.performSearch();
                }
            });
        }

        if (searchButton) {
            searchButton.addEventListener("click", () => {
                this.performSearch();
            });
        }

        // View mode buttons
        document.querySelectorAll(".view-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const view = target.getAttribute("data-view") as
                    | "list"
                    | "grid"
                    | "timeline"
                    | "domain";
                if (view) {
                    this.setViewMode(view);
                }
            });
        });

        this.setupFilterControls();
    }

    private setupNotificationSystem() {
        // Notification system is already set up in the NotificationManagerImpl
        console.log("Notification system initialized");
    }

    private setupImportFunctionality() {
        // Setup import navigation buttons
        const importWebActivityBtn = document.getElementById(
            "importWebActivityBtn",
        );
        const importFromFileBtn = document.getElementById("importFromFileBtn");

        if (importWebActivityBtn) {
            importWebActivityBtn.addEventListener("click", () => {
                this.showWebActivityImportModal();
            });
        }

        if (importFromFileBtn) {
            importFromFileBtn.addEventListener("click", () => {
                this.showFolderImportModal();
            });
        }

        // Setup import event listeners
        this.setupImportEventListeners();
    }

    private setupImportEventListeners() {
        // Listen for import events from the UI
        window.addEventListener(
            "startWebActivityImport",
            async (event: any) => {
                const options = event.detail as ImportOptions;
                await this.handleWebActivityImport(options);
            },
        );

        window.addEventListener("startFolderImport", async (event: any) => {
            const options = event.detail as FolderImportOptions;
            await this.handleFolderImport(options);
        });

        window.addEventListener("cancelImport", () => {
            this.handleCancelImport();
        });

        // Setup import UI callbacks
        this.importUI.onProgressUpdate((progress: ImportProgress) => {
            this.importUI.updateImportProgress(progress);
        });

        this.importUI.onImportComplete((result: ImportResult) => {
            this.handleImportComplete(result);
        });

        this.importUI.onImportError((error: any) => {
            this.importUI.showImportError(error);
        });
    }

    private setupKnowledgeInteractions() {
        // Knowledge interactions are handled through the enhanced features
        console.log("Knowledge interactions initialized");
    }

    private async checkConnectionStatus(): Promise<boolean> {
        try {
            if (typeof chrome === "undefined" || !chrome.runtime) {
                this.isConnected = false;
                return false;
            }

            const response = await chrome.runtime.sendMessage({
                action: "checkWebSocketConnection",
            });

            this.isConnected = response?.connected === true;
            return this.isConnected;
        } catch (error) {
            console.error("Connection check failed:", error);
            this.isConnected = false;
            return false;
        } finally {
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus");
        if (statusElement) {
            const indicator = statusElement.querySelector(".status-indicator");
            const text = statusElement.querySelector("span:last-child");

            if (indicator && text) {
                if (this.isConnected) {
                    indicator.className = "status-indicator status-connected";
                    text.textContent = "Connected";
                } else {
                    indicator.className =
                        "status-indicator status-disconnected";
                    text.textContent = "Disconnected";
                }
            }
        }
    }

    private showConnectionRequired() {
        const container = document.getElementById("searchResults");
        if (container) {
            container.innerHTML = `
                <div class="connection-required">
                    <i class="bi bi-wifi-off"></i>
                    <h3>Connection Required</h3>
                    <p>The Website Library requires an active connection to the TypeAgent service.</p>
                    <button class="btn btn-primary" data-action="reconnect">
                        <i class="bi bi-arrow-repeat"></i> Reconnect
                    </button>
                </div>
            `;
        }
    }

    private async reconnect() {
        this.notificationManager.showInfo("Attempting to reconnect...");
        const connected = await this.checkConnectionStatus();

        if (connected) {
            this.notificationManager.showSuccess("Reconnected successfully!");
            await this.loadLibraryStats();
            await this.performSearch();
        } else {
            this.notificationManager.showError(
                "Failed to reconnect. Please check your connection.",
                () => this.reconnect(),
            );
        }
    }

    private async loadLibraryStats() {
        if (!this.isConnected) {
            this.showConnectionRequired();
            return;
        }

        try {
            this.libraryStats =
                await this.chromeExtensionService.getLibraryStats();
            this.updateStatsDisplay();
        } catch (error) {
            console.error("Failed to load library stats:", error);
            this.notificationManager.showError(
                "Failed to load library statistics",
                () => this.loadLibraryStats(),
            );
        }
    }

    private updateStatsDisplay() {
        const updates: Array<[string, number]> = [
            ["totalWebsites", this.libraryStats.totalWebsites],
            ["totalBookmarks", this.libraryStats.totalBookmarks],
            ["totalHistory", this.libraryStats.totalHistory],
            ["topDomains", this.libraryStats.topDomains],
        ];

        updates.forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value.toString();
            }
        });
    }

    private navigateToPage(page: "search" | "discover" | "analytics") {
        // Update navigation state
        this.navigation.previousPage = this.navigation.currentPage;
        this.navigation.currentPage = page;

        // Update UI
        this.updateNavigation();
        this.showPage(page);

        // Load page-specific data
        switch (page) {
            case "search":
                this.initializeSearchPage();
                break;
            case "discover":
                this.initializeDiscoverPage();
                break;
            case "analytics":
                this.initializeAnalyticsPage();
                break;
        }
    }

    private updateNavigation() {
        // Update active navigation item
        document.querySelectorAll(".nav-item").forEach((item) => {
            item.classList.remove("active");
        });

        const activeItem = document.querySelector(
            `[data-page="${this.navigation.currentPage}"]`,
        );
        if (activeItem) {
            activeItem.classList.add("active");
        }
    }

    private showPage(page: string) {
        // Hide all pages
        document.querySelectorAll(".page-content").forEach((pageEl) => {
            pageEl.classList.remove("active");
        });

        // Show current page
        const currentPageEl = document.getElementById(`${page}-page`);
        if (currentPageEl) {
            currentPageEl.classList.add("active");
        }
    }

    private setupFilterControls() {
        const relevanceFilter = document.getElementById(
            "relevanceFilter",
        ) as HTMLInputElement;
        if (relevanceFilter) {
            relevanceFilter.addEventListener("input", (e) => {
                const value = (e.target as HTMLInputElement).value;
                const valueDisplay = document.getElementById("relevanceValue");
                if (valueDisplay) {
                    valueDisplay.textContent = `${value}%`;
                }
            });
        }

        // Setup date filters
        const dateFrom = document.getElementById(
            "dateFrom",
        ) as HTMLInputElement;
        const dateTo = document.getElementById("dateTo") as HTMLInputElement;

        if (dateFrom) {
            dateFrom.addEventListener("change", () =>
                this.updateSearchFilters(),
            );
        }
        if (dateTo) {
            dateTo.addEventListener("change", () => this.updateSearchFilters());
        }

        // Setup other filters
        const sourceFilter = document.getElementById(
            "sourceFilter",
        ) as HTMLSelectElement;
        const domainFilter = document.getElementById(
            "domainFilter",
        ) as HTMLInputElement;

        if (sourceFilter) {
            sourceFilter.addEventListener("change", () =>
                this.updateSearchFilters(),
            );
        }
        if (domainFilter) {
            domainFilter.addEventListener("input", () =>
                this.updateSearchFilters(),
            );
        }

        // Setup knowledge filters
        const knowledgeFilters = [
            "hasEntitiesFilter",
            "hasTopicsFilter",
            "hasActionsFilter",
            "knowledgeExtractedFilter",
        ];

        knowledgeFilters.forEach((filterId) => {
            const filter = document.getElementById(
                filterId,
            ) as HTMLInputElement;
            if (filter) {
                filter.addEventListener("change", () =>
                    this.updateSearchFilters(),
                );
            }
        });
    }

    private setupEventListeners() {
        // Settings button
        const settingsButton = document.getElementById("settingsButton");
        if (settingsButton) {
            settingsButton.addEventListener("click", () => {
                this.showSettings();
            });
        }

        // Event delegation for data-action buttons
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const actionButton = target.closest("[data-action]") as HTMLElement;

            if (actionButton) {
                e.preventDefault();
                const action = actionButton.getAttribute("data-action");
                this.handleAction(action, actionButton);
            }
        });
    }

    private handleAction(action: string | null, button: HTMLElement) {
        if (!action) return;

        switch (action) {
            case "showImportModal":
                this.showImportModal();
                break;
            case "exploreRecentBookmarks":
                this.exploreRecentBookmarks();
                break;
            case "exploreMostVisited":
                this.exploreMostVisited();
                break;
            case "exploreByDomain":
                this.exploreByDomain();
                break;
            case "reconnect":
                this.reconnect();
                break;
            default:
                console.warn("Unknown action:", action);
        }
    }

    private handleQuickAction(button: Element) {
        const onclick = button.getAttribute("onclick");
        if (onclick) {
            if (onclick.includes("showImportModal")) {
                this.showImportModal();
            } else if (onclick.includes("exploreRecentBookmarks")) {
                this.exploreRecentBookmarks();
            } else if (onclick.includes("exploreMostVisited")) {
                this.exploreMostVisited();
            } else if (onclick.includes("exploreByDomain")) {
                this.exploreByDomain();
            }
        }
    }

    private setViewMode(view: "list" | "grid" | "timeline" | "domain") {
        if (this.currentViewMode === view) return;

        this.currentViewMode = view;

        // Update UI with smooth transition
        this.updateViewModeButtons();

        // Animate the transition if results are visible
        if (this.currentResults.length > 0) {
            this.animateViewModeTransition(view);
        }
    }

    private updateViewModeButtons() {
        document.querySelectorAll(".view-btn").forEach((btn) => {
            btn.classList.remove("active");
        });

        const activeBtn = document.querySelector(
            `[data-view="${this.currentViewMode}"]`,
        );
        if (activeBtn) {
            activeBtn.classList.add("active");
        }
    }

    private async animateViewModeTransition(
        newView: "list" | "grid" | "timeline" | "domain",
    ) {
        const container = document.getElementById("resultsContainer");
        if (!container) return;

        // Add transitioning class to prevent interactions
        container.classList.add("transitioning");

        // Get current content
        const currentContent = container.querySelector(".results-content");
        if (currentContent) {
            // Fade out current content
            currentContent.classList.add("fade-out");

            // Wait for fade out animation
            await new Promise((resolve) => setTimeout(resolve, 200));
        }

        // Update view class on container
        container.className = "results-container";
        container.classList.add(`${newView}-view`, "transitioning");

        // Render new content
        this.renderSearchResults(this.currentResults);

        // Get new content and animate in
        const newContent = container.querySelector(".results-content");
        if (newContent) {
            newContent.classList.add("fade-out"); // Start hidden

            // Force layout
            (newContent as HTMLElement).offsetHeight;

            // Fade in new content
            newContent.classList.remove("fade-out");
            newContent.classList.add("fade-in");

            // Wait for fade in animation
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Clean up classes
            newContent.classList.remove("fade-in");
        }

        // Remove transitioning class
        container.classList.remove("transitioning");
    }

    private handleSearchInput(query: string) {
        this.currentQuery = query;

        // Clear previous debounce timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        // Set new debounce timer with enhanced features
        this.searchDebounceTimer = window.setTimeout(async () => {
            if (query.length >= 2) {
                await this.loadSearchSuggestions(query);
                this.showSearchSuggestions(query);
            } else {
                this.hideSearchSuggestions();
            }
        }, 300);
    }

    private async performSearch() {
        const query = this.currentQuery.trim();
        if (!query) return;

        this.hideSearchSuggestions();
        this.addToRecentSearches(query);
        this.showSearchLoading();

        try {
            // Check cache first for improved performance
            const filters = this.getSearchFilters();
            const cacheKey = `${query}-${JSON.stringify(filters)}`;

            if (this.searchCache.has(cacheKey)) {
                const cachedResults = this.searchCache.get(cacheKey)!;
                this.showSearchResults(cachedResults);
                this.notificationManager.showSuccess(
                    "Results loaded from cache",
                );
                return;
            }

            // Perform search with enhanced error handling
            let results: SearchResult;

            if (this.isConnected) {
                results = await this.chromeExtensionService.searchWebsites(
                    query,
                    filters,
                );
                await this.chromeExtensionService.saveSearch(query, results);
            } else {
                results = await this.searchWebsites(query, filters);
            }

            // Cache results for future use
            this.searchCache.set(cacheKey, results);

            // Enhance results with real-time knowledge status
            await this.enhanceResultsWithKnowledge(results.websites);

            this.showSearchResults(results);
        } catch (error) {
            console.error("Search failed:", error);
            this.showSearchError(
                "Search failed. Please check your connection and try again.",
            );
            this.notificationManager.showError("Search failed", () =>
                this.performSearch(),
            );
        }
    }

    // Enhanced knowledge integration
    private async enhanceResultsWithKnowledge(websites: Website[]) {
        const knowledgePromises = websites.map(async (website) => {
            try {
                // Check cache first
                if (this.knowledgeCache.has(website.url)) {
                    website.knowledge = this.knowledgeCache.get(website.url);
                    return;
                }

                // Get fresh knowledge status
                if (this.isConnected) {
                    const knowledge =
                        await this.chromeExtensionService.checkKnowledgeStatus(
                            website.url,
                        );
                    website.knowledge = knowledge;
                    this.knowledgeCache.set(website.url, knowledge);
                } else {
                    // No connection - skip knowledge check
                    website.knowledge = {
                        hasKnowledge: false,
                        status: "none",
                        confidence: 0,
                    };
                }
            } catch (error) {
                console.error(
                    `Failed to check knowledge for ${website.url}:`,
                    error,
                );
            }
        });

        await Promise.allSettled(knowledgePromises);
    }

    private getSearchFilters(): SearchFilters {
        const filters: SearchFilters = {};

        const dateFrom = (
            document.getElementById("dateFrom") as HTMLInputElement
        )?.value;
        const dateTo = (document.getElementById("dateTo") as HTMLInputElement)
            ?.value;
        const sourceType = (
            document.getElementById("sourceFilter") as HTMLSelectElement
        )?.value;
        const domain = (
            document.getElementById("domainFilter") as HTMLInputElement
        )?.value;
        const minRelevance = parseInt(
            (document.getElementById("relevanceFilter") as HTMLInputElement)
                ?.value || "0",
        );

        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
        if (sourceType)
            filters.sourceType = sourceType as "bookmarks" | "history";
        if (domain) filters.domain = domain;
        if (minRelevance > 0) filters.minRelevance = minRelevance;

        return filters;
    }

    private updateSearchFilters() {
        // If there's an active search, re-run it with new filters
        if (this.currentQuery && this.currentResults.length > 0) {
            this.performSearch();
        }
    }

    private async searchWebsites(
        query: string,
        filters: SearchFilters,
    ): Promise<SearchResult> {
        if (!this.isConnected) {
            this.showConnectionRequired();
            throw new Error("Connection required");
        }

        try {
            return await this.chromeExtensionService.searchWebsites(
                query,
                filters,
            );
        } catch (error) {
            console.error("Search failed:", error);
            throw error;
        }
    }

    private showSearchLoading() {
        const resultsContainer = document.getElementById("searchResults");
        const emptyState = document.getElementById("searchEmptyState");

        if (resultsContainer) {
            resultsContainer.style.display = "block";
            resultsContainer.innerHTML = `
                <div class="results-header">
                    <h2 class="results-title">Searching...</h2>
                </div>
                <div class="results-container">
                    <div class="text-center">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Searching...</span>
                        </div>
                        <p class="mt-3">Searching your library...</p>
                    </div>
                </div>
            `;
        }

        if (emptyState) {
            emptyState.style.display = "none";
        }
    }

    private showSearchResults(results: SearchResult) {
        this.currentResults = results.websites;

        const resultsContainer = document.getElementById("searchResults");
        const emptyState = document.getElementById("searchEmptyState");

        if (emptyState) {
            emptyState.style.display = "none";
        }

        if (resultsContainer) {
            resultsContainer.style.display = "block";
            this.renderSearchResults(results.websites);

            // Show AI summary if available
            if (results.summary.text) {
                this.showAISummary(results.summary.text);
            }
        }
    }

    private renderSearchResults(websites: Website[]) {
        const container = document.getElementById("resultsContainer");
        if (!container) return;

        // Add view-specific class to container
        container.className = "results-container";
        container.classList.add(`${this.currentViewMode}-view`);

        let html = "";

        switch (this.currentViewMode) {
            case "list":
                html = this.renderListView(websites);
                break;
            case "grid":
                html = this.renderGridView(websites);
                break;
            case "timeline":
                html = this.renderTimelineView(websites);
                break;
            case "domain":
                html = this.renderDomainView(websites);
                break;
        }

        container.innerHTML = `<div class="results-content">${html}</div>`;
    }

    private renderListView(websites: Website[]): string {
        return websites
            .map(
                (website) => `
            <div class="search-result-item">
                <div class="d-flex align-items-start">
                    <img src="https://www.google.com/s2/favicons?domain=${website.domain}" 
                         class="result-favicon me-2" alt="Favicon">
                    <div class="flex-grow-1">
                        <h6 class="mb-1">
                            <a href="${website.url}" target="_blank" class="text-decoration-none">
                                ${website.title}
                            </a>
                        </h6>
                        <div class="result-domain text-muted mb-1">${website.domain}</div>
                        ${website.snippet ? `<p class="mb-2 text-muted small">${website.snippet}</p>` : ""}
                        
                        <div class="d-flex align-items-center justify-content-between">
                            <div class="knowledge-badges">
                                ${this.renderKnowledgeBadges(website.knowledge)}
                            </div>
                            <div class="d-flex align-items-center gap-2">
                                ${website.knowledge?.confidence ? this.renderConfidenceIndicator(website.knowledge.confidence) : ""}
                                ${website.score ? `<span class="result-score">${Math.round(website.score * 100)}%</span>` : ""}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `,
            )
            .join("");
    }

    private renderGridView(websites: Website[]): string {
        const gridHtml = websites
            .map(
                (website) => `
            <div class="card result-card">
                <div class="card-body">
                    <div class="d-flex align-items-center mb-2">
                        <img src="https://www.google.com/s2/favicons?domain=${website.domain}" 
                             class="result-favicon me-2" alt="Favicon">
                        <h6 class="card-title mb-0 flex-grow-1">${website.title}</h6>
                        ${website.score ? `<span class="result-score">${Math.round(website.score * 100)}%</span>` : ""}
                    </div>
                    
                    <div class="result-domain text-muted mb-2">${website.domain}</div>
                    ${website.snippet ? `<p class="card-text small mb-3">${website.snippet}</p>` : ""}
                    
                    ${
                        website.knowledge?.confidence
                            ? `
                        <div class="mb-2">
                            ${this.renderConfidenceIndicator(website.knowledge.confidence)}
                        </div>
                    `
                            : ""
                    }
                    
                    <div class="knowledge-badges">
                        ${this.renderKnowledgeBadges(website.knowledge)}
                    </div>
                    
                    <a href="${website.url}" target="_blank" class="stretched-link"></a>
                </div>
            </div>
        `,
            )
            .join("");

        return gridHtml;
    }

    private renderTimelineView(websites: Website[]): string {
        // Group by date for timeline view
        const grouped = websites.reduce(
            (acc, website) => {
                const date = website.lastVisited
                    ? new Date(website.lastVisited).toDateString()
                    : "Unknown Date";
                if (!acc[date]) acc[date] = [];
                acc[date].push(website);
                return acc;
            },
            {} as Record<string, Website[]>,
        );

        return Object.entries(grouped)
            .map(
                ([date, sites]) => `
            <div class="timeline-item">
                <div class="timeline-date">${date === "Unknown Date" ? "Recently Added" : date}</div>
                
                ${sites
                    .map(
                        (website) => `
                    <div class="search-result-item mb-3 border-0 p-0">
                        <div class="d-flex align-items-start">
                            <img src="https://www.google.com/s2/favicons?domain=${website.domain}" 
                                 class="result-favicon me-2" alt="Favicon">
                            <div class="flex-grow-1">
                                <h6 class="mb-1">
                                    <a href="${website.url}" target="_blank" class="text-decoration-none">
                                        ${website.title}
                                    </a>
                                </h6>
                                <div class="result-domain text-muted mb-1">${website.domain}</div>
                                ${website.snippet ? `<p class="mb-2 text-muted small">${website.snippet}</p>` : ""}
                                
                                <div class="d-flex align-items-center justify-content-between">
                                    <div class="knowledge-badges">
                                        ${this.renderKnowledgeBadges(website.knowledge)}
                                    </div>
                                    <div class="d-flex align-items-center gap-2">
                                        ${website.knowledge?.confidence ? this.renderConfidenceIndicator(website.knowledge.confidence) : ""}
                                        ${website.score ? `<span class="result-score">${Math.round(website.score * 100)}%</span>` : ""}
                                    </div>
                                </div>
                                
                                ${
                                    website.lastVisited
                                        ? `
                                    <div class="mt-1">
                                        <small class="text-muted">
                                            <i class="bi bi-clock me-1"></i>
                                            ${new Date(website.lastVisited).toLocaleTimeString()}
                                        </small>
                                    </div>
                                `
                                        : ""
                                }
                            </div>
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

    private renderDomainView(websites: Website[]): string {
        // Group by domain and calculate knowledge stats
        const grouped = websites.reduce(
            (acc, website) => {
                if (!acc[website.domain]) {
                    acc[website.domain] = {
                        sites: [],
                        totalEntities: 0,
                        totalTopics: 0,
                        totalActions: 0,
                        extractedCount: 0,
                    };
                }
                acc[website.domain].sites.push(website);

                if (website.knowledge?.entityCount) {
                    acc[website.domain].totalEntities +=
                        website.knowledge.entityCount;
                }
                if (website.knowledge?.topicCount) {
                    acc[website.domain].totalTopics +=
                        website.knowledge.topicCount;
                }
                if (website.knowledge?.suggestionCount) {
                    acc[website.domain].totalActions +=
                        website.knowledge.suggestionCount;
                }
                if (website.knowledge?.status === "extracted") {
                    acc[website.domain].extractedCount++;
                }

                return acc;
            },
            {} as Record<
                string,
                {
                    sites: Website[];
                    totalEntities: number;
                    totalTopics: number;
                    totalActions: number;
                    extractedCount: number;
                }
            >,
        );

        return Object.entries(grouped)
            .map(
                ([domain, data]) => `
            <div class="domain-group">
                <div class="domain-header">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                                 class="result-favicon me-2" alt="Favicon">
                            <div>
                                <strong>${domain}</strong>
                                <div class="small text-muted">${data.sites.length} pages</div>
                            </div>
                        </div>
                        <div class="d-flex gap-2">
                            <span class="badge">${data.sites.length}</span>
                            ${data.extractedCount > 0 ? `<span class="knowledge-badge extracted small">${data.extractedCount} extracted</span>` : ""}
                        </div>
                    </div>
                    
                    ${
                        data.totalEntities > 0 ||
                        data.totalTopics > 0 ||
                        data.totalActions > 0
                            ? `
                        <div class="domain-knowledge-summary mt-2">
                            <div class="knowledge-badges">
                                ${data.totalEntities > 0 ? `<span class="knowledge-badge entity small">${data.totalEntities} Entities</span>` : ""}
                                ${data.totalTopics > 0 ? `<span class="knowledge-badge topic small">${data.totalTopics} Topics</span>` : ""}
                                ${data.totalActions > 0 ? `<span class="knowledge-badge action small">${data.totalActions} Actions</span>` : ""}
                            </div>
                        </div>
                    `
                            : ""
                    }
                </div>
                
                <div class="domain-content">
                    ${data.sites
                        .map(
                            (website) => `
                        <div class="search-result-item">
                            <h6 class="mb-1">
                                <a href="${website.url}" target="_blank" class="text-decoration-none">
                                    ${website.title}
                                </a>
                            </h6>
                            ${website.snippet ? `<p class="mb-2 text-muted small">${website.snippet}</p>` : ""}
                            
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="knowledge-badges">
                                    ${this.renderKnowledgeBadges(website.knowledge)}
                                </div>
                                <div class="d-flex align-items-center gap-2">
                                    ${website.knowledge?.confidence ? this.renderConfidenceIndicator(website.knowledge.confidence) : ""}
                                    ${website.score ? `<span class="result-score">${Math.round(website.score * 100)}%</span>` : ""}
                                </div>
                            </div>
                        </div>
                    `,
                        )
                        .join("")}
                </div>
            </div>
        `,
            )
            .join("");
    }

    private showAISummary(summary: string) {
        const summarySection = document.getElementById("aiSummary");
        const summaryContent = document.getElementById("summaryContent");

        if (summarySection && summaryContent) {
            summaryContent.textContent = summary;
            summarySection.style.display = "block";
        }
    }

    private showSearchError(message: string) {
        const resultsContainer = document.getElementById("searchResults");
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    ${message}
                </div>
            `;
        }
    }

    private addToRecentSearches(query: string) {
        // Remove if already exists
        const index = this.recentSearches.indexOf(query);
        if (index > -1) {
            this.recentSearches.splice(index, 1);
        }

        // Add to beginning
        this.recentSearches.unshift(query);

        // Keep only last 10
        this.recentSearches = this.recentSearches.slice(0, 10);

        // Update UI
        this.updateRecentSearchesUI();

        // Save to storage
        this.saveRecentSearches();
    }

    private updateRecentSearchesUI() {
        const container = document.getElementById("recentSearchesList");
        if (!container) return;

        if (this.recentSearches.length === 0) {
            container.innerHTML =
                '<span class="empty-message">No recent searches</span>';
            return;
        }

        container.innerHTML = ""; // Clear the container first

        this.recentSearches.forEach((query) => {
            const span = document.createElement("span");
            span.className = "recent-search-tag";
            span.setAttribute("data-query", query);
            span.textContent = query;
            container.appendChild(span);
        });

        // Add event listeners to recent search tags
        container.querySelectorAll(".recent-search-tag").forEach((tag) => {
            tag.addEventListener("click", () => {
                const query = tag.getAttribute("data-query");
                if (query) {
                    this.performSearchWithQuery(query);
                }
            });
        });
    }

    public performSearchWithQuery(query: string) {
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            this.currentQuery = query;
            this.performSearch();
        }
    }

    // Page initialization methods
    private async initializeSearchPage() {
        // Already initialized in setupSearchInterface
    }

    private async initializeDiscoverPage() {
        if (!this.discoverData) {
            await this.loadDiscoverData();
        }
        this.renderDiscoverContent();
    }

    private async initializeAnalyticsPage() {
        if (!this.analyticsData) {
            await this.loadAnalyticsData();
        }
        this.renderAnalyticsContent();
    }

    private async loadDiscoverData() {
        if (!this.isConnected) {
            const container = document.getElementById("discoverContent");
            if (container) {
                container.innerHTML = `
                    <div class="connection-required">
                        <i class="bi bi-wifi-off"></i>
                        <h3>Connection Required</h3>
                        <p>The Discover page requires an active connection to the TypeAgent service.</p>
                        <button class="btn btn-primary" data-action="reconnect">
                            <i class="bi bi-arrow-repeat"></i> Reconnect
                        </button>
                    </div>
                `;
            }
            return;
        }

        // TODO: Implement actual API call to get discover data
        // For now, return empty data
        this.discoverData = {
            trendingTopics: [],
            readingPatterns: [],
            popularPages: [],
            topDomains: [],
        };
    }

    private renderDiscoverContent() {
        if (!this.discoverData) return;

        this.renderTrendingContent();
        this.renderReadingPatterns();
        this.renderPopularPages();
    }

    private renderTrendingContent() {
        const container = document.getElementById("trendingContent");
        if (!container || !this.discoverData) return;

        container.innerHTML = this.discoverData.trendingTopics
            .map(
                (topic) => `
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">${topic.topic}</h6>
                    <div class="d-flex align-items-center justify-content-between">
                        <span class="text-muted">${topic.count} pages</span>
                        <div class="d-flex align-items-center">
                            <i class="bi bi-arrow-${topic.trend === "up" ? "up" : topic.trend === "down" ? "down" : "right"} 
                               text-${topic.trend === "up" ? "success" : topic.trend === "down" ? "danger" : "secondary"}"></i>
                            ${
                                topic.percentage > 0
                                    ? `<span class="text-${topic.trend === "up" ? "success" : "danger"} small ms-1">
                                ${topic.percentage}%</span>`
                                    : ""
                            }
                        </div>
                    </div>
                </div>
            </div>
        `,
            )
            .join("");
    }

    private renderReadingPatterns() {
        const container = document.getElementById("readingPatterns");
        if (!container || !this.discoverData) return;

        container.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Daily Activity Pattern</h6>
                    <div class="reading-pattern-chart">
                        ${this.discoverData.readingPatterns
                            .map(
                                (pattern) => `
                            <div class="pattern-item ${pattern.peak ? "peak" : ""}">
                                <div class="pattern-bar" style="height: ${pattern.activity}%"></div>
                                <div class="pattern-time">${pattern.timeframe}</div>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>
            </div>
        `;
    }

    private renderPopularPages() {
        const container = document.getElementById("popularPages");
        if (!container) return;

        if (
            !this.discoverData?.popularPages ||
            this.discoverData.popularPages.length === 0
        ) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-fire"></i>
                    <h6>No Popular Pages</h6>
                    <p>Visit more pages to see trending content.</p>
                </div>
            `;
            return;
        }

        // Render popular pages similar to search results
        container.innerHTML = this.renderListView(
            this.discoverData.popularPages,
        );
    }

    private async loadAnalyticsData() {
        if (!this.isConnected) {
            const container = document.getElementById("analyticsContent");
            if (container) {
                container.innerHTML = `
                    <div class="connection-required">
                        <i class="bi bi-wifi-off"></i>
                        <h3>Connection Required</h3>
                        <p>The Analytics page requires an active connection to the TypeAgent service.</p>
                        <button class="btn btn-primary" data-action="reconnect">
                            <i class="bi bi-arrow-repeat"></i> Reconnect
                        </button>
                    </div>
                `;
            }
            return;
        }

        // TODO: Implement actual API call to get analytics data
        // For now, return basic data based on library stats
        this.analyticsData = {
            overview: {
                totalSites: this.libraryStats.totalWebsites,
                totalBookmarks: this.libraryStats.totalBookmarks,
                totalHistory: this.libraryStats.totalHistory,
                knowledgeExtracted: 0,
            },
            trends: [],
            insights: [],
        };
    }

    private renderAnalyticsContent() {
        if (!this.analyticsData) return;

        this.renderAnalyticsOverview();
        this.renderActivityCharts();
        this.renderKnowledgeInsights();
    }

    private renderKnowledgeInsights() {
        const container = document.getElementById("knowledgeInsights");
        if (!container || !this.analyticsData) return;

        // Enhanced knowledge insights with visualizations
        const knowledgeStats = this.calculateKnowledgeStats();

        container.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Knowledge Extraction Overview</h6>
                    <div class="knowledge-progress-grid">
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-diagram-2 text-info"></i>
                                <span>Entity Extraction</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${knowledgeStats.entityProgress}%; background: linear-gradient(90deg, #17a2b8, #20c997);"></div>
                                </div>
                                <span class="progress-percentage">${knowledgeStats.entityProgress}%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-tags text-purple"></i>
                                <span>Topic Analysis</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${knowledgeStats.topicProgress}%; background: linear-gradient(90deg, #6f42c1, #e83e8c);"></div>
                                </div>
                                <span class="progress-percentage">${knowledgeStats.topicProgress}%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-lightning text-warning"></i>
                                <span>Action Detection</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${knowledgeStats.actionProgress}%; background: linear-gradient(90deg, #fd7e14, #ffc107);"></div>
                                </div>
                                <span class="progress-percentage">${knowledgeStats.actionProgress}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Knowledge Quality Distribution</h6>
                    <div class="quality-distribution">
                        <div class="quality-segment high" style="width: ${knowledgeStats.highQuality}%;" title="High Quality: ${knowledgeStats.highQuality}%">
                            <span class="quality-label">High</span>
                        </div>
                        <div class="quality-segment medium" style="width: ${knowledgeStats.mediumQuality}%;" title="Medium Quality: ${knowledgeStats.mediumQuality}%">
                            <span class="quality-label">Medium</span>
                        </div>
                        <div class="quality-segment low" style="width: ${knowledgeStats.lowQuality}%;" title="Low Quality: ${knowledgeStats.lowQuality}%">
                            <span class="quality-label">Low</span>
                        </div>
                    </div>
                    <div class="quality-legend">
                        <div class="legend-item">
                            <div class="legend-color high"></div>
                            <span>High Confidence (≥80%)</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color medium"></div>
                            <span>Medium Confidence (50-79%)</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color low"></div>
                            <span>Low Confidence (<50%)</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private calculateKnowledgeStats() {
        // Return default values when not connected
        if (!this.isConnected) {
            return {
                entityProgress: 0,
                topicProgress: 0,
                actionProgress: 0,
                highQuality: 0,
                mediumQuality: 0,
                lowQuality: 0,
            };
        }

        // TODO: Implement actual calculation based on real data
        return {
            entityProgress: 0,
            topicProgress: 0,
            actionProgress: 0,
            highQuality: 0,
            mediumQuality: 0,
            lowQuality: 0,
        };
    }

    private handleKnowledgeBadgeClick(badge: HTMLElement) {
        // Add visual feedback
        badge.style.transform = "scale(0.95)";
        setTimeout(() => {
            badge.style.transform = "";
        }, 150);

        // Get badge type and show details
        const badgeType = Array.from(badge.classList).find((cls) =>
            ["entity", "topic", "action", "extracted"].includes(cls),
        );

        if (badgeType) {
            this.showKnowledgeDetails(badgeType, badge);
        }
    }

    private handleTopicTagClick(tag: HTMLElement) {
        const topic = tag.textContent?.trim();
        if (topic) {
            // Simulate search for this topic
            const searchInput = document.getElementById(
                "searchInput",
            ) as HTMLInputElement;
            if (searchInput) {
                searchInput.value = topic;
                this.currentQuery = topic;
                this.performSearch();
                this.navigateToPage("search");
            }
        }
    }

    private showKnowledgeDetails(type: string, element: HTMLElement) {
        // Create a temporary tooltip showing knowledge details
        const tooltip = document.createElement("div");
        tooltip.className = "knowledge-tooltip";
        tooltip.innerHTML = this.getKnowledgeTooltipContent(type);

        document.body.appendChild(tooltip);

        // Position tooltip
        const rect = element.getBoundingClientRect();
        tooltip.style.position = "fixed";
        tooltip.style.top = `${rect.bottom + 8}px`;
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.zIndex = "9999";

        // Remove tooltip after delay
        setTimeout(() => {
            tooltip.remove();
        }, 3000);

        // Remove on click outside
        const removeTooltip = (e: Event) => {
            if (!tooltip.contains(e.target as Node)) {
                tooltip.remove();
                document.removeEventListener("click", removeTooltip);
            }
        };

        setTimeout(() => {
            document.addEventListener("click", removeTooltip);
        }, 100);
    }

    private getKnowledgeTooltipContent(type: string): string {
        const tooltips = {
            entity: `
                <div class="tooltip-header">
                    <i class="bi bi-diagram-2"></i>
                    <strong>Entities Extracted</strong>
                </div>
                <div class="tooltip-content">
                    <p>Companies, technologies, people, and organizations identified in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Microsoft</span>
                        <span class="example-tag">TypeScript</span>
                        <span class="example-tag">React</span>
                    </div>
                </div>
            `,
            topic: `
                <div class="tooltip-header">
                    <i class="bi bi-tags"></i>
                    <strong>Topics Identified</strong>
                </div>
                <div class="tooltip-content">
                    <p>Main themes and subjects covered in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Web Development</span>
                        <span class="example-tag">Programming</span>
                        <span class="example-tag">Documentation</span>
                    </div>
                </div>
            `,
            action: `
                <div class="tooltip-header">
                    <i class="bi bi-lightning"></i>
                    <strong>Actions Detected</strong>
                </div>
                <div class="tooltip-content">
                    <p>Actionable items and next steps found in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Download</span>
                        <span class="example-tag">Install</span>
                        <span class="example-tag">Configure</span>
                    </div>
                </div>
            `,
            extracted: `
                <div class="tooltip-header">
                    <i class="bi bi-check-circle"></i>
                    <strong>Knowledge Extracted</strong>
                </div>
                <div class="tooltip-content">
                    <p>This content has been successfully processed and knowledge has been extracted.</p>
                    <div class="status-indicator success">
                        <i class="bi bi-check"></i>
                        Processing Complete
                    </div>
                </div>
            `,
        };

        return tooltips[type as keyof typeof tooltips] || "";
    }

    private renderAnalyticsOverview() {
        const container = document.getElementById("analyticsOverview");
        if (!container || !this.analyticsData) return;

        const { overview } = this.analyticsData;
        container.innerHTML = `
            <div class="stat-item">
                <div class="stat-number">${overview.totalSites}</div>
                <div class="stat-label">Total Sites</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${overview.totalBookmarks}</div>
                <div class="stat-label">Bookmarks</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${overview.totalHistory}</div>
                <div class="stat-label">History Items</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">${overview.knowledgeExtracted}</div>
                <div class="stat-label">Knowledge Extracted</div>
            </div>
        `;
    }

    private renderActivityCharts() {
        const container = document.getElementById("activityCharts");
        if (!container || !this.analyticsData) return;

        container.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Activity Trends</h6>
                    <div class="analytics-chart">
                        <p class="text-muted">Activity trends chart would be displayed here</p>
                        <div class="chart-placeholder" style="height: 200px; background: #f8f9fa; border-radius: 0.375rem; display: flex; align-items: center; justify-content: center;">
                            <span class="text-muted">Chart visualization would appear here</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private renderKnowledgeBadges(knowledge?: KnowledgeStatus): string {
        if (!knowledge?.hasKnowledge) return "";

        const badges = [];

        if (knowledge.entityCount && knowledge.entityCount > 0) {
            badges.push(`
                <span class="knowledge-badge entity" title="${knowledge.entityCount} entities extracted">
                    <i class="bi bi-diagram-2"></i>
                    ${knowledge.entityCount} Entities
                </span>
            `);
        }

        if (knowledge.topicCount && knowledge.topicCount > 0) {
            badges.push(`
                <span class="knowledge-badge topic" title="${knowledge.topicCount} topics identified">
                    <i class="bi bi-tags"></i>
                    ${knowledge.topicCount} Topics
                </span>
            `);
        }

        if (knowledge.suggestionCount && knowledge.suggestionCount > 0) {
            badges.push(`
                <span class="knowledge-badge action" title="${knowledge.suggestionCount} actions detected">
                    <i class="bi bi-lightning"></i>
                    ${knowledge.suggestionCount} Actions
                </span>
            `);
        }

        if (knowledge.status === "extracted") {
            badges.push(`
                <span class="knowledge-badge extracted" title="Knowledge successfully extracted">
                    <i class="bi bi-check-circle"></i>
                    Extracted
                </span>
            `);
        }

        return badges.join("");
    }

    private renderConfidenceIndicator(confidence: number): string {
        const percentage = Math.round(confidence * 100);
        let color = "#dc3545"; // Red for low confidence

        if (confidence >= 0.7) {
            color = "#28a745"; // Green for high confidence
        } else if (confidence >= 0.4) {
            color = "#ffc107"; // Yellow for medium confidence
        }

        return `
            <div class="confidence-indicator" title="Confidence: ${percentage}%">
                <span class="text-muted small">Confidence:</span>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${percentage}%; background-color: ${color}"></div>
                </div>
                <span class="small">${percentage}%</span>
            </div>
        `;
    }

    // Storage methods
    private async loadRecentSearches() {
        try {
            const stored = localStorage.getItem(
                "websiteLibrary_recentSearches",
            );
            if (stored) {
                this.recentSearches = JSON.parse(stored);
                this.updateRecentSearchesUI();
            }
        } catch (error) {
            console.error("Failed to load recent searches:", error);
        }
    }

    private saveRecentSearches() {
        try {
            localStorage.setItem(
                "websiteLibrary_recentSearches",
                JSON.stringify(this.recentSearches),
            );
        } catch (error) {
            console.error("Failed to save recent searches:", error);
        }
    }

    // Enhanced search with auto-suggestions
    private async loadSearchSuggestions(query: string) {
        try {
            let suggestions: SearchSuggestion[] = [];

            if (this.isConnected) {
                const suggestionTexts =
                    await this.chromeExtensionService.getSearchSuggestions(
                        query,
                    );
                suggestions = suggestionTexts.map((text) => ({
                    text,
                    type: "auto" as const,
                    metadata: {},
                }));
            } else {
                // No connection - return empty suggestions array
                suggestions = [];
            }

            // Add recent searches if they match
            const recentMatches = this.recentSearches
                .filter((search) =>
                    search.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 3)
                .map((text) => ({
                    text,
                    type: "recent" as const,
                    metadata: { lastUsed: "Recently" },
                }));

            // Combine and deduplicate
            this.searchSuggestions = [
                ...recentMatches,
                ...suggestions.filter(
                    (s) => !recentMatches.some((r) => r.text === s.text),
                ),
            ].slice(0, 8);
        } catch (error) {
            console.error("Failed to load search suggestions:", error);
            this.searchSuggestions = [];
        }
    }

    private showSearchSuggestions(query: string) {
        if (!this.suggestionDropdown || this.searchSuggestions.length === 0)
            return;

        const suggestionsHtml = this.searchSuggestions
            .map(
                (suggestion) => `
            <div class="suggestion-item dropdown-item d-flex align-items-center justify-content-between" 
                 data-suggestion="${suggestion.text}">
                <div class="d-flex align-items-center">
                    <i class="bi ${this.getSuggestionIcon(suggestion.type)} me-2 text-muted"></i>
                    <span>${this.highlightMatch(suggestion.text, query)}</span>
                </div>
                <div class="suggestion-metadata">
                    ${this.renderSuggestionMetadata(suggestion)}
                </div>
            </div>
        `,
            )
            .join("");

        this.suggestionDropdown.innerHTML = suggestionsHtml;
        this.suggestionDropdown.style.display = "block";

        // Add click handlers to suggestions
        this.suggestionDropdown
            .querySelectorAll(".suggestion-item")
            .forEach((item) => {
                item.addEventListener("click", () =>
                    this.selectSuggestion(item as HTMLElement),
                );
            });
    }

    private getSuggestionIcon(type: string): string {
        switch (type) {
            case "recent":
                return "bi-clock-history";
            case "entity":
                return "bi-diagram-2";
            case "topic":
                return "bi-tags";
            case "domain":
                return "bi-globe";
            default:
                return "bi-search";
        }
    }

    private highlightMatch(text: string, query: string): string {
        if (!query) return text;

        const regex = new RegExp(`(${query})`, "gi");
        return text.replace(regex, "<strong>$1</strong>");
    }

    private renderSuggestionMetadata(suggestion: SearchSuggestion): string {
        if (!suggestion.metadata) return "";

        const { count, lastUsed, source } = suggestion.metadata;

        if (count) {
            return `<small class="text-muted">${count} results</small>`;
        }
        if (lastUsed) {
            return `<small class="text-muted">${lastUsed}</small>`;
        }
        if (source) {
            return `<small class="text-muted">from ${source}</small>`;
        }
        return "";
    }

    private selectSuggestion(suggestionElement: HTMLElement) {
        const text = suggestionElement.textContent?.trim();
        if (text) {
            const searchInput = document.getElementById(
                "searchInput",
            ) as HTMLInputElement;
            if (searchInput) {
                searchInput.value = text;
                this.currentQuery = text;
                this.hideSearchSuggestions();
                this.performSearch();
            }
        }
    }

    private hideSearchSuggestions() {
        if (this.suggestionDropdown) {
            this.suggestionDropdown.style.display = "none";
            this.suggestionDropdown.innerHTML = "";
        }
    }

    // Enhanced knowledge extraction
    private async extractKnowledgeForAllResults() {
        if (this.currentResults.length === 0) {
            this.notificationManager.showWarning(
                "No search results to extract knowledge from",
            );
            return;
        }

        const unextractedSites = this.currentResults.filter(
            (site) =>
                !site.knowledge?.hasKnowledge ||
                site.knowledge.status !== "extracted",
        );

        if (unextractedSites.length === 0) {
            this.notificationManager.showSuccess(
                "Knowledge already extracted for all results",
            );
            return;
        }

        this.notificationManager.showProgress(
            `Extracting knowledge from ${unextractedSites.length} websites...`,
            0,
        );

        try {
            for (let i = 0; i < unextractedSites.length; i++) {
                const site = unextractedSites[i];
                const progress = Math.round(
                    ((i + 1) / unextractedSites.length) * 100,
                );

                this.notificationManager.showProgress(
                    `Processing ${site.domain}... (${i + 1}/${unextractedSites.length})`,
                    progress,
                );

                await this.extractKnowledgeForSite(site);

                // Small delay to prevent overwhelming the system
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            this.notificationManager.showSuccess(
                `Knowledge extracted from ${unextractedSites.length} websites`,
            );

            // Refresh the results display
            this.renderSearchResults(this.currentResults);
        } catch (error) {
            console.error("Bulk knowledge extraction failed:", error);
            this.notificationManager.showError(
                "Failed to extract knowledge from some websites",
            );
        }
    }

    private async extractKnowledgeForSite(website: Website) {
        try {
            if (this.isConnected) {
                const knowledge =
                    await this.chromeExtensionService.extractKnowledge(
                        website.url,
                    );
                website.knowledge = knowledge;
                this.knowledgeCache.set(website.url, knowledge);
            } else {
                // No connection - cannot extract knowledge
                website.knowledge = {
                    hasKnowledge: false,
                    status: "error",
                    confidence: 0,
                };
                this.notificationManager.showError(
                    "Connection required to extract knowledge",
                );
            }
        } catch (error) {
            console.error(
                `Failed to extract knowledge for ${website.url}:`,
                error,
            );
            if (website.knowledge) {
                website.knowledge.status = "error";
            } else {
                website.knowledge = {
                    hasKnowledge: false,
                    status: "error",
                    confidence: 0,
                };
            }
        }
    }

    // User preferences management
    private loadUserPreferences(): UserPreferences {
        try {
            const stored = localStorage.getItem(
                "websiteLibrary_userPreferences",
            );
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error("Failed to load user preferences:", error);
        }

        // Default preferences
        return {
            viewMode: "list",
            autoExtractKnowledge: false,
            showConfidenceScores: true,
            enableNotifications: true,
            theme: "light",
        };
    }

    // Global notification action handlers
    public handleNotificationAction(id: string, actionLabel: string): void {
        this.notificationManager.handleNotificationAction(id, actionLabel);
    }

    public hideNotification(id: string): void {
        this.notificationManager.hideNotification(id);
    }

    // Quick action methods
    public showImportModal() {
        console.log("Show import modal - using web activity modal as default");
        this.showWebActivityImportModal();
    }

    public showWebActivityImportModal() {
        this.importUI.showWebActivityImportModal();
    }

    public showFolderImportModal() {
        this.importUI.showFolderImportModal();
    }

    // Import handling methods
    private async handleWebActivityImport(
        options: ImportOptions,
    ): Promise<void> {
        try {
            this.importUI.showImportProgress({
                importId: "web-activity-import",
                phase: "initializing",
                totalItems: 0,
                processedItems: 0,
                errors: [],
            });

            const result =
                await this.importManager.startWebActivityImport(options);
            this.importUI.showImportComplete(result);
        } catch (error) {
            this.importUI.showImportError({
                type: "processing",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                timestamp: Date.now(),
            });
        }
    }

    private async handleFolderImport(
        options: FolderImportOptions,
    ): Promise<void> {
        try {
            this.importUI.showImportProgress({
                importId: "folder-import",
                phase: "initializing",
                totalItems: 0, // Will be updated when folder is enumerated
                processedItems: 0,
                errors: [],
            });

            const result = await this.importManager.startFolderImport(options);
            this.importUI.showImportComplete(result);
        } catch (error) {
            this.importUI.showImportError({
                type: "processing",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                timestamp: Date.now(),
            });
        }
    }

    private async handleCancelImport(): Promise<void> {
        try {
            // Cancel any active import operations
            await this.importManager.cancelImport("web-activity-import");
            await this.importManager.cancelImport("file-import");
        } catch (error) {
            console.error("Failed to cancel import:", error);
        }
    }

    private async handleImportComplete(result: ImportResult): Promise<void> {
        // Refresh library stats after successful import
        await this.loadLibraryStats();

        // Update discover data if we're on the discover page
        if (this.navigation.currentPage === "discover") {
            await this.initializeDiscoverPage();
        }

        // Show success notification
        this.notificationManager.showSuccess(
            `Successfully imported ${result.itemCount} items!`,
        );
    }

    public exploreRecentBookmarks() {
        console.log("Explore recent bookmarks");
        this.navigateToPage("search");
        // Set search to show recent bookmarks
    }

    public exploreMostVisited() {
        console.log("Explore most visited");
        this.navigateToPage("search");
        // Set search to show most visited sites
    }

    public exploreByDomain() {
        console.log("Explore by domain");
        this.navigateToPage("search");
        // Set view mode to domain view
        this.setViewMode("domain");
    }

    public showSettings() {
        console.log("Show enhanced settings modal");

        // Create and show enhanced settings modal
        this.createEnhancedSettingsModal();
    }

    // Enhanced settings modal
    private createEnhancedSettingsModal() {
        // Remove existing modal if present
        const existingModal = document.getElementById("settingsModal");
        if (existingModal) {
            existingModal.remove();
        }

        const modalHtml = `
            <div class="modal fade" id="settingsModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Enhanced Settings</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <h6>Search Preferences</h6>
                                    <div class="mb-3">
                                        <label class="form-label">Default View Mode</label>
                                        <select class="form-select" id="defaultViewMode">
                                            <option value="list">List</option>
                                            <option value="grid">Grid</option>
                                            <option value="timeline">Timeline</option>
                                            <option value="domain">Domain</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <h6>Knowledge & Notifications</h6>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="autoExtractKnowledge">
                                            <label class="form-check-label">Auto-extract knowledge</label>
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="showConfidenceScores">
                                            <label class="form-check-label">Show confidence scores</label>
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="enableNotifications">
                                            <label class="form-check-label">Enable notifications</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="saveSettingsBtn">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML("beforeend", modalHtml);

        // Populate current settings
        this.populateSettingsModal();

        // Add save handler
        const saveBtn = document.getElementById("saveSettingsBtn");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.saveUserPreferences());
        }

        // Show modal using Bootstrap
        const modal = document.getElementById("settingsModal");
        if (modal && (window as any).bootstrap) {
            const bsModal = new (window as any).bootstrap.Modal(modal);
            bsModal.show();
        }
    }

    private populateSettingsModal() {
        const prefs = this.userPreferences;

        const defaultViewMode = document.getElementById(
            "defaultViewMode",
        ) as HTMLSelectElement;
        const autoExtractKnowledge = document.getElementById(
            "autoExtractKnowledge",
        ) as HTMLInputElement;
        const showConfidenceScores = document.getElementById(
            "showConfidenceScores",
        ) as HTMLInputElement;
        const enableNotifications = document.getElementById(
            "enableNotifications",
        ) as HTMLInputElement;

        if (defaultViewMode) defaultViewMode.value = prefs.viewMode;
        if (autoExtractKnowledge)
            autoExtractKnowledge.checked = prefs.autoExtractKnowledge;
        if (showConfidenceScores)
            showConfidenceScores.checked = prefs.showConfidenceScores;
        if (enableNotifications)
            enableNotifications.checked = prefs.enableNotifications;
    }

    private saveUserPreferences() {
        const defaultViewMode = document.getElementById(
            "defaultViewMode",
        ) as HTMLSelectElement;
        const autoExtractKnowledge = document.getElementById(
            "autoExtractKnowledge",
        ) as HTMLInputElement;
        const showConfidenceScores = document.getElementById(
            "showConfidenceScores",
        ) as HTMLInputElement;
        const enableNotifications = document.getElementById(
            "enableNotifications",
        ) as HTMLInputElement;

        this.userPreferences = {
            viewMode: defaultViewMode?.value || "list",
            autoExtractKnowledge: autoExtractKnowledge?.checked || false,
            showConfidenceScores: showConfidenceScores?.checked || true,
            enableNotifications: enableNotifications?.checked || true,
            theme: this.userPreferences.theme,
        };

        // Save to localStorage
        try {
            localStorage.setItem(
                "websiteLibrary_userPreferences",
                JSON.stringify(this.userPreferences),
            );
            this.notificationManager.showSuccess("Settings saved successfully");

            // Apply preferences immediately
            this.setViewMode(this.userPreferences.viewMode as any);

            // Hide modal
            const modal = document.getElementById("settingsModal");
            if (modal && (window as any).bootstrap) {
                const bsModal = (window as any).bootstrap.Modal.getInstance(
                    modal,
                );
                if (bsModal) bsModal.hide();
            }
        } catch (error) {
            console.error("Failed to save user preferences:", error);
            this.notificationManager.showError("Failed to save settings");
        }
    }
}

// Initialize the panel when DOM is loaded
let libraryPanelFullPage: WebsiteLibraryPanelFullPage;

document.addEventListener("DOMContentLoaded", () => {
    libraryPanelFullPage = new WebsiteLibraryPanelFullPage();
    libraryPanelFullPage.initialize();

    // Make it globally available for onclick handlers
    (window as any).libraryPanel = libraryPanelFullPage;
});

// ===================================================================
// ENHANCED FEATURES: Real-time Integration & Advanced Features
// ===================================================================

// Enhanced interfaces for advanced features
interface NotificationManager {
    showSuccess(message: string, actions?: NotificationAction[]): void;
    showError(message: string, retry?: () => void): void;
    showWarning(message: string): void;
    showInfo(message: string): void;
    showProgress(message: string, progress?: number): void;
    hide(id: string): void;
    clear(): void;
    handleNotificationAction(id: string, actionLabel: string): void;
    hideNotification(id: string): void;
}

interface NotificationAction {
    label: string;
    action: () => void;
    style?: "primary" | "secondary" | "success" | "danger";
}

interface SearchSuggestion {
    text: string;
    type: "recent" | "entity" | "topic" | "domain" | "auto";
    metadata?: {
        count?: number;
        lastUsed?: string;
        source?: string;
    };
}

interface UserPreferences {
    viewMode: string;
    autoExtractKnowledge: boolean;
    showConfidenceScores: boolean;
    enableNotifications: boolean;
    theme: "light" | "dark" | "auto";
}

// Enhanced Chrome Extension Service for real-time data
interface ChromeExtensionService {
    getLibraryStats(): Promise<LibraryStats>;
    searchWebsites(
        query: string,
        filters: SearchFilters,
    ): Promise<SearchResult>;
    extractKnowledge(url: string): Promise<KnowledgeStatus>;
    checkKnowledgeStatus(url: string): Promise<KnowledgeStatus>;
    getSearchSuggestions(query: string): Promise<string[]>;
    getRecentSearches(): Promise<string[]>;
    saveSearch(query: string, results: SearchResult): Promise<void>;
}

// NotificationManager Implementation
class NotificationManagerImpl implements NotificationManager {
    private notifications: Map<string, HTMLElement> = new Map();
    private notificationCounter = 0;

    showSuccess(message: string, actions?: NotificationAction[]): void {
        this.showNotification("success", message, actions);
    }

    showError(message: string, retry?: () => void): void {
        const actions = retry
            ? [{ label: "Retry", action: retry, style: "primary" as const }]
            : undefined;
        this.showNotification("danger", message, actions);
    }

    showWarning(message: string): void {
        this.showNotification("warning", message);
    }

    showInfo(message: string): void {
        this.showNotification("info", message);
    }

    showProgress(message: string, progress?: number): void {
        const id = this.showNotification("info", message, undefined, progress);

        // Auto-update progress if provided
        if (progress !== undefined) {
            const notification = this.notifications.get(id);
            if (notification) {
                const progressBar = notification.querySelector(
                    ".progress-bar",
                ) as HTMLElement;
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                    progressBar.textContent = `${progress}%`;
                }
            }
        }
    }

    hide(id: string): void {
        const notification = this.notifications.get(id);
        if (notification) {
            notification.classList.add("fade-out");
            setTimeout(() => {
                notification.remove();
                this.notifications.delete(id);
            }, 300);
        }
    }

    clear(): void {
        this.notifications.forEach((notification) => {
            notification.remove();
        });
        this.notifications.clear();
    }

    private showNotification(
        type: string,
        message: string,
        actions?: NotificationAction[],
        progress?: number,
    ): string {
        const id = `notification-${++this.notificationCounter}`;

        // Create notification container if it doesn't exist
        let container = document.getElementById("notificationContainer");
        if (!container) {
            container = document.createElement("div");
            container.id = "notificationContainer";
            container.className = "notification-container";
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1050;
                max-width: 350px;
            `;
            document.body.appendChild(container);
        }

        const actionsHtml = actions
            ? actions
                  .map(
                      (action) =>
                          `<button class="btn btn-sm btn-${action.style || "secondary"} me-2" 
                     data-notification-id="${id}" data-action="${action.label}">${action.label}</button>`,
                  )
                  .join("")
            : "";

        const progressHtml =
            progress !== undefined
                ? `
            <div class="progress mt-2" style="height: 4px;">
                <div class="progress-bar" style="width: ${progress}%"></div>
            </div>
        `
                : "";

        const notificationHtml = `
            <div class="alert alert-${type} alert-dismissible fade show notification-item" 
                 data-id="${id}" style="margin-bottom: 10px;">
                <div class="d-flex align-items-start">
                    <div class="flex-grow-1">
                        <div class="notification-message">${message}</div>
                        ${progressHtml}
                        ${actionsHtml ? `<div class="mt-2">${actionsHtml}</div>` : ""}
                    </div>
                    <button type="button" class="btn-close" data-notification-id="${id}" data-action="close"></button>
                </div>
            </div>
        `;

        container.insertAdjacentHTML("afterbegin", notificationHtml);

        const notification = container.querySelector(
            `[data-id="${id}"]`,
        ) as HTMLElement;
        if (notification) {
            this.notifications.set(id, notification);

            // Add event listeners for notification actions
            notification.querySelectorAll("[data-action]").forEach((button) => {
                button.addEventListener("click", (e) => {
                    const target = e.target as HTMLElement;
                    const action = target.getAttribute("data-action");
                    const notificationId = target.getAttribute(
                        "data-notification-id",
                    );

                    if (action === "close" && notificationId) {
                        this.hide(notificationId);
                    } else if (action && notificationId && actions) {
                        const actionHandler = actions.find(
                            (a) => a.label === action,
                        );
                        if (actionHandler) {
                            actionHandler.action();
                        }
                    }
                });
            });

            // Store action handlers for later use
            if (actions) {
                (notification as any)._actionHandlers = actions.reduce(
                    (acc, action) => {
                        acc[action.label] = action.action;
                        return acc;
                    },
                    {} as Record<string, () => void>,
                );
            }

            // Auto-hide success/warning notifications after 5 seconds
            if (type === "success" || type === "warning") {
                setTimeout(() => this.hide(id), 5000);
            }
        }

        return id;
    }

    // Public methods for notification actions
    public handleNotificationAction(id: string, actionLabel: string): void {
        const notification = this.notifications.get(id);
        if (notification && (notification as any)._actionHandlers) {
            const handler = (notification as any)._actionHandlers[actionLabel];
            if (handler) {
                handler();
                this.hide(id);
            }
        }
    }

    public hideNotification(id: string): void {
        this.hide(id);
    }
}

// Chrome Extension Service Implementation
class ChromeExtensionServiceImpl implements ChromeExtensionService {
    async getLibraryStats(): Promise<LibraryStats> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "getLibraryStats",
                    includeKnowledge: true,
                });

                if (response.success) {
                    return response.stats;
                } else {
                    throw new Error(
                        response.error || "Failed to get library stats",
                    );
                }
            } catch (error) {
                console.error("Chrome extension not available:", error);
                throw error;
            }
        }
        throw new Error("Chrome extension not available");
    }

    async searchWebsites(
        query: string,
        filters: SearchFilters,
    ): Promise<SearchResult> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "searchWebsites",
                    parameters: {
                        query,
                        filters,
                        includeSummary: true,
                        limit: 50,
                    },
                });

                if (response.success) {
                    return response.results;
                } else {
                    throw new Error(response.error || "Search failed");
                }
            } catch (error) {
                console.error("Search request failed:", error);
                throw error;
            }
        }
        throw new Error("Chrome extension not available");
    }

    async extractKnowledge(url: string): Promise<KnowledgeStatus> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "extractKnowledge",
                    url,
                });
                return response;
            } catch (error) {
                console.error("Knowledge extraction failed:", error);
                throw error;
            }
        }
        throw new Error("Chrome extension not available");
    }

    async checkKnowledgeStatus(url: string): Promise<KnowledgeStatus> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "checkKnowledgeStatus",
                    url,
                });
                return response;
            } catch (error) {
                console.error("Knowledge status check failed:", error);
                throw error;
            }
        }
        throw new Error("Chrome extension not available");
    }

    async getSearchSuggestions(query: string): Promise<string[]> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "getSearchSuggestions",
                    query,
                });
                return response || [];
            } catch (error) {
                console.error("Failed to get search suggestions:", error);
                return [];
            }
        }
        throw new Error("Chrome extension not available");
    }

    async getRecentSearches(): Promise<string[]> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: "getRecentSearches",
                });
                return response || [];
            } catch (error) {
                console.error("Failed to get recent searches:", error);
                return [];
            }
        }
        throw new Error("Chrome extension not available");
    }

    async saveSearch(query: string, results: SearchResult): Promise<void> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                await chrome.runtime.sendMessage({
                    action: "saveSearch",
                    query,
                    results,
                });
            } catch (error) {
                console.error("Failed to save search:", error);
            }
        }
    }
}

// Create global instance for compatibility
let libraryPanel: WebsiteLibraryPanelFullPage;

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        libraryPanel = new WebsiteLibraryPanelFullPage();
        libraryPanel.initialize();

        // Make available globally for any remaining references
        (window as any).libraryPanel = libraryPanel;
    });
} else {
    libraryPanel = new WebsiteLibraryPanelFullPage();
    libraryPanel.initialize();

    // Make available globally for any remaining references
    (window as any).libraryPanel = libraryPanel;
}
