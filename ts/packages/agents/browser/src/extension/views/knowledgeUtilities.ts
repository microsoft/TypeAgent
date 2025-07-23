// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared utilities for knowledge extraction features
 * Consolidates common functionality from knowledgeLibrary.ts and pageKnowledge.ts
 */

import type { AnswerEnhancement } from "../../agent/search/schema/answerEnhancement.mjs";

// ===================================================================
// INTERFACES AND TYPES
// ===================================================================

export interface NotificationAction {
    label: string;
    action: () => void;
    style?: "primary" | "secondary" | "success" | "danger";
}

export interface LibraryStats {
    totalWebsites: number;
    totalBookmarks: number;
    totalHistory: number;
    topDomains: number;
    lastImport?: number;
}

export interface SearchFilters {
    dateFrom?: string;
    dateTo?: string;
    sourceType?: "bookmarks" | "history";
    domain?: string;
    minRelevance?: number;
}

export interface KnowledgeStatus {
    hasKnowledge: boolean;
    extractionDate?: string;
    entityCount?: number;
    topicCount?: number;
    suggestionCount?: number;
    status: "extracted" | "pending" | "error" | "none" | "extracting";
    confidence?: number;
}

export interface SearchResult {
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
    topTopics?: string[];
    suggestedFollowups?: string[];
    relatedEntities?: Array<{
        name: string;
        type: string;
        confidence: number;
    }>;
    answerEnhancement?: AnswerEnhancement; // NEW: Dynamic enhancement from LLM
}

export interface Website {
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

export interface SourceReference {
    url: string;
    title: string;
    relevance: number;
}

export interface EntityMatch {
    name: string;
    type: string;
    confidence: number;
}

// ===================================================================
// NOTIFICATION MANAGER
// ===================================================================

export class NotificationManager {
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
        this.showNotification("info", message, undefined, progress);
    }

    showEnhancedNotification(
        type: "success" | "danger" | "info" | "warning",
        title: string,
        message: string,
        icon: string = "bi-info-circle",
    ): void {
        const notification = document.createElement("div");
        notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        notification.style.cssText = `
            top: 20px; 
            right: 20px; 
            z-index: 9999; 
            min-width: 350px; 
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border: none;
            border-radius: 8px;
        `;

        notification.innerHTML = `
            <div class="d-flex align-items-start">
                <i class="${icon} me-3 mt-1" style="font-size: 1.2rem;"></i>
                <div class="flex-grow-1">
                    <div class="fw-bold mb-1">${title}</div>
                    <div class="small">${message}</div>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove("show");
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 6000);
    }

    showTemporaryStatus(
        message: string,
        type: "success" | "danger" | "info",
    ): void {
        const alertClass = "alert-" + type;
        const iconClass =
            type === "success"
                ? "bi-check-circle"
                : type === "danger"
                  ? "bi-exclamation-triangle"
                  : "bi-info-circle";

        const statusDiv = document.createElement("div");
        statusDiv.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
        statusDiv.style.cssText =
            "top: 1rem; right: 1rem; z-index: 1050; min-width: 250px;";
        statusDiv.innerHTML = `
            <i class="${iconClass} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(statusDiv);

        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.remove();
            }
        }, 3000);
    }

    hide(id: string): void {
        const notification = this.notifications.get(id);
        if (notification) {
            notification.remove();
            this.notifications.delete(id);
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
        // Simplified implementation for now
        return id;
    }

    public handleNotificationAction(id: string, actionLabel: string): void {
        // Implementation here
    }

    public hideNotification(id: string): void {
        this.hide(id);
    }
}

// ===================================================================
// CHROME EXTENSION SERVICE
// ===================================================================

export class ChromeExtensionService {
    async getLibraryStats(): Promise<LibraryStats> {
        return this.sendMessage({
            type: "getLibraryStats",
            includeKnowledge: true,
        });
    }

    async getAnalyticsData(options?: {
        timeRange?: string;
        includeQuality?: boolean;
        includeProgress?: boolean;
        topDomainsLimit?: number;
        activityGranularity?: "day" | "week" | "month";
    }): Promise<any> {
        return this.sendMessage({
            type: "getAnalyticsData",
            timeRange: options?.timeRange || "30d",
            includeQuality: options?.includeQuality !== false,
            includeProgress: options?.includeProgress !== false,
            topDomainsLimit: options?.topDomainsLimit || 10,
            activityGranularity: options?.activityGranularity || "day",
        });
    }

    async searchWebMemories(
        query: string,
        filters: SearchFilters,
    ): Promise<SearchResult> {
        const response = (await this.sendMessage({
            type: "searchWebMemories",
            parameters: {
                query,
                generateAnswer: true,
                includeRelatedEntities: true,
                enableAdvancedSearch: true,
                limit: 50,
                minScore: filters.minRelevance || 0.3,
                domain: filters.domain,
            },
        })) as any;

        return response.results;
    }

