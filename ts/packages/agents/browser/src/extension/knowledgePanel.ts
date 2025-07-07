// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
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

class KnowledgePanel {
    private currentUrl: string = "";
    private isConnected: boolean = false;
    private knowledgeData: KnowledgeData | null = null;

    async initialize() {
        console.log("Initializing Knowledge Panel");

        // Setup event listeners
        this.setupEventListeners();

        // Load current page info
        await this.loadCurrentPageInfo();

        // Check auto-index setting
        await this.loadAutoIndexSetting();

        // Load index statistics
        await this.loadIndexStats();

        // Check connection status
        await this.checkConnectionStatus();

        // Load any cached knowledge for current page
        await this.loadCachedKnowledge();
    }

    private setupEventListeners() {
        // Extract knowledge button
        document
            .getElementById("extractKnowledge")!
            .addEventListener("click", () => {
                this.extractKnowledge();
            });

        // Index page button
        document.getElementById("indexPage")!.addEventListener("click", () => {
            this.indexCurrentPage();
        });

        // Auto-index toggle
        document
            .getElementById("autoIndexToggle")!
            .addEventListener("change", (e) => {
                const checkbox = e.target as HTMLInputElement;
                this.toggleAutoIndex(checkbox.checked);
            });

        // Query submission
        document
            .getElementById("submitQuery")!
            .addEventListener("click", () => {
                this.submitQuery();
            });

        // Enter key for query input
        document
            .getElementById("knowledgeQuery")!
            .addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    this.submitQuery();
                }
            });

        // Settings button
        document
            .getElementById("openSettings")!
            .addEventListener("click", () => {
                chrome.runtime.openOptionsPage();
            });

        // Listen for tab changes
        chrome.tabs.onActivated.addListener(() => {
            this.onTabChange();
        });

        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status === "complete") {
                this.onTabChange();
            }
        });
    }

    private async loadCurrentPageInfo() {
        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            if (tabs.length > 0) {
                const tab = tabs[0];
                this.currentUrl = tab.url || "";

                const pageInfo = document.getElementById("currentPageInfo")!;
                const domain = new URL(this.currentUrl).hostname;

                pageInfo.innerHTML = `
                    <div class="d-flex align-items-center">
                        <img src="https://www.google.com/s2/favicons?domain=${domain}" 
                             width="16" height="16" class="me-2" alt="favicon">
                        <div class="flex-grow-1">
                            <div class="fw-semibold">${tab.title || "Untitled"}</div>
                            <small class="text-muted">${domain}</small>
                        </div>
                        <div id="pageStatus" class="ms-2">
                            ${await this.getPageIndexStatus()}
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error("Error loading page info:", error);
        }
    }

    private async getPageIndexStatus(): Promise<string> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getPageIndexStatus",
                url: this.currentUrl,
            });

            if (response.isIndexed) {
                return '<span class="badge bg-success">Indexed</span>';
            } else {
                return '<span class="badge bg-secondary">Not indexed</span>';
            }
        } catch (error) {
            return '<span class="badge bg-warning">Unknown</span>';
        }
    }

    private async loadAutoIndexSetting() {
        try {
            const settings = await chrome.storage.sync.get(["autoIndexing"]);
            const toggle = document.getElementById(
                "autoIndexToggle",
            ) as HTMLInputElement;
            toggle.checked = settings.autoIndexing || false;
        } catch (error) {
            console.error("Error loading auto-index setting:", error);
        }
    }

    private async toggleAutoIndex(enabled: boolean) {
        try {
            await chrome.storage.sync.set({ autoIndexing: enabled });

            // Update status indicator
            const statusText = enabled
                ? "Auto-indexing enabled"
                : "Auto-indexing disabled";
            this.showTemporaryStatus(statusText, enabled ? "success" : "info");

            // Notify background script
            chrome.runtime.sendMessage({
                type: "autoIndexSettingChanged",
                enabled: enabled,
            });
        } catch (error) {
            console.error("Error toggling auto-index:", error);
        }
    }

    private async extractKnowledge() {
        this.showKnowledgeLoading();

        try {
            const response = await chrome.runtime.sendMessage({
                type: "extractPageKnowledge",
                url: this.currentUrl,
            });

            this.knowledgeData = response.knowledge;
            if (this.knowledgeData) {
                this.renderKnowledgeResults(this.knowledgeData);

                // Cache the knowledge for this page
                await this.cacheKnowledge(this.knowledgeData);
            }

            this.showTemporaryStatus(
                "Knowledge extracted successfully!",
                "success",
            );
        } catch (error) {
            console.error("Error extracting knowledge:", error);
            this.showKnowledgeError(
                "Failed to extract knowledge. Please check your connection.",
            );
        }
    }

    private async indexCurrentPage() {
        const button = document.getElementById(
            "indexPage",
        ) as HTMLButtonElement;
        const originalContent = button.innerHTML;

        button.innerHTML = '<i class="bi bi-hourglass-split"></i> Indexing...';
        button.disabled = true;

        try {
            await chrome.runtime.sendMessage({
                type: "indexPageContentDirect",
                url: this.currentUrl,
            });

            // Update page status
            await this.loadCurrentPageInfo();
            await this.loadIndexStats();

            this.showTemporaryStatus("Page indexed successfully!", "success");
        } catch (error) {
            console.error("Error indexing page:", error);
            this.showTemporaryStatus("Failed to index page", "danger");
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }

    private async submitQuery() {
        const queryInput = document.getElementById(
            "knowledgeQuery",
        ) as HTMLInputElement;
        const queryResults = document.getElementById("queryResults")!;
        const query = queryInput.value.trim();

        if (!query) return;

        queryResults.innerHTML = `
            <div class="d-flex align-items-center text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Searching knowledge...</span>
            </div>
        `;

        try {
            const response = await chrome.runtime.sendMessage({
                type: "queryKnowledge",
                query: query,
                url: this.currentUrl,
                searchScope: "current_page",
            });

            queryResults.innerHTML = `
                <div class="alert alert-info mb-0">
                    <div class="d-flex align-items-start">
                        <i class="bi bi-lightbulb me-2 mt-1"></i>
                        <div class="flex-grow-1">
                            <div class="fw-semibold">Answer:</div>
                            <p class="mb-2">${response.answer}</p>
                            ${
                                response.sources && response.sources.length > 0
                                    ? `
                                <hr class="my-2">
                                <small class="text-muted">
                                    <strong>Sources:</strong> ${response.sources.map((s: any) => s.title).join(", ")}
                                </small>
                            `
                                    : ""
                            }
                        </div>
                    </div>
                </div>
            `;

            queryInput.value = ""; // Clear input
        } catch (error) {
            console.error("Error querying knowledge:", error);
            queryResults.innerHTML = `
                <div class="alert alert-danger mb-0">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Error processing query. Please try again.
                </div>
            `;
        }
    }

    private showKnowledgeLoading() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <div class="knowledge-card card">
                <div class="card-body text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-3 mb-0">Extracting knowledge from page...</p>
                    <small class="text-muted">This may take a few seconds</small>
                </div>
            </div>
        `;
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

    private renderKnowledgeResults(knowledge: KnowledgeData) {
        // Show knowledge section
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            <!-- Entities Card -->
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="bi bi-tags"></i> Entities
                        <span id="entitiesCount" class="badge bg-secondary ms-2">0</span>
                    </h6>
                </div>
                <div class="card-body">
                    <div id="entitiesContainer">
                        <div class="text-muted text-center">
                            <i class="bi bi-info-circle"></i>
                            No entities extracted yet
                        </div>
                    </div>
                </div>
            </div>

            <!-- Relationships Card -->
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="bi bi-diagram-3"></i> Relationships
                        <span id="relationshipsCount" class="badge bg-secondary ms-2">0</span>
                    </h6>
                </div>
                <div class="card-body">
                    <div id="relationshipsContainer">
                        <div class="text-muted text-center">
                            <i class="bi bi-info-circle"></i>
                            No relationships found yet
                        </div>
                    </div>
                </div>
            </div>

            <!-- Key Topics Card -->
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="bi bi-bookmark"></i> Key Topics
                    </h6>
                </div>
                <div class="card-body">
                    <div id="topicsContainer">
                        <div class="text-muted text-center">
                            <i class="bi bi-info-circle"></i>
                            No topics identified yet
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Render entities
        this.renderEntities(knowledge.entities);

        // Render relationships
        this.renderRelationships(knowledge.relationships);

        // Render key topics
        this.renderKeyTopics(knowledge.keyTopics);

        // Render suggested questions
        this.renderSuggestedQuestions(knowledge.suggestedQuestions);

        // Show questions section
        const questionsSection = document.getElementById("questionsSection")!;
        questionsSection.className = "knowledge-card card";
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
                    No relationships identified
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

    private renderSuggestedQuestions(questions: string[]) {
        const container = document.getElementById("suggestedQuestions")!;

        if (questions.length === 0) {
            container.innerHTML = `
                <div class="text-muted text-center">
                    <i class="bi bi-info-circle"></i>
                    No suggested questions available
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="mb-2"><small class="text-muted">Click a question to ask:</small></div>
            ${questions
                .map(
                    (question) => `
                <div class="question-item list-group-item list-group-item-action p-2 mb-1 rounded">
                    <i class="bi bi-question-circle me-2"></i>${question}
                </div>
            `,
                )
                .join("")}
        `;

        // Add click listeners to questions
        container.querySelectorAll(".question-item").forEach((item, index) => {
            item.addEventListener("click", () => {
                (
                    document.getElementById(
                        "knowledgeQuery",
                    ) as HTMLInputElement
                ).value = questions[index];
                this.submitQuery();
            });
        });
    }

    private async loadIndexStats() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getIndexStats",
            });

            document.getElementById("totalPages")!.textContent =
                response.totalPages.toString();
            document.getElementById("totalEntities")!.textContent =
                response.totalEntities.toString();
            document.getElementById("lastIndexed")!.textContent =
                response.lastIndexed || "Never";
        } catch (error) {
            console.error("Error loading index stats:", error);
        }
    }

    private async checkConnectionStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkConnection",
            });

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

    private async onTabChange() {
        // Reload page info when tab changes
        await this.loadCurrentPageInfo();
        await this.loadCachedKnowledge();
    }

    private async loadCachedKnowledge() {
        try {
            const cached = await chrome.storage.local.get([
                `knowledge_${this.currentUrl}`,
            ]);
            const knowledgeKey = `knowledge_${this.currentUrl}`;

            if (cached[knowledgeKey]) {
                this.knowledgeData = cached[knowledgeKey];
                if (this.knowledgeData) {
                    this.renderKnowledgeResults(this.knowledgeData);
                }
            } else {
                // Hide knowledge section if no cached data
                const knowledgeSection =
                    document.getElementById("knowledgeSection")!;
                knowledgeSection.className = "d-none";

                const questionsSection =
                    document.getElementById("questionsSection")!;
                questionsSection.className = "knowledge-card card d-none";
            }
        } catch (error) {
            console.error("Error loading cached knowledge:", error);
        }
    }

    private async cacheKnowledge(knowledge: KnowledgeData) {
        try {
            const cacheKey = `knowledge_${this.currentUrl}`;
            await chrome.storage.local.set({
                [cacheKey]: knowledge,
            });
        } catch (error) {
            console.error("Error caching knowledge:", error);
        }
    }

    private showTemporaryStatus(
        message: string,
        type: "success" | "danger" | "info",
    ) {
        const alertClass = `alert-${type}`;
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
            <i class="${iconClass} me-2"></i>${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(statusDiv);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.remove();
            }
        }, 3000);
    }
}

// Initialize the knowledge panel when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    const panel = new KnowledgePanel();
    panel.initialize();
});
