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

            // Use the Chrome extension service to search for entities in website collection
            const searchResult = await this.chromeService.searchWebMemories(
                entityName,
                {},
            );

            if (
                searchResult &&
                searchResult.websites &&
                searchResult.websites.length > 0
            ) {
                console.log(
                    `Found ${searchResult.websites.length} websites for entity search: ${entityName}`,
                );

                // Convert website search results to entity format
                const entities = searchResult.websites
                    .map((website: any, index: number) => {
                        const url = website.url || "";
                        const title =
                            website.title ||
                            website.description ||
                            new URL(url).hostname ||
                            `Entity ${index + 1}`;
                        const domain = url
                            ? this.extractDomain(url)
                            : "unknown";

                        return {
                            id: `entity_${index}`,
                            name:
                                title.slice(0, 50).trim() ||
                                `Entity ${index + 1}`, // Ensure non-empty name
                            type: this.inferEntityType(title, url),
                            confidence: this.calculateConfidence(website),
                            url: url,
                            description: website.description || "",
                            domain: domain,
                            visitCount: website.visitCount || 0,
                            lastVisited: website.lastVisit,
                            source: website.sourceType || "website",
                        };
                    })
                    .filter((entity) => entity.name && entity.name.trim())
                    .slice(0, options.maxResults || 10); // Filter out entities with empty names

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
                        .filter((entity) => entity.name && entity.name.trim());
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
                };
            }

            console.log(`No websites found for entity: ${entityName}`);
            return {
                entities: [],
                centerEntity: entityName,
                relationships: [],
                totalFound: 0,
            };
        } catch (error) {
            console.error("Entity search failed:", error);
            return {
                entities: [],
                centerEntity: entityName,
                relationships: [],
                error: error instanceof Error ? error.message : "Search failed",
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

            // Search for the center entity and related content
            const primarySearch = await this.chromeService.searchWebMemories(
                centerEntity,
                {},
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

            // Create entities from primary search results
            const primaryEntities = primarySearch.websites
                .map((website: any, index: number) => {
                    const url = website.url || "";
                    const title =
                        website.title ||
                        website.description ||
                        new URL(url).hostname ||
                        `Website ${index + 1}`;
                    const domain = this.extractDomain(url);

                    return {
                        id: `primary_${index}`,
                        name:
                            title.slice(0, 60).trim() || `Entity ${index + 1}`,
                        type: this.inferEntityType(title, url),
                        confidence: this.calculateConfidence(website),
                        url: url,
                        description: website.description || "",
                        domain: domain,
                        category: "primary",
                        visitCount: website.visitCount || 0,
                        lastVisited: website.lastVisit,
                    };
                })
                .filter((entity) => entity.name && entity.name.trim())
                .slice(0, 15); // Filter out entities with empty names

            // Add the center entity itself
            const centerEntityNode = {
                id: "center",
                name: centerEntity.trim() || "Unknown Entity",
                type: this.inferEntityType(centerEntity),
                confidence: 0.95,
                category: "center",
                description: `Center entity: ${centerEntity}`,
            };

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
                            await this.chromeService.searchWebMemories(
                                relatedName,
                                {},
                            );
                        if (relatedSearch?.websites?.length > 0) {
                            const relatedEntityData = relatedSearch.websites
                                .slice(0, 3)
                                .map((website: any, index: number) => {
                                    const websiteTitle =
                                        website.title ||
                                        website.url ||
                                        `Related ${index + 1}`;
                                    return {
                                        id: `related_${relatedName.replace(/\s+/g, "_")}_${index}`,
                                        name:
                                            websiteTitle.slice(0, 50).trim() ||
                                            `Related Entity ${index + 1}`,
                                        type: this.inferEntityType(
                                            websiteTitle,
                                            website.url,
                                        ),
                                        confidence: 0.6,
                                        url: website.url,
                                        description: website.description || "",
                                        domain: this.extractDomain(website.url),
                                        category: "related",
                                        parentEntity: relatedName,
                                    };
                                })
                                .filter(
                                    (entity) =>
                                        entity.name && entity.name.trim(),
                                ); // Filter out entities with empty names
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
                },
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
