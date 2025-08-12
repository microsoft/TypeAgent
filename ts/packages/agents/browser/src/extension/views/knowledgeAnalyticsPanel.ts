// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnalyticsServices } from "./knowledgeUtilities";
import { CachedAnalyticsService } from "./services/cachedAnalyticsService";
import { CacheStatus, CacheIndicatorType } from "./interfaces/cacheTypes";

export class KnowledgeAnalyticsPanel {
    private container: HTMLElement;
    private services: AnalyticsServices;
    private cachedService: CachedAnalyticsService;
    private analyticsData: any = null;
    private isConnected: boolean = true;
    private currentCacheStatus: CacheStatus | null = null;

    constructor(container: HTMLElement, services: AnalyticsServices) {
        this.container = container;
        this.services = services;
        // Wrap the original service with caching
        this.cachedService = new CachedAnalyticsService(services);
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // No UI event listeners needed for cache indicators
        return;
    }

    async initialize(): Promise<void> {
        // Initially hide the empty state while loading
        const emptyState = document.getElementById("analyticsEmptyState");
        if (emptyState) {
            emptyState.style.display = "none";
        }

        await this.loadAnalyticsDataWithCache();
    }

    async loadAnalyticsDataWithCache(): Promise<void> {
        if (!this.isConnected) {
            return;
        }

        try {
            const result = await this.cachedService.loadAnalyticsData();

            // Always render cached data immediately if available (regardless of age)
            if (result.cachedData) {
                this.analyticsData = this.transformAnalyticsData(
                    result.cachedData,
                );
                await this.renderContent({
                    fromCache: true,
                    isStale: result.isStale,
                });

                // Log cache status for debugging (no UI indicator)
                this.currentCacheStatus = this.cachedService.getCacheStatus();
            }

            // Wait for fresh data in background
            try {
                let freshResponse = await result.freshDataPromise;

                if (freshResponse.freshDataPromise !== undefined) {
                    freshResponse = await freshResponse.freshDataPromise;
                }

                if (freshResponse && freshResponse.success) {
                    this.analyticsData = this.transformAnalyticsData(
                        freshResponse.analytics,
                    );
                    await this.renderContent({ fromCache: false });
                } else {
                    throw new Error(
                        freshResponse?.error ||
                            "Failed to get fresh analytics data",
                    );
                }
            } catch (error) {
                console.error("Fresh data fetch failed:", error);
                this.handleFreshDataError(
                    error,
                    !!result.cachedData,
                    result.isStale,
                );
            }
        } catch (error) {
            console.error("Failed to initialize analytics cache:", error);
            this.handleAnalyticsDataError(error);
        }
    }

    private transformAnalyticsData(data: any): any {
        return {
            overview: data?.overview || {},
            trends: data?.activity?.trends || [],
            insights: this.transformKnowledgeInsights(data?.knowledge || {}),
            domains: data?.domains || {},
            knowledge: data?.knowledge || {},
            activity: data?.activity || {},
        };
    }

    async renderContent(options?: {
        fromCache?: boolean;
        isStale?: boolean;
    }): Promise<void> {
        if (!this.analyticsData) return;

        const hasData =
            this.analyticsData.overview.totalSites > 0 ||
            this.analyticsData.overview.knowledgeExtracted > 0 ||
            this.analyticsData.insights.some(
                (insight: any) => insight.value > 0,
            );

        const emptyState = document.getElementById("analyticsEmptyState");
        if (emptyState) {
            emptyState.style.display = hasData ? "none" : "block";
        }

        if (hasData) {
            this.renderActivityCharts();
            await this.renderKnowledgeInsights();
            this.renderTopDomains();
            this.updateKnowledgeVisualizationData(this.analyticsData.knowledge);
        }
    }

    async refreshData(): Promise<void> {
        await this.loadAnalyticsDataWithCache();
    }

