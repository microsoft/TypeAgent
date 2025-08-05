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

// ===================================================================
// INTERFACES AND TYPES
// ===================================================================

export interface NotificationAction {
    label: string;
    action: () => void;
    style?: "primary" | "secondary" | "success" | "danger";
}

// Re-export types from base class for backward compatibility
export {
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
        if (type === "searchWebMemories" && chromeMessage.parameters) {
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

export interface EntityCacheServices {
    getEntity(entityName: string): Promise<any>;
    getCacheStats(): Promise<any>;
    clearAll(): Promise<void>;
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

    constructor(extensionService?: ExtensionServiceBase) {
        this.extensionService = extensionService || null;
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
                // Convert website search results to entity format with rich data
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
                        .filter(
                            (entity: any) => entity.name && entity.name.trim(),
                        );
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

    async getEntityGraph(centerEntity: string, depth: number): Promise<any> {
        try {
            if (!this.extensionService) {
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
                return { centerEntity, entities: [], relationships: [] };
            }

            // Create entities from primary search results with rich data
            const primaryEntities = primarySearch.websites
                .map((website: any, index: number) => {
                    const richEntity = this.extractRichEntityData(
                        centerEntity,
                        website,
                        index,
                    );
                    // Override ID and category for primary entities
                    return {
                        ...richEntity,
                        id: `primary_${index}`,
                        category: "primary",
                    };
                })
                .filter((entity: any) => entity.name && entity.name.trim())
                .slice(0, 15);

            // Find the center entity from the search results by case-insensitive name match
            let centerEntityNode = null;
            const centerEntityLower = centerEntity.toLowerCase();

            // First, try to find a direct entity match from related entities
            if (
                primarySearch.relatedEntities &&
                primarySearch.relatedEntities.length > 0
            ) {
                for (const relatedEntity of primarySearch.relatedEntities) {
                    const entityName =
                        typeof relatedEntity === "string"
                            ? relatedEntity
                            : relatedEntity.name;

                    if (
                        entityName &&
                        entityName.toLowerCase() === centerEntityLower
                    ) {
                        // Found the center entity in related entities - get its rich data
                        centerEntityNode = {
                            id: "center",
                            name: centerEntity,
                            type: Array.isArray(relatedEntity.type)
                                ? relatedEntity.type.join(", ")
                                : relatedEntity.type ||
                                  this.inferEntityType(relatedEntity),
                            confidence:
                                typeof relatedEntity === "object"
                                    ? relatedEntity.confidence || 0.9
                                    : 0.9,
                            category: "center",
                            description: `Center entity: ${centerEntity}`,
                            facets:
                                typeof relatedEntity === "object" &&
                                relatedEntity.facets
                                    ? relatedEntity.facets
                                    : [],
                            // Add default properties
                            mentionCount: 1,
                            visitCount: 0,
                            dominantDomains: [],
                            topicAffinity:
                                primarySearch.topTopics?.slice(0, 5) || [],
                            aliases: [],
                            relationships: [],
                            contextSnippets: [],
                            firstSeen: relatedEntity.firstSeen,
                            lastSeen: relatedEntity.lastSeen,
                        };
                        break;
                    }
                }
            }

            // If not found in related entities, look for matching entity in website knowledge
            if (!centerEntityNode) {
                for (const website of primarySearch.websites) {
                    const knowledge = website.getKnowledge
                        ? website.getKnowledge()
                        : null;
                    if (knowledge && knowledge.entities) {
                        const matchingEntity = knowledge.entities.find(
                            (e: any) =>
                                e.name &&
                                e.name.toLowerCase() === centerEntityLower,
                        );

                        if (matchingEntity) {
                            // Found the center entity in website knowledge
                            centerEntityNode = {
                                id: "center",
                                name: matchingEntity.name,
                                type: Array.isArray(matchingEntity.type)
                                    ? matchingEntity.type.join(", ")
                                    : matchingEntity.type ||
                                      this.inferEntityType(centerEntity),
                                confidence: matchingEntity.confidence || 0.9,
                                category: "center",
                                description:
                                    matchingEntity.description ||
                                    `Center entity: ${centerEntity}`,
                                facets: matchingEntity.facets || [],
                                // Add enhanced properties from website context
                                mentionCount: this.countEntityMentions(
                                    knowledge,
                                    centerEntity,
                                ),
                                visitCount: website.visitCount || 0,
                                dominantDomains: [
                                    this.extractDomain(website.url || ""),
                                ].filter((d) => d !== "unknown"),
                                topicAffinity:
                                    knowledge.topics?.slice(0, 5) || [],
                                aliases: matchingEntity.aliases || [],
                                relationships: this.extractRelationships(
                                    knowledge,
                                    centerEntity,
                                ),
                                contextSnippets: this.extractContextSnippets(
                                    knowledge.textChunks || [knowledge.content],
                                    centerEntity,
                                    3,
                                ),
                                firstSeen: matchingEntity.firstSeen,
                                lastSeen: matchingEntity.lastSeen,
                                url: website.url,
                                domain: this.extractDomain(website.url || ""),
                            };
                            break;
                        }
                    }
                }
            }

            // If still not found, create a fallback center entity
            if (!centerEntityNode) {
                centerEntityNode = {
                    id: "center",
                    name: centerEntity,
                    type: this.inferEntityType(centerEntity),
                    confidence: 0.8,
                    category: "center",
                    description: `Center entity: ${centerEntity}`,
                    facets: [],
                    mentionCount: 1,
                    visitCount: 0,
                    dominantDomains: [],
                    topicAffinity: primarySearch.topTopics?.slice(0, 5) || [],
                    aliases: [],
                    relationships: [],
                    contextSnippets: [],
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                };
            }

            // If depth > 1, perform related searches
            let relatedEntities: any[] = [];
            if (
                depth > 1 &&
                primarySearch.relatedEntities &&
                primarySearch.relatedEntities.length > 0
            ) {
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
                                    const richEntity =
                                        this.extractRichEntityData(
                                            relatedName,
                                            website,
                                            index,
                                        );
                                    // Override properties for related entities
                                    return {
                                        ...richEntity,
                                        id: `related_${relatedName.replace(/\s+/g, "_")}_${index}`,
                                        category: "related",
                                        parentEntity: relatedName,
                                        confidence: Math.min(
                                            richEntity.confidence,
                                            0.8,
                                        ), // Cap confidence for related entities
                                    };
                                })
                                .filter(
                                    (entity: any) =>
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

            return {
                centerEntity,
                entities: allEntities,
                relationships: relationships,
                metadata: {
                    searchDepth: depth,
                    totalSources: primarySearch.websites.length,
                    hasRelatedExpansion: relatedEntities.length > 0,
                    generatedAt: new Date().toISOString(),
                    ...primarySearch.metadata,
                },
                topTopics: primarySearch.topTopics || [],
                summary: primarySearch.summary || null,
                answerSources: primarySearch.answerSources || [],
                relatedEntities: primarySearch.relatedEntities || [],
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
        // For now, just trigger a fresh search
        const refreshedData = await this.searchByEntity(entityName, {
            maxResults: 5,
        });

        return refreshedData.entities.length > 0 ? refreshedData : null;
    }

    /**
     * Smart entity search with fallback strategy
     * Uses entity search first, then topic search as fallback
     */
    private async performEntitySearchWithFallback(
        entityName: string,
        options: any = {},
    ): Promise<any> {
        if (!this.extensionService) {
            throw new Error("ChromeExtensionService not available");
        }

        const startTime = performance.now();
        const maxResults = options.maxResults || 10;
        let searchResult: any = null;
        let searchMethod = "unknown";

        try {
            // Strategy 1: Direct entity search (fastest)
            const entityResults = await this.extensionService.searchByEntities(
                [entityName],
                "",
                maxResults,
            );

            if (
                entityResults &&
                entityResults.websites &&
                entityResults.websites.length > 0
            ) {
                searchResult = {
                    websites: entityResults.websites,
                    relatedEntities: entityResults.relatedEntities || [],
                    topTopics: entityResults.topTopics || [],
                    summary: entityResults.summary || null,
                    metadata: entityResults.metadata || {},
                    answerSources: entityResults.answerSources || [],
                };
                searchMethod = "entity";
                console.log(
                    "✅ Entity search found %d results for: %s",
                    entityResults.websites.length,
                    entityName,
                    `Related entities: ${entityResults.relatedEntities?.length || 0}`,
                    `Top topics: ${entityResults.topTopics?.length || 0}`,
                );
            }
        } catch (error) {
            console.warn("Entity search failed for %s:", entityName, error);
        }

        // Strategy 2: Topic search if entity search fails
        if (!searchResult || searchResult.websites.length < 1) {
            try {
                console.log(`Trying topic search for: ${entityName}`);
                const topicResults = await this.extensionService.searchByTopics(
                    [entityName],
                    "",
                    maxResults,
                );

                if (
                    topicResults &&
                    topicResults.websites &&
                    topicResults.websites.length > 0
                ) {
                    // Merge with existing results or use as primary
                    const existingWebsites = searchResult?.websites || [];
                    const existingRelatedEntities =
                        searchResult?.relatedEntities || [];
                    const existingTopTopics = searchResult?.topTopics || [];

                    searchResult = {
                        websites: [
                            ...existingWebsites,
                            ...topicResults.websites,
                        ].slice(0, maxResults),
                        relatedEntities: [
                            ...existingRelatedEntities,
                            ...(topicResults.relatedEntities || []),
                        ],
                        topTopics: [
                            ...existingTopTopics,
                            ...(topicResults.topTopics || []),
                        ],
                        summary:
                            topicResults.summary ||
                            searchResult?.summary ||
                            null,
                        metadata: {
                            ...searchResult?.metadata,
                            ...topicResults.metadata,
                        },
                        answerSources: [
                            ...(searchResult?.answerSources || []),
                            ...(topicResults.answerSources || []),
                        ],
                    };
                    searchMethod =
                        searchResult.websites.length > existingWebsites.length
                            ? "topic"
                            : searchMethod;
                    console.log(
                        "✅ Topic search found %d additional results for: %s",
                        topicResults.websites.length,
                        entityName,
                        "Added related entities: %d",
                        topicResults.relatedEntities?.length || 0,
                        "Added topics: %d",
                        topicResults.topTopics?.length || 0,
                    );
                }
            } catch (error) {
                console.warn("Topic search failed for %s:", entityName, error);
            }
        }

        // If no results from entity or topic search, return empty result
        if (!searchResult || searchResult.websites.length === 0) {
            console.log(
                `No results found for entity: ${entityName} using entity or topic search`,
            );
            searchResult = {
                websites: [],
                relatedEntities: [],
                topTopics: [],
                metadata: {},
                answerSources: [],
            };
            searchMethod = "no_results";
        }

        // Add metadata about which search method was used
        const endTime = performance.now();
        const searchTime = Math.round(endTime - startTime);

        if (searchResult) {
            searchResult.searchMethod = searchMethod;
            searchResult.searchTerm = entityName;
            searchResult.searchTimeMs = searchTime;
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
            return this.enhanceEntityWithKnowledge(
                baseEntity,
                knowledge,
                entityName,
            );
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
                searchEntityName.toLowerCase().includes(e.name.toLowerCase()),
        );

        if (matchingEntity) {
            enhancedEntity.aliases = matchingEntity.aliases || [];
            enhancedEntity.entityType =
                matchingEntity.type || enhancedEntity.type;
            enhancedEntity.confidence = Math.max(
                enhancedEntity.confidence,
                matchingEntity.confidence || 0,
            );
            // Include facets if available
            if (matchingEntity.facets) {
                enhancedEntity.facets = matchingEntity.facets;
            }
        }

        // Add topic affinity
        enhancedEntity.topicAffinity =
            knowledge.topics
                ?.map((t: any) =>
                    typeof t === "string" ? t : t.name || t.topic || t,
                )
                .slice(0, 5) || [];

        // Add context snippets from text chunks
        if (knowledge.textChunks || knowledge.content) {
            const textContent = knowledge.textChunks || [knowledge.content];
            enhancedEntity.contextSnippets = this.extractContextSnippets(
                textContent,
                searchEntityName,
                3,
            );
        }

        // Add relationships from knowledge
        enhancedEntity.relationships = this.extractRelationships(
            knowledge,
            searchEntityName,
        );

        // Add temporal data
        enhancedEntity.firstSeen =
            knowledge.extractionDate ||
            knowledge.visitDate ||
            baseEntity.lastVisited ||
            new Date().toISOString();
        enhancedEntity.lastSeen =
            knowledge.lastUpdated ||
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
                if (typeof chunk === "string") {
                    const matches = chunk.toLowerCase().split(searchTerm);
                    count += Math.max(0, matches.length - 1);
                }
            });
        }

        // Count in extracted entities
        if (knowledge.entities && Array.isArray(knowledge.entities)) {
            knowledge.entities.forEach((entity: any) => {
                if (
                    entity.name &&
                    entity.name.toLowerCase().includes(searchTerm)
                ) {
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
            if (!chunk || typeof chunk !== "string") continue;

            const lowerChunk = chunk.toLowerCase();
            const index = lowerChunk.indexOf(searchTerm);

            if (index !== -1 && snippets.length < maxSnippets) {
                // Extract context around the entity mention
                const start = Math.max(0, index - 50);
                const end = Math.min(
                    chunk.length,
                    index + searchTerm.length + 100,
                );
                let snippet = chunk.slice(start, end).trim();

                // Clean up snippet
                if (start > 0) snippet = "..." + snippet;
                if (end < chunk.length) snippet = snippet + "...";

                // Avoid duplicate snippets
                if (!snippets.some((s) => s.includes(snippet.slice(10, -10)))) {
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
                if (
                    entity.name &&
                    !entity.name.toLowerCase().includes(searchTerm) &&
                    entity.confidence > 0.5
                ) {
                    relationships.push({
                        relatedEntity: entity.name,
                        relationshipType: "co_occurs_with",
                        confidence: entity.confidence,
                        strength: entity.confidence * 0.8,
                        evidenceSources: [knowledge.url || "content"],
                        firstObserved:
                            knowledge.extractionDate ||
                            new Date().toISOString(),
                        lastObserved:
                            knowledge.lastUpdated || new Date().toISOString(),
                    });
                }
            });
        }

        // Extract from topics (entity-topic relationships)
        if (knowledge.topics && Array.isArray(knowledge.topics)) {
            knowledge.topics.slice(0, 3).forEach((topic: any) => {
                const topicName =
                    typeof topic === "string"
                        ? topic
                        : topic.name || topic.topic;
                if (topicName) {
                    relationships.push({
                        relatedEntity: topicName,
                        relationshipType: "related_to_topic",
                        confidence:
                            typeof topic === "object"
                                ? topic.relevance || 0.7
                                : 0.7,
                        strength: 0.6,
                        evidenceSources: [knowledge.url || "content"],
                        firstObserved:
                            knowledge.extractionDate ||
                            new Date().toISOString(),
                        lastObserved:
                            knowledge.lastUpdated || new Date().toISOString(),
                    });
                }
            });
        }

        return relationships.slice(0, 5); // Limit to top 5 relationships
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

        return Array.from(seen.values()).sort(
            (a, b) => b.confidence - a.confidence,
        );
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

        // Document co-occurrence relationships - entities that appear together in the same document
        const documentCoOccurrences =
            this.generateDocumentCoOccurrenceRelationships(entities);
        relationships.push(...documentCoOccurrences);

        return relationships;
    }

    /**
     * Generate relationships between entities that co-occur in the same document
     */
    private generateDocumentCoOccurrenceRelationships(entities: any[]): any[] {
        const relationships: any[] = [];
        const documentEntityMap = new Map<string, any[]>();

        // Group entities by their source document URL
        entities.forEach((entity) => {
            if (entity.url && entity.category === "primary") {
                const url = entity.url;
                if (!documentEntityMap.has(url)) {
                    documentEntityMap.set(url, []);
                }
                documentEntityMap.get(url)!.push(entity);
            }
        });

        // For each document with multiple entities, create co-occurrence relationships
        documentEntityMap.forEach((documentEntities, documentUrl) => {
            if (documentEntities.length > 1) {
                // Create relationships between all pairs of entities in the same document
                for (let i = 0; i < documentEntities.length; i++) {
                    for (let j = i + 1; j < documentEntities.length; j++) {
                        const entity1 = documentEntities[i];
                        const entity2 = documentEntities[j];

                        if (
                            entity1.name &&
                            entity2.name &&
                            entity1.name.trim() !== entity2.name.trim()
                        ) {
                            // Calculate co-occurrence strength based on confidence of both entities
                            const strength = Math.min(
                                (entity1.confidence || 0.5) *
                                    (entity2.confidence || 0.5) *
                                    1.2,
                                0.9,
                            );

                            relationships.push({
                                id: `co_occurrence_${entity1.id}_${entity2.id}`,
                                from: entity1.name.trim(),
                                to: entity2.name.trim(),
                                type: "co_occurrence",
                                strength: strength,
                                source: documentUrl,
                                direction: "bidirectional",
                                category: "co_occurrence",
                                evidence: `Both entities appear in: ${this.extractDomain(documentUrl)}`,
                            });
                        }
                    }
                }
            }
        });

        console.log(
            `Generated ${relationships.length} document co-occurrence relationships from ${documentEntityMap.size} documents`,
        );

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