    async getCurrentTab(): Promise<chrome.tabs.Tab | null> {
        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            return tabs.length > 0 ? tabs[0] : null;
        } catch (error) {
            console.error("Failed to get current tab:", error);
            return null;
        }
    }

    async getPageIndexStatus(url: string): Promise<any> {
        return this.sendMessage({
            type: "getPageIndexStatus",
            url,
        });
    }

    async indexPageContent(url: string, mode: string): Promise<any> {
        return this.sendMessage({
            type: "indexPageContentDirect",
            url,
            mode,
        });
    }

    async extractPageKnowledge(
        url: string,
        mode: string,
        extractionSettings: any,
    ): Promise<any> {
        return this.sendMessage({
            type: "extractPageKnowledge",
            url,
            mode,
            extractionSettings,
        });
    }

    async queryKnowledge(parameters: any): Promise<any> {
        return this.sendMessage({
            type: "queryKnowledge",
            parameters,
        });
    }

    async checkConnection(): Promise<any> {
        return this.sendMessage({
            type: "checkConnection",
        });
    }

    async getAutoIndexSetting(): Promise<boolean> {
        try {
            const settings = await chrome.storage.sync.get(["autoIndexing"]);
            return settings.autoIndexing || false;
        } catch (error) {
            console.error("Failed to get auto-index setting:", error);
            return false;
        }
    }

    async setAutoIndexSetting(enabled: boolean): Promise<void> {
        try {
            await chrome.storage.sync.set({ autoIndexing: enabled });
        } catch (error) {
            console.error("Failed to set auto-index setting:", error);
            throw error;
        }
    }

    async getExtractionSettings(): Promise<any> {
        try {
            const settings = await chrome.storage.sync.get([
                "extractionSettings",
            ]);
            return settings.extractionSettings || null;
        } catch (error) {
            console.error("Failed to get extraction settings:", error);
            return null;
        }
    }

    async saveExtractionSettings(settings: any): Promise<void> {
        try {
            await chrome.storage.sync.set({
                extractionMode: settings.mode,
                suggestQuestions: settings.suggestQuestions,
            });
        } catch (error) {
            console.error("Failed to save extraction settings:", error);
            throw error;
        }
    }

    async openOptionsPage(): Promise<void> {
        try {
            chrome.runtime.openOptionsPage();
        } catch (error) {
            console.error("Failed to open options page:", error);
            throw error;
        }
    }

    async createTab(
        url: string,
        active: boolean = true,
    ): Promise<chrome.tabs.Tab> {
        try {
            return await chrome.tabs.create({ url, active });
        } catch (error) {
            console.error("Failed to create tab:", error);
            throw error;
        }
    }

    async getIndexStats(): Promise<any> {
        return this.sendMessage({
            type: "getIndexStats",
        });
    }

    async getPageSourceInfo(url: string): Promise<any> {
        return this.sendMessage({
            type: "getPageSourceInfo",
            url,
        });
    }

    async getPageIndexedKnowledge(url: string): Promise<any> {
        return this.sendMessage({
            type: "getPageIndexedKnowledge",
            url,
        });
    }

    async discoverRelationships(
        url: string,
        knowledge: any,
        maxResults: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "discoverRelationships",
            url,
            knowledge,
            maxResults,
        });
    }

    async generateTemporalSuggestions(maxSuggestions: number): Promise<any> {
        return this.sendMessage({
            type: "generateTemporalSuggestions",
            maxSuggestions,
        });
    }

    async searchByEntities(
        entities: string[],
        url: string,
        maxResults: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "searchByEntities",
            entities,
            url,
            maxResults,
        });
    }

    async searchByTopics(
        topics: string[],
        url: string,
        maxResults: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "searchByTopics",
            topics,
            url,
            maxResults,
        });
    }

    async hybridSearch(
        query: string,
        url: string,
        maxResults: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "hybridSearch",
            query,
            url,
            maxResults,
        });
    }

    async searchWebMemoriesAdvanced(parameters: any): Promise<any> {
        return this.sendMessage({
            type: "searchWebMemories",
            parameters,
        });
    }

    async checkAIModelAvailability(): Promise<any> {
        return this.sendMessage({
            type: "checkAIModelAvailability",
        });
    }

    async getPageQualityMetrics(url: string): Promise<any> {
        return this.sendMessage({
            type: "getPageQualityMetrics",
            url,
        });
    }

    async notifyAutoIndexSettingChanged(enabled: boolean): Promise<void> {
        return this.sendMessage({
            type: "autoIndexSettingChanged",
            enabled,
        });
    }

    async getRecentKnowledgeItems(limit: number = 10): Promise<any> {
        return this.sendMessage({
            type: "getRecentKnowledgeItems",
            limit,
        });
    }

    async extractKnowledge(url: string): Promise<any> {
        return this.sendMessage({
            type: "extractKnowledge",
            url,
        });
    }

    async checkKnowledgeStatus(url: string): Promise<any> {
        return this.sendMessage({
            action: "checkKnowledgeStatus",
            url,
        });
    }

    async getSearchSuggestions(query: string): Promise<string[]> {
        const response = (await this.sendMessage({
            type: "getSearchSuggestions",
            query,
        })) as any;
        return response.suggestions || [];
    }

    async getRecentSearches(): Promise<string[]> {
        return this.sendMessage({
            action: "getRecentSearches",
        });
    }

    async getDiscoverInsights(
        limit: number = 10,
        timeframe: string = "30d",
    ): Promise<any> {
        return this.sendMessage({
            type: "getDiscoverInsights",
            limit,
            timeframe,
        });
    }

    async saveSearch(query: string, results: any): Promise<void> {
        return this.sendMessage({
            type: "saveSearch",
            query,
            results,
        });
    }

    async checkWebSocketConnection(): Promise<any> {
        return this.sendMessage({
            type: "checkWebSocketConnection",
        });
    }

    private async sendMessage<T>(message: any): Promise<T> {
        if (typeof chrome !== "undefined" && chrome.runtime) {
            try {
                const response = await chrome.runtime.sendMessage(message);
                if (response && response.error) {
                    throw new Error(response.error);
                }
                return response;
            } catch (error) {
                console.error("Chrome runtime message failed:", error);
                throw error;
            }
        }
        throw new Error("Chrome extension not available");
    }
}

// ===================================================================
// UTILITIES
// ===================================================================

export class KnowledgeFormatUtils {
    static escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    static formatDate(dateString: string): string {
        if (!dateString || dateString === "Never") return "Never";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return "Unknown";
        }
    }

    static extractDomainFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }
}

export class KnowledgeTemplateHelpers {
    static createAlert(type: string, icon: string, content: string): string {
        return `
            <div class="alert alert-${type} mb-0">
                <div class="d-flex align-items-start">
                    <i class="${icon} me-2 mt-1"></i>
                    <div class="flex-grow-1">${content}</div>
                </div>
            </div>
        `;
    }

    static createLoadingState(message: string, subtext?: string): string {
        const subtextHtml = subtext
            ? `<small class="text-muted">${subtext}</small>`
            : "";
        return `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-3 mb-0">${message}</p>
                    ${subtextHtml}
                </div>
            </div>
        `;
    }

    static createCard(
        title: string,
        content: string,
        icon: string,
        badge?: string,
    ): string {
        const badgeHtml = badge
            ? `<span id="${badge}" class="badge bg-secondary ms-2">0</span>`
            : "";
        return `
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="${icon}"></i> ${title}
                        ${badgeHtml}
                    </h6>
                </div>
                <div class="card-body">${content}</div>
            </div>
        `;
    }

    static createSearchLoadingState(): string {
        return `
            <div class="d-flex align-items-center text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Searching knowledge...</span>
            </div>
        `;
    }

