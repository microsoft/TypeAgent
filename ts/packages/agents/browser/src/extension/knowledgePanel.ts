// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
    // Enhanced content data
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics?: {
        readingTime: number;
        wordCount: number;
        hasCode: boolean;
        interactivity: string;
        pageType: string;
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
    mode: "basic" | "content" | "actions" | "full";
    enableIntelligentAnalysis: boolean;
    enableActionDetection: boolean;
    suggestQuestions: boolean;
    quality: "fast" | "balanced" | "deep";
}

interface PageSourceInfo {
    isBookmarked: boolean;
    isInHistory: boolean;
    visitCount?: number;
    lastVisited?: string;
    bookmarkFolder?: string;
}

class KnowledgePanel {
    private currentUrl: string = "";
    private isConnected: boolean = false;
    private knowledgeData: KnowledgeData | null = null;
    private pageSourceInfo: PageSourceInfo | null = null;
    private extractionSettings: ExtractionSettings;

    constructor() {
        this.extractionSettings = {
            mode: "full",
            enableIntelligentAnalysis: true,
            enableActionDetection: true,
            suggestQuestions: true,
            quality: "balanced",
        };
    }

    async initialize() {
        console.log("Initializing Enhanced Knowledge Panel");

        this.setupEventListeners();
        await this.loadCurrentPageInfo();
        await this.loadPageSourceInfo();
        await this.loadAutoIndexSetting();
        await this.loadIndexStats();
        await this.checkConnectionStatus();
        await this.loadCachedKnowledge();
        this.setupExtractionModeControls();
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
            .getElementById("openSettings")!
            .addEventListener("click", () => {
                chrome.runtime.openOptionsPage();
            });

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
                const status = await this.getPageIndexStatus();

                pageInfo.innerHTML = this.createPageInfo(tab.title || "Untitled", domain, status);
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
                extractionSettings: this.extractionSettings,
            });

            this.knowledgeData = response.knowledge;
            if (this.knowledgeData) {
                this.renderKnowledgeResults(this.knowledgeData);
                await this.cacheKnowledge(this.knowledgeData);
                this.showExtractionInfo();
            }

            this.showTemporaryStatus(
                `Knowledge extracted successfully using ${this.extractionSettings.mode} mode!`,
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

        queryResults.innerHTML = this.createSearchLoadingState();

        try {
            const response = await chrome.runtime.sendMessage({
                type: "queryKnowledge",
                query: query,
                url: this.currentUrl,
                searchScope: "current_page",
            });

            queryResults.innerHTML = this.createQueryAnswer(response.answer, response.sources);
            queryInput.value = "";
        } catch (error) {
            console.error("Error querying knowledge:", error);
            queryResults.innerHTML = this.createAlert(
                "danger", 
                "bi bi-exclamation-triangle", 
                "Error processing query. Please try again."
            );
        }
    }

    private showKnowledgeLoading() {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = this.createLoadingState(
            "Extracting knowledge from page...", 
            "This may take a few seconds"
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

    private renderKnowledgeResults(knowledge: KnowledgeData) {
        const knowledgeSection = document.getElementById("knowledgeSection")!;
        knowledgeSection.className = "";
        knowledgeSection.innerHTML = `
            ${knowledge.contentMetrics ? this.renderContentMetricsCard() : ""}
            ${this.renderEntitiesCard()}
            ${this.renderRelationshipsCard()}
            ${this.renderTopicsCard()}
            ${knowledge.detectedActions && knowledge.detectedActions.length > 0 ? this.renderActionsCard() : ""}
        `;

        if (knowledge.contentMetrics) {
            this.renderContentMetrics(knowledge.contentMetrics);
        }
        this.renderEntities(knowledge.entities);
        this.renderRelationships(knowledge.relationships);
        this.renderKeyTopics(knowledge.keyTopics);
        if (knowledge.detectedActions && knowledge.detectedActions.length > 0) {
            this.renderDetectedActions(knowledge.detectedActions, knowledge.actionSummary);
        }
        this.renderSuggestedQuestions(knowledge.suggestedQuestions);

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

        // NEW: Categorize questions for better organization
        const categorizedQuestions = this.categorizeQuestions(questions);

        let questionsHtml = `<div class="mb-2"><small class="text-muted">
            <i class="bi bi-lightbulb"></i> Click a question to ask, or type your own below:
        </small></div>`;

        if (categorizedQuestions.content.length > 0) {
            questionsHtml += `<div class="mb-3">
                <h6 class="text-muted mb-2"><i class="bi bi-file-text"></i> About Content</h6>
                ${this.renderQuestionList(categorizedQuestions.content, "content")}
            </div>`;
        }

        if (categorizedQuestions.temporal.length > 0) {
            questionsHtml += `<div class="mb-3">
                <h6 class="text-muted mb-2"><i class="bi bi-clock"></i> Timeline</h6>
                ${this.renderQuestionList(categorizedQuestions.temporal, "temporal")}
            </div>`;
        }

        if (categorizedQuestions.pattern.length > 0) {
            questionsHtml += `<div class="mb-3">
                <h6 class="text-muted mb-2"><i class="bi bi-search"></i> Discovery</h6>
                ${this.renderQuestionList(categorizedQuestions.pattern, "pattern")}
            </div>`;
        }

        if (categorizedQuestions.action.length > 0) {
            questionsHtml += `<div class="mb-3">
                <h6 class="text-muted mb-2"><i class="bi bi-lightning"></i> Actions</h6>
                ${this.renderQuestionList(categorizedQuestions.action, "action")}
            </div>`;
        }

        if (categorizedQuestions.other.length > 0) {
            questionsHtml += `<div class="mb-3">
                ${this.renderQuestionList(categorizedQuestions.other, "other")}
            </div>`;
        }

        container.innerHTML = questionsHtml;

        container.querySelectorAll(".question-item").forEach((item, index) => {
            item.addEventListener("click", () => {
                const questionText = item.getAttribute("data-question")!;
                (
                    document.getElementById(
                        "knowledgeQuery",
                    ) as HTMLInputElement
                ).value = questionText;
                this.submitQuery();
            });
        });
    }

    private categorizeQuestions(questions: string[]) {
        const categories = {
            content: [] as string[],
            temporal: [] as string[],
            pattern: [] as string[],
            action: [] as string[],
            other: [] as string[],
        };

        questions.forEach((question) => {
            const lowerQ = question.toLowerCase();

            if (
                lowerQ.includes("when") ||
                lowerQ.includes("first") ||
                lowerQ.includes("time")
            ) {
                categories.temporal.push(question);
            } else if (
                lowerQ.includes("what is") ||
                lowerQ.includes("tell me") ||
                lowerQ.includes("summarize") ||
                lowerQ.includes("about")
            ) {
                categories.content.push(question);
            } else if (
                lowerQ.includes("other") ||
                lowerQ.includes("similar") ||
                lowerQ.includes("else")
            ) {
                categories.pattern.push(question);
            } else if (
                lowerQ.includes("action") ||
                lowerQ.includes("can i") ||
                lowerQ.includes("do")
            ) {
                categories.action.push(question);
            } else {
                categories.other.push(question);
            }
        });

        return categories;
    }

    private renderQuestionList(questions: string[], category: string): string {
        const icons = {
            content: "bi-file-text",
            temporal: "bi-clock",
            pattern: "bi-search",
            action: "bi-lightning",
            other: "bi-question-circle",
        };

        return questions
            .map(
                (question) => `
                    <div class="question-item list-group-item list-group-item-action p-2 mb-1 rounded" 
                         data-question="${question.replace(/"/g, "&quot;")}" 
                         data-category="${category}">
                        <i class="${icons[category as keyof typeof icons]} me-2 text-muted"></i>
                        ${question}
                    </div>
                `,
            )
            .join("");
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

    private async loadPageSourceInfo() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getPageSourceInfo",
                url: this.currentUrl,
            });

            this.pageSourceInfo = response.sourceInfo;
            this.updatePageSourceDisplay();
        } catch (error) {
            console.error("Error loading page source info:", error);
        }
    }

    private updatePageSourceDisplay() {
        const pageInfo = document.getElementById("currentPageInfo")!;
        const existingContent = pageInfo.innerHTML;

        if (this.pageSourceInfo) {
            const sourceIndicators = [];

            if (this.pageSourceInfo.isBookmarked) {
                sourceIndicators.push(
                    `<span class="badge bg-primary me-1" title="This page is bookmarked">
                        <i class="bi bi-bookmark-star"></i> Bookmarked
                    </span>`,
                );
            }

            if (this.pageSourceInfo.isInHistory) {
                const visitText = this.pageSourceInfo.visitCount
                    ? this.pageSourceInfo.visitCount + " visits"
                    : "In History";
                sourceIndicators.push(
                    `<span class="badge bg-info me-1" title="This page is in your browser history">
                        <i class="bi bi-clock-history"></i> ${visitText}
                    </span>`,
                );
            }

            if (sourceIndicators.length > 0) {
                const sourceDiv = `<div class="mt-2">${sourceIndicators.join("")}</div>`;
                pageInfo.innerHTML = existingContent + sourceDiv;
            }
        }
    }

    private setupExtractionModeControls() {
        const extractButton = document.getElementById("extractKnowledge")!;
        const buttonGroup = extractButton.parentElement!;

        const modeSelector = document.createElement("div");
        modeSelector.className = "btn-group btn-group-sm ms-2";
        modeSelector.innerHTML = this.createExtractionModeDropdown();

        buttonGroup.appendChild(modeSelector);

        document
            .getElementById("extractionModeMenu")!
            .addEventListener("click", (e) => {
                e.preventDefault();
                const target = e.target as HTMLElement;
                const item = target.closest(".dropdown-item") as HTMLElement;

                if (item) {
                    const mode = item.getAttribute("data-mode");
                    const option = item.getAttribute("data-option");

                    if (mode) {
                        this.extractionSettings.mode = mode as any;
                        this.updateExtractionModeDisplay();
                        this.saveExtractionSettings();
                    } else if (option === "quality") {
                        this.toggleQualitySetting();
                    }
                }
            });
    }

    private updateExtractionModeDisplay() {
        const button = document.getElementById("extractionModeButton")!;
        button.innerHTML = `<i class="bi bi-gear"></i> ${this.extractionSettings.mode}`;
    }

    private toggleQualitySetting() {
        const qualities = ["fast", "balanced", "deep"];
        const currentIndex = qualities.indexOf(this.extractionSettings.quality);
        const nextIndex = (currentIndex + 1) % qualities.length;
        this.extractionSettings.quality = qualities[nextIndex] as any;

        const qualityItem = document.querySelector('[data-option="quality"]')!;
        qualityItem.innerHTML = `<i class="bi bi-sliders"></i> Quality: ${this.extractionSettings.quality}`;

        this.saveExtractionSettings();
    }

    private async loadExtractionSettings() {
        try {
            const settings = await chrome.storage.sync.get([
                "extractionSettings",
            ]);
            if (settings.extractionSettings) {
                this.extractionSettings = {
                    ...this.extractionSettings,
                    ...settings.extractionSettings,
                };
                this.updateExtractionModeDisplay();
            }
        } catch (error) {
            console.error("Error loading extraction settings:", error);
        }
    }

    private async saveExtractionSettings() {
        try {
            await chrome.storage.sync.set({
                extractionSettings: this.extractionSettings,
            });
        } catch (error) {
            console.error("Error saving extraction settings:", error);
        }
    }

    // NEW: Show extraction information
    private showExtractionInfo() {
        if (!this.knowledgeData) return;

        const infoDiv = document.createElement("div");
        infoDiv.className = "alert alert-info mt-2";

        let content = `<small>
            <i class="bi bi-info-circle"></i>
            Extracted using <strong>${this.extractionSettings.mode}</strong> mode 
            (${this.extractionSettings.quality} quality)`;

        if (this.pageSourceInfo?.isBookmarked) {
            content += " • Available in bookmarks";
        }
        if (this.pageSourceInfo?.isInHistory) {
            content += " • Available in history";
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
        await this.loadCurrentPageInfo();
        await this.loadCachedKnowledge();
    }

    private async loadCachedKnowledge() {
        try {
            const knowledgeKey = "knowledge_" + this.currentUrl;
            const cached = await chrome.storage.local.get([knowledgeKey]);

            if (cached[knowledgeKey]) {
                this.knowledgeData = cached[knowledgeKey];
                if (this.knowledgeData) {
                    this.renderKnowledgeResults(this.knowledgeData);
                }
            } else {
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
            const cacheKey = "knowledge_" + this.currentUrl;
            const cacheObject: any = {};
            cacheObject[cacheKey] = knowledge;
            await chrome.storage.local.set(cacheObject);
        } catch (error) {
            console.error("Error caching knowledge:", error);
        }
    }

    private showTemporaryStatus(
        message: string,
        type: "success" | "danger" | "info",
    ) {
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

    // Template utility functions for knowledge panel
    private createCard(title: string, content: string, icon: string, badge?: string): string {
        const badgeHtml = badge ? `<span id="${badge}" class="badge bg-secondary ms-2">0</span>` : "";
        return `
            <div class="knowledge-card card">
                <div class="card-header">
                    <h6 class="mb-0">
                        <i class="${icon}"></i> ${title}
                        ${badgeHtml}
                    </h6>
                </div>
                <div class="card-body">
                    ${content}
                </div>
            </div>
        `;
    }

    private createEmptyState(icon: string, message: string): string {
        return `
            <div class="text-muted text-center">
                <i class="${icon}"></i>
                ${message}
            </div>
        `;
    }

    private createContainer(id: string, defaultContent: string): string {
        return `<div id="${id}">${defaultContent}</div>`;
    }

    // Knowledge card component methods
    private renderEntitiesCard(): string {
        const content = this.createContainer(
            "entitiesContainer", 
            this.createEmptyState("bi bi-info-circle", "No entities extracted yet")
        );
        return this.createCard("Entities", content, "bi bi-tags", "entitiesCount");
    }

    private renderRelationshipsCard(): string {
        const content = this.createContainer(
            "relationshipsContainer",
            this.createEmptyState("bi bi-info-circle", "No relationships found yet")
        );
        return this.createCard("Relationships", content, "bi bi-diagram-3", "relationshipsCount");
    }

    private renderTopicsCard(): string {
        const content = this.createContainer(
            "topicsContainer",
            this.createEmptyState("bi bi-info-circle", "No topics identified yet")
        );
        return this.createCard("Key Topics", content, "bi bi-bookmark");
    }

    // Alert and loading state utilities
    private createAlert(type: "info" | "danger", icon: string, content: string): string {
        return `
            <div class="alert alert-${type} mb-0">
                <div class="d-flex align-items-start">
                    <i class="${icon} me-2 mt-1"></i>
                    <div class="flex-grow-1">
                        ${content}
                    </div>
                </div>
            </div>
        `;
    }

    private createLoadingState(message: string, subtext?: string): string {
        const subtextHtml = subtext ? `<small class="text-muted">${subtext}</small>` : "";
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

    private createSearchLoadingState(): string {
        return `
            <div class="d-flex align-items-center text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <span>Searching knowledge...</span>
            </div>
        `;
    }

    private createQueryAnswer(answer: string, sources: any[]): string {
        const sourcesHtml = sources && sources.length > 0 ? `
            <hr class="my-2">
            <small class="text-muted">
                <strong>Sources:</strong> ${sources.map((s: any) => s.title).join(", ")}
            </small>
        ` : "";

        const content = `
            <div class="fw-semibold">Answer:</div>
            <p class="mb-2">${answer}</p>
            ${sourcesHtml}
        `;

        return this.createAlert("info", "bi bi-lightbulb", content);
    }

    // Extraction mode dropdown components
    private createDropdownHeader(text: string): string {
        return `<li><h6 class="dropdown-header">${text}</h6></li>`;
    }

    private createDropdownItem(icon: string, text: string, dataAttr: string, value: string): string {
        return `
            <li><a class="dropdown-item" href="#" ${dataAttr}="${value}">
                <i class="${icon}"></i> ${text}
            </a></li>
        `;
    }

    private createDropdownDivider(): string {
        return `<li><hr class="dropdown-divider"></li>`;
    }

    private createExtractionModeDropdown(): string {
        return `
            <button type="button" class="btn btn-outline-secondary dropdown-toggle" 
                    data-bs-toggle="dropdown" aria-expanded="false" id="extractionModeButton">
                <i class="bi bi-gear"></i> ${this.extractionSettings.mode}
            </button>
            <ul class="dropdown-menu" id="extractionModeMenu">
                ${this.createDropdownHeader("Extraction Mode")}
                ${this.createDropdownItem("bi bi-speedometer", "Basic - Fast extraction", "data-mode", "basic")}
                ${this.createDropdownItem("bi bi-file-text", "Content - Include page analysis", "data-mode", "content")}
                ${this.createDropdownItem("bi bi-lightning", "Actions - Detect actionable elements", "data-mode", "actions")}
                ${this.createDropdownItem("bi bi-cpu", "Full - Complete analysis", "data-mode", "full")}
                ${this.createDropdownDivider()}
                ${this.createDropdownHeader("Options")}
                ${this.createDropdownItem("bi bi-sliders", `Quality: ${this.extractionSettings.quality}`, "data-option", "quality")}
            </ul>
        `;
    }

    private createPageInfo(title: string, domain: string, status: string): string {
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

    // Content Metrics Card component
    private renderContentMetricsCard(): string {
        const content = this.createContainer(
            "contentMetricsContainer", 
            this.createEmptyState("bi bi-info-circle", "No content metrics available")
        );
        return this.createCard("Content Metrics", content, "bi bi-bar-chart");
    }

    // Detected Actions Card component  
    private renderActionsCard(): string {
        const content = this.createContainer(
            "detectedActionsContainer",
            this.createEmptyState("bi bi-info-circle", "No actions detected")
        );
        return this.createCard("Detected Actions", content, "bi bi-lightning", "actionsCount");
    }

    // Render content metrics data
    private renderContentMetrics(metrics: any) {
        const container = document.getElementById("contentMetricsContainer")!;
        
        container.innerHTML = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <small class="text-muted">Reading Time:</small><br>
                    <span class="fw-semibold">${metrics.readingTime} min</span>
                </div>
                <div class="col-md-6">
                    <small class="text-muted">Word Count:</small><br>
                    <span class="fw-semibold">${metrics.wordCount}</span>
                </div>
            </div>
            
            <div class="row mb-3">
                <div class="col-md-6">
                    <small class="text-muted">Page Type:</small><br>
                    <span class="badge bg-primary">${metrics.pageType}</span>
                </div>
                <div class="col-md-6">
                    <small class="text-muted">Has Code:</small><br>
                    ${metrics.hasCode ? '<i class="bi bi-code-slash text-success" title="Has Code"></i> Yes' : '<i class="bi bi-x text-muted" title="No Code"></i> No'}
                </div>
            </div>
            
            <div class="row">
                <div class="col-md-12">
                    <small class="text-muted">Interactivity:</small><br>
                    <span class="badge bg-info">${metrics.interactivity}</span>
                </div>
            </div>
        `;
    }

    // Render detected actions
    private renderDetectedActions(actions: DetectedAction[], summary?: ActionSummary) {
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
                    ${summary.actionTypes.length > 0 ? `<br><small>Types: ${summary.actionTypes.join(", ")}</small>` : ''}
                </div>
            `;
        }

        const actionsHtml = actions
            .slice(0, 10)
            .map(action => `
                <div class="d-flex justify-content-between align-items-center mb-2 p-2 border rounded">
                    <div>
                        <span class="fw-semibold">${action.type}</span>
                        <span class="badge bg-secondary ms-2">${action.element}</span>
                        ${action.text ? `<br><small class="text-muted">${action.text}</small>` : ''}
                    </div>
                    <div>
                        <div class="progress" style="width: 50px; height: 4px;">
                            <div class="progress-bar bg-success" style="width: ${action.confidence * 100}%"></div>
                        </div>
                    </div>
                </div>
            `)
            .join("");

        container.innerHTML = summaryHtml + actionsHtml;
    }

    // Enhanced question categorization
    private categorizeQuestionsEnhanced(questions: string[]) {
        const categories = {
            learning: [] as string[],
            discovery: [] as string[],
            temporal: [] as string[],
            technical: [] as string[],
            other: [] as string[],
        };

        questions.forEach((question) => {
            const lowerQ = question.toLowerCase();

            if (
                lowerQ.includes("learn") ||
                lowerQ.includes("prerequisite") ||
                lowerQ.includes("should i") ||
                lowerQ.includes("knowledge gap")
            ) {
                categories.learning.push(question);
            } else if (
                lowerQ.includes("other") ||
                lowerQ.includes("similar") ||
                lowerQ.includes("else") ||
                lowerQ.includes("show me") ||
                lowerQ.includes("find")
            ) {
                categories.discovery.push(question);
            } else if (
                lowerQ.includes("code") ||
                lowerQ.includes("api") ||
                lowerQ.includes("tutorial") ||
                lowerQ.includes("example") ||
                lowerQ.includes("advanced") ||
                lowerQ.includes("documentation")
            ) {
                categories.technical.push(question);
            } else if (
                lowerQ.includes("when") ||
                lowerQ.includes("first") ||
                lowerQ.includes("recently") ||
                lowerQ.includes("journey") ||
                lowerQ.includes("time")
            ) {
                categories.temporal.push(question);
            } else {
                categories.other.push(question);
            }
        });

        return categories;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const panel = new KnowledgePanel();
    panel.initialize();
});
