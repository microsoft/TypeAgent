// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TopicGraphVisualizer } from "./topicGraphVisualizer";
import { createExtensionService } from "./knowledgeUtilities";

interface TopicGraphViewState {
    currentTopic: string | null;
    searchQuery: string;
    sidebarOpen: boolean;
}

class TopicGraphView {
    private visualizer: TopicGraphVisualizer | null = null;
    private extensionService: any;
    private lastLoadedData: any = null;
    private state: TopicGraphViewState = {
        currentTopic: null,
        searchQuery: "",
        sidebarOpen: false,
    };

    private loadingOverlay: HTMLElement;
    private errorOverlay: HTMLElement;
    private sidebar: HTMLElement;
    private graphContainer: HTMLElement;

    constructor() {
        this.loadingOverlay = document.getElementById("loadingOverlay")!;
        this.errorOverlay = document.getElementById("errorOverlay")!;
        this.sidebar = document.getElementById("topicSidebar")!;
        this.graphContainer = document.getElementById("topicGraphContainer")!;

        // Initialize extension service
        this.extensionService = createExtensionService();

        // Check for topic parameter in URL
        this.parseUrlParameters();

        this.initializeEventHandlers();
        this.initializeVisualizer();
        this.loadInitialData();
    }

    private parseUrlParameters(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const topicParam = urlParams.get("topic");

        if (topicParam) {
            // Store the target topic to navigate to after data loads
            this.state.searchQuery = topicParam;

            // Update the search input field to show the topic name
            const searchInput = document.getElementById(
                "topicSearch",
            ) as HTMLInputElement;
            if (searchInput) {
                searchInput.value = topicParam;
            }
        }
    }

