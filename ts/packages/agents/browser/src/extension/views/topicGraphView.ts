// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TopicGraphVisualizer } from "./topicGraphVisualizer";
import { createExtensionService } from "./knowledgeUtilities";

interface TopicGraphViewState {
    currentTopic: string | null;
    searchQuery: string;
    viewMode: "tree" | "radial" | "force";
    visibleLevels: number[];
    sidebarOpen: boolean;
}

class TopicGraphView {
    private visualizer: TopicGraphVisualizer | null = null;
    private extensionService: any;
    private state: TopicGraphViewState = {
        currentTopic: null,
        searchQuery: "",
        viewMode: "tree",
        visibleLevels: [0, 1, 2],
        sidebarOpen: true,
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

        this.initializeEventHandlers();
        this.initializeVisualizer();
        this.loadInitialData();
    }

    private initializeEventHandlers(): void {
        // Back button
        document.getElementById("backButton")?.addEventListener("click", () => {
            this.goBack();
        });

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

        // View mode buttons
        document.querySelectorAll("[data-mode]").forEach((button) => {
            button.addEventListener("click", (e) => {
                const mode = (e.target as HTMLElement).getAttribute(
                    "data-mode",
                ) as any;
                this.setViewMode(mode);
            });
        });

        // Level filter checkboxes
        document.querySelectorAll(".level-checkbox").forEach((checkbox) => {
            checkbox.addEventListener("change", () => {
                this.updateVisibleLevels();
            });
        });

        // Sidebar controls
        document
            .getElementById("closeSidebar")
            ?.addEventListener("click", () => {
                this.toggleSidebar();
            });

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
            .getElementById("expandAllButton")
            ?.addEventListener("click", () => {
                this.expandAllTopics();
            });

        document
            .getElementById("collapseAllButton")
            ?.addEventListener("click", () => {
                this.collapseAllTopics();
            });

        document
            .getElementById("exportButton")
            ?.addEventListener("click", () => {
                this.exportGraph();
            });

        // Settings modal
        document
            .getElementById("settingsButton")
            ?.addEventListener("click", () => {
                this.showSettingsModal();
            });

        document
            .getElementById("applySettings")
            ?.addEventListener("click", () => {
                this.applySettings();
            });

        // Retry button
        document
            .getElementById("retryButton")
            ?.addEventListener("click", () => {
                this.loadInitialData();
            });

        // Entity clicks (navigate to entity graph)
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains("entity-item")) {
                const entityName = target.textContent?.trim();
                if (entityName) {
                    this.navigateToEntityGraph(entityName);
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
            // Get topic parameter from URL
            const urlParams = new URLSearchParams(window.location.search);
            const topicParam = urlParams.get("topic");

            // Load topic data from extension
            const topicData = await this.fetchTopicGraphData(topicParam);

            if (!topicData || topicData.topics.length === 0) {
                this.showError("No topic data available");
                return;
            }

            // Initialize visualizer with data
            await this.visualizer?.init(topicData);

            // Update UI
            this.updateGraphStats();
            this.hideLoading();

            // Focus on specified topic if provided
            if (topicParam && topicData.centerTopic) {
                this.visualizer?.focusOnTopic(topicData.centerTopic);
            }
        } catch (error) {
            console.error("Failed to load topic data:", error);
            this.showError("Failed to load topic data");
        }
    }

    private async fetchTopicGraphData(
        centerTopic?: string | null,
    ): Promise<any> {
        try {
            console.log("Fetching real hierarchical topic data...");

            // Fetch hierarchical topics from the extension service
            const result = await this.extensionService.sendMessage({
                type: "getHierarchicalTopics",
                parameters: {
                    centerTopic: centerTopic,
                    includeRelationships: true,
                    maxDepth: 5,
                },
            });

            if (!result || !result.success) {
                console.warn(
                    "No hierarchical topic data available:",
                    result?.error,
                );
                return this.createEmptyTopicGraph();
            }

            console.log("Fetched hierarchical topics:", result);
            return this.transformHierarchicalTopicData(result, centerTopic);
        } catch (error) {
            console.error("Error fetching topic data:", error);
            // Return empty graph instead of throwing to show a graceful error state
            return this.createEmptyTopicGraph();
        }
    }

