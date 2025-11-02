// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AnswerEnhancement } from "../../agent/search/schema/answerEnhancement.mjs";
import type {
    StoredMacro,
    MacroQueryOptions,
    DeleteMacroResult,
} from "./macroUtilities";
import type {
    ImportOptions,
    ImportResult,
    ProgressCallback,
} from "../interfaces/websiteImport.types";
import type {
    KnowledgeExtractionProgress,
    KnowledgeProgressCallback,
    KnowledgeExtractionResult,
} from "../interfaces/knowledgeExtraction.types";
import { url } from "inspector/promises";

// ===================================================================
// INTERFACE DEFINITIONS
// ===================================================================

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
    answerEnhancement?: AnswerEnhancement;
}

export interface TopicInsight {
    name: string;
    relevance: number;
    occurrences: number;
    type: "primary" | "secondary" | "related";
}

export interface EntityInsight {
    name: string;
    type: string;
    confidence: number;
    mentions: number;
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
    insights?: {
        topics: TopicInsight[];
        entities: EntityInsight[];
        relevanceScore: number;
    };
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

/**
 * Abstract base class for extension services
 */
export abstract class ExtensionServiceBase {
    // ===================================================================
    // CONNECTION STATUS EVENT SYSTEM
    // ===================================================================

    private connectionStatusCallbacks: ((connected: boolean) => void)[] = [];
    private connectionStatusListenerSetup = false;

    /**
     * Register a callback for connection status changes
     */
    public onConnectionStatusChange(
        callback: (connected: boolean) => void,
    ): void {
        this.connectionStatusCallbacks.push(callback);

        if (!this.connectionStatusListenerSetup) {
            this.setupConnectionStatusListener();
            this.connectionStatusListenerSetup = true;
        }
    }

    /**
     * Remove connection status callback
     */
    public removeConnectionStatusListener(
        callback: (connected: boolean) => void,
    ): void {
        const index = this.connectionStatusCallbacks.indexOf(callback);
        if (index > -1) {
            this.connectionStatusCallbacks.splice(index, 1);
        }
    }

    /**
     * Setup message listener for connection status changes
     */
    private setupConnectionStatusListener(): void {
        const messageListener = (
            message: any,
            sender: any,
            sendResponse: any,
        ) => {
            if (message.type === "connectionStatusChanged") {
                this.connectionStatusCallbacks.forEach((callback) => {
                    try {
                        callback(message.connected);
                    } catch (error) {
                        console.error(
                            "Connection status callback error:",
                            error,
                        );
                    }
                });
            }
        };

        try {
            chrome.runtime.onMessage.addListener(messageListener);
        } catch (error) {
            console.error("Failed to setup connection status listener:", error);
        }
    }

    // ===================================================================
    // SHARED METHOD IMPLEMENTATIONS
    // ===================================================================

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

        return this.transformSearchWebMemoriesResponse(response);
    }

    async getPageIndexStatus(url: string): Promise<any> {
        return this.sendMessage({
            type: "getPageIndexStatus",
            url,
        });
    }

