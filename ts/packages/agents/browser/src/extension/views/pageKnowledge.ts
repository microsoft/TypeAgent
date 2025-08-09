// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    notificationManager,
    extensionService,
    TemplateHelpers,
    FormatUtils,
    EventManager,
} from "./knowledgeUtilities";
import { conversation as kpLib } from "knowledge-processor";

interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    summary: string;
    contentActions?: kpLib.Action[];
    // Enhanced content data
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics?: {
        readingTime: number;
        wordCount: number;
    };
}

interface DetectedAction {
    type: string;
    element: string;
    text?: string;
    confidence: number;
}

interface ActionSummary {
    totalActions: number;
    actionTypes: string[];
    highConfidenceActions: number;
    actionDistribution: { [key: string]: number };
}

interface Entity {
    name: string;
    type: string;
    description?: string;
    confidence: number;
}

interface Relationship {
    from: string;
    relationship: string;
    to: string;
    confidence: number;
}

interface ExtractionSettings {
    mode: "basic" | "summary" | "content" | "full";
}

interface ExtractionModeInfo {
    description: string;
    requiresAI: boolean;
    features: string[];
    performance: string;
}

const MODE_DESCRIPTIONS: Record<string, ExtractionModeInfo> = {
    basic: {
        description:
            "Fast metadata extraction without AI - perfect for bulk operations",
        requiresAI: false,
        features: ["URL analysis", "Domain classification", "Basic topics"],
        performance: "Fastest",
    },
    summary: {
        description:
            "AI-enhanced content summarization with key insights extraction",
        requiresAI: true,
        features: ["Content summarization", "Key insights", "Enhanced context"],
        performance: "Fast",
    },
    content: {
        description:
            "AI-powered content analysis with entity and topic extraction",
        requiresAI: true,
        features: [
            "AI content analysis",
            "Entity extraction",
            "Topic identification",
        ],
        performance: "Fast",
    },
    full: {
        description:
            "Complete AI analysis with relationships and cross-references",
        requiresAI: true,
        features: [
            "Full AI analysis",
            "Relationship extraction",
            "Cross-references",
        ],
        performance: "Thorough",
    },
};

class KnowledgePanel {
    private currentUrl: string = "";
    private isConnected: boolean = false;
    private knowledgeData: KnowledgeData | null = null;
    private extractionSettings: ExtractionSettings;
    private aiModelAvailable: boolean = false;
    private connectionStatusCallback?: (connected: boolean) => void;

    constructor() {
        this.extractionSettings = {
            mode: "content",
        };
    }

    async initialize() {
        console.log("Initializing Enhanced Knowledge Panel");

        // Check AI availability first to prevent race conditions
        await this.checkAIModelAvailability();

        this.setupEventListeners();
        await this.loadCurrentPageInfo();
        await this.loadAutoIndexSetting();
        await this.checkConnectionStatus();
        this.setupConnectionStatusListener();
        await this.loadFreshKnowledge();
        await this.loadExtractionSettings();
    }