    /**
     * Transform hierarchical topic data from database to visualization format
     */
    private transformHierarchicalTopicData(
        data: any,
        centerTopic?: string | null,
    ): any {
        if (!data.topics || data.topics.length === 0) {
            return this.createEmptyTopicGraph();
        }

        // Transform topics from database format
        const topics = data.topics.map((topic: any) => ({
            id: topic.topicId,
            name: topic.topicName,
            level: topic.level,
            parentId: topic.parentTopicId,
            confidence: topic.confidence || 0.7,
            keywords: this.parseKeywords(topic.keywords),
            entityReferences: [], // Could be populated from topic-entity relations
            childCount: this.countChildren(topic.topicId, data.topics),
        }));

        // Build relationships from parent-child structure
        const relationships = [];
        for (const topic of data.topics) {
            if (topic.parentTopicId) {
                relationships.push({
                    from: topic.parentTopicId,
                    to: topic.topicId,
                    type: "parent-child" as const,
                    strength: topic.confidence || 0.8,
                });
            }
        }

        // Determine center topic
        let actualCenterTopic = centerTopic;
        if (!actualCenterTopic) {
            // Find root topics (level 0) and use the first one
            const rootTopics = data.topics.filter((t: any) => t.level === 0);
            actualCenterTopic =
                rootTopics.length > 0 ? rootTopics[0].topicId : topics[0]?.id;
        }

        return {
            centerTopic: actualCenterTopic,
            topics,
            relationships,
            maxDepth: Math.max(...topics.map((t: any) => t.level), 0),
        };
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
     * Parse keywords from JSON string or return as array
     */
    private parseKeywords(keywords: string | string[]): string[] {
        if (Array.isArray(keywords)) {
            return keywords;
        }
        if (typeof keywords === "string") {
            try {
                return JSON.parse(keywords);
            } catch {
                return [keywords];
            }
        }
        return [];
    }

    /**
     * Count children for a given topic
     */
    private countChildren(topicId: string, allTopics: any[]): number {
        return allTopics.filter((t) => t.parentTopicId === topicId).length;
    }

    private showTopicDetails(topic: any): void {
        this.state.currentTopic = topic.id;

        const sidebarContent = document.getElementById("sidebarContent")!;
        sidebarContent.innerHTML = `
            <div class="topic-details">
                <div class="topic-name">${this.escapeHtml(topic.name)}</div>
                <div class="topic-meta">
                    <span class="topic-level">Level ${topic.level}</span>
                    <span class="topic-confidence">${Math.round(topic.confidence * 100)}% confidence</span>
                </div>

                <div class="topic-keywords">
                    <h6>Keywords</h6>
                    <div class="keyword-tags">
                        ${topic.keywords
                            .map(
                                (keyword: string) =>
                                    `<span class="keyword-tag">${this.escapeHtml(keyword)}</span>`,
                            )
                            .join("")}
                    </div>
                </div>

                <div class="topic-entities">
                    <h6>Related Entities</h6>
                    <ul class="entity-list">
                        ${topic.entityReferences
                            .map(
                                (entity: string) =>
                                    `<li class="entity-item" title="Click to view in Entity Graph">${this.escapeHtml(entity)}</li>`,
                            )
                            .join("")}
                    </ul>
                </div>

                <div class="topic-actions">
                    <button class="btn btn-sm btn-primary" onclick="topicGraphView.expandTopic('${topic.id}')">
                        <i class="bi bi-plus-square"></i> Expand
                    </button>
                    <button class="btn btn-sm btn-outline-primary" onclick="topicGraphView.focusOnTopic('${topic.id}')">
                        <i class="bi bi-bullseye"></i> Focus
                    </button>
                </div>
            </div>
        `;
    }

    private handleSearch(): void {
        if (!this.visualizer || !this.state.searchQuery.trim()) {
            this.visualizer?.highlightSearchResults([]);
            return;
        }

        const results = this.visualizer.searchTopics(this.state.searchQuery);
        const topicIds = results.map((topic) => topic.id);

        this.visualizer.highlightSearchResults(topicIds);

        // Show notification with results count
        this.showNotification(
            `Found ${results.length} topics matching "${this.state.searchQuery}"`,
        );
    }

    private setViewMode(mode: "tree" | "radial" | "force"): void {
        this.state.viewMode = mode;
        this.visualizer?.setViewMode(mode);

        // Update UI buttons
        document.querySelectorAll("[data-mode]").forEach((button) => {
            button.classList.remove("active");
        });
        document
            .querySelector(`[data-mode="${mode}"]`)
            ?.classList.add("active");
    }

    private updateVisibleLevels(): void {
        const checkboxes = document.querySelectorAll(
            ".level-checkbox:checked",
        ) as NodeListOf<HTMLInputElement>;
        this.state.visibleLevels = Array.from(checkboxes).map((cb) =>
            parseInt(cb.value),
        );
        this.visualizer?.setVisibleLevels(this.state.visibleLevels);
        this.updateGraphStats();
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
        document.getElementById("expandedCount")!.textContent =
            stats.expandedNodes.length.toString();
    }

    private updateBreadcrumb(topic: any): void {
        const breadcrumb = document.getElementById("topicBreadcrumb")!;
        // Build breadcrumb trail based on topic hierarchy
        breadcrumb.innerHTML = `
            <li class="breadcrumb-item"><a href="#" onclick="topicGraphView.goToRoot()">All Topics</a></li>
            <li class="breadcrumb-item active">${this.escapeHtml(topic.name)}</li>
        `;
    }

    private expandAllTopics(): void {
        // Implementation would expand all visible topics
        this.showNotification("Expanded all topics");
    }

    private collapseAllTopics(): void {
        // Implementation would collapse all topics
        this.showNotification("Collapsed all topics");
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

    private toggleSidebar(): void {
        this.state.sidebarOpen = !this.state.sidebarOpen;
        this.sidebar.classList.toggle("collapsed", !this.state.sidebarOpen);
    }

    private showSettingsModal(): void {
        const modal = new (window as any).bootstrap.Modal(
            document.getElementById("settingsModal"),
        );
        modal.show();
    }

    private applySettings(): void {
        // Get settings values and apply them
        const nodeSize = (
            document.getElementById("nodeSize") as HTMLInputElement
        ).value;
        const edgeWidth = (
            document.getElementById("edgeWidth") as HTMLInputElement
        ).value;
        const showLabels = (
            document.getElementById("showLabels") as HTMLInputElement
        ).checked;
        const showKeywords = (
            document.getElementById("showKeywords") as HTMLInputElement
        ).checked;
        const animateTransitions = (
            document.getElementById("animateTransitions") as HTMLInputElement
        ).checked;

        // Apply settings to visualizer
        // Implementation would update visualizer styles

        this.showNotification("Settings applied");
    }

    private navigateToEntityGraph(entityName: string): void {
        window.location.href = `entityGraphView.html?entity=${encodeURIComponent(entityName)}`;
    }

    private goBack(): void {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = "knowledgeLibrary.html";
        }
    }

    private goToRoot(): void {
        this.visualizer?.fitToView();
        this.state.currentTopic = null;
        this.updateBreadcrumb({ name: "All Topics" });
    }

    public expandTopic(topicId: string): void {
        this.visualizer?.toggleTopicExpansion(topicId);
        this.updateGraphStats();
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