    private initializeEventHandlers(): void {
        // Topic Graph breadcrumb link - navigate to global view
        const topicGraphBreadcrumb = document.getElementById(
            "topicGraphBreadcrumb",
        );
        if (topicGraphBreadcrumb) {
            topicGraphBreadcrumb.addEventListener("click", (e) => {
                e.preventDefault();
                this.navigateToGlobalView();
            });
        }

        // Search functionality
        const searchInput = document.getElementById(
            "topicSearch",
        ) as HTMLInputElement;
        const searchButton = document.getElementById("searchButton");

        searchInput?.addEventListener("input", (e) => {
            this.state.searchQuery = (e.target as HTMLInputElement).value;
            this.handleSearch();
        });

        searchButton?.addEventListener("click", () => {
            this.handleSearch();
        });

        // View mode buttons removed - using optimized CoSE by default

        // Graph controls
        document.getElementById("fitButton")?.addEventListener("click", () => {
            this.visualizer?.fitToView();
        });

        document
            .getElementById("centerButton")
            ?.addEventListener("click", () => {
                this.visualizer?.centerGraph();
            });

        document
            .getElementById("exportButton")
            ?.addEventListener("click", () => {
                this.exportGraph();
            });

        document
            .getElementById("exportJsonButton")
            ?.addEventListener("click", () => {
                this.exportGraphologyJson();
            });

        // Settings modal removed - using optimized defaults

        // Sidebar close button
        document
            .getElementById("closeSidebar")
            ?.addEventListener("click", () => {
                this.closeSidebar();
            });

        // Retry button
        document
            .getElementById("retryButton")
            ?.addEventListener("click", () => {
                this.loadInitialData();
            });

        // Entity clicks (navigate to entity graph) and topic action buttons
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Handle entity item clicks
            if (target.classList.contains("entity-item")) {
                const entityName = target.textContent?.trim();
                if (entityName) {
                    this.navigateToEntityGraph(entityName);
                }
                return;
            }

            // Handle topic action buttons (focus only)
            const button = target.closest("[data-action]") as HTMLElement;
            if (button) {
                const action = button.getAttribute("data-action");
                const topicId = button.getAttribute("data-topic-id");

                if (topicId && action === "focus") {
                    this.focusOnTopic(topicId);
                }
            }
        });
    }

    private async initializeVisualizer(): Promise<void> {
        try {
            this.visualizer = new TopicGraphVisualizer(this.graphContainer);

            // Set up topic click callback
            this.visualizer.onTopicClick((topic) => {
                this.showTopicDetails(topic);
                this.updateBreadcrumb(topic);
            });
        } catch (error) {
            console.error("Failed to initialize topic visualizer:", error);
            this.showError("Failed to initialize topic graph visualization");
        }
    }

    private async loadInitialData(): Promise<void> {
        this.showLoading();

        try {
            const topicData = await this.fetchGlobalImportanceView();

            if (!topicData) {
                this.showError("No topic data available");
                return;
            }

            this.lastLoadedData = topicData;

            await this.visualizer?.init(topicData);

            this.updateGraphStats();

            // Check if we need to navigate to a specific topic from URL parameter
            if (this.state.searchQuery.trim()) {
                this.handleTopicNavigation(this.state.searchQuery.trim());
            }

            this.hideLoading();
        } catch (error) {
            console.error("Failed to load topic data:", error);
            this.showError("Failed to load topic data");
        }
    }

    /**
     * Fetch global importance view with top N most important topics
     */
    private async fetchGlobalImportanceView(): Promise<any> {
        try {
            console.log(
                "[TopicGraphView] Fetching global importance layer (top 500 topics) - layout-only contract...",
            );
            const result = await this.extensionService.getTopicImportanceLayer(
                500,
                0.0,
            );

            if (!result || !result.graphologyLayout) {
                console.warn(
                    "[TopicGraphView] No layout data available in importance layer",
                );
                return this.createEmptyTopicGraph();
            }

            console.log(
                `[TopicGraphView] Fetched optimized layout-only importance layer with ${result.graphologyLayout.elements?.length || 0} elements`,
            );
            const transformedData = this.transformLayoutOnlyData(result);
            return transformedData;
        } catch (error) {
            console.error(
                "[TopicGraphView] Error fetching importance layer:",
                error,
            );
            return this.createEmptyTopicGraph();
        }
    }

    /**
     * Transform layout-only data to visualization format (Phase 1 optimization)
     */
    private transformLayoutOnlyData(data: any): any {
        if (!data.graphologyLayout || !data.graphologyLayout.elements) {
            return this.createEmptyTopicGraph();
        }

        console.log(
            `[TopicGraphView] Using optimized layout-only contract with graphology preset layout (${data.graphologyLayout.elements?.length || 0} elements)`,
        );

        // Phase 1: Use layout-only data - no need to process raw topics/relationships
        const result: any = {
            centerTopic: null,
            topics: [], // Empty as we rely on graphology elements
            relationships: [], // Empty as we rely on graphology elements
            maxDepth: 0,
            metadata: data.metadata,
            presetLayout: {
                elements: data.graphologyLayout.elements,
                layoutDuration: data.graphologyLayout.layoutDuration,
                avgSpacing: data.graphologyLayout.avgSpacing,
                communityCount: data.graphologyLayout.communityCount,
                metadata: data.metadata,
            },
        };

        return result;
    }

    /**
     * Create an empty topic graph when no data is available
     */
    private createEmptyTopicGraph(): any {
        return {
            centerTopic: null,
            topics: [],
            relationships: [],
            maxDepth: 0,
        };
    }

    /**
     * Get all descendants of a given topic
     */
    private getAllDescendants(topicId: string, allTopics: any[]): any[] {
        const descendants: any[] = [];
        const directChildren = allTopics.filter((t) => t.parentId === topicId);

        directChildren.forEach((child) => {
            descendants.push(child);
            // Recursively get descendants of this child
            const childDescendants = this.getAllDescendants(
                child.id,
                allTopics,
            );
            descendants.push(...childDescendants);
        });

        return descendants;
    }

    private showTopicDetails(topic: any): void {
        this.state.currentTopic = topic.id;

        this.openSidebar();

        // Focus on the clicked topic node
        this.focusOnTopic(topic.id);

        const sidebarContent = document.getElementById("sidebarContent")!;
        sidebarContent.innerHTML = `
            <div class="topic-details">
                <div class="topic-name">${this.escapeHtml(topic.name)}</div>
                <div class="topic-meta">
                    <span class="topic-level">Level ${topic.level}</span>
                    <span class="topic-confidence">${Math.round(topic.confidence * 100)}% confidence</span>
                </div>

                <div class="topic-timeline">
                    <h6>Timeline</h6>
                    <div class="timeline-info">
                        <div class="timeline-item">
                            <span class="timeline-label">First Seen:</span>
                            <span id="topicFirstSeen" class="timeline-value">Loading...</span>
                        </div>
                        <div class="timeline-item">
                            <span class="timeline-label">Last Seen:</span>
                            <span id="topicLastSeen" class="timeline-value">Loading...</span>
                        </div>
                    </div>
                </div>

                <div class="topic-keywords">
                    <h6>Keywords</h6>
                    <div id="topicKeywords" class="keyword-tags">
                        <span class="text-muted">Loading...</span>
                    </div>
                </div>

                <div class="topic-entities">
                    <h6>Related Entities</h6>
                    <ul id="topicEntities" class="entity-list">
                        <li class="text-muted">Loading...</li>
                    </ul>
                </div>

                <div class="topic-actions">
                    <button class="btn btn-sm btn-outline-primary" data-action="focus" data-topic-id="${topic.id}">
                        <i class="bi bi-bullseye"></i> Focus
                    </button>
                </div>
            </div>
        `;

        this.state.sidebarOpen = true;

        this.loadTopicDetails(topic.id);
    }

    private async loadTopicDetails(topicId: string): Promise<void> {
        try {
            const result = await this.extensionService.getTopicDetails(topicId);

            if (result && result.success && result.details) {
                const details = result.details;

                const firstSeenEl = document.getElementById("topicFirstSeen");
                const lastSeenEl = document.getElementById("topicLastSeen");
                const keywordsEl = document.getElementById("topicKeywords");
                const entitiesEl = document.getElementById("topicEntities");

                if (firstSeenEl) {
                    firstSeenEl.textContent = details.firstSeen
                        ? this.formatDate(details.firstSeen)
                        : "-";
                }

                if (lastSeenEl) {
                    lastSeenEl.textContent = details.lastSeen
                        ? this.formatDate(details.lastSeen)
                        : "-";
                }

                if (
                    keywordsEl &&
                    details.keywords &&
                    details.keywords.length > 0
                ) {
                    keywordsEl.innerHTML = details.keywords
                        .map(
                            (keyword: string) =>
                                `<span class="keyword-tag">${this.escapeHtml(keyword)}</span>`,
                        )
                        .join("");
                } else if (keywordsEl) {
                    keywordsEl.innerHTML =
                        '<span class="text-muted">No keywords</span>';
                }

                if (
                    entitiesEl &&
                    details.entityReferences &&
                    details.entityReferences.length > 0
                ) {
                    entitiesEl.innerHTML = details.entityReferences
                        .map(
                            (entity: string) =>
                                `<li class="entity-item" title="Click to view in Entity Graph">${this.escapeHtml(entity)}</li>`,
                        )
                        .join("");
                } else if (entitiesEl) {
                    entitiesEl.innerHTML =
                        '<li class="text-muted">No related entities</li>';
                }
            }
        } catch (error) {
            console.error("Error loading topic details:", error);
            const firstSeenEl = document.getElementById("topicFirstSeen");
            const lastSeenEl = document.getElementById("topicLastSeen");
            const keywordsEl = document.getElementById("topicKeywords");
            const entitiesEl = document.getElementById("topicEntities");

            if (firstSeenEl) firstSeenEl.textContent = "-";
            if (lastSeenEl) lastSeenEl.textContent = "-";
            if (keywordsEl)
                keywordsEl.innerHTML =
                    '<span class="text-muted">Error loading</span>';
            if (entitiesEl)
                entitiesEl.innerHTML =
                    '<li class="text-muted">Error loading</li>';
        }
    }

    private formatDate(dateString: string | undefined | null): string {
        if (!dateString) {
            return "-";
        }
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return "-";
            }
            return date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return "-";
        }
    }

    private handleSearch(): void {
        if (!this.visualizer || !this.state.searchQuery.trim()) {
            this.visualizer?.highlightSearchResults([]);
            return;
        }

        this.handleTopicNavigation(this.state.searchQuery.trim());
    }

    private handleTopicNavigation(query: string): void {
        if (!this.visualizer) return;

        // First try to find exact match
        const exactMatch = this.findTopicByExactName(query);
        if (exactMatch) {
            // Show details and focus on the exact match
            this.showTopicDetails(exactMatch);
            this.updateBreadcrumb(exactMatch);
            this.showNotification(`Found topic: "${exactMatch.name}"`);
            this.clearUrlParameter();
            return;
        }

        // Fall back to search results
        const results = this.visualizer.searchTopics(query);
        const topicIds = results.map((topic) => topic.id);

        this.visualizer.highlightSearchResults(topicIds);

        if (results.length === 1) {
            // If exactly one result, automatically show details and focus
            this.showTopicDetails(results[0]);
            this.updateBreadcrumb(results[0]);
            this.showNotification(`Found topic: "${results[0].name}"`);
            this.clearUrlParameter();
        } else if (results.length > 1) {
            // Multiple results - just highlight and show count
            this.showNotification(
                `Found ${results.length} topics matching "${query}". Click on a highlighted topic to view details.`,
            );
        } else {
            // No results found
            this.showNotification(`No topics found matching "${query}"`);
        }
    }

    private clearUrlParameter(): void {
        // Clear the topic parameter from URL after successful navigation
        const url = new URL(window.location.href);
        url.searchParams.delete("topic");
        window.history.replaceState({}, "", url.toString());
    }

    private findTopicByExactName(name: string): any | null {
        if (!this.visualizer || !this.lastLoadedData?.topics) return null;

        // Case-insensitive exact match
        const lowerName = name.toLowerCase();
        return (
            this.lastLoadedData.topics.find(
                (topic: any) => topic.name.toLowerCase() === lowerName,
            ) || null
        );
    }

    private updateGraphStats(): void {
        const stats = this.visualizer?.getGraphStats();
        if (!stats) return;

        document.getElementById("totalTopics")!.textContent =
            stats.totalTopics.toString();
        document.getElementById("visibleTopics")!.textContent =
            stats.visibleTopics.toString();
        document.getElementById("maxDepth")!.textContent =
            stats.maxDepth.toString();
    }

    private updateBreadcrumb(topic: any): void {
        const topicNameBreadcrumb = document.getElementById(
            "topicNameBreadcrumb",
        );
        if (topicNameBreadcrumb) {
            if (topic && topic.name && topic.name !== "All Topics") {
                topicNameBreadcrumb.textContent = ` > ${topic.name}`;
                topicNameBreadcrumb.style.display = "inline";
            } else {
                topicNameBreadcrumb.textContent = "";
                topicNameBreadcrumb.style.display = "none";
            }
        }
    }

    private exportGraph(): void {
        if (!this.visualizer) return;

        const imageData = this.visualizer.exportAsImage("png");
        const link = document.createElement("a");
        link.download = `topic-graph-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = imageData;
        link.click();

        this.showNotification("Graph exported as image");
    }

    private exportGraphologyJson(): void {
        if (!this.lastLoadedData || !this.lastLoadedData.presetLayout) {
            this.showNotification(
                "No graphology layout data available to export",
            );
            return;
        }

        const jsonData = JSON.stringify(
            this.lastLoadedData.presetLayout.elements,
            null,
            2,
        );
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `graphology-topic-graph-${new Date().toISOString().slice(0, 10)}.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

        this.showNotification("Cytoscape JSON exported successfully");
    }

    private navigateToEntityGraph(entityName: string): void {
        window.location.href = `entityGraphView.html?entity=${encodeURIComponent(entityName)}`;
    }

    private navigateToGlobalView(): void {
        // Reset to global view
        this.state.currentTopic = null;
        this.updateBreadcrumb({ name: "All Topics" });
        this.loadInitialData();
    }

    public focusOnTopic(topicId: string): void {
        this.visualizer?.focusOnTopic(topicId);
    }

    private showLoading(): void {
        this.loadingOverlay.style.display = "flex";
        this.errorOverlay.style.display = "none";
    }

    private hideLoading(): void {
        this.loadingOverlay.style.display = "none";
    }

    private showError(message: string): void {
        this.hideLoading();
        this.errorOverlay.style.display = "flex";
        document.getElementById("errorMessage")!.textContent = message;
    }

    private showNotification(message: string): void {
        const toast = document.getElementById("notification")!;
        const toastBody = document.getElementById("notificationBody")!;

        toastBody.textContent = message;

        const bsToast = new (window as any).bootstrap.Toast(toast);
        bsToast.show();
    }

    private openSidebar(): void {
        this.state.sidebarOpen = true;
        this.sidebar.classList.remove("collapsed");

        // Force resize to recalculate click coordinates after sidebar layout change
        if (this.visualizer) {
            setTimeout(() => {
                if (this.visualizer) {
                    this.visualizer.resize();
                    // Force a second resize after DOM has fully updated
                    setTimeout(() => {
                        if (this.visualizer) {
                            this.visualizer.resize();
                        }
                    }, 50);
                }
            }, 100);
        }
    }

    private closeSidebar(): void {
        this.state.sidebarOpen = false;
        this.sidebar.classList.add("collapsed");

        // Force resize to recalculate click coordinates after sidebar layout change
        if (this.visualizer) {
            setTimeout(() => {
                if (this.visualizer) {
                    this.visualizer.resize();
                    // Force a second resize after DOM has fully updated
                    setTimeout(() => {
                        if (this.visualizer) {
                            this.visualizer.resize();
                        }
                    }, 50);
                }
            }, 100);
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the topic graph view
let topicGraphView: TopicGraphView;

document.addEventListener("DOMContentLoaded", () => {
    topicGraphView = new TopicGraphView();

    // Make it globally accessible for onclick handlers
    (window as any).topicGraphView = topicGraphView;
});
