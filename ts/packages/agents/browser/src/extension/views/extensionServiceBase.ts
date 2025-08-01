// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AnswerEnhancement } from "../../agent/search/schema/answerEnhancement.mjs";
import type {
    StoredMacro,
    MacroQueryOptions,
    DeleteMacroResult,
} from "./macroUtilities";

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

/**
 * Abstract base class for extension services
 */
export abstract class ExtensionServiceBase {
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
