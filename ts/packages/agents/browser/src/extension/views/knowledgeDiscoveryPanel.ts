// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DiscoveryServices, extensionService } from "./knowledgeUtilities";

export class KnowledgeDiscoveryPanel {
    private container: HTMLElement;
    private services: DiscoveryServices;
    private discoverData: any = null;
    private isConnected: boolean = true;
    private connectionStatusCallback?: (connected: boolean) => void;

    constructor(container: HTMLElement, services: DiscoveryServices) {
        this.container = container;
        this.services = services;
    }

    async initialize(): Promise<void> {
        // Initially hide the empty state while loading
        const emptyState = document.getElementById("discoverEmptyState");
        if (emptyState) {
            emptyState.style.display = "none";
        }

        this.setupConnectionStatusListener();
        await this.loadDiscoverData();
        this.renderContent();
    }

    async loadDiscoverData(): Promise<void> {
        if (!this.isConnected) {
            this.showConnectionError();
            return;
        }

        try {
            const response = await this.services.loadDiscoverData();

            // Handle service response structure
            if (response && response.success) {
                this.discoverData = {
                    trendingTopics: response.trendingTopics || [],
                    readingPatterns: response.readingPatterns || [],
                    popularPages: response.popularPages || [],
                    topDomains: response.topDomains || [],
                };
            } else {
                this.handleDiscoverDataError(
                    response?.error || "Failed to load discover data",
                );
            }
        } catch (error) {
            console.error("Failed to load discovery data:", error);
            this.handleDiscoverDataError(error);
        }
    }

    renderContent(): void {
        if (!this.discoverData) return;

        const hasData =
            this.discoverData.trendingTopics?.length > 0 ||
            this.discoverData.readingPatterns?.some(
                (p: any) => p.activity > 0,
            ) ||
            this.discoverData.popularPages?.length > 0;

        const emptyState = document.getElementById("discoverEmptyState");
        if (emptyState) {
            emptyState.style.display = hasData ? "none" : "block";
        }

        if (hasData) {
            this.renderTrendingContent();
            this.renderReadingPatterns();
            this.renderPopularPages();
        }
    }

    async refreshData(): Promise<void> {
        await this.loadDiscoverData();
        this.renderContent();
    }

    destroy(): void {
        // Cleanup any event listeners or timers if needed
    }

    private showConnectionError(): void {
        const emptyState = document.getElementById("discoverEmptyState");
        if (emptyState) {
            emptyState.style.display = "block";
        }

        const container = document.getElementById("discoverContent");
        if (container) {
            container.innerHTML = `
                <div class="connection-required">
                    <i class="bi bi-wifi-off"></i>
                    <h3>Connection Required</h3>
                    <p>The Discover page requires an active connection to the TypeAgent service.</p>
                    <button class="btn btn-primary" data-action="reconnect">
                        <i class="bi bi-arrow-repeat"></i> Reconnect
                    </button>
                </div>
            `;
        }
    }

