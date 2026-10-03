// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnalyticsServices } from "./knowledgeUtilities";
import type {
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgeKind,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import {
    mountKnowledgeCollection,
    KNOWLEDGE_PREVIEW_SIZE,
} from "./memoryKnowledgeCollection";
import {
    WebExploreRoot,
    renderSources,
    validateAnalyticsResponse,
    type WebExploreCallbacks,
} from "./memoryHubWebExploreRoot";

type RecentKnowledgeItem = {
    name?: string;
    topic?: string;
    type?: string;
    category?: string;
    from?: string;
    to?: string;
    relationship?: string;
    fromPage?: string;
};

export class KnowledgeAnalyticsPanel {
    private container: HTMLElement;
    private services: AnalyticsServices;
    private analyticsData: any = null;
    private isConnected: boolean = true;
    private owner: WebExploreRoot;
    private collections: ReturnType<typeof mountKnowledgeCollection>[] = [];

    constructor(
        container: HTMLElement,
        services: AnalyticsServices,
        private callbacks?: WebExploreCallbacks,
    ) {
        this.container = container;
        this.services = services;
        this.owner = new WebExploreRoot(
            container,
            callbacks ?? { onError: (error) => console.error(error) },
        );
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.owner.listen(this.container, "click", (event) => {
            const target = (event.target as Element).closest<HTMLElement>(
                "[data-web-view], [data-analytics-refresh]",
            );
            if (target?.hasAttribute("data-analytics-refresh"))
                void this.owner.run(() => this.refreshData());
            if (target?.dataset.webView === "entities")
                this.callbacks?.onNavigate({ view: "entities" });
            if (target?.dataset.webView === "topics")
                this.callbacks?.onNavigate({ view: "topics" });
        });
    }

    async initialize(): Promise<void> {
        // Initially hide the empty state while loading
        const emptyState = this.find("analyticsEmptyState");
        if (emptyState) {
            emptyState.hidden = true;
            emptyState.style.display = "none";
        }

        await this.loadAnalyticsData();
    }

    async loadAnalyticsData(): Promise<void> {
        if (!this.isConnected) {
            throw new Error("TypeAgent Browser Memory is disconnected");
        }
        const ticket = this.owner.begin();
        this.owner.clearError();
        try {
            const response = await this.services.loadAnalyticsData();
            if (!this.owner.current(ticket)) return;
            if (!response.success || !response.analytics?.overview)
                throw new Error(
                    response.error ?? "Analytics response is unavailable",
                );
            validateAnalyticsResponse(response.analytics);
            this.analyticsData = this.transformAnalyticsData(
                response.analytics,
            );
            await this.renderContent();
            if (!this.owner.current(ticket)) return;
            this.bindDrilldown();
        } catch (error) {
            if (this.owner.current(ticket)) throw error;
        }
    }

    private transformAnalyticsData(data: any): any {
        return {
            overview: data?.overview || {},
            insights: this.transformKnowledgeInsights(data?.knowledge || {}),
            domains: data?.domains || {},
            knowledge: data?.knowledge || {},
            activity: data?.activity || {},
        };
    }

    async renderContent(): Promise<void> {
        if (!this.analyticsData) return;

        const hasData =
            this.analyticsData.overview.totalSites > 0 ||
            this.analyticsData.overview.knowledgeExtracted > 0 ||
            this.analyticsData.knowledge.totalEntities > 0 ||
            this.analyticsData.knowledge.totalTopics > 0 ||
            this.analyticsData.knowledge.totalActions > 0 ||
            this.analyticsData.knowledge.totalRelationships > 0;

        const emptyState = this.find("analyticsEmptyState");
        if (emptyState) {
            emptyState.hidden = hasData;
            emptyState.style.display = hasData ? "none" : "block";
        }

        this.renderKnowledgeInsights();
        this.renderTopDomains();
        this.updateKnowledgeVisualizationData(this.analyticsData.knowledge);
    }

    async refreshData(): Promise<void> {
        await this.loadAnalyticsData();
    }

    destroy(): void {
        this.clearCollections();
        this.owner.destroy();
        this.analyticsData = null;
    }

    private find(id: string): HTMLElement | null {
        return this.container.querySelector(`#${id}`);
    }

    private bindDrilldown(): void {
        const overview = this.analyticsData.overview;
        for (const [id, value] of Object.entries({
            totalWebsites: overview.totalSites,
            totalBookmarks: overview.totalBookmarks,
            totalHistory: overview.totalHistory,
            topDomains: overview.topDomains ?? "-",
        }))
            if (this.find(id)) this.find(id)!.textContent = String(value);
    }

    private transformKnowledgeInsights(knowledge: any): any[] {
        return [
            {
                category: "Entities",
                value: knowledge.totalEntities || 0,
                change: 0,
            },
            {
                category: "Relationships",
                value: knowledge.totalRelationships || 0,
                change: 0,
            },
            {
                category: "Knowledge Quality",
                value: this.calculateKnowledgeQualityFromData(knowledge),
                change: 0,
            },
        ];
    }

    private calculateKnowledgeQualityFromData(knowledge: any): number {
        if (!knowledge || !knowledge.qualityDistribution) return 0;

        const { highQuality, mediumQuality, lowQuality } =
            knowledge.qualityDistribution;
        const total = highQuality + mediumQuality + lowQuality;

        if (total === 0) return 0;

        // Weighted score: high=100%, medium=60%, low=20%
        return Math.round(
            (highQuality * 100 + mediumQuality * 60 + lowQuality * 20) / total,
        );
    }

    private updateKnowledgeVisualizationData(knowledge: any): void {
        // Update AI Insights section with real data
        const knowledgeExtractedElement = this.find("knowledgeExtracted");
        const totalEntitiesElement = this.find("totalEntities");
        const totalTopicsElement = this.find("totalTopics");
        const totalActionsElement = this.find("totalActions");

        if (knowledgeExtractedElement) {
            knowledgeExtractedElement.textContent = (
                knowledge.totalEntities || 0
            ).toString();
        }
        if (totalEntitiesElement) {
            totalEntitiesElement.textContent = (
                knowledge.totalEntities || 0
            ).toString();
        }
        if (totalTopicsElement) {
            totalTopicsElement.textContent = (
                knowledge.totalTopics || 0
            ).toString();
        }
        if (totalActionsElement) {
            totalActionsElement.textContent = (
                knowledge.totalActions || 0
            ).toString();
        }

        // Update knowledge visualization cards with real data
        this.updateKnowledgeVisualizationCards(knowledge);

        // Update recent items displays with real data
        this.clearCollections();
        this.renderRecentCollection(
            "recentEntitiesList",
            "Entities",
            "entities",
            knowledge.recentEntities || knowledge.recentItems?.entities || [],
            knowledge.totalEntities,
        );
        this.renderRecentCollection(
            "recentTopicsList",
            "Topics",
            "topics",
            knowledge.recentTopics || knowledge.recentItems?.topics || [],
            knowledge.totalTopics,
        );
        this.renderRecentCollection(
            "recentActionsList",
            "Relationships",
            "relationships",
            knowledge.recentRelationships || [],
            knowledge.totalRelationships,
        );
    }

    private updateKnowledgeVisualizationCards(knowledge: any): void {
        const totalEntitiesMetric = this.find("totalEntitiesMetric");
        if (totalEntitiesMetric) {
            totalEntitiesMetric.textContent = (
                knowledge.totalEntities || 0
            ).toString();
        }

        const totalTopicsMetric = this.find("totalTopicsMetric");
        if (totalTopicsMetric) {
            totalTopicsMetric.textContent = (
                knowledge.totalTopics || 0
            ).toString();
        }

        const totalActionsMetric = this.find("totalActionsMetric");
        if (totalActionsMetric) {
            totalActionsMetric.textContent = (
                knowledge.totalRelationships || 0
            ).toString();
        }
    }

    private updateMetricDisplaysWithZeros(): void {
        const elements = [
            "knowledgeExtracted",
            "totalEntities",
            "totalTopics",
            "totalActions",
            "totalEntitiesMetric",
            "totalTopicsMetric",
            "totalActionsMetric",
        ];

        elements.forEach((elementId) => {
            const element = this.find(elementId);
            if (element) {
                element.textContent = "0";
            }
        });
    }

    private renderKnowledgeInsights(): void {
        const container = this.find("knowledgeInsights");
        if (!container || !this.analyticsData?.knowledge) return;

        const knowledgeStats = this.analyticsData.knowledge;
        const entityProgress =
            knowledgeStats.extractionProgress?.entityProgress || 0;
        const topicProgress =
            knowledgeStats.extractionProgress?.topicProgress || 0;
        const actionProgress =
            knowledgeStats.extractionProgress?.actionProgress || 0;
        const highQuality =
            knowledgeStats.qualityDistribution?.highQuality || 0;
        const mediumQuality =
            knowledgeStats.qualityDistribution?.mediumQuality || 0;
        const lowQuality = knowledgeStats.qualityDistribution?.lowQuality || 0;

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
                                    <div class="progress-fill" style="width: ${entityProgress}%; background: linear-gradient(90deg, #17a2b8, #20c997);"></div>
                                </div>
                                <span class="progress-percentage">${entityProgress}%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-tags text-purple"></i>
                                <span>Topic Analysis</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${topicProgress}%; background: linear-gradient(90deg, #6f42c1, #e83e8c);"></div>
                                </div>
                                <span class="progress-percentage">${topicProgress}%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-lightning text-warning"></i>
                                <span>Action Detection</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${actionProgress}%; background: linear-gradient(90deg, #fd7e14, #ffc107);"></div>
                                </div>
                                <span class="progress-percentage">${actionProgress}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Knowledge Quality Distribution</h6>
                    <div class="quality-distribution">
                        <div class="quality-segment high" style="width: ${highQuality}%;" title="High Quality: ${highQuality}%">
                            <span class="quality-label">High</span>
                        </div>
                        <div class="quality-segment medium" style="width: ${mediumQuality}%;" title="Medium Quality: ${mediumQuality}%">
                            <span class="quality-label">Medium</span>
                        </div>
                        <div class="quality-segment low" style="width: ${lowQuality}%;" title="Low Quality: ${lowQuality}%">
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

    private renderTopDomains(): void {
        const container = this.find("topDomainsList");
        if (!container || !this.analyticsData?.domains) return;

        const domainsData = this.analyticsData.domains;

        if (!domainsData.topDomains || domainsData.topDomains.length === 0) {
            container.innerHTML = `
                <div class="empty-message">
                    <i class="bi bi-globe"></i>
                    <span>No domain data available</span>
                </div>
            `;
            return;
        }

        const domainsHtml = domainsData.topDomains
            .map(
                (domain: any) => `
                    <div class="domain-item">
                        <div class="domain-info">
                            <i class="bi bi-globe domain-favicon" aria-hidden="true"></i>
                            <div class="domain-details">
                                <div class="domain-name">${this.escapeHtml(domain.domain)}</div>
                                <div class="domain-stats">
                                    <span class="site-count">${domain.count} sites</span>
                                    <span class="percentage">${domain.percentage}%</span>
                                </div>
                            </div>
                        </div>
                        <div class="domain-bar">
                            <div class="bar-fill" style="width: ${Math.min(domain.percentage, 100)}%"></div>
                        </div>
                    </div>
                `,
            )
            .join("");

        container.innerHTML = domainsHtml;
    }

    setConnectionStatus(isConnected: boolean): void {
        this.isConnected = isConnected;
    }

    private clearCollections(): void {
        this.collections.forEach((collection) => collection.dispose());
        this.collections = [];
    }

    private renderRecentCollection(
        id: string,
        title: string,
        kind: MemoryHubKnowledgeKind,
        recent: readonly RecentKnowledgeItem[],
        total: number,
    ): void {
        const container = this.find(id);
        if (!container) return;
        container.replaceChildren();
        const preview = recent.slice(0, KNOWLEDGE_PREVIEW_SIZE);
        const items: MemoryHubKnowledgeItem[] = preview.map((item, index) => ({
            id: `${kind}:${index}`,
            title:
                kind === "relationships"
                    ? `${item.from ?? "Unknown entity"} → ${item.relationship ?? "related"} → ${item.to ?? "Unknown entity"}`
                    : (item.name ?? item.topic ?? "Unnamed knowledge"),
            subtitle: item.type ?? item.category,
            sources: [],
        }));
        this.collections.push(
            mountKnowledgeCollection(container, {
                title,
                items,
                total,
                itemClass:
                    kind === "entities"
                        ? "entity-pill"
                        : kind === "topics"
                          ? "topic-pill"
                          : undefined,
                onError: (error) => this.owner.error(error),
                loadPage: (request) => {
                    this.owner.clearError();
                    return invokeView("memoryHubKnowledge", {
                        ...request,
                        kind,
                        browserOnly: true,
                    });
                },
                onSelect:
                    kind === "entities" || kind === "topics"
                        ? (item) =>
                              this.callbacks?.onNavigate({
                                  view: kind,
                                  ...(kind === "entities"
                                      ? { entity: item.title }
                                      : { topic: item.title }),
                              })
                        : undefined,
                renderSources: (card, item, signal) => {
                    const fromPage =
                        preview[
                            items.findIndex((value) => value.id === item.id)
                        ]?.fromPage;
                    if (fromPage) {
                        const sources = document.createElement("div");
                        sources.className = "analytics-source";
                        renderSources(
                            sources,
                            [fromPage],
                            this.callbacks ?? {
                                onError: (error) => this.owner.error(error),
                            },
                            signal,
                        );
                        card.append(sources);
                    }
                    if (!item.sources.length) return;
                    const details = document.createElement("details");
                    const summary = document.createElement("summary");
                    summary.textContent = "Browse contributing sources";
                    details.append(summary);
                    let mounted:
                        | ReturnType<typeof mountKnowledgeCollection>
                        | undefined;
                    details.addEventListener(
                        "toggle",
                        () => {
                            if (!details.open || mounted) return;
                            mounted = mountKnowledgeCollection(details, {
                                title: "Contributing sources",
                                items: item.sources.map((source) => ({
                                    id: JSON.stringify([
                                        source.corpusId,
                                        source.sourceId,
                                    ]),
                                    title: source.sourceId,
                                    subtitle: source.corpusId,
                                    sources: [source],
                                })),
                                onError: (error) => this.owner.error(error),
                                renderSources: (host, value, sourceSignal) => {
                                    const source = value.sources[0];
                                    const link = document.createElement("a");
                                    link.textContent = "Open source";
                                    link.href = `#/library/${encodeURIComponent(source.corpusId)}/${encodeURIComponent(source.sourceId)}`;
                                    link.addEventListener("click", (event) => {
                                        if (
                                            sourceSignal.aborted ||
                                            !host.isConnected
                                        )
                                            event.preventDefault();
                                    });
                                    host.append(link);
                                },
                            });
                        },
                        { signal },
                    );
                    card.append(details);
                    return () => mounted?.dispose();
                },
            }),
        );
    }

    private formatRelativeDate(dateString?: string): string {
        if (!dateString) return "Unknown";

        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - date.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                return "Today";
            } else if (diffDays === 1) {
                return "Yesterday";
            } else if (diffDays <= 7) {
                return `${diffDays} days ago`;
            } else {
                return date.toLocaleDateString();
            }
        } catch (error) {
            return "Unknown";
        }
    }

    private escapeHtml(text: string): string {
        return String(text).replace(
            /[&<>"']/g,
            (character) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                })[character]!,
        );
    }
}
