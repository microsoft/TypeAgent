// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AnalyticsData } from "./interfaces/analyticsTypes";
import type { SearchFilters, SearchResult } from "./interfaces/searchTypes";
import type {
    ImportOptions,
    ImportResult,
    ProgressCallback,
    FolderImportOptions,
} from "./importTypes/websiteImport.types";
import {
    checkViewHealth,
    connectViewEvents,
    invokeView,
    onViewEvent,
} from "./viewClient";
export type {
    SearchFilters,
    SearchResult,
    Website,
    EntityMatch,
} from "./interfaces/searchTypes";

export class NotificationManager {
    showSuccess(message: string): void {
        this.show(message, "success");
    }
    showError(message: string, retry?: () => void): void {
        this.show(message, "danger", retry);
    }
    showWarning(message: string): void {
        this.show(message, "warning");
    }
    showInfo(message: string): void {
        this.show(message, "info");
    }
    showProgress(message: string): void {
        this.show(message, "info");
    }
    showEnhancedNotification(
        type: string,
        title: string,
        message: string,
    ): void {
        this.show(`${title}: ${message}`, type);
    }
    showTemporaryStatus(message: string, type: string): void {
        this.show(message, type);
    }
    hideNotification(id: string): void {
        document.getElementById(id)?.remove();
    }
    handleNotificationAction(id: string, _actionLabel: string): void {
        this.hideNotification(id);
    }
    private show(message: string, type: string, retry?: () => void): void {
        const alert = document.createElement("div");
        alert.className = `alert alert-${type} alert-dismissible position-fixed`;
        alert.style.cssText =
            "top:1rem;right:1rem;z-index:2000;max-width:32rem";
        alert.setAttribute("role", "alert");
        alert.textContent = message;
        const close = document.createElement("button");
        close.className = "btn-close";
        close.setAttribute("aria-label", "Dismiss");
        close.onclick = () => alert.remove();
        alert.append(close);
        if (retry) {
            const button = document.createElement("button");
            button.className = "btn btn-outline-danger ms-2";
            button.textContent = "Retry";
            button.onclick = retry;
            alert.append(button);
        }
        document.body.append(alert);
        if (type !== "danger") setTimeout(() => alert.remove(), 6000);
    }
}

