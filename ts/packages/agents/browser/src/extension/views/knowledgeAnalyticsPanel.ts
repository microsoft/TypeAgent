// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnalyticsServices } from "./knowledgeUtilities";

export class KnowledgeAnalyticsPanel {
    private container: HTMLElement;
    private services: AnalyticsServices;
    private analyticsData: any = null;
    private isConnected: boolean = true;

    constructor(container: HTMLElement, services: AnalyticsServices) {
        this.container = container;
        this.services = services;
    }

    async initialize(): Promise<void> {
        // Initially hide the empty state while loading
        const emptyState = document.getElementById("analyticsEmptyState");
        if (emptyState) {
            emptyState.style.display = "none";
        }

        await this.loadAnalyticsData();
        await this.renderContent();
    }

    async loadAnalyticsData(): Promise<void> {
        if (!this.isConnected) {
            this.showAnalyticsConnectionError();
            return;
        }

        try {
            const response = await this.services.loadAnalyticsData();

            // Handle service response structure similar to original
            if (response && response.success) {
                this.analyticsData = {
                    overview: response.analytics?.overview || {},
                    trends: response.analytics?.activity?.trends || [],
                    insights: this.transformKnowledgeInsights(
                        response.analytics?.knowledge || {},
                    ),
                    domains: response.analytics?.domains || {},
                    knowledge: response.analytics?.knowledge || {},
                    activity: response.analytics?.activity || {},
                };
            } else {
                throw new Error(
                    response?.error || "Failed to get analytics data",
                );
            }
        } catch (error) {
            console.error("Failed to load analytics data:", error);
            this.handleAnalyticsDataError(error);
        }
    }

    async renderContent(): Promise<void> {
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
        await this.loadAnalyticsData();
        await this.renderContent();
    }

    destroy(): void {
        // Cleanup any event listeners or timers if needed
    }

    private showAnalyticsConnectionError(): void {
        const emptyState = document.getElementById("analyticsEmptyState");
        if (emptyState) {
            emptyState.style.display = "block";
        }

        const container = document.getElementById("analyticsContent");
        if (container) {
            container.innerHTML = `
                <div class="connection-required">
                    <i class="bi bi-wifi-off"></i>
                    <h3>Connection Required</h3>
                    <p>The Analytics page requires an active connection to the TypeAgent service.</p>
                    <button class="btn btn-primary" data-action="reconnect">
                        <i class="bi bi-arrow-repeat"></i> Reconnect
                    </button>
                </div>
            `;
        }
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
        this.updateRecentActionsDisplay(
            knowledge.recentActions || knowledge.recentItems?.actions || [],
        );
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
        if (!isConnected) {
            this.showAnalyticsConnectionError();
        }
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
            <div class="recent-item entity-item">
                <div class="item-icon">
                    <i class="bi bi-diagram-2"></i>
                </div>
                <div class="item-content">
                    <div class="item-name">${this.escapeHtml(entity.name || "Unknown Entity")}</div>
                    <div class="item-meta">
                        <span class="entity-type">${this.escapeHtml(entity.type || "Unknown")}</span>
                        ${entity.confidence ? `<span class="confidence">Confidence: ${Math.round(entity.confidence * 100)}%</span>` : ""}
                    </div>
                </div>
                <div class="item-date">
                    ${this.formatRelativeDate(entity.extractedAt || entity.createdAt)}
                </div>
            </div>
        `,
            )
            .join("");

        container.innerHTML = entitiesHtml;
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
            <div class="recent-item topic-item">
                <div class="item-icon">
                    <i class="bi bi-tags"></i>
                </div>
                <div class="item-content">
                    <div class="item-name">${this.escapeHtml(topic.name || topic.topic || "Unknown Topic")}</div>
                    <div class="item-meta">
                        ${topic.category ? `<span class="topic-category">${this.escapeHtml(topic.category)}</span>` : ""}
                        ${topic.relevance ? `<span class="relevance">Relevance: ${Math.round(topic.relevance * 100)}%</span>` : ""}
                    </div>
                </div>
                <div class="item-date">
                    ${this.formatRelativeDate(topic.identifiedAt || topic.createdAt)}
                </div>
            </div>
        `,
            )
            .join("");

        container.innerHTML = topicsHtml;
    }

    private updateRecentActionsDisplay(recentActions: any[]): void {
        const container = document.getElementById("recentActionsList");
        if (!container) return;

        if (!recentActions || recentActions.length === 0) {
            container.innerHTML = `
                <div class="empty-message">
                    <i class="bi bi-lightning"></i>
                    <span>No recent actions suggested</span>
                </div>
            `;
            return;
        }

        const actionsHtml = recentActions
            .slice(0, 10)
            .map(
                (action) => `
            <div class="recent-item action-item">
                <div class="item-icon">
                    <i class="bi bi-lightning"></i>
                </div>
                <div class="item-content">
                    <div class="item-name">${this.escapeHtml(action.name || action.action || "Unknown Action")}</div>
                    <div class="item-meta">
                        ${action.type ? `<span class="action-type">${this.escapeHtml(action.type)}</span>` : ""}
                        ${action.confidence ? `<span class="confidence">Confidence: ${Math.round(action.confidence * 100)}%</span>` : ""}
                    </div>
                </div>
                <div class="item-date">
                    ${this.formatRelativeDate(action.suggestedAt || action.createdAt)}
                </div>
            </div>
        `,
            )
            .join("");

        container.innerHTML = actionsHtml;
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