    static createQueryAnswer(answer: string, sources: any[]): string {
        const sourcesHtml =
            sources && sources.length > 0
                ? `<hr class="my-2"><small class="text-muted"><strong>Sources:</strong> ${sources.map((s: any) => s.title).join(", ")}</small>`
                : "";

        const content = `
            <div class="fw-semibold">Answer:</div>
            <p class="mb-2">${answer}</p>
            ${sourcesHtml}
        `;

        return this.createAlert("info", "bi bi-lightbulb", content);
    }

    static createEmptyState(icon: string, message: string): string {
        return `
            <div class="text-muted text-center">
                <i class="${icon}"></i>
                ${message}
            </div>
        `;
    }
}

export class KnowledgeConnectionManager {
    static async checkConnectionStatus(): Promise<boolean> {
        try {
            if (typeof chrome === "undefined" || !chrome.runtime) {
                return false;
            }
            const response = await chrome.runtime.sendMessage({
                type: "checkWebSocketConnection",
            });
            return response?.connected === true;
        } catch (error) {
            console.error("Connection check failed:", error);
            return false;
        }
    }

    static updateConnectionStatus(isConnected: boolean): void {
        const statusElement = document.getElementById("connectionStatus");
        if (statusElement) {
            const indicator = statusElement.querySelector(".status-indicator");
            const text = statusElement.querySelector("span:last-child");
            if (indicator && text) {
                if (isConnected) {
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
}

// ===================================================================
// CHROME EVENT MANAGER
// ===================================================================

export class ChromeEventManager {
    static setupTabListeners(onTabChange: () => void): void {
        try {
            chrome.tabs.onActivated.addListener(() => {
                onTabChange();
            });

            chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
                if (changeInfo.status === "complete") {
                    onTabChange();
                }
            });
        } catch (error) {
            console.error("Failed to setup tab listeners:", error);
        }
    }

    static setupMessageListener(
        callback: (message: any, sender: any, sendResponse: any) => void,
    ): void {
        try {
            chrome.runtime.onMessage.addListener(callback);
        } catch (error) {
            console.error("Failed to setup message listener:", error);
        }
    }
}

// ===================================================================
// EXPORTS
// ===================================================================

export const notificationManager = new NotificationManager();
export const chromeExtensionService = new ChromeExtensionService();

export {
    KnowledgeTemplateHelpers as TemplateHelpers,
    KnowledgeFormatUtils as FormatUtils,
    KnowledgeConnectionManager as ConnectionManager,
    ChromeEventManager as EventManager,
};

// ===================================================================
// SERVICE INTERFACES FOR REFACTORED PANELS
// ===================================================================

export interface AnalyticsServices {
    loadAnalyticsData(): Promise<any>;
}

export interface SearchServices {
    performSearch(query: string, filters?: any): Promise<SearchResult>;
}

export interface DiscoveryServices {
    loadDiscoverData(): Promise<any>;
}

export interface EntityGraphServices {
    searchByEntity(entityName: string, options?: any): Promise<any>;
    getEntityGraph(centerEntity: string, depth: number): Promise<any>;
    refreshEntityData(entityName: string): Promise<any>;
}

export interface EntityCacheServices {
    getEntity(entityName: string): Promise<any>;
    getCacheStats(): Promise<any>;
    clearAll(): Promise<void>;
}

// Default implementations using the existing ChromeExtensionService
export class DefaultAnalyticsServices implements AnalyticsServices {
    constructor(private chromeService: ChromeExtensionService) {}

    async loadAnalyticsData(): Promise<any> {
        return this.chromeService.getAnalyticsData({
            timeRange: "30d",
            includeQuality: true,
            includeProgress: true,
            topDomainsLimit: 10,
            activityGranularity: "day" as "day",
        });
    }
}

export class DefaultSearchServices implements SearchServices {
    constructor(private chromeService: ChromeExtensionService) {}

    async performSearch(query: string, filters?: any): Promise<SearchResult> {
        console.log(
            "DefaultSearchServices: Starting search for:",
            query,
            "with filters:",
            filters,
        );

        const searchFilters: SearchFilters = {
            domain: filters?.domain,
            sourceType: filters?.sourceType,
            dateFrom: filters?.dateFrom,
            dateTo: filters?.dateTo,
        };

        try {
            console.log(
                "DefaultSearchServices: Calling chromeService.searchWebMemories...",
            );
            const result = await this.chromeService.searchWebMemories(
                query,
                searchFilters,
            );
            console.log(
                "DefaultSearchServices: Raw result from chromeService:",
                result,
            );

            // The chromeService returns the full SearchResult, but we need to ensure structure
            if (result && typeof result === "object") {
                const searchResult = {
                    websites: result.websites || [],
                    summary: result.summary || {
                        text: "",
                        totalFound: 0,
                        searchTime: 0,
                        sources: [],
                        entities: [],
                    },
                    query: query,
                    filters: searchFilters,
                    topTopics: result.topTopics || [],
                    suggestedFollowups: result.suggestedFollowups || [],
                    relatedEntities: result.relatedEntities || [],
                    answerEnhancement: result.answerEnhancement, // FIXED: Include answer enhancement data
                };
                console.log(
                    "DefaultSearchServices: Formatted result:",
                    searchResult,
                );
                console.log(
                    "DefaultSearchServices: Answer enhancement included:",
                    !!searchResult.answerEnhancement,
                );
                return searchResult;
            } else {
                console.warn(
                    "DefaultSearchServices: Unexpected response format, using fallback",
                );
                // Fallback for unexpected response format
                return {
                    websites: [],
                    summary: {
                        text: "",
                        totalFound: 0,
                        searchTime: 0,
                        sources: [],
                        entities: [],
                    },
                    query: query,
                    filters: searchFilters,
                    topTopics: [],
                    suggestedFollowups: [],
                    relatedEntities: [],
                };
            }
        } catch (error) {
            console.error(
                "DefaultSearchServices: Search service error:",
                error,
            );
            throw error; // Re-throw so the panel can handle the error
        }
    }
}

export class DefaultDiscoveryServices implements DiscoveryServices {
    constructor(private chromeService: ChromeExtensionService) {}

    async loadDiscoverData(): Promise<any> {
        const response = await this.chromeService.getDiscoverInsights(
            10,
            "30d",
        );

        // Return the response in the expected format for the discovery panel
        if (response && response.success) {
            return {
                success: true,
                trendingTopics: response.trendingTopics || [],
                readingPatterns: response.readingPatterns || [],
                popularPages: response.popularPages || [],
                topDomains: response.topDomains || [],
            };
        } else {
            return {
                success: false,
                error: response?.error || "Failed to load discover data",
                trendingTopics: [],
                readingPatterns: [],
                popularPages: [],
                topDomains: [],
            };
        }
    }
}

// Default implementations for entity services (connected to real EntityProcessingService)
export class DefaultEntityGraphServices implements EntityGraphServices {
    private chromeService: ChromeExtensionService | null = null;

    constructor(chromeService?: ChromeExtensionService) {
        this.chromeService = chromeService || null;
    }

    async searchByEntity(entityName: string, options: any = {}): Promise<any> {
        try {
            console.log(
                "Searching for entity:",
                entityName,
                "with options:",
                options,
            );

            if (!this.chromeService) {
                console.warn(
                    "ChromeExtensionService not available, using empty result",
                );
                return {
                    entities: [],
                    centerEntity: entityName,
                    relationships: [],
                };
            }

            // Use fast entity-based search instead of slow text search
            const searchResult = await this.performEntitySearchWithFallback(
                entityName,
                options,
            );

            if (
                searchResult &&
                searchResult.websites &&
                searchResult.websites.length > 0
            ) {
                console.log(
                    `Found ${searchResult.websites.length} websites for entity search: ${entityName}`,
                );

                // Convert website search results to entity format with rich data
                const entities = searchResult.websites
                    .map((website: any, index: number) => {
                        return this.extractRichEntityData(entityName, website, index);
                    })
                    .filter((entity:any) => entity.name && entity.name.trim())
                    .slice(0, options.maxResults || 10);

                // If we have related entities from the search result, include them
                let additionalEntities: any[] = [];
                if (
                    searchResult.relatedEntities &&
                    searchResult.relatedEntities.length > 0
                ) {
                    additionalEntities = searchResult.relatedEntities
                        .map((entity: any, index: number) => {
                            const entityName = (
                                typeof entity === "string"
                                    ? entity
                                    : entity.name || entity
                            ).trim();
                            return {
                                id: `related_${index}`,
                                name: entityName || `Related ${index + 1}`,
                                type: "concept",
                                confidence: 0.7,
                                source: "search_related",
                            };
                        })
                        .filter((entity:any) => entity.name && entity.name.trim());
                }

                return {
                    entities: [...entities, ...additionalEntities.slice(0, 5)],
                    centerEntity: entityName,
                    relationships: this.generateBasicRelationships(
                        entities,
                        entityName,
                    ),
                    totalFound: searchResult.websites.length,
                    searchTime: searchResult.summary?.searchTime || 0,
                    topTopics: searchResult.topTopics || [],
                    summary: searchResult.summary || null,
                    metadata: searchResult.metadata || {},
                    relatedEntities: searchResult.relatedEntities || [],
                    answerSources: searchResult.answerSources || []
                };
            }

            console.log(`No websites found for entity: ${entityName}`);
            return {
                entities: [],
                centerEntity: entityName,
                relationships: [],
                totalFound: 0,
                topTopics: [],
                summary: null,
                metadata: {},
                relatedEntities: [],
                answerSources: []
            };
        } catch (error) {
            console.error("Entity search failed:", error);
            return {
                entities: [],
                centerEntity: entityName,
                relationships: [],
                error: error instanceof Error ? error.message : "Search failed",
                topTopics: [],
                summary: null,
                metadata: {},
                relatedEntities: [],
                answerSources: []
            };
        }
    }

    async getEntityGraph(centerEntity: string, depth: number): Promise<any> {
        try {
            console.log(
                "Getting entity graph for:",
                centerEntity,
                "depth:",
                depth,
            );

            if (!this.chromeService) {
                console.warn(
                    "ChromeExtensionService not available, using empty result",
                );
                return { centerEntity, entities: [], relationships: [] };
            }

            // Use fast entity-based search instead of slow text search
            const primarySearch = await this.performEntitySearchWithFallback(
                centerEntity,
                { maxResults: 15 },
            );

            if (
                !primarySearch ||
                !primarySearch.websites ||
                primarySearch.websites.length === 0
            ) {
                console.log(`No data found for center entity: ${centerEntity}`);
                return { centerEntity, entities: [], relationships: [] };
            }

            console.log(
                `Found ${primarySearch.websites.length} websites for center entity`,
            );

            // Create entities from primary search results with rich data
            const primaryEntities = primarySearch.websites
                .map((website: any, index: number) => {
                    const richEntity = this.extractRichEntityData(centerEntity, website, index);
                    // Override ID and category for primary entities
                    return {
                        ...richEntity,
                        id: `primary_${index}`,
                        category: "primary",
                    };
                })
                .filter((entity:any) => entity.name && entity.name.trim())
                .slice(0, 15);

            // Add the center entity itself with aggregated rich data
            const centerEntityNode = this.createRichCenterEntity(
                centerEntity,
                primaryEntities,
            );

            // If depth > 1, perform related searches
            let relatedEntities: any[] = [];
            if (
                depth > 1 &&
                primarySearch.relatedEntities &&
                primarySearch.relatedEntities.length > 0
            ) {
                console.log("Expanding graph with related entities...");

                // Take top related entities and search for them
                const topRelated = primarySearch.relatedEntities.slice(0, 3);

                for (const related of topRelated) {
                    try {
                        const relatedName =
                            typeof related === "string"
                                ? related
                                : related.name;
                        const relatedSearch =
                            await this.performEntitySearchWithFallback(
                                relatedName,
                                { maxResults: 3 },
                            );
                        if (relatedSearch?.websites?.length > 0) {
                            const relatedEntityData = relatedSearch.websites
                                .slice(0, 3)
                                .map((website: any, index: number) => {
                                    const richEntity = this.extractRichEntityData(relatedName, website, index);
                                    // Override properties for related entities
                                    return {
                                        ...richEntity,
                                        id: `related_${relatedName.replace(/\s+/g, "_")}_${index}`,
                                        category: "related",
                                        parentEntity: relatedName,
                                        confidence: Math.min(richEntity.confidence, 0.8), // Cap confidence for related entities
                                    };
                                })
                                .filter(
                                    (entity:any) =>
                                        entity.name && entity.name.trim(),
                                );
                            relatedEntities.push(...relatedEntityData);
                        }
                    } catch (error) {
                        console.warn(
                            `Failed to search for related entity ${related}:`,
                            error,
                        );
                    }
                }
            }

            // Combine all entities
            const allEntities = [
                centerEntityNode,
                ...primaryEntities,
                ...relatedEntities,
            ];

            // Generate relationships
            const relationships = this.generateAdvancedRelationships(
                allEntities,
                centerEntity,
            );

            console.log(
                `Generated entity graph: ${allEntities.length} entities, ${relationships.length} relationships`,
            );

            return {
                centerEntity,
                entities: allEntities,
                relationships: relationships,
                metadata: {
                    searchDepth: depth,
                    totalSources: primarySearch.websites.length,
                    hasRelatedExpansion: relatedEntities.length > 0,
                    generatedAt: new Date().toISOString(),
                    ...primarySearch.metadata
                },
                topTopics: primarySearch.topTopics || [],
                summary: primarySearch.summary || null,
                answerSources: primarySearch.answerSources || [],
                relatedEntities: primarySearch.relatedEntities || []
            };
        } catch (error) {
            console.error("Entity graph retrieval failed:", error);
            return {
                centerEntity,
                entities: [],
                relationships: [],
                error:
                    error instanceof Error
                        ? error.message
                        : "Graph generation failed",
            };
        }
    }

    async refreshEntityData(entityName: string): Promise<any> {
        console.log("Refreshing entity data for:", entityName);

        // For now, just trigger a fresh search
        const refreshedData = await this.searchByEntity(entityName, {
            maxResults: 5,
        });

        return refreshedData.entities.length > 0 ? refreshedData : null;
    }

    /**
     * Smart entity search with fallback strategy
     * Uses entity search first, then topic search, then hybrid search, then text search
     */
    private async performEntitySearchWithFallback(
        entityName: string,
        options: any = {},
    ): Promise<any> {
        if (!this.chromeService) {
            throw new Error("ChromeExtensionService not available");
        }

        const startTime = performance.now();
        const maxResults = options.maxResults || 10;
        let searchResult: any = null;
        let searchMethod = "unknown";

        try {
            // Strategy 1: Direct entity search (fastest)
            console.log(`Trying entity search for: ${entityName}`);
            const entityResults = await this.chromeService.searchByEntities(
                [entityName],
                "",
                maxResults,
            );

            if (entityResults && entityResults.websites && entityResults.websites.length > 0) {
                searchResult = {
                    websites: entityResults.websites,
                    relatedEntities: entityResults.relatedEntities || [],
                    topTopics: entityResults.topTopics || [],
                    summary: entityResults.summary || null,
                    metadata: entityResults.metadata || {},
                    answerSources: entityResults.answerSources || []
                };
                searchMethod = "entity";
                console.log(
                    `✅ Entity search found ${entityResults.websites.length} results for: ${entityName}`,
                    `Related entities: ${entityResults.relatedEntities?.length || 0}`,
                    `Top topics: ${entityResults.topTopics?.length || 0}`
                );
            }
        } catch (error) {
            console.warn(`Entity search failed for ${entityName}:`, error);
        }

        // Strategy 2: Topic search if entity search fails or returns few results
        if (!searchResult || searchResult.websites.length < 3) {
            try {
                console.log(`Trying topic search for: ${entityName}`);
                const topicResults = await this.chromeService.searchByTopics(
                    [entityName],
                    "",
                    maxResults,
                );

                if (topicResults && topicResults.websites && topicResults.websites.length > 0) {
                    // Merge with existing results or use as primary
                    const existingWebsites = searchResult?.websites || [];
                    const existingRelatedEntities = searchResult?.relatedEntities || [];
                    const existingTopTopics = searchResult?.topTopics || [];
                    
                    searchResult = {
                        websites: [...existingWebsites, ...topicResults.websites].slice(0, maxResults),
                        relatedEntities: [...existingRelatedEntities, ...(topicResults.relatedEntities || [])],
                        topTopics: [...existingTopTopics, ...(topicResults.topTopics || [])],
                        summary: topicResults.summary || searchResult?.summary || null,
                        metadata: { ...searchResult?.metadata, ...topicResults.metadata },
                        answerSources: [...(searchResult?.answerSources || []), ...(topicResults.answerSources || [])]
                    };
                    searchMethod = searchResult.websites.length > existingWebsites.length 
                        ? "topic" : searchMethod;
                    console.log(
                        `✅ Topic search found ${topicResults.websites.length} additional results for: ${entityName}`,
                        `Added related entities: ${topicResults.relatedEntities?.length || 0}`,
                        `Added topics: ${topicResults.topTopics?.length || 0}`
                    );
                }
            } catch (error) {
                console.warn(`Topic search failed for ${entityName}:`, error);
            }
        }

        // Strategy 3: Hybrid search if still no good results
        if (!searchResult || searchResult.websites.length < 2) {
            try {
                console.log(`Trying hybrid search for: ${entityName}`);
                const hybridResults = await this.chromeService.hybridSearch(
                    entityName,
                    "",
                    maxResults,
                );

                if (hybridResults && hybridResults.websites && hybridResults.websites.length > 0) {
                    const existingWebsites = searchResult?.websites || [];
                    const existingRelatedEntities = searchResult?.relatedEntities || [];
                    const existingTopTopics = searchResult?.topTopics || [];
                    
                    searchResult = {
                        websites: [...existingWebsites, ...hybridResults.websites].slice(0, maxResults),
                        relatedEntities: [...existingRelatedEntities, ...(hybridResults.relatedEntities || [])],
                        topTopics: [...existingTopTopics, ...(hybridResults.topTopics || [])],
                        summary: hybridResults.summary || searchResult?.summary || null,
                        metadata: { ...searchResult?.metadata, ...hybridResults.metadata },
                        answerSources: [...(searchResult?.answerSources || []), ...(hybridResults.answerSources || [])]
                    };
                    searchMethod = searchResult.websites.length > existingWebsites.length 
                        ? "hybrid" : searchMethod;
                    console.log(
                        `✅ Hybrid search found ${hybridResults.websites.length} additional results for: ${entityName}`,
                        `Added related entities: ${hybridResults.relatedEntities?.length || 0}`,
                        `Added topics: ${hybridResults.topTopics?.length || 0}`
                    );
                }
            } catch (error) {
                console.warn(`Hybrid search failed for ${entityName}:`, error);
            }
        }

        // Strategy 4: Text search fallback (original slow method)
        if (!searchResult || searchResult.websites.length === 0) {
            try {
                console.log(
                    `Falling back to text search for: ${entityName}`,
                );
                searchResult = await this.chromeService.searchWebMemories(
                    entityName,
                    {},
                );
                searchMethod = "text_fallback";
                console.log(
                    `⚠️ Text fallback found ${searchResult?.websites?.length || 0} results for: ${entityName}`,
                );
            } catch (error) {
                console.error(`All search methods failed for ${entityName}:`, error);
                searchResult = { websites: [] };
                searchMethod = "failed";
            }
        }

        // Add metadata about which search method was used
        const endTime = performance.now();
        const searchTime = Math.round(endTime - startTime);
        
        if (searchResult) {
            searchResult.searchMethod = searchMethod;
            searchResult.searchTerm = entityName;
            searchResult.searchTimeMs = searchTime;
            
            console.log(
                `🚀 Entity search completed in ${searchTime}ms using ${searchMethod} method for: ${entityName} (${searchResult.websites?.length || 0} results)`,
            );
        }

        return searchResult;
    }

    /**
     * Extract rich entity data from website knowledge
     */
    private extractRichEntityData(
        entityName: string,
        website: any,
        index: number,
    ): any {
        const url = website.url || "";
        const title =
            website.title ||
            website.description ||
            (url ? this.extractDomain(url) : `Entity ${index + 1}`);
        const domain = url ? this.extractDomain(url) : "unknown";

        // Basic entity structure
        const baseEntity = {
            id: `entity_${index}`,
            name: title.slice(0, 50).trim() || `Entity ${index + 1}`,
            type: this.inferEntityType(title, url),
            confidence: this.calculateConfidence(website),
            url: url,
            description: website.description || "",
            domain: domain,
            visitCount: website.visitCount || 0,
            lastVisited: website.lastVisited || website.lastVisit,
            source: website.sourceType || "website",
        };

        // Extract rich data from website knowledge if available
        const knowledge = website.getKnowledge ? website.getKnowledge() : null;
        if (knowledge) {
            return this.enhanceEntityWithKnowledge(baseEntity, knowledge, entityName);
        }

        return baseEntity;
    }

    /**
     * Enhance entity with rich knowledge data
     */
    private enhanceEntityWithKnowledge(
        baseEntity: any,
        knowledge: any,
        searchEntityName: string,
    ): any {
        const enhancedEntity = { ...baseEntity };

        // Add mention count
        enhancedEntity.mentionCount = this.countEntityMentions(
            knowledge,
            searchEntityName,
        );

        // Add aliases from extracted entities
        const matchingEntity = knowledge.entities?.find(
            (e: any) => 
                e.name.toLowerCase().includes(searchEntityName.toLowerCase()) ||
                searchEntityName.toLowerCase().includes(e.name.toLowerCase())
        );
        
        if (matchingEntity) {
            enhancedEntity.aliases = matchingEntity.aliases || [];
            enhancedEntity.entityType = matchingEntity.type || enhancedEntity.type;
            enhancedEntity.confidence = Math.max(
                enhancedEntity.confidence,
                matchingEntity.confidence || 0
            );
        }

        // Add topic affinity
        enhancedEntity.topicAffinity = knowledge.topics?.map((t: any) => 
            typeof t === 'string' ? t : (t.name || t.topic || t)
        ).slice(0, 5) || [];

        // Add context snippets from text chunks
        if (knowledge.textChunks || knowledge.content) {
            const textContent = knowledge.textChunks || [knowledge.content];
            enhancedEntity.contextSnippets = this.extractContextSnippets(
                textContent,
                searchEntityName,
                3
            );
        }

        // Add relationships from knowledge
        enhancedEntity.relationships = this.extractRelationships(
            knowledge,
            searchEntityName,
        );

        // Add temporal data
        enhancedEntity.firstSeen = knowledge.extractionDate || 
            knowledge.visitDate || 
            baseEntity.lastVisited ||
            new Date().toISOString();
        enhancedEntity.lastSeen = knowledge.lastUpdated || 
            knowledge.visitDate || 
            baseEntity.lastVisited ||
            new Date().toISOString();

        // Add dominant domains
        enhancedEntity.dominantDomains = [baseEntity.domain];

        return enhancedEntity;
    }

    /**
     * Count entity mentions in knowledge content
     */
    private countEntityMentions(knowledge: any, entityName: string): number {
        if (!knowledge || !entityName) return 0;

        let count = 0;
        const searchTerm = entityName.toLowerCase();

        // Count in text content
        if (knowledge.content) {
            const matches = knowledge.content.toLowerCase().split(searchTerm);
            count += Math.max(0, matches.length - 1);
        }

        // Count in text chunks
        if (knowledge.textChunks && Array.isArray(knowledge.textChunks)) {
            knowledge.textChunks.forEach((chunk: string) => {
                if (typeof chunk === 'string') {
                    const matches = chunk.toLowerCase().split(searchTerm);
                    count += Math.max(0, matches.length - 1);
                }
            });
        }

        // Count in extracted entities
        if (knowledge.entities && Array.isArray(knowledge.entities)) {
            knowledge.entities.forEach((entity: any) => {
                if (entity.name && entity.name.toLowerCase().includes(searchTerm)) {
                    count += entity.mentionCount || 1;
                }
            });
        }

        return Math.max(1, count); // Ensure at least 1 mention
    }

    /**
     * Extract context snippets containing the entity
     */
    private extractContextSnippets(
        textChunks: string[],
        entityName: string,
        maxSnippets: number,
    ): string[] {
        if (!textChunks || !entityName) return [];

        const snippets: string[] = [];
        const searchTerm = entityName.toLowerCase();
        const snippetLength = 150;

        for (const chunk of textChunks) {
            if (!chunk || typeof chunk !== 'string') continue;

            const lowerChunk = chunk.toLowerCase();
            const index = lowerChunk.indexOf(searchTerm);
            
            if (index !== -1 && snippets.length < maxSnippets) {
                // Extract context around the entity mention
                const start = Math.max(0, index - 50);
                const end = Math.min(chunk.length, index + searchTerm.length + 100);
                let snippet = chunk.slice(start, end).trim();
                
                // Clean up snippet
                if (start > 0) snippet = '...' + snippet;
                if (end < chunk.length) snippet = snippet + '...';
                
                // Avoid duplicate snippets
                if (!snippets.some(s => s.includes(snippet.slice(10, -10)))) {
                    snippets.push(snippet);
                }
            }
        }

        return snippets;
    }

    /**
     * Extract entity relationships from knowledge
     */
    private extractRelationships(knowledge: any, entityName: string): any[] {
        if (!knowledge) return [];

        const relationships: any[] = [];
        const searchTerm = entityName.toLowerCase();

        // Extract from entities that appear together
        if (knowledge.entities && Array.isArray(knowledge.entities)) {
            knowledge.entities.forEach((entity: any) => {
                if (entity.name && 
                    !entity.name.toLowerCase().includes(searchTerm) &&
                    entity.confidence > 0.5) {
                    
                    relationships.push({
                        relatedEntity: entity.name,
                        relationshipType: "co_occurs_with",
                        confidence: entity.confidence,
                        strength: entity.confidence * 0.8,
                        evidenceSources: [knowledge.url || "content"],
                        firstObserved: knowledge.extractionDate || new Date().toISOString(),
                        lastObserved: knowledge.lastUpdated || new Date().toISOString(),
                    });
                }
            });
        }

        // Extract from topics (entity-topic relationships)
        if (knowledge.topics && Array.isArray(knowledge.topics)) {
            knowledge.topics.slice(0, 3).forEach((topic: any) => {
                const topicName = typeof topic === 'string' ? topic : (topic.name || topic.topic);
                if (topicName) {
                    relationships.push({
                        relatedEntity: topicName,
                        relationshipType: "related_to_topic",
                        confidence: typeof topic === 'object' ? (topic.relevance || 0.7) : 0.7,
                        strength: 0.6,
                        evidenceSources: [knowledge.url || "content"],
                        firstObserved: knowledge.extractionDate || new Date().toISOString(),
                        lastObserved: knowledge.lastUpdated || new Date().toISOString(),
                    });
                }
            });
        }

        return relationships.slice(0, 5); // Limit to top 5 relationships
    }

    /**
     * Create rich center entity by aggregating data from primary entities
     */
    private createRichCenterEntity(
        centerEntityName: string,
        primaryEntities: any[],
    ): any {
        // Aggregate data from primary entities
        let totalMentions = 0;
        let totalVisitCount = 0;
        const allDomains = new Set<string>();
        const allTopics = new Set<string>();
        const allAliases = new Set<string>();
        const allRelationships: any[] = [];
        const allContextSnippets: string[] = [];
        let earliestSeen: string | null = null;
        let latestSeen: string | null = null;
        let maxConfidence = 0;

        // Aggregate from primary entities
        primaryEntities.forEach((entity) => {
            totalMentions += entity.mentionCount || 0;
            totalVisitCount += entity.visitCount || 0;
            maxConfidence = Math.max(maxConfidence, entity.confidence || 0);

            if (entity.domain) allDomains.add(entity.domain);
            
            if (entity.topicAffinity) {
                entity.topicAffinity.forEach((topic: string) => allTopics.add(topic));
            }
            
            if (entity.aliases) {
                entity.aliases.forEach((alias: string) => allAliases.add(alias));
            }
            
            if (entity.relationships) {
                allRelationships.push(...entity.relationships);
            }
            
            if (entity.contextSnippets) {
                allContextSnippets.push(...entity.contextSnippets.slice(0, 2));
            }

            // Track temporal bounds
            if (entity.firstSeen) {
                if (!earliestSeen || entity.firstSeen < earliestSeen) {
                    earliestSeen = entity.firstSeen;
                }
            }
            
            if (entity.lastSeen) {
                if (!latestSeen || entity.lastSeen > latestSeen) {
                    latestSeen = entity.lastSeen;
                }
            }
        });

        // Deduplicate and limit collections
        const uniqueRelationships = this.deduplicateRelationships(allRelationships);
        const uniqueContextSnippets = [...new Set(allContextSnippets)].slice(0, 5);

        return {
            id: "center",
            name: centerEntityName.trim() || "Unknown Entity",
            type: this.inferEntityType(centerEntityName),
            confidence: Math.min(0.95, maxConfidence + 0.1), // Boost center entity confidence
            category: "center",
            description: `Center entity: ${centerEntityName}`,
            
            // Aggregated rich data
            mentionCount: Math.max(1, totalMentions),
            visitCount: totalVisitCount,
            dominantDomains: Array.from(allDomains).slice(0, 5),
            topicAffinity: Array.from(allTopics).slice(0, 10),
            aliases: Array.from(allAliases).slice(0, 5),
            relationships: uniqueRelationships.slice(0, 10),
            contextSnippets: uniqueContextSnippets,
            firstSeen: earliestSeen || new Date().toISOString(),
            lastSeen: latestSeen || new Date().toISOString(),
            
            // Center entity specific metadata
            primarySourceCount: primaryEntities.length,
            aggregatedFromSources: primaryEntities.map(e => e.url).filter(Boolean),
        };
    }

    /**
     * Deduplicate relationships by entity name and type
     */
    private deduplicateRelationships(relationships: any[]): any[] {
        const seen = new Map<string, any>();
        
        relationships.forEach((rel) => {
            const key = `${rel.relatedEntity}:${rel.relationshipType}`;
            const existing = seen.get(key);
            
            if (!existing || rel.confidence > existing.confidence) {
                seen.set(key, rel);
            }
        });
        
        return Array.from(seen.values())
            .sort((a, b) => b.confidence - a.confidence);
    }

    private extractDomain(url: string): string {
        try {
            if (!url || typeof url !== "string") return "unknown";

            // Handle URLs that might not have protocol
            let normalizedUrl = url;
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                normalizedUrl = "https://" + url;
            }

            return new URL(normalizedUrl).hostname.replace("www.", "");
        } catch {
            // If URL parsing fails, try to extract domain manually
            const match = url.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            return match ? match[1].replace("www.", "") : "unknown";
        }
    }

    private calculateConfidence(website: any): number {
        let confidence = 0.5;

        // Boost confidence for well-structured data
        if (website.title) confidence += 0.2;
        if (website.description) confidence += 0.1;
        if (website.visitCount && website.visitCount > 1) confidence += 0.1;
        if (website.lastVisit) confidence += 0.1;

        return Math.min(0.95, confidence);
    }

    private generateBasicRelationships(
        entities: any[],
        centerEntity: string,
    ): any[] {
        if (!centerEntity || !entities || entities.length === 0) {
            return [];
        }

        return entities
            .filter((entity) => entity.name && entity.name.trim())
            .map((entity) => ({
                id: `rel_${entity.id || entity.name.replace(/\s+/g, "_")}`,
                from: entity.name.trim(),
                to: centerEntity.trim(),
                type: "mentioned_in",
                strength: entity.confidence * 0.8,
                source: entity.url || "search",
                direction: "unidirectional",
            }));
    }

    private generateAdvancedRelationships(
        entities: any[],
        centerEntity: string,
    ): any[] {
        const relationships: any[] = [];

        if (!centerEntity || !entities || entities.length === 0) {
            return relationships;
        }

        const validCenterEntity = centerEntity.trim();

        // Center entity relationships
        entities
            .filter((e) => e.category === "primary" && e.name && e.name.trim())
            .forEach((entity) => {
                const entityName = entity.name.trim();
                relationships.push({
                    id: `rel_center_${entity.id || entityName.replace(/\s+/g, "_")}`,
                    from: validCenterEntity,
                    to: entityName,
                    type: "contains",
                    strength: entity.confidence,
                    source: entity.url,
                    direction: "unidirectional",
                    category: "primary",
                });
            });

        // Related entity relationships
        entities
            .filter((e) => e.category === "related" && e.name && e.name.trim())
            .forEach((entity) => {
                const entityName = entity.name.trim();
                const parentEntity = (
                    entity.parentEntity || validCenterEntity
                ).trim();

                relationships.push({
                    id: `rel_related_${entity.id || entityName.replace(/\s+/g, "_")}`,
                    from: parentEntity,
                    to: entityName,
                    type: "related_to",
                    strength: entity.confidence * 0.7,
                    source: entity.url,
                    direction: "bidirectional",
                    category: "related",
                });
            });

        // Domain-based relationships (entities from same domain)
        const domainGroups = new Map<string, any[]>();
        entities
            .filter(
                (e) =>
                    e.domain &&
                    e.domain !== "unknown" &&
                    e.name &&
                    e.name.trim(),
            )
            .forEach((entity) => {
                if (!domainGroups.has(entity.domain)) {
                    domainGroups.set(entity.domain, []);
                }
                domainGroups.get(entity.domain)!.push(entity);
            });

        // Create relationships between entities from the same domain
        domainGroups.forEach((domainEntities, domain) => {
            if (domainEntities.length > 1) {
                for (let i = 0; i < domainEntities.length - 1; i++) {
                    for (let j = i + 1; j < domainEntities.length; j++) {
                        const entity1 = domainEntities[i];
                        const entity2 = domainEntities[j];

                        if (
                            entity1.name &&
                            entity2.name &&
                            entity1.name.trim() &&
                            entity2.name.trim() &&
                            entity1.name.trim() !== entity2.name.trim()
                        ) {
                            relationships.push({
                                id: `rel_domain_${i}_${j}_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`,
                                from: entity1.name.trim(),
                                to: entity2.name.trim(),
                                type: "same_domain",
                                strength: 0.6,
                                source: domain,
                                direction: "bidirectional",
                                category: "domain",
                            });
                        }
                    }
                }
            }
        });

        return relationships;
    }

    private inferEntityType(text: string, url?: string): string {
        const lowerText = text.toLowerCase();

        // URL-based detection first
        if (url) {
            const domain = this.extractDomain(url);

            // Technology/development sites
            if (
                [
                    "github.com",
                    "stackoverflow.com",
                    "npm.org",
                    "docs.microsoft.com",
                ].includes(domain)
            ) {
                return "technology";
            }

            // Social media / person indicators
            if (
                ["linkedin.com", "twitter.com", "github.com"].includes(
                    domain,
                ) &&
                lowerText.includes("profile")
            ) {
                return "person";
            }

            // News/blog sites usually contain concepts
            if (
                ["medium.com", "dev.to", "blog", "news"].some((term) =>
                    domain.includes(term),
                )
            ) {
                return "concept";
            }
        }

        // Content-based detection
        // Website/domain detection
        if (
            lowerText.includes(".com") ||
            lowerText.includes(".org") ||
            lowerText.includes("http")
        ) {
            return "website";
        }

        // Organization detection
        if (
            lowerText.includes("corp") ||
            lowerText.includes("inc") ||
            lowerText.includes("company") ||
            lowerText.includes("ltd")
        ) {
            return "organization";
        }

        // Technology detection
        if (
            lowerText.includes("api") ||
            lowerText.includes("framework") ||
            lowerText.includes("library") ||
            lowerText.includes("javascript") ||
            lowerText.includes("typescript") ||
            lowerText.includes("react") ||
            lowerText.includes("node") ||
            lowerText.includes("python") ||
            lowerText.includes("github")
        ) {
            return "technology";
        }

        // Product detection
        if (
            lowerText.includes("app") ||
            lowerText.includes("tool") ||
            lowerText.includes("platform") ||
            lowerText.includes("service") ||
            lowerText.includes("software")
        ) {
            return "product";
        }

        // Person detection (basic heuristics)
        if (
            lowerText.split(" ").length === 2 &&
            /^[A-Z][a-z]+ [A-Z][a-z]+/.test(text)
        ) {
            return "person";
        }

        // Default to concept for general content
        return "concept";
    }
}

export class DefaultEntityCacheServices implements EntityCacheServices {
    async getEntity(entityName: string): Promise<any> {
        // This would get from real entity cache
        console.log("Getting cached entity:", entityName);
        return null;
    }

    async getCacheStats(): Promise<any> {
        // This would return real cache stats
        return {
            entityCount: 0,
            relationshipCount: 0,
            cacheSize: 0,
            hitRate: 0,
        };
    }

    async clearAll(): Promise<void> {
        // This would clear real cache
        console.log("Clearing entity cache");
    }
}