export class ViewService {
    private connections = new Set<(connected: boolean) => void>();
    private progress = new Map<string, () => void>();
    onConnectionStatusChange(callback: (connected: boolean) => void): void {
        this.connections.add(callback);
        void this.checkWebSocketConnection().then(({ connected }) =>
            callback(connected),
        );
    }
    removeConnectionStatusListener(
        callback: (connected: boolean) => void,
    ): void {
        this.connections.delete(callback);
    }
    async checkWebSocketConnection(): Promise<{ connected: boolean }> {
        const connected = await checkViewHealth().catch(() => false);
        this.connections.forEach((callback) => callback(connected));
        return { connected };
    }
    getLibraryStats() {
        return invokeView("getLibraryStats") as Promise<{
            totalWebsites: number;
            totalBookmarks: number;
            totalHistory: number;
            topDomains: number;
            lastImport?: number;
        }>;
    }
    async getAnalyticsData(
        options: Record<string, unknown> = {},
    ): Promise<AnalyticsResponse> {
        const result = (await invokeView(
            "getAnalyticsData",
            options,
        )) as AnalyticsData & { error?: string };
        if (result.error) throw new Error(result.error);
        return { success: true, analytics: result };
    }
    async searchWebMemories(
        query: string,
        filters: SearchFilters,
    ): Promise<SearchResult> {
        const response = (await invokeView("searchWebMemories", {
            query,
            generateAnswer: true,
            includeRelatedEntities: true,
            enableAdvancedSearch: true,
            limit: 50,
            minScore: filters.minRelevance ?? 0.3,
            domain: filters.domain,
            source:
                filters.sourceType === "bookmarks"
                    ? "bookmark"
                    : filters.sourceType,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
        })) as RawSearchResponse;
        if (response.error) throw new Error(response.error);
        if (!Array.isArray(response.websites))
            throw new Error("Search returned an invalid response");
        return {
            websites: response.websites.map((website) => ({
                ...website,
                score: website.score ?? website.relevanceScore,
            })),
            summary: {
                text: response.answer || "",
                totalFound:
                    response.summary?.totalFound ?? response.websites.length,
                searchTime: response.summary?.searchTime ?? 0,
                sources: response.answerSources || [],
                entities: response.relatedEntities || [],
            },
            query,
            filters,
            topTopics: response.topTopics || [],
            suggestedFollowups: response.suggestedFollowups || [],
            relatedEntities: response.relatedEntities || [],
            answerEnhancement: response.answerEnhancement,
        };
    }
    getTopicTimelines(
        parameters: TopicTimelineParams,
    ): Promise<TopicTimelineResponse> {
        return invokeView("getTopicTimelines", parameters);
    }
    getKnowledgeGraphStatus() {
        return invokeView("getKnowledgeGraphStatus");
    }
    buildKnowledgeGraph() {
        return invokeView("buildKnowledgeGraph");
    }
    rebuildKnowledgeGraph() {
        return invokeView("rebuildKnowledgeGraph");
    }
    getGlobalGraphLayoutData(parameters: {
        maxNodes?: number;
        includeConnectivity?: boolean;
    }) {
        return invokeView("getGlobalGraphLayoutData", parameters);
    }
    getEntityNeighborhood(parameters: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    }) {
        return invokeView("getEntityNeighborhood", parameters);
    }
    getEntityNeighborhoodLayoutData(
        entityId: string,
        depth?: number,
        maxNodes?: number,
    ) {
        return invokeView("getEntityNeighborhoodLayoutData", {
            entityId,
            depth,
            maxNodes,
        });
    }
    getGlobalImportanceLayer(maxNodes = 5000, includeConnectivity = true) {
        return invokeView("getGlobalImportanceLayer", {
            maxNodes,
            includeConnectivity,
        });
    }
    getImportanceStatistics() {
        return invokeView("getImportanceStatistics");
    }
    getViewportBasedNeighborhood(
        centerEntity: string,
        viewportNodeNames: string[],
        maxNodes: number,
        options: {
            importanceWeighting?: boolean | number;
            includeGlobalContext?: boolean;
            exploreFromAllViewportNodes?: boolean;
            minDepthFromViewport?: number;
        } = {},
    ) {
        return invokeView("getViewportBasedNeighborhood", {
            ...options,
            importanceWeighting:
                typeof options.importanceWeighting === "boolean"
                    ? Number(options.importanceWeighting)
                    : options.importanceWeighting,
            centerEntity,
            viewportNodeNames,
            maxNodes,
        });
    }
    getTopicImportanceLayer(maxNodes = 500, minImportanceThreshold = 0) {
        return invokeView("getTopicImportanceLayer", {
            maxNodes,
            minImportanceThreshold,
        });
    }
    getEntityDetails(entityName: string) {
        return invokeView("getEntityDetails", { entityName });
    }
    getTopicDetails(topicId: string) {
        return invokeView("getTopicDetails", { topicId });
    }
    onImportProgress(importId: string, callback: ProgressCallback): void {
        this.removeImportProgress(importId);
        this.progress.set(
            importId,
            onViewEvent("importProgress", (payload) => {
                const progress = normalizeImportProgress(payload);
                if (progress.importId === importId) callback(progress);
            }),
        );
    }
    removeImportProgress(importId: string): void {
        this.progress.get(importId)?.();
        this.progress.delete(importId);
    }
    async importBrowserData(
        options: ImportOptions,
        importId: string,
    ): Promise<ImportResult> {
        await connectViewEvents();
        return invokeView("importWebsiteDataWithProgress", {
            ...options,
            importId,
            totalItems: options.limit ?? 0,
            progressCallback: true,
        });
    }
    async importHtmlFolder(
        folderPath: string,
        options: FolderImportOptions,
        importId: string,
    ): Promise<ImportResult> {
        await connectViewEvents();
        const {
            mode,
            recursive,
            fileTypes,
            limit,
            maxFileSize,
            skipHidden,
            preserveStructure,
        } = options;
        return invokeView("importHtmlFolder", {
            folderPath,
            importId,
            options: {
                mode,
                recursive,
                fileTypes,
                limit,
                maxFileSize,
                skipHidden,
                preserveStructure,
            },
        });
    }
    async cancelImport(importId: string): Promise<void> {
        const result = await invokeView("cancelImport", { importId });
        if (!result.success || !result.cancelled)
            throw new Error(result.error || "This import cannot be cancelled");
    }
}

