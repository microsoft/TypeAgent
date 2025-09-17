// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared utilities for knowledge extraction features
 * Consolidates common functionality from knowledgeLibrary.ts and pageKnowledge.ts
 */

import type { AnswerEnhancement } from "../../agent/search/schema/answerEnhancement.mjs";
import type {
    StoredMacro,
    MacroQueryOptions,
    DeleteMacroResult,
} from "./macroUtilities";
import {
    ExtensionServiceBase,
    LibraryStats,
    SearchFilters,
    KnowledgeStatus,
    SearchResult,
    Website,
    SourceReference,
    EntityMatch,
} from "./extensionServiceBase";
import type { ProgressCallback } from "../interfaces/websiteImport.types";
import type {
    KnowledgeProgressCallback,
    KnowledgeExtractionProgress,
} from "../interfaces/knowledgeExtraction.types";
import { WebsiteCollection } from "website-memory";
import type { Relationship, Community } from "website-memory";

// ===================================================================
// GRAPH CACHING INTERFACES AND TYPES
// ===================================================================

interface GraphCacheManager {
    globalGraph: GlobalGraphData | null;
    entityGraphs: Map<string, EntityGraphData>;
    communityGraphs: Map<string, CommunityGraphData>;
    cacheTimestamps: Map<string, number>;
    cacheHitRate: number;
    memoryUsage: number;
}

interface GlobalGraphData {
    entities: Map<string, EntityNode>;
    relationships: Map<string, RelationshipEdge>;
    communities: Map<string, Community>;
    metadata: {
        totalNodes: number;
        lastUpdated: number;
        source: 'full' | 'partial' | 'hybrid';
    };
}

interface EntityGraphData {
    centerEntity: string;
    localGraph: {
        entities: EntityNode[];
        relationships: RelationshipEdge[];
        neighbors: Set<string>;
    };
    depth: number;
    lastAccessed: number;
}

interface CommunityGraphData {
    communityId: string;
    members: EntityNode[];
    internalRelationships: RelationshipEdge[];
    externalConnections: Map<string, RelationshipEdge[]>;
    lastUpdated: number;
}

interface EntityNode {
    id: string;
    name: string;
    type: string;
    confidence: number;
    properties: Record<string, any>;
}

interface RelationshipEdge {
    id: string;
    from: string;
    to: string;
    type: string;
    strength: number;
    properties: Record<string, any>;
}

interface CacheStrategy {
    bestOption: 'global_extraction' | 'neighbor_merge' | 'partial_build' | 'search_fallback';
    confidence: number;
}

// ===================================================================
// INTERFACES AND TYPES
// ===================================================================

export interface NotificationAction {
    label: string;
    action: () => void;
    style?: "primary" | "secondary" | "success" | "danger";
}

// Re-export types from base class for backward compatibility
export type {
    LibraryStats,
    SearchFilters,
    KnowledgeStatus,
    SearchResult,
    Website,
    SourceReference,
    EntityMatch,
} from "./extensionServiceBase";

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