    private setupEventListeners() {
        document
            .getElementById("extractKnowledge")!
            .addEventListener("click", () => {
                this.extractKnowledge();
            });

        document.getElementById("indexPage")!.addEventListener("click", () => {
            this.indexCurrentPage();
        });

        document
            .getElementById("autoIndexToggle")!
            .addEventListener("change", (e) => {
                const checkbox = e.target as HTMLInputElement;
                this.toggleAutoIndex(checkbox.checked);
            });

        document
            .getElementById("submitQuery")!
            .addEventListener("click", () => {
                this.submitQuery();
            });

        document
            .getElementById("knowledgeQuery")!
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.submitQuery();
                }
            });

        document
            .getElementById("extractionMode")!
            .addEventListener("input", (e) => {
                const slider = e.target as HTMLInputElement;
                const modeMap = ["basic", "summary", "content", "full"];
                const mode = modeMap[parseInt(slider.value)] as any;
                slider.setAttribute("data-mode", mode);
                this.updateExtractionMode(mode);
                this.updateSliderLabels(parseInt(slider.value));
            });

        // Add click handlers for slider labels
        document.querySelectorAll(".slider-label").forEach((label, index) => {
            label.addEventListener("click", () => {
                const slider = document.getElementById(
                    "extractionMode",
                ) as HTMLInputElement;
                const modeMap = ["basic", "summary", "content", "full"];
                slider.value = index.toString();
                slider.setAttribute("data-mode", modeMap[index]);
                this.updateExtractionMode(modeMap[index] as any);
                this.updateSliderLabels(index);
            });
        });

        EventManager.setupTabListeners(() => {
            this.onTabChange();
        });
    }

    private async loadCurrentPageInfo() {
        try {
            const tab = await extensionService.getCurrentTab();
            if (tab) {
                this.currentUrl = tab.url || "";

                const pageInfo = document.getElementById("currentPageInfo")!;
                const domain = new URL(this.currentUrl).hostname;
                const status = await this.getPageIndexStatus();

                pageInfo.innerHTML = this.createPageInfo(
                    tab.title || "Untitled",
                    domain,
                    status,
                );
            }
        } catch (error) {
            console.error("Error loading page info:", error);
        }
    }

    private async getPageIndexStatus(retryCount: number = 0): Promise<string> {
        try {
            const response = await extensionService.getPageIndexStatus(
                this.currentUrl,
            );

            if (response.isIndexed) {
                const lastIndexedDate = response.lastIndexed
                    ? new Date(response.lastIndexed).toLocaleDateString()
                    : "Unknown";
                const entityCount = response.entityCount || 0;

                return `
                    <span class="badge bg-success position-relative">
                        <i class="bi bi-check-circle me-1"></i>Indexed
                        <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-info">
                            ${entityCount}
                            <span class="visually-hidden">entities</span>
                        </span>
                    </span>
                    <div class="small text-muted mt-1">
                        Last: ${lastIndexedDate}
                    </div>
                `;
            } else {
                // If not indexed and this is a retry attempt (likely after recent indexing),
                // try once more with a longer delay
                if (retryCount < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    return this.getPageIndexStatus(retryCount + 1);
                }

                return `
                    <span class="badge bg-secondary">
                        <i class="bi bi-circle me-1"></i>Not indexed
                    </span>
                    <div class="small text-muted mt-1">
                        Ready to index
                    </div>
                `;
            }
        } catch (error) {
            return `
                <span class="badge bg-warning">
                    <i class="bi bi-question-circle me-1"></i>Unknown
                </span>
                <div class="small text-muted mt-1">
                    Check connection
                </div>
            `;
        }
    }

    private async refreshPageStatusAfterIndexing() {
        try {
            const tab = await extensionService.getCurrentTab();
            if (tab) {
                this.currentUrl = tab.url || "";

                const pageInfo = document.getElementById("currentPageInfo")!;
                const domain = new URL(this.currentUrl).hostname;

                // Force a status check with retry for recent indexing
                const status = await this.getPageIndexStatus(0);

                pageInfo.innerHTML = this.createPageInfo(
                    tab.title || "Untitled",
                    domain,
                    status,
                );
            }
        } catch (error) {
            console.error(
                "Error refreshing page status after indexing:",
                error,
            );
        }
    }

    private async loadAutoIndexSetting() {
        try {
            const enabled = await extensionService.getAutoIndexSetting();
            const toggle = document.getElementById(
                "autoIndexToggle",
            ) as HTMLInputElement;
            toggle.checked = enabled;
        } catch (error) {
            console.error("Error loading auto-index setting:", error);
        }
    }

    private async toggleAutoIndex(enabled: boolean) {
        try {
            await extensionService.setAutoIndexSetting(enabled);

            // Update status indicator
            const statusText = enabled
                ? "Auto-indexing enabled"
                : "Auto-indexing disabled";
            notificationManager.showTemporaryStatus(
                statusText,
                enabled ? "success" : "info",
            );

            // Notify background script
            await extensionService.notifyAutoIndexSettingChanged(enabled);
        } catch (error) {
            console.error("Error toggling auto-index:", error);
        }
    }

    private async extractKnowledge() {
        const button = document.getElementById(
            "extractKnowledge",
        ) as HTMLButtonElement;
        const originalContent = button.innerHTML;

        // Show extracting state with progress indicator
        button.innerHTML =
            '<i class="bi bi-hourglass-split spinner-grow spinner-grow-sm me-2"></i>Extracting...';
        button.disabled = true;
        button.classList.add("btn-warning");
        button.classList.remove("btn-primary");

        this.showKnowledgeLoading();

        try {
            // Validate mode selection before extraction with defensive check
            if (this.extractionSettings.mode !== "basic") {
                // Defensive check: ensure AI availability is properly determined
                if (this.aiModelAvailable === undefined) {
                    console.log(
                        "AI availability not yet determined, checking now...",
                    );
                    await this.checkAIModelAvailability();
                }

                if (!this.aiModelAvailable) {
                    this.showAIRequiredError();
                    return;
                }
            }

            const startTime = Date.now();

            const response = await extensionService.extractPageKnowledge(
                this.currentUrl,
                this.extractionSettings.mode,
                this.extractionSettings,
            );

            const processingTime = Date.now() - startTime;

            this.knowledgeData = response.knowledge;
            if (this.knowledgeData) {
                // Check for insufficient content case
                const isInsufficientContent = this.checkInsufficientContent(
                    this.knowledgeData,
                );

                if (isInsufficientContent) {
                    // Show error state for insufficient content
                    button.innerHTML =
                        '<i class="bi bi-exclamation-triangle me-2"></i>Insufficient Content';
                    button.classList.remove("btn-warning");
                    button.classList.add("btn-warning");

                    this.showInsufficientContentError();

                    notificationManager.showEnhancedNotification(
                        "warning",
                        "Insufficient Content",
                        "This page doesn't have enough content to extract meaningful knowledge or its content is not available. Try refreshing the page.",
                        "bi-exclamation-triangle",
                    );

                    // Brief delay to show warning state
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    return; // Don't render empty knowledge modules
                }

                // Show success state briefly
                button.innerHTML =
                    '<i class="bi bi-check-circle me-2"></i>Extracted!';
                button.classList.remove("btn-warning");
                button.classList.add("btn-success");

                await this.renderKnowledgeResults(this.knowledgeData);
                this.showExtractionInfo();

                // Show detailed success notification
                const entityCount = this.knowledgeData.entities?.length || 0;
                const topicCount = this.knowledgeData.keyTopics?.length || 0;
                const relationshipCount =
                    this.knowledgeData.relationships?.length || 0;

                notificationManager.showEnhancedNotification(
                    "success",
                    "Knowledge Extracted Successfully!",
                    `Found ${entityCount} entities, ${topicCount} topics, ${relationshipCount} relationships using ${this.extractionSettings.mode} mode in ${Math.round(processingTime / 1000)}s`,
                    "bi-brain",
                );

                // Brief delay to show success state
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        } catch (error) {
            console.error("Error extracting knowledge:", error);

            // Show error state
            button.innerHTML =
                '<i class="bi bi-exclamation-triangle me-2"></i>Error';
            button.classList.remove("btn-warning");
            button.classList.add("btn-danger");

            if ((error as Error).message?.includes("AI model required")) {
                this.showAIRequiredError();
            } else {
                this.showKnowledgeError(
                    "Failed to extract knowledge. Please check your connection.",
                );
                notificationManager.showEnhancedNotification(
                    "danger",
                    "Knowledge Extraction Failed",
                    (error as Error).message ||
                        "Failed to extract knowledge from page",
                    "bi-exclamation-triangle",
                );
            }

            // Brief delay to show error state
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } finally {
            // Restore original button state
            button.innerHTML = originalContent;
            button.disabled = false;
            button.classList.remove("btn-warning", "btn-success", "btn-danger");
            button.classList.add("btn-primary");
        }
    }

    private async indexCurrentPage() {
        const button = document.getElementById(
            "indexPage",
        ) as HTMLButtonElement;
        const originalContent = button.innerHTML;

        // Show indexing state with progress indicator
        button.innerHTML =
            '<i class="bi bi-hourglass-split spinner-grow spinner-grow-sm me-2"></i>Indexing...';
        button.disabled = true;
        button.classList.add("btn-warning");
        button.classList.remove("btn-outline-primary");

        try {
            // Validate mode selection before indexing with defensive check
            if (this.extractionSettings.mode !== "basic") {
                // Defensive check: ensure AI availability is properly determined
                if (this.aiModelAvailable === undefined) {
                    console.log(
                        "AI availability not yet determined, checking now...",
                    );
                    await this.checkAIModelAvailability();
                }

                if (!this.aiModelAvailable) {
                    this.showAIRequiredError();
                    return;
                }
            }

            const startTime = Date.now();

            const response = await extensionService.indexPageContent(
                this.currentUrl,
                this.extractionSettings.mode,
            );

            const processingTime = Date.now() - startTime;

            // Show success state briefly
            button.innerHTML =
                '<i class="bi bi-check-circle me-2"></i>Indexed!';
            button.classList.remove("btn-warning");
            button.classList.add("btn-success");

            // Wait for backend to complete processing and get accurate entity count
            let actualEntityCount = 0;
            let attempts = 0;
            const maxAttempts = 10;

            while (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                try {
                    const status = await extensionService.getPageIndexStatus(
                        this.currentUrl,
                    );
                    if (status.isIndexed && status.entityCount !== undefined) {
                        actualEntityCount = status.entityCount;
                        break;
                    }
                } catch (error) {
                    console.warn(
                        "Error checking index status during entity count polling:",
                        error,
                    );
                }
                attempts++;
            }

            // Show detailed success notification with accurate count
            notificationManager.showEnhancedNotification(
                "success",
                "Page Indexed Successfully!",
                `Extracted ${actualEntityCount} entities using ${this.extractionSettings.mode} mode in ${Math.round(processingTime / 1000)}s`,
                "bi-database-check",
            );

            // Brief delay to show success state
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Update all relevant UI components after successful indexing
            await this.refreshPageStatusAfterIndexing();
            await this.loadFreshKnowledge(); // Load and display the newly indexed knowledge data
        } catch (error) {
            console.error("Error indexing page:", error);

            // Show error state
            button.innerHTML =
                '<i class="bi bi-exclamation-triangle me-2"></i>Error';
            button.classList.remove("btn-warning");
            button.classList.add("btn-danger");

            if ((error as Error).message?.includes("AI model required")) {
                this.showAIRequiredError();
            } else {
                notificationManager.showEnhancedNotification(
                    "danger",
                    "Indexing Failed",
                    (error as Error).message || "Failed to index page",
                    "bi-exclamation-triangle",
                );
            }

            // Brief delay to show error state
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } finally {
            // Restore original button state
            button.innerHTML = originalContent;
            button.disabled = false;
            button.classList.remove("btn-warning", "btn-success", "btn-danger");
            button.classList.add("btn-outline-primary");
        }
    }

    private async submitQuery() {
        const queryInput = document.getElementById(
            "knowledgeQuery",
        ) as HTMLInputElement;
        const queryResults = document.getElementById("queryResults")!;
        const query = queryInput.value.trim();

        if (!query) return;

        // Use basic query logic
        queryResults.innerHTML = TemplateHelpers.createSearchLoadingState();

        try {
            const response = await extensionService.queryKnowledge({
                query: query,
                url: this.currentUrl,
                searchScope: "current_page",
            });

            queryResults.innerHTML = TemplateHelpers.createQueryAnswer(
                response.answer,
                response.sources,
            );
            queryInput.value = "";
        } catch (error) {
            console.error("Error querying knowledge:", error);
            queryResults.innerHTML = TemplateHelpers.createAlert(
                "danger",
                "bi bi-exclamation-triangle",
                "Error processing query. Please try again.",
            );
        }
    }

    private showKnowledgeLoading() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = TemplateHelpers.createLoadingState(
            "Extracting knowledge from page...",
            "This may take a few seconds",
        );
    }

    private showKnowledgeError(message: string) {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <i class="bi bi-exclamation-triangle text-danger h3"></i>
                    <p class="mb-0">${message}</p>
                </div>
            </div>
        `;
    }

    private checkInsufficientContent(knowledge: KnowledgeData): boolean {
        // Check for the specific insufficient content case
        const hasInsufficientSummary =
            knowledge.summary === "Insufficient content to extract knowledge.";
        const hasNoMetrics =
            knowledge.contentMetrics?.wordCount === 0 &&
            knowledge.contentMetrics?.readingTime === 0;
        const hasNoEntities =
            !knowledge.entities || knowledge.entities.length === 0;
        const hasNoTopics =
            !knowledge.keyTopics || knowledge.keyTopics.length === 0;
        const hasNoRelationships =
            !knowledge.relationships || knowledge.relationships.length === 0;

        // Consider it insufficient if summary indicates it AND we have no meaningful content
        return (
            hasInsufficientSummary &&
            hasNoMetrics &&
            hasNoEntities &&
            hasNoTopics &&
            hasNoRelationships
        );
    }

    private showInsufficientContentError() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center py-5">
                    <i class="bi bi-file-earmark-x text-warning h1 mb-3"></i>
                    <h5 class="text-warning mb-3">Insufficient Content</h5>
                    <p class="text-muted mb-3">
                        This page doesn't have enough readable content to extract meaningful knowledge.
                    </p>
                    <div class="text-start">
                        <small class="text-muted">
                            <strong>Possible reasons:</strong><br>
                            • Page content is behind authentication<br>
                            • Content is loaded dynamically with JavaScript<br>
                            • Page has mostly images or media with little text<br>
                            • Page is still loading or has errors<br>
                        </small>
                    </div>
                    <div class="mt-4">
                        <button class="btn btn-outline-primary btn-sm" onclick="window.location.reload()">
                            <i class="bi bi-arrow-repeat me-1"></i>
                            Try Again
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Helper functions to check if modules have meaningful data
    private hasContentMetrics(knowledge: KnowledgeData): boolean {
        return !!(
            knowledge.contentMetrics &&
            (knowledge.contentMetrics.readingTime > 0 ||
                knowledge.contentMetrics.wordCount > 0)
        );
    }

    private hasRelatedContent(knowledge: KnowledgeData): boolean {
        // Check if there's any meaningful related content to show
        // This could be expanded based on what constitutes "related content"
        // For now, return false to hide by default until we have actual related content logic
        return false;
    }

    private renderRelatedContent(knowledge: KnowledgeData) {
        const container = document.getElementById("relatedContentContainer")!;
        // Since hasRelatedContent returns false, this method won't be called
        // But we include it for completeness and future expansion
        container.innerHTML = `
            <div class="text-muted text-center">
                <i class="bi bi-info-circle"></i>
                No related content available
            </div>
        `;
    }

    private async renderKnowledgeResults(knowledge: KnowledgeData) {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            ${this.hasContentMetrics(knowledge) ? this.renderContentMetricsCard() : ""}
            ${this.hasRelatedContent(knowledge) ? this.renderRelatedContentCard() : ""}
            ${this.renderEntitiesCard()}
            ${this.renderRelationshipsCard()}
            ${this.renderTopicsCard()}
            ${knowledge.detectedActions && knowledge.detectedActions.length > 0 ? this.renderUserActionsCard() : ""}
        `;

        if (this.hasContentMetrics(knowledge)) {
            this.renderContentMetrics(knowledge.contentMetrics);
        }

        if (this.hasRelatedContent(knowledge)) {
            this.renderRelatedContent(knowledge);
        }

        this.renderEntities(knowledge.entities);
        this.renderRelationships(knowledge.relationships);
        this.renderKeyTopics(knowledge.keyTopics);
        if (knowledge.detectedActions && knowledge.detectedActions.length > 0) {
            this.renderDetectedActions(
                knowledge.detectedActions,
                knowledge.actionSummary,
            );
        }
    }

    private renderEntities(entities: Entity[]) {
        const container = document.getElementById("entitiesContainer")!;
        const countBadge = document.getElementById("entitiesCount")!;

        countBadge.textContent = entities.length.toString();

        if (entities.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No entities found on this page
                </div>
            `;
            return;
        }

        container.innerHTML = entities
            .map(
                (entity) => `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <span class="fw-semibold">${entity.name}</span>
                    <span class="entity-badge badge bg-secondary">${entity.type}</span>
                </div>
                <div>
                    <div class="progress" style="width: 50px; height: 4px;">
                        <div class="progress-bar" style="width: ${entity.confidence * 100}%"></div>
                    </div>
                </div>
            </div>
            ${entity.description ? `<small class="text-muted">${entity.description}</small><hr class="my-2">` : ""}
        `,
            )
            .join("");
    }

    private renderRelationships(relationships: Relationship[]) {
        const container = document.getElementById("relationshipsContainer")!;
        const countBadge = document.getElementById("relationshipsCount")!;

        countBadge.textContent = relationships.length.toString();

        if (relationships.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No entity actions identified
                </div>
            `;
            return;
        }

        container.innerHTML = relationships
            .map(
                (rel) => `
            <div class="relationship-item rounded">
                <span class="fw-semibold">${rel.from}</span>
                <i class="bi bi-arrow-right mx-2 text-muted"></i>
                <span class="text-muted">${rel.relationship}</span>
                <i class="bi bi-arrow-right mx-2 text-muted"></i>
                <span class="fw-semibold">${rel.to}</span>
            </div>
        `,
            )
            .join("");
    }

    private renderKeyTopics(topics: string[]) {
        const container = document.getElementById("topicsContainer")!;

        if (topics.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No key topics identified
                </div>
            `;
            return;
        }

        container.innerHTML = topics
            .map(
                (topic) => `
            <span class="badge bg-primary me-1 mb-1">${topic}</span>
        `,
            )
            .join("");
    }

    private setupRelatedContentInteractions() {
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Handle visit page button clicks
            if (target.closest(".visit-page")) {
                e.preventDefault();
                const button = target.closest(".visit-page") as HTMLElement;
                const url = button.getAttribute("data-url");

                if (url) {
                    // Add visual feedback
                    button.classList.add("btn-primary");
                    button.classList.remove("btn-outline-primary");
                    setTimeout(() => {
                        button.classList.remove("btn-primary");
                        button.classList.add("btn-outline-primary");
                    }, 300);

                    // Open the page in a new tab
                    extensionService.createTab(url, false);
                }
            }

            // Handle source open button clicks
            if (target.closest(".source-open-btn")) {
                e.preventDefault();
                const button = target.closest(
                    ".source-open-btn",
                ) as HTMLElement;
                const url = button.getAttribute("data-url");

                if (url) {
                    // Add visual feedback
                    button.classList.add("btn-primary");
                    button.classList.remove("btn-outline-primary");
                    setTimeout(() => {
                        button.classList.remove("btn-primary");
                        button.classList.add("btn-outline-primary");
                    }, 300);

                    // Open the source in a new tab
                    extensionService.createTab(url, false);
                }
            }

            // Handle explore related content button clicks
            if (target.closest(".explore-related")) {
                e.preventDefault();
                const button = target.closest(
                    ".explore-related",
                ) as HTMLElement;
                const query = button.getAttribute("data-query");

                if (query) {
                    // Add visual feedback
                    button.classList.add("btn-secondary");
                    button.classList.remove("btn-outline-secondary");
                    setTimeout(() => {
                        button.classList.remove("btn-secondary");
                        button.classList.add("btn-outline-secondary");
                    }, 300);

                    // Set query and submit
                    const queryInput = document.getElementById(
                        "knowledgeQuery",
                    ) as HTMLInputElement;
                    if (queryInput) {
                        queryInput.value = query;
                        this.submitQuery();
                    }
                }
            }

            // Handle related content item clicks (for future navigation features)
            if (target.closest(".related-page-item")) {
                const item = target.closest(
                    ".related-page-item",
                ) as HTMLElement;
                const url = item.getAttribute("data-url");
                const type = item.getAttribute("data-type");

                // Add visual feedback
                item.classList.add("border-primary", "bg-light");
                setTimeout(() => {
                    item.classList.remove("border-primary", "bg-light");
                }, 300);

                // For now, create a query based on the relationship
                if (url && url === "#") {
                    const title =
                        item.querySelector(".fw-semibold")?.textContent;
                    if (title) {
                        const queryInput = document.getElementById(
                            "knowledgeQuery",
                        ) as HTMLInputElement;
                        if (queryInput) {
                            queryInput.value = `content related to ${title}`;
                        }
                    }
                }
            }
        });
    }

    private async loadExtractionSettings() {
        try {
            const settings = await extensionService.getExtractionSettings();
            if (settings) {
                this.extractionSettings = {
                    ...this.extractionSettings,
                    ...settings,
                };
                // Sync with slider
                const slider = document.getElementById(
                    "extractionMode",
                ) as HTMLInputElement;
                if (slider && this.extractionSettings.mode) {
                    const modeMap = ["basic", "summary", "content", "full"];
                    const value = modeMap.indexOf(this.extractionSettings.mode);
                    slider.value = value.toString();
                    slider.setAttribute(
                        "data-mode",
                        this.extractionSettings.mode,
                    );
                    this.updateSliderLabels(value);
                }
            }
        } catch (error) {
            console.error("Error loading extraction settings:", error);
        }
    }

    // Enhanced knowledge extraction status display with advanced integration
    private showExtractionInfo() {
        if (!this.knowledgeData) return;

        const infoDiv = document.createElement("div");
        infoDiv.className = "alert alert-info mt-2";

        // Calculate knowledge quality metrics
        const qualityMetrics = this.calculateKnowledgeQuality(
            this.knowledgeData,
        );

        let content = `<small>
            <i class="bi bi-cpu me-1"></i>
            <strong>Enhanced Extraction</strong> using <strong>${this.extractionSettings.mode}</strong> mode
            <div class="mt-2">
                <div class="d-flex align-items-center justify-content-between">
                    <span>Knowledge Quality:</span>
                    <div class="d-flex align-items-center">
                        <div class="progress me-2" style="width: 100px; height: 6px;">
                            <div class="progress-bar bg-${qualityMetrics.color}" 
                                 style="width: ${qualityMetrics.score}%" 
                                 title="Overall quality: ${qualityMetrics.score}%">
                            </div>
                        </div>
                        <span class="badge bg-${qualityMetrics.color}">${qualityMetrics.label}</span>
                    </div>
                </div>
                <div class="row mt-2 g-2">
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.entities.color}">${this.knowledgeData.entities?.length || 0}</div>
                        <small class="text-muted">Entities</small>
                    </div>
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.relationships.color}">${this.knowledgeData.relationships?.length || 0}</div>
                        <small class="text-muted">Relations</small>
                    </div>
                    <div class="col-4 text-center">
                        <div class="fw-semibold text-${qualityMetrics.topics.color}">${this.knowledgeData.keyTopics?.length || 0}</div>
                        <small class="text-muted">Topics</small>
                    </div>
                </div>
            </div>`;

        // Show enhanced capabilities if detected
        if (
            this.knowledgeData.detectedActions &&
            this.knowledgeData.detectedActions.length > 0
        ) {
            content += `
                <div class="mt-2 p-2 bg-light rounded">
                    <small class="text-success">
                        <i class="bi bi-lightning-fill me-1"></i>
                        <strong>Action Detection:</strong> ${this.knowledgeData.detectedActions.length} interactive elements identified
                    </small>
                </div>`;
        }

        content += "</small>";
        infoDiv.innerHTML = content;

        const knowledgeSection = document.getElementById("knowledgeSection")!;
        const firstCard = knowledgeSection.querySelector(".knowledge-card");
        if (firstCard) {
            knowledgeSection.insertBefore(infoDiv, firstCard);
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await extensionService.checkConnection();

            this.isConnected = response.connected;
            this.updateConnectionStatus();
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus")!;
        const indicator = statusElement.querySelector(".status-indicator")!;

        if (this.isConnected) {
            indicator.className = "status-indicator status-connected";
            statusElement.innerHTML = `
                <span class="status-indicator status-connected"></span>
                Connected to TypeAgent
            `;
        } else {
            indicator.className = "status-indicator status-disconnected";
            statusElement.innerHTML = `
                <span class="status-indicator status-disconnected"></span>
                Disconnected from TypeAgent
            `;
        }
    }

    private setupConnectionStatusListener(): void {
        this.connectionStatusCallback = (connected: boolean) => {
            console.log(
                `Connection status changed: ${connected ? "Connected" : "Disconnected"}`,
            );
            this.isConnected = connected;
            this.updateConnectionStatus();
        };

        extensionService.onConnectionStatusChange(
            this.connectionStatusCallback,
        );
    }

    public cleanup(): void {
        if (this.connectionStatusCallback) {
            extensionService.removeConnectionStatusListener(
                this.connectionStatusCallback,
            );
        }
    }
    private async onTabChange() {
        await this.loadCurrentPageInfo();
        await this.loadFreshKnowledge();
    }

    private async loadFreshKnowledge() {
        try {
            const indexStatus = await extensionService.getPageIndexStatus(
                this.currentUrl,
            );

            if (indexStatus.isIndexed) {
                await this.loadIndexedKnowledge();
            } else {
                this.showNotIndexedState();
            }
        } catch (error) {
            console.error("Error loading fresh knowledge:", error);
            this.showConnectionError();
        }
    }

    private showNotIndexedState() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <i class="bi bi-info-circle text-info h3"></i>
                    <p class="mb-0">This page is not indexed yet.</p>
                    <small class="text-muted">Click "Extract" or "Index" to analyze this page.</small>
                </div>
            </div>
        `;

        const questionsSection = document.getElementById("questionsSection")!;
        questionsSection.className = "knowledge-card card d-none";
    }

    private showConnectionError() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <i class="bi bi-exclamation-triangle text-warning h3"></i>
                    <p class="mb-0">Unable to connect to knowledge service.</p>
                    <small class="text-muted">Check your connection and try again.</small>
                </div>
            </div>
        `;

        const questionsSection = document.getElementById("questionsSection")!;
        questionsSection.className = "knowledge-card card d-none";
    }

    private async loadIndexedKnowledge() {
        try {
            const response = await extensionService.getPageIndexedKnowledge(
                this.currentUrl,
            );

            if (response.isIndexed && response.knowledge) {
                this.knowledgeData = response.knowledge;
                if (this.knowledgeData) {
                    await this.renderKnowledgeResults(this.knowledgeData);
                    this.showIndexedKnowledgeIndicator();
                }
            } else {
                this.showNotIndexedState();
            }
        } catch (error) {
            console.error("Error loading indexed knowledge:", error);
            this.showConnectionError();
        }
    }

    private showIndexedKnowledgeIndicator() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        const firstCard = knowledgeSection.querySelector(".knowledge-card");

        if (firstCard) {
            const indicatorDiv = document.createElement("div");
            indicatorDiv.className = "alert alert-info mt-2";
            indicatorDiv.innerHTML = `
                <small>
                    <i class="bi bi-database-check me-1"></i>
                    <strong>Indexed Knowledge</strong> - This information was retrieved from your knowledge index
                    <div class="mt-1">
                        <span class="badge bg-success">
                            <i class="bi bi-check-circle me-1"></i>Available Offline
                        </span>
                    </div>
                </small>
            `;

            knowledgeSection.insertBefore(indicatorDiv, firstCard);
        }
    }

    private createContainer(id: string, defaultContent: string): string {
        return `<div id="${id}">${defaultContent}</div>`;
    }

    // Knowledge card component methods
    private renderEntitiesCard(): string {
        const content = this.createContainer(
            "entitiesContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No entities extracted yet",
            ),
        );
        return TemplateHelpers.createCard(
            "Entities",
            content,
            "bi bi-tags",
            "entitiesCount",
        );
    }

    private renderRelationshipsCard(): string {
        const content = this.createContainer(
            "relationshipsContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No entity actions found yet",
            ),
        );
        return TemplateHelpers.createCard(
            "Entity Actions",
            content,
            "bi bi-diagram-3",
            "relationshipsCount",
        );
    }

    private renderTopicsCard(): string {
        const content = this.createContainer(
            "topicsContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No topics identified yet",
            ),
        );
        return TemplateHelpers.createCard(
            "Key Topics",
            content,
            "bi bi-bookmark",
        );
    }

    // Template utility functions for knowledge panel

    private createPageInfo(
        title: string,
        domain: string,
        status: string,
    ): string {
        return `
            <div class="d-flex align-items-center">
                <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                     width="16" height="16" class="me-2" alt="favicon">
                <div class="flex-grow-1">
                    <div class="fw-semibold">${title || "Untitled"}</div>
                    <small class="text-muted">${domain}</small>
                </div>
                <div id="pageStatus" class="ms-2">${status}</div>
            </div>
        `;
    }

    // Content Metrics Card component with enhanced visualization
    private renderContentMetricsCard(): string {
        const content = this.createContainer(
            "contentMetricsContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No content metrics available",
            ),
        );
        return TemplateHelpers.createCard(
            "Content Analysis",
            content,
            "bi bi-bar-chart-line",
        );
    }

    // Related Content Card component
    private renderRelatedContentCard(): string {
        const content = this.createContainer(
            "relatedContentContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No related content found",
            ),
        );
        return TemplateHelpers.createCard(
            "Related Content",
            content,
            "bi bi-link-45deg",
            "relatedContentCount",
        );
    }
    private renderUserActionsCard(): string {
        const content = this.createContainer(
            "detectedActionsContainer",
            TemplateHelpers.createEmptyState(
                "bi bi-info-circle",
                "No user actions detected",
            ),
        );
        return TemplateHelpers.createCard(
            "User Actions",
            content,
            "bi bi-lightning",
            "actionsCount",
        );
    }

    // Render enhanced content metrics with visual indicators
    private renderContentMetrics(metrics: any) {
        const container = document.getElementById("contentMetricsContainer")!;

        // Calculate derived metrics
        const readingTimeCategory = this.getReadingTimeCategory(
            metrics.readingTime,
        );
        const wordCountCategory = this.getWordCountCategory(metrics.wordCount);

        container.innerHTML = `
            <!-- Reading Time Section -->
            <div class="metric-section mb-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-primary">
                        <i class="bi bi-clock me-2"></i>Reading Time
                    </h6>
                    <span class="badge bg-${readingTimeCategory.color}">${readingTimeCategory.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="d-flex align-items-center mb-2">
                        <div class="reading-time-display me-3">
                            <span class="h4 mb-0 text-primary">${metrics.readingTime}</span>
                            <small class="text-muted ms-1">min</small>
                        </div>
                        <div class="flex-grow-1">
                            <div class="progress" style="height: 8px;">
                                <div class="progress-bar bg-${readingTimeCategory.color}" 
                                     style="width: ${Math.min(metrics.readingTime * 10, 100)}%"
                                     title="${metrics.readingTime} minutes">
                                </div>
                            </div>
                            <small class="text-muted">${readingTimeCategory.description}</small>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Word Count Section -->
            <div class="metric-section mb-4">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <h6 class="mb-0 text-info">
                        <i class="bi bi-file-text me-2"></i>Content Volume
                    </h6>
                    <span class="badge bg-${wordCountCategory.color}">${wordCountCategory.label}</span>
                </div>
                <div class="metric-visual-container">
                    <div class="row text-center mb-2">
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-info">${metrics.wordCount.toLocaleString()}</div>
                                <small class="text-muted">Words</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="metric-card p-2 bg-light rounded">
                                <div class="h5 mb-0 text-info">${Math.round(metrics.wordCount / Math.max(metrics.readingTime, 1))}</div>
                                <small class="text-muted">WPM</small>
                            </div>
                        </div>
                    </div>
                    <small class="text-muted">${wordCountCategory.description}</small>
                </div>
            </div>
        `;
    }

    // Render detected actions
    private renderDetectedActions(
        actions: DetectedAction[],
        summary?: ActionSummary,
    ) {
        const container = document.getElementById("detectedActionsContainer")!;
        const countBadge = document.getElementById("actionsCount");

        if (countBadge) {
            countBadge.textContent = actions.length.toString();
        }

        if (actions.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No actions detected on this page
                </div>
            `;
            return;
        }

        let summaryHtml = "";
        if (summary) {
            summaryHtml = `
                <div class="mb-3 p-2 bg-light rounded">
                    <small class="text-muted">Summary:</small><br>
                    <span class="fw-semibold">${summary.totalActions} total actions</span>
                    ${summary.actionTypes.length > 0 ? `<br><small>Types: ${summary.actionTypes.join(", ")}</small>` : ""}
                </div>
            `;
        }

        const actionsHtml = actions
            .slice(0, 10)
            .map(
                (action) => `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 border rounded">
                    <div>
                        <span class="fw-semibold">${action.type}</span>
                        <span class="badge bg-secondary ms-2">${action.element}</span>
                        ${action.text ? `<br><small class="text-muted">${action.text}</small>` : ""}
                    </div>
                    <div>
                        <div class="progress" style="width: 50px; height: 4px;">
                            <div class="progress-bar bg-success" style="width: ${action.confidence * 100}%"></div>
                        </div>
                    </div>
                </div>
            `,
            )
            .join("");

        container.innerHTML = summaryHtml + actionsHtml;
    }

    // Helper methods for enhanced content metrics
    private getReadingTimeCategory(readingTime: number) {
        if (readingTime <= 2) {
            return {
                color: "success",
                label: "Quick Read",
                description: "Fast consumption content",
            };
        } else if (readingTime <= 5) {
            return {
                color: "info",
                label: "Short Read",
                description: "Brief but informative",
            };
        } else if (readingTime <= 15) {
            return {
                color: "warning",
                label: "Medium Read",
                description: "Substantial content",
            };
        } else {
            return {
                color: "danger",
                label: "Long Read",
                description: "In-depth material",
            };
        }
    }

    private getWordCountCategory(wordCount: number) {
        if (wordCount <= 300) {
            return {
                color: "success",
                label: "Brief",
                description: "Concise and focused content",
            };
        } else if (wordCount <= 1000) {
            return {
                color: "info",
                label: "Standard",
                description: "Typical article length",
            };
        } else if (wordCount <= 3000) {
            return {
                color: "warning",
                label: "Detailed",
                description: "Comprehensive coverage",
            };
        } else {
            return {
                color: "danger",
                label: "Extensive",
                description: "In-depth exploration",
            };
        }
    }

    // Calculate knowledge quality metrics for enhanced display
    private calculateKnowledgeQuality(knowledge: KnowledgeData) {
        const entityCount = knowledge.entities?.length || 0;
        const relationshipCount = knowledge.relationships?.length || 0;
        const topicCount = knowledge.keyTopics?.length || 0;
        const actionCount = knowledge.detectedActions?.length || 0;

        // Calculate component scores
        const entityScore = Math.min(entityCount * 10, 40); // Max 40 points for entities
        const relationshipScore = Math.min(relationshipCount * 15, 30); // Max 30 points for relationships
        const topicScore = Math.min(topicCount * 8, 20); // Max 20 points for topics
        const actionScore = Math.min(actionCount * 2, 10); // Max 10 points for actions

        const totalScore =
            entityScore + relationshipScore + topicScore + actionScore;

        // Determine quality level and color
        let label: string, color: string;
        if (totalScore >= 80) {
            label = "Excellent";
            color = "success";
        } else if (totalScore >= 60) {
            label = "Good";
            color = "primary";
        } else if (totalScore >= 40) {
            label = "Fair";
            color = "warning";
        } else {
            label = "Basic";
            color = "secondary";
        }

        return {
            score: totalScore,
            label,
            color,
            entities: {
                count: entityCount,
                color:
                    entityCount >= 5
                        ? "success"
                        : entityCount >= 2
                          ? "primary"
                          : "secondary",
            },
            relationships: {
                count: relationshipCount,
                color:
                    relationshipCount >= 3
                        ? "success"
                        : relationshipCount >= 1
                          ? "primary"
                          : "secondary",
            },
            topics: {
                count: topicCount,
                color:
                    topicCount >= 4
                        ? "success"
                        : topicCount >= 2
                          ? "primary"
                          : "secondary",
            },
            actions: {
                count: actionCount,
                color:
                    actionCount >= 5
                        ? "success"
                        : actionCount >= 1
                          ? "primary"
                          : "secondary",
            },
        };
    }

    private updateSliderLabels(activeValue: number) {
        const labels = document.querySelectorAll(".slider-label");
        const ticks = document.querySelectorAll(".slider-tick");

        labels.forEach((label, index) => {
            if (index === activeValue) {
                label.classList.add("active");
            } else {
                label.classList.remove("active");
            }
        });

        ticks.forEach((tick, index) => {
            if (index === activeValue) {
                tick.classList.add("active");
            } else {
                tick.classList.remove("active");
            }
        });
    }

    private updateExtractionMode(
        mode: "basic" | "summary" | "content" | "full",
    ) {
        this.extractionSettings.mode = mode;

        this.updateModeDescription(mode);
        this.updateAIStatusDisplay();
        this.saveExtractionSettings();
    }

    private updateModeDescription(mode: string) {
        const descriptionElement = document.getElementById("modeDescription");
        const modeInfo = MODE_DESCRIPTIONS[mode];

        if (descriptionElement && modeInfo) {
            descriptionElement.innerHTML = `
                <div class="mode-description">
                    ${modeInfo.description}
                    <div class="mt-1">
                        <small class="text-muted">
                            <i class="bi bi-cpu me-1"></i>${modeInfo.performance}
                            ${modeInfo.requiresAI ? ' • <i class="bi bi-robot me-1"></i>Requires AI' : ' • <i class="bi bi-lightning me-1"></i>No AI needed'}
                        </small>
                    </div>
                </div>
            `;
        }
    }

    private updateAIStatusDisplay() {
        const statusElement = document.getElementById("aiModelStatus");
        const messageElement = document.getElementById("aiStatusMessage");

        if (!statusElement || !messageElement) return;

        const requiresAI =
            MODE_DESCRIPTIONS[this.extractionSettings.mode]?.requiresAI;

        // Only show AI status notification when there's an error (AI required but not available)
        if (requiresAI && !this.aiModelAvailable) {
            statusElement.classList.remove("d-none");
            statusElement.className = "mb-3 alert alert-warning alert-sm p-2";
            messageElement.innerHTML = `
                <span class="ai-status-indicator ai-unavailable"></span>
                AI model required but not available. Please configure AI model or use Basic mode.
            `;
        } else {
            // Hide notification by default (when AI is available or not required)
            statusElement.classList.add("d-none");
        }
    }

    private async checkAIModelAvailability() {
        try {
            const response = await extensionService.checkAIModelAvailability();

            this.aiModelAvailable = response.available || false;
        } catch (error) {
            console.warn("Could not check AI model availability:", error);
            this.aiModelAvailable = false;
        }

        this.updateAIStatusDisplay();
    }

    private showAIRequiredError() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <i class="bi bi-robot text-warning h3"></i>
                    <h6 class="mt-2">AI Model Required</h6>
                    <p class="text-muted mb-3">
                        The <strong>${this.extractionSettings.mode}</strong> mode requires an AI model for analysis.
                    </p>
                    <div class="d-grid gap-2">
                        <button class="btn btn-primary btn-sm" onclick="switchToBasicMode()">
                            <i class="bi bi-lightning me-2"></i>Switch to Basic Mode
                        </button>
                        <button class="btn btn-outline-secondary btn-sm" onclick="extensionService.openOptionsPage()">
                            <i class="bi bi-gear me-2"></i>Configure AI Model
                        </button>
                    </div>
                </div>
            </div>
        `;

        (window as any).switchToBasicMode = () => {
            const modeSlider = document.getElementById(
                "extractionMode",
            ) as HTMLInputElement;
            modeSlider.value = "0";
            modeSlider.setAttribute("data-mode", "basic");
            this.updateExtractionMode("basic");
            this.updateSliderLabels(0);
            knowledgeSection.innerHTML = "";
            knowledgeSection.classList.add("d-none");
        };
    }

    private async saveExtractionSettings() {
        try {
            await extensionService.saveExtractionSettings(
                this.extractionSettings,
            );
        } catch (error) {
            console.warn("Could not save extraction settings:", error);
        }
    }
}

let knowledgePanelInstance: KnowledgePanel;

document.addEventListener("DOMContentLoaded", () => {
    knowledgePanelInstance = new KnowledgePanel();
    knowledgePanelInstance.initialize();
});

// Add cleanup on window unload
window.addEventListener("beforeunload", () => {
    if (knowledgePanelInstance) {
        knowledgePanelInstance.cleanup();
    }
});