export const extensionService = new ViewService();
export function createExtensionService(): ViewService {
    return extensionService;
}
export const notificationManager = new NotificationManager();
window.addEventListener("viewServiceError", (event) =>
    notificationManager.showError((event as CustomEvent<string>).detail),
);

export class EventManager {
    static setupMessageListener(
        callback: (
            message: { type: string; progress: unknown; importId?: string },
            sender?: unknown,
            sendResponse?: unknown,
        ) => void,
    ): void {
        onViewEvent("importProgress", (payload) => {
            const progress = normalizeImportProgress(payload);
            callback({
                type: "importProgress",
                importId: progress.importId,
                progress,
            });
        });
        onViewEvent("knowledgeExtractionProgress", (payload) =>
            callback({
                progress: payload,
                type: "knowledgeExtractionProgress",
            }),
        );
    }
}

function normalizeImportProgress(
    payload: unknown,
): Parameters<ProgressCallback>[0] {
    const event = payload as {
        importId: string;
        phase: Parameters<ProgressCallback>[0]["phase"];
        current: number;
        total: number;
        description: string;
        errors?: Array<{ message: string; timestamp: number }>;
        summary?: Parameters<ProgressCallback>[0]["summary"];
        itemDetails?: Parameters<ProgressCallback>[0]["itemDetails"];
    };
    return {
        importId: event.importId,
        phase: event.phase,
        processedItems: event.current,
        totalItems: event.total,
        currentItem: event.description,
        errors: (event.errors || []).map((error) => ({
            ...error,
            type: "processing",
        })),
        summary: event.summary,
        itemDetails: event.itemDetails,
    };
}

type RawSearchResponse = {
    websites: Array<
        SearchResult["websites"][number] & { relevanceScore?: number }
    >;
    answer?: string;
    error?: string;
    summary?: { totalFound?: number; searchTime?: number };
    answerSources?: SearchResult["summary"]["sources"];
    relatedEntities?: SearchResult["summary"]["entities"];
    topTopics?: string[];
    suggestedFollowups?: string[];
    answerEnhancement?: SearchResult["answerEnhancement"];
};

type TopicTimelineParams = {
    topicNames: string[];
    maxTimelineEntries?: number;
    timeRange?: { startDate?: string; endDate?: string };
    includeRelatedTopics?: boolean;
    neighborhoodDepth?: number;
};
type TopicTimelineResponse = {
    success: boolean;
    timelines: unknown[];
    error?: string;
};
type AnalyticsResponse = {
    success: boolean;
    analytics: AnalyticsData;
    error?: string;
};
export interface AnalyticsServices {
    loadAnalyticsData(): Promise<AnalyticsResponse>;
}
export interface SearchServices {
    performSearch(
        query: string,
        filters?: SearchFilters,
    ): Promise<SearchResult>;
    getTopicTimelines(
        parameters: TopicTimelineParams,
    ): Promise<TopicTimelineResponse>;
}
export class DefaultAnalyticsServices implements AnalyticsServices {
    constructor(private service: ViewService) {}
    loadAnalyticsData(): Promise<AnalyticsResponse> {
        return this.service.getAnalyticsData({
            timeRange: "30d",
            includeQuality: true,
            includeProgress: true,
            topDomainsLimit: 10,
            activityGranularity: "day",
        });
    }
}
export class DefaultSearchServices implements SearchServices {
    constructor(private service: ViewService) {}
    performSearch(
        query: string,
        filters: SearchFilters = {},
    ): Promise<SearchResult> {
        return this.service.searchWebMemories(query, filters);
    }
    getTopicTimelines(
        parameters: TopicTimelineParams,
    ): Promise<TopicTimelineResponse> {
        return this.service.getTopicTimelines(parameters);
    }
}