    private handleFreshDataError(
        error: any,
        hasCachedData: boolean,
        isStale: boolean,
    ): void {
        console.error("Fresh data fetch failed:", error);

        if (hasCachedData) {
            // Continue showing cached data - log error status for debugging
            this.currentCacheStatus = this.cachedService.getCacheErrorStatus();
        } else {
            // No cached data available, show error state
            this.handleAnalyticsDataError(error);
        }
    }

    private retryRefresh(): void {
        console.log("Retrying analytics refresh...");
        this.refreshData().catch(console.error);
    }

    destroy(): void {
        // Cleanup any event listeners or timers if needed
    }

    private handleAnalyticsDataError(error: any): void {
        this.analyticsData = {
            overview: {
                totalSites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                knowledgeExtracted: 0,
            },
            trends: [],
            insights: [],
            domains: { topDomains: [] },
            knowledge: {},
            activity: { trends: [], summary: {} },
        };

        const emptyState = document.getElementById("analyticsEmptyState");
        if (emptyState) {
            emptyState.style.display = "block";
        }

        // Update metric displays with zeros
        this.updateMetricDisplaysWithZeros();
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
        const knowledgeExtractedElement =
            document.getElementById("knowledgeExtracted");
        const totalEntitiesElement = document.getElementById("totalEntities");
        const totalTopicsElement = document.getElementById("totalTopics");
        const totalActionsElement = document.getElementById("totalActions");

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
        this.updateRecentEntitiesDisplay(
            knowledge.recentEntities || knowledge.recentItems?.entities || [],
        );
        this.updateRecentTopicsDisplay(
            knowledge.recentTopics || knowledge.recentItems?.topics || [],
        );
        // Use recentRelationships instead of transforming recentActions
        this.updateRecentActionsDisplay(knowledge.recentRelationships || []);
    }