    private handleDiscoverDataError(error: any): void {
        this.discoverData = {
            trendingTopics: [],
            readingPatterns: [],
            popularPages: [],
            topDomains: [],
        };

        const emptyState = document.getElementById("discoverEmptyState");
        if (emptyState) {
            emptyState.style.display = "block";
        }

        const container = document.getElementById("discoverContent");
        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    <i class="bi bi-exclamation-triangle"></i>
                    <h3>Unable to Load Discover Data</h3>
                    <p>There was an error loading your discover insights. Please try again.</p>
                    <button class="btn btn-primary" onclick="window.location.reload()">
                        <i class="bi bi-arrow-repeat"></i> Retry
                    </button>
                </div>
            `;
        }
    }

    private renderTrendingContent(): void {
        const container = document.getElementById("trendingContent");
        if (!container || !this.discoverData) return;

        if (this.discoverData.trendingTopics.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-graph-up-arrow"></i>
                    <h6>No Trending Topics</h6>
                    <p>Import more content to see trending topics.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.discoverData.trendingTopics
            .map(
                (topic: any) => `
                <div class="card trending-topic-card trend-${topic.trend} discover-card mb-2">
                    <div class="card-body">
                        <h6 class="card-title text-capitalize">${this.escapeHtml(topic.topic)}</h6>
                        <div class="d-flex align-items-center justify-content-between">
                            <span class="text-muted">${topic.count} page${topic.count !== 1 ? "s" : ""}</span>
                            <div class="trend-indicator">
                                <i class="bi bi-arrow-${topic.trend === "up" ? "up" : topic.trend === "down" ? "down" : "right"} 
                                   text-${topic.trend === "up" ? "success" : topic.trend === "down" ? "danger" : "secondary"}"></i>
                                <span class="text-${topic.trend === "up" ? "success" : topic.trend === "down" ? "danger" : "secondary"} small">
                                    ${topic.percentage}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            )
            .join("");
    }

    private renderReadingPatterns(): void {
        const container = document.getElementById("readingPatterns");
        if (!container || !this.discoverData) return;

        if (
            this.discoverData.readingPatterns.length === 0 ||
            this.discoverData.readingPatterns.every(
                (p: any) => p.activity === 0,
            )
        ) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-clock-history"></i>
                    <h6>No Activity Patterns</h6>
                    <p>Visit more pages to see your reading patterns.</p>
                </div>
            `;
            return;
        }

        const maxActivity = Math.max(
            ...this.discoverData.readingPatterns.map((p: any) => p.activity),
        );

        container.innerHTML = `
            <div class="card discover-card">
                <div class="card-body">
                    <h6 class="card-title">Weekly Activity Pattern</h6>
                    <div class="reading-pattern-chart">
                        ${this.discoverData.readingPatterns
                            .map(
                                (pattern: any) => `
                                <div class="pattern-item ${pattern.peak ? "peak" : ""}">
                                    <div class="pattern-bar" style="height: ${maxActivity > 0 ? (pattern.activity / maxActivity) * 80 + 10 : 2}px" title="${pattern.timeframe}: ${pattern.activity} visits"></div>
                                    <div class="pattern-time">${pattern.timeframe.substring(0, 3)}</div>
                                </div>
                            `,
                            )
                            .join("")}
                    </div>
                    <div class="text-center mt-2">
                        <small class="text-muted">Most active day: ${this.discoverData.readingPatterns.find((p: any) => p.peak)?.timeframe || "None"}</small>
                    </div>
                </div>
            </div>
        `;
    }

    private renderPopularPages(): void {
        const container = document.getElementById("popularPages");
        if (!container) return;

        if (
            !this.discoverData?.popularPages ||
            this.discoverData.popularPages.length === 0
        ) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-fire"></i>
                    <h6>No Popular Pages</h6>
                    <p>Visit more pages to see trending content.</p>
                </div>
            `;
            return;
        }

        // Convert popular pages to website format for rich rendering
        const popularPagesAsWebsites = this.discoverData.popularPages.map(
            (page: any) => ({
                url: page.url,
                title: page.title,
                domain: page.domain,
                visitCount: page.visitCount,
                lastVisited: page.lastVisited,
                source: page.isBookmarked ? "bookmarks" : "history",
                score: page.visitCount,
                knowledge: {
                    hasKnowledge: false,
                    status: "none",
                },
            }),
        );

        // Use rich list view rendering similar to original
        const pagesHtml = popularPagesAsWebsites
            .map(
                (website: any) => `
                <div class="search-result-item">
                    <div class="d-flex align-items-start">
                        <img src="https://www.google.com/s2/favicons?domain=${website.domain}" 
                             class="result-favicon me-2" alt="Favicon"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22%23999%22><rect width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
                        <div class="flex-grow-1">
                            <h6 class="mb-1">
                                <a href="${website.url}" target="_blank" class="text-decoration-none">
                                    ${this.escapeHtml(website.title)}
                                </a>
                            </h6>
                            <div class="result-domain text-muted mb-1">${this.escapeHtml(website.domain)}</div>
                            
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="page-stats">
                                    <span class="visit-count">${website.visitCount} visits</span>
                                    <span class="last-visited ms-2">${this.formatDate(website.lastVisited)}</span>
                                </div>
                                ${website.score ? `<span class="result-score">${Math.round(website.score)}%</span>` : ""}
                            </div>
                        </div>
                    </div>
                </div>
            `,
            )
            .join("");

        container.innerHTML = pagesHtml;
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    private formatDate(dateString: string): string {
        try {
            return new Date(dateString).toLocaleDateString();
        } catch {
            return "";
        }
    }

    setConnectionStatus(isConnected: boolean): void {
        this.isConnected = isConnected;
        if (!isConnected) {
            this.showConnectionError();
        }
    }

    private setupConnectionStatusListener(): void {
        this.connectionStatusCallback = (connected: boolean) => {
            this.setConnectionStatus(connected);
        };

        extensionService.onConnectionStatusChange(
            this.connectionStatusCallback,
        );
    }
}
