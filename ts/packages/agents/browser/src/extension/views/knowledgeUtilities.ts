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
    populateGlobalCache(globalData: {
        entities: any[];
        relationships: any[];
        communities: any[];
        statistics: {
            totalEntities: number;
            totalRelationships: number;
            totalCommunities: number;
        };
    }): void;
}

export interface GlobalDataLoader {
    (): Promise<{
        entities: any[];
        relationships: any[];
        communities: any[];
        statistics: {
            totalEntities: number;
            totalRelationships: number;
            totalCommunities: number;
        };
    }>;
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

    constructor(extensionService?: ExtensionServiceBase, globalDataLoader?: GlobalDataLoader) {
        this.extensionService = extensionService || null;
        this.cacheManager = this.initializeCacheManager();
        this.intelligentExtractor = new IntelligentGraphExtractor(this.cacheManager, globalDataLoader);
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
            console.log(`Getting graph for ${centerEntity} (depth: ${depth})`);

            // Cache-first approach - analyze what data we have available
            const cacheStrategy = this.analyzeCacheAvailability(centerEntity, depth);

            // Use intelligent extraction strategy based on cache availability
            const options = {
                useCache: true,
                fallbackToSearch: true,
                maxNodes: depth > 1 ? 500 : 200
            };

            const result = await this.intelligentExtractor.getEntityNeighborhood(
                centerEntity,
                depth,
                options
            );

            if (!this.extensionService) {
                console.warn(
                    "ChromeExtensionService not available, using cached result",
                );
                return this.convertNeighborhoodToSidebarFormat(result || { centerEntity, entities: [], relationships: [] });
            }

            // If intelligent extraction didn't find neighborhood data (only center entity), fall back to search
            if (!result || result.entities.length <= 1 && result.relationships.length === 0) {
                const primarySearch = await this.performEntitySearchWithFallback(
                    centerEntity,
                    { maxResults: 15 },
                );

                // Convert search results to the expected format and cache them
                const searchResult = await this.convertSearchToGraphFormat(primarySearch, centerEntity, depth);
                return searchResult;
            }

            return result;
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
     * Populate the global graph cache with loaded data
     */
    populateGlobalCache(globalData: {
        entities: any[];
        relationships: any[];
        communities: any[];
        statistics: {
            totalEntities: number;
            totalRelationships: number;
            totalCommunities: number;
        };
    }): void {
        console.time('[Perf] populate global cache');

        // Convert arrays to Maps for efficient lookup
        const entityMap = new Map<string, EntityNode>();
        const relationshipMap = new Map<string, RelationshipEdge>();
        const communityMap = new Map<string, Community>();

        // Process entities
        globalData.entities.forEach((entity: any, index: number) => {
            const entityNode: EntityNode = {
                id: entity.id || entity.name || `entity_${index}`,
                name: entity.name || entity.id || `Entity ${index}`,
                type: entity.type || 'entity',
                confidence: entity.confidence || entity.metrics?.pagerank || 0.5,
                properties: {
                    ...entity,
                    metrics: entity.metrics,
                    community: entity.community
                }
            };
            entityMap.set(entityNode.name.toLowerCase(), entityNode);
        });

        // Process relationships
        globalData.relationships.forEach((rel: any, index: number) => {
            const relationshipEdge: RelationshipEdge = {
                id: rel.id || `rel_${index}`,
                from: rel.from || rel.source,
                to: rel.to || rel.target,
                type: rel.type || 'connected',
                strength: rel.strength || rel.weight || 0.5,
                properties: {
                    ...rel,
                    weight: rel.weight,
                    confidence: rel.confidence
                }
            };
            relationshipMap.set(relationshipEdge.id, relationshipEdge);
        });

        // Process communities (use existing interface)
        globalData.communities.forEach((community: any) => {
            communityMap.set(community.id, community);
        });

        // Create global graph data
        const globalGraphData: GlobalGraphData = {
            entities: entityMap,
            relationships: relationshipMap,
            communities: communityMap,
            metadata: {
                totalNodes: globalData.statistics.totalEntities,
                lastUpdated: Date.now(),
                source: 'full'
            }
        };

        // Update cache manager
        this.cacheManager.globalGraph = globalGraphData;
        this.cacheManager.cacheTimestamps.set('global', Date.now());

        console.timeEnd('[Perf] populate global cache');
        console.log(`✅ Global cache populated: ${entityMap.size} entities, ${relationshipMap.size} relationships, ${communityMap.size} communities`);
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
            const entityResults = await this.extensionService.searchByEntities(
                [entityName],
                "",
                maxResults,
            );

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

    private convertNeighborhoodToSidebarFormat(neighborhoodData: any): any {
        const { centerEntity, entities = [], relationships = [], metadata = {} } = neighborhoodData;

        // Categorize entities by type
        const websites: any[] = [];
        const relatedEntities: any[] = [];
        const topTopics: any[] = [];

        entities.forEach((entity: any) => {
            const entityType = entity.type?.toLowerCase() || entity.entityType?.toLowerCase() || 'unknown';
            const entityData = {
                name: entity.name || entity.entityName || entity.id,
                type: entityType,
                confidence: entity.confidence || 0.5,
                id: entity.id || entity.name || entity.entityName,
                mentionCount: entity.mentionCount || entity.frequency || 1,
                firstSeen: entity.firstSeen || entity.dateAdded || new Date().toISOString(),
                relationships: entity.relationships || []
            };

            if (entityType.includes('website') || entityType.includes('url') || entityType.includes('domain')) {
                websites.push({
                    ...entityData,
                    url: entity.url || entity.link || `https://${entity.name}`,
                    title: entity.title || entity.name || entity.entityName,
                    description: entity.description || `Website: ${entity.name}`
                });
            } else if (entityType.includes('topic') || entityType.includes('concept') || entityType.includes('theme')) {
                topTopics.push(entityData);
            } else {
                relatedEntities.push(entityData);
            }
        });

        // Generate summary from center entity and relationships
        const summary = this.generateEntitySummary(centerEntity, entities, relationships);

        // Convert relationships to answer sources format
        const answerSources = relationships.map((rel: any) => ({
            type: rel.type || 'relationship',
            source: rel.source || centerEntity,
            target: rel.target || rel.destination,
            confidence: rel.confidence || rel.strength || 0.5,
            context: rel.context || rel.description || `${rel.source} relates to ${rel.target}`
        }));

        return {
            websites,
            relatedEntities,
            topTopics,
            summary,
            metadata: {
                ...metadata,
                centerEntity,
                totalEntities: entities.length,
                totalRelationships: relationships.length,
                timestamp: new Date().toISOString()
            },
            answerSources
        };
    }

    private generateEntitySummary(centerEntity: string, entities: any[], relationships: any[]): string {
        if (entities.length === 0) {
            return `No related entities found for "${centerEntity}".`;
        }

        const entityTypes = new Set(entities.map(e => e.type || e.entityType || 'entity'));
        const relationshipTypes = new Set(relationships.map(r => r.type || 'related'));

        const typesList = Array.from(entityTypes).slice(0, 3).join(', ');
        const relsList = Array.from(relationshipTypes).slice(0, 3).join(', ');

        return `"${centerEntity}" is connected to ${entities.length} entities including ${typesList}. ` +
               `Primary relationships: ${relsList}. This entity appears to be part of a network involving ` +
               `${entityTypes.size} different types of entities.`;
    }

}

/**
 * Intelligent Graph Extractor - implements cache-first entity neighborhood extraction
 */
class IntelligentGraphExtractor {
    constructor(private cacheManager: GraphCacheManager, private globalDataLoader?: GlobalDataLoader) {}

    /**
     * Ensure global cache exists, creating it if necessary
     */
    private async ensureGlobalCache(): Promise<GlobalGraphData | null> {
        // Return existing cache if available
        if (this.cacheManager.globalGraph) {
            return this.cacheManager.globalGraph;
        }

        console.log("[IntelligentGraphExtractor] No global cache found, attempting to create from available data");

        try {
            // Use the globalDataLoader callback if available
            if (this.globalDataLoader) {
                console.log("[IntelligentGraphExtractor] Using globalDataLoader callback to load global graph data");
                const globalData = await this.globalDataLoader();

                if (globalData && globalData.entities && globalData.relationships) {
                    // Convert to GlobalGraphData format
                    const entityMap = new Map<string, EntityNode>();
                    const relationshipMap = new Map<string, RelationshipEdge>();
                    const communityMap = new Map<string, Community>();

                    // Process entities
                    globalData.entities.forEach((entity: any, index: number) => {
                        const entityNode: EntityNode = {
                            id: entity.id || entity.name || `entity_${index}`,
                            name: entity.name || entity.id || `Entity ${index}`,
                            type: entity.type || 'entity',
                            confidence: entity.confidence || entity.metrics?.pagerank || 0.5,
                            properties: {
                                ...entity,
                                metrics: entity.metrics,
                                community: entity.community
                            }
                        };
                        entityMap.set(entityNode.name.toLowerCase(), entityNode);
                    });

                    // Process relationships
                    globalData.relationships.forEach((rel: any, index: number) => {
                        const relationshipEdge: RelationshipEdge = {
                            id: rel.id || `rel_${index}`,
                            from: rel.from || rel.source,
                            to: rel.to || rel.target,
                            type: rel.type || 'connected',
                            strength: rel.strength || rel.weight || 0.5,
                            properties: {
                                ...rel,
                                weight: rel.weight,
                                confidence: rel.confidence
                            }
                        };
                        relationshipMap.set(relationshipEdge.id, relationshipEdge);
                    });

                    // Process communities
                    globalData.communities.forEach((community: any) => {
                        communityMap.set(community.id, community);
                    });

                    // Create global graph data
                    const globalGraphData: GlobalGraphData = {
                        entities: entityMap,
                        relationships: relationshipMap,
                        communities: communityMap,
                        metadata: {
                            totalNodes: globalData.statistics.totalEntities,
                            lastUpdated: Date.now(),
                            source: 'full'
                        }
                    };

                    // Cache the result
                    this.cacheManager.globalGraph = globalGraphData;
                    this.cacheManager.cacheTimestamps.set('global', Date.now());

                    console.log(`[IntelligentGraphExtractor] Global cache created via callback: ${entityMap.size} entities, ${relationshipMap.size} relationships`);
                    return globalGraphData;
                }
            }

            // Return null to indicate cache creation is not possible
            // The caller should handle this by using search fallback
            console.warn("[IntelligentGraphExtractor] Cannot create global cache - no globalDataLoader callback available");
            return null;

        } catch (error) {
            console.error("[IntelligentGraphExtractor] Failed to create global cache:", error);
            return null;
        }
    }

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
            // Ensure global cache is available
            const globalGraph = await this.ensureGlobalCache();

            // Strategy 1: Extract from global cache (primary approach)
            if (globalGraph) {
                console.time('[Perf] extract from global');
                const result = await this.extractFromGlobalGraph(centerEntity, depth, options.maxNodes);
                console.timeEnd('[Perf] extract from global');
                // Only consider successful if we have more than just the center entity or relationships
                if (result.entities.length > 1 || result.relationships.length > 0) {
                    console.timeEnd('[Perf] neighborhood extraction');
                    return result;
                }
            }

            // Strategy 2: Search fallback (for cases where data may change before graph is updated)
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
        const globalGraph = await this.ensureGlobalCache();
        if (!globalGraph) {
            return { centerEntity, entities: [], relationships: [] };
        }

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
                    // Safety check for undefined values
                    if (!rel.from || !rel.to) return;

                    const fromLower = rel.from.toLowerCase();
                    const toLower = rel.to.toLowerCase();

                    if (fromLower === entity || toLower === entity) {
                        relationships.push(rel);

                        // Add connected entities to queue for next depth level
                        if (currentDepth < depth) {
                            const connected = fromLower === entity ? rel.to : rel.from;
                            if (connected && !visited.has(connected.toLowerCase())) {
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



    private async buildPartialGraph(centerEntity: string, depth: number, maxNodes: number): Promise<any> {
        // Build a minimal but realistic graph subset using available cache data
        console.log(`Building partial graph for ${centerEntity} with max ${maxNodes} nodes`);

        const entities: any[] = [];
        const relationships: any[] = [];

        // Create center entity with realistic properties
        const centerEntityNode = {
            id: centerEntity.toLowerCase().replace(/\s+/g, '_'),
            name: centerEntity,
            type: this.inferEntityType(centerEntity),
            confidence: 1.0,
            importance: 0.8,
            category: 'center',
            description: `Center entity: ${centerEntity}`,
            properties: {
                isCenterEntity: true,
                degree: 0 // Will be updated below
            }
        };
        entities.push(centerEntityNode);

        // Generate multi-level neighborhood expansion based on depth
        const entityLayers: any[][] = [];
        let currentLevelEntities = [centerEntityNode];
        entityLayers.push([...currentLevelEntities]);

        // Generate entities level by level up to the specified depth
        for (let currentDepth = 1; currentDepth <= depth && entities.length < maxNodes; currentDepth++) {
            const entitiesPerLayer = Math.max(2, Math.min(
                Math.floor((maxNodes - entities.length) / (depth - currentDepth + 1)),
                Math.floor(Math.pow(3, Math.min(currentDepth, 3))) // Exponential growth up to depth 3, then linear
            ));

            const newLevelEntities: any[] = [];

            // For each entity in the previous level, generate connections
            for (const parentEntity of currentLevelEntities) {
                if (entities.length >= maxNodes) break;

                const entitiesForThisParent = Math.min(
                    entitiesPerLayer / currentLevelEntities.length,
                    maxNodes - entities.length
                );

                const childEntities = this.generatePlausibleRelatedEntities(
                    parentEntity.name,
                    Math.floor(entitiesForThisParent),
                    currentDepth
                );

                childEntities.forEach(childEntity => {
                    if (entities.length < maxNodes) {
                        // Ensure unique entity names
                        childEntity.id = `${childEntity.name.toLowerCase().replace(/\s+/g, '_')}_d${currentDepth}_${entities.length}`;
                        childEntity.properties.distance = currentDepth;
                        childEntity.properties.parentEntity = parentEntity.name;

                        entities.push(childEntity);
                        newLevelEntities.push(childEntity);

                        // Create relationship from parent to child
                        const relationship = {
                            id: `rel_d${currentDepth}_${relationships.length}`,
                            from: parentEntity.name,
                            to: childEntity.name,
                            type: this.inferRelationshipType(parentEntity.type, childEntity.type),
                            strength: Math.max(0.2, 0.8 - (currentDepth * 0.1)), // Decrease strength with distance
                            confidence: Math.max(0.4, 0.8 - (currentDepth * 0.05)),
                            properties: {
                                distance: currentDepth,
                                isGenerated: true,
                                parentChild: true
                            }
                        };
                        relationships.push(relationship);
                    }
                });
            }

            if (newLevelEntities.length === 0) break;
            entityLayers.push([...newLevelEntities]);
            currentLevelEntities = newLevelEntities;
        }

        // Add cross-connections within and between layers for more realistic graph structure
        this.addCrossConnections(entityLayers, relationships, depth);

        // Update degree information
        centerEntityNode.properties.degree = relationships.filter(
            r => r.from === centerEntity || r.to === centerEntity
        ).length;

        return {
            centerEntity,
            entities,
            relationships,
            metadata: {
                source: 'partial_build',
                totalNodes: entities.length,
                totalRelationships: relationships.length,
                depth,
                maxNodes,
                isGenerated: true,
                algorithm: 'pattern_based_generation'
            }
        };
    }

    private addCrossConnections(entityLayers: any[][], relationships: any[], maxDepth: number): void {
        // Add connections within layers (peers)
        for (let layerIdx = 1; layerIdx < entityLayers.length; layerIdx++) {
            const layer = entityLayers[layerIdx];
            const numConnections = Math.min(layer.length, Math.floor(layer.length * 0.3));

            for (let i = 0; i < numConnections; i++) {
                const sourceIdx = Math.floor(Math.random() * layer.length);
                let targetIdx = Math.floor(Math.random() * layer.length);

                while (targetIdx === sourceIdx && layer.length > 1) {
                    targetIdx = Math.floor(Math.random() * layer.length);
                }

                if (sourceIdx !== targetIdx) {
                    const relationship = {
                        id: `cross_l${layerIdx}_${relationships.length}`,
                        from: layer[sourceIdx].name,
                        to: layer[targetIdx].name,
                        type: 'related',
                        strength: 0.3 + (Math.random() * 0.2),
                        confidence: 0.5,
                        properties: {
                            distance: layerIdx,
                            isGenerated: true,
                            crossConnection: 'peer'
                        }
                    };
                    relationships.push(relationship);
                }
            }
        }

        // Add some skip-level connections (shortcuts in the graph)
        if (entityLayers.length > 2) {
            const numSkipConnections = Math.min(5, Math.floor(entityLayers.length * 0.5));

            for (let i = 0; i < numSkipConnections; i++) {
                const sourceLayerIdx = Math.floor(Math.random() * (entityLayers.length - 2));
                const targetLayerIdx = sourceLayerIdx + 2; // Skip one layer

                if (targetLayerIdx < entityLayers.length) {
                    const sourceEntity = entityLayers[sourceLayerIdx][
                        Math.floor(Math.random() * entityLayers[sourceLayerIdx].length)
                    ];
                    const targetEntity = entityLayers[targetLayerIdx][
                        Math.floor(Math.random() * entityLayers[targetLayerIdx].length)
                    ];

                    const relationship = {
                        id: `skip_${sourceLayerIdx}_${targetLayerIdx}_${relationships.length}`,
                        from: sourceEntity.name,
                        to: targetEntity.name,
                        type: 'related',
                        strength: 0.2 + (Math.random() * 0.15),
                        confidence: 0.4,
                        properties: {
                            distance: targetLayerIdx,
                            isGenerated: true,
                            crossConnection: 'skip',
                            skipLevels: targetLayerIdx - sourceLayerIdx
                        }
                    };
                    relationships.push(relationship);
                }
            }
        }
    }

    private inferEntityType(entityName: string): string {
        const name = entityName.toLowerCase();

        // Technology/Software patterns
        if (name.includes('js') || name.includes('javascript') ||
            name.includes('python') || name.includes('react') ||
            name.includes('node') || name.includes('api') ||
            name.includes('framework') || name.includes('library')) {
            return 'technology';
        }

        // Product patterns
        if (name.includes('app') || name.includes('software') ||
            name.includes('tool') || name.includes('platform')) {
            return 'product';
        }

        // Organization patterns
        if (name.includes('company') || name.includes('corp') ||
            name.includes('inc') || name.includes('ltd') ||
            name.includes('microsoft') || name.includes('google') ||
            name.includes('github')) {
            return 'organization';
        }

        // Location patterns
        if (name.includes('city') || name.includes('country') ||
            name.includes('state') || name.includes('region')) {
            return 'location';
        }

        // Person patterns (simple heuristics)
        if (name.split(' ').length === 2 &&
            name.charAt(0) === name.charAt(0).toUpperCase()) {
            return 'person';
        }

        // Website patterns
        if (name.includes('.com') || name.includes('.org') ||
            name.includes('www.') || name.includes('http')) {
            return 'website';
        }

        // Default to concept
        return 'concept';
    }

    private generatePlausibleRelatedEntities(centerEntity: string, count: number, depth: number = 1): any[] {
        const entities: any[] = [];
        const centerType = this.inferEntityType(centerEntity);
        const baseName = centerEntity.toLowerCase();

        // Generate contextually relevant entities based on the center entity type and depth
        const generationStrategies = this.getEntityGenerationStrategies(centerType, baseName, depth);

        for (let i = 0; i < count && i < generationStrategies.length; i++) {
            const strategy = generationStrategies[i];
            const entity = {
                id: `${baseName}_related_d${depth}_${i}`,
                name: strategy.name,
                type: strategy.type,
                confidence: Math.max(0.3, 0.8 - (depth * 0.05) + (Math.random() * 0.2)),
                importance: Math.max(0.1, 0.5 - (depth * 0.05) + (Math.random() * 0.3)),
                category: depth === 1 ? 'related' : 'extended',
                description: strategy.description,
                properties: {
                    generationMethod: strategy.method,
                    isGenerated: true,
                    distance: depth,
                    sourceEntity: centerEntity
                }
            };
            entities.push(entity);
        }

        return entities;
    }

    private getEntityGenerationStrategies(centerType: string, baseName: string, depth: number = 1): any[] {
        const strategies: any[] = [];
        const depthSuffix = depth > 1 ? ` (Level ${depth})` : '';

        // Generate different types of entities based on depth
        if (depth <= 2) {
            // Close relationships
            switch (centerType) {
                case 'technology':
                    strategies.push(
                        { name: `${baseName} Framework${depthSuffix}`, type: 'technology', method: 'framework_variant', description: `Framework built on ${baseName}` },
                        { name: `${baseName} Documentation${depthSuffix}`, type: 'document', method: 'documentation', description: `Official documentation for ${baseName}` },
                        { name: `${baseName} Community${depthSuffix}`, type: 'organization', method: 'community', description: `Community around ${baseName}` },
                        { name: `${baseName} Tutorial${depthSuffix}`, type: 'document', method: 'educational', description: `Tutorial for learning ${baseName}` },
                        { name: `Development Tools${depthSuffix}`, type: 'concept', method: 'domain_concept', description: 'Software development tools' }
                    );
                    break;

                case 'product':
                    strategies.push(
                        { name: `${baseName} User Guide${depthSuffix}`, type: 'document', method: 'documentation', description: `User guide for ${baseName}` },
                        { name: `${baseName} Support${depthSuffix}`, type: 'organization', method: 'support_service', description: `Support service for ${baseName}` },
                        { name: `${baseName} Features${depthSuffix}`, type: 'concept', method: 'feature_set', description: `Feature set of ${baseName}` },
                        { name: `Customer Feedback${depthSuffix}`, type: 'concept', method: 'user_interaction', description: 'User feedback and reviews' }
                    );
                    break;

                case 'organization':
                    strategies.push(
                        { name: `${baseName} Products${depthSuffix}`, type: 'product', method: 'org_output', description: `Products developed by ${baseName}` },
                        { name: `${baseName} Team${depthSuffix}`, type: 'organization', method: 'sub_organization', description: `Team within ${baseName}` },
                        { name: `${baseName} Website${depthSuffix}`, type: 'website', method: 'web_presence', description: `Official website of ${baseName}` },
                        { name: `Industry Context${depthSuffix}`, type: 'concept', method: 'domain_context', description: 'Industry sector' }
                    );
                    break;

                case 'concept':
                    strategies.push(
                        { name: `${baseName} Definition${depthSuffix}`, type: 'document', method: 'conceptual_definition', description: `Definition and explanation of ${baseName}` },
                        { name: `${baseName} Applications${depthSuffix}`, type: 'concept', method: 'application_domain', description: `Applications of ${baseName}` },
                        { name: `${baseName} Research${depthSuffix}`, type: 'document', method: 'research_material', description: `Research related to ${baseName}` },
                        { name: `Theory Background${depthSuffix}`, type: 'concept', method: 'theoretical_framework', description: 'Theoretical framework' }
                    );
                    break;

                default:
                    strategies.push(
                        { name: `${baseName} Information${depthSuffix}`, type: 'document', method: 'generic_info', description: `Information about ${baseName}` },
                        { name: `Related Topic${depthSuffix}`, type: 'concept', method: 'generic_relation', description: `Topic related to ${baseName}` },
                        { name: `Context${depthSuffix}`, type: 'concept', method: 'contextual', description: 'Contextual information' }
                    );
            }
        } else if (depth <= 5) {
            // Medium-distance relationships - more generic but still relevant
            const intermediateEntities = [
                { name: `${baseName} Ecosystem${depthSuffix}`, type: 'concept', method: 'ecosystem', description: `Broader ecosystem around ${baseName}` },
                { name: `${baseName} Standards${depthSuffix}`, type: 'document', method: 'standards', description: `Standards related to ${baseName}` },
                { name: `${baseName} Case Studies${depthSuffix}`, type: 'document', method: 'case_studies', description: `Case studies involving ${baseName}` },
                { name: `${baseName} Best Practices${depthSuffix}`, type: 'concept', method: 'best_practices', description: `Best practices for ${baseName}` },
                { name: `${baseName} Integration${depthSuffix}`, type: 'concept', method: 'integration', description: `Integration aspects of ${baseName}` },
                { name: `${baseName} Market${depthSuffix}`, type: 'concept', method: 'market_context', description: `Market context for ${baseName}` }
            ];
            strategies.push(...intermediateEntities);
        } else {
            // Far-distance relationships - very generic
            const distantEntities = [
                { name: `General ${centerType}${depthSuffix}`, type: centerType, method: 'generic_type', description: `General ${centerType} concepts` },
                { name: `Industry Trends${depthSuffix}`, type: 'concept', method: 'industry_trends', description: 'Broader industry trends' },
                { name: `Global Context${depthSuffix}`, type: 'concept', method: 'global_context', description: 'Global context and environment' },
                { name: `Future Outlook${depthSuffix}`, type: 'concept', method: 'future_outlook', description: 'Future predictions and outlook' },
                { name: `Historical Context${depthSuffix}`, type: 'concept', method: 'historical', description: 'Historical background and context' },
                { name: `Comparative Analysis${depthSuffix}`, type: 'document', method: 'comparative', description: 'Comparative analysis with alternatives' }
            ];
            strategies.push(...distantEntities);
        }

        // Add some randomized alternative entities to increase variety
        const alternativeTypes = ['technology', 'product', 'organization', 'concept', 'document', 'website'];
        for (let i = 0; i < Math.min(3, Math.max(1, 8 - depth)); i++) {
            const randomType = alternativeTypes[Math.floor(Math.random() * alternativeTypes.length)];
            strategies.push({
                name: `${baseName} ${randomType.charAt(0).toUpperCase() + randomType.slice(1)} ${i + 1}${depthSuffix}`,
                type: randomType,
                method: 'random_generation',
                description: `Generated ${randomType} related to ${baseName} at depth ${depth}`
            });
        }

        return strategies;
    }

    private inferRelationshipType(sourceType: string, targetType: string): string {
        // Define relationship types based on entity type combinations
        const relationshipMap: { [key: string]: string } = {
            'technology-document': 'documented_by',
            'technology-organization': 'developed_by',
            'technology-concept': 'implements',
            'product-document': 'described_by',
            'product-organization': 'created_by',
            'organization-website': 'owns',
            'organization-person': 'employs',
            'concept-document': 'defined_in',
            'concept-concept': 'related_to'
        };

        const key = `${sourceType}-${targetType}`;
        const reverseKey = `${targetType}-${sourceType}`;

        return relationshipMap[key] || relationshipMap[reverseKey] || 'related';
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