    async indexPageContent(
        url: string,
        mode: string,
        extractedKnowledge?: any,
    ): Promise<any> {
        const message: any = {
            type: "indexPageContentDirect",
            url,
            mode,
        };

        if (extractedKnowledge) {
            message.extractedKnowledge = extractedKnowledge;
        }

        return this.sendMessage(message);
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

    async extractPageKnowledgeStreaming(
        url: string,
        mode: string,
        extractionSettings: any,
        streamingEnabled: boolean = true,
        extractionId: string,
        saveToIndex: boolean = false,
    ): Promise<any> {
        try {
            const response = await this.sendMessage({
                type: "extractPageKnowledgeStreaming",
                url,
                mode,
                extractionSettings,
                streamingEnabled,
                extractionId,
                saveToIndex,
            });

            if (!response) {
                return { extractionId, success: false };
            }

            return response;
        } catch (error) {
            return {
                extractionId,
                success: false,
                error: (error as Error).message || String(error),
            };
        }
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

    async indexExtractedKnowledge(
        url: string,
        title: string,
        extractedKnowledge: any,
        mode?: string,
        timestamp?: string,
    ): Promise<any> {
        return this.sendMessage({
            type: "indexExtractedKnowledge",
            url,
            title,
            extractedKnowledge,
            mode,
            timestamp,
        });
    }

    async generatePageQuestions(url: string, pageKnowledge: any): Promise<any> {
        return this.sendMessage({
            type: "generatePageQuestions",
            url,
            pageKnowledge,
        });
    }

    async generateGraphQuestions(
        url: string,
        relatedEntities: any[],
        relatedTopics: any[],
    ): Promise<any> {
        return this.sendMessage({
            type: "generateGraphQuestions",
            url,
            relatedEntities,
            relatedTopics,
        });
    }

    async discoverRelatedKnowledge(
        entities: any[],
        topics: string[],
        depth: number = 2,
    ): Promise<any> {
        return this.sendMessage({
            type: "discoverRelatedKnowledge",
            entities,
            topics,
            depth,
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
            type: "searchWebMemoriesAdvanced",
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

    async getKnowledgeGraphStatus(): Promise<any> {
        return this.sendMessage({
            type: "getKnowledgeGraphStatus",
        });
    }

    async buildKnowledgeGraph(options?: {
        minimalMode?: boolean;
        urlLimit?: number;
    }): Promise<any> {
        return this.sendMessage({
            type: "buildKnowledgeGraph",
            parameters: options || {},
        });
    }

    async rebuildKnowledgeGraph(): Promise<any> {
        return this.sendMessage({
            type: "rebuildKnowledgeGraph",
        });
    }

    async testMergeTopicHierarchies(): Promise<{
        mergeCount: number;
        changes?: Array<{
            action: string;
            sourceTopic: string;
            targetTopic?: string;
        }>;
    }> {
        return this.sendMessage({
            type: "testMergeTopicHierarchies",
        });
    }

    async mergeTopicHierarchies(): Promise<{
        success: boolean;
        mergeCount: number;
        message?: string;
        error?: string;
    }> {
        return this.sendMessage({
            type: "mergeTopicHierarchies",
        });
    }

    async getAllRelationships(): Promise<any[]> {
        const result = await this.sendMessage<{ relationships?: any[] }>({
            type: "getAllRelationships",
        });
        return result?.relationships || [];
    }

    async getAllCommunities(): Promise<any[]> {
        const result = await this.sendMessage<{ communities?: any[] }>({
            type: "getAllCommunities",
        });
        return result?.communities || [];
    }

    async getAllEntitiesWithMetrics(): Promise<any[]> {
        const result = await this.sendMessage<{ entities?: any[] }>({
            type: "getAllEntitiesWithMetrics",
        });
        return result?.entities || [];
    }

    async getEntityNeighborhood(
        entityId: string,
        depth: number,
        maxNodes: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "getEntityNeighborhood",
            entityId: entityId,
            depth: depth,
            maxNodes: maxNodes,
        });
    }

    async getGlobalImportanceLayer(
        maxNodes: number = 5000,
        includeConnectivity: boolean = true,
    ): Promise<any> {
        return this.sendMessage({
            type: "getGlobalImportanceLayer",
            maxNodes,
            includeConnectivity,
        });
    }

    async getViewportBasedNeighborhood(
        centerEntity: string,
        viewportNodeNames: string[],
        maxNodes: number = 5000,
        options: {
            importanceWeighting?: boolean;
            includeGlobalContext?: boolean;
            exploreFromAllViewportNodes?: boolean;
            minDepthFromViewport?: number;
        } = {},
    ): Promise<any> {
        const {
            importanceWeighting = true,
            includeGlobalContext = true,
            exploreFromAllViewportNodes = true,
            minDepthFromViewport = 1,
        } = options;

        return this.sendMessage({
            type: "getViewportBasedNeighborhood",
            centerEntity,
            viewportNodeNames,
            maxNodes,
            importanceWeighting,
            includeGlobalContext,
            exploreFromAllViewportNodes,
            minDepthFromViewport,
        });
    }

    async getImportanceStatistics(): Promise<any> {
        return this.sendMessage({
            type: "getImportanceStatistics",
        });
    }

    async getTopicImportanceLayer(
        maxNodes: number = 500,
        minImportanceThreshold: number = 0.0,
    ): Promise<any> {
        return this.sendMessage({
            type: "getTopicImportanceLayer",
            maxNodes,
            minImportanceThreshold,
        });
    }

    async getTopicViewportNeighborhood(
        centerTopic: string,
        viewportTopicIds: string[],
        maxNodes: number,
    ): Promise<any> {
        return this.sendMessage({
            type: "getTopicViewportNeighborhood",
            centerTopic,
            viewportTopicIds,
            maxNodes,
        });
    }

    async getTopicMetrics(topicId: string): Promise<any> {
        return this.sendMessage({
            type: "getTopicMetrics",
            parameters: { topicId },
        });
    }

    async getTopicDetails(topicId: string): Promise<any> {
        return this.sendMessage({
            type: "getTopicDetails",
            parameters: { topicId },
        });
    }

    async getEntityDetails(entityName: string): Promise<any> {
        return this.sendMessage({
            type: "getEntityDetails",
            parameters: { entityName },
        });
    }

    async getTopicTimelines(parameters: {
        topicNames: string[];
        maxTimelineEntries?: number;
        timeRange?: {
            startDate?: string;
            endDate?: string;
        };
        includeRelatedTopics?: boolean;
        neighborhoodDepth?: number;
    }): Promise<any> {
        return this.sendMessage({
            type: "getTopicTimelines",
            parameters,
        });
    }

    async notifyAutoIndexSettingChanged(enabled: boolean): Promise<void> {
        await this.sendMessage({
            type: "notifyAutoIndexSettingChanged",
            enabled,
        });
    }

    async getRecentKnowledgeItems(limit?: number): Promise<any> {
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
            type: "checkKnowledgeStatus",
            url,
        });
    }

    async getRecentSearches(): Promise<string[]> {
        const response = await this.sendMessage<{ searches?: string[] }>({
            type: "getRecentSearches",
        });
        return response?.searches || [];
    }

    async getDiscoverInsights(
        limit?: number,
        timeframe?: string,
    ): Promise<any> {
        return this.sendMessage({
            type: "getDiscoverInsights",
            limit,
            timeframe,
        });
    }

    async saveSearch(query: string, results: any): Promise<void> {
        await this.sendMessage({
            type: "saveSearch",
            query,
            results,
        });
    }

    async openOptionsPage(): Promise<void> {
        await this.sendMessage({
            type: "openOptionsPage",
        });
    }

    async createTab(url: string, active?: boolean): Promise<any> {
        return this.sendMessage({
            type: "createTab",
            url,
            active,
        });
    }

    async getViewHostUrl(): Promise<string | null> {
        const response = await this.sendMessage<{ url?: string }>({
            type: "getViewHostUrl",
        });
        return response?.url || null;
    }

    async importBrowserData(
        options: ImportOptions,
        importId: string,
    ): Promise<ImportResult> {
        return this.sendMessage({
            type: "importWebsiteDataWithProgress",
            parameters: {
                ...options, // TODO: remove "type" from this dictionary. That will remove the need to wrap these values in a "parameters" object
                importId,
                totalItems: 0,
                progressCallback: true,
            },
        });
    }

    async importHtmlFolder(
        folderPath: string,
        options: any,
        importId: string,
    ): Promise<any> {
        return this.sendMessage({
            type: "importHtmlFolder",
            ...options,
            folderPath,
            importId,
        });
    }

    async cancelImport(importId: string): Promise<void> {
        await this.sendMessage({
            type: "cancelImport",
            importId,
        });
    }

    onImportProgress(importId: string, callback: ProgressCallback): void {
        this.onImportProgressImpl(importId, callback);
    }

    onExtractionProgress(
        extractionId: string,
        callback: KnowledgeProgressCallback,
    ): void {
        this.onExtractionProgressImpl(extractionId, callback);
    }

    // Macro methods
    async getMacrosForUrl(
        url: string,
        options: MacroQueryOptions = {},
    ): Promise<StoredMacro[]> {
        const response = await this.sendMessage<{ actions?: StoredMacro[] }>({
            type: "getMacrosForUrl",
            url: url,
            includeGlobal: options.includeGlobal ?? true,
            author: options.author,
        });
        return response?.actions || [];
    }

    async getAllMacros(): Promise<StoredMacro[]> {
        const response = await this.sendMessage<{ actions?: StoredMacro[] }>({
            type: "getAllMacros",
        });
        return response?.actions || [];
    }

    async getMacroDomains(): Promise<string[]> {
        const response = await this.sendMessage<{ domains?: string[] }>({
            type: "getMacroDomains",
        });
        return response?.domains || [];
    }

    async deleteMacro(macroId: string): Promise<DeleteMacroResult> {
        const response = await this.sendMessage<{
            success?: boolean;
            error?: string;
        }>({
            type: "deleteMacro",
            macroId: macroId,
        });
        return {
            success: response?.success || false,
            error: response?.error,
            macroId: macroId,
        };
    }

    // ===================================================================
    // ABSTRACT METHODS - Must be implemented by concrete classes
    // ===================================================================

    /**
     * Send message using environment-specific transport
     * Concrete classes must implement this method
     */
    protected abstract sendMessage<T>(message: any): Promise<T>;

    /**
     * Environment-specific progress tracking implementation
     * Concrete classes must implement this method
     */
    protected abstract onImportProgressImpl(
        importId: string,
        callback: ProgressCallback,
    ): void;

    /**
     * Environment-specific knowledge extraction progress tracking
     * Concrete classes must implement this method
     */
    protected abstract onExtractionProgressImpl(
        extractionId: string,
        callback: KnowledgeProgressCallback,
    ): void;

    // ===================================================================
    // VIRTUAL METHODS - Can be overridden by concrete classes
    // ===================================================================

    /**
     * Get current tab - environment-specific implementation
     * Default implementation throws error
     */
    protected async getCurrentTabImpl(): Promise<any> {
        throw new Error("getCurrentTab not implemented for this environment");
    }

    /**
     * Get search suggestions - can use default (sendMessage) or custom implementation
     */
    protected async getSearchSuggestionsImpl(query: string): Promise<string[]> {
        const response = await this.sendMessage<{ suggestions?: string[] }>({
            type: "getSearchSuggestions",
            query,
        });
        return response?.suggestions || [];
    }

    /**
     * Check WebSocket connection - can use default (sendMessage) or custom implementation
     */
    protected async checkWebSocketConnectionImpl(): Promise<any> {
        return this.sendMessage({
            type: "checkWebSocketConnection",
        });
    }

    /**
     * Get auto index setting - can use default (sendMessage) or custom implementation
     */
    protected async getAutoIndexSettingImpl(): Promise<boolean> {
        const response = await this.sendMessage<{ enabled?: boolean }>({
            type: "getAutoIndexSetting",
        });
        return response?.enabled || false;
    }

    /**
     * Set auto index setting - can use default (sendMessage) or custom implementation
     */
    protected async setAutoIndexSettingImpl(enabled: boolean): Promise<void> {
        await this.sendMessage({
            type: "setAutoIndexSetting",
            enabled,
        });
    }

    /**
     * Get extraction settings - can use default (sendMessage) or custom implementation
     */
    protected async getExtractionSettingsImpl(): Promise<any> {
        return this.sendMessage({
            type: "getExtractionSettings",
        });
    }

    /**
     * Save extraction settings - can use default (sendMessage) or custom implementation
     */
    protected async saveExtractionSettingsImpl(settings: any): Promise<void> {
        await this.sendMessage({
            type: "saveExtractionSettings",
            settings,
        });
    }

    // ===================================================================
    // PUBLIC INTERFACE METHODS - Delegate to implementations
    // ===================================================================

    async getCurrentTab(): Promise<any> {
        return this.getCurrentTabImpl();
    }

    async getSearchSuggestions(query: string): Promise<string[]> {
        return this.getSearchSuggestionsImpl(query);
    }

    async checkWebSocketConnection(): Promise<any> {
        return this.checkWebSocketConnectionImpl();
    }

    async getAutoIndexSetting(): Promise<boolean> {
        return this.getAutoIndexSettingImpl();
    }

    async setAutoIndexSetting(enabled: boolean): Promise<void> {
        return this.setAutoIndexSettingImpl(enabled);
    }

    async getExtractionSettings(): Promise<any> {
        return this.getExtractionSettingsImpl();
    }

    async saveExtractionSettings(settings: any): Promise<void> {
        return this.saveExtractionSettingsImpl(settings);
    }

    // ===================================================================
    // UTILITY METHODS
    // ===================================================================

    /**
     * Transform search web memories response - can be overridden if needed
     */
    protected transformSearchWebMemoriesResponse(response: any): SearchResult {
        return response.results; // ChromeExtensionService behavior
    }
}