export class ChromeExtensionService extends ExtensionServiceBase {
    private importProgressCallbacks: Map<string, ProgressCallback> = new Map();
    private extractionProgressCallbacks: Map<
        string,
        KnowledgeProgressCallback
    > = new Map();
    // Override getCurrentTab with Chrome-specific implementation
    protected async getCurrentTabImpl(): Promise<chrome.tabs.Tab | null> {
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

    // Override openOptionsPage with Chrome-specific implementation
    async openOptionsPage(): Promise<void> {
        try {
            chrome.runtime.openOptionsPage();
        } catch (error) {
            console.error("Failed to open options page:", error);
            throw error;
        }
    }

    // Override createTab with Chrome-specific implementation
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

    protected onImportProgressImpl(
        importId: string,
        callback: ProgressCallback,
    ): void {
        this.importProgressCallbacks.set(importId, callback);

        const messageListener = (message: any) => {
            if (
                message.type === "importProgress" &&
                message.importId === importId
            ) {
                callback(message.progress);
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        (callback as any)._messageListener = messageListener;
    }

    protected onExtractionProgressImpl(
        extractionId: string,
        callback: KnowledgeProgressCallback,
    ): void {
        this.extractionProgressCallbacks.set(extractionId, callback);

        const messageListener = (message: any) => {
            if (
                message.type === "knowledgeExtractionProgress" &&
                message.progress?.extractionId === extractionId
            ) {
                callback(message.progress);

                // Cleanup on completion
                if (
                    message.progress.phase === "complete" ||
                    message.progress.phase === "error"
                ) {
                    this.extractionProgressCallbacks.delete(extractionId);
                    chrome.runtime.onMessage.removeListener(messageListener);
                }
            }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        (callback as any)._messageListener = messageListener;
    }

    // Implement abstract sendMessage method
    protected async sendMessage<T>(message: any): Promise<T> {
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
// ELECTRON EXTENSION SERVICE
// ===================================================================

export class ElectronExtensionService extends ExtensionServiceBase {
    private importProgressCallbacks: Map<string, ProgressCallback> = new Map();
    private extractionProgressCallbacks: Map<
        string,
        KnowledgeProgressCallback
    > = new Map();
    // Override getAnalyticsData to add success wrapper
    async getAnalyticsData(options?: {
        timeRange?: string;
        includeQuality?: boolean;
        includeProgress?: boolean;
        topDomainsLimit?: number;
        activityGranularity?: "day" | "week" | "month";
    }): Promise<any> {
        const result = await super.getAnalyticsData(options);
        return {
            success: !result.error,
            analytics: result,
            error: result.error,
        };
    }

    // Override transformSearchWebMemoriesResponse for Electron-specific response structure
    protected transformSearchWebMemoriesResponse(result: any): SearchResult {
        return {
            websites: result.websites || [],
            summary: {
                text: result.answer || "",
                totalFound: result.websites?.length || 0,
                searchTime: result.summary?.searchTime || 0,
                sources: result.answerSources || [],
                entities: result.relatedEntities || [],
            },
            query: result.query || "",
            filters: result.filters || {},
            topTopics: result.topTopics || [],
            suggestedFollowups: result.suggestedFollowups || [],
            relatedEntities: result.relatedEntities || [],
        };
    }

    // Override getCurrentTab with Electron-specific implementation
    protected async getCurrentTabImpl(): Promise<any> {
        // Return mock tab object for Electron context
        return {
            id: -1,
            url: window.location.href,
            title: document.title,
            active: true,
        };
    }

    // Override getAutoIndexSetting with Electron storage implementation
    protected async getAutoIndexSettingImpl(): Promise<boolean> {
        try {
            const settings = await (window as any).electronAPI.getStorage([
                "autoIndexing",
            ]);
            return settings.autoIndexing || false;
        } catch (error) {
            console.error("Failed to get auto-index setting:", error);
            return false;
        }
    }

    // Override setAutoIndexSetting with Electron storage implementation
    protected async setAutoIndexSettingImpl(enabled: boolean): Promise<void> {
        try {
            await (window as any).electronAPI.setStorage({
                autoIndexing: enabled,
            });
        } catch (error) {
            console.error("Failed to set auto-index setting:", error);
            throw error;
        }
    }

    // Override getExtractionSettings with Electron storage implementation
    protected async getExtractionSettingsImpl(): Promise<any> {
        try {
            const settings = await (window as any).electronAPI.getStorage([
                "extractionSettings",
            ]);
            return settings.extractionSettings || null;
        } catch (error) {
            console.error("Failed to get extraction settings:", error);
            return null;
        }
    }

    // Override saveExtractionSettings with Electron storage implementation
    protected async saveExtractionSettingsImpl(settings: any): Promise<void> {
        try {
            await (window as any).electronAPI.setStorage({
                extractionMode: settings.mode,
                suggestQuestions: settings.suggestQuestions,
            });
        } catch (error) {
            console.error("Failed to save extraction settings:", error);
            throw error;
        }
    }

    async openOptionsPage(): Promise<void> {
        // In Electron, we could potentially open a new window or navigate
        console.warn("Options page not available in Electron context");
    }

    async createTab(url: string, active: boolean = true): Promise<any> {
        // Mock tab creation for Electron context
        window.open(url, active ? "_self" : "_blank");
        return {
            id: -1,
            url: url,
            active: active,
        };
    }

    // Include all other methods from ChromeExtensionService with the same signatures
    async getIndexStats(): Promise<any> {
        return this.sendMessage({ type: "getIndexStats" });
    }

    async getPageSourceInfo(url: string): Promise<any> {
        return this.sendMessage({ type: "getPageSourceInfo", url });
    }

    async getPageIndexedKnowledge(url: string): Promise<any> {
        return this.sendMessage({ type: "getPageIndexedKnowledge", url });
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
        return this.sendMessage({ type: "searchWebMemories", parameters });
    }

    async checkAIModelAvailability(): Promise<any> {
        return this.sendMessage({ type: "checkAIModelAvailability" });
    }

    async getPageQualityMetrics(url: string): Promise<any> {
        return this.sendMessage({ type: "getPageQualityMetrics", url });
    }

    async notifyAutoIndexSettingChanged(enabled: boolean): Promise<void> {
        return this.sendMessage({ type: "autoIndexSettingChanged", enabled });
    }

    async getRecentKnowledgeItems(limit: number = 10): Promise<any> {
        return this.sendMessage({ type: "getRecentKnowledgeItems", limit });
    }

    async extractKnowledge(url: string): Promise<any> {
        return this.sendMessage({ type: "extractKnowledge", url });
    }

    async checkKnowledgeStatus(url: string): Promise<any> {
        return this.sendMessage({ action: "checkKnowledgeStatus", url });
    }

    async getSearchSuggestions(query: string): Promise<string[]> {
        try {
            // For Electron, simulate Chrome storage behavior
            const settings = await (window as any).electronAPI.getStorage([
                "searchHistory",
            ]);
            const searchHistory = settings.searchHistory || [];

            const suggestions = searchHistory
                .filter((search: string) =>
                    search.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 5);

            // Match ChromeExtensionService extraction pattern
            return suggestions; // ChromeExtensionService extracts suggestions from response
        } catch (error) {
            console.error("Error getting search suggestions:", error);
            return [];
        }
    }

    async getRecentSearches(): Promise<string[]> {
        return this.sendMessage({ action: "getRecentSearches" });
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
        return this.sendMessage({ type: "saveSearch", query, results });
    }

    async checkWebSocketConnection(): Promise<any> {
        // Use direct IPC call to browserIPC instead of sending via WebSocket
        if (typeof window !== "undefined" && (window as any).electronAPI) {
            try {
                return await (
                    window as any
                ).electronAPI.checkWebSocketConnection();
            } catch (error) {
                console.error(
                    "Direct WebSocket connection check failed:",
                    error,
                );
                return { connected: false };
            }
        }
        return { connected: false };
    }

    async getViewHostUrl(): Promise<string | null> {
        try {
            const response = await this.sendMessage<{ url?: string }>({
                type: "getViewHostUrl",
            });
            return response?.url || null;
        } catch (error) {
            console.error("Failed to get view host URL:", error);
            return null;
        }
    }

    protected onImportProgressImpl(
        importId: string,
        callback: ProgressCallback,
    ): void {
        this.importProgressCallbacks.set(importId, callback);

        const progressHandler = (progress: any) => {
            if (progress.importId === importId) {
                callback(progress.progress);
            }
        };

        if ((window as any).electronAPI?.registerImportProgressCallback) {
            (window as any).electronAPI.registerImportProgressCallback(
                importId,
                progressHandler,
            );
        }

        (callback as any)._progressHandler = progressHandler;
        (callback as any)._importId = importId;
    }

    protected onExtractionProgressImpl(
        extractionId: string,
        callback: KnowledgeProgressCallback,
    ): void {
        this.extractionProgressCallbacks.set(extractionId, callback);

        const progressHandler = (progress: any) => {
            if (progress.extractionId === extractionId) {
                callback(progress.progress);

                // Cleanup on completion
                if (
                    progress.progress?.phase === "complete" ||
                    progress.progress?.phase === "error"
                ) {
                    this.extractionProgressCallbacks.delete(extractionId);
                }
            }
        };

        if ((window as any).electronAPI?.registerExtractionProgressCallback) {
            (window as any).electronAPI.registerExtractionProgressCallback(
                extractionId,
                progressHandler,
            );
        }

        (callback as any)._progressHandler = progressHandler;
        (callback as any)._extractionId = extractionId;
    }

    // Implement abstract sendMessage method with message transformation
    protected async sendMessage<T>(message: any): Promise<T> {
        if (typeof window !== "undefined" && (window as any).electronAPI) {
            try {
                // Transform Chrome message format to Electron format
                const electronMessage =
                    this.transformChromeMessageToElectron(message);
                const response = await (
                    window as any
                ).electronAPI.sendBrowserMessage(electronMessage);
                if (response && response.error) {
                    throw new Error(response.error);
                }
                return response;
            } catch (error) {
                console.error("Electron IPC message failed:", error);
                throw error;
            }
        }
        throw new Error("Electron API not available");
    }

    /**
     * Transform Chrome message format to Electron format
     */
    private transformChromeMessageToElectron(chromeMessage: any): any {
        const { type, ...params } = chromeMessage;

        // Handle special cases where message structure differs
        if (
            (type === "searchWebMemories" ||
                type === "importWebsiteDataWithProgress") &&
            chromeMessage.parameters
        ) {
            return {
                method: type,
                params: chromeMessage.parameters,
            };
        }

        // Standard transformation: move all properties except 'type' into 'params'
        return {
            method: type,
            params: Object.keys(params).length > 0 ? params : {},
        };
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
            // Check for Electron context first (has electronAPI in window)
            if (typeof window !== "undefined" && (window as any).electronAPI) {
                // Electron context - use direct WebSocket connection check
                const response = await (
                    window as any
                ).electronAPI.checkWebSocketConnection();
                return response?.connected === true;
            } else if (typeof chrome !== "undefined" && chrome.runtime) {
                // Chrome extension context
                const response = await chrome.runtime.sendMessage({
                    type: "checkWebSocketConnection",
                });
                return response?.connected === true;
            }
            return false;
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
// SERVICE FACTORY AND ENVIRONMENT DETECTION
// ===================================================================

export function createExtensionService(): ExtensionServiceBase {
    // Check for Electron context first (has electronAPI in window)
    // Note: Electron provides Chrome extension APIs but they're not fully implemented
    if (typeof window !== "undefined" && (window as any).electronAPI) {
        console.log("Using ElectronExtensionService for Electron context");
        return new ElectronExtensionService();
    }

    // Default to Chrome extension context
    console.log("Using ChromeExtensionService for Chrome extension context");
    return new ChromeExtensionService();
}

// ===================================================================
// CONNECTION MANAGER UPDATES FOR ELECTRON
// ===================================================================

export class ElectronConnectionManager {
    static async checkConnectionStatus(): Promise<boolean> {
        try {
            const response = await (
                window as any
            ).electronAPI.sendBrowserMessage({
                type: "checkWebSocketConnection",
            });
            return response?.connected === true;
        } catch (error) {
            return false;
        }
    }
}

// Update the existing connection manager to work with both environments
export class UnifiedConnectionManager {
    static async checkConnectionStatus(): Promise<boolean> {
        try {
            // Check for Electron context first (has electronAPI in window)
            if (typeof window !== "undefined" && (window as any).electronAPI) {
                // Electron context - use direct WebSocket connection check
                const response = await (
                    window as any
                ).electronAPI.checkWebSocketConnection();
                return response?.connected === true;
            } else if (typeof chrome !== "undefined" && chrome.runtime) {
                // Chrome extension context
                const response = await chrome.runtime.sendMessage({
                    type: "checkWebSocketConnection",
                });
                return response?.connected === true;
            }
            return false;
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
// EXPORTS
// ===================================================================

export const notificationManager = new NotificationManager();
export const chromeExtensionService = new ChromeExtensionService();
export const extensionService = createExtensionService();

export {
    KnowledgeTemplateHelpers as TemplateHelpers,
    KnowledgeFormatUtils as FormatUtils,
    UnifiedConnectionManager as ConnectionManager,
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


// Default implementations using the existing ChromeExtensionService
export class DefaultAnalyticsServices implements AnalyticsServices {
    constructor(private chromeService: ExtensionServiceBase) {}

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

// Cached version of analytics services
export class CachedDefaultAnalyticsServices extends DefaultAnalyticsServices {
    private cacheManager: any; // Import will be added dynamically

    constructor(chromeService: ExtensionServiceBase) {
        super(chromeService);
        // Initialize cache manager when available
        this.initializeCacheManager();
    }

    private initializeCacheManager() {
        // This will be dynamically imported to avoid circular dependencies
        try {
            import("./services/cachedAnalyticsService").then(
                ({ CachedAnalyticsService }) => {
                    this.cacheManager = new CachedAnalyticsService(this);
                },
            );
        } catch (error) {
            console.warn(
                "Cache manager not available, falling back to non-cached service",
            );
        }
    }

    async loadAnalyticsData(): Promise<any> {
        if (this.cacheManager) {
            return this.cacheManager.loadAnalyticsData();
        }
        return super.loadAnalyticsData();
    }
}

export class DefaultSearchServices implements SearchServices {
    constructor(private chromeService: ExtensionServiceBase) {}

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
            const result = await this.chromeService.searchWebMemories(
                query,
                searchFilters,
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
    constructor(private chromeService: ExtensionServiceBase) {}

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
    private extensionService: ExtensionServiceBase | null = null;
    private cacheManager: GraphCacheManager;
    private intelligentExtractor: IntelligentGraphExtractor;

    constructor(extensionService?: ExtensionServiceBase) {
        this.extensionService = extensionService || null;
        this.cacheManager = this.initializeCacheManager();
        this.intelligentExtractor = new IntelligentGraphExtractor(this.cacheManager);
    }

    private initializeCacheManager(): GraphCacheManager {
        return {
            globalGraph: null,
            entityGraphs: new Map(),
            communityGraphs: new Map(),
            cacheTimestamps: new Map(),
            cacheHitRate: 0,
            memoryUsage: 0
        };
    }

    async getEntityGraph(centerEntity: string, depth: number): Promise<any> {
        try {
            console.time('[Perf] getEntityGraph total');
            console.log(`Getting graph for ${centerEntity} (depth: ${depth})`);

            // Cache-first approach - analyze what data we have available
            console.time('[Perf] cache analysis');
            const cacheStrategy = this.analyzeCacheAvailability(centerEntity, depth);
            console.timeEnd('[Perf] cache analysis');

            // Use intelligent extraction strategy based on cache availability
            const options = {
                useCache: true,
                fallbackToSearch: true,
                maxNodes: depth > 1 ? 500 : 200
            };

            console.time('[Perf] intelligent extraction');
            const result = await this.intelligentExtractor.getEntityNeighborhood(
                centerEntity,
                depth,
                options
            );
            console.timeEnd('[Perf] intelligent extraction');

            if (!this.extensionService) {
                console.warn(
                    "ChromeExtensionService not available, using cached result",
                );
                console.timeEnd('[Perf] getEntityGraph total');
                return result || { centerEntity, entities: [], relationships: [] };
            }

            // If intelligent extraction didn't find neighborhood data (only center entity), fall back to search
            if (!result || result.entities.length <= 1 && result.relationships.length === 0) {
                console.time('[Perf] performEntitySearchWithFallback');
                const primarySearch = await this.performEntitySearchWithFallback(
                    centerEntity,
                    { maxResults: 15 },
                );
                console.timeEnd('[Perf] performEntitySearchWithFallback');

                // Convert search results to the expected format and cache them
                const searchResult = await this.convertSearchToGraphFormat(primarySearch, centerEntity, depth);
                console.timeEnd('[Perf] getEntityGraph total');
                return searchResult;
            }

            console.timeEnd('[Perf] getEntityGraph total');
            return result;
        } catch (error) {
            console.error("Entity graph retrieval failed:", error);
            console.timeEnd('[Perf] getEntityGraph total');
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

    /**
     * Convert search results to graph format and cache them
     */
    private async convertSearchToGraphFormat(primarySearch: any, centerEntity: string, depth: number): Promise<any> {
        if (!primarySearch || !primarySearch.websites || primarySearch.websites.length === 0) {
            return { centerEntity, entities: [], relationships: [] };
        }

        // Convert search results to entity format
        const entities = primarySearch.websites
            .map((website: any, index: number) => {
                const richEntity = this.extractRichEntityData(centerEntity, website, index);
                return {
                    ...richEntity,
                    id: `search_${index}`,
                    category: "primary",
                };
            })
            .filter((entity: any) => entity.name && entity.name.trim())
            .slice(0, 15);

        // Ensure center entity is included in the entities list
        const centerEntityNode = {
            id: 'center',
            name: centerEntity,
            type: 'concept',
            confidence: 1.0,
            category: 'center',
            description: `Center entity: ${centerEntity}`,
            properties: { isCenterEntity: true }
        };

        // Add center entity if not already present
        const hasCenter = entities.some((e: any) => e.name.toLowerCase() === centerEntity.toLowerCase());
        if (!hasCenter) {
            entities.unshift(centerEntityNode);
        }

        // Create relationships
        const relationships = this.generateBasicRelationships(entities.filter((e: any) => e.id !== 'center'), centerEntity);

        // Cache the result for future use
        this.intelligentExtractor.cacheEntityGraph(centerEntity, {
            entities: entities.map((e: any) => ({ ...e, name: e.name, type: e.type || 'concept', confidence: e.confidence || 0.5, properties: e })),
            relationships: relationships.map((r: any) => ({ ...r, id: r.id, from: r.from, to: r.to, type: r.type, strength: r.strength || 0.5, properties: r }))
        }, depth);

        return {
            centerEntity,
            entities,
            relationships,
            metadata: {
                source: 'search_conversion',
                searchDepth: depth,
                totalSources: primarySearch.websites.length,
                generatedAt: new Date().toISOString(),
                ...primarySearch.metadata,
            },
            topTopics: primarySearch.topTopics || [],
            summary: primarySearch.summary || null,
            answerSources: primarySearch.answerSources || [],
            relatedEntities: primarySearch.relatedEntities || [],
        };
    }

    /**
     * Analyze cache availability to determine best extraction strategy
     */
    private analyzeCacheAvailability(centerEntity: string, depth: number): CacheStrategy {
        const analysis = {
            hasGlobalGraph: this.cacheManager.globalGraph !== null,
            hasEntityCache: this.cacheManager.entityGraphs.has(centerEntity),
            neighborCoverage: this.calculateNeighborCoverage(centerEntity, depth),
            cacheAge: this.getCacheAge(),
            memoryPressure: this.getMemoryPressure()
        };

        console.log('Cache analysis:', analysis);

        // Decision matrix
        if (analysis.hasGlobalGraph && analysis.cacheAge < 300000) { // 5 min
            return { bestOption: 'global_extraction', confidence: 0.9 };
        }

        if (analysis.neighborCoverage > 0.7) {
            return { bestOption: 'neighbor_merge', confidence: 0.8 };
        }

        if (analysis.memoryPressure < 0.8) {
            return { bestOption: 'partial_build', confidence: 0.6 };
        }

        return { bestOption: 'search_fallback', confidence: 0.4 };
    }

    private calculateNeighborCoverage(centerEntity: string, depth: number): number {
        const entityGraph = this.cacheManager.entityGraphs.get(centerEntity);
        if (!entityGraph) return 0;

        const expectedNeighbors = Math.min(50, depth * 20); // Estimated neighbors needed
        const cachedNeighbors = entityGraph.localGraph.neighbors.size;

        return Math.min(1.0, cachedNeighbors / expectedNeighbors);
    }

    private getCacheAge(): number {
        const globalTimestamp = this.cacheManager.cacheTimestamps.get('global');
        if (!globalTimestamp) return Infinity;
        return Date.now() - globalTimestamp;
    }

    private getMemoryPressure(): number {
        // Simple heuristic based on cache size
        const entityCacheSize = this.cacheManager.entityGraphs.size;
        const maxCacheSize = 100; // Arbitrary limit
        return entityCacheSize / maxCacheSize;
    }

    async refreshEntityData(entityName: string): Promise<any> {
        // For now, just trigger a fresh search
        const refreshedData = await this.searchByEntity(entityName, {
            maxResults: 5,
        });

        return refreshedData.entities.length > 0 ? refreshedData : null;
    }

    /**
     * Smart entity search with fallback strategy
     */
    private async performEntitySearchWithFallback(
        entityName: string,
        options?: { maxResults?: number }
    ): Promise<any> {
        if (!this.extensionService) {
            throw new Error("ChromeExtensionService not available");
        }

        const maxResults = options?.maxResults || 10;

        try {
            console.time('[Perf] searchByEntities');
            const entityResults = await this.extensionService.searchByEntities(
                [entityName],
                "",
                maxResults,
            );
            console.timeEnd('[Perf] searchByEntities');

            if (entityResults && entityResults.websites && entityResults.websites.length > 0) {
                console.log(
                    "✅ Entity search found %d results for: %s",
                    entityResults.websites.length,
                    entityName
                );
                return {
                    websites: entityResults.websites,
                    relatedEntities: entityResults.relatedEntities || [],
                    topTopics: entityResults.topTopics || [],
                    summary: entityResults.summary || null,
                    metadata: entityResults.metadata || {},
                    answerSources: entityResults.answerSources || [],
                };
            }
        } catch (error) {
            console.warn("Entity search failed for %s:", entityName, error);
        }

        return {
            websites: [],
            relatedEntities: [],
            topTopics: [],
            metadata: {},
            answerSources: [],
        };
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
        const title = website.title || website.description || `Entity ${index + 1}`;
        const domain = url ? this.extractDomain(url) : "unknown";

        return {
            id: `entity_${index}`,
            name: title.slice(0, 50).trim() || `Entity ${index + 1}`,
            type: "website",
            confidence: this.calculateConfidence(website),
            url: url,
            description: website.description || "",
            domain: domain,
            visitCount: website.visitCount || 0,
            lastVisited: website.lastVisited || website.lastVisit,
            source: website.sourceType || "website",
        };
    }

    /**
     * Generate basic relationships between entities
     */
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

    async searchByEntity(entityName: string, options: any = {}): Promise<any> {
        try {
            if (!this.extensionService) {
                console.warn(
                    "ChromeExtensionService not available, using empty result",
                );
                return {
                    entities: [],
                    centerEntity: entityName,
                    relationships: [],
                };
            }

            // Use fast entity-based search
            const searchResult = await this.performEntitySearchWithFallback(
                entityName,
                options,
            );

            if (searchResult && searchResult.websites && searchResult.websites.length > 0) {
                // Convert website search results to entity format
                const entities = searchResult.websites
                    .map((website: any, index: number) => {
                        return this.extractRichEntityData(
                            entityName,
                            website,
                            index,
                        );
                    })
                    .filter((entity: any) => entity.name && entity.name.trim())
                    .slice(0, options.maxResults || 10);

                return {
                    entities: entities,
                    centerEntity: entityName,
                    relationships: this.generateBasicRelationships(entities, entityName),
                    totalFound: searchResult.websites.length,
                    searchTime: searchResult.summary?.searchTime || 0,
                    topTopics: searchResult.topTopics || [],
                    summary: searchResult.summary || null,
                    metadata: searchResult.metadata || {},
                    relatedEntities: searchResult.relatedEntities || [],
                    answerSources: searchResult.answerSources || [],
                };
            }

            return {
                entities: [],
                centerEntity: entityName,
                relationships: [],
                totalFound: 0,
                topTopics: [],
                summary: null,
                metadata: {},
                relatedEntities: [],
                answerSources: [],
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
                answerSources: [],
            };
        }
    }

    /**
     * Get website collection from extension service
     */
    private async getWebsiteCollection(): Promise<WebsiteCollection | null> {
        try {
            if (!this.extensionService) return null;

            // Try to get the website collection through the extension service
            const result = await this.extensionService.getAnalyticsData({
                includeWebsiteCollection: true
            } as any);

            return result?.websiteCollection || null;
        } catch (error) {
            console.warn("Could not get website collection:", error);
            return null;
        }
    }

}

/**
 * Intelligent Graph Extractor - implements cache-first entity neighborhood extraction
 */
class IntelligentGraphExtractor {
    constructor(private cacheManager: GraphCacheManager) {}

    async getEntityNeighborhood(
        centerEntity: string,
        depth: number,
        options: {
            useCache: boolean;
            fallbackToSearch: boolean;
            maxNodes: number;
        }
    ): Promise<any> {
        console.time('[Perf] neighborhood extraction');

        try {
            // Strategy 1: Extract from global cache (fastest)
            if (this.cacheManager.globalGraph) {
                console.time('[Perf] extract from global');
                const result = await this.extractFromGlobalGraph(centerEntity, depth, options.maxNodes);
                console.timeEnd('[Perf] extract from global');
                // Only consider successful if we have more than just the center entity or relationships
                if (result.entities.length > 1 || result.relationships.length > 0) {
                    console.timeEnd('[Perf] neighborhood extraction');
                    return result;
                }
            }

            // Strategy 2: Combine cached entity graphs (fast)
            const cachedNeighbors = this.findCachedNeighbors(centerEntity, depth);
            if (cachedNeighbors.coverage > 0.7) {
                console.time('[Perf] merge neighbor caches');
                const result = await this.mergeNeighborGraphs(centerEntity, cachedNeighbors);
                console.timeEnd('[Perf] merge neighbor caches');
                // Only consider successful if we have more than just the center entity or relationships
                if (result.entities.length > 1 || result.relationships.length > 0) {
                    console.timeEnd('[Perf] neighborhood extraction');
                    return result;
                }
            }

            // Strategy 3: Partial graph building (medium)
            if (options.useCache) {
                console.time('[Perf] partial graph build');
                const result = await this.buildPartialGraph(centerEntity, depth, options.maxNodes);
                console.timeEnd('[Perf] partial graph build');
                // Only consider successful if we have more than just the center entity or relationships
                if (result.entities.length > 1 || result.relationships.length > 0) {
                    console.timeEnd('[Perf] neighborhood extraction');
                    return result;
                }
            }

            // Strategy 4: Search fallback (fast but limited)
            if (options.fallbackToSearch) {
                console.time('[Perf] search fallback');
                const result = await this.searchBasedGraph(centerEntity, depth);
                console.timeEnd('[Perf] search fallback');
                console.timeEnd('[Perf] neighborhood extraction');
                return result;
            }

            throw new Error('No viable graph extraction strategy available');

        } catch (error) {
            console.error('Intelligent extraction failed:', error);
            console.timeEnd('[Perf] neighborhood extraction');

            // Emergency fallback
            return {
                centerEntity,
                entities: [],
                relationships: [],
                metadata: {
                    source: 'emergency_fallback',
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            };
        }
    }

    private async extractFromGlobalGraph(centerEntity: string, depth: number, maxNodes: number): Promise<any> {
        const globalGraph = this.cacheManager.globalGraph!;

        // Find center entity in global graph
        const centerNode = globalGraph.entities.get(centerEntity.toLowerCase());
        if (!centerNode) {
            return { centerEntity, entities: [], relationships: [] };
        }

        // Extract neighborhood using breadth-first search
        const visited = new Set<string>();
        const entities: EntityNode[] = [];
        const relationships: RelationshipEdge[] = [];
        const queue = [{ entity: centerEntity.toLowerCase(), currentDepth: 0 }];

        while (queue.length > 0 && entities.length < maxNodes) {
            const { entity, currentDepth } = queue.shift()!;

            if (visited.has(entity) || currentDepth > depth) continue;
            visited.add(entity);

            const entityNode = globalGraph.entities.get(entity);
            if (entityNode) {
                entities.push(entityNode);

                // Find relationships from this entity
                globalGraph.relationships.forEach((rel, relId) => {
                    if (rel.from.toLowerCase() === entity || rel.to.toLowerCase() === entity) {
                        relationships.push(rel);

                        // Add connected entities to queue for next depth level
                        if (currentDepth < depth) {
                            const connected = rel.from.toLowerCase() === entity ? rel.to : rel.from;
                            if (!visited.has(connected.toLowerCase())) {
                                queue.push({ entity: connected.toLowerCase(), currentDepth: currentDepth + 1 });
                            }
                        }
                    }
                });
            }
        }

        // Cache the result for future use
        this.cacheEntityGraph(centerEntity, { entities, relationships }, depth);

        return {
            centerEntity,
            entities: entities.map(e => ({ ...e, id: e.id || e.name })),
            relationships: relationships.map(r => ({ ...r, id: r.id || `${r.from}-${r.to}` })),
            metadata: {
                source: 'global_cache',
                totalAvailable: globalGraph.entities.size,
                extracted: entities.length,
                searchDepth: depth
            }
        };
    }

    private findCachedNeighbors(centerEntity: string, depth: number): { coverage: number; neighbors: string[] } {
        const entityGraph = this.cacheManager.entityGraphs.get(centerEntity);
        if (!entityGraph) {
            return { coverage: 0, neighbors: [] };
        }

        const neighbors = Array.from(entityGraph.localGraph.neighbors);
        const expectedNeighbors = Math.min(50, depth * 20);
        const coverage = Math.min(1.0, neighbors.length / expectedNeighbors);

        return { coverage, neighbors };
    }

    private async mergeNeighborGraphs(centerEntity: string, cachedNeighbors: { neighbors: string[] }): Promise<any> {
        const mergedEntities = new Map<string, EntityNode>();
        const mergedRelationships = new Map<string, RelationshipEdge>();

        // Start with center entity cache
        const centerCache = this.cacheManager.entityGraphs.get(centerEntity);
        if (centerCache) {
            centerCache.localGraph.entities.forEach(e => {
                mergedEntities.set(e.name.toLowerCase(), e);
            });
            centerCache.localGraph.relationships.forEach(r => {
                mergedRelationships.set(r.id, r);
            });
        }

        // Merge neighbor caches
        for (const neighbor of cachedNeighbors.neighbors.slice(0, 10)) {
            const neighborCache = this.cacheManager.entityGraphs.get(neighbor);
            if (neighborCache) {
                neighborCache.localGraph.entities.forEach(e => {
                    if (!mergedEntities.has(e.name.toLowerCase())) {
                        mergedEntities.set(e.name.toLowerCase(), e);
                    }
                });
                neighborCache.localGraph.relationships.forEach(r => {
                    if (!mergedRelationships.has(r.id)) {
                        mergedRelationships.set(r.id, r);
                    }
                });
            }
        }

        return {
            centerEntity,
            entities: Array.from(mergedEntities.values()),
            relationships: Array.from(mergedRelationships.values()),
            metadata: {
                source: 'neighbor_merge',
                mergedCaches: cachedNeighbors.neighbors.length,
                totalEntities: mergedEntities.size
            }
        };
    }

    private async buildPartialGraph(centerEntity: string, depth: number, maxNodes: number): Promise<any> {
        // This is a placeholder for building a minimal graph subset
        // In a real implementation, this would query a subset of data
        console.log(`Building partial graph for ${centerEntity} with max ${maxNodes} nodes`);

        // Create a minimal center entity
        const centerEntityNode = {
            id: 'center',
            name: centerEntity,
            type: 'concept',
            confidence: 1.0,
            category: 'center',
            description: `Center entity: ${centerEntity}`,
            properties: { isCenterEntity: true }
        };

        return {
            centerEntity,
            entities: [centerEntityNode],
            relationships: [],
            metadata: {
                source: 'partial_build',
                note: 'Partial graph building not yet implemented - minimal entity created'
            }
        };
    }

    private async searchBasedGraph(centerEntity: string, depth: number): Promise<any> {
        // Use the existing search-based approach as fallback
        console.log(`Using search-based fallback for ${centerEntity}`);

        // Create a minimal center entity as fallback
        const centerEntityNode = {
            id: 'center',
            name: centerEntity,
            type: 'concept',
            confidence: 1.0,
            category: 'center',
            description: `Center entity: ${centerEntity}`,
            properties: { isCenterEntity: true }
        };

        return {
            centerEntity,
            entities: [centerEntityNode],
            relationships: [],
            metadata: {
                source: 'search_fallback',
                note: 'Search-based approach - actual search performed by parent'
            }
        };
    }

    public cacheEntityGraph(centerEntity: string, graphData: { entities: EntityNode[]; relationships: RelationshipEdge[] }, depth: number): void {
        const neighbors = new Set<string>();

        // Extract neighbor entity names from relationships
        graphData.relationships.forEach(rel => {
            if (rel.from.toLowerCase() !== centerEntity.toLowerCase()) {
                neighbors.add(rel.from);
            }
            if (rel.to.toLowerCase() !== centerEntity.toLowerCase()) {
                neighbors.add(rel.to);
            }
        });

        const entityGraphData: EntityGraphData = {
            centerEntity,
            localGraph: {
                entities: graphData.entities,
                relationships: graphData.relationships,
                neighbors
            },
            depth,
            lastAccessed: Date.now()
        };

        this.cacheManager.entityGraphs.set(centerEntity, entityGraphData);
        this.cacheManager.cacheTimestamps.set(centerEntity, Date.now());
    }
}

// ===================================================================
// LEGACY METHODS (to be refactored)
// ===================================================================

/**
 * Export the intelligent graph extractor for external usage
 */
export { IntelligentGraphExtractor };
