// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared utilities for knowledge extraction features
 * Consolidates common functionality from knowledgeLibrary.ts and pageKnowledge.ts
 */

import {
    ExtensionServiceBase,
    SearchFilters,
    SearchResult,
} from "./extensionServiceBase";
import type { ProgressCallback } from "../interfaces/websiteImport.types";
import type { KnowledgeProgressCallback } from "../interfaces/knowledgeExtraction.types";

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
                const messageType = message.type || 'unknown';
                console.time(`[Perf] Chrome runtime message: ${messageType}`);
                console.log(`[Perf] Sending message: ${JSON.stringify({
                    type: messageType,
                    hasParams: Object.keys(message).length > 1,
                    paramKeys: Object.keys(message).filter(k => k !== 'type')
                })}`);

                const response = await chrome.runtime.sendMessage(message);
                console.timeEnd(`[Perf] Chrome runtime message: ${messageType}`);

                console.log(`[Perf] Message response: ${JSON.stringify({
                    type: messageType,
                    hasResponse: !!response,
                    hasError: !!(response && response.error),
                    responseKeys: response ? Object.keys(response) : []
                })}`);

                if (response && response.error) {
                    throw new Error(response.error);
                }
                return response;
            } catch (error) {
                console.error("Chrome runtime message failed:", error);
                console.timeEnd(`[Perf] Chrome runtime message: ${message.type || 'unknown'}`);
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