    private updateKnowledgeVisualizationCards(knowledge: any): void {
        const totalEntitiesMetric = document.getElementById(
            "totalEntitiesMetric",
        );
        if (totalEntitiesMetric) {
            totalEntitiesMetric.textContent = (
                knowledge.totalEntities || 0
            ).toString();
        }

        const totalTopicsMetric = document.getElementById("totalTopicsMetric");
        if (totalTopicsMetric) {
            totalTopicsMetric.textContent = (
                knowledge.totalTopics || 0
            ).toString();
        }

        const totalActionsMetric =
            document.getElementById("totalActionsMetric");
        if (totalActionsMetric) {
            totalActionsMetric.textContent = (
                knowledge.totalActions || 0
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
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = "0";
            }
        });
    }

    private renderActivityCharts(): void {
        const container = document.getElementById("activityCharts");
        if (!container || !this.analyticsData?.activity) return;

        const activityData = this.analyticsData.activity;

        if (!activityData.trends || activityData.trends.length === 0) {
            container.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <h6 class="card-title">Activity Trends</h6>
                        <div class="empty-message">
                            <i class="bi bi-bar-chart"></i>
                            <span>No activity data available</span>
                            <small>Import bookmarks or browse websites to see trends</small>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        const trends = activityData.trends;
        const maxActivity = Math.max(
            ...trends.map((t: any) => t.visits + t.bookmarks),
        );
        const recentTrends = trends.slice(-14);

        const chartBars = recentTrends
            .map((trend: any) => {
                const totalActivity = trend.visits + trend.bookmarks;
                const date = new Date(trend.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                });

                const visitsHeight =
                    maxActivity > 0 ? (trend.visits / maxActivity) * 100 : 0;
                const bookmarksHeight =
                    maxActivity > 0 ? (trend.bookmarks / maxActivity) * 100 : 0;

                return `
                    <div class="chart-bar" title="${date}: ${totalActivity} activities">
                        <div class="bar-segment visits" style="height: ${visitsHeight}%" title="Visits: ${trend.visits}"></div>
                        <div class="bar-segment bookmarks" style="height: ${bookmarksHeight}%" title="Bookmarks: ${trend.bookmarks}"></div>
                        <div class="bar-label">${date}</div>
                    </div>
                `;
            })
            .join("");

        const summary = activityData.summary || {};

        container.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Activity Trends</h6>
                    
                    <div class="activity-summary mb-3">
                        <div class="summary-stat">
                            <span class="stat-label">Total Activity</span>
                            <span class="stat-value">${summary.totalActivity || 0}</span>
                        </div>
                        <div class="summary-stat">
                            <span class="stat-label">Daily Average</span>
                            <span class="stat-value">${Math.round(summary.averagePerDay || 0)}</span>
                        </div>
                        <div class="summary-stat">
                            <span class="stat-label">Peak Day</span>
                            <span class="stat-value">${
                                summary.peakDay
                                    ? new Date(
                                          summary.peakDay,
                                      ).toLocaleDateString("en-US", {
                                          month: "short",
                                          day: "numeric",
                                      })
                                    : "N/A"
                            }</span>
                        </div>
                    </div>
                    
                    <div class="activity-chart">
                        <div class="chart-container">
                            ${chartBars}
                        </div>
                        <div class="chart-legend">
                            <div class="legend-item">
                                <div class="legend-color visits"></div>
                                <span>Visits</span>
                            </div>
                            <div class="legend-item">
                                <div class="legend-color bookmarks"></div>
                                <span>Bookmarks</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private async renderKnowledgeInsights(): Promise<void> {
        const container = document.getElementById("knowledgeInsights");
        if (!container || !this.analyticsData?.knowledge) return;

        const knowledgeStats = this.analyticsData.knowledge;

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
                                    <div class="progress-fill" style="width: ${
                                        knowledgeStats.extractionProgress
                                            ?.entityProgress || 0
                                    }%; background: linear-gradient(90deg, #17a2b8, #20c997);"></div>
                                </div>
                                <span class="progress-percentage">${
                                    knowledgeStats.extractionProgress
                                        ?.entityProgress || 0
                                }%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-tags text-purple"></i>
                                <span>Topic Analysis</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${
                                        knowledgeStats.extractionProgress
                                            ?.topicProgress || 0
                                    }%; background: linear-gradient(90deg, #6f42c1, #e83e8c);"></div>
                                </div>
                                <span class="progress-percentage">${
                                    knowledgeStats.extractionProgress
                                        ?.topicProgress || 0
                                }%</span>
                            </div>
                        </div>
                        
                        <div class="progress-item">
                            <div class="progress-label">
                                <i class="bi bi-lightning text-warning"></i>
                                <span>Action Detection</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${
                                        knowledgeStats.extractionProgress
                                            ?.actionProgress || 0
                                    }%; background: linear-gradient(90deg, #fd7e14, #ffc107);"></div>
                                </div>
                                <span class="progress-percentage">${
                                    knowledgeStats.extractionProgress
                                        ?.actionProgress || 0
                                }%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-body">
                    <h6 class="card-title">Knowledge Quality Distribution</h6>
                    <div class="quality-distribution">
                        <div class="quality-segment high" style="width: ${
                            knowledgeStats.qualityDistribution?.highQuality || 0
                        }%;" title="High Quality: ${knowledgeStats.qualityDistribution?.highQuality || 0}%">
                            <span class="quality-label">High</span>
                        </div>
                        <div class="quality-segment medium" style="width: ${
                            knowledgeStats.qualityDistribution?.mediumQuality ||
                            0
                        }%;" title="Medium Quality: ${knowledgeStats.qualityDistribution?.mediumQuality || 0}%">
                            <span class="quality-label">Medium</span>
                        </div>
                        <div class="quality-segment low" style="width: ${
                            knowledgeStats.qualityDistribution?.lowQuality || 0
                        }%;" title="Low Quality: ${knowledgeStats.qualityDistribution?.lowQuality || 0}%">
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
        const container = document.getElementById("topDomainsList");
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
                            <img src="https://www.google.com/s2/favicons?domain=${domain.domain}" 
                                 class="domain-favicon" alt="Favicon" loading="lazy"
                                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22%23999%22><rect width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
                            <div class="domain-details">
                                <div class="domain-name">${domain.domain}</div>
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

    private updateRecentEntitiesDisplay(recentEntities: any[]): void {
        const container = document.getElementById("recentEntitiesList");
        if (!container) return;

        if (!recentEntities || recentEntities.length === 0) {
            container.innerHTML = `
                <div class="empty-message">
                    <i class="bi bi-diagram-2"></i>
                    <span>No recent entities extracted</span>
                </div>
            `;
            return;
        }

        const entitiesHtml = recentEntities
            .slice(0, 10)
            .map(
                (entity) => `
            <div class="entity-pill clickable" data-entity-name="${this.escapeHtml(entity.name || "Unknown Entity")}" title="Click to view in Entity Graph">
                <div class="pill-icon">
                    <i class="bi bi-diagram-2"></i>
                </div>
                <div class="pill-content">
                    <div class="pill-name">${this.escapeHtml(entity.name || "Unknown Entity")}</div>
                    <div class="pill-type">${this.escapeHtml(entity.type || "Unknown")}</div>
                </div>
            </div>
        `,
            )
            .join("");

        container.innerHTML = entitiesHtml;

        // Add click handlers for entity navigation
        container.querySelectorAll(".entity-pill.clickable").forEach((pill) => {
            pill.addEventListener("click", (e) => {
                const entityName = (
                    e.currentTarget as HTMLElement
                ).getAttribute("data-entity-name");
                if (entityName) {
                    // Navigate to entity graph view with the selected entity
                    window.location.href = `entityGraphView.html?entity=${encodeURIComponent(entityName)}`;
                }
            });
        });
    }

    private updateRecentTopicsDisplay(recentTopics: any[]): void {
        const container = document.getElementById("recentTopicsList");
        if (!container) return;

        if (!recentTopics || recentTopics.length === 0) {
            container.innerHTML = `
                <div class="empty-message">
                    <i class="bi bi-tags"></i>
                    <span>No recent topics identified</span>
                </div>
            `;
            return;
        }

        const topicsHtml = recentTopics
            .slice(0, 10)
            .map(
                (topic) => `
            <div class="topic-pill">
                <div class="pill-icon">
                    <i class="bi bi-tags"></i>
                </div>
                <div class="pill-content">
                    <div class="pill-name">${this.escapeHtml(topic.name || topic.topic || "Unknown Topic")}</div>
                    ${topic.category ? `<div class="pill-type">${this.escapeHtml(topic.category)}</div>` : ""}
                </div>
            </div>
        `,
            )
            .join("");

        container.innerHTML = topicsHtml;
    }

    private updateRecentActionsDisplay(recentRelationships: any[]): void {
        const container = document.getElementById("recentActionsList");
        if (!container) return;

        if (!recentRelationships || recentRelationships.length === 0) {
            container.innerHTML = `
                <div class="empty-message">
                    <i class="bi bi-diagram-3"></i>
                    <span>No recent entity actions identified</span>
                </div>
            `;
            return;
        }

        // Use the relationship data directly (no transformation needed)
        const relationshipsHtml = recentRelationships
            .slice(0, 10)
            .map(
                (rel) => `
                <div class="relationship-item rounded">
                    <span class="fw-semibold">${this.escapeHtml(rel.from)}</span>
                    <i class="bi bi-arrow-right mx-2 text-muted"></i>
                    <span class="text-muted">${this.escapeHtml(rel.relationship)}</span>
                    <i class="bi bi-arrow-right mx-2 text-muted"></i>
                    <span class="fw-semibold">${this.escapeHtml(rel.to)}</span>
                </div>
            `,
            )
            .join("");

        container.innerHTML = relationshipsHtml;
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
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
